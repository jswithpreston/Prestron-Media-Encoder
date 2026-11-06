/**
 * Tests for FilesScreen and InfoScreen components.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { FilesScreen } from "../../../src/ui/components/FilesScreen.js";
import { InfoScreen } from "../../../src/ui/components/InfoScreen.js";
import type { BatchFile } from "../../../src/ui/hooks/useBatch.js";
import type { MediaInfo } from "../../../src/core/probe/index.js";

function patchStdin(stdin: Record<string, unknown>): void {
  stdin["ref"] ??= () => {
    /* no-op stub */
  };
  stdin["unref"] ??= () => {
    /* no-op stub */
  };
}

const mockMediaInfo: MediaInfo = {
  container: "matroska",
  durationSecs: 3600,
  sizeBytes: 1024 * 1024 * 1024, // 1 GB
  bitrateKbps: 2275,
  overallBitrateKbps: 2275,
  formatName: "matroska,webm",
  video: {
    codec: "h264",
    profile: "High",
    level: "4.1",
    pixelFormat: "yuv420p",
    bitDepth: 8,
    width: 1920,
    height: 1080,
    displayAspectRatio: "16:9",
    sampleAspectRatio: "1:1",
    fps: 24,
    fieldOrder: "progressive",
    isInterlaced: false,
    colorRange: "tv",
    colorSpace: "bt709",
    colorTransfer: "bt709",
    colorPrimaries: "bt709",
    isHdr: false,
    isDolbyVision: false,
    isVfr: false,
    bitrateKbps: 2000,
    isBitrateDerived: false,
    bpp: 0.040,
  },
  audio: [
    {
      index: 1,
      codec: "aac",
      channels: 2,
      channelLayout: "stereo",
      sampleRate: 48000,
      bitrateKbps: 192,
      language: "eng",
      title: "English Stereo",
      isDefault: true,
      isForced: false,
    },
  ],
  subtitles: [
    {
      index: 2,
      codec: "subrip",
      formatType: "text",
      language: "eng",
      title: "English SDH",
      isDefault: false,
      isForced: false,
    },
  ],
  attachments: [],
  chapters: [],
  containerOverheadBytes: 1024,
  nonVideoSizeBytes: 86400000 + 1024, // audio + overhead
};

const mockFile: BatchFile = {
  path: "/videos/Show.S01E01.mkv",
  sourceSizeBytes: 1024 * 1024 * 1024,
  sourceMtimeMs: Date.now(),
  mediaInfo: mockMediaInfo,
  plan: null,
  phase: "pending",
  progress: null,
  outputSizeBytes: null,
  error: null,
};

describe("FilesScreen component", () => {
  it("renders files browser table with headers and file rows", () => {
    const onSelectFile = vi.fn();
    const onClose = vi.fn();

    const instance = render(
      React.createElement(FilesScreen, {
        files: [mockFile],
        currentProfile: "series",
        onSelectFile,
        onClose,
      }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("Files Browser (1 files)");
    expect(frame).toContain("Filename");
    expect(frame).toContain("Res/Codec");
    expect(frame).toContain("Show.S01E01.mkv");
    expect(frame).toContain("1080p h264");
    expect(frame).toContain("[MARGIN]"); // 0.04 bpp H.264 is marginal
  });

  it("renders empty notice if files array is empty", () => {
    const instance = render(
      React.createElement(FilesScreen, {
        files: [],
        currentProfile: "series",
        onSelectFile: vi.fn(),
        onClose: vi.fn(),
      }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("No files to display. Run /scan first.");
  });
});

describe("InfoScreen component", () => {
  it("renders deep source analysis, video streams, audio, recommendation and estimates", () => {
    const onClose = vi.fn();

    const instance = render(
      React.createElement(InfoScreen, {
        file: mockFile,
        fileIndex: 0,
        totalFiles: 1,
        currentProfile: "series",
        onClose,
      }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    const frame = instance.lastFrame() ?? "";

    expect(frame).toContain("Deep Source Analysis [1/1]: Show.S01E01.mkv");
    expect(frame).toContain("Container & Metadata:");
    expect(frame).toContain("1920x1080");
    expect(frame).toContain("H264");
    expect(frame).toContain("Audio (1 stream)");
    expect(frame).toContain("English Stereo");
    expect(frame).toContain("Subtitles (1 stream)");
    expect(frame).toContain("Recommendation:");
    expect(frame).toContain("Estimated Storage Savings:");
  });
});
