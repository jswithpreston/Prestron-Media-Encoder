import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";
import type { BatchFile } from "../hooks/useBatch.js";
import type { FfmpegCapabilities } from "../../core/ffmpeg/capabilities.js";
import { fitDisplay } from "../../platform/displayString.js";
import { recommend } from "../../core/recommendation/index.js";
import { estimateSize, computeFolderSummary } from "../../core/estimation/index.js";
import type { ProfileName } from "../../core/policy/profiles.js";

export interface StartupCardProps {
  rootDir: string;
  files: BatchFile[];
  ffmpegCaps: FfmpegCapabilities | null;
  recoveryMessages?: string[];
  maxDisplayFiles?: number;
  currentProfile?: ProfileName;
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
  currentProfile = "series",
}: StartupCardProps): React.ReactElement {
  const displayedFiles = files.slice(0, maxDisplayFiles);
  const remainingCount = files.length - displayedFiles.length;

  // Compute folder-level recommendation counts and savings estimates
  const validFiles = files.filter((f) => f.mediaInfo !== null);
  const items = validFiles.map((f) => {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const info = f.mediaInfo!;
    const rec = recommend(info, undefined, { profileOverride: currentProfile });
    const est = estimateSize(info, rec, currentProfile);
    return { mediaInfo: info, recommendation: rec, estimate: est };
  });

  const folderSummary = items.length > 0 ? computeFolderSummary(items) : null;

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
              Files found ({String(files.length)}):
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
                <Text bold>{fitDisplay(name, 28)} </Text>
                <Text color="blue">{res.padEnd(11)} </Text>
                <Text color="magenta">{codec.padEnd(8)} </Text>
                <Text dimColor>{size}</Text>
              </Box>
            );
          })}
          {remainingCount > 0 && (
            <Box paddingLeft={1}>
              <Text dimColor>… and {String(remainingCount)} more file{remainingCount > 1 ? "s" : ""} · Type </Text>
              <Text bold color="yellow">/files</Text>
              <Text dimColor> to browse all {String(files.length)}</Text>
            </Box>
          )}

          {/* Folder recommendation & savings estimate summary */}
          {folderSummary && (
            <Box flexDirection="column" marginTop={1} paddingLeft={1}>
              <Box>
                <Text bold color="white">Analysis: </Text>
                <Text color="green">{String(folderSummary.encodeCount)} encode</Text>
                <Text dimColor>, </Text>
                <Text color="gray">{String(folderSummary.skipCount)} skip</Text>
                {folderSummary.marginalCount > 0 && (
                  <>
                    <Text dimColor>, </Text>
                    <Text color="yellow">{String(folderSummary.marginalCount)} marginal</Text>
                  </>
                )}
                {folderSummary.riskyCount > 0 && (
                  <>
                    <Text dimColor>, </Text>
                    <Text color="red">{String(folderSummary.riskyCount)} risky</Text>
                  </>
                )}
              </Box>
              <Box>
                <Text bold color="white">Est. Folder Savings: </Text>
                <Text color="cyan">
                  {formatBytes(folderSummary.estimatedSavings.minBytes)} – {formatBytes(folderSummary.estimatedSavings.maxBytes)}
                </Text>
                <Text dimColor>
                  {" "}(likely ~{formatBytes(folderSummary.estimatedSavings.likelyBytes)}, ~{String(folderSummary.estimatedSavings.likelyPercent)}%)
                </Text>
              </Box>
              <Text dimColor>Type /files to browse file details or /info &lt;number&gt; to inspect a specific file.</Text>
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
