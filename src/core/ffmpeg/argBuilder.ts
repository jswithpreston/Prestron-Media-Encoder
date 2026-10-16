/**
 * FFmpeg argument builder — pure function, no side effects, no I/O.
 *
 * Takes an EncodePlan and returns the exact string[] to pass to ffmpeg via
 * execa. Every element is a separate arg; no shell interpolation is needed.
 */

import type { EncodePlan } from "../policy/planBuilder.js";
import type { FfmpegCapabilities } from "./capabilities.js";

const BRANDING = "Encoded by PrestonCash";

/**
 * Build the ffmpeg argument array for an encode plan.
 *
 * Argument order:
 *   -hide_banner -nostdin -n
 *   -i <sourceFile>
 *   -map 0  -map -0:d  -map_chapters 0  -map_metadata 0
 *   -c copy
 *   [video encode args when videoAction === 'encode']
 *   [fps passthrough flag]
 *   [-metadata comment=...  -metadata encoding_tool=... when branding enabled]
 *   -f matroska
 *   <partFile>
 */
export function buildArgs(plan: EncodePlan, _caps: FfmpegCapabilities): string[] {
  const args: string[] = [
    "-hide_banner",
    "-nostdin",
    "-n",
    "-i",
    plan.sourceFile,
    "-map",
    "0",
    "-map",
    "-0:d",
    "-map_chapters",
    "0",
    "-map_metadata",
    "0",
    "-c",
    "copy",
  ];

  if (plan.videoAction === "encode") {
    args.push(
      "-c:v",
      plan.profile.codec,
      "-crf",
      String(plan.profile.crf),
      "-preset",
      plan.profile.preset,
      "-pix_fmt",
      plan.profile.pixFmt,
    );
    if (plan.profile.x265Params) {
      args.push("-x265-params", plan.profile.x265Params);
    }
    args.push(plan.fpsModeFlag, plan.fpsModeValue);
  }

  if (plan.brandingEnabled) {
    args.push("-metadata", `comment=${BRANDING}`, "-metadata", `encoding_tool=${BRANDING}`);
  }

  args.push("-f", "matroska", plan.partFile);

  return args;
}
