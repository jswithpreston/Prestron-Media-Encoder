import { describe, it, expect } from "vitest";
import { buildPlan } from "../../../../src/core/policy/planBuilder.js";
import { PROFILES } from "../../../../src/core/policy/profiles.js";
import type { MediaInfo } from "../../../../src/core/probe/index.js";
import type { ClassificationResult } from "../../../../src/core/classifier/index.js";
import type { FfmpegCapabilities } from "../../../../src/core/ffmpeg/capabilities.js";

const fakeCaps: FfmpegCapabilities = {
  version: { major: 7, minor: 0, patch: 0, raw: "7.0" },
  hasLibx265: true,
  fpsModeFlag: "-fps_mode",
  fpsModeValue: "passthrough",
};

const oldCaps: FfmpegCapabilities = {
  ...fakeCaps,
  fpsModeFlag: "-vsync",
};

function makeMediaInfo(overrides: Partial<MediaInfo["video"]> = {}): MediaInfo {
  return {
    path: "/media/shows/Show.S01E01.mkv",
    container: "matroska",
    durationSecs: 2700,
    sizeBytes: 4_000_000_000,
    bitrateKbps: 12_000,
    video: {
      codec: "h264",
      pixFmt: "yuv420p",
      bitDepth: 8,
      width: 1920,
      height: 1080,
      fps: 23.976,
      isVfr: false,
      isHdr: false,
      isDolbyVision: false,
      ...overrides,
    },
    audio: [],
    subtitles: [],
    attachmentCount: 0,
    chapterCount: 0,
    tags: {},
  };
}

function makeClassification(
  kind: ClassificationResult["kind"] = "series",
  confidence = 0.8,
): ClassificationResult {
  return { kind, confidence, reasons: [`Classified as ${kind}`] };
}

describe("buildPlan — profile selection", () => {
  it("anime kind → anime profile (crf=19)", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("anime"), fakeCaps);
    expect(plan.profile.name).toBe("anime");
    expect(plan.profile.crf).toBe(19);
  });

  it("series kind → series profile (crf=22)", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("series"), fakeCaps);
    expect(plan.profile.name).toBe("series");
    expect(plan.profile.crf).toBe(22);
  });

  it("movie kind → movie profile (crf=21)", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("movie"), fakeCaps);
    expect(plan.profile.name).toBe("movie");
    expect(plan.profile.crf).toBe(21);
  });

  it("confidence < 0.6 → conservative profile", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("series", 0.4), fakeCaps);
    expect(plan.profile.name).toBe("conservative");
    expect(plan.reasons.some((r) => r.includes("conservative"))).toBe(true);
  });

  it("unknown kind → conservative profile", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("unknown", 0.3), fakeCaps);
    expect(plan.profile.name).toBe("conservative");
  });

  it("profileOverride='anime' overrides classification", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("movie"), fakeCaps, {
      profileOverride: "anime",
    });
    expect(plan.profile.name).toBe("anime");
    expect(plan.reasons.some((r) => r.includes("overridden"))).toBe(true);
  });
});

describe("buildPlan — video action", () => {
  it("HEVC source → videoAction='copy' by default", () => {
    const plan = buildPlan(makeMediaInfo({ codec: "hevc" }), makeClassification(), fakeCaps);
    expect(plan.videoAction).toBe("copy");
    expect(plan.reasons.some((r) => r.includes("HEVC"))).toBe(true);
  });

  it("HEVC source + force=true → videoAction='encode'", () => {
    const plan = buildPlan(makeMediaInfo({ codec: "hevc" }), makeClassification(), fakeCaps, {
      force: true,
    });
    expect(plan.videoAction).toBe("encode");
  });

  it("AV1 source → videoAction='copy'", () => {
    const plan = buildPlan(makeMediaInfo({ codec: "av1" }), makeClassification(), fakeCaps);
    expect(plan.videoAction).toBe("copy");
  });

  it("VP9 source → videoAction='copy'", () => {
    const plan = buildPlan(makeMediaInfo({ codec: "vp9" }), makeClassification(), fakeCaps);
    expect(plan.videoAction).toBe("copy");
  });

  it("H264 source → videoAction='encode'", () => {
    const plan = buildPlan(makeMediaInfo({ codec: "h264" }), makeClassification(), fakeCaps);
    expect(plan.videoAction).toBe("encode");
  });
});

describe("buildPlan — warnings", () => {
  it("HDR source adds HDR warning", () => {
    const plan = buildPlan(makeMediaInfo({ isHdr: true }), makeClassification(), fakeCaps);
    expect(plan.warnings.some((w) => w.includes("HDR"))).toBe(true);
  });

  it("VFR source adds VFR warning", () => {
    const plan = buildPlan(makeMediaInfo({ isVfr: true }), makeClassification(), fakeCaps);
    expect(plan.warnings.some((w) => w.includes("VFR") || w.includes("Variable frame rate"))).toBe(
      true,
    );
  });

  it("normal source has no warnings", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), fakeCaps);
    expect(plan.warnings).toHaveLength(0);
  });
});

describe("buildPlan — overrides do not mutate PROFILES", () => {
  it("crfOverride does not mutate the global profile", () => {
    const originalCrf = PROFILES.series.crf;
    buildPlan(makeMediaInfo(), makeClassification("series"), fakeCaps, { crfOverride: 18 });
    expect(PROFILES.series.crf).toBe(originalCrf);
  });

  it("crfOverride is reflected in the returned plan", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("series"), fakeCaps, {
      crfOverride: 18,
    });
    expect(plan.profile.crf).toBe(18);
  });

  it("presetOverride is reflected in the returned plan", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("series"), fakeCaps, {
      presetOverride: "slow",
    });
    expect(plan.profile.preset).toBe("slow");
  });

  it("invalid presetOverride adds a warning and uses original preset", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification("series"), fakeCaps, {
      presetOverride: "notapreset",
    });
    expect(plan.warnings.some((w) => w.includes("notapreset"))).toBe(true);
    expect(plan.profile.preset).toBe("medium");
  });
});

describe("buildPlan — branding", () => {
  it("branding enabled by default", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), fakeCaps);
    expect(plan.brandingEnabled).toBe(true);
  });

  it("brandingEnabled=false is respected", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), fakeCaps, {
      brandingEnabled: false,
    });
    expect(plan.brandingEnabled).toBe(false);
  });
});

describe("buildPlan — fps mode flag from caps", () => {
  it("uses -fps_mode for modern FFmpeg", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), fakeCaps);
    expect(plan.fpsModeFlag).toBe("-fps_mode");
  });

  it("uses -vsync for old FFmpeg (< 5.1)", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), oldCaps);
    expect(plan.fpsModeFlag).toBe("-vsync");
  });
});

describe("buildPlan — output paths", () => {
  it("outputFile is in a Prestron-Encoded subdir", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), fakeCaps);
    expect(plan.outputFile).toContain("Prestron-Encoded");
  });

  it("partFile is outputFile + .part", () => {
    const plan = buildPlan(makeMediaInfo(), makeClassification(), fakeCaps);
    expect(plan.partFile).toBe(plan.outputFile + ".part");
  });
});
