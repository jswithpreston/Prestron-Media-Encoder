# Architecture

## Three-tier design

The system is split into three tiers. The UI and CLI tiers are thin shells; all logic lives
in the core library which has no terminal dependency.

```
┌─────────────────────────────────────────────────────────┐
│  Tier 1: Entry point                                     │
│  src/bin/prestron.ts                                     │
│  – Registers signal handlers                             │
│  – Handles --version, --help                             │
│  – Detects FFmpeg capabilities (exits 3 if missing)      │
│  – Routes: TTY → Ink UI   /   non-TTY → commander CLI   │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────────┐   ┌──────────────────────┐
│  Tier 2a: UI      │   │  Tier 2b: CLI         │
│  src/ui/          │   │  src/cli/             │
│                   │   │                       │
│  Ink / React      │   │  commander sub-cmds   │
│  No business      │   │  No business logic    │
│  logic            │   │                       │
│  Screens, hooks,  │   │  scan, analyze,       │
│  components       │   │  encode, verify,      │
│                   │   │  resume, report,      │
│                   │   │  profiles             │
└───────┬───────────┘   └────────┬──────────────┘
        │                        │
        └───────────┬────────────┘
                    ▼
┌───────────────────────────────────────────────────────────┐
│  Tier 3: Core (src/core/)                                  │
│  UI-free; importable and testable without a terminal       │
│                                                            │
│  scanner    – Recursive file discovery, episode parsing    │
│  probe      – ffprobe execution → MediaInfo (zod)          │
│  classifier – movie | series | anime + confidence          │
│  policy     – Pure plan builder → EncodePlan               │
│  ffmpeg     – Capability detection, arg builder, runner    │
│  jobs       – SQLite journal, state machine, recovery      │
│  verify     – 10-step output verification before promote   │
│  naming     – Templates, sanitization, collision handling  │
│  report     – Savings calculation, JSON/CSV/text export    │
└───────────────────────────────────────────────────────────┘
                    │
         ┌──────────┴──────────┐
         ▼                     ▼
   src/platform/         SQLite (node:sqlite)
   XDG, signals,         WAL mode, synchronous=FULL
   terminal caps,        ~/.local/share/prestron/
   USB/TTY detection
```

## Key design principles

### Pure functions for planning and argument building

`src/core/policy/planBuilder.ts` and `src/core/ffmpeg/argBuilder.ts` are pure functions with
no side effects and no I/O. `--dry-run` simply calls these functions and prints their output
without running FFmpeg.

### Dependency injection

The core modules accept interfaces (`ProcessRunner`, `FileSystem`, `Clock`) rather than
importing `execa`, `fs`, or `Date` directly. In tests, fakes are injected. In production,
real implementations are wired up from `src/bin/prestron.ts`.

This makes the following testable without a real FFmpeg binary or filesystem:

- All FFmpeg capability detection
- Plan building and argument generation
- Disk-space checks
- State machine transitions

### Atomic output

Every encode follows: `encode → .part file → verify (10 checks) → fsync → atomic rename`.
A file with the final name is **always** complete and verified. The `.part` file is deleted
on any failure.

### Power-cut safe journal

SQLite WAL mode with `synchronous=FULL`. State transitions are committed **before** starting
work and **after** finishing it — a crash leaves the DB in a consistent before/after state,
never mid-transition. Recovery at startup restores any interrupted jobs.

## Data flow for a single file

```
scan()
  └─ probe(file)            → MediaInfo
       └─ classify(info)    → ClassificationResult
            └─ buildPlan()  → EncodePlan (reasons[], warnings[])
                 └─ buildArgs(plan, caps) → string[]
                      └─ runner.run(args) → ProgressEvent stream
                           └─ verify(part, source) → VerificationResult
                                └─ rename(part → final)
                                     └─ record in DB
```

## Module boundaries

| Module           | May import                                                         | Must not import                             |
| ---------------- | ------------------------------------------------------------------ | ------------------------------------------- |
| `src/core/*`     | `node:*`, `zod`, `execa` (via interface)                           | `src/ui/*`, `src/cli/*`, `ink`, `commander` |
| `src/cli/*`      | `src/core/*`, `src/platform/*`, `commander`, `ora`, `cli-progress` | `src/ui/*`, `ink`                           |
| `src/ui/*`       | `src/core/*`, `src/platform/*`, `ink`, `react`                     | `src/cli/*`, `commander`                    |
| `src/platform/*` | `node:*`, `env-paths`                                              | `src/core/*`, `src/ui/*`, `src/cli/*`       |
| `src/bin/*`      | everything                                                         | —                                           |

## SQLite note

v1 uses `node:sqlite` (built-in since Node 22.5, stable in Node 24+) instead of
`better-sqlite3`. Requires **Node ≥ 22**.

- On Node 22.5–22.x, `node:sqlite` is behind the `--experimental-sqlite` launch flag
  and emits an `ExperimentalWarning` to stderr before the module loads.
  `src/platform/suppressExperimentalWarning.ts` intercepts exactly that one warning
  before any `import('node:sqlite')` call, preventing the raw text from corrupting
  the Ink UI's terminal output. All other warnings pass through unchanged.
- On Node 23.4+, `node:sqlite` is available without a flag (no warning).
- On Node 24+, it is fully stable (no warning, no flag).

The `JournalStore` interface (`src/core/jobs/journalStore.ts`) keeps the SQLite backend
swappable: tests use `:memory:` databases; a future backend could be swapped in without
touching the batch runner.

WAL mode (`PRAGMA journal_mode=WAL`) and `PRAGMA synchronous=FULL` are applied on every
database open. Both are verified by unit tests in `tests/unit/core/jobs/sqliteJournalStore.test.ts`.
