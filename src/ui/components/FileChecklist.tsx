/**
 * FileChecklist — scrollable, toggleable list of files.
 *
 * Keyboard:
 *   ↑/↓ (or k/j) — move cursor
 *   Space         — toggle selected file
 *   a             — select all
 *   n             — deselect all
 *   Enter         — confirm selection
 *   Esc/q         — cancel / go back
 *
 * Mouse (SGR 1006):
 *   Click on a row — moves cursor + toggles
 *   Wheel up/down  — scroll
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileItem {
  path: string;
  sizeBytes: number;
  codec: string;
  durationSecs: number;
}

export interface FileChecklistProps {
  files: FileItem[];
  /** Called with the selected paths when the user confirms. */
  onConfirm: (selectedPaths: string[]) => void;
  /** Called when the user presses Esc/q. */
  onCancel: () => void;
  maxVisibleRows?: number;
  mouseEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${String(h)}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m)}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FileChecklist({
  files,
  onConfirm,
  onCancel,
  maxVisibleRows = 15,
  mouseEnabled = true,
}: FileChecklistProps): React.ReactElement {
  // Start with all files selected
  const [selected, setSelected] = useState<Set<number>>(() => new Set(files.map((_, i) => i)));
  const [cursor, setCursor] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  const clampScroll = useCallback(
    (nextCursor: number, currentScroll: number) => {
      // Ensure cursor is visible in the window
      if (nextCursor < currentScroll) return nextCursor;
      if (nextCursor >= currentScroll + maxVisibleRows) return nextCursor - maxVisibleRows + 1;
      return currentScroll;
    },
    [maxVisibleRows],
  );

  const moveCursor = useCallback(
    (delta: number) => {
      setCursor((prev) => {
        const next = Math.max(0, Math.min(files.length - 1, prev + delta));
        setScrollOffset((s) => clampScroll(next, s));
        return next;
      });
    },
    [files.length, clampScroll],
  );

  const toggleCursor = useCallback((idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  }, []);

  // Keyboard
  useInput((input, key) => {
    if (key.upArrow || input === "k") {
      moveCursor(-1);
    } else if (key.downArrow || input === "j") {
      moveCursor(1);
    } else if (input === " ") {
      toggleCursor(cursor);
    } else if (input === "a") {
      setSelected(new Set(files.map((_, i) => i)));
    } else if (input === "n") {
      setSelected(new Set());
    } else if (key.return) {
      const paths = files.filter((_, i) => selected.has(i)).map((f) => f.path);
      onConfirm(paths);
    } else if (key.escape || input === "q") {
      onCancel();
    }
  });

  // Mouse handler
  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (evt.type === "press" && evt.button === "left") {
        // Row 1 of the checklist in the terminal occupies variable Y positions;
        // we rely on a fixed header of 3 rows above the list items.
        // The component renders starting from wherever Ink places it.
        // We use a simple heuristic: row index = evt.row - HEADER_ROWS - 1
        // (Ink doesn't give us absolute row position, so we use relative detection)
        // Instead, calculate based on visible window:
        const visibleIdx = evt.row - 4; // approximate: 4 rows for header
        if (visibleIdx >= 0 && visibleIdx < maxVisibleRows) {
          const fileIdx = scrollOffset + visibleIdx;
          if (fileIdx >= 0 && fileIdx < files.length) {
            setCursor(fileIdx);
            toggleCursor(fileIdx);
          }
        }
      } else if (evt.button === "wheelUp") {
        moveCursor(-1);
      } else if (evt.button === "wheelDown") {
        moveCursor(1);
      }
    },
    [scrollOffset, maxVisibleRows, files.length, moveCursor, toggleCursor],
  );

  useMouse(handleMouse, !mouseEnabled);

  // Visible slice
  const visibleFiles = files.slice(scrollOffset, scrollOffset + maxVisibleRows);
  const selectedCount = selected.size;
  const totalCount = files.length;
  const totalSelectedSize = files
    .filter((_, i) => selected.has(i))
    .reduce((acc, f) => acc + f.sizeBytes, 0);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Select files to encode</Text>
        <Text dimColor>
          {" "}
          ({String(selectedCount)}/{String(totalCount)} selected, {formatSize(totalSelectedSize)}{" "}
          total)
        </Text>
      </Box>

      {/* File rows */}
      {visibleFiles.map((file, visIdx) => {
        const fileIdx = scrollOffset + visIdx;
        const isCursor = fileIdx === cursor;
        const isChecked = selected.has(fileIdx);
        const check = isChecked ? "◉" : "○";
        const name = basename(file.path);
        const meta = `  ${file.codec.toUpperCase()}  ${formatSize(file.sizeBytes)}  ${formatDuration(file.durationSecs)}`;

        return (
          <Box key={fileIdx}>
            <Text
              {...(isCursor ? { color: "cyan" as const } : {})}
              bold={isCursor}
              inverse={isCursor}
            >
              {` ${check} ${name}`}
            </Text>
            <Text dimColor>{meta}</Text>
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {files.length > maxVisibleRows && (
        <Box marginTop={1}>
          <Text dimColor>
            {scrollOffset > 0 ? "↑ " : "  "}
            {`${String(scrollOffset + 1)}–${String(Math.min(scrollOffset + maxVisibleRows, files.length))} of ${String(files.length)}`}
            {scrollOffset + maxVisibleRows < files.length ? " ↓" : "  "}
          </Text>
        </Box>
      )}

      {/* Key hints */}
      <Box marginTop={1}>
        <Text dimColor>↑↓ move Space toggle a=all n=none Enter=confirm Esc=back</Text>
      </Box>
    </Box>
  );
}
