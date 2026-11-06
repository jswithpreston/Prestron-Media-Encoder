/**
 * SlashPalette — in-session popup command menu triggered by "/" above input.
 *
 * Supports keyboard navigation (↑/↓), Tab completion, Enter confirmation,
 * Esc to cancel, and optional SGR mouse clicks.
 */

import React, { useState, useEffect, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";

export type SlashCommand =
  | "encode"
  | "analyze"
  | "files"
  | "info"
  | "calibrate"
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
  { name: "files", description: "Browse all files with estimates & recommendations" },
  { name: "info", description: "Deep inspection of streams, reasons & settings" },
  { name: "calibrate", description: "Run quick 20s sample encode to measure real compression ratio" },
  { name: "scan", description: "Rescan the current folder or a specified path" },
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
  onComplete?: ((cmd: SlashCommand) => void) | undefined;
  mouseEnabled?: boolean | undefined;
  filterQuery?: string | undefined;
}

export function SlashPalette({
  onCommand,
  onComplete,
  mouseEnabled = false,
  filterQuery = "",
}: SlashPaletteProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);

  const rawQuery = filterQuery.startsWith("/") ? filterQuery.slice(1) : filterQuery;
  const normQuery = rawQuery.toLowerCase().replace(/^analyse/, "analyze");

  const filtered = ALL_COMMANDS.filter(
    (c) =>
      normQuery === "" ||
      c.name.toLowerCase().startsWith(normQuery) ||
      (c.name === "analyze" && "analyse".startsWith(normQuery)) ||
      c.description.toLowerCase().includes(normQuery),
  );

  useEffect(() => {
    setCursor(0);
  }, [filterQuery]);

  const confirm = useCallback(
    (idx: number) => {
      const cmd = filtered[idx];
      if (cmd) {
        onCommand(cmd.name);
      } else {
        onCommand(null);
      }
    },
    [filtered, onCommand],
  );

  const complete = useCallback(
    (idx: number) => {
      const cmd = filtered[idx];
      if (cmd) {
        if (onComplete) {
          onComplete(cmd.name);
        } else {
          onCommand(cmd.name);
        }
      }
    },
    [filtered, onComplete, onCommand],
  );

  useInput((input, key) => {
    if (key.escape) {
      onCommand(null);
      return;
    }

    if (key.tab) {
      complete(cursor);
      return;
    }

    if (key.return) {
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
      <Text bold color="cyan">
        Command Menu (↑/↓ to navigate, Tab to autocomplete, Enter to choose, Esc to cancel)
      </Text>
      <Box flexDirection="column" marginY={1}>
        {filtered.length === 0 ? (
          <Text dimColor>No commands matching "{filterQuery}"</Text>
        ) : (
          filtered.map((cmd, idx) => {
            const isSelected = idx === cursor;
            return (
              <Box key={cmd.name}>
                <Text bold color={isSelected ? "cyan" : "gray"}>
                  {isSelected ? "▶ " : "  "}
                </Text>
                <Text bold color={isSelected ? "cyan" : "white"}>
                  {`/${cmd.name}`.padEnd(12)}
                </Text>
                <Text dimColor>{cmd.description}</Text>
              </Box>
            );
          })
        )}
      </Box>
    </Box>
  );
}
