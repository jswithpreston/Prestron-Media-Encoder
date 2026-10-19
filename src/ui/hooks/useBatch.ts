/**
 * useBatch — orchestrates scan → probe → plan → encode → verify → promote.
 *
 * This hook bridges the core library and the Ink UI. It drives the entire
 * encode pipeline and surfaces state for the UI to render.
 *
 * Design principles:
 * - No business logic here — delegates entirely to src/core.
 * - All state updates use React state so Ink re-renders automatically.
 * - AbortController per encode so individual files can be cancelled.
 * - The hook itself is the single source of truth for what's happening;
 *   screens just read from it and call action callbacks.
 */

import { useState, useCallback, useRef } from "react";
import { basename, dirname } from "node:path";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import { execa } from "execa";
import { scanDirectory } from "../../core/scanner/index.js";
import { probeFile, type MediaInfo } from "../../core/probe/index.js";
import { classify } from "../../core/classifier/index.js";
import { buildPlan, type EncodePlan } from "../../core/policy/planBuilder.js";
import { buildArgs } from "../../core/ffmpeg/argBuilder.js";
import { runEncode } from "../../core/ffmpeg/runner.js";
import { verifyOutput } from "../../core/verify/index.js";
import { checkDiskSpace } from "../../core/ffmpeg/diskSpace.js";
import { openJournalStore } from "../../core/jobs/journalDb.js";
import { recoverFolder } from "../../core/jobs/recovery.js";
import type { ProcessRunner } from "../../core/ffmpeg/capabilities.js";
import type { ProfileName } from "../../core/policy/profiles.js";
import type { EncodeProgress } from "../../core/ffmpeg/progressParser.js";
import type { FfmpegCapabilities } from "../../core/ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BatchPhase = "idle" | "scanning" | "probing" | "ready" | "encoding" | "done" | "error";

export type FilePhase = "pending" | "encoding" | "verifying" | "done" | "failed" | "skipped";

export interface BatchFile {
  path: string;
  sourceSizeBytes: number;
  sourceMtimeMs: number;
  mediaInfo: MediaInfo | null;
  plan: EncodePlan | null;
  phase: FilePhase;
  progress: EncodeProgress | null;
  outputSizeBytes: number | null;
  error: string | null;
}

export interface BatchState {
  phase: BatchPhase;
  /** Root directory being encoded. */
  rootDir: string;
  files: BatchFile[];
  /** Index into files[] of the file currently being encoded (-1 if none). */
  activeFileIndex: number;
  error: string | null;
  /** Whether a recoverable previous batch was detected. */
  hasUnfinishedBatch: boolean;
  /** Recovery log messages from startup. */
  recoveryMessages: string[];
}

export interface BatchOptions {
  profile?: ProfileName;
  crfOverride?: number;
  presetOverride?: string;
  force?: boolean;
  overwrite?: boolean;
  brandingEnabled?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
  mouseEnabled?: boolean;
}

export interface UseBatchReturn {
  state: BatchState;
  /** Scan rootDir and probe all files. */
  startScan: (rootDir: string) => Promise<void>;
  /** Apply a profile to all planned files (or rebuild plans if already done). */
  applyProfile: (profile: ProfileName, caps: FfmpegCapabilities) => void;
  /** Start encoding the files at the given indices. */
  startEncoding: (selectedIndices: number[], caps: FfmpegCapabilities) => Promise<void>;
  /** Abort the current encode. */
  abort: () => void;
  /** Reset to idle state. */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Runner (injected so tests can fake it)
// ---------------------------------------------------------------------------

function makeExecaRunner(_ffprobeBinary = "ffprobe"): ProcessRunner {
  return {
    async run(binary, args) {
      const result = await execa(binary, args, { reject: false });
      if (result.exitCode === undefined) {
        throw Object.assign(new Error(`${binary}: not found`), { code: "ENOENT" });
      }
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    },
  };
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_STATE: BatchState = {
  phase: "idle",
  rootDir: "",
  files: [],
  activeFileIndex: -1,
  error: null,
  hasUnfinishedBatch: false,
  recoveryMessages: [],
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useBatch(options: BatchOptions = {}): UseBatchReturn {
  const [state, setState] = useState<BatchState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef<BatchOptions>(options);
  optionsRef.current = options;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  // -------------------------------------------------------------------------
  // startScan
  // -------------------------------------------------------------------------

  const startScan = useCallback(async (rootDir: string) => {
    setState((s) => ({
      ...s,
      phase: "scanning",
      rootDir,
      files: [],
      error: null,
    }));

    try {
      // Recovery check
      const store = openJournalStore();
      const recovery = await recoverFolder(store, rootDir);
      const hasUnfinishedBatch = store.getActiveBatch(rootDir) !== undefined;
      const recoveryMessages: string[] = [];
      for (const p of recovery.stalePartFilesRemoved) {
        recoveryMessages.push(`Removed stale .part: ${basename(p)}`);
      }
      for (const p of recovery.jobsRequeued) {
        recoveryMessages.push(`Re-queued: ${basename(p)}`);
      }
      store.close();

      setState((s) => ({
        ...s,
        phase: "probing",
        hasUnfinishedBatch,
        recoveryMessages,
      }));

      // Scan
      const scanResult = await scanDirectory(rootDir);

      // Probe each file
      const runner = makeExecaRunner(optionsRef.current.ffprobePath ?? "ffprobe");
      const batchFiles: BatchFile[] = [];

      for (const scannedFile of scanResult.files) {
        let mediaInfo: MediaInfo;
        try {
          mediaInfo = await probeFile(scannedFile.path, runner, {
            ffprobeBinary: optionsRef.current.ffprobePath ?? "ffprobe",
            timeoutMs: 30_000,
          });
        } catch (err) {
          // Non-fatal: add a failed stub
          batchFiles.push({
            path: scannedFile.path,
            sourceSizeBytes: scannedFile.sizeBytes,
            sourceMtimeMs: scannedFile.mtimeMs,
            mediaInfo: null,
            plan: null,
            phase: "failed",
            progress: null,
            outputSizeBytes: null,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        batchFiles.push({
          path: scannedFile.path,
          sourceSizeBytes: scannedFile.sizeBytes,
          sourceMtimeMs: scannedFile.mtimeMs,
          mediaInfo,
          plan: null,
          phase: "pending",
          progress: null,
          outputSizeBytes: null,
          error: null,
        });
      }

      setState((s) => ({
        ...s,
        phase: "ready",
        files: batchFiles,
      }));
    } catch (err) {
      setState((s) => ({
        ...s,
        phase: "error",
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  // -------------------------------------------------------------------------
  // applyProfile
  // -------------------------------------------------------------------------

  const applyProfile = useCallback((profile: ProfileName, caps: FfmpegCapabilities) => {
    setState((s) => {
      const updatedFiles = s.files.map((f) => {
        if (!f.mediaInfo) return f;
        const classification = classify({
          filePath: f.path,
          parentDirName: dirname(f.path).split("/").pop() ?? "",
          parsedEpisode: null,
          mediaInfo: f.mediaInfo,
        });
        const plan = buildPlan(f.mediaInfo, classification, caps, {
          profileOverride: profile,
          crfOverride: optionsRef.current.crfOverride,
          presetOverride: optionsRef.current.presetOverride,
          force: optionsRef.current.force,
          brandingEnabled: optionsRef.current.brandingEnabled,
        });
        return { ...f, plan };
      });
      return { ...s, files: updatedFiles };
    });
  }, []);

  // -------------------------------------------------------------------------
  // startEncoding
  // -------------------------------------------------------------------------

  const startEncoding = useCallback(
    async (selectedIndices: number[], caps: FfmpegCapabilities) => {
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setState((s) => ({ ...s, phase: "encoding" }));

      const store = openJournalStore();
      const batch =
        store.getActiveBatch(state.rootDir) ??
        store.createBatch({
          rootPath: state.rootDir,
          createdAt: Date.now(),
          status: "active",
          optionsJson: JSON.stringify(options),
        });

      const runner = makeExecaRunner(optionsRef.current.ffprobePath ?? "ffprobe");
      const ffmpegPath = optionsRef.current.ffmpegPath ?? "ffmpeg";

      for (const idx of selectedIndices) {
        if (signal.aborted) break;

        const fileState = state.files[idx];
        if (!fileState?.plan) continue;
        const { plan, mediaInfo } = fileState;
        if (!mediaInfo) continue;

        // Mark encoding
        setState((s) => {
          const files = [...s.files];
          const f = files[idx];
          if (f) files[idx] = { ...f, phase: "encoding" };
          return { ...s, files, activeFileIndex: idx };
        });

        // Disk space check
        const diskCheck = await checkDiskSpace(plan.estimatedOutputDir, fileState.sourceSizeBytes);
        if (!diskCheck.available) {
          setState((s) => {
            const files = [...s.files];
            const f = files[idx];
            if (f) files[idx] = { ...f, phase: "failed", error: diskCheck.message };
            return { ...s, files };
          });
          continue;
        }

        // Create output dir
        await mkdir(plan.estimatedOutputDir, { recursive: true });

        // Register/find job
        let job =
          store.findJobBySourcePath(plan.sourceFile) ??
          store.createJob({
            batchId: batch.id,
            sourcePath: plan.sourceFile,
            sourceSize: fileState.sourceSizeBytes,
            sourceMtimeMs: fileState.sourceMtimeMs,
            outputPath: plan.outputFile,
            state: "pending",
            planJson: JSON.stringify(plan),
            attempts: 0,
          });

        // Skip existing outputs unless --overwrite
        if (!optionsRef.current.overwrite) {
          try {
            const existing = await stat(plan.outputFile);
            if (existing.size > 0) {
              setState((s) => {
                const files = [...s.files];
                const f = files[idx];
                if (f) files[idx] = { ...f, phase: "skipped", outputSizeBytes: existing.size };
                return { ...s, files };
              });
              if (job.state !== "done") {
                store.transitionJobState(job.id, job.state, "done", {
                  outputSize: existing.size,
                  finishedAt: Date.now(),
                });
              }
              continue;
            }
          } catch {
            // Doesn't exist, proceed
          }
        }

        if (job.state !== "pending") {
          store.resetJobToPending(job.id);
          job = store.getJob(job.id) ?? job;
        }

        store.transitionJobState(job.id, "pending", "encoding", { startedAt: Date.now() });

        // Encode
        const args = buildArgs(plan, caps);
        let encodeResult;
        try {
          encodeResult = await runEncode(args, {
            ffmpegBinary: ffmpegPath,
            sourceDurationSecs: mediaInfo.durationSecs,
            signal,
            onChildStart: (pid) => {
              try {
                store.transitionJobState(job.id, "encoding", "encoding", {
                  ffmpegPid: pid,
                });
              } catch {
                /* ignore if state already changed */
              }
            },
            onProgress: (p) => {
              setState((s) => {
                const files = [...s.files];
                const f = files[idx];
                if (f) files[idx] = { ...f, progress: p };
                return { ...s, files };
              });
            },
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          setState((s) => {
            const files = [...s.files];
            const f = files[idx];
            if (f) files[idx] = { ...f, phase: "failed", error: msg };
            return { ...s, files };
          });
          store.transitionJobState(job.id, "encoding", "failed", {
            error: msg,
            finishedAt: Date.now(),
          });
          continue;
        }

        if (!encodeResult.ok) {
          const msg = encodeResult.error ?? "Encode failed";
          setState((s) => {
            const files = [...s.files];
            const f = files[idx];
            if (f) files[idx] = { ...f, phase: "failed", error: msg };
            return { ...s, files };
          });
          try {
            await unlink(plan.partFile);
          } catch {
            /* ignore */
          }
          store.transitionJobState(job.id, "encoding", "failed", {
            error: msg,
            finishedAt: Date.now(),
          });
          continue;
        }

        // Verify
        setState((s) => {
          const files = [...s.files];
          const f = files[idx];
          if (f) files[idx] = { ...f, phase: "verifying" };
          return { ...s, files };
        });
        store.transitionJobState(job.id, "encoding", "verifying");

        const verifyResult = await verifyOutput(
          plan.partFile,
          runner,
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
          optionsRef.current.ffprobePath ?? "ffprobe",
          ffmpegPath,
        );

        if (!verifyResult.ok) {
          const msg = `Verify failed: ${verifyResult.failedCheck ?? "unknown"}`;
          setState((s) => {
            const files = [...s.files];
            const f = files[idx];
            if (f) files[idx] = { ...f, phase: "failed", error: msg };
            return { ...s, files };
          });
          try {
            await unlink(plan.partFile);
          } catch {
            /* ignore */
          }
          store.transitionJobState(job.id, "verifying", "failed", {
            error: msg,
            finishedAt: Date.now(),
          });
          continue;
        }

        // Promote
        await rename(plan.partFile, plan.outputFile);
        const outStat = await stat(plan.outputFile);
        const outputSizeBytes = outStat.size;

        setState((s) => {
          const files = [...s.files];
          const f = files[idx];
          if (f) files[idx] = { ...f, phase: "done", outputSizeBytes };
          return { ...s, files };
        });
        store.transitionJobState(job.id, "verifying", "done", {
          outputSize: outputSizeBytes,
          finishedAt: Date.now(),
        });
      }

      // Update batch
      const finalFiles = state.files;
      const anyFailed = finalFiles.some((f) => f.phase === "failed");
      store.updateBatch(batch.id, {
        status: anyFailed ? "partial" : "done",
        finishedAt: Date.now(),
      });
      store.close();

      setState((s) => ({ ...s, phase: "done", activeFileIndex: -1 }));
    },
    [state.rootDir, state.files, options],
  );

  // -------------------------------------------------------------------------
  // abort
  // -------------------------------------------------------------------------

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { state, startScan, applyProfile, startEncoding, abort, reset };
}
