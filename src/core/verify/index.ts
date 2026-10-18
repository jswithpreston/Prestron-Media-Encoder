/**
 * Output verifier — validates an encoded .part file before it is promoted
 * to the final output path.
 *
 * Runs a series of checks in order and returns on the first failure so the
 * caller can report precisely which check failed.
 */

import { stat } from "node:fs/promises";
import { probeFile, type ChapterInfo } from "../probe/index.js";
import type { ProcessRunner } from "../ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  /** Source file duration in seconds (from ffprobe). */
  sourceDurationSecs: number;
  /** Number of audio streams in the source. */
  sourceAudioCount: number;
  /** Number of subtitle streams in the source. */
  sourceSubtitleCount: number;
  /** Number of chapters in the source. */
  sourceChapterCount: number;
  /** Optional source chapters with timestamps for tolerance checking. */
  sourceChapters?: ChapterInfo[] | undefined;
  /** Whether the source has HDR signaling. */
  sourceIsHdr: boolean;
  /** Source video width. */
  sourceWidth: number;
  /** Source video height. */
  sourceHeight: number;
}

export interface VerifyResult {
  ok: boolean;
  failedCheck?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Verify a .part output file before promotion to final path.
 *
 * Checks (in order):
 *  1. File exists and size > 0
 *  2. ffprobe succeeds on the output
 *  3. Video stream present
 *  4. Resolution unchanged (width & height match)
 *  5. Audio stream count matches sourceAudioCount
 *  6. Subtitle stream count matches sourceSubtitleCount
 *  7. Chapter count matches sourceChapterCount
 *  8. Duration within tolerance: |outDuration - srcDuration| <= max(1.5, srcDuration * 0.005)
 *  9. HDR signaling not lost when sourceIsHdr
 * 10. Decode test: ffmpeg -v error -nostdin -i <file> -f null - exits 0 with empty stderr
 */
export async function verifyOutput(
  partFilePath: string,
  runner: ProcessRunner,
  opts: VerifyOptions,
  ffprobeBinary = "ffprobe",
  ffmpegBinary = "ffmpeg",
): Promise<VerifyResult> {
  // --- Check 1: file exists and size > 0 ---
  try {
    const fileStat = await stat(partFilePath);
    if (fileStat.size === 0) {
      return { ok: false, failedCheck: "file-size-zero" };
    }
  } catch {
    return { ok: false, failedCheck: "file-not-found" };
  }

  // --- Check 2: ffprobe succeeds ---
  let outInfo;
  try {
    outInfo = await probeFile(partFilePath, runner, { ffprobeBinary });
  } catch {
    return { ok: false, failedCheck: "ffprobe-failed" };
  }

  // --- Check 3: video stream present ---
  if (outInfo.video.codec === "unknown") {
    return { ok: false, failedCheck: "no-video-stream" };
  }

  // --- Check 4: resolution unchanged ---
  if (outInfo.video.width !== opts.sourceWidth || outInfo.video.height !== opts.sourceHeight) {
    return { ok: false, failedCheck: "resolution-mismatch" };
  }

  // --- Check 5: audio stream count ---
  if (outInfo.audio.length !== opts.sourceAudioCount) {
    return { ok: false, failedCheck: "audio-count-mismatch" };
  }

  // --- Check 6: subtitle stream count ---
  if (outInfo.subtitles.length !== opts.sourceSubtitleCount) {
    return { ok: false, failedCheck: "subtitle-count-mismatch" };
  }

  // --- Check 7: chapter count ---
  if (outInfo.chapterCount !== opts.sourceChapterCount) {
    return { ok: false, failedCheck: "chapter-count-mismatch" };
  }

  // --- Check 7b: chapter timestamps within 100 ms tolerance ---
  if (opts.sourceChapters && opts.sourceChapters.length > 0) {
    const CHAPTER_TOLERANCE_SECS = 0.1;
    for (let i = 0; i < opts.sourceChapters.length; i++) {
      const srcChap = opts.sourceChapters[i];
      const outChap = outInfo.chapters[i];
      if (!srcChap || !outChap) {
        return { ok: false, failedCheck: "chapter-timestamp-mismatch" };
      }
      if (
        Math.abs(outChap.startTimeSecs - srcChap.startTimeSecs) > CHAPTER_TOLERANCE_SECS ||
        Math.abs(outChap.endTimeSecs - srcChap.endTimeSecs) > CHAPTER_TOLERANCE_SECS
      ) {
        return { ok: false, failedCheck: "chapter-timestamp-mismatch" };
      }
    }
  }

  // --- Check 8: duration within tolerance ---
  const srcDur = opts.sourceDurationSecs;
  const outDur = outInfo.durationSecs;
  const tolerance = Math.max(1.5, srcDur * 0.005);
  if (Math.abs(outDur - srcDur) > tolerance) {
    return { ok: false, failedCheck: "duration-mismatch" };
  }

  // --- Check 9: HDR not lost ---
  if (opts.sourceIsHdr && !outInfo.video.isHdr) {
    return { ok: false, failedCheck: "hdr-lost" };
  }

  // --- Check 10: decode test ---
  let decodeResult: { stdout: string; stderr: string; exitCode: number };
  try {
    decodeResult = await runner.run(ffmpegBinary, [
      "-v",
      "error",
      "-nostdin",
      "-i",
      partFilePath,
      "-f",
      "null",
      "-",
    ]);
  } catch {
    return { ok: false, failedCheck: "decode-test-failed" };
  }

  if (decodeResult.exitCode !== 0 || decodeResult.stderr.trim() !== "") {
    return { ok: false, failedCheck: "decode-test-failed" };
  }

  return { ok: true };
}
