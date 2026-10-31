/**
 * Script to capture text frames using ink-testing-library.
 * Renders the 7 requested UI states:
 *   1. Startup
 *   2. Slash list open
 *   3. /encode panel
 *   4. Confirm prompt
 *   5. Encoding in progress
 *   6. Results
 *   7. Empty folder
 */

import React from "react";
import { render } from "ink-testing-library";
import { Box, Text } from "ink";

import { Banner, CompactHeader } from "../src/ui/components/Banner.js";
import { StartupCard } from "../src/ui/components/StartupCard.js";
import { StatusBar } from "../src/ui/components/StatusBar.js";
import { SessionInput } from "../src/ui/components/SessionInput.js";
import { SlashPalette } from "../src/ui/components/SlashPalette.js";
import { InlineEncodePanel } from "../src/ui/components/InlineEncodePanel.js";
import { LiveProgressLine } from "../src/ui/components/LiveProgressLine.js";
import { ResultsTable } from "../src/ui/components/ResultsTable.js";
import type { BatchFile } from "../src/ui/hooks/useBatch.js";

const mockFfmpegCaps = {
  version: "7.0-static",
  libx265Available: true,
  nvencAvailable: true,
  qsvAvailable: false,
  vaapiAvailable: false,
  vmafAvailable: true,
  supportedPixFmts: ["yuv420p", "yuv420p10le"],
};

const mockFiles: BatchFile[] = [
  {
    path: "/media/TV/Breaking Bad/Season 1/S01E01 - Pilot.mkv",
    sourceSizeBytes: 2_450_000_000,
    sourceMtimeMs: Date.now(),
    mediaInfo: {
      format: "matroska",
      durationSecs: 3480,
      sizeBytes: 2_450_000_000,
      bitrateBps: 5_600_000,
      video: {
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 23.976,
        pixFmt: "yuv420p",
        colorPrimaries: "bt709",
        colorTransfer: "bt709",
        colorSpace: "bt709",
        isHdr: false,
        bitrateBps: 5_000_000,
      },
      audio: [{ index: 1, codec: "aac", channels: 6, sampleRateHz: 48000, isDefault: true }],
      subtitles: [],
      chapterCount: 0,
      chapters: [],
    },
    plan: {
      sourceFile: "/media/TV/Breaking Bad/Season 1/S01E01 - Pilot.mkv",
      outputFile: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E01 - Pilot.mkv",
      partFile: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E01 - Pilot.mkv.part",
      estimatedOutputDir: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded",
      video: { encoder: "libx265", crf: 22, preset: "medium", pixFmt: "yuv420p10le" },
      audio: [],
      subtitles: [],
      reasons: ["Re-encoding AVC to HEVC for space savings"],
      warnings: [],
    },
    phase: "pending",
    progress: null,
    outputSizeBytes: null,
    error: null,
  },
  {
    path: "/media/TV/Breaking Bad/Season 1/S01E02 - Cat's in the Bag.mkv",
    sourceSizeBytes: 1_980_000_000,
    sourceMtimeMs: Date.now(),
    mediaInfo: {
      format: "matroska",
      durationSecs: 2880,
      sizeBytes: 1_980_000_000,
      bitrateBps: 5_500_000,
      video: {
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 23.976,
        pixFmt: "yuv420p",
        colorPrimaries: "bt709",
        colorTransfer: "bt709",
        colorSpace: "bt709",
        isHdr: false,
        bitrateBps: 4_900_000,
      },
      audio: [{ index: 1, codec: "aac", channels: 6, sampleRateHz: 48000, isDefault: true }],
      subtitles: [],
      chapterCount: 0,
      chapters: [],
    },
    plan: {
      sourceFile: "/media/TV/Breaking Bad/Season 1/S01E02 - Cat's in the Bag.mkv",
      outputFile: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E02 - Cat's in the Bag.mkv",
      partFile: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E02 - Cat's in the Bag.mkv.part",
      estimatedOutputDir: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded",
      video: { encoder: "libx265", crf: 22, preset: "medium", pixFmt: "yuv420p10le" },
      audio: [],
      subtitles: [],
      reasons: ["Re-encoding AVC to HEVC"],
      warnings: [],
    },
    phase: "pending",
    progress: null,
    outputSizeBytes: null,
    error: null,
  },
  {
    path: "/media/TV/Breaking Bad/Season 1/S01E03 - And the Bag's in the River.mkv",
    sourceSizeBytes: 2_100_000_000,
    sourceMtimeMs: Date.now(),
    mediaInfo: {
      format: "matroska",
      durationSecs: 2940,
      sizeBytes: 2_100_000_000,
      bitrateBps: 5_700_000,
      video: {
        codec: "h264",
        width: 1920,
        height: 1080,
        fps: 23.976,
        pixFmt: "yuv420p",
        colorPrimaries: "bt709",
        colorTransfer: "bt709",
        colorSpace: "bt709",
        isHdr: false,
        bitrateBps: 5_100_000,
      },
      audio: [{ index: 1, codec: "aac", channels: 6, sampleRateHz: 48000, isDefault: true }],
      subtitles: [],
      chapterCount: 0,
      chapters: [],
    },
    plan: {
      sourceFile: "/media/TV/Breaking Bad/Season 1/S01E03 - And the Bag's in the River.mkv",
      outputFile: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E03 - And the Bag's in the River.mkv",
      partFile: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E03 - And the Bag's in the River.mkv.part",
      estimatedOutputDir: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded",
      video: { encoder: "libx265", crf: 22, preset: "medium", pixFmt: "yuv420p10le" },
      audio: [],
      subtitles: [],
      reasons: ["Re-encoding AVC to HEVC"],
      warnings: [],
    },
    phase: "pending",
    progress: null,
    outputSizeBytes: null,
    error: null,
  },
];

function patchStdin(stdin: any) {
  stdin.ref ??= () => {};
  stdin.unref ??= () => {};
}

// ---------------------------------------------------------------------------
// 1. Startup State
// ---------------------------------------------------------------------------
console.log("=== STATE 1: STARTUP ===");
const startup = render(
  <Box flexDirection="column">
    <Banner version="0.1.0-alpha.3" columns={80} isUtf8={true} hasColor={false} />
    <StartupCard
      rootDir="/media/TV/Breaking Bad/Season 1"
      files={mockFiles}
      ffmpegCaps={mockFfmpegCaps}
    />
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} />
    <StatusBar profile="series" fileCount={3} mouseActive={false} />
  </Box>
);
patchStdin(startup.stdin);
console.log(startup.lastFrame());
startup.unmount();

// ---------------------------------------------------------------------------
// 2. Slash List Open State
// ---------------------------------------------------------------------------
console.log("\n=== STATE 2: SLASH LIST OPEN ===");
const slash = render(
  <Box flexDirection="column">
    <CompactHeader version="0.1.0-alpha.3" rootDir="/media/TV/Breaking Bad/Season 1" />
    <SlashPalette onCommand={() => {}} mouseEnabled={false} filterQuery="/" />
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} />
    <StatusBar profile="series" fileCount={3} mouseActive={false} />
  </Box>
);
patchStdin(slash.stdin);
console.log(slash.lastFrame());
slash.unmount();

// ---------------------------------------------------------------------------
// 3. /encode Panel State (Checklist with plan details)
// ---------------------------------------------------------------------------
console.log("\n=== STATE 3: /ENCODE PANEL ===");
const encodePanel = render(
  <Box flexDirection="column">
    <CompactHeader version="0.1.0-alpha.3" rootDir="/media/TV/Breaking Bad/Season 1" />
    <InlineEncodePanel
      files={mockFiles}
      profile="series"
      onConfirm={() => {}}
      onCancel={() => {}}
      mouseEnabled={true}
    />
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} disabled={true} />
    <StatusBar profile="series" fileCount={3} mouseActive={true} />
  </Box>
);
patchStdin(encodePanel.stdin);
console.log(encodePanel.lastFrame());
encodePanel.unmount();

// ---------------------------------------------------------------------------
// 4. Confirm Prompt State
// ---------------------------------------------------------------------------
console.log("\n=== STATE 4: CONFIRM PROMPT ===");
const confirmPrompt = render(
  <Box flexDirection="column">
    <CompactHeader version="0.1.0-alpha.3" rootDir="/media/TV/Breaking Bad/Season 1" />
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      marginBottom={1}
    >
      <Text bold color="yellow">Encode Confirmation</Text>
      <Box marginY={1}>
        <Text>Encode <Text bold color="cyan">3</Text> files using profile <Text bold color="cyan">series</Text>? [<Text bold color="green">Y</Text>/n]: </Text>
      </Box>
      <Text dimColor>(Press Y or Enter to start, n or Esc to return to checklist)</Text>
    </Box>
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} disabled={true} />
    <StatusBar profile="series" fileCount={3} mouseActive={true} />
  </Box>
);
patchStdin(confirmPrompt.stdin);
console.log(confirmPrompt.lastFrame());
confirmPrompt.unmount();

// ---------------------------------------------------------------------------
// 5. Encoding in Progress State
// ---------------------------------------------------------------------------
console.log("\n=== STATE 5: ENCODING IN PROGRESS ===");
const activeFileInProgress = {
  ...mockFiles[0]!,
  phase: "encoding" as const,
  progress: {
    outTimeSecs: 1461,
    fps: 84.7,
    speed: 2.35,
    totalSizeBytes: 395_000_000,
    percentDone: 42,
  },
};
const encoding = render(
  <Box flexDirection="column">
    <CompactHeader version="0.1.0-alpha.3" rootDir="/media/TV/Breaking Bad/Season 1" />
    <LiveProgressLine
      activeFile={activeFileInProgress}
      currentIndex={0}
      totalFiles={3}
    />
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} />
    <StatusBar profile="series" fileCount={3} mouseActive={false} />
  </Box>
);
patchStdin(encoding.stdin);
console.log(encoding.lastFrame());
encoding.unmount();

// ---------------------------------------------------------------------------
// 6. Results State
// ---------------------------------------------------------------------------
console.log("\n=== STATE 6: RESULTS ===");
const resultsData = [
  {
    sourcePath: "/media/TV/Breaking Bad/Season 1/S01E01 - Pilot.mkv",
    outputPath: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E01 - Pilot.mkv",
    sourceSizeBytes: 2_450_000_000,
    outputSizeBytes: 1_120_000_000,
    state: "done" as const,
  },
  {
    sourcePath: "/media/TV/Breaking Bad/Season 1/S01E02 - Cat's in the Bag.mkv",
    outputPath: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E02 - Cat's in the Bag.mkv",
    sourceSizeBytes: 1_980_000_000,
    outputSizeBytes: 950_000_000,
    state: "done" as const,
  },
  {
    sourcePath: "/media/TV/Breaking Bad/Season 1/S01E03 - And the Bag's in the River.mkv",
    outputPath: "/media/TV/Breaking Bad/Season 1/Prestron-Encoded/S01E03 - And the Bag's in the River.mkv",
    sourceSizeBytes: 2_100_000_000,
    outputSizeBytes: 1_040_000_000,
    state: "done" as const,
  },
];
const results = render(
  <Box flexDirection="column">
    <CompactHeader version="0.1.0-alpha.3" rootDir="/media/TV/Breaking Bad/Season 1" />
    <ResultsTable
      results={resultsData}
      outputDir="/media/TV/Breaking Bad/Season 1/Prestron-Encoded"
    />
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} />
    <StatusBar profile="series" fileCount={3} mouseActive={false} />
  </Box>
);
patchStdin(results.stdin);
console.log(results.lastFrame());
results.unmount();

// ---------------------------------------------------------------------------
// 7. Empty Folder State
// ---------------------------------------------------------------------------
console.log("\n=== STATE 7: EMPTY FOLDER ===");
const emptyFolder = render(
  <Box flexDirection="column">
    <Banner version="0.1.0-alpha.3" columns={80} isUtf8={true} hasColor={false} />
    <StartupCard
      rootDir="/media/EmptyDir"
      files={[]}
      ffmpegCaps={mockFfmpegCaps}
    />
    <SessionInput onSubmit={() => {}} onSlashTrigger={() => {}} />
    <StatusBar profile="series" fileCount={0} mouseActive={false} />
  </Box>
);
patchStdin(emptyFolder.stdin);
console.log(emptyFolder.lastFrame());
emptyFolder.unmount();

process.exit(0);
