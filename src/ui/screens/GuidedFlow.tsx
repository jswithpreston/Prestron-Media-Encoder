/**
 * GuidedFlow — multi-step wizard: file pick → profile → plan review → confirm.
 *
 * Steps:
 *   1. FileChecklist   — pick which files to encode
 *   2. ProfilePicker   — confirm / override profile
 *   3. PlanReview      — view settings, warnings, naming preview
 *   (onConfirm called) — App transitions to EncodingScreen
 */

import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { FileChecklist, type FileItem } from "../components/FileChecklist.js";
import { ProfilePicker, type ProfileChoice } from "../components/ProfilePicker.js";
import { PlanReview, type PlanReviewItem } from "../components/PlanReview.js";
import type { BatchFile } from "../hooks/useBatch.js";
import type { FfmpegCapabilities } from "../../core/ffmpeg/capabilities.js";
import type { ClassificationResult } from "../../core/classifier/index.js";
import { classify } from "../../core/classifier/index.js";
import { buildPlan } from "../../core/policy/planBuilder.js";
import { dirname } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FlowStep = "files" | "profile" | "plan";

export interface GuidedFlowProps {
  batchFiles: BatchFile[];
  caps: FfmpegCapabilities;
  onConfirm: (selectedPaths: string[], profile: ProfileChoice) => void;
  onCancel: () => void;
  mouseEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GuidedFlow({
  batchFiles,
  caps,
  onConfirm,
  onCancel,
  mouseEnabled = true,
}: GuidedFlowProps): React.ReactElement {
  const [step, setStep] = useState<FlowStep>("files");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [profile, setProfile] = useState<ProfileChoice>("auto");
  const [planItems, setPlanItems] = useState<PlanReviewItem[]>([]);

  // Convert BatchFile to FileItem for the checklist
  const fileItems: FileItem[] = batchFiles
    .filter(
      (f): f is BatchFile & { mediaInfo: NonNullable<BatchFile["mediaInfo"]> } =>
        f.mediaInfo !== null,
    )
    .map((f) => ({
      path: f.path,
      sizeBytes: f.sourceSizeBytes,
      codec: f.mediaInfo.video.codec,
      durationSecs: f.mediaInfo.durationSecs,
    }));

  // Classification for the first file (used in ProfilePicker)
  const firstFile = batchFiles.find((f) => f.mediaInfo !== null);
  const classification: ClassificationResult =
    firstFile?.mediaInfo != null
      ? classify({
          filePath: firstFile.path,
          parentDirName: dirname(firstFile.path).split("/").pop() ?? "",
          parsedEpisode: null,
          mediaInfo: firstFile.mediaInfo,
        })
      : { kind: "unknown", confidence: 0, reasons: ["No files to classify"] };

  const suggestedProfile: ProfileChoice =
    classification.confidence < 0.6
      ? "conservative"
      : classification.kind === "anime"
        ? "anime"
        : classification.kind === "series"
          ? "series"
          : classification.kind === "movie"
            ? "movie"
            : "conservative";

  // Step 1 → 2: files confirmed
  const handleFilesConfirm = useCallback((paths: string[]) => {
    setSelectedPaths(paths);
    setStep("profile");
  }, []);

  // Step 2 → 3: profile confirmed — build plans
  const handleProfileConfirm = useCallback(
    (chosen: ProfileChoice) => {
      setProfile(chosen);

      // Build plan for each selected file
      const selectedFiles = batchFiles.filter(
        (f): f is BatchFile & { mediaInfo: NonNullable<BatchFile["mediaInfo"]> } =>
          f.mediaInfo !== null && selectedPaths.includes(f.path),
      );

      const items: PlanReviewItem[] = selectedFiles.map((f) => {
        const fileClassification = classify({
          filePath: f.path,
          parentDirName: dirname(f.path).split("/").pop() ?? "",
          parsedEpisode: null,
          mediaInfo: f.mediaInfo,
        });
        const plan = buildPlan(f.mediaInfo, fileClassification, caps, {
          profileOverride: chosen,
        });
        return { plan, sourceSizeBytes: f.sourceSizeBytes };
      });

      setPlanItems(items);
      setStep("plan");
    },
    [batchFiles, selectedPaths, caps],
  );

  // Step 3: plan confirmed → encoding
  const handlePlanConfirm = useCallback(() => {
    onConfirm(selectedPaths, profile);
  }, [selectedPaths, profile, onConfirm]);

  // Step indicator
  const stepLabels: Record<FlowStep, string> = {
    files: "1. Select Files",
    profile: "2. Profile",
    plan: "3. Review Plan",
  };
  const steps: FlowStep[] = ["files", "profile", "plan"];

  return (
    <Box flexDirection="column">
      {/* Step indicator */}
      <Box marginBottom={1}>
        {steps.map((s, i) => (
          <Box key={s}>
            {i > 0 && <Text dimColor> › </Text>}
            <Text
              bold={s === step}
              {...(s === step ? { color: "cyan" as const } : {})}
              dimColor={s !== step}
            >
              {stepLabels[s]}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Active step */}
      {step === "files" && (
        <FileChecklist
          files={fileItems}
          onConfirm={handleFilesConfirm}
          onCancel={onCancel}
          mouseEnabled={mouseEnabled}
        />
      )}

      {step === "profile" && (
        <ProfilePicker
          classification={classification}
          suggestedProfile={suggestedProfile}
          onConfirm={handleProfileConfirm}
          onCancel={() => setStep("files")}
          mouseEnabled={mouseEnabled}
        />
      )}

      {step === "plan" && planItems.length > 0 && (
        <PlanReview
          items={planItems}
          outputDir={planItems[0]?.plan.estimatedOutputDir ?? ""}
          onConfirm={handlePlanConfirm}
          onCancel={() => setStep("profile")}
        />
      )}
    </Box>
  );
}
