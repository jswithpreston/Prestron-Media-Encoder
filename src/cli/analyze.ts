/**
 * `prestron analyze [path] [--json] [--detail] [--deep]`
 *
 * Probe, classify, recommend, estimate storage savings, and show encode plans.
 */

import { Command } from "commander";
import { basename, resolve } from "node:path";
import { execa } from "execa";
import { scanDirectory } from "../core/scanner/index.js";
import { probeBatch } from "../core/probe/batchProbe.js";
import { openJournalStore } from "../core/jobs/journalDb.js";
import { classify } from "../core/classifier/index.js";
import { buildPlan } from "../core/policy/planBuilder.js";
import { recommend, type RecommendationResult } from "../core/recommendation/index.js";
import { estimateSize, computeFolderSummary, type SizeEstimate } from "../core/estimation/index.js";
import { getCapabilities } from "./getCapabilities.js";
import { formatBytes } from "./encode.js";
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
    .description("Probe, classify, recommend, and estimate storage savings for each file")
    .option("--json", "Output structured, versioned JSON")
    .option("--detail", "Show detailed per-stream audio, subtitle, and container breakdown")
    .option("--deep", "Perform deep opt-in interlace analysis via ffmpeg idet")
    .option("--ffprobe-path <path>", "Override ffprobe binary path", "ffprobe")
    .option("--ffmpeg-path <path>", "Override ffmpeg binary path", "ffmpeg")
    .action(
      async (
        pathArg: string,
        opts: {
          json?: boolean;
          detail?: boolean;
          deep?: boolean;
          ffprobePath: string;
          ffmpegPath: string;
        },
      ) => {
        const dir = resolve(pathArg);
        const caps = await getCapabilities(opts.ffmpegPath);
        const scanResult = await scanDirectory(dir);

        if (scanResult.files.length === 0) {
          if (opts.json) {
            console.log(
              JSON.stringify(
                {
                  schemaVersion: 1,
                  summary: {
                    totalFiles: 0,
                    totalSizeBytes: 0,
                    encodeCount: 0,
                    skipCount: 0,
                    marginalCount: 0,
                    riskyCount: 0,
                    copyCount: 0,
                    unsupportedCount: 0,
                    candidateSizeBytes: 0,
                    estimatedSavings: {
                      minBytes: 0,
                      likelyBytes: 0,
                      maxBytes: 0,
                      minPercent: 0,
                      likelyPercent: 0,
                      maxPercent: 0,
                    },
                  },
                  files: [],
                },
                null,
                2,
              ),
            );
          } else {
            console.log(`No video files found in: ${dir}`);
          }
          return;
        }

        const store = openJournalStore();
        let probeItems;
        try {
          probeItems = await probeBatch(scanResult.files, ffprobeRunner, {
            journalStore: store,
            concurrency: 4,
            ffprobeBinary: opts.ffprobePath,
            ffmpegBinary: opts.ffmpegPath,
            deepCheck: opts.deep ?? false,
            timeoutMs: 30_000,
          });

          const results = [];
          const summaryItems = [];

          for (const item of probeItems) {
            const scannedFile = item.scannedFile;
            const mediaInfo = item.mediaInfo;
            const probeError = item.error;

            const classification = classify({
              filePath: scannedFile.path,
              parentDirName: basename(scannedFile.parentDir),
              parsedEpisode: scannedFile.episode,
              ...(mediaInfo != null ? { mediaInfo } : {}),
            });

            let recommendation: RecommendationResult | null = null;
            let estimate: SizeEstimate | null = null;
            let plan = null;

            if (mediaInfo) {
              recommendation = recommend(mediaInfo, classification);
              estimate = estimateSize(mediaInfo, recommendation, undefined, undefined, store);
              plan = buildPlan(mediaInfo, classification, caps);
              summaryItems.push({ mediaInfo, recommendation, estimate });
            }

            results.push({
              file: scannedFile.path,
              mediaInfo,
              classification,
              recommendation,
              estimate,
              plan,
              probeError,
            });
          }

        const summary = computeFolderSummary(summaryItems);

        if (opts.json) {
          console.log(
            JSON.stringify(
              {
                schemaVersion: 1,
                summary,
                files: results,
              },
              null,
              2,
            ),
          );
          return;
        }

        // Terminal Output
        console.log(`\nScan & Analysis: ${dir}`);
        console.log(
          `Found ${String(summary.totalFiles)} file(s)  •  Total ${formatBytes(summary.totalSizeBytes)}`,
        );
        console.log(
          `Recommendations: ${String(summary.encodeCount)} encode, ${String(summary.skipCount)} skip, ${String(summary.marginalCount)} marginal, ${String(summary.riskyCount)} risky`,
        );

        if (summary.encodeCount > 0) {
          const estMin = formatBytes(summary.estimatedSavings.minBytes);
          const estMax = formatBytes(summary.estimatedSavings.maxBytes);
          console.log(
            `Estimated savings: ${estMin} – ${estMax} (${String(summary.estimatedSavings.minPercent)}% – ${String(summary.estimatedSavings.maxPercent)}% of candidate size)`,
          );
          console.log("Note: Actual savings are measured only after encode.");
        }

        for (const r of results) {
          console.log(`\n── ${r.file}`);
          if (r.probeError) {
            console.log(`   ERROR: ${r.probeError}`);
            continue;
          }

          if (r.mediaInfo && r.recommendation && r.estimate) {
            const v = r.mediaInfo.video;
            const rec = r.recommendation;
            const est = r.estimate;

            console.log(
              `   ${v.codec.toUpperCase()} ${String(v.width)}x${String(v.height)} @ ${v.fps.toFixed(2)} fps (${String(v.bitDepth)}-bit ${v.pixFmt})${v.isHdr ? " [HDR]" : ""}${v.isDolbyVision ? " [Dolby Vision]" : ""}`,
            );
            console.log(
              `   Status: [${rec.label}]  (bpp: ${v.bpp.toFixed(3)}, bitrate: ${String(v.bitrateKbps)} kbps${v.isBitrateDerived ? " derived" : ""})`,
            );

            if (rec.action === "encode") {
              const estOut = `${formatBytes(est.minBytes)} – ${formatBytes(est.maxBytes)}`;
              console.log(
                `   Est. output: ${estOut}  (est. save ${String(est.minSavingsPercent)}% – ${String(est.maxSavingsPercent)}%)`,
              );
            }

            for (const reason of rec.reasons) {
              console.log(`   • ${reason}`);
            }
            for (const warning of rec.warnings) {
              console.log(`   ⚠ ${warning}`);
            }

            if (opts.detail) {
              console.log(`   Container: ${r.mediaInfo.container}`);
              if (r.mediaInfo.audio.length > 0) {
                console.log("   Audio tracks:");
                for (const a of r.mediaInfo.audio) {
                  const lang = a.language ? `[${a.language}] ` : "";
                  const title = a.title ? `"${a.title}" ` : "";
                  const layout = a.channelLayout ?? `${String(a.channels)}ch`;
                  const br = a.bitrateKbps ? ` @ ${String(a.bitrateKbps)} kbps` : "";
                  console.log(
                    `     #${String(a.index)}: ${lang}${a.codec.toUpperCase()} ${layout}${br} ${title}`,
                  );
                }
              }
              if (r.mediaInfo.subtitles.length > 0) {
                console.log("   Subtitles:");
                for (const s of r.mediaInfo.subtitles) {
                  const lang = s.language ? `[${s.language}] ` : "";
                  const title = s.title ? `"${s.title}" ` : "";
                  console.log(
                    `     #${String(s.index)}: ${lang}${s.codec} (${s.formatType}) ${title}`,
                  );
                }
              }
              if (r.mediaInfo.chapterCount > 0) {
                console.log(`   Chapters: ${String(r.mediaInfo.chapterCount)}`);
              }
            }
          }
        }
      } finally {
        store.close();
      }
    },
  );
}
