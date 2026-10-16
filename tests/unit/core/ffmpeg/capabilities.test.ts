import { describe, it, expect } from "vitest";
import {
  parseVersion,
  detectLibx265,
  chooseFpsModeFlag,
  detectCapabilities,
  isSupportedVersion,
  FfmpegNotFoundError,
  FfmpegVersionError,
  FfmpegMissingLibx265Error,
  type ProcessRunner,
  type FfmpegVersion,
} from "../../../../src/core/ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Fixture version output strings
// ---------------------------------------------------------------------------

const FFMPEG_4_4_OUTPUT = `ffmpeg version 4.4.2-0ubuntu0.22.04.1 Copyright (c) 2000-2021 the FFmpeg developers
  built with gcc 11 (Ubuntu 11.4.0-1ubuntu1~22.04)
  configuration: --prefix=/usr --extra-version=0ubuntu0.22.04.1 --toolchain=hardened
  libavutil      56. 70.100 / 56. 70.100
`;

const FFMPEG_5_0_OUTPUT = `ffmpeg version 5.0.1 Copyright (c) 2000-2022 the FFmpeg developers
  built with gcc 12 (Ubuntu 12.3.0-1ubuntu1~23.04)
`;

const FFMPEG_5_1_OUTPUT = `ffmpeg version 5.1.4 Copyright (c) 2000-2023 the FFmpeg developers
  built with gcc 12 (Ubuntu 12.3.0)
`;

const FFMPEG_6_OUTPUT = `ffmpeg version 6.1.1-3ubuntu5 Copyright (c) 2000-2023 the FFmpeg developers
  built with gcc 13 (Ubuntu 13.2.0)
`;

const FFMPEG_7_OUTPUT = `ffmpeg version 7.0 Copyright (c) 2000-2024 the FFmpeg developers
  built with gcc 13 (Ubuntu 13.2.0)
`;

const FFMPEG_N_GIT_OUTPUT = `ffmpeg version N-112244-g8a2e02028c Copyright (c) 2000-2024 the FFmpeg developers
  built with gcc 14
`;

const FFMPEG_4_3_OUTPUT = `ffmpeg version 4.3.6-0+deb11u1 Copyright (c) 2000-2023 the FFmpeg developers
`;

const ENCODERS_WITH_X265 = `Encoders:
 V..... = Video
 A..... = Audio
 S..... = Subtitle
 .F.... = Frame-level multithreading
 ..S... = Slice-level multithreading
 ...X.. = Codec is experimental
 ....B. = Supports draw_horiz_band
 .....D = Supports direct rendering method 1
 ------
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`;

const ENCODERS_WITHOUT_X265 = `Encoders:
 ------
 V....D libvpx-vp9           libvpx VP9 (codec vp9)
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
`;

// ---------------------------------------------------------------------------
// parseVersion
// ---------------------------------------------------------------------------

describe("parseVersion", () => {
  it("parses FFmpeg 4.4.2 (apt Ubuntu format)", () => {
    const v = parseVersion(FFMPEG_4_4_OUTPUT);
    expect(v).toMatchObject({ major: 4, minor: 4, patch: 2 });
    expect(v?.raw).toBe("4.4.2-0ubuntu0.22.04.1");
  });

  it("parses FFmpeg 5.0.1", () => {
    const v = parseVersion(FFMPEG_5_0_OUTPUT);
    expect(v).toMatchObject({ major: 5, minor: 0, patch: 1 });
  });

  it("parses FFmpeg 5.1.4", () => {
    const v = parseVersion(FFMPEG_5_1_OUTPUT);
    expect(v).toMatchObject({ major: 5, minor: 1, patch: 4 });
  });

  it("parses FFmpeg 6.1.1", () => {
    const v = parseVersion(FFMPEG_6_OUTPUT);
    expect(v).toMatchObject({ major: 6, minor: 1, patch: 1 });
  });

  it("parses FFmpeg 7.0", () => {
    const v = parseVersion(FFMPEG_7_OUTPUT);
    expect(v).toMatchObject({ major: 7, minor: 0, patch: 0 });
  });

  it("parses FFmpeg git snapshot with N- prefix as major=99 (latest sentinel)", () => {
    const v = parseVersion(FFMPEG_N_GIT_OUTPUT);
    expect(v).not.toBeNull();
    expect(v?.major).toBe(99);
    expect(v?.raw).toBe("N-112244-g8a2e02028c");
  });

  it("returns null for empty string", () => {
    expect(parseVersion("")).toBeNull();
  });

  it("returns null for unrecognised output", () => {
    expect(parseVersion("not ffmpeg output at all")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isSupportedVersion
// ---------------------------------------------------------------------------

describe("isSupportedVersion", () => {
  const v = (major: number, minor: number, patch = 0): FfmpegVersion => ({
    major,
    minor,
    patch,
    raw: `${String(major)}.${String(minor)}.${String(patch)}`,
  });

  it("accepts 4.4.0 (minimum)", () => {
    expect(isSupportedVersion(v(4, 4, 0))).toBe(true);
  });

  it("accepts 4.4.2", () => {
    expect(isSupportedVersion(v(4, 4, 2))).toBe(true);
  });

  it("rejects 4.3.6 (below minimum minor)", () => {
    expect(isSupportedVersion(v(4, 3, 6))).toBe(false);
  });

  it("rejects 3.4.0 (below minimum major)", () => {
    expect(isSupportedVersion(v(3, 4, 0))).toBe(false);
  });

  it("accepts 5.0.0", () => {
    expect(isSupportedVersion(v(5, 0, 0))).toBe(true);
  });

  it("accepts 7.0.0", () => {
    expect(isSupportedVersion(v(7, 0, 0))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// detectLibx265
// ---------------------------------------------------------------------------

describe("detectLibx265", () => {
  it("returns true when libx265 is listed", () => {
    expect(detectLibx265(ENCODERS_WITH_X265)).toBe(true);
  });

  it("returns false when libx265 is not listed", () => {
    expect(detectLibx265(ENCODERS_WITHOUT_X265)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(detectLibx265("")).toBe(false);
  });

  it("does not match 'libx264' as libx265", () => {
    expect(detectLibx265(" V....D libx264 ...")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// chooseFpsModeFlag
// ---------------------------------------------------------------------------

describe("chooseFpsModeFlag", () => {
  const v = (major: number, minor: number): FfmpegVersion => ({
    major,
    minor,
    patch: 0,
    raw: `${String(major)}.${String(minor)}.0`,
  });

  it("uses -vsync for FFmpeg 4.4", () => {
    expect(chooseFpsModeFlag(v(4, 4))).toBe("-vsync");
  });

  it("uses -vsync for FFmpeg 5.0", () => {
    expect(chooseFpsModeFlag(v(5, 0))).toBe("-vsync");
  });

  it("uses -fps_mode for FFmpeg 5.1", () => {
    expect(chooseFpsModeFlag(v(5, 1))).toBe("-fps_mode");
  });

  it("uses -fps_mode for FFmpeg 5.2", () => {
    expect(chooseFpsModeFlag(v(5, 2))).toBe("-fps_mode");
  });

  it("uses -fps_mode for FFmpeg 6.x", () => {
    expect(chooseFpsModeFlag(v(6, 0))).toBe("-fps_mode");
  });

  it("uses -fps_mode for FFmpeg 7.x", () => {
    expect(chooseFpsModeFlag(v(7, 0))).toBe("-fps_mode");
  });
});

// ---------------------------------------------------------------------------
// detectCapabilities (integration with fake runner)
// ---------------------------------------------------------------------------

function makeRunner(versionOutput: string, encodersOutput: string): ProcessRunner {
  return {
    run(_binary, args) {
      if (args.includes("-version")) {
        return Promise.resolve({ stdout: versionOutput, stderr: "", exitCode: 0 });
      }
      if (args.includes("-encoders")) {
        return Promise.resolve({ stdout: encodersOutput, stderr: "", exitCode: 0 });
      }
      return Promise.resolve({ stdout: "", stderr: "", exitCode: 0 });
    },
  };
}

function throwingRunner(): ProcessRunner {
  return {
    run() {
      return Promise.reject(new Error("ENOENT: ffmpeg not found"));
    },
  };
}

describe("detectCapabilities", () => {
  it("detects FFmpeg 4.4 with libx265 → vsync flag", async () => {
    const runner = makeRunner(FFMPEG_4_4_OUTPUT, ENCODERS_WITH_X265);
    const caps = await detectCapabilities(runner);
    expect(caps.version.major).toBe(4);
    expect(caps.version.minor).toBe(4);
    expect(caps.hasLibx265).toBe(true);
    expect(caps.fpsModeFlag).toBe("-vsync");
    expect(caps.fpsModeValue).toBe("passthrough");
  });

  it("detects FFmpeg 7.0 with libx265 → fps_mode flag", async () => {
    const runner = makeRunner(FFMPEG_7_OUTPUT, ENCODERS_WITH_X265);
    const caps = await detectCapabilities(runner);
    expect(caps.version.major).toBe(7);
    expect(caps.fpsModeFlag).toBe("-fps_mode");
  });

  it("detects FFmpeg 5.1 → fps_mode flag", async () => {
    const runner = makeRunner(FFMPEG_5_1_OUTPUT, ENCODERS_WITH_X265);
    const caps = await detectCapabilities(runner);
    expect(caps.fpsModeFlag).toBe("-fps_mode");
  });

  it("detects FFmpeg 5.0 → vsync flag", async () => {
    const runner = makeRunner(FFMPEG_5_0_OUTPUT, ENCODERS_WITH_X265);
    const caps = await detectCapabilities(runner);
    expect(caps.fpsModeFlag).toBe("-vsync");
  });

  it("throws FfmpegNotFoundError when ffmpeg binary is missing", async () => {
    const runner = throwingRunner();
    await expect(detectCapabilities(runner)).rejects.toBeInstanceOf(FfmpegNotFoundError);
  });

  it("throws FfmpegVersionError for FFmpeg 4.3 (below minimum)", async () => {
    const runner = makeRunner(FFMPEG_4_3_OUTPUT, ENCODERS_WITH_X265);
    await expect(detectCapabilities(runner)).rejects.toBeInstanceOf(FfmpegVersionError);
  });

  it("throws FfmpegMissingLibx265Error when libx265 is absent", async () => {
    const runner = makeRunner(FFMPEG_7_OUTPUT, ENCODERS_WITHOUT_X265);
    await expect(detectCapabilities(runner)).rejects.toBeInstanceOf(FfmpegMissingLibx265Error);
  });

  it("FfmpegNotFoundError has exitCode 3", async () => {
    const runner = throwingRunner();
    try {
      await detectCapabilities(runner);
    } catch (err) {
      expect((err as FfmpegNotFoundError).exitCode).toBe(3);
    }
  });

  it("FfmpegMissingLibx265Error message contains apt install hint", async () => {
    const runner = makeRunner(FFMPEG_7_OUTPUT, ENCODERS_WITHOUT_X265);
    try {
      await detectCapabilities(runner);
    } catch (err) {
      expect((err as FfmpegMissingLibx265Error).message).toContain("sudo apt install ffmpeg");
    }
  });
});
