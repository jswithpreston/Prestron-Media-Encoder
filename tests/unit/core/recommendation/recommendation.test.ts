import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeFile } from "../../../../src/core/probe/index.js";
import { recommend } from "../../../../src/core/recommendation/index.js";
import type { ProcessRunner } from "../../../../src/core/ffmpeg/capabilities.js";
import type { ClassificationResult } from "../../../../src/core/classifier/index.js";

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

describe("recommendation engine", () => {
  it("recommends ENCODE for high-bitrate H.264", async () => {
    const info = await probeFile("/fake/h264.mp4", fixtureRunner("h264-1080p-high.json"));
    const classification: ClassificationResult = {
      kind: "movie",
      confidence: 0.9,
      reasons: ["matches movie pattern"],
    };
    const rec = recommend(info, classification);

    expect(rec.outcome).toBe("ENCODE");
    expect(rec.action).toBe("encode");
    expect(rec.confidence).toBe("high");
    expect(rec.suggestedProfile).toBe("movie");
    expect(rec.reasons.some((r) => r.includes("Prime candidate"))).toBe(true);
  });

  it("recommends MARGINAL for very low bitrate H.264 (bpp < 0.05)", async () => {
    const info = await probeFile("/fake/low.mp4", fixtureRunner("h264-low-bitrate.json"));
    const rec = recommend(info);

    expect(rec.outcome).toBe("MARGINAL");
    expect(rec.action).toBe("skip");
    expect(rec.reasons.some((r) => r.includes("Bitrate density is already very low"))).toBe(true);
  });

  it("recommends SKIP_EFFICIENT for AV1 and VP9", async () => {
    const av1 = await probeFile("/fake/av1.webm", fixtureRunner("av1-web.json"));
    const recAv1 = recommend(av1);
    expect(recAv1.outcome).toBe("SKIP_EFFICIENT");
    expect(recAv1.action).toBe("skip");
    expect(recAv1.reasons.some((r) => r.includes("modern codec AV1"))).toBe(true);

    const vp9 = await probeFile("/fake/vp9.webm", fixtureRunner("vp9-web.json"));
    const recVp9 = recommend(vp9);
    expect(recVp9.outcome).toBe("SKIP_EFFICIENT");
    expect(recVp9.action).toBe("skip");
  });

  it("recommends SKIP_EFFICIENT for existing HEVC without force", async () => {
    const hevc = await probeFile("/fake/hevc.mp4", fixtureRunner("hevc-4k.json"));
    const rec = recommend(hevc);
    expect(rec.outcome).toBe("SKIP_EFFICIENT");
    expect(rec.action).toBe("skip");
  });

  it("recommends ENCODE when forced by user options on HEVC", async () => {
    const hevc = await probeFile("/fake/hevc.mp4", fixtureRunner("hevc-4k.json"));
    const rec = recommend(hevc, undefined, { force: true });
    expect(rec.outcome).toBe("ENCODE");
    expect(rec.action).toBe("encode");
    expect(rec.label).toContain("Forced");
  });

  it("flags interlaced content as RISKY without force", async () => {
    const interlaced = await probeFile("/fake/interlaced.ts", fixtureRunner("mpeg2-interlaced.json"));
    const rec = recommend(interlaced);
    expect(rec.outcome).toBe("RISKY");
    expect(rec.action).toBe("skip");
    expect(rec.warnings.some((w) => w.includes("Interlaced video"))).toBe(true);
  });

  it("flags Dolby Vision content as RISKY without force", async () => {
    const dovi = await probeFile("/fake/dovi.mp4", fixtureRunner("dolby-vision.json"));
    const rec = recommend(dovi);
    expect(rec.outcome).toBe("RISKY");
    expect(rec.action).toBe("skip");
    expect(rec.warnings.some((w) => w.includes("Dolby Vision dynamic metadata"))).toBe(true);
  });

  it("returns UNSUPPORTED for empty/invalid stream", () => {
    const fakeInfo: any = {
      path: "/fake/corrupt.mp4",
      container: "mp4",
      durationSecs: 0,
      sizeBytes: 0,
      overallBitrateKbps: 0,
      video: {
        codec: "unknown",
        width: 0,
        height: 0,
        fps: 0,
        bpp: 0,
        bitDepth: 8,
      },
      audio: [],
      subtitles: [],
      attachments: [],
      nonVideoSizeBytes: 0,
    };
    const rec = recommend(fakeInfo);
    expect(rec.outcome).toBe("UNSUPPORTED");
    expect(rec.action).toBe("skip");
  });
});
