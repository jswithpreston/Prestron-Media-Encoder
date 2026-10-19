# Crash and Power-Cut Recovery

Prestron Media Encoder is designed from the ground up to never corrupt state or leave unusable files
in the event of a sudden crash, terminal closure, SIGINT/SIGTERM, or complete system power loss (`kill -9`).

## Core Recovery Guarantees

1. **Originals are untouchable:** Sources are only ever opened in read-only mode (`-nostdin -n -i <src>`).
2. **Atomic promotion:** Encoding produces `<filename>.part`. Only after full post-encode verification passes is the `.part` file renamed via `fsync` and atomic `rename` to `<filename>`.
3. **SQLite WAL journal:** State transitions are committed to a SQLite database in Write-Ahead Log (WAL) mode with `synchronous=FULL`.
4. **Isolated failures:** A crash or encode error on file `N` will never abort or corrupt previous or subsequent jobs.

## Startup Recovery Lifecycle

Every time `prestron` or `pme` starts up on a directory, the recovery module executes before any work begins:

```
  ┌────────────────────────────────────────────────────────┐
  │ 1. Open SQLite Journal in XDG Data Dir                 │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │ 2. Find jobs in 'encoding' or 'verifying' state        │
  │    (Indicating previous process was killed mid-run)    │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │ 3. Unlink stale .part files                            │
  │    Reset job state in journal to 'pending'             │
  │    Increment attempt counter                           │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │ 4. Re-verify 'done' outputs                            │
  │    If output was deleted from Prestron-Encoded,        │
  │    reset state to 'pending' so it will re-encode       │
  └──────────────────────────┬─────────────────────────────┘
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │ 5. Clean orphaned .part files in Prestron-Encoded      │
  └────────────────────────────────────────────────────────┘
```

## Resuming Interrupted Batches

If an encode was stopped or aborted, resume it at any time with:

```bash
prestron resume /path/to/directory
```

Or simply run `prestron /path/to/directory` in interactive mode — the startup screen will detect
the unfinished batch and offer to resume pending files immediately.
Already completed outputs are skipped unless `--overwrite` is specified.
