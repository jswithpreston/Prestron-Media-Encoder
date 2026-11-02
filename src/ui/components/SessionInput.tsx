/**
 * SessionInput — persistent bordered command prompt at the bottom of the screen.
 *
 * Features:
 *   - Cursor editing & multi-character paste support
 *   - Up/down command history traversal
 *   - Auto-opens SlashPalette on leading "/" (without swallowing the slash!)
 *   - Auto-closes SlashPalette when spaces are entered (argument typing)
 *   - Ctrl+C callback hook & empty 'q' exit
 */

import React, { useState, useEffect } from "react";
import { Box, Text, useInput } from "ink";

export interface SessionInputProps {
  value?: string | undefined;
  onChange?: ((val: string) => void) | undefined;
  onSubmit: (command: string) => void;
  onSlashTrigger?: ((query: string) => void) | undefined;
  onSlashClose?: (() => void) | undefined;
  onEscape?: (() => void) | undefined;
  onCtrlC?: (() => void) | undefined;
  onQuit?: (() => void) | undefined;
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  history?: string[] | undefined;
}

export function SessionInput({
  value: propValue,
  onChange,
  onSubmit,
  onSlashTrigger,
  onSlashClose,
  onEscape,
  onCtrlC,
  onQuit,
  placeholder = "Type / for commands, or ? for help",
  disabled = false,
  history = [],
}: SessionInputProps): React.ReactElement {
  const [internalValue, setInternalValue] = useState("");
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [savedDraft, setSavedDraft] = useState("");

  const isControlled = propValue !== undefined;
  const currentValue = isControlled ? propValue : internalValue;

  const updateValue = (next: string) => {
    if (!isControlled) {
      setInternalValue(next);
    }
    onChange?.(next);
  };

  useEffect(() => {
    setHistoryIndex(-1);
  }, [history.length]);

  useInput(
    (input, key) => {
      if (disabled) return;

      // 1. Ctrl+C handling
      if (key.ctrl && input === "c") {
        onCtrlC?.();
        return;
      }

      // 2. 'q' quick-quit on empty input
      if (currentValue === "" && input === "q" && !key.ctrl && !key.meta) {
        onQuit?.();
        return;
      }

      // 3. Escape key: clear current input draft or invoke parent escape handler
      if (key.escape) {
        if (currentValue !== "") {
          updateValue("");
          onSlashClose?.();
        } else {
          onEscape?.();
        }
        return;
      }

      // 4. Return/Enter: submit command
      if (key.return) {
        const trimmed = currentValue.trim();
        updateValue("");
        setHistoryIndex(-1);
        setSavedDraft("");
        onSlashClose?.();
        if (trimmed) {
          onSubmit(trimmed);
        }
        return;
      }

      // 5. History traversal (Up/Down)
      if (key.upArrow) {
        if (history.length === 0) return;
        if (historyIndex === -1) {
          setSavedDraft(currentValue);
          const nextIdx = history.length - 1;
          setHistoryIndex(nextIdx);
          updateValue(history[nextIdx] ?? "");
        } else if (historyIndex > 0) {
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          updateValue(history[nextIdx] ?? "");
        }
        return;
      }

      if (key.downArrow) {
        if (historyIndex === -1) return;
        if (historyIndex < history.length - 1) {
          const nextIdx = historyIndex + 1;
          setHistoryIndex(nextIdx);
          updateValue(history[nextIdx] ?? "");
        } else {
          setHistoryIndex(-1);
          updateValue(savedDraft);
        }
        return;
      }

      // 6. Backspace / Delete
      if (key.backspace || key.delete) {
        const next = currentValue.slice(0, -1);
        updateValue(next);
        if (next.startsWith("/") && !next.includes(" ")) {
          onSlashTrigger?.(next);
        } else {
          onSlashClose?.();
        }
        return;
      }

      // 7. Text input & multi-character paste handling
      if (input.length > 0 && !key.ctrl && !key.meta && !key.tab) {
        const next = currentValue + input;
        updateValue(next);

        if (next.startsWith("/")) {
          if (next.includes(" ")) {
            onSlashClose?.();
          } else {
            onSlashTrigger?.(next);
          }
        } else {
          onSlashClose?.();
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
      {currentValue === "" ? (
        <Box>
          <Text color="cyan">█</Text>
          <Text dimColor> {placeholder}</Text>
        </Box>
      ) : (
        <Box>
          <Text>{currentValue}</Text>
          <Text color="cyan">█</Text>
        </Box>
      )}
    </Box>
  );
}
