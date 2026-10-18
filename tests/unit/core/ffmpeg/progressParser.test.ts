/**
 * Unit tests: ProgressParser
 */

import { describe, it, expect } from "vitest";
import { ProgressParser } from "../../../../src/core/ffmpeg/progressParser.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a complete ffmpeg progress frame as text. */
function frame(fields: Record<string, string>): string {
  return (
    Object.entries(fields)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\nprogress=continue\n"
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ProgressParser", () => {
  it("parses a complete frame", () => {
    const parser = new ProgressParser(100);
    const results = parser.feed(
      frame({
        out_time_ms: "50000000", // 50 seconds in microseconds
        fps: "23.97",
        speed: "1.5x",
        total_size: "1048576",
      }),
    );
    expect(results).toHaveLength(1);
    const r = results[0];
    expect(r).toBeDefined();
    if (!r) return;
    expect(r.outTimeSecs).toBeCloseTo(50);
    expect(r.fps).toBeCloseTo(23.97);
    expect(r.speed).toBeCloseTo(1.5);
    expect(r.totalSizeBytes).toBe(1048576);
    expect(r.percentDone).toBeCloseTo(50);
  });

  it("clamps percentDone to [0, 100]", () => {
    const parser = new ProgressParser(100);
    // out_time > duration → should clamp to 100
    const results = parser.feed(
      frame({ out_time_ms: "200000000", fps: "24", speed: "2.0x", total_size: "0" }),
    );
    expect(results[0]?.percentDone).toBe(100);
  });

  it("handles partial lines across multiple feed() calls", () => {
    const parser = new ProgressParser(60);
    const full = frame({ out_time_ms: "30000000", fps: "24", speed: "1.0x", total_size: "512" });
    // Split in the middle of a line
    const half = Math.floor(full.length / 2);
    const part1 = parser.feed(full.slice(0, half));
    const part2 = parser.feed(full.slice(half));
    expect(part1).toHaveLength(0); // incomplete frame
    expect(part2).toHaveLength(1);
    expect(part2[0]?.outTimeSecs).toBeCloseTo(30);
  });

  it("returns empty array when no complete frame is present", () => {
    const parser = new ProgressParser(60);
    const results = parser.feed("out_time_ms=10000000\nfps=24\n");
    expect(results).toHaveLength(0);
  });

  it("emits multiple frames from one feed() call", () => {
    const parser = new ProgressParser(100);
    const two =
      frame({ out_time_ms: "10000000", fps: "24", speed: "1x", total_size: "0" }) +
      frame({ out_time_ms: "20000000", fps: "24", speed: "1x", total_size: "0" });
    const results = parser.feed(two);
    expect(results).toHaveLength(2);
    expect(results[0]?.outTimeSecs).toBeCloseTo(10);
    expect(results[1]?.outTimeSecs).toBeCloseTo(20);
  });

  it("reset() clears accumulated state", () => {
    const parser = new ProgressParser(60);
    // Feed half a frame
    parser.feed("out_time_ms=10000000\n");
    parser.reset();
    // Now feed a complete frame; should get exactly 1 result, not a corrupted one
    const results = parser.feed(
      frame({ out_time_ms: "5000000", fps: "24", speed: "1x", total_size: "0" }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.outTimeSecs).toBeCloseTo(5);
  });

  it("handles speed with and without trailing 'x'", () => {
    const parser = new ProgressParser(100);
    const withX = parser.feed(
      frame({ out_time_ms: "1000000", fps: "24", speed: "2.5x", total_size: "0" }),
    );
    const withoutX = new ProgressParser(100).feed(
      frame({ out_time_ms: "1000000", fps: "24", speed: "2.5", total_size: "0" }),
    );
    expect(withX[0]?.speed).toBeCloseTo(2.5);
    expect(withoutX[0]?.speed).toBeCloseTo(2.5);
  });

  it("handles zero duration (avoids division by zero)", () => {
    const parser = new ProgressParser(0);
    const results = parser.feed(
      frame({ out_time_ms: "50000000", fps: "24", speed: "1x", total_size: "0" }),
    );
    expect(results[0]?.percentDone).toBe(0); // 0/0 → clamped to 0
  });
});
