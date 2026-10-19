/**
 * ResultsTable — per-file results: source size, output size, savings, status.
 */

import React from "react";
import { Box, Text } from "ink";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FileResult {
  sourcePath: string;
  outputPath: string | null;
  sourceSizeBytes: number;
  outputSizeBytes: number | null;
  state: "done" | "failed" | "skipped";
  error?: string | undefined;
  durationMs?: number | undefined;
}

export interface ResultsTableProps {
  results: FileResult[];
  outputDir: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

function formatSavings(src: number, out: number): string {
  const saved = src - out;
  const pct = src > 0 ? ((saved / src) * 100).toFixed(1) : "0.0";
  if (saved >= 0) return `↓ ${formatSize(saved)} (${pct}%)`;
  return `↑ ${formatSize(Math.abs(saved))} (${Math.abs(Number(pct)).toFixed(1)}% larger)`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResultsTable({ results, outputDir }: ResultsTableProps): React.ReactElement {
  const done = results.filter((r) => r.state === "done");
  const failed = results.filter((r) => r.state === "failed");
  const skipped = results.filter((r) => r.state === "skipped");

  const totalSrc = done.reduce((acc, r) => acc + r.sourceSizeBytes, 0);
  const totalOut = done.reduce((acc, r) => acc + (r.outputSizeBytes ?? 0), 0);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Results</Text>
        <Text dimColor>
          {" "}
          — {String(done.length)} done, {String(failed.length)} failed, {String(skipped.length)}{" "}
          skipped
        </Text>
      </Box>

      {/* Done files */}
      {done.map((r, i) => (
        <Box key={i} flexDirection="column" marginBottom={0}>
          <Box>
            <Text color="green">✔ </Text>
            <Text>{basename(r.sourcePath)}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text dimColor>
              {formatSize(r.sourceSizeBytes)} → {formatSize(r.outputSizeBytes ?? 0)}
              {"  "}
            </Text>
            <Text color="green">{formatSavings(r.sourceSizeBytes, r.outputSizeBytes ?? 0)}</Text>
          </Box>
        </Box>
      ))}

      {/* Failed files */}
      {failed.map((r, i) => (
        <Box key={i} flexDirection="column" marginBottom={0}>
          <Box>
            <Text color="red">✘ </Text>
            <Text>{basename(r.sourcePath)}</Text>
          </Box>
          {r.error !== undefined && (
            <Box marginLeft={2}>
              <Text color="red" dimColor>
                {r.error}
              </Text>
            </Box>
          )}
        </Box>
      ))}

      {/* Skipped files */}
      {skipped.map((r, i) => (
        <Box key={i}>
          <Text dimColor>⊘ </Text>
          <Text dimColor>{basename(r.sourcePath)} (skipped)</Text>
        </Box>
      ))}

      {/* Totals */}
      {done.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text dimColor>Total: </Text>
            <Text>
              {formatSize(totalSrc)} → {formatSize(totalOut)}
            </Text>
            <Text color="green"> {formatSavings(totalSrc, totalOut)}</Text>
          </Box>
        </Box>
      )}

      {/* Output folder */}
      <Box marginTop={1}>
        <Text dimColor>Output: </Text>
        <Text color="cyan">{outputDir}</Text>
      </Box>
    </Box>
  );
}
