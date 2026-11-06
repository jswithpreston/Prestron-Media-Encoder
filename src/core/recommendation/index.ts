/**
 * Recommendation engine — pure function, no I/O.
 *
 * Examines probed media metadata, classification, and density metrics
 * to provide a clear, reasoned recommendation on what to do with each file.
 */

import type { MediaInfo } from "../probe/index.js";
import type { ClassificationResult } from "../classifier/index.js";
import type { ProfileName } from "../policy/profiles.js";
import type {
  RecommendationResult,
  RecommendationOptions,
  RecommendationOutcome,
  RecommendedAction,
} from "./types.js";

export * from "./types.js";

// Codecs recognized as already high-efficiency modern formats
const MODERN_CODECS = new Set(["av1", "vp9"]);
const HEVC_CODECS = new Set(["hevc", "h265"]);

// Low-density bpp threshold where H.264 is already tight
const MARGINAL_BPP_THRESHOLD = 0.05;

/**
 * Determine the recommended encoding action for a probed media file.
 */
export function recommend(
  mediaInfo: MediaInfo,
  classification?: ClassificationResult,
  options?: RecommendationOptions,
): RecommendationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const codec = mediaInfo.video.codec.toLowerCase();
  const bpp = mediaInfo.video.bpp;
  const force = options?.force ?? false;

  // Determine suggested profile
  let suggestedProfile: ProfileName = "conservative";
  if (options?.profileOverride && options.profileOverride !== "auto") {
    suggestedProfile = options.profileOverride;
  } else if (classification && classification.confidence >= 0.6) {
    if (classification.kind === "movie") suggestedProfile = "movie";
    else if (classification.kind === "series") suggestedProfile = "series";
    else if (classification.kind === "anime") suggestedProfile = "anime";
  }

  // 1. UNSUPPORTED: Invalid/corrupt streams
  if (
    codec === "unknown" ||
    codec === "" ||
    mediaInfo.video.width <= 0 ||
    mediaInfo.video.height <= 0 ||
    mediaInfo.durationSecs <= 0 ||
    mediaInfo.sizeBytes <= 0
  ) {
    reasons.push("File is missing valid video streams or has zero duration/size.");
    return {
      outcome: "UNSUPPORTED",
      action: "skip",
      confidence: "high",
      label: "Unsupported",
      reasons,
      warnings,
      bpp,
      suggestedProfile,
    };
  }

  // 2. RISKY: Interlaced video or Dolby Vision metadata
  if (mediaInfo.video.fieldOrder === "interlaced") {
    warnings.push("Interlaced video detected — encoding without deinterlace filter will bake in combing artifacts.");
    reasons.push("Source video has interlaced field order.");
    if (!force) {
      return {
        outcome: "RISKY",
        action: "skip",
        confidence: "high",
        label: "Risky (Interlaced)",
        reasons,
        warnings,
        bpp,
        suggestedProfile,
      };
    }
  }

  if (mediaInfo.video.isDolbyVision) {
    warnings.push("Dolby Vision dynamic metadata detected — standard HEVC re-encode will strip RPU metadata.");
    reasons.push("Source contains Dolby Vision side data or RPU streams.");
    if (!force) {
      return {
        outcome: "RISKY",
        action: "skip",
        confidence: "high",
        label: "Risky (Dolby Vision)",
        reasons,
        warnings,
        bpp,
        suggestedProfile,
      };
    }
  }

  // 3. SKIP_EFFICIENT: Already efficient modern codecs
  if (MODERN_CODECS.has(codec)) {
    reasons.push(`Source is already compressed with modern codec ${codec.toUpperCase()}.`);
    reasons.push("Re-encoding modern codecs yields negligible space savings and incurs generational loss.");
    if (!force) {
      return {
        outcome: "SKIP_EFFICIENT",
        action: "skip",
        confidence: "high",
        label: `Skip (${codec.toUpperCase()})`,
        reasons,
        warnings,
        bpp,
        suggestedProfile,
      };
    }
  }

  if (HEVC_CODECS.has(codec) && !force) {
    if (bpp < 0.15) {
      reasons.push(`Source is already HEVC with low-to-moderate bitrate density (bpp ${bpp.toFixed(3)}).`);
      reasons.push("Re-encoding to HEVC would offer little to no reduction.");
      return {
        outcome: "SKIP_EFFICIENT",
        action: "skip",
        confidence: "high",
        label: "Skip (HEVC)",
        reasons,
        warnings,
        bpp,
        suggestedProfile,
      };
    }
    // High bitrate HEVC without force is marginal
    reasons.push(`Source is HEVC at high bitrate (bpp ${bpp.toFixed(3)}). Pass --force to re-encode.`);
    return {
      outcome: "MARGINAL",
      action: "skip",
      confidence: "medium",
      label: "Marginal (HEVC)",
      reasons,
      warnings,
      bpp,
      suggestedProfile,
    };
  }

  // 4. MARGINAL: H.264 or legacy codec already compressed very tightly
  if (bpp > 0 && bpp < MARGINAL_BPP_THRESHOLD && !force) {
    reasons.push(`Bitrate density is already very low (bpp ${bpp.toFixed(3)} < ${String(MARGINAL_BPP_THRESHOLD)}).`);
    reasons.push("Re-encoding is expected to save under 10% and risks visible compression artifacts.");
    return {
      outcome: "MARGINAL",
      action: "skip",
      confidence: "medium",
      label: "Marginal (Low Bitrate)",
      reasons,
      warnings,
      bpp,
      suggestedProfile,
    };
  }

  // 5. ENCODE: Strong candidate
  let label = "Encode";
  if (force) {
    label = "Encode (Forced)";
    reasons.push("Re-encode forced by user option.");
  } else {
    reasons.push(`Source is ${codec.toUpperCase()} at ${String(mediaInfo.video.bitrateKbps)} kbps (bpp ${bpp.toFixed(3)}).`);
    reasons.push(`Prime candidate for HEVC compression via ${suggestedProfile} profile.`);
  }

  if (mediaInfo.video.isHdr) {
    warnings.push("HDR color transfer (smpte2084/HLG) will be preserved in target HEVC 10-bit stream.");
  }
  if (mediaInfo.video.isVfr) {
    warnings.push("Variable frame rate (VFR) timestamps will be preserved with passthrough mode.");
  }

  const outcome: RecommendationOutcome = "ENCODE";
  const action: RecommendedAction = "encode";

  return {
    outcome,
    action,
    confidence: "high",
    label,
    reasons,
    warnings,
    bpp,
    suggestedProfile,
  };
}
