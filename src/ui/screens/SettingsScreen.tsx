/**
 * SettingsScreen — in-app settings panel.
 *
 * Allows toggling: mouse support, branding metadata, quality preset override.
 * Changes are in-memory only for v1; a persistent config file is a v2 feature.
 *
 * Keyboard:
 *   ↑/↓   — move between settings
 *   Space/Enter — toggle / cycle value
 *   Esc   — close and go back
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PRESETS, type Preset } from "../../core/policy/profiles.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Settings {
  mouseEnabled: boolean;
  brandingEnabled: boolean;
  presetOverride: Preset | "auto";
  crfOverride: number | null;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseEnabled: true,
  brandingEnabled: true,
  presetOverride: "auto",
  crfOverride: null,
};

export interface SettingsScreenProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Setting row definitions
// ---------------------------------------------------------------------------

type SettingKey = keyof Settings;

interface SettingRow {
  key: SettingKey;
  label: string;
  description: string;
}

const ROWS: SettingRow[] = [
  {
    key: "mouseEnabled",
    label: "Mouse support",
    description: "Enable click/scroll (disables text selection; hold Shift to select)",
  },
  {
    key: "brandingEnabled",
    label: "Branding metadata",
    description: "Embed 'Encoded by PrestonCash' in output file metadata",
  },
  {
    key: "presetOverride",
    label: "Preset override",
    description: "Override x265 preset (auto = use profile default: medium)",
  },
  {
    key: "crfOverride",
    label: "CRF override",
    description: "Override CRF (0–51), auto = use profile default",
  },
];

// ---------------------------------------------------------------------------
// Value rendering
// ---------------------------------------------------------------------------

function renderValue(key: SettingKey, settings: Settings): string {
  switch (key) {
    case "mouseEnabled":
      return settings.mouseEnabled ? "on" : "off";
    case "brandingEnabled":
      return settings.brandingEnabled ? "on" : "off";
    case "presetOverride":
      return settings.presetOverride;
    case "crfOverride":
      return settings.crfOverride !== null ? String(settings.crfOverride) : "auto";
  }
}

// ---------------------------------------------------------------------------
// Value cycling
// ---------------------------------------------------------------------------

export function cycleValue(key: SettingKey, settings: Settings, direction: 1 | -1): Settings {
  const s = { ...settings };
  switch (key) {
    case "mouseEnabled":
      s.mouseEnabled = !s.mouseEnabled;
      break;
    case "brandingEnabled":
      s.brandingEnabled = !s.brandingEnabled;
      break;
    case "presetOverride": {
      const opts: (Preset | "auto")[] = ["auto", ...PRESETS];
      const idx = opts.indexOf(s.presetOverride);
      const next = (idx + direction + opts.length) % opts.length;
      s.presetOverride = opts[next] ?? "auto";
      break;
    }
    case "crfOverride": {
      const current = s.crfOverride ?? 21;
      const next = Math.min(51, Math.max(0, current + direction));
      s.crfOverride = next;
      break;
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SettingsScreen({
  settings,
  onSave,
  onCancel,
}: SettingsScreenProps): React.ReactElement {
  const [cursor, setCursor] = useState(0);
  const [local, setLocal] = useState<Settings>({ ...settings });

  const currentRow = ROWS[cursor];

  useInput(
    useCallback(
      (
        input: string,
        key: {
          upArrow?: boolean;
          downArrow?: boolean;
          return?: boolean;
          escape?: boolean;
          rightArrow?: boolean;
          leftArrow?: boolean;
        },
      ) => {
        if (key.escape) {
          onCancel();
          return;
        }
        if (key.upArrow) {
          setCursor((c) => Math.max(0, c - 1));
          return;
        }
        if (key.downArrow) {
          setCursor((c) => Math.min(ROWS.length - 1, c + 1));
          return;
        }
        if ((input === " " || key.return) && currentRow) {
          setLocal((s) => cycleValue(currentRow.key, s, 1));
          return;
        }
        if (key.rightArrow && currentRow) {
          setLocal((s) => cycleValue(currentRow.key, s, 1));
          return;
        }
        if (key.leftArrow && currentRow) {
          setLocal((s) => cycleValue(currentRow.key, s, -1));
          return;
        }
        if (input === "s") {
          onSave(local);
          return;
        }
      },
      [cursor, currentRow, local, onSave, onCancel],
    ),
  );

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold>Settings</Text>
      <Text dimColor>↑/↓ move Space/→ cycle s save Esc cancel</Text>
      <Box marginTop={1} flexDirection="column">
        {ROWS.map((row, i) => {
          const selected = i === cursor;
          return (
            <Box key={row.key} marginBottom={0}>
              {selected ? (
                <Text color="cyan">
                  {"▶ "}
                  {row.label.padEnd(22)}
                </Text>
              ) : (
                <Text>
                  {"  "}
                  {row.label.padEnd(22)}
                </Text>
              )}
              {selected ? (
                <Text bold color="yellow">
                  {renderValue(row.key, local)}
                </Text>
              ) : (
                <Text>{renderValue(row.key, local)}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      {currentRow && (
        <Box marginTop={1}>
          <Text dimColor>{currentRow.description}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>Press s to save and apply, Esc to cancel without saving.</Text>
      </Box>
    </Box>
  );
}
