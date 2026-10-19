/**
 * PlanReview — table of encoding settings, warnings, and naming preview.
 *
 * Shows per-file plan summary before encoding starts.
 * Keyboard: Enter=start, Esc=back
 */

import React, { useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { basename } from "node:path";
import type { EncodePlan } from "../../core/policy/planBuilder.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PlanReviewItem {
  plan: EncodePlan;
  sourceSizeBytes: number;
}

export interface PlanReviewProps {
  items: PlanReviewItem[];
  outputDir: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Max items to show before truncating. */
  maxVisible?: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PlanReview({
  items,
  outputDir,
  onConfirm,
  onCancel,
  maxVisible = 8,
}: PlanReviewProps): React.ReactElement {
  useInput(
    useCallback(
      (_input: string, key: { return?: boolean; escape?: boolean }) => {
        if (key.return) onConfirm();
        else if (key.escape) onCancel();
      },
      [onConfirm, onCancel],
    ),
  );

  const visible = items.slice(0, maxVisible);
  const hiddenCount = items.length - visible.length;

  const allWarnings: string[] = [];
  for (const { plan } of items) {
    for (const w of plan.warnings) {
      if (!allWarnings.includes(w)) {
        allWarnings.push(w);
      }
    }
  }

  const totalSourceBytes = items.reduce((acc, { sourceSizeBytes }) => acc + sourceSizeBytes, 0);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Plan Review</Text>
        <Text dimColor>
          {" "}
          ({String(items.length)} file{items.length !== 1 ? "s" : ""},{" "}
          {formatSize(totalSourceBytes)} source)
        </Text>
      </Box>

      {/* Per-file summary */}
      {visible.map(({ plan, sourceSizeBytes }, i) => {
        const isCopy = plan.videoAction === "copy";
        return (
          <Box key={i} flexDirection="column" marginBottom={1}>
            <Text bold>{basename(plan.sourceFile)}</Text>
            <Box marginLeft={2} flexDirection="column">
              <Box>
                <Text dimColor>Action: </Text>
                <Text color={isCopy ? "yellow" : "cyan"}>
                  {isCopy ? "copy video (already HEVC/AV1/VP9)" : "encode → libx265"}
                </Text>
              </Box>
              {!isCopy && (
                <>
                  <Box>
                    <Text dimColor>Profile: </Text>
                    <Text>{plan.profile.name}</Text>
                    <Text dimColor> CRF </Text>
                    <Text>{String(plan.profile.crf)}</Text>
                    <Text dimColor> Preset </Text>
                    <Text>{plan.profile.preset}</Text>
                  </Box>
                  {plan.profile.x265Params !== undefined && (
                    <Box>
                      <Text dimColor>x265: </Text>
                      <Text>{plan.profile.x265Params}</Text>
                    </Box>
                  )}
                </>
              )}
              <Box>
                <Text dimColor>Source: </Text>
                <Text>{formatSize(sourceSizeBytes)}</Text>
              </Box>
              <Box>
                <Text dimColor>Output: </Text>
                <Text color="green">{basename(plan.outputFile)}</Text>
              </Box>
              {plan.warnings.length > 0 &&
                plan.warnings.map((w, wi) => (
                  <Box key={wi}>
                    <Text color="yellow">⚠ {w}</Text>
                  </Box>
                ))}
            </Box>
          </Box>
        );
      })}

      {hiddenCount > 0 && (
        <Text dimColor>
          {" "}
          … and {String(hiddenCount)} more file{hiddenCount !== 1 ? "s" : ""}
        </Text>
      )}

      {/* Global warnings */}
      {allWarnings.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">
            Warnings:
          </Text>
          {allWarnings.map((w, i) => (
            <Text key={i} color="yellow">
              {"  ⚠ " + w}
            </Text>
          ))}
        </Box>
      )}

      {/* Output folder */}
      <Box marginTop={1}>
        <Text dimColor>Output folder: </Text>
        <Text color="cyan">{outputDir}</Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Enter=start encoding Esc=back</Text>
      </Box>
    </Box>
  );
}
