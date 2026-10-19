import { describe, it, expect } from "vitest";
import { buildArgs } from "../../../../src/core/ffmpeg/argBuilder.js";
import type { EncodePlan } from "../../../../src/core/policy/planBuilder.js";
import type { FfmpegCapabilities } from "../../../../src/core/ffmpeg/capabilities.js";
import { PROFILES } from "../../../../src/core/policy/profiles.js";

const caps7: FfmpegCapabilities = {
  version: { major: 7, minor: 0, patch: 0, raw: "7.0" },
  hasLibx265: true,
  fpsModeFlag: "-fps_mode",
  fpsModeValue: "passthrough",
};

const caps44: FfmpegCapabilities = {
  ...caps7,
  version: { major: 4, minor: 4, patch: 2, raw: "4.4.2" },
  fpsModeFlag: "-vsync",
};

function makePlan(overrides: Partial<EncodePlan> = {}): EncodePlan {
  return {
    sourceFile: "/media/shows/Show.S01E01.mkv",
    outputFile: "/media/shows/Prestron-Encoded/Show.S01E01.mkv",
    partFile: "/media/shows/Prestron-Encoded/Show.S01E01.mkv.part",
    videoAction: "encode",
    profile: { ...PROFILES.series },
    reasons: [],
    warnings: [],
    fpsModeFlag: "-fps_mode",
    fpsModeValue: "passthrough",
    brandingEnabled: true,
    estimatedOutputDir: "/media/shows/Prestron-Encoded",
    ...overrides,
  };
}

describe("buildArgs — structure", () => {
  it("starts with -hide_banner -nostdin -n", () => {
    const args = buildArgs(makePlan(), caps7);
    expect(args[0]).toBe("-hide_banner");
    expect(args[1]).toBe("-nostdin");
    expect(args[2]).toBe("-n");
  });

  it("contains -i <sourceFile>", () => {
    const args = buildArgs(makePlan(), caps7);
    const iIdx = args.indexOf("-i");
    expect(iIdx).toBeGreaterThan(-1);
    expect(args[iIdx + 1]).toBe("/media/shows/Show.S01E01.mkv");
  });

  it("contains -map 0 -map -0:d", () => {
    const args = buildArgs(makePlan(), caps7);
    expect(args).toContain("-map");
    expect(args).toContain("0");
    expect(args).toContain("-0:d");
  });

  it("contains -map_chapters 0 and -map_metadata 0", () => {
    const args = buildArgs(makePlan(), caps7);
    expect(args).toContain("-map_chapters");
    expect(args).toContain("-map_metadata");
  });

  it("contains per-type copy flags (-c:a -c:s -c:t -c:v copy)", () => {
    const args = buildArgs(makePlan(), caps7);
    // Every stream type defaults to copy
    expect(args).toContain("-c:a");
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
    expect(args).toContain("-c:s");
    expect(args[args.indexOf("-c:s") + 1]).toBe("copy");
    expect(args).toContain("-c:t");
    expect(args[args.indexOf("-c:t") + 1]).toBe("copy");
    expect(args).toContain("-c:v");
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    // No bare -c flag
    expect(args).not.toContain("-c");
  });

  it("encode action overrides video to libx265 while keeping other streams copy", () => {
    const args = buildArgs(makePlan({ videoAction: "encode" }), caps7);
    // Last -c:v is the video encode override
    const lastCvIdx = args.lastIndexOf("-c:v");
    expect(args[lastCvIdx + 1]).toBe("libx265");
    // Audio/subtitle/attachment remain copy (first occurrence of each)
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
    expect(args[args.indexOf("-c:s") + 1]).toBe("copy");
    expect(args[args.indexOf("-c:t") + 1]).toBe("copy");
  });

  it("ends with -f matroska <partFile>", () => {
    const args = buildArgs(makePlan(), caps7);
    expect(args[args.length - 3]).toBe("-f");
    expect(args[args.length - 2]).toBe("matroska");
    expect(args[args.length - 1]).toBe("/media/shows/Prestron-Encoded/Show.S01E01.mkv.part");
  });
});

describe("buildArgs — encode action", () => {
  it("encode action includes -c:v libx265", () => {
    const args = buildArgs(makePlan({ videoAction: "encode" }), caps7);
    // The last -c:v wins (video encode override after per-type copy defaults)
    const lastCvIdx = args.lastIndexOf("-c:v");
    expect(lastCvIdx).toBeGreaterThan(-1);
    expect(args[lastCvIdx + 1]).toBe("libx265");
  });

  it("encode action includes -crf N", () => {
    const args = buildArgs(makePlan({ videoAction: "encode" }), caps7);
    const idx = args.indexOf("-crf");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("22"); // series CRF
  });

  it("encode action includes -preset medium", () => {
    const args = buildArgs(makePlan({ videoAction: "encode" }), caps7);
    const idx = args.indexOf("-preset");
    expect(args[idx + 1]).toBe("medium");
  });

  it("encode action includes -pix_fmt yuv420p10le", () => {
    const args = buildArgs(makePlan({ videoAction: "encode" }), caps7);
    const idx = args.indexOf("-pix_fmt");
    expect(args[idx + 1]).toBe("yuv420p10le");
  });

  it("encode action includes -fps_mode passthrough for FFmpeg 7", () => {
    const plan = makePlan({ videoAction: "encode", fpsModeFlag: "-fps_mode" });
    const args = buildArgs(plan, caps7);
    expect(args).toContain("-fps_mode");
    expect(args).toContain("passthrough");
  });

  it("encode action includes -vsync passthrough for FFmpeg 4.4", () => {
    const plan = makePlan({ videoAction: "encode", fpsModeFlag: "-vsync" });
    const args = buildArgs(plan, caps44);
    expect(args).toContain("-vsync");
    expect(args).toContain("passthrough");
    expect(args).not.toContain("-fps_mode");
  });
});

describe("buildArgs — x265-params", () => {
  it("includes -x265-params when profile has x265Params", () => {
    const plan = makePlan({
      videoAction: "encode",
      profile: { ...PROFILES.anime },
    });
    const args = buildArgs(plan, caps7);
    const idx = args.indexOf("-x265-params");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toContain("aq-mode=3");
  });

  it("omits -x265-params when profile has no x265Params (series)", () => {
    const plan = makePlan({
      videoAction: "encode",
      profile: { ...PROFILES.series },
    });
    const args = buildArgs(plan, caps7);
    expect(args).not.toContain("-x265-params");
  });
});

describe("buildArgs — copy action", () => {
  it("copy action keeps all streams as copy (-c:a -c:s -c:t -c:v copy)", () => {
    const args = buildArgs(makePlan({ videoAction: "copy" }), caps7);
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
    expect(args[args.indexOf("-c:s") + 1]).toBe("copy");
    expect(args[args.indexOf("-c:t") + 1]).toBe("copy");
    expect(args).not.toContain("libx265");
  });

  it("copy action does NOT include -fps_mode or -vsync", () => {
    const args = buildArgs(makePlan({ videoAction: "copy" }), caps7);
    expect(args).not.toContain("-fps_mode");
    expect(args).not.toContain("-vsync");
  });
});

describe("buildArgs — branding", () => {
  it("branding enabled includes -metadata comment=Encoded by PrestonCash", () => {
    const args = buildArgs(makePlan({ brandingEnabled: true }), caps7);
    expect(args).toContain("-metadata");
    expect(args).toContain("comment=Encoded by PrestonCash");
    expect(args).toContain("encoding_tool=Encoded by PrestonCash");
  });

  it("branding disabled omits branding metadata", () => {
    const args = buildArgs(makePlan({ brandingEnabled: false }), caps7);
    expect(args).not.toContain("comment=Encoded by PrestonCash");
  });
});

describe("buildArgs — path safety", () => {
  it("source path with spaces is a single array element", () => {
    const plan = makePlan({
      sourceFile: "/media/my shows/Show Episode 01.mkv",
      partFile: "/media/my shows/Prestron-Encoded/Show Episode 01.mkv.part",
    });
    const args = buildArgs(plan, caps7);
    const iIdx = args.indexOf("-i");
    // Path with spaces must be one element, not split
    expect(args[iIdx + 1]).toBe("/media/my shows/Show Episode 01.mkv");
  });

  it("no argument element contains an embedded newline", () => {
    const args = buildArgs(makePlan(), caps7);
    for (const arg of args) {
      expect(arg).not.toContain("\n");
    }
  });
});
