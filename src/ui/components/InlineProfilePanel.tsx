/**
 * InlineProfilePanel — inline profile picker for the /profile command.
 */

import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { PROFILES, type ProfileName } from "../../core/policy/profiles.js";
import { useMouse, type MouseEvent } from "../hooks/useMouse.js";

export interface InlineProfilePanelProps {
  currentProfile: ProfileName;
  onSelect: (profile: ProfileName) => void;
  onCancel: () => void;
  mouseEnabled?: boolean;
}

const PROFILE_ITEMS: { name: ProfileName; desc: string }[] = [
  { name: "series", desc: `CRF ${PROFILES.series.crf}, ${PROFILES.series.preset} — General TV series and episodic content` },
  { name: "movie", desc: `CRF ${PROFILES.movie.crf}, ${PROFILES.movie.preset} — High quality, no-sao for grain preservation` },
  { name: "anime", desc: `CRF ${PROFILES.anime.crf}, ${PROFILES.anime.preset} — Optimized for animation and 2D lines` },
  { name: "conservative", desc: `CRF ${PROFILES.conservative.crf}, ${PROFILES.conservative.preset} — Near-lossless, minimal artifacting` },
];

export function InlineProfilePanel({
  currentProfile,
  onSelect,
  onCancel,
  mouseEnabled = false,
}: InlineProfilePanelProps): React.ReactElement {
  const initialIndex = Math.max(
    0,
    PROFILE_ITEMS.findIndex((p) => p.name === currentProfile),
  );
  const [cursor, setCursor] = useState(initialIndex);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.return) {
      const selected = PROFILE_ITEMS[cursor];
      if (selected) onSelect(selected.name);
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(PROFILE_ITEMS.length - 1, c + 1));
      return;
    }
  });

  const handleMouse = useCallback(
    (evt: MouseEvent) => {
      if (evt.type === "press" && evt.button === "left") {
        const selected = PROFILE_ITEMS[cursor];
        if (selected) onSelect(selected.name);
      } else if (evt.button === "wheelUp") {
        setCursor((c) => Math.max(0, c - 1));
      } else if (evt.button === "wheelDown") {
        setCursor((c) => Math.min(PROFILE_ITEMS.length - 1, c + 1));
      }
    },
    [cursor, onSelect],
  );

  useMouse(handleMouse, !mouseEnabled);

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
          Select Encoding Profile
        </Text>
        <Text dimColor> (↑/↓ to choose, Enter to select, Esc to cancel)</Text>
      </Box>

      {PROFILE_ITEMS.map((item, idx) => {
        const isCursor = idx === cursor;
        const isCurrent = item.name === currentProfile;

        return (
          <Box key={item.name}>
            <Text bold color={isCursor ? "cyan" : "gray"}>
              {isCursor ? "▶ " : "  "}
            </Text>
            <Text bold color={isCurrent ? "green" : undefined}>
              {item.name.padEnd(14)}
            </Text>
            <Text dimColor>{item.desc}</Text>
            {isCurrent && <Text color="green"> (active)</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
