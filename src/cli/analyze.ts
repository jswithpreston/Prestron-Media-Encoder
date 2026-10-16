/**
 * `prestron analyze [path] [--json]` — probe, classify, and show encode plans.
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { execa } from "execa";
import { scanDirectory } from "../core/scanner/index.js";
import { probeFile } from "../core/probe/index.js";
import { classify } from "../core/classifier/index.js";
import { buildPlan } from "../core/policy/planBuilder.js";
import { getCapabilities } from "./getCapabilities.js";
import type { ProcessRunner } from "../core/ffmpeg/capabilities.js";

const ffprobeRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

export function makeAnalyzeCommand(): Command {
  return new Command("analyze")
    .argument("[path]", "Directory to analyze", ".")
    .description("Probe, classify, and show encode plans for each file")
    .option("--json", "Output structured JSON")
    .option("--ffprobe-path <path>", "Override ffprobe binary path", "ffprobe")
    .option("--ffmpeg-path <path>", "Override ffmpeg binary path", "ffmpeg")
    .action(
      async (
        pathArg: string,
        opts: { json?: boolean; ffprobePath: string; ffmpegPath: string },
      ) => {
        const dir = resolve(pathArg);
        const caps = await getCapabilities(opts.ffmpegPath);
        const scanResult = await scanDirectory(dir);

        if (scanResult.files.length === 0) {
          if (opts.json) {
            console.log("[]");
          } else {
            console.log(`No video files found in: ${dir}`);
          }
          return;
        }

        const results = [];

        for (const scannedFile of scanResult.files) {
          let mediaInfo = null;
          let probeError: string | null = null;

          try {
            mediaInfo = await probeFile(scannedFile.path, ffprobeRunner, {
              ffprobeBinary: opts.ffprobePath,
              timeoutMs: 30_000,
            });
          } catch (err) {
            probeError = err instanceof Error ? err.message : String(err);
          }

          const classification = classify({
            filePath: scannedFile.path,
            parentDirName: scannedFile.parentDir.split("/").pop() ?? "",
            parsedEpisode: scannedFile.episode,
            ...(mediaInfo != null ? { mediaInfo } : {}),
          });

          const plan = mediaInfo ? buildPlan(mediaInfo, classification, caps) : null;

          results.push({ file: scannedFile.path, mediaInfo, classification, plan, probeError });
        }

        if (opts.json) {
          console.log(JSON.stringify(results, null, 2));
          return;
        }

        for (const r of results) {
          console.log(`\n── ${r.file}`);
          if (r.probeError) {
            console.log(`   ERROR: ${r.probeError}`);
            continue;
          }
          if (r.mediaInfo) {
            const v = r.mediaInfo.video;
            console.log(
              `   ${v.codec.toUpperCase()} ${String(v.width)}x${String(v.height)} @ ${v.fps.toFixed(3)} fps  ${v.pixFmt}${v.isHdr ? "  [HDR]" : ""}`,
            );
            console.log(
              `   Audio: ${String(r.mediaInfo.audio.length)} track(s)  Subtitles: ${String(r.mediaInfo.subtitles.length)}  Chapters: ${String(r.mediaInfo.chapterCount)}`,
            );
          }
          console.log(
            `   Classification: ${r.classification.kind} (confidence ${r.classification.confidence.toFixed(2)})`,
          );
          if (r.plan) {
            console.log(
              `   Profile: ${r.plan.profile.name}  CRF: ${String(r.plan.profile.crf)}  Preset: ${r.plan.profile.preset}`,
            );
            if (r.plan.warnings.length > 0) {
              for (const w of r.plan.warnings) {
                console.log(`   Warning: ${w}`);
              }
            }
          }
        }
      },
    );
}
