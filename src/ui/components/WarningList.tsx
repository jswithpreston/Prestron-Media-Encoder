/**
 * WarningList — renders a list of warning strings.
 */

import React from "react";
import { Box, Text } from "ink";

export interface WarningListProps {
  warnings: string[];
}

export function WarningList({ warnings }: WarningListProps): React.ReactElement | null {
  if (warnings.length === 0) return null;
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">
        Warnings:
      </Text>
      {warnings.map((w, i) => (
        <Box key={i} marginLeft={2}>
          <Text color="yellow">⚠ {w}</Text>
        </Box>
      ))}
    </Box>
  );
}
