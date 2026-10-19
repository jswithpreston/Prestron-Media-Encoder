# Manual Testing Guide

This guide covers manual testing scenarios for Prestron Media Encoder on Linux (Pop!_OS, Ubuntu, etc.). Each section lists prerequisites, steps, and expected results.

## Test environment

- Pop!_OS 22.04 LTS (or Ubuntu 22.04+)
- GNOME Terminal, COSMIC Terminal, or Alacritty
- tmux (optional, for mouse passthrough tests)
- Node ≥ 22, FFmpeg 6.1.1 with libx265
- A folder with a few small MKV/MP4 test files (under 30 seconds each)

## 1. Interactive UI startup

**Prerequisites:** Built binary (`npm run build`), test directory with media files.

**Steps:**
1. Run `./dist/bin/prestron.js <test-dir>` from a terminal emulator.
2. Verify the startup banner renders (ASCII logo, version, folder path).
3. Verify "Detecting FFmpeg…" appears, then "✔ FFmpeg v6.1.1 libx265 ready".
4. Verify "1 file found" (or matching count) and scan results list.
5. Verify hint line: `Enter=start /=commands q=quit`.

**Expected:** No errors, correct file count, FFmpeg detected, keyboard hints visible.

## 2. Guided encode flow

**Steps:**
1. Press `Enter` on the startup screen to open the guided flow.
2. Verify file checklist appears with all detected media files.
3. Verify profile options are shown (e.g., "High quality", "Fast", "Compatibility").
4. Select files and a profile, then confirm.
5. Verify encoding screen appears with progress bar and ETA.
6. Verify encoding completes and results screen shows savings.

**Expected:** Files are encoded to `<name>.mkv` in `Prestron-Encoded/`, originals untouched, results screen shows correct byte savings.

## 3. Terminal restoration on quit

**Prerequisites:** Running in a real terminal (not piped, not captured).

**Steps:**
1. Launch interactive UI.
2. Press `q` on the startup screen.
3. Verify the process exits and the terminal is usable afterward:
   - Cursor is visible (`reset` should not be needed).
   - Mouse tracking is disabled (no stray mouse highlight/selection).
   - Typing at the shell prompt works normally.
4. Repeat with Ctrl+C (SIGINT) — same verification.
5. Close the terminal window while the app is running (SIGHUP) — same verification.

**Expected:** Terminal restored to a usable state on every exit path. No need to run `reset`.

## 4. Mouse tracking (GNOME / COSMIC / Alacritty / kitty)

**Steps:**
1. Launch interactive UI with mouse enabled (default).
2. Move the mouse over the file checklist — verify hover effects or click handling work.
3. Click a file to toggle selection — verify checkbox changes.
4. Press `q` to quit — verify mouse tracking is disabled afterward (terminal doesn't interpret subsequent clicks as mouse events).
5. Run `./dist/bin/prestron.js --no-mouse <test-dir>` — verify the app works without mouse (keyboard only).
6. Inside tmux with `set -g mouse on`: launch app, click a file, verify passthrough works.

**Expected:** Mouse events are parsed and acted on; after exit, terminal no longer intercepts mouse events; `--no-mouse` runs cleanly.

## 5. Non-interactive CLI commands

**Steps:**
1. `./dist/bin/prestron.js --version` — prints version, exits 0.
2. `./dist/bin/prestron.js scan <test-dir>` — lists detected files, exits 0.
3. `./dist/bin/prestron.js encode --yes <test-dir>` — encodes without interactive prompts.
4. `./dist/bin/prestron.js report <test-dir>` — prints savings report (JSON by default or with `--format text`).
5. `./dist/bin/prestron.js profiles` — lists available encode profiles.

**Expected:** Each command completes with appropriate output and exit code 0.

## 6. Crash recovery

**Steps:**
1. Start an encode on a directory with multiple files.
2. While encoding, kill the process (`kill -9 <pid>` or close terminal).
3. Re-run `./dist/bin/prestron.js <test-dir>`.
4. Verify the startup screen offers to resume pending files.
5. Verify no `.part` files remain in `Prestron-Encoded/` from the killed run.
6. Verify completed outputs from before the crash are not re-encoded.

**Expected:** Orphaned `.part` files cleaned, interrupted jobs reset to pending, completed outputs preserved.

## 7. Instance lock (double-run prevention)

**Steps:**
1. Start an interactive session on a directory.
2. In a second terminal, run `./dist/bin/prestron.js <same-dir>`.
3. Verify the second instance detects the lock and exits with a clear message.
4. Close the first instance.
5. Run the second instance again — it should start normally.

**Expected:** Second instance blocked while first is running; lock released on exit.

## 8. FFmpeg missing or wrong version

**Steps:**
1. Temporarily rename or hide `ffmpeg` from PATH.
2. Run `./dist/bin/prestron.js <test-dir>`.
3. Verify error message is clear ("FFmpeg not found") and exit code is non-zero.
4. Restore FFmpeg and verify normal operation resumes.

**Expected:** Clear error, non-zero exit code, no partial encodes.

## 9. Large file handling

**Steps:**
1. Add a large file (>1 GB) to the test directory.
2. Run encode and verify it completes without disk space issues.
3. Verify output file is in `Prestron-Encoded/` and is playable.

**Expected:** Encode completes, output is valid, no `.part` leftovers.

## 10. Unicode and special characters in filenames

**Steps:**
1. Add files with spaces, unicode characters, and parentheses in names.
2. Run scan and encode.
3. Verify all files are processed correctly, outputs have matching names.

**Expected:** No encoding or filename errors.

---

## Terminal compatibility notes

| Terminal          | Mouse support | Notes                              |
|-------------------|---------------|------------------------------------|
| GNOME Terminal    | Yes           | Default on Pop!_OS / Ubuntu        |
| COSMIC Terminal   | Yes           | Pop!_OS COSMIC default             |
| Alacritty         | Yes           | SGR 1006 supported                 |
| kitty             | Yes           | SGR 1006 supported                 |
| tmux              | Partial       | Requires `set -g mouse on`         |
| VS Code integrated| No            | Use external terminal for mouse    |

## Troubleshooting

- **Terminal garbled after quit:** Run `reset` — this indicates `restoreTerminal()` did not run (see issue with `process.exit()` bypassing cleanup).
- **Mouse events not detected:** Ensure terminal is not inside tmux without `set -g mouse on`; try `--no-mouse` to confirm keyboard path works.
- **FFmpeg not found:** Ensure `ffmpeg` is in PATH or set `PRESTRON_FFMPEG` env var.
