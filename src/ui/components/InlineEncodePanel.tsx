/**
 * InlineEncodePanel — inline panel for selecting files to encode and confirming.
 *
 * Requirements:
 *   - Windowed to 8 rows with "n more" indicator to prevent flicker in 24-row terminals.
 *   - Space toggles selection, 'a' toggles all, Enter advances to [Y/n] confirmation.
 *   - Esc cancels back to the command prompt.
 *   - Mouse click / wheel support while open when mouseEnabled is true.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import type { BatchFile } from "../hooks/useBatch.js";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";

export interface InlineEncodePanelProps {
  files: BatchFile[];
  profile: string;
  onConfirm: (selectedPaths: string[]) => void;
  onCancel: () => void;
  mouseEnabled?: boolean;
}

const MAX_WINDOW_ROWS = 8;

export function InlineEncodePanel({
  files,
  profile,
  onConfirm,
  onCancel,
  mouseEnabled = false,
}: InlineEncodePanelProps): React.ReactElement {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(files.map((_, i) => i)),
  );
  const [cursor, setCursor] = useState(0);
  const [step, setStep] = useState<"checklist" | "confirm">("checklist");

  const toggleCurrent = useCallback(() => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cursor)) {
        next.delete(cursor);
      } else {
        next.add(cursor);
      }
      return next;
    });
  }, [cursor]);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === files.length) {
        return new Set();
      }
      return new Set(files.map((_, i) => i));
    });
  }, [files.length]);

  const handleConfirmAction = useCallback(() => {
    const paths = files.filter((_, i) => selected.has(i)).map((f) => f.path);
    onConfirm(paths);
  }, [files, selected, onConfirm]);

  useInput((input, key) => {
    if (step === "checklist") {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.return) {
        if (selected.size > 0) {
          setStep("confirm");
        }
        return;
      }
      if (input === " ") {
        toggleCurrent();
        return;
      }
      if (input === "a") {
        toggleAll();
        return;
      }
      if (key.upArrow || input === "k") {
        setCursor((c) => Math.max(0, c - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((c) => Math.min(files.length - 1, c + 1));
        return;
      }
    } else {
      if (key.escape || input === "n" || input === "N") {
        setStep("checklist");
        return;
      }
      if (key.return || input === "y" || input === "Y") {
        handleConfirmAction();
        return;
      }
    }
  });

  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (step !== "checklist") return;

      if (evt.type === "press" && evt.button === "left") {
        toggleCurrent();
      } else if (evt.button === "wheelUp") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (evt.button === "wheelDown") {
        setCursor((c) => Math.min(files.length - 1, c + 1));
      }
    },
    [step, toggleCurrent, files.length],
  );

  useMouse(handleMouse, !mouseEnabled);

  // Windowing calculation
  const total = files.length;
  const halfWindow = Math.floor(MAX_WINDOW_ROWS / 2);
  let startIndex = Math.max(0, cursor - halfWindow);
  if (startIndex + MAX_WINDOW_ROWS > total) {
    startIndex = Math.max(0, total - MAX_WINDOW_ROWS);
  }
  const visible = files.slice(startIndex, startIndex + MAX_WINDOW_ROWS);
  const moreAbove = startIndex;
  const moreBelow = Math.max(0, total - (startIndex + MAX_WINDOW_ROWS));

  if (step === "confirm") {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="yellow"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="yellow">
          Encode Confirmation
        </Text>
        <Box marginY={1}>
          <Text>
            Encode <Text bold color="cyan">{selected.size}</Text> files using profile{" "}
            <Text bold color="cyan">{profile}</Text>? [
            <Text bold color="green">Y</Text>/n]:{" "}
          </Text>
        </Box>
        <Text dimColor>(Press Y or Enter to start, n or Esc to return to checklist)</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      marginBottom={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Select Files to Encode
        </Text>
        <Text dimColor>
          {" "}(Space: toggle, a: all, Enter: confirm, Esc: cancel)
        </Text>
      </Box>

      {moreAbove > 0 && (
        <Box>
          <Text dimColor>  ↑ {moreAbove} more above</Text>
        </Box>
      )}

      {visible.map((f, i) => {
        const actualIdx = startIndex + i;
        const isSelected = selected.has(actualIdx);
        const isCursor = actualIdx === cursor;
        const name = basename(f.path);
        const planText = f.plan
          ? f.plan.videoAction === "copy"
            ? "copy (passthrough)"
            : `${f.plan.profile.codec} CRF ${String(f.plan.profile.crf)} preset ${f.plan.profile.preset}`
          : "auto-plan";

        return (
          <Box key={actualIdx}>
            <Text bold color={isCursor ? "cyan" : "gray"}>
              {isCursor ? "▶ " : "  "}
            </Text>
            <Text color={isSelected ? "green" : "gray"}>
              {isSelected ? "[✔] " : "[ ] "}
            </Text>
            <Text bold={isCursor} color={isCursor ? "white" : undefined}>
              {name.padEnd(28).slice(0, 28)}{" "}
            </Text>
            <Text dimColor>({planText})</Text>
          </Box>
        );
      })}

      {moreBelow > 0 && (
        <Box>
          <Text dimColor>  ↓ {moreBelow} more below</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          Selected: <Text bold color="green">{selected.size}</Text> of {total} files
        </Text>
      </Box>
    </Box>
  );
}
