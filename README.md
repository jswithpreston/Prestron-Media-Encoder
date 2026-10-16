# Prestron Media Encoder

> Interactive CLI tool for batch-encoding movies, TV series and anime to HEVC (H.265) using
> FFmpeg — without ever touching your originals.

[![CI](https://github.com/PrestonCash/Prestron-Media-Encoder/actions/workflows/ci.yml/badge.svg)](https://github.com/PrestonCash/Prestron-Media-Encoder/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/prestron-media-encoder)](https://www.npmjs.com/package/prestron-media-encoder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

```
██████╗ ██████╗ ███████╗███████╗████████╗██████╗  ██████╗ ███╗   ██╗
██╔══██╗██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔═══██╗████╗  ██║
██████╔╝██████╔╝█████╗  ███████╗   ██║   ██████╔╝██║   ██║██╔██╗ ██║
██╔═══╝ ██╔══██╗██╔══╝  ╚════██║   ██║   ██╔══██╗██║   ██║██║╚██╗██║
██║     ██║  ██║███████╗███████║   ██║   ██║  ██║╚██████╔╝██║ ╚████║
╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝
                  Media Encoder  v0.1.0
```

---

## Table of contents

- [Features](#features)
- [Safety guarantees](#safety-guarantees)
- [Install on Pop!_OS / Ubuntu](#install-on-popos--ubuntu)
- [Quick start](#quick-start)
- [CLI reference](#cli-reference)
- [Profiles](#profiles)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Features

- **Interactive TUI** — navigate with keyboard (or mouse) to pick files, choose a profile, and
  watch live progress.
- **Auto-classification** — detects movie / series / anime and picks a sensible CRF profile.
- **Safe by default** — originals are never modified; outputs are encoded to a `.part` file,
  verified, then atomically promoted.
- **Verified outputs** — every output is checked for resolution, stream counts, chapters,
  duration, and a full decode test before being accepted.
- **Smart resume** — interrupted batches are re-queued automatically on the next run.
- **Measured savings** — only reports space saved from real, verified file sizes.
- **Non-interactive mode** — fully scriptable with `--yes`, `--json`, `--dry-run`.
- **Branding** — adds `Encoded by PrestonCash` to output metadata.

---

## Safety guarantees

1. **Originals are never modified.** The tool opens source files read-only.
2. **Outputs are atomic.** Encoding goes to `<name>.part`; only a fully verified file is renamed.
3. **Failures are isolated.** One bad file never stops the batch.
4. **Resume after crash.** Stale `.part` files are deleted and jobs re-queued on the next run.
5. **Disk space is checked** before every file.

---

## Install on Pop!_OS / Ubuntu

### 1. Install Node.js ≥ 22

Prestron requires Node.js **≥ 22** (uses the built-in `node:sqlite` module available since
Node 22.5). The Node version shipped by `apt` on Ubuntu/Pop!_OS is usually too old — use one
of the options below instead.

**Option A — nvm (recommended):**

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc          # or restart your terminal
nvm install 22
nvm use 22
nvm alias default 22
node --version            # should print v22.x.x or higher
```

**Option B — fnm (faster):**

```bash
curl -fsSL https://fnm.vercel.app/install | bash
source ~/.bashrc
fnm install 22
fnm use 22
fnm default 22
```

**Option C — NodeSource apt repository:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### 2. Set up a global npm prefix (no sudo needed)

```bash
mkdir -p ~/.npm-global
npm config set prefix ~/.npm-global
echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

### 3. Install FFmpeg

```bash
sudo apt install ffmpeg
ffmpeg -version   # should show 4.4 or newer
```

### 4. Install Prestron Media Encoder

```bash
npm install -g prestron-media-encoder
prestron --version
```

Or run without installing:

```bash
npx prestron-media-encoder --version
```

---

## Quick start

```bash
cd "Silicon Valley/Season 1"
prestron
# or use the alias:
pme
```

The interactive TUI will guide you through:

1. **File selection** — all video files are listed; toggle with Space, confirm with Enter.
2. **Profile** — auto-detected (movie / series / anime) with reasons shown. Override if needed.
3. **Plan review** — see the exact settings, any warnings, and a naming preview.
4. **Encoding** — live progress bar per file and for the whole batch.
5. **Results** — measured savings, failures, and the location of `Prestron-Encoded/`.

Encoded files appear in `Season 1/Prestron-Encoded/`.

---

## CLI reference

### Interactive (default)

```
prestron [path]
pme [path]
```

### Non-interactive

```bash
# Encode without prompts
prestron encode [path] --yes --profile anime --crf 19 --preset medium

# Preview what would run — no encoding
prestron encode [path] --dry-run

# Scan a folder
prestron scan [path]

# Analyze files (show plan + reasons)
prestron analyze [path] --json

# Verify outputs in Prestron-Encoded/
prestron verify [path]

# Resume an interrupted batch
prestron resume [path]

# Show a batch report
prestron report [path] --format json|csv|text

# List built-in profiles
prestron profiles
```

### Flags

| Flag                    | Description                                                |
| ----------------------- | ---------------------------------------------------------- |
| `--yes` / `-y`          | Skip all confirmation prompts                              |
| `--profile <name>`      | `auto` \| `movie` \| `series` \| `anime` \| `conservative` |
| `--crf <n>`             | Override CRF (0–51)                                        |
| `--preset <name>`       | Override x265 preset                                       |
| `--overwrite`           | Re-encode even if a verified output already exists         |
| `--force`               | Encode even if source is already HEVC/AV1/VP9              |
| `--dry-run`             | Print plan and ffmpeg args without encoding                |
| `--json`                | Structured JSON output (no banner)                         |
| `--quiet`               | Suppress non-essential output                              |
| `--no-banner`           | Skip the ASCII banner                                      |
| `--no-mouse`            | Disable mouse support                                      |
| `--verbose`             | Debug output                                               |
| `--ffmpeg-path <path>`  | Override ffmpeg binary                                     |
| `--ffprobe-path <path>` | Override ffprobe binary                                    |
| `--redact-paths`        | Replace home dir in shareable reports                      |
| `--version`             | Print version and exit                                     |
| `--help`                | Print help and exit                                        |

### Exit codes

| Code | Meaning                                 |
| ---- | --------------------------------------- |
| 0    | Success                                 |
| 1    | Completed with one or more failed files |
| 2    | Usage or config error                   |
| 3    | Missing or incompatible FFmpeg          |
| 4    | Insufficient disk space                 |
| 130  | Interrupted by Ctrl+C                   |

---

## Profiles

| Profile        | CRF | Notes                                          |
| -------------- | --- | ---------------------------------------------- |
| `movie`        | 21  | Good balance for live-action films             |
| `series`       | 22  | Slightly more compression for episodic content |
| `anime`        | 19  | Lower CRF + psy-rd tuning for animation        |
| `conservative` | 20  | Used when classification confidence is low     |
| `auto`         | —   | Auto-selects one of the above                  |

All profiles output 10-bit MKV (`yuv420p10le`) to reduce banding. All streams (audio,
subtitles, attachments, chapters) are copied without re-encoding.

---

## FAQ

**What if ffmpeg is not installed?**

The tool exits with code 3 and prints install instructions for apt/brew/winget.

**What happens if I interrupt an encode (Ctrl+C or close the terminal)?**

The `.part` file is deleted, the job is marked `interrupted`, and the next run re-queues and
re-encodes it from the beginning. The original is always untouched.

**Can I re-run without re-encoding already-done files?**

Yes. Verified outputs in `Prestron-Encoded/` are detected automatically and skipped. Pass
`--overwrite` to force re-encoding.

**Is the source directory modified?**

Never. The only thing created is `Prestron-Encoded/` (a new sub-folder) inside the folder
you ran the tool in.

**Does it support HDR / Dolby Vision?**

HDR sources are encoded in 10-bit and all color signaling metadata is copied. However,
HDR10 static metadata and Dolby Vision RPU re-injection are out of scope for v1. A warning
is shown for HDR sources.

**Can I use hardware encoding (NVENC, VAAPI, QSV)?**

Not in v1. Hardware encoders are on the roadmap.

---

## Troubleshooting

**Banner is garbled in tmux / SSH**

Make sure your terminal and SSH session are both using a UTF-8 locale:

```bash
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8
```

**Mouse clicks don't work**

Mouse support requires a terminal that supports SGR 1006 mouse reporting (GNOME Terminal,
Alacritty, kitty, COSMIC Terminal, most modern terminals). Pass `--no-mouse` to disable it.
Inside tmux, make sure `set -g mouse on` is in your `~/.tmux.conf`.

**Terminal is stuck after a crash**

Run `reset` to restore your terminal to a clean state.

**Narrow terminal / layout broken**

At under 70 columns, the banner collapses to a single line. Some UI elements may be
compressed. Widen your terminal or use `--no-banner` and non-interactive mode.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Small PRs with a clear description are always welcome.

---

## License

MIT — see [LICENSE](LICENSE).

> Encoded by PrestonCash
