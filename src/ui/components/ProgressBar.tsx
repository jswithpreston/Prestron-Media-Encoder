/**
 * ProgressBar — ASCII progress bar component for Ink.
 *
 * Renders as:  [████████░░░░░░░░░░░░]  42%
 *
 * Props:
 *   value    — 0–100
 *   width    — bar width in terminal columns (default 40)
 *   color    — Ink color string (default "cyan")
 *   label    — optional label prefix
 */

import React from "react";
import { Box, Text } from "ink";

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

export interface ProgressBarProps {
  value: number;
  width?: number;
  color?: string;
  label?: string;
}

export function ProgressBar({
  value,
  width = 40,
  color = "cyan",
  label,
}: ProgressBarProps): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, value));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const pct = `${String(Math.round(clamped)).padStart(3)}%`;

  return (
    <Box>
      {label !== undefined && <Text dimColor>{label} </Text>}
      <Text>[</Text>
      <Text color={color}>{bar}</Text>
      <Text>] {pct}</Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// BatchProgress — overall batch summary bar
// ---------------------------------------------------------------------------

export interface BatchProgressProps {
  done: number;
  failed: number;
  skipped: number;
  total: number;
  width?: number;
}

export function BatchProgress({
  done,
  failed,
  skipped,
  total,
  width = 40,
}: BatchProgressProps): React.ReactElement {
  const completed = done + failed + skipped;
  const pct = total > 0 ? (completed / total) * 100 : 0;

  return (
    <Box flexDirection="column">
      <ProgressBar value={pct} width={width} color="green" label="Batch:" />
      <Box marginLeft={2}>
        <Text color="green">✔ {String(done)} done </Text>
        {failed > 0 && <Text color="red">✘ {String(failed)} failed </Text>}
        {skipped > 0 && <Text dimColor>⊘ {String(skipped)} skipped </Text>}
        <Text dimColor>
          {String(completed)}/{String(total)}
        </Text>
      </Box>
    </Box>
  );
}
