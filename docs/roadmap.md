# Roadmap

This document lists features that are **out of scope for v1** but are planned or considered
for future releases. Each item has a clean extension point in the existing code.

## v2 candidates

### Quality and encoding

- **Sample encodes and VMAF scoring** — encode a short representative sample, score it with
  VMAF, and use that to suggest an optimal CRF per file. Extension point: `src/core/policy/planBuilder.ts`.

- **Automatic CRF calibration** — automatically find the lowest CRF that meets a target VMAF
  score. Extension point: same as above.

- **Hardware encoders** — NVENC (NVIDIA), VAAPI (Intel/AMD on Linux), QSV (Intel Quick Sync).
  Extension point: `src/core/ffmpeg/capabilities.ts` (hardware capability detection) and
  `src/core/ffmpeg/argBuilder.ts` (codec flag variants).

- **AV1 output** — encode to AV1 (libsvtav1 or libaom-av1). Extension point: profile
  definitions in `src/core/policy/profiles.ts`.

- **H.264 fallback** — for compatibility with older devices. Same extension point.

- **HDR10 static metadata re-injection** — copy HDR10 MaxCLL/MaxFALL from source and inject
  into the output. Extension point: `src/core/ffmpeg/argBuilder.ts` and `src/core/verify/index.ts`.

- **Dolby Vision RPU re-injection** — extract and re-inject the Dolby Vision RPU side-data.
  Requires `dovi_tool` or `mp4box`. Extension point: same as HDR10, plus a new optional
  dependency check in `src/core/ffmpeg/capabilities.ts`.

### Resume and recovery

- **Mid-file resume** — resume an interrupted encode from the point of interruption using
  `-ss` / `-t` segment splitting. Extension point: `src/core/jobs/batchRunner.ts`.

### Media management

- **TMDB / TVDB metadata lookup** — enrich file metadata (title, year, episode info) from
  online databases. Extension point: `src/core/probe/index.ts` and `src/core/naming/index.ts`.

- **Watch mode** — monitor a folder for new files and encode them automatically. Extension
  point: new `src/core/watcher/` module.

### Additional sub-commands

- `prestron remux [path]` — remux to MKV without re-encoding.
- `prestron extract-audio [path]` — extract audio streams.
- `prestron extract-subtitles [path]` — extract subtitle streams.
- `prestron thumbnail [path]` — generate preview thumbnails.
- `prestron promote [path]` — replace originals with verified outputs (destructive, opt-in).

### Output options

- **Visible watermark** — burn a text watermark into the video stream.
- **Configurable output container** — MP4 for broader device compatibility.

### Developer / infrastructure

- **Docker image** — a pre-built image with FFmpeg, Node.js, and `prestron` for reproducible
  server-side encoding.
- **Programmatic public API** — a stable, versioned, documented API surface for use as a library.

## Known limitations in v1

- HDR10 static metadata (MaxCLL, MaxFALL) and Dolby Vision RPU are **not re-injected** in v1.
  A warning is shown for HDR sources but color signaling (transfer, primaries, space) is preserved.
- **No mid-file resume** — interrupted encodes restart from the beginning.
- **No hardware encoding** — all encoding is CPU-based (libx265 software encoder).
- **No TMDB/TVDB lookup** — classification uses filename and folder signals only.
- **Output is MKV only** in v1. MP4 may be added in v2 once subtitle compatibility is validated.
