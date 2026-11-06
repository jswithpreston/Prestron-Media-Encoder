/**
 * File probe — runs ffprobe and returns a rich, validated MediaInfo object.
 *
 * Features:
 *   - Video stream metrics: codec, profile, level, bit depth, SAR/DAR, fps, VFR flag,
 *     field order (progressive/interlaced), color metadata, HDR/Dolby Vision detection,
 *     video bitrate (stream or derived), rotation side data, and bits-per-pixel (bpp).
 *   - Per-stream audio details: codec, channels, layout, sample rate, bitrate, title, language, default/forced.
 *   - Per-stream subtitle details: codec, text vs bitmap classification, title, language, default/forced.
 *   - Non-video size computation (audio + subtitles + attachments + container overhead).
 *   - Opt-in deep interlace check via ffmpeg idet filter (--deep).
 */

import { basename } from "node:path";
import {
  FfprobeOutputSchema,
  VideoStreamSchema,
  AudioStreamSchema,
  SubtitleStreamSchema,
  AttachmentStreamSchema,
  type VideoStream,
  type AudioStream,
  type SubtitleStream,
  type AttachmentStream,
} from "./schemas.js";
import { parseFraction } from "../scanner/episodeParser.js";
import type { ProcessRunner } from "../ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type FieldOrder = "progressive" | "interlaced" | "unknown";
export type SubtitleFormatType = "text" | "bitmap" | "unknown";

export interface VideoInfo {
  codec: string;
  profile?: string | undefined;
  level?: string | number | undefined;
  pixFmt: string;
  /** Bit depth extracted from pix_fmt or bits_per_raw_sample (8, 10, 12). */
  bitDepth: number;
  width: number;
  height: number;
  dar?: string | undefined;
  sar?: string | undefined;
  /** Frames per second (from r_frame_rate). */
  fps: number;
  /** Average frames per second (from avg_frame_rate). */
  avgFps: number;
  /** True when r_frame_rate and avg_frame_rate differ by more than 5%. */
  isVfr: boolean;
  /** Field order: progressive, interlaced, or unknown. */
  fieldOrder: FieldOrder;
  colorRange?: string | undefined;
  colorTransfer?: string | undefined;
  colorPrimaries?: string | undefined;
  colorSpace?: string | undefined;
  /** True for HDR10 (smpte2084) or HLG (arib-std-b67). */
  isHdr: boolean;
  hdrFormat?: "HDR10" | "HLG" | "Dolby Vision" | undefined;
  /** True when Dolby Vision metadata tags or side data are detected. */
  isDolbyVision: boolean;
  /** Video bitrate in kbps. Either from stream metadata or derived from size and duration. */
  bitrateKbps: number;
  /** True if video bitrate was calculated rather than directly reported by stream. */
  isBitrateDerived: boolean;
  /** Display rotation in degrees (from side data or matrix). */
  rotation?: number | undefined;
  /** Bits per pixel per frame (primary compression density metric). */
  bpp: number;
}

export interface AudioInfo {
  index: number;
  codec: string;
  channels: number;
  channelLayout?: string | undefined;
  sampleRateHz?: number | undefined;
  bitrateKbps?: number | undefined;
  language?: string | undefined;
  title?: string | undefined;
  isDefault: boolean;
  isForced: boolean;
}

export interface SubtitleInfo {
  index: number;
  codec: string;
  formatType: SubtitleFormatType;
  language?: string | undefined;
  title?: string | undefined;
  isDefault: boolean;
  isForced: boolean;
}

export interface AttachmentInfo {
  index: number;
  filename?: string | undefined;
  mimetype?: string | undefined;
}

export interface ChapterInfo {
  id?: number | undefined;
  startTimeSecs: number;
  endTimeSecs: number;
  title?: string | undefined;
}

export interface MediaInfo {
  path: string;
  container: string;
  containerLongName?: string | undefined;
  durationSecs: number;
  sizeBytes: number;
  overallBitrateKbps: number;
  /** Backwards-compatible alias for overallBitrateKbps. */
  bitrateKbps: number;
  video: VideoInfo;
  audio: AudioInfo[];
  subtitles: SubtitleInfo[];
  attachments: AttachmentInfo[];
  attachmentCount: number;
  chapterCount: number;
  chapters: ChapterInfo[];
  tags: Record<string, string>;
  encoderTag?: string | undefined;
  /** Non-video bytes: audio + subs + attachments + overhead (does not shrink on video encode). */
  nonVideoSizeBytes: number;
}

export interface ProbeOptions {
  /** Milliseconds before the ffprobe call is abandoned. Default: 30 000. */
  timeoutMs?: number | undefined;
  /** ffprobe binary name or path. Default: 'ffprobe'. */
  ffprobeBinary?: string | undefined;
  /** ffmpeg binary name or path (used if deepCheck is enabled). */
  ffmpegBinary?: string | undefined;
  /** Run opt-in idet interlace check on a 5-second sample when field_order is unknown. */
  deepCheck?: boolean | undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

const BITMAP_SUBTITLE_CODECS = new Set([
  "hdmv_pgs_subtitle",
  "dvd_subtitle",
  "dvdsub",
  "pgssub",
  "xsub",
]);

const TEXT_SUBTITLE_CODECS = new Set([
  "subrip",
  "srt",
  "ass",
  "ssa",
  "webvtt",
  "vtt",
  "mov_text",
  "text",
]);

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

function detectFieldOrder(fieldOrder: string | undefined): FieldOrder {
  if (!fieldOrder || fieldOrder === "unknown") return "unknown";
  if (fieldOrder === "progressive") return "progressive";
  if (["tt", "bb", "tb", "bt"].includes(fieldOrder)) return "interlaced";
  return "unknown";
}

function detectDolbyVision(vs: VideoStream): boolean {
  if (vs.tags) {
    const tagKeys = Object.keys(vs.tags).map((k) => k.toLowerCase());
    if (tagKeys.some((k) => k.includes("dovi") || k.includes("dolby_vision"))) {
      return true;
    }
  }
  if (vs.side_data_list) {
    for (const item of vs.side_data_list) {
      const raw = item["side_data_type"];
      if (typeof raw === "string") {
        const type = raw.toLowerCase();
        if (type.includes("dovi") || type.includes("dolby vision")) {
          return true;
        }
      }
    }
  }
  return false;
}

function detectRotation(vs: VideoStream): number | undefined {
  if (vs.side_data_list) {
    for (const item of vs.side_data_list) {
      if (typeof item["rotation"] === "number") {
        return item["rotation"];
      }
    }
  }
  if (vs.tags?.["rotate"]) {
    const rot = parseInt(vs.tags["rotate"], 10);
    if (!isNaN(rot)) return rot;
  }
  return undefined;
}

function classifySubtitleType(codec: string): SubtitleFormatType {
  const lower = codec.toLowerCase();
  if (BITMAP_SUBTITLE_CODECS.has(lower)) return "bitmap";
  if (TEXT_SUBTITLE_CODECS.has(lower)) return "text";
  return "unknown";
}

export function computeBpp(videoBitrateKbps: number, width: number, height: number, fps: number): number {
  if (width <= 0 || height <= 0 || fps <= 0 || videoBitrateKbps <= 0) {
    return 0;
  }
  const bitsPerSecond = videoBitrateKbps * 1000;
  const pixelsPerSecond = width * height * fps;
  const bpp = bitsPerSecond / pixelsPerSecond;
  return Math.round(bpp * 10000) / 10000;
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

  // --- Format ---
  const durationSecs = fmt?.duration ? parseFloat(fmt.duration) : 0;
  const sizeBytes = fmt?.size ? parseInt(fmt.size, 10) : 0;
  const overallBitrateKbps = fmt?.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : 0;
  const container = fmt?.format_name ?? "unknown";
  const containerLongName = fmt?.format_long_name;
  const tags: Record<string, string> = fmt?.tags ?? {};
  const encoderTag = tags["ENCODER"] ?? tags["encoder"] ?? tags["encoded_by"] ?? tags["ENCODED_BY"];

  // --- Video stream ---
  const rawVideoStream = data.streams.find((s) => s.codec_type === "video");
  if (!rawVideoStream) {
    throw new ProbeError(filePath, "no video stream found");
  }
  const vsResult = VideoStreamSchema.safeParse(rawVideoStream);
  if (!vsResult.success) {
    throw new ProbeError(filePath, "video stream failed schema validation");
  }
  const vs: VideoStream = vsResult.data;

  const fps = parseFps(vs.r_frame_rate);
  const avgFps = parseFps(vs.avg_frame_rate);
  const width = vs.width ?? 0;
  const height = vs.height ?? 0;
  const isVfr = detectVfr(vs.r_frame_rate, vs.avg_frame_rate);

  // Field order / interlacing
  let fieldOrder = detectFieldOrder(vs.field_order);

  // Opt-in deep interlace check via idet filter
  if (options?.deepCheck && fieldOrder === "unknown" && options.ffmpegBinary) {
    try {
      const idetRes = await runner.run(options.ffmpegBinary, [
        "-nostdin",
        "-i",
        filePath,
        "-t",
        "5",
        "-filter:v",
        "idet",
        "-f",
        "null",
        "-",
      ]);
      const match = /Multi frame detection: TFF:\s*(\d+)\s*BFF:\s*(\d+)\s*Progressive:\s*(\d+)/i.exec(
        idetRes.stderr,
      );
      if (match) {
        const tff = parseInt(match[1] ?? "0", 10);
        const bff = parseInt(match[2] ?? "0", 10);
        const prog = parseInt(match[3] ?? "0", 10);
        if (prog > 2 * (tff + bff)) {
          fieldOrder = "progressive";
        } else if (tff + bff > prog) {
          fieldOrder = "interlaced";
        }
      }
    } catch {
      // Ignore idet errors and leave fieldOrder as-is
    }
  }

  // HDR & Dolby Vision
  const isDovi = detectDolbyVision(vs);
  const isHdrTransfer = vs.color_transfer !== undefined && HDR_TRANSFERS.has(vs.color_transfer);
  const isHdr = isHdrTransfer || isDovi;
  const hdrFormat: "HDR10" | "HLG" | "Dolby Vision" | undefined = isDovi
    ? "Dolby Vision"
    : vs.color_transfer === "smpte2084"
      ? "HDR10"
      : vs.color_transfer === "arib-std-b67"
        ? "HLG"
        : undefined;

  // Video stream bitrate (stream reported or derived)
  let videoBitrateKbps = 0;
  let isBitrateDerived = false;
  if (vs.bit_rate) {
    const rawBr = parseInt(vs.bit_rate, 10);
    if (!isNaN(rawBr) && rawBr > 0) {
      videoBitrateKbps = Math.round(rawBr / 1000);
    }
  }

  // --- Audio streams ---
  let totalAudioBitrateKbps = 0;
  const audioInfo: AudioInfo[] = data.streams
    .filter((s) => s.codec_type === "audio")
    .flatMap((s) => {
      const r = AudioStreamSchema.safeParse(s);
      if (!r.success) return [];
      const a: AudioStream = r.data;
      const lang = a.tags?.["language"] ?? a.tags?.["LANGUAGE"];
      const title = a.tags?.["title"] ?? a.tags?.["TITLE"];
      const isDefault = a.disposition?.["default"] === 1 || a.disposition?.["default"] === "1";
      const isForced = a.disposition?.["forced"] === 1 || a.disposition?.["forced"] === "1";
      const sampleRateHz = a.sample_rate ? parseInt(a.sample_rate, 10) : undefined;
      let bitrateKbps: number | undefined;
      if (a.bit_rate) {
        const br = parseInt(a.bit_rate, 10);
        if (!isNaN(br) && br > 0) {
          bitrateKbps = Math.round(br / 1000);
          totalAudioBitrateKbps += bitrateKbps;
        }
      }

      return [
        {
          index: a.index,
          codec: a.codec_name ?? "unknown",
          channels: a.channels ?? 2,
          ...(a.channel_layout !== undefined ? { channelLayout: a.channel_layout } : {}),
          ...(sampleRateHz !== undefined && !isNaN(sampleRateHz) ? { sampleRateHz } : {}),
          ...(bitrateKbps !== undefined ? { bitrateKbps } : {}),
          ...(lang !== undefined ? { language: lang } : {}),
          ...(title !== undefined ? { title } : {}),
          isDefault,
          isForced,
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
      const title = sub.tags?.["title"] ?? sub.tags?.["TITLE"];
      const isDefault = sub.disposition?.["default"] === 1 || sub.disposition?.["default"] === "1";
      const isForced = sub.disposition?.["forced"] === 1 || sub.disposition?.["forced"] === "1";
      const codec = sub.codec_name ?? "unknown";

      return [
        {
          index: sub.index,
          codec,
          formatType: classifySubtitleType(codec),
          ...(lang !== undefined ? { language: lang } : {}),
          ...(title !== undefined ? { title } : {}),
          isDefault,
          isForced,
        },
      ];
    });

  // --- Attachments ---
  const attachments: AttachmentInfo[] = data.streams
    .filter((s) => s.codec_type === "attachment")
    .map((s) => {
      const r = AttachmentStreamSchema.safeParse(s);
      if (!r.success) return { index: s.index };
      const att: AttachmentStream = r.data;
      const filename = att.tags?.["filename"] ?? att.tags?.["FILENAME"];
      const mimetype = att.tags?.["mimetype"] ?? att.tags?.["MIMETYPE"];
      return {
        index: att.index,
        ...(filename !== undefined ? { filename } : {}),
        ...(mimetype !== undefined ? { mimetype } : {}),
      };
    });

  // If video bitrate was missing from stream metadata, derive from container minus audio
  if (videoBitrateKbps === 0) {
    if (overallBitrateKbps > 0) {
      videoBitrateKbps = Math.max(100, overallBitrateKbps - totalAudioBitrateKbps);
      isBitrateDerived = true;
    } else if (durationSecs > 0 && sizeBytes > 0) {
      const totalKbps = Math.round((sizeBytes * 8) / (durationSecs * 1000));
      videoBitrateKbps = Math.max(100, totalKbps - totalAudioBitrateKbps);
      isBitrateDerived = true;
    }
  }

  const bpp = computeBpp(videoBitrateKbps, width, height, fps || avgFps || 24);

  // Compute non-video bytes (audio + subs + attachments + overhead)
  let nonVideoSizeBytes = 0;
  if (totalAudioBitrateKbps > 0 && durationSecs > 0) {
    nonVideoSizeBytes = Math.round((totalAudioBitrateKbps * 1000 * durationSecs) / 8);
    // Add container overhead (approx 1.5% of total size or 2MB)
    nonVideoSizeBytes += Math.round(sizeBytes * 0.015);
  } else if (videoBitrateKbps > 0 && durationSecs > 0) {
    const videoBytes = Math.round((videoBitrateKbps * 1000 * durationSecs) / 8);
    nonVideoSizeBytes = Math.max(0, sizeBytes - videoBytes);
  }
  // Ensure nonVideoSizeBytes does not exceed sizeBytes
  nonVideoSizeBytes = Math.min(sizeBytes, Math.max(0, nonVideoSizeBytes));

  const videoInfo: VideoInfo = {
    codec: vs.codec_name ?? "unknown",
    ...(vs.profile !== undefined ? { profile: vs.profile } : {}),
    ...(vs.level !== undefined ? { level: vs.level } : {}),
    pixFmt: vs.pix_fmt ?? "unknown",
    bitDepth: parseBitDepth(vs.pix_fmt, vs.bits_per_raw_sample),
    width,
    height,
    ...(vs.display_aspect_ratio !== undefined ? { dar: vs.display_aspect_ratio } : {}),
    ...(vs.sample_aspect_ratio !== undefined ? { sar: vs.sample_aspect_ratio } : {}),
    fps,
    avgFps,
    isVfr,
    fieldOrder,
    ...(vs.color_range !== undefined ? { colorRange: vs.color_range } : {}),
    ...(vs.color_transfer !== undefined ? { colorTransfer: vs.color_transfer } : {}),
    ...(vs.color_primaries !== undefined ? { colorPrimaries: vs.color_primaries } : {}),
    ...(vs.color_space !== undefined ? { colorSpace: vs.color_space } : {}),
    isHdr,
    ...(hdrFormat !== undefined ? { hdrFormat } : {}),
    isDolbyVision: isDovi,
    bitrateKbps: videoBitrateKbps,
    isBitrateDerived,
    ...(detectRotation(vs) !== undefined ? { rotation: detectRotation(vs) } : {}),
    bpp,
  };

  // --- Chapters ---
  const chapters: ChapterInfo[] = data.chapters.map((ch) => {
    const startTimeSecs = ch.start_time ? parseFloat(ch.start_time) : (ch.start ?? 0);
    const endTimeSecs = ch.end_time ? parseFloat(ch.end_time) : (ch.end ?? 0);
    const title = ch.tags?.["title"] ?? ch.tags?.["TITLE"];
    return {
      ...(ch.id !== undefined ? { id: ch.id } : {}),
      startTimeSecs,
      endTimeSecs,
      ...(title !== undefined ? { title } : {}),
    };
  });

  return {
    path: filePath,
    container,
    ...(containerLongName !== undefined ? { containerLongName } : {}),
    durationSecs,
    sizeBytes,
    overallBitrateKbps,
    bitrateKbps: overallBitrateKbps,
    video: videoInfo,
    audio: audioInfo,
    subtitles: subtitleInfo,
    attachments,
    attachmentCount: attachments.length,
    chapterCount: data.chapters.length,
    chapters,
    tags,
    ...(encoderTag !== undefined ? { encoderTag } : {}),
    nonVideoSizeBytes,
  };
}
