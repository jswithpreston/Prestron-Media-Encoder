/**
 * Unit tests: verifyOutput
 *
 * Uses a mock ProcessRunner that returns pre-configured responses.
 * Each test exercises a different check path (ok path + each failure mode).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { verifyOutput, type VerifyOptions } from "../../../../src/core/verify/index.js";
import type { ProcessRunner } from "../../../../src/core/ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(async () => {
  tmpDir = join(tmpdir(), `prestron-verify-test-${String(Date.now())}`);
  await mkdir(tmpDir, { recursive: true });
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

/** Create a fake .part file of the given size. */
async function makePartFile(name: string, sizeBytes = 1024): Promise<string> {
  const p = join(tmpDir, name);
  await writeFile(p, Buffer.alloc(sizeBytes, 0x01));
  return p;
}

/** Minimal valid ffprobe JSON that verifyOutput calls probeFile with. */
function ffprobeJson(overrides: {
  codec?: string;
  width?: number;
  height?: number;
  audioCount?: number;
  subtitleCount?: number;
  chapters?: number;
  durationSecs?: number;
  isHdr?: boolean;
}): string {
  const {
    codec = "hevc",
    width = 1280,
    height = 720,
    audioCount = 2,
    subtitleCount = 1,
    chapters = 2,
    durationSecs = 4.0,
    isHdr = false,
  } = overrides;

  const audioStreams = Array.from({ length: audioCount }, (_, i) => ({
    index: i + 1,
    codec_type: "audio",
    codec_name: "aac",
    channels: 2,
    tags: {},
  }));

  const subtitleStreams = Array.from({ length: subtitleCount }, (_, i) => ({
    index: audioCount + i + 1,
    codec_type: "subtitle",
    codec_name: "subrip",
    tags: {},
  }));

  const chapterList = Array.from({ length: chapters }, (_, i) => ({
    id: i,
    start_time: String(i * 2),
    end_time: String((i + 1) * 2),
    tags: {},
  }));

  return JSON.stringify({
    streams: [
      {
        index: 0,
        codec_type: "video",
        codec_name: codec,
        width,
        height,
        r_frame_rate: "24/1",
        avg_frame_rate: "24/1",
        pix_fmt: "yuv420p10le",
        color_transfer: isHdr ? "smpte2084" : "bt709",
        tags: {},
      },
      ...audioStreams,
      ...subtitleStreams,
    ],
    format: {
      duration: String(durationSecs),
      size: "1048576",
      bit_rate: "2000000",
      format_name: "matroska,webm",
      tags: {},
    },
    chapters: chapterList,
  });
}

/** Default VerifyOptions matching the ffprobeJson defaults. */
const defaultOpts: VerifyOptions = {
  sourceDurationSecs: 4.0,
  sourceAudioCount: 2,
  sourceSubtitleCount: 1,
  sourceChapterCount: 2,
  sourceIsHdr: false,
  sourceWidth: 1280,
  sourceHeight: 720,
};

/** Build a mock runner with configurable probe output and decode result. */
function mockRunner(opts: {
  probeJson?: string;
  decodeExitCode?: number;
  decodeStderr?: string;
}): ProcessRunner {
  const probeJson = opts.probeJson ?? ffprobeJson({});
  const decodeExitCode = opts.decodeExitCode ?? 0;
  const decodeStderr = opts.decodeStderr ?? "";
  return {
    run(_binary: string, args: string[]) {
      // Detect decode test: last arg is "-"
      if (args[args.length - 1] === "-") {
        return Promise.resolve({ stdout: "", stderr: decodeStderr, exitCode: decodeExitCode });
      }
      // Otherwise it's ffprobe
      return Promise.resolve({ stdout: probeJson, stderr: "", exitCode: 0 });
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("verifyOutput — ok path", () => {
  it("passes all 10 checks on a valid output file", async () => {
    const part = await makePartFile("ok.mkv.part");
    const runner = mockRunner({});
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(true);
    expect(result.failedCheck).toBeUndefined();
  });
});

describe("verifyOutput — check 1: file-not-found", () => {
  it("fails when the .part file does not exist", async () => {
    const runner = mockRunner({});
    const result = await verifyOutput(join(tmpDir, "nonexistent.part"), runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("file-not-found");
  });
});

describe("verifyOutput — check 1: file-size-zero", () => {
  it("fails when the .part file is empty", async () => {
    const part = await makePartFile("empty.mkv.part", 0);
    const runner = mockRunner({});
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("file-size-zero");
  });
});

describe("verifyOutput — check 4: resolution-mismatch", () => {
  it("fails when output resolution differs from source", async () => {
    const part = await makePartFile("res-mismatch.mkv.part");
    const runner = mockRunner({ probeJson: ffprobeJson({ width: 640, height: 360 }) });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("resolution-mismatch");
  });
});

describe("verifyOutput — check 5: audio-count-mismatch", () => {
  it("fails when output has fewer audio tracks than source", async () => {
    const part = await makePartFile("audio-mismatch.mkv.part");
    const runner = mockRunner({ probeJson: ffprobeJson({ audioCount: 1 }) });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("audio-count-mismatch");
  });
});

describe("verifyOutput — check 6: subtitle-count-mismatch", () => {
  it("fails when output has fewer subtitle tracks than source", async () => {
    const part = await makePartFile("sub-mismatch.mkv.part");
    const runner = mockRunner({ probeJson: ffprobeJson({ subtitleCount: 0 }) });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("subtitle-count-mismatch");
  });
});

describe("verifyOutput — check 7: chapter-count-mismatch", () => {
  it("fails when output has wrong chapter count", async () => {
    const part = await makePartFile("chapter-mismatch.mkv.part");
    const runner = mockRunner({ probeJson: ffprobeJson({ chapters: 1 }) });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("chapter-count-mismatch");
  });
});

describe("verifyOutput — check 7b: chapter-timestamp-mismatch", () => {
  it("succeeds when chapter timestamps are within 100 ms tolerance", async () => {
    const part = await makePartFile("chapter-ts-ok.mkv.part");
    // defaultOpts chapters are at [0, 2] and [2, 4]
    // output shifted by 50 ms (0.05 s) — within 100 ms tolerance
    const runner = mockRunner({
      probeJson: JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: "hevc",
            width: 1280,
            height: 720,
            r_frame_rate: "24/1",
            avg_frame_rate: "24/1",
            pix_fmt: "yuv420p10le",
            color_transfer: "bt709",
            tags: {},
          },
          { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, tags: {} },
          { index: 2, codec_type: "audio", codec_name: "aac", channels: 2, tags: {} },
          { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: {} },
        ],
        format: { duration: "4.0", size: "1048576", bit_rate: "2000000", format_name: "matroska" },
        chapters: [
          { id: 0, start_time: "0.05", end_time: "2.05", tags: {} },
          { id: 1, start_time: "2.05", end_time: "4.05", tags: {} },
        ],
      }),
    });
    const result = await verifyOutput(part, runner, {
      ...defaultOpts,
      sourceChapters: [
        { id: 0, startTimeSecs: 0.0, endTimeSecs: 2.0 },
        { id: 1, startTimeSecs: 2.0, endTimeSecs: 4.0 },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it("fails when chapter timestamps differ by more than 100 ms tolerance", async () => {
    const part = await makePartFile("chapter-ts-fail.mkv.part");
    // output shifted by 200 ms (0.2 s) — exceeds 100 ms tolerance
    const runner = mockRunner({
      probeJson: JSON.stringify({
        streams: [
          {
            index: 0,
            codec_type: "video",
            codec_name: "hevc",
            width: 1280,
            height: 720,
            r_frame_rate: "24/1",
            avg_frame_rate: "24/1",
            pix_fmt: "yuv420p10le",
            color_transfer: "bt709",
            tags: {},
          },
          { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, tags: {} },
          { index: 2, codec_type: "audio", codec_name: "aac", channels: 2, tags: {} },
          { index: 3, codec_type: "subtitle", codec_name: "subrip", tags: {} },
        ],
        format: { duration: "4.0", size: "1048576", bit_rate: "2000000", format_name: "matroska" },
        chapters: [
          { id: 0, start_time: "0.25", end_time: "2.25", tags: {} },
          { id: 1, start_time: "2.25", end_time: "4.25", tags: {} },
        ],
      }),
    });
    const result = await verifyOutput(part, runner, {
      ...defaultOpts,
      sourceChapters: [
        { id: 0, startTimeSecs: 0.0, endTimeSecs: 2.0 },
        { id: 1, startTimeSecs: 2.0, endTimeSecs: 4.0 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("chapter-timestamp-mismatch");
  });
});

describe("verifyOutput — check 8: duration-mismatch", () => {
  it("fails when output duration is outside tolerance", async () => {
    const part = await makePartFile("dur-mismatch.mkv.part");
    // Source is 4s but output is 10s — way outside 1.5s tolerance
    const runner = mockRunner({ probeJson: ffprobeJson({ durationSecs: 10.0 }) });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("duration-mismatch");
  });
});

describe("verifyOutput — check 9: hdr-lost", () => {
  it("fails when source is HDR but output is not", async () => {
    const part = await makePartFile("hdr-lost.mkv.part");
    const runner = mockRunner({ probeJson: ffprobeJson({ isHdr: false }) });
    const result = await verifyOutput(part, runner, {
      ...defaultOpts,
      sourceIsHdr: true,
    });
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("hdr-lost");
  });
});

describe("verifyOutput — check 10: decode-test-failed", () => {
  it("fails when ffmpeg decode test exits non-zero", async () => {
    const part = await makePartFile("decode-fail.mkv.part");
    const runner = mockRunner({ decodeExitCode: 1, decodeStderr: "error: something" });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("decode-test-failed");
  });

  it("fails when ffmpeg decode test has non-empty stderr even on exit 0", async () => {
    const part = await makePartFile("decode-warn.mkv.part");
    const runner = mockRunner({ decodeExitCode: 0, decodeStderr: "corrupt frame at 00:00:01" });
    const result = await verifyOutput(part, runner, defaultOpts);
    expect(result.ok).toBe(false);
    expect(result.failedCheck).toBe("decode-test-failed");
  });
});
