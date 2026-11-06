/**
 * Tests for Tier 2 calibration engine and Tier 3 sample runner.
 */

import { describe, it, expect } from "vitest";
import { createSqliteJournalStore } from "../../../../src/core/jobs/sqliteJournalStore.js";
import { getCalibratedRatio } from "../../../../src/core/estimation/calibration.js";
import { estimateSize } from "../../../../src/core/estimation/index.js";
import { recommend } from "../../../../src/core/recommendation/index.js";
import type { MediaInfo } from "../../../../src/core/probe/index.js";
import type { EncodeHistoryRecord } from "../../../../src/core/jobs/journalStore.js";

const sampleMedia: MediaInfo = {
  path: "/media/test.mkv",
  container: "matroska",
  durationSecs: 1800,
  sizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
  bitrateKbps: 9000,
  overallBitrateKbps: 9500,
  formatName: "matroska",
  video: {
    codec: "h264",
    profile: "High",
    pixFmt: "yuv420p",
    bitDepth: 8,
    width: 1920,
    height: 1080,
    fps: 24,
    avgFps: 24,
    isVfr: false,
    fieldOrder: "progressive",
    isHdr: false,
    isDolbyVision: false,
    bitrateKbps: 9000,
    isBitrateDerived: false,
    bpp: 0.18, // High density bucket (> 0.15)
  },
  audio: [],
  subtitles: [],
  attachments: [],
  chapters: [],
  containerOverheadBytes: 1024,
  nonVideoSizeBytes: 1024,
};

describe("Calibration Engine (Tier 2)", () => {
  it("falls back to heuristic when journal has no past records", () => {
    const store = createSqliteJournalStore(":memory:");
    try {
      const rec = recommend(sampleMedia, undefined, { profileOverride: "series" });
      const est = estimateSize(sampleMedia, rec, "series", undefined, store);

      expect(est.isCalibrated).toBe(false);
      expect(est.confidence).toBe("heuristic");
      expect(est.disclaimer).toContain("heuristics");
    } finally {
      store.close();
    }
  });

  it("calibrates ratios when historical encodes are recorded", () => {
    const store = createSqliteJournalStore(":memory:");
    try {
      // Seed 3 historical encode records for h264 with high bpp and series profile
      const historyRecord: EncodeHistoryRecord = {
        sourcePath: "/old/source.mkv",
        sourceSizeBytes: 2 * 1024 * 1024 * 1024,
        outputSizeBytes: 800 * 1024 * 1024, // 0.39 overall ratio
        sourceCodec: "h264",
        targetCodec: "libx265",
        profileName: "series",
        crf: 22,
        preset: "medium",
        bpp: 0.19,
        durationSecs: 3600,
        encodeDurationMs: 120_000,
        compressionRatio: 0.39,
        videoCompressionRatio: 0.38,
        timestamp: Date.now() - 10_000,
      };

      store.recordEncodeHistory(historyRecord);
      store.recordEncodeHistory({ ...historyRecord, videoCompressionRatio: 0.40 });
      store.recordEncodeHistory({ ...historyRecord, videoCompressionRatio: 0.37 });

      const calibrated = getCalibratedRatio(store, "h264", 0.18, "series");
      expect(calibrated.sampleCount).toBe(3);
      expect(calibrated.confidence).toBe("learned");
      // Average ~0.383, blended with baseline heuristic
      expect(calibrated.ratios.likelyRatio).toBeLessThan(0.46);

      const rec = recommend(sampleMedia, undefined, { profileOverride: "series" });
      const est = estimateSize(sampleMedia, rec, "series", undefined, store);

      expect(est.isCalibrated).toBe(true);
      expect(est.confidence).toBe("learned");
      expect(est.disclaimer).toContain("calibrated from local encode history");
      expect(est.likelySavingsPercent).toBeGreaterThan(50);
    } finally {
      store.close();
    }
  });
});
