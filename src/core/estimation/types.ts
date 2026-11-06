/**
 * Types for the storage savings estimation engine.
 *
 * Core rule: actual savings are only ever reported from real measured sizes post-encode.
 * Estimates are always labelled 'est.', provided as ranges, and never presented as guarantees.
 */

export type EstimationConfidence = "heuristic" | "learned" | "measured";

export interface SizeEstimate {
  /** Estimated output file size range in bytes. */
  minBytes: number;
  likelyBytes: number;
  maxBytes: number;

  /** Estimated bytes saved range compared to source file. */
  minSavingsBytes: number;
  likelySavingsBytes: number;
  maxSavingsBytes: number;

  /** Estimated percentage saved range (0 - 100). */
  minSavingsPercent: number;
  likelySavingsPercent: number;
  maxSavingsPercent: number;

  /** Confidence level of the estimate. Tier 1 is always 'heuristic'. */
  confidence: EstimationConfidence;
  /** Whether the estimate is calibrated from real local machine encoder history. */
  isCalibrated: boolean;
  /** Visible label or disclaimer clarifying this is an uncalibrated heuristic estimate. */
  disclaimer: string;
}

export interface FolderSummary {
  totalFiles: number;
  totalSizeBytes: number;

  /** Outcome category counts. */
  encodeCount: number;
  skipCount: number;
  marginalCount: number;
  riskyCount: number;
  copyCount: number;
  unsupportedCount: number;

  /** Total size in bytes of files selected / recommended for encoding. */
  candidateSizeBytes: number;

  /** Aggregated estimated savings across all encode candidates. */
  estimatedSavings: {
    minBytes: number;
    likelyBytes: number;
    maxBytes: number;
    minPercent: number;
    likelyPercent: number;
    maxPercent: number;
  };
}
