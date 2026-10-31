/**
 * StatusBar — persistent status line rendered directly below the input box.
 * Displays current profile, file count, mouse tracking state, and keyboard help hint.
 */

import React from "react";
import { Box, Text } from "ink";

export interface StatusBarProps {
  profile: string;
  fileCount: number;
  mouseActive: boolean;
  hasColor?: boolean;
}

export function StatusBar({
  profile,
  fileCount,
  mouseActive,
  hasColor = true,
}: StatusBarProps): React.ReactElement {
  return (
    <Box paddingX={1}>
      <Text dimColor>Profile: </Text>
      <Text bold {...(hasColor ? { color: "cyan" as const } : {})}>
        {profile}
      </Text>

      <Text dimColor> │ </Text>
      <Text dimColor>Files: </Text>
      <Text bold>{fileCount}</Text>

      <Text dimColor> │ </Text>
      <Text dimColor>Mouse: </Text>
      <Text color={mouseActive ? "green" : "gray"}>
        {mouseActive ? "on" : "off"}
      </Text>

      <Text dimColor> │ </Text>
      <Text dimColor>Type </Text>
      <Text bold color="yellow">
        /
      </Text>
      <Text dimColor> for commands, </Text>
      <Text bold color="yellow">
        ?
      </Text>
      <Text dimColor> for help</Text>
    </Box>
  );
}
