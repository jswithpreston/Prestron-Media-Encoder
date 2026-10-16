/**
 * Plan builder — pure function, no I/O.
 *
 * Takes MediaInfo + classification + capabilities and returns an EncodePlan
 * that fully describes what ffmpeg will do. --dry-run simply prints this plan.
 */

import { basename, dirname, join } from "node:path";
import type { FfmpegCapabilities } from "../ffmpeg/capabilities.js";
import type { MediaInfo } from "../probe/index.js";
import type { ClassificationResult } from "../classifier/index.js";
import { type Profile, type ProfileName, PROFILES } from "./profiles.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type VideoAction = "encode" | "copy";

export interface PlanOptions {
  profileOverride?: ProfileName | undefined;
  crfOverride?: number | undefined;
  presetOverride?: string | undefined;
  /** Encode even if the source codec is already HEVC/AV1/VP9. */
  force?: boolean | undefined;
  /** Embed 'Encoded by PrestonCash' in output metadata. Default: true. */
  brandingEnabled?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface EncodePlan {
  sourceFile: string;
  /** Final output path (inside Prestron-Encoded/). */
  outputFile: string;
  /** Temporary path during encoding — renamed to outputFile on success. */
  partFile: string;
  videoAction: VideoAction;
  profile: Profile;
  reasons: string[];
  warnings: string[];
  fpsModeFlag: "-fps_mode" | "-vsync";
  fpsModeValue: "passthrough";
  brandingEnabled: boolean;
  estimatedOutputDir: string;
}

// ---------------------------------------------------------------------------
// Source codecs that are already compressed efficiently
// ---------------------------------------------------------------------------

const COPY_CODECS = new Set(["hevc", "h265", "av1", "vp9"]);

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

/**
 * Build an encode plan.
 *
 * @param mediaInfo - probed source metadata
 * @param classification - classifier output
 * @param caps - FFmpeg capability detection result
 * @param options - user overrides
 */
export function buildPlan(
  mediaInfo: MediaInfo,
  classification: ClassificationResult,
  caps: FfmpegCapabilities,
  options?: PlanOptions,
): EncodePlan {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // --- Resolve profile ---
  let profileName: Exclude<ProfileName, "auto">;

  const override = options?.profileOverride;
  if (override && override !== "auto") {
    profileName = override;
    reasons.push(`Profile overridden by user: ${override}`);
  } else if (classification.confidence < 0.6 || classification.kind === "unknown") {
    profileName = "conservative";
    reasons.push(
      `Low classification confidence (${classification.confidence.toFixed(2)}) — using conservative profile`,
    );
  } else {
    const kindMap: Record<string, Exclude<ProfileName, "auto">> = {
      movie: "movie",
      series: "series",
      anime: "anime",
    };
    profileName = kindMap[classification.kind] ?? "conservative";
    reasons.push(
      `Classified as ${classification.kind} (confidence ${classification.confidence.toFixed(2)}) — using ${profileName} profile`,
    );
  }

  // Clone the profile so overrides never mutate the global PROFILES object
  let profile: Profile = { ...PROFILES[profileName] };

  if (options?.crfOverride !== undefined) {
    profile = { ...profile, crf: options.crfOverride };
    reasons.push(`CRF overridden to ${String(options.crfOverride)}`);
  }
  if (options?.presetOverride !== undefined) {
    // Validate preset name; ignore unknown values silently with a warning
    const validPreset = [
      "ultrafast",
      "superfast",
      "veryfast",
      "faster",
      "fast",
      "medium",
      "slow",
      "slower",
      "veryslow",
    ].includes(options.presetOverride);
    if (validPreset) {
      profile = { ...profile, preset: options.presetOverride as Profile["preset"] };
      reasons.push(`Preset overridden to ${options.presetOverride}`);
    } else {
      warnings.push(
        `Unknown preset '${options.presetOverride}' ignored; using '${profile.preset}'`,
      );
    }
  }

  // --- Video action ---
  let videoAction: VideoAction = "encode";
  const sourceCodec = mediaInfo.video.codec.toLowerCase();
  if (COPY_CODECS.has(sourceCodec) && !options?.force) {
    videoAction = "copy";
    reasons.push(
      `Source video codec is ${mediaInfo.video.codec.toUpperCase()} — copying video stream (pass --force to re-encode)`,
    );
  }

  // --- Warnings ---
  if (mediaInfo.video.isHdr) {
    warnings.push(
      "HDR source: color signaling (transfer, primaries, space) is preserved, " +
        "but HDR10 static metadata and Dolby Vision are not re-injected in v1.",
    );
  }
  if (mediaInfo.video.isVfr) {
    warnings.push("Variable frame rate (VFR) source: using passthrough timestamps.");
  }

  // Propagate reasons from classifier
  reasons.push(...classification.reasons);

  // --- Output paths ---
  // For M1 (dry-run), output goes in a Prestron-Encoded/ dir beside the source.
  // Naming templates (M2) will replace the simple stem-based name below.
  const sourceDir = dirname(mediaInfo.path);
  const stem = basename(mediaInfo.path, ".mkv").replace(/\.(mp4|m4v|avi|mov|ts|webm|wmv)$/i, "");
  const outputDir = join(sourceDir, "Prestron-Encoded");
  const outputName = `${stem}.mkv`;
  const outputFile = join(outputDir, outputName);
  const partFile = outputFile + ".part";

  return {
    sourceFile: mediaInfo.path,
    outputFile,
    partFile,
    videoAction,
    profile,
    reasons,
    warnings,
    fpsModeFlag: caps.fpsModeFlag,
    fpsModeValue: caps.fpsModeValue,
    brandingEnabled: options?.brandingEnabled ?? true,
    estimatedOutputDir: outputDir,
  };
}
