import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeFile } from "../../../../src/core/probe/index.js";
import { recommend } from "../../../../src/core/recommendation/index.js";
import { estimateSize, computeFolderSummary, lookupCompressionRatio } from "../../../../src/core/estimation/index.js";
import type { ProcessRunner } from "../../../../src/core/ffmpeg/capabilities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "../../../fixtures/probes");

function fixtureRunner(fixtureName: string): ProcessRunner {
  const content = readFileSync(join(FIXTURES, fixtureName), "utf8");
  return {
    run() {
      return Promise.resolve({ stdout: content, stderr: "", exitCode: 0 });
    },
  };
}

describe("estimation engine", () => {
  it("lookupCompressionRatio adjusts based on codec and bpp bucket", () => {
    const h264High = lookupCompressionRatio("h264", 0.20, "movie");
    expect(h264High.likelyRatio).toBeLessThan(0.60);

    const h264Low = lookupCompressionRatio("h264", 0.03, "conservative");
    expect(h264Low.likelyRatio).toBeGreaterThan(0.70);

    const av1 = lookupCompressionRatio("av1", 0.05, "conservative");
    expect(av1.likelyRatio).toBeGreaterThanOrEqual(1.0);
  });

  it("estimateSize produces a well-bounded range for ENCODE files", async () => {
    const info = await probeFile("/fake/h264.mp4", fixtureRunner("h264-1080p-high.json"));
    const rec = recommend(info);
    const est = estimateSize(info, rec);

    expect(est.confidence).toBe("heuristic");
    expect(est.isCalibrated).toBe(false);
    expect(est.disclaimer).toContain("est. range");

    // Sizes are bounded and monotonically ordered
    expect(est.minBytes).toBeLessThan(est.likelyBytes);
    expect(est.likelyBytes).toBeLessThan(est.maxBytes);
    expect(est.maxBytes).toBeLessThan(info.sizeBytes);

    // Savings are positive
    expect(est.minSavingsBytes).toBeGreaterThan(0);
    expect(est.likelySavingsBytes).toBeGreaterThan(est.minSavingsBytes);
    expect(est.maxSavingsBytes).toBeGreaterThan(est.likelySavingsBytes);

    // Percentage savings reasonable for high-bitrate H.264 (between 25% and 75%)
    expect(est.minSavingsPercent).toBeGreaterThanOrEqual(25);
    expect(est.maxSavingsPercent).toBeLessThanOrEqual(75);
  });

  it("estimateSize preserves non-video bytes without shrinking them", async () => {
    const info = await probeFile("/fake/multi.mkv", fixtureRunner("multi-audio-subs-chapters.json"));
    const rec = recommend(info);
    const est = estimateSize(info, rec);

    // The estimated minimum output file size must be at least as large as the non-video streams
    expect(est.minBytes).toBeGreaterThanOrEqual(info.nonVideoSizeBytes);
  });

  it("estimateSize returns 0 savings for skipped/marginal files", async () => {
    const av1 = await probeFile("/fake/av1.webm", fixtureRunner("av1-web.json"));
    const rec = recommend(av1);
    const est = estimateSize(av1, rec);

    expect(est.minSavingsBytes).toBe(0);
    expect(est.likelySavingsBytes).toBe(0);
    expect(est.maxSavingsBytes).toBe(0);
    expect(est.minBytes).toBe(av1.sizeBytes);
  });

  it("computeFolderSummary aggregates counts and savings correctly", async () => {
    const h264 = await probeFile("/fake/h264.mp4", fixtureRunner("h264-1080p-high.json"));
    const av1 = await probeFile("/fake/av1.webm", fixtureRunner("av1-web.json"));
    const low = await probeFile("/fake/low.mp4", fixtureRunner("h264-low-bitrate.json"));

    const rec1 = recommend(h264);
    const est1 = estimateSize(h264, rec1);

    const rec2 = recommend(av1);
    const est2 = estimateSize(av1, rec2);

    const rec3 = recommend(low);
    const est3 = estimateSize(low, rec3);

    const summary = computeFolderSummary([
      { mediaInfo: h264, recommendation: rec1, estimate: est1 },
      { mediaInfo: av1, recommendation: rec2, estimate: est2 },
      { mediaInfo: low, recommendation: rec3, estimate: est3 },
    ]);

    expect(summary.totalFiles).toBe(3);
    expect(summary.encodeCount).toBe(1);
    expect(summary.skipCount).toBe(1);
    expect(summary.marginalCount).toBe(1);
    expect(summary.candidateSizeBytes).toBe(h264.sizeBytes);
    expect(summary.estimatedSavings.likelyBytes).toBe(est1.likelySavingsBytes);
    expect(summary.estimatedSavings.likelyPercent).toBe(est1.likelySavingsPercent);
  });
});
