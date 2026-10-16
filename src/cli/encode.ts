/**
 * `prestron encode [path] --dry-run` — print plan + ffmpeg args without encoding.
 * Full encoding is implemented in M2.
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { execa } from "execa";
import { scanDirectory } from "../core/scanner/index.js";
import { probeFile } from "../core/probe/index.js";
import { classify } from "../core/classifier/index.js";
import { buildPlan, type PlanOptions, type VideoAction } from "../core/policy/planBuilder.js";
import { buildArgs } from "../core/ffmpeg/argBuilder.js";
import { getCapabilities } from "./getCapabilities.js";
import type { ProcessRunner, FfmpegCapabilities } from "../core/ffmpeg/capabilities.js";
import type { ProfileName } from "../core/policy/profiles.js";

interface DryRunError {
  file: string;
  error: string | null;
}

interface DryRunSuccess {
  file: string;
  outputFile: string;
  videoAction: VideoAction;
  profile: string;
  crf: number;
  preset: string;
  reasons: string[];
  warnings: string[];
  ffmpegArgs: string[];
}

type DryRunResultItem = DryRunError | DryRunSuccess;

const ffprobeRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

interface EncodeOptions {
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  profile?: string;
  crf?: string;
  preset?: string;
  force?: boolean;
  ffmpegPath: string;
  ffprobePath: string;
}

export function makeEncodeCommand(): Command {
  return new Command("encode")
    .argument("[path]", "Directory to encode", ".")
    .description("Encode video files in a folder to HEVC")
    .option("--dry-run", "Print plan + ffmpeg args without encoding")
    .option("--yes, -y", "Skip confirmation prompts")
    .option("--json", "Output structured JSON")
    .option("--profile <name>", "Profile: auto|movie|series|anime|conservative", "auto")
    .option("--crf <n>", "Override CRF (0-51)")
    .option("--preset <name>", "Override x265 preset")
    .option("--force", "Encode even if source is already HEVC/AV1/VP9")
    .option("--ffmpeg-path <path>", "Override ffmpeg binary path", "ffmpeg")
    .option("--ffprobe-path <path>", "Override ffprobe binary path", "ffprobe")
    .action(async (pathArg: string, opts: EncodeOptions) => {
      if (!opts.dryRun) {
        console.error("Full encoding is implemented in M2. Use --dry-run to preview the plan.");
        process.exit(2);
      }

      const dir = resolve(pathArg);
      const caps: FfmpegCapabilities = await getCapabilities(opts.ffmpegPath);
      const scanResult = await scanDirectory(dir);

      if (scanResult.files.length === 0) {
        if (opts.json) {
          console.log("[]");
        } else {
          console.log(`No video files found in: ${dir}`);
        }
        return;
      }

      const planOptions: PlanOptions = {
        ...(opts.profile && opts.profile !== "auto"
          ? { profileOverride: opts.profile as ProfileName }
          : {}),
        ...(opts.crf !== undefined ? { crfOverride: parseInt(opts.crf, 10) } : {}),
        ...(opts.preset !== undefined ? { presetOverride: opts.preset } : {}),
        ...(opts.force ? { force: true } : {}),
        dryRun: true,
      };

      const dryRunResults: DryRunResultItem[] = [];

      for (const scannedFile of scanResult.files) {
        let probeError: string | null = null;
        let mediaInfo = null;

        try {
          mediaInfo = await probeFile(scannedFile.path, ffprobeRunner, {
            ffprobeBinary: opts.ffprobePath,
            timeoutMs: 30_000,
          });
        } catch (err) {
          probeError = err instanceof Error ? err.message : String(err);
        }

        if (!mediaInfo) {
          dryRunResults.push({ file: scannedFile.path, error: probeError });
          continue;
        }

        const classification = classify({
          filePath: scannedFile.path,
          parentDirName: scannedFile.parentDir.split("/").pop() ?? "",
          parsedEpisode: scannedFile.episode,
          mediaInfo,
        });

        const plan = buildPlan(mediaInfo, classification, caps, planOptions);
        const ffmpegArgs = buildArgs(plan, caps);

        dryRunResults.push({
          file: scannedFile.path,
          outputFile: plan.outputFile,
          videoAction: plan.videoAction,
          profile: plan.profile.name,
          crf: plan.profile.crf,
          preset: plan.profile.preset,
          reasons: plan.reasons,
          warnings: plan.warnings,
          ffmpegArgs,
        });
      }

      if (opts.json) {
        console.log(JSON.stringify(dryRunResults, null, 2));
        return;
      }

      console.log(`[DRY RUN] ${String(dryRunResults.length)} file(s) in ${dir}\n`);
      for (const r of dryRunResults) {
        console.log(`── ${r.file}`);
        if ("error" in r && r.error) {
          console.log(`   ERROR: ${r.error}`);
          continue;
        }
        if ("outputFile" in r) {
          console.log(`   Output:  ${r.outputFile}`);
          console.log(
            `   Action:  ${r.videoAction}  Profile: ${r.profile}  CRF: ${String(r.crf)}  Preset: ${r.preset}`,
          );
          if (r.warnings.length > 0) {
            for (const w of r.warnings) {
              console.log(`   Warning: ${w}`);
            }
          }
          if (r.ffmpegArgs.length > 0) {
            console.log(
              `   ffmpeg ${r.ffmpegArgs.map((a: string) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`,
            );
          }
        }
        console.log("");
      }
    });
}
