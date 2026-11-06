/**
 * Sample encode runner — Tier 3 empirical calibration.
 *
 * Encodes a brief representative segment (e.g. 15-30s from the middle of the file)
 * to a temporary file, measures the exact output size and video compression ratio,
 * records it into encode_history, and cleans up the sample.
 */

import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { unlink, stat } from "node:fs/promises";
import { execa } from "execa";
import type { MediaInfo } from "../probe/index.js";
import type { EncodePlan } from "../policy/planBuilder.js";
import type { FfmpegCapabilities, ProcessRunner } from "./capabilities.js";
import type { JournalStore, EncodeHistoryRecord } from "../jobs/journalStore.js";
import { probeFile } from "../probe/index.js";

const execaRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

export interface SampleEncodeOptions {
  /** Duration of sample in seconds (default: 20s). */
  sampleDurationSecs?: number;
  /** Offset from start in seconds (default: 20% into duration or 60s). */
  startOffsetSecs?: number;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export interface SampleEncodeResult {
  sourcePath: string;
  sampleDurationSecs: number;
  sourceEstimatedSampleBytes: number;
  outputSampleBytes: number;
  measuredCompressionRatio: number;
  measuredVideoCompressionRatio: number;
  encodeSpeed: string;
  encodeTimeMs: number;
}

/**
 * Executes a fast sample encode and records the empirical ratio to the journal store.
 */
export async function runSampleEncode(
  mediaInfo: MediaInfo,
  plan: EncodePlan,
  caps: FfmpegCapabilities,
  store: JournalStore,
  options?: SampleEncodeOptions,
): Promise<SampleEncodeResult> {
  const sampleDuration = options?.sampleDurationSecs ?? 20;
  const startOffset = options?.startOffsetSecs ?? Math.max(0, Math.min(mediaInfo.durationSecs * 0.2, mediaInfo.durationSecs - sampleDuration - 5));
  const ffmpeg = options?.ffmpegPath ?? "ffmpeg";
  const ffprobe = options?.ffprobePath ?? "ffprobe";

  const tempOutputFile = join(tmpdir(), `prestron-sample-${randomUUID()}.mkv`);

  // Build sample encoding args
  const args: string[] = [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-ss",
    startOffset.toFixed(1),
    "-i",
    mediaInfo.path,
    "-t",
    String(sampleDuration),
    "-map",
    "0",
    "-map",
    "-0:d",
    "-c:a",
    "copy",
    "-c:s",
    "copy",
    "-c:t",
    "copy",
  ];

  if (plan.videoAction === "encode") {
    args.push("-c:v", plan.profile.codec, "-crf", String(plan.profile.crf));
    args.push("-preset", plan.profile.preset, "-pix_fmt", plan.profile.pixFmt);
    if (plan.profile.x265Params) {
      args.push("-x265-params", plan.profile.x265Params);
    }
  } else {
    args.push("-c:v", "copy");
  }

  args.push("-f", "matroska", tempOutputFile);

  const startTime = Date.now();
  try {
    await execa(ffmpeg, args, { timeout: 120_000 });
    const encodeTimeMs = Date.now() - startTime;

    // Check output file size
    const fileStat = await stat(tempOutputFile);
    const outputSampleBytes = fileStat.size;

    // Probe sample to measure actual video stream bytes
    const sampleProbe = await probeFile(tempOutputFile, execaRunner, { ffprobeBinary: ffprobe });
    const sampleVideoBytes = Math.max(0, outputSampleBytes - sampleProbe.nonVideoSizeBytes);

    // Calculate source sample estimated video bytes
    const sourceVideoBitrateBps = (mediaInfo.video.bitrateKbps * 1000) / 8;
    const sourceSampleVideoBytes = Math.max(1, sourceVideoBitrateBps * sampleDuration);
    const sourceSampleTotalBytes = sourceSampleVideoBytes + ((mediaInfo.nonVideoSizeBytes / mediaInfo.durationSecs) * sampleDuration);

    const measuredCompressionRatio = Number((outputSampleBytes / sourceSampleTotalBytes).toFixed(3));
    const measuredVideoCompressionRatio = Number((sampleVideoBytes / sourceSampleVideoBytes).toFixed(3));

    // Record into journal history
    const historyRecord: EncodeHistoryRecord = {
      sourcePath: mediaInfo.path,
      sourceSizeBytes: mediaInfo.sizeBytes,
      outputSizeBytes: Math.round(mediaInfo.sizeBytes * measuredCompressionRatio),
      sourceCodec: mediaInfo.video.codec,
      targetCodec: plan.profile.codec,
      profileName: plan.profile.name,
      crf: plan.profile.crf,
      preset: plan.profile.preset,
      bpp: mediaInfo.video.bpp,
      durationSecs: sampleDuration,
      encodeDurationMs: encodeTimeMs,
      compressionRatio: measuredCompressionRatio,
      videoCompressionRatio: measuredVideoCompressionRatio,
      timestamp: Date.now(),
    };

    store.recordEncodeHistory(historyRecord);

    return {
      sourcePath: mediaInfo.path,
      sampleDurationSecs: sampleDuration,
      sourceEstimatedSampleBytes: Math.round(sourceSampleTotalBytes),
      outputSampleBytes,
      measuredCompressionRatio,
      measuredVideoCompressionRatio,
      encodeSpeed: `${((sampleDuration / (encodeTimeMs / 1000))).toFixed(2)}x`,
      encodeTimeMs,
    };
  } finally {
    try {
      await unlink(tempOutputFile);
    } catch {
      // Ignored if already cleaned up or does not exist
    }
  }
}
