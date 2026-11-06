import { describe, it, expect, vi, beforeEach } from "vitest";
import { runSampleEncode } from "../../../../src/core/ffmpeg/sampleRunner.js";
import type { MediaInfo } from "../../../../src/core/probe/index.js";
import type { EncodePlan } from "../../../../src/core/policy/planBuilder.js";
import type { FfmpegCapabilities } from "../../../../src/core/ffmpeg/capabilities.js";
import type { JournalStore } from "../../../../src/core/jobs/journalStore.js";

const mockExeca = vi.fn();
const mockStat = vi.fn();
const mockUnlink = vi.fn();
const mockProbeFile = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

vi.mock("node:fs/promises", () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  unlink: (...args: unknown[]) => mockUnlink(...args),
}));

vi.mock("../../../../src/core/probe/index.js", () => ({
  probeFile: (...args: unknown[]) => mockProbeFile(...args),
}));

const baseMediaInfo: MediaInfo = {
  path: "/media/sample.mkv",
  formatName: "matroska,webm",
  durationSecs: 1200,
  sizeBytes: 1_200_000_000,
  overallBitrateBps: 8_000_000,
  nonVideoSizeBytes: 120_000_000,
  video: {
    index: 0,
    codec: "h264",
    profile: "High",
    level: 41,
    pixFmt: "yuv420p",
    bitDepth: 8,
    width: 1920,
    height: 1080,
    displayAspectRatio: "16:9",
    sampleAspectRatio: "1:1",
    fps: 24,
    rFrameRate: "24/1",
    avgFrameRate: "24/1",
    isVfr: false,
    fieldOrder: "progressive",
    colorRange: "tv",
    colorSpace: "bt709",
    colorTransfer: "bt709",
    colorPrimaries: "bt709",
    isHdr10: false,
    isHlg: false,
    isDolbyVision: false,
    bitrateBps: 7_200_000,
    bitrateIsDerived: false,
    bpp: 0.145,
    rotation: 0,
  },
  audioStreams: [],
  subtitleStreams: [],
  attachmentCount: 0,
  chapterCount: 0,
  tags: {},
};

const basePlan: EncodePlan = {
  inputPath: "/media/sample.mkv",
  outputPath: "/media/Prestron-Encoded/sample.mkv",
  profile: "series",
  videoAction: "encode",
  videoCodec: "libx265",
  crf: 22,
  preset: "medium",
  pixFmt: "yuv420p10le",
  x265Params: [],
  audioAction: "copy",
  subtitleAction: "copy",
  reasons: [],
  warnings: [],
};

const baseCaps: FfmpegCapabilities = {
  ffmpegVersion: "7.0",
  encoders: new Set(["libx265"]),
  hwAccels: new Set(),
  filters: new Set(),
};

describe("runSampleEncode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlink.mockResolvedValue(undefined);
  });

  it("encodes sample, records history, and cleans up temp file", async () => {
    mockExeca.mockResolvedValue({
      exitCode: 0,
      stdout: "",
      stderr: "frame=  480 fps= 48 q=22.0 Lsize=    9000kB time=00:00:20.00 bitrate=3686.4kbits/s speed=2.0x",
    });
    mockStat.mockResolvedValue({ size: 9_000_000 });
    mockProbeFile.mockResolvedValue({
      ...baseMediaInfo,
      sizeBytes: 9_000_000,
      nonVideoSizeBytes: 1_000_000,
    });

    const recordEncodeHistory = vi.fn();
    const store = { recordEncodeHistory } as unknown as JournalStore;

    const result = await runSampleEncode(baseMediaInfo, basePlan, baseCaps, store, {
      sampleDurationSecs: 20,
      startOffsetSecs: 100,
    });

    expect(result.sourcePath).toBe("/media/sample.mkv");
    expect(result.sampleDurationSecs).toBe(20);
    expect(result.outputSampleBytes).toBe(9_000_000);
    expect(result.encodeSpeed).toMatch(/x$/);
    expect(recordEncodeHistory).toHaveBeenCalledTimes(1);
    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });

  it("cleans up temp file and throws when ffmpeg fails", async () => {
    mockExeca.mockRejectedValue(new Error("Sample encode failed"));

    const store = { recordEncodeHistory: vi.fn() } as unknown as JournalStore;

    await expect(
      runSampleEncode(baseMediaInfo, basePlan, baseCaps, store),
    ).rejects.toThrow(/Sample encode failed/);

    expect(mockUnlink).toHaveBeenCalledTimes(1);
  });
});
