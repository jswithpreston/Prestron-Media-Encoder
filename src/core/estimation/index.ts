/**
 * Storage savings estimation engine — pure functions, no I/O.
 *
 * Adheres strictly to the core principle:
 * Actual savings are only ever reported from real measured sizes post-encode.
 * Estimates are always labelled 'est.', provided as ranges, and never presented as guarantees.
 */

import type { MediaInfo } from "../probe/index.js";
import type { RecommendationResult } from "../recommendation/index.js";
import type { ProfileName } from "../policy/profiles.js";
import { lookupCompressionRatio } from "./heuristics.js";
import { getCalibratedRatio } from "./calibration.js";
import type { SizeEstimate, FolderSummary } from "./types.js";
import type { JournalStore } from "../jobs/journalStore.js";

export * from "./types.js";
export * from "./heuristics.js";
export * from "./calibration.js";

/**
 * Estimate output size and savings for a single media file.
 * If a JournalStore is provided and has recorded encode history, applies Tier 2 empirical calibration.
 */
export function estimateSize(
  mediaInfo: MediaInfo,
  recommendation: RecommendationResult,
  profileName?: ProfileName,
  crfOverride?: number,
  store?: JournalStore,
): SizeEstimate {
  const sizeBytes = mediaInfo.sizeBytes;
  const targetProfile = profileName ?? recommendation.suggestedProfile;

  // If the recommendation is not to encode (or unsupported / copy), expected savings is 0
  if (recommendation.action !== "encode") {
    return {
      minBytes: sizeBytes,
      likelyBytes: sizeBytes,
      maxBytes: sizeBytes,
      minSavingsBytes: 0,
      likelySavingsBytes: 0,
      maxSavingsBytes: 0,
      minSavingsPercent: 0,
      likelySavingsPercent: 0,
      maxSavingsPercent: 0,
      confidence: "heuristic",
      isCalibrated: false,
      disclaimer: "est. 0 B (file skipped or copied)",
    };
  }

  // Isolate non-video bytes (audio, subtitles, attachments, container overhead)
  const nonVideoSizeBytes = Math.min(sizeBytes, Math.max(0, mediaInfo.nonVideoSizeBytes));
  const inputVideoBytes = Math.max(0, sizeBytes - nonVideoSizeBytes);

  let minRatio: number;
  let likelyRatio: number;
  let maxRatio: number;
  let confidence: "heuristic" | "learned" = "heuristic";
  let isCalibrated = false;

  if (store) {
    const calibrated = getCalibratedRatio(
      store,
      mediaInfo.video.codec,
      mediaInfo.video.bpp,
      targetProfile,
      crfOverride,
    );
    minRatio = calibrated.ratios.minRatio;
    likelyRatio = calibrated.ratios.likelyRatio;
    maxRatio = calibrated.ratios.maxRatio;
    if (calibrated.sampleCount > 0) {
      confidence = "learned";
      isCalibrated = true;
    }
  } else {
    const heuristic = lookupCompressionRatio(
      mediaInfo.video.codec,
      mediaInfo.video.bpp,
      targetProfile,
      crfOverride,
    );
    minRatio = heuristic.minRatio;
    likelyRatio = heuristic.likelyRatio;
    maxRatio = heuristic.maxRatio;
  }

  // Calculate estimated output video stream bytes
  const estMinVideoBytes = Math.round(inputVideoBytes * minRatio);
  const estLikelyVideoBytes = Math.round(inputVideoBytes * likelyRatio);
  const estMaxVideoBytes = Math.round(inputVideoBytes * maxRatio);

  // Total estimated file sizes = estimated video + non-video invariant streams
  const estMinBytes = estMinVideoBytes + nonVideoSizeBytes;
  const estLikelyBytes = estLikelyVideoBytes + nonVideoSizeBytes;
  const estMaxBytes = estMaxVideoBytes + nonVideoSizeBytes;

  // Savings ranges (minSavings corresponds to worst-case maxBytes, maxSavings corresponds to best-case minBytes)
  const minSavingsBytes = Math.max(0, sizeBytes - estMaxBytes);
  const likelySavingsBytes = Math.max(0, sizeBytes - estLikelyBytes);
  const maxSavingsBytes = Math.max(0, sizeBytes - estMinBytes);

  const minSavingsPercent = sizeBytes > 0 ? Math.round((minSavingsBytes / sizeBytes) * 100) : 0;
  const likelySavingsPercent = sizeBytes > 0 ? Math.round((likelySavingsBytes / sizeBytes) * 100) : 0;
  const maxSavingsPercent = sizeBytes > 0 ? Math.round((maxSavingsBytes / sizeBytes) * 100) : 0;

  return {
    minBytes: estMinBytes,
    likelyBytes: estLikelyBytes,
    maxBytes: estMaxBytes,
    minSavingsBytes,
    likelySavingsBytes,
    maxSavingsBytes,
    minSavingsPercent,
    likelySavingsPercent,
    maxSavingsPercent,
    confidence,
    isCalibrated,
    disclaimer: isCalibrated
      ? "est. calibrated from local encode history"
      : "est. range based on codec & density heuristics",
  };
}

export interface SummaryItem {
  mediaInfo: MediaInfo;
  recommendation: RecommendationResult;
  estimate: SizeEstimate | null;
}

/**
 * Compute aggregate summary metrics and estimated savings across an entire scanned folder.
 */
export function computeFolderSummary(items: SummaryItem[]): FolderSummary {
  let totalSizeBytes = 0;
  let encodeCount = 0;
  let skipCount = 0;
  let marginalCount = 0;
  let riskyCount = 0;
  let copyCount = 0;
  let unsupportedCount = 0;

  let candidateSizeBytes = 0;
  let totalMinSavingsBytes = 0;
  let totalLikelySavingsBytes = 0;
  let totalMaxSavingsBytes = 0;

  for (const item of items) {
    totalSizeBytes += item.mediaInfo.sizeBytes;

    switch (item.recommendation.outcome) {
      case "ENCODE":
        encodeCount++;
        break;
      case "MARGINAL":
        marginalCount++;
        break;
      case "RISKY":
        riskyCount++;
        break;
      case "COPY":
        copyCount++;
        break;
      case "UNSUPPORTED":
        unsupportedCount++;
        break;
      case "SKIP_EFFICIENT":
        skipCount++;
        break;
    }

    if (item.recommendation.action === "encode" && item.estimate) {
      candidateSizeBytes += item.mediaInfo.sizeBytes;
      totalMinSavingsBytes += item.estimate.minSavingsBytes;
      totalLikelySavingsBytes += item.estimate.likelySavingsBytes;
      totalMaxSavingsBytes += item.estimate.maxSavingsBytes;
    }
  }

  const minPercent =
    candidateSizeBytes > 0 ? Math.round((totalMinSavingsBytes / candidateSizeBytes) * 100) : 0;
  const likelyPercent =
    candidateSizeBytes > 0 ? Math.round((totalLikelySavingsBytes / candidateSizeBytes) * 100) : 0;
  const maxPercent =
    candidateSizeBytes > 0 ? Math.round((totalMaxSavingsBytes / candidateSizeBytes) * 100) : 0;

  return {
    totalFiles: items.length,
    totalSizeBytes,
    encodeCount,
    skipCount,
    marginalCount,
    riskyCount,
    copyCount,
    unsupportedCount,
    candidateSizeBytes,
    estimatedSavings: {
      minBytes: totalMinSavingsBytes,
      likelyBytes: totalLikelySavingsBytes,
      maxBytes: totalMaxSavingsBytes,
      minPercent,
      likelyPercent,
      maxPercent,
    },
  };
}
