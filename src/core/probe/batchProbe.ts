/**
 * Bounded-concurrency batch probe runner with journal caching.
 *
 * Speeds up folder scanning on ~100 files by running up to N concurrent
 * ffprobe processes (default: 4), while checking and populating the
 * SQLite probe cache so subsequent runs on unchanged files are instantaneous.
 */

import { probeFile, type MediaInfo, type ProbeOptions } from "./index.js";
import type { ProcessRunner } from "../ffmpeg/capabilities.js";
import type { JournalStore } from "../jobs/journalStore.js";
import type { ScannedFile } from "../scanner/index.js";

export interface BatchProbeItem {
  scannedFile: ScannedFile;
  mediaInfo: MediaInfo | null;
  error: string | null;
  fromCache: boolean;
}

export interface BatchProbeOptions extends ProbeOptions {
  /** Maximum concurrent ffprobe processes. Default: 4. */
  concurrency?: number | undefined;
  /** Optional journal store used for probe caching. */
  journalStore?: JournalStore | undefined;
  /** Optional progress callback called as each file completes probing. */
  onProgress?: ((probed: number, total: number, filePath: string) => void) | undefined;
}

export async function probeBatch(
  files: ScannedFile[],
  runner: ProcessRunner,
  options?: BatchProbeOptions,
): Promise<BatchProbeItem[]> {
  const total = files.length;
  if (total === 0) return [];

  const concurrency = Math.max(1, options?.concurrency ?? 4);
  const store = options?.journalStore;
  const results: BatchProbeItem[] = new Array<BatchProbeItem>(total);
  let completed = 0;
  let nextIndex = 0;

  const onProgress = options?.onProgress;

  async function worker(): Promise<void> {
    for (let idx = nextIndex++; idx < total; idx = nextIndex++) {
      const file = files[idx];
      if (!file) continue;

      // 1. Check probe cache if store provided
      if (store) {
        try {
          const cached = store.getCachedProbe(file.path, file.sizeBytes, file.mtimeMs);
          if (cached) {
            results[idx] = {
              scannedFile: file,
              mediaInfo: cached,
              error: null,
              fromCache: true,
            };
            completed++;
            if (onProgress) {
              onProgress(completed, total, file.path);
            }
            continue;
          }
        } catch {
          // Cache read error — fall through to probe
        }
      }

      // 2. Run real probe
      try {
        const mediaInfo = await probeFile(file.path, runner, options);
        if (store) {
          try {
            store.cacheProbe(mediaInfo, file.mtimeMs);
          } catch {
            // Non-fatal cache write error
          }
        }
        results[idx] = {
          scannedFile: file,
          mediaInfo,
          error: null,
          fromCache: false,
        };
      } catch (err) {
        results[idx] = {
          scannedFile: file,
          mediaInfo: null,
          error: err instanceof Error ? err.message : String(err),
          fromCache: false,
        };
      }

      completed++;
      if (onProgress) {
        onProgress(completed, total, file.path);
      }
    }
  }

  // Spawn bounded workers
  const workerCount = Math.min(concurrency, total);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}
