/**
 * Tier 1 Heuristic estimation tables.
 *
 * Data-driven compression ratios based on source codec family,
 * bits-per-pixel (bpp) density bucket, and target profile.
 *
 * Ratios represent (targetVideoBytes / sourceVideoBytes).
 * Lower ratio = more compression / higher storage savings.
 */

import type { ProfileName } from "../policy/profiles.js";

export type CodecFamily = "h264" | "mpeg2" | "vc1" | "hevc" | "vp9" | "av1" | "other";
export type BppBucket = "low" | "medium" | "high";

export interface CompressionRatioRange {
  /** Optimistic compression ratio (most storage saved). */
  minRatio: number;
  /** Expected typical compression ratio. */
  likelyRatio: number;
  /** Conservative compression ratio (least storage saved). */
  maxRatio: number;
}

export function classifyCodecFamily(codec: string): CodecFamily {
  const c = codec.toLowerCase();
  if (c === "h264" || c === "avc" || c === "x264") return "h264";
  if (c === "hevc" || c === "h265" || c === "x265") return "hevc";
  if (c === "vp9") return "vp9";
  if (c === "av1") return "av1";
  if (c === "mpeg2video" || c === "mpeg2") return "mpeg2";
  if (c === "vc1" || c === "wmv3") return "vc1";
  return "other";
}

export function classifyBppBucket(bpp: number): BppBucket {
  if (bpp < 0.06) return "low";
  if (bpp < 0.15) return "medium";
  return "high";
}

/**
 * Baseline compression ratios for standard HEVC encodes (CRF ~20-22)
 * categorized by (codecFamily, bppBucket).
 */
const HEURISTIC_TABLE: Record<CodecFamily, Record<BppBucket, CompressionRatioRange>> = {
  h264: {
    // Already heavily compressed H.264
    low: { minRatio: 0.75, likelyRatio: 0.88, maxRatio: 1.05 },
    // Standard BluRay/web 1080p H.264
    medium: { minRatio: 0.45, likelyRatio: 0.58, maxRatio: 0.72 },
    // High bitrate remux / action H.264
    high: { minRatio: 0.35, likelyRatio: 0.46, maxRatio: 0.60 },
  },
  mpeg2: {
    low: { minRatio: 0.50, likelyRatio: 0.65, maxRatio: 0.80 },
    medium: { minRatio: 0.30, likelyRatio: 0.42, maxRatio: 0.55 },
    high: { minRatio: 0.20, likelyRatio: 0.32, maxRatio: 0.45 },
  },
  vc1: {
    low: { minRatio: 0.65, likelyRatio: 0.78, maxRatio: 0.90 },
    medium: { minRatio: 0.40, likelyRatio: 0.52, maxRatio: 0.65 },
    high: { minRatio: 0.30, likelyRatio: 0.40, maxRatio: 0.52 },
  },
  hevc: {
    // Re-encoding existing HEVC rarely saves space and often grows
    low: { minRatio: 0.90, likelyRatio: 1.02, maxRatio: 1.25 },
    medium: { minRatio: 0.80, likelyRatio: 0.92, maxRatio: 1.10 },
    high: { minRatio: 0.60, likelyRatio: 0.72, maxRatio: 0.85 },
  },
  vp9: {
    low: { minRatio: 0.95, likelyRatio: 1.05, maxRatio: 1.30 },
    medium: { minRatio: 0.85, likelyRatio: 0.96, maxRatio: 1.15 },
    high: { minRatio: 0.65, likelyRatio: 0.78, maxRatio: 0.92 },
  },
  av1: {
    low: { minRatio: 1.00, likelyRatio: 1.15, maxRatio: 1.40 },
    medium: { minRatio: 0.90, likelyRatio: 1.05, maxRatio: 1.25 },
    high: { minRatio: 0.75, likelyRatio: 0.88, maxRatio: 1.05 },
  },
  other: {
    low: { minRatio: 0.65, likelyRatio: 0.80, maxRatio: 0.95 },
    medium: { minRatio: 0.45, likelyRatio: 0.58, maxRatio: 0.70 },
    high: { minRatio: 0.35, likelyRatio: 0.48, maxRatio: 0.60 },
  },
};

/**
 * Adjust ratios based on target profile or CRF override.
 */
export function lookupCompressionRatio(
  codec: string,
  bpp: number,
  profileName: ProfileName = "conservative",
  crfOverride?: number,
): CompressionRatioRange {
  const family = classifyCodecFamily(codec);
  const bucket = classifyBppBucket(bpp);
  const base = HEURISTIC_TABLE[family][bucket];

  // Profile-specific multiplier
  // Anime compresses significantly better with animation tune; movie targets higher fidelity (slightly larger file)
  let profileMultiplier = 1.0;
  if (profileName === "anime") {
    profileMultiplier = 0.88;
  } else if (profileName === "movie") {
    profileMultiplier = 1.04;
  } else if (profileName === "series") {
    profileMultiplier = 0.96;
  }

  // CRF multiplier relative to baseline CRF 21: each CRF point changes size by approx 6%
  let crfMultiplier = 1.0;
  if (crfOverride !== undefined) {
    const delta = crfOverride - 21;
    // Positive delta = higher CRF = smaller file (lower multiplier)
    // Negative delta = lower CRF = larger file (higher multiplier)
    crfMultiplier = Math.max(0.5, Math.min(1.6, 1.0 - delta * 0.06));
  }

  const multiplier = profileMultiplier * crfMultiplier;

  return {
    minRatio: Math.max(0.05, Math.round(base.minRatio * multiplier * 100) / 100),
    likelyRatio: Math.max(0.10, Math.round(base.likelyRatio * multiplier * 100) / 100),
    maxRatio: Math.max(0.15, Math.round(base.maxRatio * multiplier * 100) / 100),
  };
}
