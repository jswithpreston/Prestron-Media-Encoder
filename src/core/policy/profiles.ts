/**
 * Encoding profiles — defined as zod-validated data, not hardcoded logic.
 *
 * All profiles target libx265 with 10-bit output (yuv420p10le) to minimise
 * banding. x265 extra params are per-profile; see docs/profiles.md for rationale.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Preset enum
// ---------------------------------------------------------------------------

export const PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;

export type Preset = (typeof PRESETS)[number];

// ---------------------------------------------------------------------------
// Profile schema
// ---------------------------------------------------------------------------

export const ProfileSchema = z.object({
  name: z.enum(["movie", "series", "anime", "conservative"]),
  codec: z.literal("libx265"),
  crf: z.number().int().min(0).max(51),
  preset: z.enum(PRESETS),
  x265Params: z.string().optional(),
  pixFmt: z.literal("yuv420p10le"),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type ProfileName = Profile["name"] | "auto";

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

/**
 * All built-in profiles, keyed by name.
 * These objects are frozen — never mutate them.
 * planBuilder clones and overrides when crfOverride/presetOverride is set.
 */
export const PROFILES: Record<Exclude<ProfileName, "auto">, Profile> = {
  movie: ProfileSchema.parse({
    name: "movie",
    codec: "libx265",
    crf: 21,
    preset: "medium",
    x265Params: "aq-mode=3",
    pixFmt: "yuv420p10le",
  }),

  series: ProfileSchema.parse({
    name: "series",
    codec: "libx265",
    crf: 22,
    preset: "medium",
    pixFmt: "yuv420p10le",
  }),

  anime: ProfileSchema.parse({
    name: "anime",
    codec: "libx265",
    crf: 19,
    preset: "medium",
    x265Params: "aq-mode=3:psy-rd=1.0:deblock=1,1",
    pixFmt: "yuv420p10le",
  }),

  conservative: ProfileSchema.parse({
    name: "conservative",
    codec: "libx265",
    crf: 20,
    preset: "medium",
    pixFmt: "yuv420p10le",
  }),
} as const;
