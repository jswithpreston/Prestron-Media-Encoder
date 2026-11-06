/**
 * Zod schemas for validating ffprobe JSON output.
 *
 * All fields are optional where ffprobe may omit them, so a corrupt or
 * minimal file fails gracefully rather than crashing the parser.
 */

import { z } from "zod";

export const VideoStreamSchema = z.object({
  index: z.number(),
  codec_type: z.literal("video"),
  codec_name: z.string().optional(),
  codec_long_name: z.string().optional(),
  profile: z.string().optional(),
  level: z.union([z.number(), z.string()]).optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  display_aspect_ratio: z.string().optional(),
  sample_aspect_ratio: z.string().optional(),
  r_frame_rate: z.string().optional(), // "24000/1001"
  avg_frame_rate: z.string().optional(),
  pix_fmt: z.string().optional(),
  bits_per_raw_sample: z.string().optional(), // ffprobe returns as string
  field_order: z.string().optional(), // "progressive", "tt", "bb", "tb", "bt", "unknown"
  color_range: z.string().optional(), // "tv", "pc"
  color_transfer: z.string().optional(),
  color_primaries: z.string().optional(),
  color_space: z.string().optional(),
  bit_rate: z.string().optional(),
  tags: z.record(z.string()).optional(),
  disposition: z.record(z.union([z.number(), z.string()])).optional(),
  side_data_list: z.array(z.record(z.unknown())).optional(),
});

export const AudioStreamSchema = z.object({
  index: z.number(),
  codec_type: z.literal("audio"),
  codec_name: z.string().optional(),
  codec_long_name: z.string().optional(),
  channels: z.number().optional(),
  channel_layout: z.string().optional(),
  sample_rate: z.string().optional(),
  bit_rate: z.string().optional(),
  tags: z.record(z.string()).optional(),
  disposition: z.record(z.union([z.number(), z.string()])).optional(),
});

export const SubtitleStreamSchema = z.object({
  index: z.number(),
  codec_type: z.literal("subtitle"),
  codec_name: z.string().optional(),
  codec_long_name: z.string().optional(),
  tags: z.record(z.string()).optional(),
  disposition: z.record(z.union([z.number(), z.string()])).optional(),
});

export const AttachmentStreamSchema = z.object({
  index: z.number(),
  codec_type: z.literal("attachment"),
  codec_name: z.string().optional(),
  tags: z.record(z.string()).optional(),
});

// Catch-all for data streams, timecode, etc.
export const OtherStreamSchema = z
  .object({
    index: z.number(),
    codec_type: z.string(),
  })
  .passthrough();

export const StreamSchema = z.union([
  VideoStreamSchema,
  AudioStreamSchema,
  SubtitleStreamSchema,
  AttachmentStreamSchema,
  OtherStreamSchema,
]);

export const ChapterSchema = z
  .object({
    id: z.number().optional(),
    start: z.number().optional(),
    end: z.number().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    tags: z.record(z.string()).optional(),
  })
  .passthrough();

export const FormatSchema = z.object({
  filename: z.string().optional(),
  format_name: z.string().optional(),
  format_long_name: z.string().optional(),
  duration: z.string().optional(), // seconds as decimal string
  size: z.string().optional(), // bytes as decimal string
  bit_rate: z.string().optional(),
  tags: z.record(z.string()).optional(),
});

export const FfprobeOutputSchema = z.object({
  streams: z.array(StreamSchema).default([]),
  chapters: z.array(ChapterSchema).default([]),
  format: FormatSchema.optional(),
});

export type VideoStream = z.infer<typeof VideoStreamSchema>;
export type AudioStream = z.infer<typeof AudioStreamSchema>;
export type SubtitleStream = z.infer<typeof SubtitleStreamSchema>;
export type AttachmentStream = z.infer<typeof AttachmentStreamSchema>;
export type FfprobeOutput = z.infer<typeof FfprobeOutputSchema>;
