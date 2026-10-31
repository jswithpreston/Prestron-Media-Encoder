/**
 * SessionInput — persistent bordered command prompt at the bottom of the screen.
 *
 * Features:
 *   - Cursor editing
 *   - Up/down command history traversal
 *   - Auto-opens SlashPalette on "/"
 *   - Ctrl+C callback hook
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

export interface SessionInputProps {
  onSubmit: (command: string) => void;
  onSlashTrigger: (query: string) => void;
  onEscape?: () => void;
  onCtrlC?: () => void;
  onQuit?: () => void;
  placeholder?: string;
  disabled?: boolean;
  history?: string[];
}

export function SessionInput({
  onSubmit,
  onSlashTrigger,
  onEscape,
  onCtrlC,
  onQuit,
  placeholder = "Type / for commands, or ? for help",
  disabled = false,
  history = [],
}: SessionInputProps): React.ReactElement {
  const [value, setValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [savedDraft, setSavedDraft] = useState("");

  useEffect(() => {
    setHistoryIndex(-1);
  }, [history.length]);

  useInput(
    (input, key) => {
      if (disabled) return;

      if (key.ctrl && input === "c") {
        onCtrlC?.();
        return;
      }

      if (value === "" && input === "q" && !key.ctrl && !key.meta) {
        onQuit?.();
        return;
      }

      if (key.escape) {
        if (value !== "") {
          setValue("");
        } else {
          onEscape?.();
        }
        return;
      }

      if (key.return) {
        const trimmed = value.trim();
        setValue("");
        setHistoryIndex(-1);
        setSavedDraft("");
        if (trimmed) {
          onSubmit(trimmed);
        }
        return;
      }

      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIndex === -1) {
          setSavedDraft(value);
          const nextIdx = history.length - 1;
          setHistoryIndex(nextIdx);
          setValue(history[nextIdx] ?? "");
        } else if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setValue(history[nextIdx] ?? "");
        }
        return;
      }

      if (key.downArrow) {
        if (historyIndex === -1) return;
        if (historyIndex < history.length - 1) {
          const nextIdx = historyIndex + 1;
          setHistoryIndex(nextIdx);
          setValue(history[nextIdx] ?? "");
        } else {
          setHistoryIndex(-1);
          setValue(savedDraft);
        }
        return;
      }

      if (key.backspace || key.delete) {
        setValue((prev) => prev.slice(0, -1));
        return;
      }

      if (input === "/" && value === "") {
        onSlashTrigger("/");
        return;
      }

      if (input.length === 1 && !key.ctrl && !key.meta) {
        const newVal = value + input;
        setValue(newVal);
        if (newVal.startsWith("/")) {
          onSlashTrigger(newVal);
        }
      }
    },
    { isActive: !disabled },
  );

  return (
    <Box borderStyle="single" borderColor="cyan" paddingX={1}>
      <Text bold color="cyan">
        &gt;{" "}
      </Text>
      {value === "" ? (
        <Box>
          <Text color="cyan">█</Text>
          <Text dimColor> {placeholder}</Text>
        </Box>
      ) : (
        <Box>
          <Text>{value}</Text>
          <Text color="cyan">█</Text>
        </Box>
      )}
    </Box>
  );
}
