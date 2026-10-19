/**
 * SlashPalette — filterable command palette triggered by typing "/".
 *
 * Keyboard:
 *   Type      — filter commands
 *   ↑/↓       — move cursor through filtered results
 *   Enter     — execute highlighted command (or run guided flow if input empty)
 *   Esc       — close palette
 *
 * Mouse:
 *   Click row — execute that command
 *   Wheel     — scroll
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type SlashCommand =
  | "scan"
  | "analyze"
  | "encode"
  | "profile"
  | "resume"
  | "verify"
  | "report"
  | "settings"
  | "help"
  | "quit";

interface CommandDef {
  name: SlashCommand;
  description: string;
}

const COMMANDS: CommandDef[] = [
  { name: "scan", description: "Rescan the current folder" },
  { name: "analyze", description: "Show plan and reasons per file" },
  { name: "encode", description: "Start encoding the selected files" },
  { name: "profile", description: "Choose encoding profile" },
  { name: "resume", description: "Continue an interrupted batch" },
  { name: "verify", description: "Re-verify files in Prestron-Encoded" },
  { name: "report", description: "Show / export results (JSON/CSV/text)" },
  { name: "settings", description: "Quality, preset, branding, mouse…" },
  { name: "help", description: "Show keybindings and commands" },
  { name: "quit", description: "Exit (confirms if encoding is active)" },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface SlashPaletteProps {
  onCommand: (cmd: SlashCommand | null) => void;
  mouseEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SlashPalette({
  onCommand,
  mouseEnabled = true,
}: SlashPaletteProps): React.ReactElement {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);

  const filtered = COMMANDS.filter(
    (c) => query === "" || c.name.startsWith(query) || c.description.toLowerCase().includes(query),
  );

  const confirm = useCallback(
    (idx: number) => {
      const cmd = filtered[idx];
      if (cmd) {
        onCommand(cmd.name);
      } else if (query === "") {
        // Empty input + Enter → run guided flow
        onCommand(null);
      }
    },
    [filtered, query, onCommand],
  );

  useInput((input, key) => {
    if (key.escape) {
      onCommand(null);
    } else if (key.return) {
      confirm(cursor);
    } else if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(filtered.length - 1, c + 1));
    } else if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      setCursor(0);
    } else if (input.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
      setCursor(0);
    }
  });

  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (evt.type === "press" && evt.button === "left") {
        const visIdx = evt.row - 5; // header + input = ~5 rows
        if (visIdx >= 0 && visIdx < filtered.length) {
          confirm(visIdx);
        }
      } else if (evt.button === "wheelUp") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (evt.button === "wheelDown") {
        setCursor((c) => Math.min(filtered.length - 1, c + 1));
      }
    },
    [filtered.length, confirm],
  );

  useMouse(handleMouse, !mouseEnabled);

  return (
    <Box flexDirection="column" borderStyle="round" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Command Palette</Text>
        <Text dimColor> (type to filter, Enter to run, Esc to close)</Text>
      </Box>

      {/* Search input */}
      <Box marginBottom={1}>
        <Text color="cyan">/ </Text>
        <Text>{query}</Text>
        <Text color="cyan">█</Text>
      </Box>

      {/* Results */}
      {filtered.length === 0 ? (
        <Text dimColor>No matching commands</Text>
      ) : (
        filtered.map((cmd, i) => (
          <Box key={cmd.name}>
            <Text
              {...(i === cursor ? { color: "cyan" as const } : {})}
              bold={i === cursor}
              inverse={i === cursor}
            >
              {` ${i === cursor ? "▶" : " "} /${cmd.name.padEnd(10)} `}
            </Text>
            <Text dimColor={i !== cursor}>{cmd.description}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
