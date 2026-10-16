/**
 * File probe — runs ffprobe and returns a validated MediaInfo object.
 *
 * - Uses the injected ProcessRunner so it is fully testable without a real ffprobe binary.
 * - Applies a configurable timeout (default 30 s).
 * - A failure on one file does not affect other files.
 */

import { basename } from "node:path";
import {
  FfprobeOutputSchema,
  VideoStreamSchema,
  AudioStreamSchema,
  SubtitleStreamSchema,
  type VideoStream,
  type AudioStream,
  type SubtitleStream,
} from "./schemas.js";
import { parseFraction } from "../scanner/episodeParser.js";
import type { ProcessRunner } from "../ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface VideoInfo {
  codec: string;
  profile?: string;
  pixFmt: string;
  /** Bit depth extracted from pix_fmt or bits_per_raw_sample (8 or 10). */
  bitDepth: number;
  width: number;
  height: number;
  /** Frames per second (from r_frame_rate). */
  fps: number;
  /** True when r_frame_rate and avg_frame_rate differ by more than 5%. */
  isVfr: boolean;
  colorTransfer?: string;
  colorPrimaries?: string;
  colorSpace?: string;
  /** True for HDR10 (smpte2084) or HLG (arib-std-b67). */
  isHdr: boolean;
  /** True when Dolby Vision metadata tags are detected. */
  isDolbyVision: boolean;
}

export interface AudioInfo {
  index: number;
  codec: string;
  channels: number;
  /** ISO 639-2/B language code from tags.language. */
  language?: string;
  isDefault: boolean;
}

export interface SubtitleInfo {
  index: number;
  codec: string;
  language?: string;
}

export interface MediaInfo {
  path: string;
  container: string;
  durationSecs: number;
  sizeBytes: number;
  bitrateKbps: number;
  video: VideoInfo;
  audio: AudioInfo[];
  subtitles: SubtitleInfo[];
  attachmentCount: number;
  chapterCount: number;
  tags: Record<string, string>;
}

export interface ProbeOptions {
  /** Milliseconds before the ffprobe call is abandoned. Default: 30 000. */
  timeoutMs?: number;
  /** ffprobe binary name or path. Default: 'ffprobe'. */
  ffprobeBinary?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

function parseBitDepth(pixFmt: string | undefined, bitsPerRawSample: string | undefined): number {
  if (bitsPerRawSample) {
    const n = parseInt(bitsPerRawSample, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  if (pixFmt) {
    if (pixFmt.includes("12")) return 12;
    if (pixFmt.includes("10")) return 10;
  }
  return 8;
}

function parseFps(rFrameRate: string | undefined): number {
  if (!rFrameRate) return 0;
  const fps = parseFraction(rFrameRate);
  return isNaN(fps) ? 0 : Math.round(fps * 1000) / 1000;
}

function detectVfr(rFrameRate: string | undefined, avgFrameRate: string | undefined): boolean {
  if (!rFrameRate || !avgFrameRate) return false;
  const r = parseFraction(rFrameRate);
  const a = parseFraction(avgFrameRate);
  if (isNaN(r) || isNaN(a) || a === 0) return false;
  // VFR when they differ by more than 5%
  return Math.abs(r - a) / a > 0.05;
}

function detectDolbyVision(tags: Record<string, string> | undefined): boolean {
  if (!tags) return false;
  const keys = Object.keys(tags).map((k) => k.toLowerCase());
  return keys.some((k) => k.includes("dovi") || k.includes("dolby_vision"));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Error thrown when probing fails (corrupt file, timeout, parse error). */
export class ProbeError extends Error {
  readonly filePath: string;
  readonly probeCause: unknown;

  constructor(filePath: string, message: string, cause?: unknown) {
    super(`Probe failed for "${basename(filePath)}": ${message}`);
    this.name = "ProbeError";
    this.filePath = filePath;
    this.probeCause = cause;
  }
}

/**
 * Probe a video file using ffprobe.
 *
 * @throws {ProbeError} on timeout, non-zero exit, or invalid JSON.
 */
export async function probeFile(
  filePath: string,
  runner: ProcessRunner,
  options?: ProbeOptions,
): Promise<MediaInfo> {
  const ffprobeBinary = options?.ffprobeBinary ?? "ffprobe";
  const timeoutMs = options?.timeoutMs ?? 30_000;

  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-show_chapters",
    filePath,
  ];

  // Run with timeout via Promise.race
  const runPromise = runner.run(ffprobeBinary, args);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new ProbeError(filePath, `timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    ),
  );

  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    if (err instanceof ProbeError) throw err;
    throw new ProbeError(filePath, "ffprobe execution failed", err);
  }

  if (result.exitCode !== 0) {
    throw new ProbeError(
      filePath,
      `ffprobe exited with code ${String(result.exitCode)}. ${result.stderr.slice(0, 300)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (err) {
    throw new ProbeError(filePath, "ffprobe output is not valid JSON", err);
  }

  const parsed = FfprobeOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProbeError(
      filePath,
      `ffprobe output failed schema validation: ${parsed.error.message}`,
    );
  }

  const data = parsed.data;
  const fmt = data.format;

  // --- Video stream ---
  // Find the first video stream, then re-validate it with the VideoStreamSchema
  // to get precise TypeScript types (the union schema loses narrowing).
  const rawVideoStream = data.streams.find((s) => s.codec_type === "video");
  if (!rawVideoStream) {
    throw new ProbeError(filePath, "no video stream found");
  }
  const vsResult = VideoStreamSchema.safeParse(rawVideoStream);
  if (!vsResult.success) {
    throw new ProbeError(filePath, "video stream failed schema validation");
  }
  const vs: VideoStream = vsResult.data;

  const videoInfo: VideoInfo = {
    codec: vs.codec_name ?? "unknown",
    ...(vs.profile !== undefined ? { profile: vs.profile } : {}),
    pixFmt: vs.pix_fmt ?? "unknown",
    bitDepth: parseBitDepth(vs.pix_fmt, vs.bits_per_raw_sample),
    width: vs.width ?? 0,
    height: vs.height ?? 0,
    fps: parseFps(vs.r_frame_rate),
    isVfr: detectVfr(vs.r_frame_rate, vs.avg_frame_rate),
    ...(vs.color_transfer !== undefined ? { colorTransfer: vs.color_transfer } : {}),
    ...(vs.color_primaries !== undefined ? { colorPrimaries: vs.color_primaries } : {}),
    ...(vs.color_space !== undefined ? { colorSpace: vs.color_space } : {}),
    isHdr: vs.color_transfer !== undefined && HDR_TRANSFERS.has(vs.color_transfer),
    isDolbyVision: detectDolbyVision(vs.tags),
  };

  // --- Audio streams — re-parse each stream with the AudioStreamSchema ---
  const audioInfo: AudioInfo[] = data.streams
    .filter((s) => s.codec_type === "audio")
    .flatMap((s) => {
      const r = AudioStreamSchema.safeParse(s);
      if (!r.success) return [];
      const a: AudioStream = r.data;
      const lang = a.tags?.["language"] ?? a.tags?.["LANGUAGE"];
      return [
        {
          index: a.index,
          codec: a.codec_name ?? "unknown",
          channels: a.channels ?? 2,
          ...(lang !== undefined ? { language: lang } : {}),
          isDefault: a.tags?.["DISPOSITION:default"] === "1",
        },
      ];
    });

  // --- Subtitle streams ---
  const subtitleInfo: SubtitleInfo[] = data.streams
    .filter((s) => s.codec_type === "subtitle")
    .flatMap((s) => {
      const r = SubtitleStreamSchema.safeParse(s);
      if (!r.success) return [];
      const sub: SubtitleStream = r.data;
      const lang = sub.tags?.["language"] ?? sub.tags?.["LANGUAGE"];
      return [
        {
          index: sub.index,
          codec: sub.codec_name ?? "unknown",
          ...(lang !== undefined ? { language: lang } : {}),
        },
      ];
    });

  // --- Attachments ---
  const attachmentCount = data.streams.filter((s) => s.codec_type === "attachment").length;

  // --- Format ---
  const durationSecs = fmt?.duration ? parseFloat(fmt.duration) : 0;
  const sizeBytes = fmt?.size ? parseInt(fmt.size, 10) : 0;
  const bitrateKbps = fmt?.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : 0;
  const container = fmt?.format_name ?? "unknown";
  const tags: Record<string, string> = fmt?.tags ?? {};

  return {
    path: filePath,
    container,
    durationSecs,
    sizeBytes,
    bitrateKbps,
    video: videoInfo,
    audio: audioInfo,
    subtitles: subtitleInfo,
    attachmentCount,
    chapterCount: data.chapters.length,
    tags,
  };
}
