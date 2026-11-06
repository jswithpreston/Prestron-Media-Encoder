/**
 * FilesScreen — interactive browsable list of discovered video files.
 *
 * Displays:
 *  - Index #
 *  - Filename (Unicode display-width truncated)
 *  - Source resolution / codec / bpp
 *  - Recommendation badge: [ENCODE], [SKIP], [MARGINAL], [RISKY], [COPY]
 *  - Estimated savings: est. 45% (210 MB) or —
 *
 * Navigation:
 *  - ↑/↓ or k/j: navigate items
 *  - Enter: open deep inspection for selected file
 *  - Esc or q: exit back to prompt
 *  - Mouse click to select, wheel to scroll
 */

import React, { useState, useCallback, useMemo } from "react";
import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import type { BatchFile } from "../hooks/useBatch.js";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";
import { fitDisplay } from "../../platform/displayString.js";
import { recommend, type RecommendationResult } from "../../core/recommendation/index.js";
import { estimateSize, type SizeEstimate } from "../../core/estimation/index.js";
import type { ProfileName } from "../../core/policy/profiles.js";

export interface FilesScreenProps {
  files: BatchFile[];
  currentProfile: ProfileName;
  onSelectFile: (index: number) => void;
  onClose: () => void;
  mouseEnabled?: boolean;
}

const PAGE_SIZE = 10;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function getBadge(rec: RecommendationResult): { text: string; color: "green" | "gray" | "yellow" | "red" | "blue" } {
  switch (rec.outcome) {
    case "ENCODE":
      return { text: "[ENCODE]", color: "green" };
    case "SKIP_EFFICIENT":
      return { text: "[SKIP]  ", color: "gray" };
    case "MARGINAL":
      return { text: "[MARGIN]", color: "yellow" };
    case "RISKY":
      return { text: "[RISKY] ", color: "red" };
    case "COPY":
      return { text: "[COPY]  ", color: "blue" };
    case "UNSUPPORTED":
    default:
      return { text: "[UNSUP] ", color: "red" };
  }
}

export function FilesScreen({
  files,
  currentProfile,
  onSelectFile,
  onClose,
  mouseEnabled = false,
}: FilesScreenProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  // Compute recommendations and size estimates for all files
  const fileDetails = useMemo(() => {
    return files.map((f) => {
      if (!f.mediaInfo) {
        return {
          rec: null,
          est: null,
          res: "unknown",
          codec: "unknown",
          bpp: 0,
        };
      }
      const rec = recommend(f.mediaInfo, undefined, { profileOverride: currentProfile });
      const est: SizeEstimate = estimateSize(f.mediaInfo, rec, currentProfile);
      return {
        rec,
        est,
        res: `${String(f.mediaInfo.video.width)}x${String(f.mediaInfo.video.height)}`,
        codec: f.mediaInfo.video.codec,
        bpp: f.mediaInfo.video.bpp,
      };
    });
  }, [files, currentProfile]);

  // Windowing calculation
  const total = files.length;
  const windowStart = Math.max(0, Math.min(cursor - Math.floor(PAGE_SIZE / 2), total - PAGE_SIZE));
  const windowEnd = Math.min(total, windowStart + PAGE_SIZE);
  const visibleIndices = Array.from({ length: windowEnd - windowStart }, (_, i) => windowStart + i);

  useInput((input, key) => {
    if (key.escape || input === "q" || input === "Q") {
      onClose();
      return;
    }
    if (key.return) {
      if (files.length > 0 && cursor >= 0 && cursor < files.length) {
        onSelectFile(cursor);
      }
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(Math.max(0, files.length - 1), c + 1));
      return;
    }
    if (key.pageUp) {
      setCursor((c) => Math.max(0, c - PAGE_SIZE));
      return;
    }
    if (key.pageDown) {
      setCursor((c) => Math.min(Math.max(0, files.length - 1), c + PAGE_SIZE));
      return;
    }
  });

  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (evt.type === "press" && evt.button === "left") {
        // Table starts after border and header rows (~3 rows down)
        const rowOffset = evt.row - 4;
        if (rowOffset >= 0 && rowOffset < visibleIndices.length) {
          const clickedIdx = visibleIndices[rowOffset];
          if (clickedIdx !== undefined) {
            setCursor(clickedIdx);
            onSelectFile(clickedIdx);
          }
        }
      } else if (evt.button === "wheelUp") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (evt.button === "wheelDown") {
        setCursor((c) => Math.min(Math.max(0, files.length - 1), c + 1));
      }
    },
    [visibleIndices, onSelectFile],
  );

  useMouse(handleMouse, !mouseEnabled);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Files Browser ({String(files.length)} files) — Profile: {currentProfile}
        </Text>
        <Text dimColor>↑/↓ or k/j: navigate · Enter: inspect file · Esc/q: return</Text>
      </Box>

      {/* Table Header */}
      <Box paddingX={1} marginBottom={0}>
        <Text bold color="gray">{"#".padEnd(4)}</Text>
        <Text bold color="gray">{fitDisplay("Filename", 28)} </Text>
        <Text bold color="gray">{"Res/Codec".padEnd(16)}</Text>
        <Text bold color="gray">{"bpp".padEnd(7)}</Text>
        <Text bold color="gray">{"Rec".padEnd(9)}</Text>
        <Text bold color="gray">Est. Savings</Text>
      </Box>

      {/* Table Rows */}
      {files.length === 0 ? (
        <Box paddingX={1} marginY={1}>
          <Text dimColor>No files to display. Run /scan first.</Text>
        </Box>
      ) : (
        visibleIndices.map((idx) => {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const file = files[idx]!;
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const details = fileDetails[idx]!;
          const isCursor = idx === cursor;
          const numStr = `#${String(idx + 1)}`.padEnd(4);
          const nameStr = fitDisplay(basename(file.path), 28);
          const resCodecStr = `${details.res.split("x")[1] ?? ""}p ${details.codec}`.padEnd(16);
          const bppStr = details.bpp > 0 ? details.bpp.toFixed(3).padEnd(7) : "—".padEnd(7);

          const badge = details.rec ? getBadge(details.rec) : { text: "[---]   ", color: "gray" as const };
          const savingsStr = details.est && details.est.likelySavingsBytes > 0
            ? `est. ~${String(details.est.likelySavingsPercent)}% (${formatBytes(details.est.likelySavingsBytes)})`
            : "—";

          return (
            <Box key={file.path} paddingX={1}>
              <Text color={isCursor ? "cyan" : "gray"}>
                {isCursor ? "▶" : " "}
              </Text>
              <Text bold={isCursor} color={isCursor ? "white" : "gray"}>
                {numStr}
              </Text>
              {isCursor ? (
                <Text bold color="white">
                  {nameStr}{" "}
                </Text>
              ) : (
                <Text>
                  {nameStr}{" "}
                </Text>
              )}
              <Text color="blue">{resCodecStr}</Text>
              <Text color="magenta">{bppStr}</Text>
              <Text color={badge.color}>{badge.text} </Text>
              {savingsStr !== "—" ? (
                <Text color="green">{savingsStr}</Text>
              ) : (
                <Text dimColor>{savingsStr}</Text>
              )}
            </Box>
          );
        })
      )}

      {/* Scroll indicator */}
      {files.length > PAGE_SIZE && (
        <Box marginTop={1} paddingX={1} justifyContent="space-between">
          <Text dimColor>
            Showing {String(windowStart + 1)}–{String(windowEnd)} of {String(files.length)} files
          </Text>
          <Text dimColor>
            Use PageUp/PageDown or mouse wheel to scroll
          </Text>
        </Box>
      )}
    </Box>
  );
}
