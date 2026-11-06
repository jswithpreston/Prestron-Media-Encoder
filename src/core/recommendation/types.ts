/**
 * Types for the encoding recommendation engine.
 *
 * Classifies source files into actionable outcomes before encoding,
 * explaining why a file should be encoded, skipped, copied, or treated with caution.
 */

import type { ProfileName } from "../policy/profiles.js";

export type RecommendationOutcome =
  | "ENCODE"
  | "MARGINAL"
  | "SKIP_EFFICIENT"
  | "RISKY"
  | "COPY"
  | "UNSUPPORTED";

export type RecommendedAction = "encode" | "copy" | "skip";

export type RecommendationConfidence = "high" | "medium" | "low";

export interface RecommendationResult {
  outcome: RecommendationOutcome;
  action: RecommendedAction;
  confidence: RecommendationConfidence;
  /** Primary short label for UI badges/tables (e.g. "Encode", "Skip (AV1)", "Marginal"). */
  label: string;
  /** Comprehensive list of reasons explaining the recommendation derived from ffprobe data. */
  reasons: string[];
  /** Warnings that warrant user attention (e.g. interlacing, Dolby Vision, VFR). */
  warnings: string[];
  /** Bits per pixel per frame of source video. */
  bpp: number;
  /** Suggested target profile name (e.g. "movie", "series", "anime", "conservative"). */
  suggestedProfile: ProfileName;
}

export interface RecommendationOptions {
  /** If true, user explicitly requested re-encoding even if codec is already efficient. */
  force?: boolean | undefined;
  /** Preferred profile name override. */
  profileOverride?: ProfileName | undefined;
  /** Target CRF override. */
  crfOverride?: number | undefined;
}
