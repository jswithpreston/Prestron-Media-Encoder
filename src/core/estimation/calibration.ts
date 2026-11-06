/**
 * Calibration engine — calculates empirical compression ratios from past encodes.
 *
 * Implements Tier 2 (empirical historical learning) and Tier 3 (sample test encode).
 */

import type { EncodeHistoryRecord, JournalStore } from "../jobs/journalStore.js";
import type { CompressionRatioRange } from "./heuristics.js";
import { lookupCompressionRatio, classifyBppBucket } from "./heuristics.js";
import type { ProfileName } from "../policy/profiles.js";

export interface CalibratedRatios {
  ratios: CompressionRatioRange;
  sampleCount: number;
  confidence: "learned" | "measured";
}

/**
 * Calculates empirical compression ratios from recorded history for a specific codec family and profile.
 * Blends historical ratios with baseline heuristics using Bayesian weighted smoothing:
 * - With 0 samples: returns pure heuristic ratios.
 * - With 1-3 samples: blends heuristic and empirical measurements.
 * - With 4+ samples: empirical measurements dominate the likely ratio while maintaining safe bounds.
 */
export function getCalibratedRatio(
  store: JournalStore,
  codec: string,
  bpp: number,
  profileName: ProfileName = "conservative",
  crfOverride?: number,
): CalibratedRatios {
  const heuristic = lookupCompressionRatio(codec, bpp, profileName, crfOverride);

  let history: EncodeHistoryRecord[] = [];
  try {
    history = store.getEncodeHistory(codec, profileName, 20);
  } catch {
    // If table or store cannot be queried, fall back to heuristic
    return {
      ratios: heuristic,
      sampleCount: 0,
      confidence: "learned",
    };
  }

  // Filter for matching bpp bucket (e.g. low/med/high density)
  const targetBucket = classifyBppBucket(bpp);
  const relevantSamples = history.filter((h) => classifyBppBucket(h.bpp) === targetBucket);

  if (relevantSamples.length === 0) {
    return {
      ratios: heuristic,
      sampleCount: 0,
      confidence: "learned",
    };
  }

  // Calculate empirical average and spread of video compression ratios
  const ratios = relevantSamples.map((s) => s.videoCompressionRatio);
  const sum = ratios.reduce((a, b) => a + b, 0);
  const avg = sum / ratios.length;

  const minEmpirical = Math.min(...ratios);
  const maxEmpirical = Math.max(...ratios);

  // Blend weight: n / (n + 2)
  const n = relevantSamples.length;
  const weight = n / (n + 2);
  const blendedLikely = weight * avg + (1 - weight) * heuristic.likelyRatio;

  // Bound range around the empirical spread
  const minRatio = Math.min(heuristic.minRatio, minEmpirical * 0.95);
  const maxRatio = Math.max(heuristic.maxRatio, maxEmpirical * 1.05);

  return {
    ratios: {
      minRatio: Number(minRatio.toFixed(3)),
      likelyRatio: Number(blendedLikely.toFixed(3)),
      maxRatio: Number(maxRatio.toFixed(3)),
    },
    sampleCount: n,
    confidence: "learned",
  };
}
