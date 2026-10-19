/**
 * ProfilePicker — shows auto-detected profile with reasons and lets the
 * user accept it or choose a different one.
 *
 * Keyboard:
 *   ↑/↓  — move cursor (when overriding)
 *   Enter — confirm
 *   o     — toggle override mode
 *   Esc   — go back
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";
import type { ClassificationResult } from "../../core/classifier/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProfileChoice = "auto" | "movie" | "series" | "anime" | "conservative";

export interface ProfilePickerProps {
  classification: ClassificationResult;
  /** Auto-detected profile name */
  suggestedProfile: ProfileChoice;
  onConfirm: (profile: ProfileChoice) => void;
  onCancel: () => void;
  mouseEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Profile descriptions
// ---------------------------------------------------------------------------

const PROFILES: { name: ProfileChoice; crf: number | null; description: string }[] = [
  { name: "auto", crf: null, description: "Auto-detect (recommended)" },
  { name: "movie", crf: 21, description: "Live-action films — balanced quality" },
  { name: "series", crf: 22, description: "TV series — slightly more compression" },
  { name: "anime", crf: 19, description: "Animation — lower CRF + tuned for flat regions" },
  {
    name: "conservative",
    crf: 20,
    description: "Conservative — used when classification confidence is low",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfilePicker({
  classification,
  suggestedProfile,
  onConfirm,
  onCancel,
  mouseEnabled = true,
}: ProfilePickerProps): React.ReactElement {
  const [overriding, setOverriding] = useState(false);
  const [cursor, setCursor] = useState(() =>
    PROFILES.findIndex((p) => p.name === suggestedProfile),
  );

  const confirm = useCallback(() => {
    const chosen = overriding ? (PROFILES[cursor]?.name ?? suggestedProfile) : suggestedProfile;
    onConfirm(chosen);
  }, [overriding, cursor, suggestedProfile, onConfirm]);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
    } else if (key.return) {
      confirm();
    } else if (input === "o") {
      setOverriding((v) => !v);
    } else if (overriding) {
      if (key.upArrow || input === "k") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (key.downArrow || input === "j") {
        setCursor((c) => Math.min(PROFILES.length - 1, c + 1));
      }
    }
  });

  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (!overriding) return;
      if (evt.type === "press" && evt.button === "left") {
        // Approximate offset — profiles start after header (~6 rows)
        const visIdx = evt.row - 7;
        if (visIdx >= 0 && visIdx < PROFILES.length) {
          setCursor(visIdx);
          confirm();
        }
      } else if (evt.button === "wheelUp") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (evt.button === "wheelDown") {
        setCursor((c) => Math.min(PROFILES.length - 1, c + 1));
      }
    },
    [overriding, confirm],
  );

  useMouse(handleMouse, !mouseEnabled);

  const kindLabel =
    classification.kind === "unknown" ? "unknown (low confidence)" : classification.kind;
  const confidenceLabel = `${(classification.confidence * 100).toFixed(0)}%`;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Encoding Profile</Text>
      </Box>

      {/* Classification summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text>
          {"Detected: "}
          <Text bold color="cyan">
            {kindLabel}
          </Text>
          {" — confidence "}
          <Text color={classification.confidence >= 0.6 ? "green" : "yellow"}>
            {confidenceLabel}
          </Text>
        </Text>

        {classification.reasons.length > 0 && (
          <Box flexDirection="column" marginLeft={2}>
            {classification.reasons.map((r, i) => (
              <Text key={i} dimColor>
                {"• " + r}
              </Text>
            ))}
          </Box>
        )}
      </Box>

      {/* Suggested or override */}
      {!overriding ? (
        <Box flexDirection="column" marginBottom={1}>
          <Text>
            {"Profile: "}
            <Text bold color="cyan">
              {suggestedProfile}
            </Text>
          </Text>
          <Text dimColor>Press o to choose a different profile, Enter to accept</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold>Choose profile:</Text>
          {PROFILES.map((p, i) => (
            <Box key={p.name}>
              <Text
                {...(i === cursor ? { color: "cyan" as const } : {})}
                bold={i === cursor}
                inverse={i === cursor}
              >
                {` ${i === cursor ? "▶" : " "} ${p.name.padEnd(14)}${
                  p.crf !== null ? `CRF ${String(p.crf).padStart(2)}  ` : "        "
                }${p.description}`}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Enter=confirm o=override Esc=back</Text>
      </Box>
    </Box>
  );
}
