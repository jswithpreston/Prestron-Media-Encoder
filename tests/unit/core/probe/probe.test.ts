import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeFile, ProbeError } from "../../../../src/core/probe/index.js";
import type { ProcessRunner } from "../../../../src/core/ffmpeg/capabilities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "../../../fixtures/ffprobe");

function fixtureRunner(fixtureName: string): ProcessRunner {
  const content = readFileSync(join(FIXTURES, fixtureName), "utf8");
  return {
    run() {
      return Promise.resolve({ stdout: content, stderr: "", exitCode: 0 });
    },
  };
}

function errorRunner(stderr = "some error", exitCode = 1): ProcessRunner {
  return {
    run() {
      return Promise.resolve({ stdout: "", stderr, exitCode });
    },
  };
}

function hangingRunner(): ProcessRunner {
  return {
    run() {
      return new Promise(() => {
        /* never resolves */
      });
    },
  };
}

describe("probeFile — normal.json", () => {
  it("returns correct video info", async () => {
    const info = await probeFile("/fake/show_s01e01.mkv", fixtureRunner("normal.json"));
    expect(info.video.codec).toBe("h264");
    expect(info.video.width).toBe(1920);
    expect(info.video.height).toBe(1080);
    expect(info.video.fps).toBeCloseTo(23.976, 2);
    expect(info.video.isHdr).toBe(false);
    expect(info.video.isDolbyVision).toBe(false);
    expect(info.video.bitDepth).toBe(8);
    expect(info.video.isVfr).toBe(false);
  });

  it("returns correct audio streams", async () => {
    const info = await probeFile("/fake/show_s01e01.mkv", fixtureRunner("normal.json"));
    expect(info.audio).toHaveLength(2);
    expect(info.audio[0]?.codec).toBe("aac");
    expect(info.audio[0]?.language).toBe("eng");
    expect(info.audio[1]?.codec).toBe("ac3");
    expect(info.audio[1]?.channels).toBe(6);
  });

  it("returns correct subtitle streams", async () => {
    const info = await probeFile("/fake/show_s01e01.mkv", fixtureRunner("normal.json"));
    expect(info.subtitles).toHaveLength(1);
    expect(info.subtitles[0]?.codec).toBe("subrip");
    expect(info.subtitles[0]?.language).toBe("eng");
  });

  it("returns duration, size and bitrate", async () => {
    const info = await probeFile("/fake/show_s01e01.mkv", fixtureRunner("normal.json"));
    expect(info.durationSecs).toBe(2700);
    expect(info.sizeBytes).toBe(4_294_967_296);
    expect(info.bitrateKbps).toBe(12_000);
  });

  it("returns chapter count of 0", async () => {
    const info = await probeFile("/fake/show_s01e01.mkv", fixtureRunner("normal.json"));
    expect(info.chapterCount).toBe(0);
  });
});

describe("probeFile — hdr.json", () => {
  it("detects HDR via smpte2084 color transfer", async () => {
    const info = await probeFile("/fake/movie_4k_hdr.mkv", fixtureRunner("hdr.json"));
    expect(info.video.isHdr).toBe(true);
    expect(info.video.colorTransfer).toBe("smpte2084");
    expect(info.video.colorPrimaries).toBe("bt2020");
  });

  it("returns 10-bit depth from bits_per_raw_sample", async () => {
    const info = await probeFile("/fake/movie_4k_hdr.mkv", fixtureRunner("hdr.json"));
    expect(info.video.bitDepth).toBe(10);
  });

  it("returns chapter count of 2", async () => {
    const info = await probeFile("/fake/movie_4k_hdr.mkv", fixtureRunner("hdr.json"));
    expect(info.chapterCount).toBe(2);
  });

  it("returns 4K resolution", async () => {
    const info = await probeFile("/fake/movie_4k_hdr.mkv", fixtureRunner("hdr.json"));
    expect(info.video.width).toBe(3840);
    expect(info.video.height).toBe(2160);
  });
});

describe("probeFile — anime.json", () => {
  it("detects Japanese audio", async () => {
    const info = await probeFile("/fake/show_07.mkv", fixtureRunner("anime.json"));
    const jpn = info.audio.find((a) => a.language === "jpn");
    expect(jpn).toBeDefined();
  });

  it("detects ASS subtitles", async () => {
    const info = await probeFile("/fake/show_07.mkv", fixtureRunner("anime.json"));
    const ass = info.subtitles.find((s) => s.codec === "ass");
    expect(ass).toBeDefined();
  });

  it("detects 1 attachment (font)", async () => {
    const info = await probeFile("/fake/show_07.mkv", fixtureRunner("anime.json"));
    expect(info.attachmentCount).toBe(1);
  });
});

describe("probeFile — error cases", () => {
  it("throws ProbeError when ffprobe exits non-zero", async () => {
    await expect(probeFile("/fake/bad.mkv", errorRunner("No such file", 1))).rejects.toBeInstanceOf(
      ProbeError,
    );
  });

  it("throws ProbeError for empty JSON (corrupt fixture)", async () => {
    // corrupt.json is {} — has no streams array, so zod fills with default []
    // but then there's no video stream → ProbeError
    await expect(
      probeFile("/fake/corrupt.mkv", fixtureRunner("corrupt.json")),
    ).rejects.toBeInstanceOf(ProbeError);
  });

  it("throws ProbeError with the file path in the message", async () => {
    try {
      await probeFile("/fake/corrupt.mkv", errorRunner("error", 1));
    } catch (err) {
      expect((err as ProbeError).message).toContain("corrupt.mkv");
    }
  });

  it("throws ProbeError on timeout", async () => {
    await expect(
      probeFile("/fake/hang.mkv", hangingRunner(), { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(ProbeError);
  });
});
