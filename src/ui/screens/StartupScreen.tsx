/**
 * StartupScreen — first thing the user sees.
 *
 * Shows: banner, version, current folder, scan summary, FFmpeg status,
 * recovery messages, and a notice if an unfinished batch exists.
 *
 * Pressing Enter or "/" moves to the guided flow / command palette.
 */

import React, { useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { Banner } from "../components/Banner.js";
import type { BatchState } from "../hooks/useBatch.js";
import type { FfmpegCapabilities } from "../../core/ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface StartupScreenProps {
  version: string;
  rootDir: string;
  batchState: BatchState;
  ffmpegCaps: FfmpegCapabilities | null;
  ffmpegError: string | null;
  columns: number;
  isUtf8: boolean;
  hasColor: boolean;
  onStartFlow: () => void;
  onOpenPalette: () => void;
  /** Trigger scan on mount */
  onScan: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StartupScreen({
  version,
  rootDir,
  batchState,
  ffmpegCaps,
  ffmpegError,
  columns,
  isUtf8,
  hasColor,
  onStartFlow,
  onOpenPalette,
  onScan,
}: StartupScreenProps): React.ReactElement {
  // Trigger scan on mount
  useEffect(() => {
    onScan();
  }, []);

  useInput(
    useCallback(
      (input: string, key: { return?: boolean }) => {
        if (input === "/") {
          onOpenPalette();
        } else if (key.return || input === " ") {
          onStartFlow();
        }
      },
      [onStartFlow, onOpenPalette],
    ),
  );

  const { phase, files, hasUnfinishedBatch, recoveryMessages } = batchState;
  const isScanning = phase === "scanning" || phase === "probing";
  const isReady = phase === "ready" || phase === "idle";

  const totalFiles = files.length;
  const totalSize = files.reduce((acc, f) => acc + f.sourceSizeBytes, 0);
  const alreadyEncoded = files.filter((f) => f.phase === "skipped").length;

  // Codec summary
  const codecMap = new Map<string, number>();
  for (const f of files) {
    if (f.mediaInfo) {
      const codec = f.mediaInfo.video.codec.toUpperCase();
      codecMap.set(codec, (codecMap.get(codec) ?? 0) + 1);
    }
  }
  const codecSummary = Array.from(codecMap.entries())
    .map(([c, n]) => `${String(n)} ${c}`)
    .join(", ");

  return (
    <Box flexDirection="column">
      <Banner version={version} columns={columns} isUtf8={isUtf8} hasColor={hasColor} />

      {/* Folder */}
      <Box marginBottom={1}>
        <Text dimColor>Folder: </Text>
        <Text color="cyan">{rootDir}</Text>
      </Box>

      {/* FFmpeg status */}
      {ffmpegError !== null ? (
        <Box marginBottom={1}>
          <Text color="red">✘ FFmpeg: {ffmpegError}</Text>
        </Box>
      ) : ffmpegCaps !== null ? (
        <Box marginBottom={1}>
          <Text color="green">✔ FFmpeg </Text>
          <Text dimColor>v{ffmpegCaps.version.raw} libx265 ready</Text>
        </Box>
      ) : (
        <Box marginBottom={1}>
          <Text dimColor>Detecting FFmpeg…</Text>
        </Box>
      )}

      {/* Scan summary */}
      {isScanning ? (
        <Box marginBottom={1}>
          <Text dimColor>Scanning…</Text>
        </Box>
      ) : isReady && totalFiles > 0 ? (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text>
              {String(totalFiles)} file{totalFiles !== 1 ? "s" : ""} found
            </Text>
            <Text dimColor>
              {" "}
              {formatSize(totalSize)} {codecSummary}
            </Text>
          </Box>
          {alreadyEncoded > 0 && (
            <Text dimColor>
              {String(alreadyEncoded)} already encoded (will be skipped unless --overwrite)
            </Text>
          )}
        </Box>
      ) : isReady && totalFiles === 0 ? (
        <Box marginBottom={1}>
          <Text color="yellow">No video files found in this folder.</Text>
        </Box>
      ) : null}

      {/* Recovery messages */}
      {recoveryMessages.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          {recoveryMessages.map((m, i) => (
            <Text key={i} color="yellow" dimColor>
              ↺ {m}
            </Text>
          ))}
        </Box>
      )}

      {/* Unfinished batch notice */}
      {hasUnfinishedBatch && (
        <Box marginBottom={1}>
          <Text color="yellow">
            ⚠ An unfinished batch was found for this folder. Press Enter to resume or /resume.
          </Text>
        </Box>
      )}

      {/* Action hint */}
      {!isScanning && (
        <Box marginTop={1}>
          <Text dimColor>Enter=start /=commands q=quit</Text>
        </Box>
      )}
    </Box>
  );
}
