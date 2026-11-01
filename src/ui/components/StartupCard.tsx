/**
 * StartupCard — displays folder status, discovered video files, FFmpeg capabilities,
 * and recovery notices at session startup.
 */

import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import type { BatchFile } from "../hooks/useBatch.js";
import type { FfmpegCapabilities } from "../../core/ffmpeg/capabilities.js";

export interface StartupCardProps {
  rootDir: string;
  files: BatchFile[];
  ffmpegCaps: FfmpegCapabilities | null;
  recoveryMessages?: string[];
  maxDisplayFiles?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function StartupCard({
  rootDir,
  files,
  ffmpegCaps,
  recoveryMessages = [],
  maxDisplayFiles = 6,
}: StartupCardProps): React.ReactElement {
  const displayedFiles = files.slice(0, maxDisplayFiles);
  const remainingCount = files.length - displayedFiles.length;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      {/* Folder header */}
      <Box>
        <Text bold color="cyan">Folder: </Text>
        <Text>{rootDir}</Text>
      </Box>

      {/* Files list / Empty folder message */}
      {files.length === 0 ? (
        <Box flexDirection="column" marginY={1}>
          <Text bold color="yellow">No video files found here</Text>
          <Text dimColor>Hint: Place video files in this directory or type /scan &lt;path&gt; to scan another location.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          <Box marginBottom={1}>
            <Text bold color="white">
              Files found ({files.length}):
            </Text>
          </Box>
          {displayedFiles.map((f, i) => {
            const name = basename(f.path);
            const res = f.mediaInfo?.video
              ? `${String(f.mediaInfo.video.width)}x${String(f.mediaInfo.video.height)}`
              : "unknown";
            const codec = f.mediaInfo?.video.codec ?? "unknown";
            const size = formatBytes(f.sourceSizeBytes);

            return (
              <Box key={i} paddingLeft={1}>
                <Text color="cyan">▪ </Text>
                <Text bold>{name.padEnd(28).slice(0, 28)} </Text>
                <Text color="blue">{res.padEnd(11)} </Text>
                <Text color="magenta">{codec.padEnd(8)} </Text>
                <Text dimColor>{size}</Text>
              </Box>
            );
          })}
          {remainingCount > 0 && (
            <Box paddingLeft={1}>
              <Text dimColor>… and {remainingCount} more file{remainingCount > 1 ? "s" : ""}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* FFmpeg status */}
      <Box marginTop={1}>
        <Text bold color="cyan">FFmpeg: </Text>
        {ffmpegCaps ? (
          <Text color="green">
            v{ffmpegCaps.version.raw} (libx265: {ffmpegCaps.hasLibx265 ? "ready" : "missing"})
          </Text>
        ) : (
          <Text dimColor>checking capabilities…</Text>
        )}
      </Box>

      {/* Recovery notices */}
      {recoveryMessages.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {recoveryMessages.map((msg, idx) => (
            <Text key={idx} color="yellow">
              ⚠ Recovery: {msg}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
