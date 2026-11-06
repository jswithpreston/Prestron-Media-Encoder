/**
 * InfoScreen — deep source analysis and recommendation inspection screen.
 *
 * Requirements:
 *  - Displays full probed details: container, video specs, audio tracks, subtitle tracks, attachments, chapters.
 *  - Recommendation outcome, action, confidence, list of reasons and warnings.
 *  - Estimated savings range: [min, likely, max] bytes and % with disclaimer.
 *  - Planned ffmpeg parameters preview.
 *  - Esc or q to return to files list / session prompt.
 */

import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import type { BatchFile } from "../hooks/useBatch.js";
import { recommend } from "../../core/recommendation/index.js";
import { estimateSize } from "../../core/estimation/index.js";
import type { ProfileName } from "../../core/policy/profiles.js";

export interface InfoScreenProps {
  file: BatchFile;
  fileIndex: number;
  totalFiles: number;
  currentProfile: ProfileName;
  onClose: () => void;
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

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${String(h)}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }
  return `${String(m)}m ${String(s).padStart(2, "0")}s`;
}

export function InfoScreen({
  file,
  fileIndex,
  totalFiles,
  currentProfile,
  onClose,
}: InfoScreenProps): React.ReactElement {
  const mediaInfo = file.mediaInfo;

  const rec = useMemo(() => {
    if (!mediaInfo) return null;
    return recommend(mediaInfo, undefined, { profileOverride: currentProfile });
  }, [mediaInfo, currentProfile]);

  const est = useMemo(() => {
    if (!mediaInfo || !rec) return null;
    return estimateSize(mediaInfo, rec, currentProfile);
  }, [mediaInfo, rec, currentProfile]);

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "Q") {
      onClose();
    }
  });

  const fileName = basename(file.path);

  if (!mediaInfo) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1} marginY={1}>
        <Text bold color="red">File Information: {fileName}</Text>
        <Text color="yellow">Probe data unavailable or file probe failed.</Text>
        <Text dimColor>Press Esc or q to return.</Text>
      </Box>
    );
  }

  const v = mediaInfo.video;
  const audioTracks = mediaInfo.audio;
  const subTracks = mediaInfo.subtitles;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      {/* Header */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Deep Source Analysis [{String(fileIndex + 1)}/{String(totalFiles)}]: {fileName}
        </Text>
        <Text dimColor>Esc / q: return</Text>
      </Box>

      {/* Container info */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Container &amp; Metadata:</Text>
        <Box paddingLeft={1} flexDirection="column">
          <Text dimColor>
            Path: {file.path}
          </Text>
          <Text>
            Size: <Text bold color="white">{formatBytes(mediaInfo.sizeBytes)}</Text>
            {"  "}Duration: <Text bold color="white">{formatDuration(mediaInfo.durationSecs)}</Text>
            {"  "}Container: <Text color="blue">{mediaInfo.container}</Text>
            {"  "}Bitrate: <Text color="magenta">{String(mediaInfo.overallBitrateKbps)} kbps</Text>
          </Text>
        </Box>
      </Box>

      {/* Video stream details */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">Video Stream:</Text>
        <Box paddingLeft={1} flexDirection="column">
          <Text>
            Format: <Text bold color="cyan">{v.codec.toUpperCase()}</Text>
            {" "}({v.profile ?? "main"}, Level {String(v.level ?? "auto")})
            {"  "}Resolution: <Text bold color="blue">{String(v.width)}x{String(v.height)}</Text>
            {v.dar && ` (${v.dar})`}
            {"  "}DAR/SAR: {v.dar ?? "—"}/{v.sar ?? "1:1"}
          </Text>
          <Text>
            Framerate: <Text color="white">{String(v.fps)} fps</Text>
            {" "}{v.isVfr ? "(VFR detected)" : "(CFR)"}
            {"  "}Scan: <Text color={v.fieldOrder === "interlaced" ? "yellow" : "green"}>{v.fieldOrder}</Text>
            {"  "}Color: {String(v.bitDepth)}-bit {v.pixFmt}
          </Text>
          <Text>
            Color Range/Space: {v.colorRange ?? "tv"} / {v.colorSpace ?? "bt709"} ({v.colorTransfer ?? "bt709"})
            {"  "}HDR: <Text color={v.isHdr ? "magenta" : "gray"}>{v.isHdr ? (v.isDolbyVision ? "Dolby Vision" : "HDR10/HLG") : "SDR"}</Text>
          </Text>
          <Text>
            Video Bitrate: <Text color="magenta">{String(v.bitrateKbps)} kbps</Text>
            {v.isBitrateDerived ? " (derived)" : " (stream)"}
            {"  "}Density (bpp): <Text bold color={v.bpp < 0.05 ? "yellow" : "green"}>{v.bpp.toFixed(4)}</Text>
            {" "}bits/pixel
          </Text>
        </Box>
      </Box>

      {/* Audio & Subtitle breakdown */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          Audio ({String(audioTracks.length)} stream{audioTracks.length === 1 ? "" : "s"}) &amp; Subtitles ({String(subTracks.length)} stream{subTracks.length === 1 ? "" : "s"}):
        </Text>
        <Box paddingLeft={1} flexDirection="column">
          {audioTracks.length === 0 ? (
            <Text dimColor>No audio streams</Text>
          ) : (
            audioTracks.map((a, i) => (
              <Text key={`a-${String(i)}`}>
                <Text color="cyan">Audio #{String(i + 1)}: </Text>
                <Text bold>{a.codec.toUpperCase()} </Text>
                <Text color="blue">{String(a.channels)}ch ({a.channelLayout ?? "unknown"}) </Text>
                <Text dimColor>{String(a.sampleRateHz ?? 48000)}Hz {a.bitrateKbps ? `${String(a.bitrateKbps)}kbps ` : ""}[{a.language ?? "und"}] {a.title ? `"${a.title}"` : ""}</Text>
              </Text>
            ))
          )}
          {subTracks.length > 0 && (
            subTracks.map((s, i) => (
              <Text key={`s-${String(i)}`}>
                <Text color="yellow">Subtitle #{String(i + 1)}: </Text>
                <Text bold>{s.codec.toUpperCase()} </Text>
                <Text color={s.formatType === "text" ? "green" : "magenta"}>[{s.formatType}] </Text>
                <Text dimColor>[{s.language}] {s.title ? `"${s.title}"` : ""}{s.isForced ? " (forced)" : ""}</Text>
              </Text>
            ))
          )}
        </Box>
      </Box>

      {/* Recommendation & Reasons */}
      {rec && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold color="white">Recommendation: </Text>
            <Text bold color={rec.outcome === "ENCODE" ? "green" : rec.outcome === "SKIP_EFFICIENT" ? "gray" : rec.outcome === "MARGINAL" ? "yellow" : "red"}>
              [{rec.outcome}]
            </Text>
            <Text> — Action: <Text bold>{rec.action.toUpperCase()}</Text> (Confidence: {rec.confidence})</Text>
          </Box>
          <Box paddingLeft={1} flexDirection="column">
            {rec.reasons.map((r, i) => (
              <Text key={`r-${String(i)}`} dimColor>• {r}</Text>
            ))}
            {rec.warnings.map((w, i) => (
              <Text key={`w-${String(i)}`} color="yellow">⚠ {w}</Text>
            ))}
          </Box>
        </Box>
      )}

      {/* Storage savings estimates */}
      {est && (
        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text bold color="white">Estimated Storage Savings: </Text>
            <Text bold color="green">
              {formatBytes(est.minSavingsBytes)} – {formatBytes(est.maxSavingsBytes)}
            </Text>
            <Text dimColor> (likely ~{formatBytes(est.likelySavingsBytes)}, ~{String(est.likelySavingsPercent)}%)</Text>
          </Box>
          <Box paddingLeft={1} flexDirection="column">
            <Text dimColor>
              Est. output file size: {formatBytes(est.minBytes)} – {formatBytes(est.maxBytes)} (likely ~{formatBytes(est.likelyBytes)})
            </Text>
            <Text dimColor>
              {est.disclaimer}
            </Text>
          </Box>
        </Box>
      )}

      {/* Planned FFmpeg parameters */}
      {file.plan && (
        <Box flexDirection="column">
          <Text bold color="white">Planned Target Settings:</Text>
          <Box paddingLeft={1}>
            <Text dimColor>
              Encoder: {file.plan.profile.codec} │ CRF: {String(file.plan.profile.crf)} │ Preset: {file.plan.profile.preset} │ Pixel Format: {file.plan.profile.pixFmt}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
