/**
 * EncodingScreen — live per-file and overall batch progress.
 */

import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import { ProgressBar, BatchProgress } from "../components/ProgressBar.js";
import type { BatchState, BatchFile } from "../hooks/useBatch.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

function formatEta(secs: number): string {
  if (!isFinite(secs) || secs <= 0) return "--:--";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EncodingScreenProps {
  batchState: BatchState;
  totalSelected: number;
}

// ---------------------------------------------------------------------------
// File row
// ---------------------------------------------------------------------------

function FileRow({ f }: { f: BatchFile }): React.ReactElement {
  const icon =
    f.phase === "done"
      ? "✔"
      : f.phase === "failed"
        ? "✘"
        : f.phase === "skipped"
          ? "⊘"
          : f.phase === "encoding"
            ? "⟳"
            : f.phase === "verifying"
              ? "?"
              : "·";

  const colorProps =
    f.phase === "done"
      ? ({ color: "green" as const } as const)
      : f.phase === "failed"
        ? ({ color: "red" as const } as const)
        : f.phase === "encoding"
          ? ({ color: "cyan" as const } as const)
          : {};

  return (
    <Box>
      <Text {...colorProps}>{icon} </Text>
      <Text {...colorProps} dimColor={f.phase === "pending"}>
        {basename(f.path)}
      </Text>
      {f.phase === "done" && f.outputSizeBytes !== null && (
        <Text dimColor>
          {"  "}
          {formatSize(f.sourceSizeBytes)} → {formatSize(f.outputSizeBytes)}
        </Text>
      )}
      {f.phase === "failed" && f.error !== null && (
        <Text color="red" dimColor>
          {"  "}
          {f.error}
        </Text>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EncodingScreen({
  batchState,
  totalSelected,
}: EncodingScreenProps): React.ReactElement {
  const { files, activeFileIndex } = batchState;
  const activeFile: BatchFile | undefined =
    activeFileIndex >= 0 ? files[activeFileIndex] : undefined;
  const progress = activeFile?.progress ?? null;

  const done = files.filter((f) => f.phase === "done").length;
  const failed = files.filter((f) => f.phase === "failed").length;
  const skipped = files.filter((f) => f.phase === "skipped").length;

  const percentDone = progress?.percentDone ?? 0;
  const fps = progress?.fps ?? 0;
  const speed = progress?.speed ?? 0;
  const currentSizeBytes = progress?.totalSizeBytes ?? 0;

  // ETA for current file
  const sourceDuration = activeFile?.mediaInfo?.durationSecs ?? 0;
  const remainingPct = 1 - percentDone / 100;
  const etaSecs = speed > 0 ? (sourceDuration * remainingPct) / speed : 0;

  const barWidth = Math.min(50, process.stdout.columns - 20);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Encoding</Text>
        <Text dimColor>
          {" "}
          {String(done + failed + skipped + 1)}/{String(totalSelected)}
        </Text>
      </Box>

      {/* Current file */}
      {activeFile !== undefined && (
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            <Text dimColor>File: </Text>
            <Text color="cyan">{basename(activeFile.path)}</Text>
          </Text>
          <ProgressBar value={percentDone} width={barWidth} color="cyan" />
          <Box marginTop={0}>
            <Text dimColor>
              {fps > 0 ? `${fps.toFixed(1)} fps  ` : ""}
              {speed > 0 ? `${speed.toFixed(2)}x  ` : ""}
              {currentSizeBytes > 0 ? `${formatSize(currentSizeBytes)}  ` : ""}
              {`ETA ${formatEta(etaSecs)}`}
            </Text>
          </Box>
        </Box>
      )}

      {/* Overall batch */}
      <Box marginBottom={1}>
        <BatchProgress
          done={done}
          failed={failed}
          skipped={skipped}
          total={totalSelected}
          width={barWidth}
        />
      </Box>

      {/* Per-file status list (last 10) */}
      <Box flexDirection="column">
        {files.slice(-10).map((f, i) => (
          <FileRow key={i} f={f} />
        ))}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Ctrl+C to abort (current .part will be removed)</Text>
      </Box>
    </Box>
  );
}
