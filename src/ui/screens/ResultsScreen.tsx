/**
 * ResultsScreen — final summary after encoding completes.
 *
 * Shows per-file savings, failures, total, and output folder.
 * Press q/Enter to exit.
 */

import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { ResultsTable, type FileResult } from "../components/ResultsTable.js";
import type { BatchState } from "../hooks/useBatch.js";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ResultsScreenProps {
  batchState: BatchState;
  onDone: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ResultsScreen({ batchState, onDone }: ResultsScreenProps): React.ReactElement {
  useInput(
    useCallback(
      (input: string, key: { return?: boolean }) => {
        if (key.return || input === "q") {
          onDone();
        }
      },
      [onDone],
    ),
  );

  // Build FileResult list from batchState
  const results: FileResult[] = batchState.files.map((f) => ({
    sourcePath: f.path,
    outputPath: f.plan?.outputFile ?? null,
    sourceSizeBytes: f.sourceSizeBytes,
    outputSizeBytes: f.outputSizeBytes,
    state: f.phase === "done" ? "done" : f.phase === "skipped" ? "skipped" : "failed",
    error: f.error ?? undefined,
  }));

  const outputDir =
    batchState.files.find((f) => f.plan)?.plan?.estimatedOutputDir ?? batchState.rootDir;

  const failed = results.filter((r) => r.state === "failed").length;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={failed > 0 ? "yellow" : "green"}>
          {failed === 0
            ? "✔ Encoding complete!"
            : `⚠ Encoding done with ${String(failed)} failure${failed !== 1 ? "s" : ""}`}
        </Text>
      </Box>

      <ResultsTable results={results} outputDir={outputDir} />

      <Box marginTop={1}>
        <Text dimColor>Press q or Enter to exit</Text>
      </Box>
    </Box>
  );
}
