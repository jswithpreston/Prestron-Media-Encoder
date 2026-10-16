# Contributing to Prestron Media Encoder

Thank you for your interest in contributing!

## Getting started

### Prerequisites

- Node.js ≥ 20 (use `.nvmrc`: `nvm use`)
- FFmpeg ≥ 4.4 with libx265 (`sudo apt install ffmpeg`)
- Git

### Setup

```bash
git clone https://github.com/PrestonCash/Prestron-Media-Encoder.git
cd Prestron-Media-Encoder
nvm use
npm install
npm run build
npm test
```

## Development workflow

1. Create a branch from `main`: `git checkout -b feat/your-feature`
2. Make your changes in small, focused commits.
3. Run checks before pushing:
   ```bash
   npm run typecheck
   npm run lint
   npm run format:check
   npm test
   ```
4. Open a pull request against `main`.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add anime profile tuning
fix: correct fps_mode flag for FFmpeg 5.0
test: add recovery integration test
docs: update README troubleshooting section
chore: upgrade vitest to 2.x
refactor: extract argBuilder into pure function
```

## Code style

- TypeScript strict mode (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- ESLint (typescript-eslint strict) + Prettier. Run `npm run format` to auto-fix.
- No business logic in UI components.
- Pure functions for planning and argument building.
- Every new module in `src/core` needs a unit test.

## Adding dependencies

Include a one-line justification in your commit message or PR description. Keep the tree small.

## Milestones

The project is built milestone by milestone (M0–M5). See `.kiro/specs/prestron/tasks.md` for
the full task list. Do not start a new milestone before the current one's acceptance criteria pass.

## Security

Do not commit secrets, tokens, or API keys. See [SECURITY.md](SECURITY.md) for the
vulnerability disclosure process.
