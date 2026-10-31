/**
 * LiveProgressLine — live progress bar and metrics for the currently encoding file.
 * Format: [████████░░░░░░░░░░░░] 42% │ 85 fps │ 2.4x │ ETA 01:23 │ 142.5 MB │ <filename>
 */

import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import { ProgressBar } from "./ProgressBar.js";
import type { BatchFile } from "../hooks/useBatch.js";

export interface LiveProgressLineProps {
  activeFile: BatchFile | null;
  currentIndex: number;
  totalFiles: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function LiveProgressLine({
  activeFile,
  currentIndex,
  totalFiles,
}: LiveProgressLineProps): React.ReactElement {
  if (!activeFile) {
    return <Box />;
  }

  const name = basename(activeFile.path);
  const progress = activeFile.progress;
  const pct = progress ? progress.percentDone : 0;
  const fps = progress ? Math.round(progress.fps) : 0;
  const speed = progress ? progress.speed.toFixed(1) : "0.0";
  const size = progress ? formatBytes(progress.totalSizeBytes) : "0 B";

  // Calculate ETA from duration and speed
  let etaText = "--:--";
  if (progress && activeFile.mediaInfo && progress.speed > 0) {
    const remainingSecs = Math.max(0, activeFile.mediaInfo.durationSecs - progress.outTimeSecs);
    etaText = formatEta(remainingSecs / progress.speed);
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="green" paddingX={1} marginBottom={1}>
      <Box>
        <Text bold color="green">
          Encoding [{currentIndex + 1}/{totalFiles}]:{" "}
        </Text>
        <Text bold>{name}</Text>
        {activeFile.phase === "verifying" && (
          <Text color="yellow"> [Verifying 10-step checks…]</Text>
        )}
      </Box>

      <Box marginTop={1}>
        <ProgressBar value={pct} width={30} color="green" />
        <Text dimColor> │ </Text>
        <Text>{fps} fps</Text>
        <Text dimColor> │ </Text>
        <Text>{speed}x</Text>
        <Text dimColor> │ </Text>
        <Text>ETA {etaText}</Text>
        <Text dimColor> │ </Text>
        <Text>{size}</Text>
      </Box>
    </Box>
  );
}
