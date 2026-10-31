/**
 * SlashPalette — filterable command palette triggered by typing "/".
 *
 * Supported commands:
 *   /encode, /analyze, /scan, /profile, /resume, /verify, /report,
 *   /settings, /status, /cancel, /help, /quit
 *
 * Keyboard:
 *   Type        — filter commands
 *   ↑/↓         — move selection cursor
 *   Tab / Enter — execute / complete selected command
 *   Esc         — dismiss palette
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";

export type SlashCommand =
  | "encode"
  | "analyze"
  | "scan"
  | "profile"
  | "resume"
  | "verify"
  | "report"
  | "settings"
  | "status"
  | "cancel"
  | "help"
  | "quit";

export interface CommandDef {
  name: SlashCommand;
  description: string;
}

export const ALL_COMMANDS: CommandDef[] = [
  { name: "encode", description: "Start encoding selected files" },
  { name: "analyze", description: "Show plan and reasons per file" },
  { name: "scan", description: "Rescan the current folder" },
  { name: "profile", description: "Choose encoding profile" },
  { name: "resume", description: "Continue an interrupted batch" },
  { name: "verify", description: "Re-verify files in Prestron-Encoded" },
  { name: "report", description: "Show / export results (JSON/CSV/text)" },
  { name: "settings", description: "Quality, preset, branding, mouse…" },
  { name: "status", description: "Show batch status and active jobs" },
  { name: "cancel", description: "Abort current encode safely" },
  { name: "help", description: "Show keybindings and commands" },
  { name: "quit", description: "Exit session" },
];

export interface SlashPaletteProps {
  onCommand: (cmd: SlashCommand | null) => void;
  mouseEnabled?: boolean;
  filterQuery?: string;
}

export function SlashPalette({
  onCommand,
  mouseEnabled = false,
  filterQuery = "",
}: SlashPaletteProps): React.ReactElement {
  const [internalQuery, setInternalQuery] = useState(filterQuery);
  const [cursor, setCursor] = useState(0);

  const query = internalQuery.startsWith("/") ? internalQuery.slice(1) : internalQuery;

  const filtered = ALL_COMMANDS.filter(
    (c) =>
      query === "" ||
      c.name.toLowerCase().startsWith(query.toLowerCase()) ||
      c.description.toLowerCase().includes(query.toLowerCase()),
  );

  const confirm = useCallback(
    (idx: number) => {
      const cmd = filtered[idx];
      if (cmd) {
        onCommand(cmd.name);
      } else if (query === "") {
        onCommand(null);
      }
    },
    [filtered, query, onCommand],
  );

  useInput((input, key) => {
    if (key.escape) {
      onCommand(null);
      return;
    }

    if (key.return || key.tab) {
      confirm(cursor);
      return;
    }

    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(Math.max(0, filtered.length - 1), c + 1));
      return;
    }

    if (key.backspace || key.delete) {
      setInternalQuery((q) => q.slice(0, -1));
      setCursor(0);
      return;
    }

    if (input.length === 1 && !key.ctrl && !key.meta) {
      setInternalQuery((q) => q + input);
      setCursor(0);
    }
  });

  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (evt.type === "press" && evt.button === "left") {
        const visIdx = evt.row - 2;
        if (visIdx >= 0 && visIdx < filtered.length) {
          confirm(visIdx);
        }
      } else if (evt.button === "wheelUp") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (evt.button === "wheelDown") {
        setCursor((c) => Math.min(Math.max(0, filtered.length - 1), c + 1));
      }
    },
    [filtered.length, confirm],
  );

  useMouse(handleMouse, !mouseEnabled);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">Command Menu</Text>
        <Text dimColor> (↑/↓ to navigate, Tab/Enter to choose, Esc to cancel)</Text>
      </Box>

      {query !== "" && (
        <Box marginBottom={1}>
          <Text color="cyan">/{query}</Text>
          <Text color="cyan">█</Text>
        </Box>
      )}

      {filtered.length === 0 ? (
        <Text dimColor>No matching commands</Text>
      ) : (
        filtered.map((cmd, i) => (
          <Box key={cmd.name}>
            <Text
              {...(i === cursor ? { color: "cyan" as const, bold: true } : { dimColor: true })}
            >
              {i === cursor ? "▶ " : "  "}
              {`/${cmd.name}`.padEnd(12)}
            </Text>
            <Text dimColor={i !== cursor}>{cmd.description}</Text>
          </Box>
        ))
      )}
    </Box>
  );
}
