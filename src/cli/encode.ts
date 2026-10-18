/**
 * `prestron encode [path]` — probe → plan → encode → verify → promote.
 *
 * Modes:
 *   --dry-run   Print plan + exact ffmpeg args; write nothing.
 *   --yes / -y  Non-interactive encode: runs immediately without confirmation.
 *
 * Exit codes:
 *   0   All files encoded and verified successfully (or all skipped).
 *   1   One or more files failed encoding or verification.
 *   2   Usage / configuration error.
 *   4   Insufficient disk space.
 */

import { Command } from "commander";
import { resolve, basename } from "node:path";
import { rename, mkdir, unlink, stat, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execa } from "execa";
import { scanDirectory } from "../core/scanner/index.js";
import { probeFile, type MediaInfo } from "../core/probe/index.js";
import { classify } from "../core/classifier/index.js";
import { buildPlan, type PlanOptions, type VideoAction } from "../core/policy/planBuilder.js";
import { buildArgs } from "../core/ffmpeg/argBuilder.js";
import { runEncode } from "../core/ffmpeg/runner.js";
import { verifyOutput } from "../core/verify/index.js";
import { checkDiskSpace } from "../core/ffmpeg/diskSpace.js";
import { registerCleanup, unregisterCleanup } from "../platform/signals.js";
import { getCapabilities } from "./getCapabilities.js";
import { openJournalStore } from "../core/jobs/journalDb.js";
import { recoverFolder } from "../core/jobs/recovery.js";
import type { ProcessRunner, FfmpegCapabilities } from "../core/ffmpeg/capabilities.js";
import type { ProfileName } from "../core/policy/profiles.js";

// ---------------------------------------------------------------------------
// Shared runner
// ---------------------------------------------------------------------------

const ffprobeRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

export interface EncodeOpts {
  dryRun?: boolean;
  yes?: boolean;
  json?: boolean;
  verbose?: boolean;
  profile?: string;
  crf?: string;
  preset?: string;
  force?: boolean;
  overwrite?: boolean;
  injectVerifyFailure?: string;
  ffmpegPath: string;
  ffprobePath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

export function formatSavings(srcBytes: number, outBytes: number): string {
  const saved = srcBytes - outBytes;
  const pct = srcBytes > 0 ? ((saved / srcBytes) * 100).toFixed(1) : "0.0";
  if (saved >= 0) {
    return `saved ${formatBytes(saved)} (${pct}% smaller)`;
  }
  return `grew ${formatBytes(Math.abs(saved))} (${Math.abs(Number(pct)).toFixed(1)}% larger)`;
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export function makeEncodeCommand(): Command {
  return new Command("encode")
    .argument("[path]", "Directory to encode", ".")
    .description("Encode video files in a folder to HEVC")
    .option("--dry-run", "Print plan + ffmpeg args without encoding")
    .option("-y, --yes", "Skip confirmation prompts and start encoding immediately")
    .option("--json", "Output structured JSON (dry-run only)")
    .option("--verbose", "Show detailed verbose logs including full ffmpeg error output")
    .option("--profile <name>", "Profile: auto|movie|series|anime|conservative", "auto")
    .option("--crf <n>", "Override CRF (0–51)")
    .option("--preset <name>", "Override x265 preset")
    .option("--force", "Encode even if source is already HEVC/AV1/VP9")
    .option("--overwrite", "Overwrite existing output files")
    .option("--inject-verify-failure <check>", "Inject a verification failure for testing")
    .option("--ffmpeg-path <path>", "Override ffmpeg binary path", "ffmpeg")
    .option("--ffprobe-path <path>", "Override ffprobe binary path", "ffprobe")
    .action(async (pathArg: string, opts: EncodeOpts) => {
      if (!opts.dryRun && !opts.yes) {
        console.error(
          "Specify --dry-run to preview the plan, or --yes to start encoding immediately.",
        );
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
        dryRun: opts.dryRun ?? false,
      };

      // -----------------------------------------------------------------------
      // DRY RUN
      // -----------------------------------------------------------------------
      if (opts.dryRun) {
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

          const plan = buildPlan(mediaInfo, classification, caps, {
            ...planOptions,
            episode: scannedFile.episode,
          });
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
        return;
      }

      // -----------------------------------------------------------------------
      // REAL ENCODE (--yes)
      // -----------------------------------------------------------------------
      console.log(`\nEncoding ${String(scanResult.files.length)} file(s) in ${dir}\n`);

      // Open SQLite journal
      const store = openJournalStore();

      // Run startup recovery (clean up crashed/interrupted jobs, stale .part files, deleted outputs)
      const recoveryReport = await recoverFolder(store, dir);
      if (recoveryReport.stalePartFilesRemoved.length > 0) {
        for (const p of recoveryReport.stalePartFilesRemoved) {
          console.log(`  [Recovery] Removed stale part file: ${basename(p)}`);
        }
      }
      if (recoveryReport.missingOutputsRequeued.length > 0) {
        for (const p of recoveryReport.missingOutputsRequeued) {
          console.log(`  [Recovery] Output missing for previously completed job; re-queued: ${basename(p)}`);
        }
      }
      if (recoveryReport.jobsRequeued.length > 0) {
        for (const p of recoveryReport.jobsRequeued) {
          console.log(`  [Recovery] Re-queued job: ${basename(p)}`);
        }
      }

      // Check or create batch in journal
      const batch =
        store.getActiveBatch(dir) ??
        store.createBatch({
          rootPath: dir,
          createdAt: Date.now(),
          status: "active",
          optionsJson: JSON.stringify(opts),
        });

      // --- Probe all files first, build plans ---
      interface FilePlan {
        scannedPath: string;
        plan: ReturnType<typeof buildPlan>;
        sourceSizeBytes: number;
        sourceMtimeMs: number;
        mediaInfo: MediaInfo;
      }

      const filePlans: FilePlan[] = [];
      let totalEstimatedSource = 0;

      for (const scannedFile of scanResult.files) {
        let mediaInfo;
        try {
          mediaInfo = await probeFile(scannedFile.path, ffprobeRunner, {
            ffprobeBinary: opts.ffprobePath,
            timeoutMs: 30_000,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  SKIP (probe error): ${basename(scannedFile.path)}: ${msg}`);
          continue;
        }

        const classification = classify({
          filePath: scannedFile.path,
          parentDirName: scannedFile.parentDir.split("/").pop() ?? "",
          parsedEpisode: scannedFile.episode,
          mediaInfo,
        });

        // Plan with templated final output destination
        const plan = buildPlan(mediaInfo, classification, caps, {
          ...planOptions,
          episode: scannedFile.episode,
        });

        const sourceSizeBytes = mediaInfo.sizeBytes;
        totalEstimatedSource += sourceSizeBytes;
        filePlans.push({
          scannedPath: scannedFile.path,
          plan,
          sourceSizeBytes,
          sourceMtimeMs: scannedFile.mtimeMs,
          mediaInfo,
        });
      }

      const firstPlan = filePlans[0];
      if (!firstPlan) {
        console.log("No encodable files found.");
        store.close();
        return;
      }

      // --- Check disk space (aggregate) ---
      const outputDir = firstPlan.plan.estimatedOutputDir;
      const diskCheck = await checkDiskSpace(outputDir, totalEstimatedSource);
      if (!diskCheck.available) {
        console.error(`\nError: ${diskCheck.message}`);
        store.close();
        process.exit(4);
      }
      console.log(`  ${diskCheck.message}\n`);

      // --- Encode each file ---
      let doneCount = 0;
      let failedCount = 0;
      let skippedCount = 0;
      let totalSavedBytes = 0;

      for (const { plan, sourceSizeBytes, sourceMtimeMs, mediaInfo } of filePlans) {
        const name = basename(plan.sourceFile);

        // Look up or register job in journal
        let job =
          store.findJobBySourcePath(plan.sourceFile) ??
          store.createJob({
            batchId: batch.id,
            sourcePath: plan.sourceFile,
            sourceSize: sourceSizeBytes,
            sourceMtimeMs,
            outputPath: plan.outputFile,
            state: "pending",
            planJson: JSON.stringify(plan),
            attempts: 0,
          });

        // --- Skip if output already exists (unless --overwrite) ---
        if (!opts.overwrite) {
          try {
            const existing = await stat(plan.outputFile);
            if (existing.size > 0) {
              console.log(`  SKIP (exists): ${basename(plan.outputFile)}`);
              skippedCount++;
              if (job.state !== "done") {
                store.transitionJobState(job.id, job.state, "done", {
                  outputSize: existing.size,
                  finishedAt: Date.now(),
                });
              }
              continue;
            }
          } catch {
            // Does not exist — proceed
          }
        } else {
          // If --overwrite is passed and job was done, reset to pending
          if (job.state === "done") {
            store.resetJobToPending(job.id);
            job = store.getJob(job.id) ?? job;
          }
        }

        // --- Create output directory with default umask ---
        await mkdir(plan.estimatedOutputDir, { recursive: true });

        // Ensure job is in 'pending' state before transitioning to 'encoding'
        if (job.state !== "pending") {
          store.resetJobToPending(job.id);
          job = store.getJob(job.id) ?? job;
        }

        // --- Transition job to 'encoding' in journal ---
        store.transitionJobState(job.id, "pending", "encoding", { startedAt: Date.now() });

        // --- Prepare cancellation & cleanup ---
        const abortController = new AbortController();
        const activeJobId = job.id;
        const cleanupPart = async () => {
          abortController.abort();
          try {
            await unlink(plan.partFile);
          } catch {
            /* ignore */
          }
          try {
            store.transitionJobState(activeJobId, "encoding", "interrupted", {
              finishedAt: Date.now(),
            });
          } catch {
            /* ignore if already transitioned */
          }
        };
        registerCleanup(cleanupPart);

        try {
          // --- Encode ---
          process.stdout.write(`  Encoding: ${name} ... `);

          const args = buildArgs(plan, caps);

          let lastPercent = 0;
          const encodeResult = await runEncode(args, {
            ffmpegBinary: opts.ffmpegPath,
            sourceDurationSecs: mediaInfo.durationSecs,
            signal: abortController.signal,
            onProgress: (p) => {
              lastPercent = Math.round(p.percentDone);
              process.stdout.write(`\r  Encoding: ${name} ... ${String(lastPercent)}%  `);
            },
          });

          if (!encodeResult.ok) {
            process.stdout.write(`\r  FAILED:   ${name}                    \n`);
            if (encodeResult.error) {
              if (opts.verbose) {
                console.error(encodeResult.error);
              } else {
                const lines = encodeResult.error
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean);
                const lastLine = lines[lines.length - 1] ?? "Unknown encode error";
                console.error(`           ${lastLine}`);
              }
            }
            try {
              await unlink(plan.partFile);
            } catch {
              /* ignore */
            }
            store.transitionJobState(activeJobId, "encoding", "failed", {
              error: encodeResult.error ?? "Encode failed",
              finishedAt: Date.now(),
            });
            failedCount++;
            continue;
          }

          // --- Transition to verifying ---
          store.transitionJobState(activeJobId, "encoding", "verifying");

          // --- Verify ---
          process.stdout.write(`\r  Verifying: ${name} ...               \n`);
          let verifyResult = await verifyOutput(
            plan.partFile,
            ffprobeRunner,
            {
              sourceDurationSecs: mediaInfo.durationSecs,
              sourceAudioCount: mediaInfo.audio.length,
              sourceSubtitleCount: mediaInfo.subtitles.length,
              sourceChapterCount: mediaInfo.chapterCount,
              sourceChapters: mediaInfo.chapters,
              sourceIsHdr: mediaInfo.video.isHdr,
              sourceWidth: mediaInfo.video.width,
              sourceHeight: mediaInfo.video.height,
            },
            opts.ffprobePath,
            opts.ffmpegPath,
          );

          // Support injected verification failure
          const injectedCheck =
            opts.injectVerifyFailure ?? process.env["PRESTRON_INJECT_VERIFY_FAILURE"];
          if (injectedCheck) {
            verifyResult = { ok: false, failedCheck: injectedCheck };
          }

          if (!verifyResult.ok) {
            console.error(`  FAILED (verify: ${verifyResult.failedCheck ?? "unknown"}): ${name}`);
            try {
              await unlink(plan.partFile);
            } catch {
              /* ignore */
            }
            store.transitionJobState(activeJobId, "verifying", "failed", {
              error: `Verify failed: ${verifyResult.failedCheck ?? "unknown"}`,
              finishedAt: Date.now(),
            });
            failedCount++;
            continue;
          }

          // --- Promote: rename .part → final (atomic on same filesystem) ---
          await rename(plan.partFile, plan.outputFile);

          const outStat = await stat(plan.outputFile);
          const outputSizeBytes = outStat.size;
          const savedBytes = sourceSizeBytes - outputSizeBytes;
          totalSavedBytes += savedBytes;

          // Transition to done
          store.transitionJobState(activeJobId, "verifying", "done", {
            outputSize: outputSizeBytes,
            finishedAt: Date.now(),
          });

          console.log(
            `  DONE: ${basename(plan.outputFile)}  ${formatBytes(sourceSizeBytes)} → ${formatBytes(outputSizeBytes)}  ${formatSavings(sourceSizeBytes, outputSizeBytes)}`,
          );
          doneCount++;
        } finally {
          unregisterCleanup(cleanupPart);
        }
      }

      // --- Update batch status ---
      store.updateBatch(batch.id, {
        status: failedCount > 0 ? "partial" : "done",
        finishedAt: Date.now(),
      });
      store.close();

      // --- Summary ---
      console.log("\n─────────────────────────────────────────");
      console.log(
        `Done: ${String(doneCount)}  Failed: ${String(failedCount)}  Skipped: ${String(skippedCount)}`,
      );
      if (doneCount > 0) {
        console.log(
          `Total savings: ${formatSavings(totalEstimatedSource, totalEstimatedSource - totalSavedBytes)}`,
        );
      }
      console.log(`Output folder: ${outputDir}`);

      if (failedCount > 0) {
        process.exit(1);
      }
    });
}

// ---------------------------------------------------------------------------
// Utility exported for integration tests
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of a file's contents.
 * Used in integration tests to verify originals are byte-identical after encoding.
 */
export async function sha256File(filePath: string): Promise<string> {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}
