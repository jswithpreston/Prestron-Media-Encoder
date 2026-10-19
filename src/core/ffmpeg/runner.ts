/**
 * FFmpeg encode runner.
 *
 * Spawns ffmpeg via execa (never via shell), streams -progress output,
 * supports graceful cancellation via AbortSignal (SIGTERM → wait 5 s → SIGKILL),
 * and cleans up the .part file on abort.
 *
 * The `-progress pipe:1` flag is injected just before the output file argument
 * (i.e. just before the last element of the args array).
 */

import { execa } from "execa";
import { unlink, stat } from "node:fs/promises";
import { ProgressParser, type EncodeProgress } from "./progressParser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncodeRunOptions {
  /** Called for each parsed progress frame. */
  onProgress?: ((p: EncodeProgress) => void) | undefined;
  /** Abort to cancel the encode (SIGTERM → 5 s → SIGKILL + .part cleanup). */
  signal?: AbortSignal | undefined;
  /** Override the ffmpeg binary path. Default: "ffmpeg". */
  ffmpegBinary?: string | undefined;
  /** Source duration in seconds, used to compute percentDone. */
  sourceDurationSecs?: number | undefined;
  /** Called synchronously right after the ffmpeg child is spawned, with its PID.
   * Allows the caller to record the PID for orphan-process cleanup on kill -9. */
  onChildStart?: ((pid: number) => void) | undefined;
}

export interface EncodeResult {
  ok: boolean;
  exitCode: number;
  durationMs: number;
  /** Size of the output .part file after encode, 0 if not found. */
  outputSizeBytes: number;
  /** PID of the ffmpeg child process (for orphan cleanup on kill -9). */
  ffmpegPid: number;
  /** Last stderr lines (for error reporting). */
  error?: string | undefined;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Run ffmpeg with the given argument array.
 *
 * @param args   The full arg array as produced by buildArgs() — must end with
 *               the .part file path. The runner inserts `-progress pipe:1`
 *               just before the last argument.
 * @param opts   Optional progress callback, abort signal, and binary override.
 */
export async function runEncode(args: string[], opts?: EncodeRunOptions): Promise<EncodeResult> {
  const ffmpegBinary = opts?.ffmpegBinary ?? "ffmpeg";
  const sourceDurationSecs = opts?.sourceDurationSecs ?? 0;

  // The last arg is always the .part output path. Insert -progress pipe:1 before it.
  const partFilePath = args[args.length - 1] ?? "";
  const finalArgs = [...args.slice(0, args.length - 1), "-progress", "pipe:1", partFilePath];

  const parser = new ProgressParser(sourceDurationSecs);
  const startMs = Date.now();

  // execa with reject:false so we handle the exit code ourselves.
  // stdout is piped for progress; stderr is piped for error capture.
  const child = execa(ffmpegBinary, finalArgs, {
    reject: false,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Report the child PID synchronously so the caller can record it for
  // orphan-process cleanup (kill -9 recovery).
  if (opts?.onChildStart) {
    opts.onChildStart(child.pid ?? 0);
  }

  // Wire up abort signal → SIGTERM → SIGKILL
  const abortHandler = () => {
    void (async () => {
      try {
        child.kill("SIGTERM");
        await new Promise<void>((res) => setTimeout(res, 5_000));
        child.kill("SIGKILL");
      } catch {
        // Process may already be gone — ignore
      }
    })();
  };
  if (opts?.signal) {
    opts.signal.addEventListener("abort", abortHandler, { once: true });
  }

  // Stream stdout → progress parser
  child.stdout.on("data", (chunk: Buffer) => {
    const frames = parser.feed(chunk.toString("utf8"));
    if (opts?.onProgress) {
      for (const frame of frames) {
        opts.onProgress(frame);
      }
    }
  });

  // Collect stderr for error reporting (keep last 4 KB)
  const stderrChunks: string[] = [];
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk.toString("utf8"));
    // Keep total stderr bounded at ~4 KB
    const total = stderrChunks.reduce((n, s) => n + s.length, 0);
    while (stderrChunks.length > 1 && total > 4096) {
      stderrChunks.shift();
    }
  });

  let result: Awaited<typeof child>;
  const ffmpegPid = child.pid ?? 0;
  try {
    result = await child;
  } finally {
    if (opts?.signal) {
      opts.signal.removeEventListener("abort", abortHandler);
    }
  }

  const durationMs = Date.now() - startMs;
  const exitCode = result.exitCode ?? 1;
  const wasAborted = opts?.signal?.aborted ?? false;

  // Clean up .part file on abort or non-zero exit
  if (wasAborted || exitCode !== 0) {
    try {
      await unlink(partFilePath);
    } catch {
      // File may not exist — ignore
    }
  }

  // Get output size if the file still exists
  let outputSizeBytes = 0;
  try {
    const s = await stat(partFilePath);
    outputSizeBytes = s.size;
  } catch {
    // File was deleted (abort/failure) or never created
  }

  const errorText =
    stderrChunks.join("").trim() ||
    (result.failed ? (result.shortMessage ?? "Process failed") : "");

  return {
    ok: exitCode === 0 && !wasAborted,
    exitCode,
    durationMs,
    outputSizeBytes,
    ffmpegPid,
    ...(errorText ? { error: errorText } : {}),
  };
}
