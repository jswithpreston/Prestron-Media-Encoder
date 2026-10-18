/**
 * Recovery module — runs on startup before encoding begins.
 *
 * Checks journal state and filesystem consistency:
 * 1. Jobs left in 'encoding' or 'verifying' (crashed / killed via kill -9) have their
 *    stale .part files unlinked and are re-queued to 'pending' with attempts++.
 * 2. Jobs left in 'interrupted' (SIGINT/SIGTERM) have any lingering .part unlinked
 *    and are re-queued to 'pending'.
 * 3. Jobs marked 'done' whose output file on disk was deleted (e.g. Prestron-Encoded
 *    was removed by the user) are safely re-queued to 'pending' without corrupting the journal.
 * 4. Stale/orphaned .part files in Prestron-Encoded directories are removed.
 */

import { stat, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { JournalStore } from "./journalStore.js";

export interface RecoveryReport {
  stalePartFilesRemoved: string[];
  jobsRequeued: string[];
  missingOutputsRequeued: string[];
}

export async function recoverFolder(
  store: JournalStore,
  rootPath: string,
): Promise<RecoveryReport> {
  const report: RecoveryReport = {
    stalePartFilesRemoved: [],
    jobsRequeued: [],
    missingOutputsRequeued: [],
  };

  const jobs = store.getJobsForRoot(rootPath);

  for (const job of jobs) {
    const partPath = `${job.outputPath}.part`;

    // 1. Crash recovery: job was actively encoding or verifying when killed (e.g. kill -9)
    if (job.state === "encoding" || job.state === "verifying") {
      try {
        await unlink(partPath);
        report.stalePartFilesRemoved.push(partPath);
      } catch {
        // .part file may not exist yet if killed very early
      }
      store.resetJobToPending(job.id);
      report.jobsRequeued.push(job.sourcePath);
      continue;
    }

    // 2. Interrupted recovery: job was stopped cleanly by SIGINT / SIGTERM
    if (job.state === "interrupted") {
      try {
        await unlink(partPath);
        report.stalePartFilesRemoved.push(partPath);
      } catch {
        /* ignore */
      }
      store.resetJobToPending(job.id);
      report.jobsRequeued.push(job.sourcePath);
      continue;
    }

    // 3. Deleted output recovery: job was 'done', but output was deleted (e.g. rm -rf Prestron-Encoded)
    if (job.state === "done") {
      let outputValid = false;
      try {
        const outStat = await stat(job.outputPath);
        if (outStat.size > 0) {
          outputValid = true;
        }
      } catch {
        outputValid = false;
      }

      if (!outputValid) {
        store.resetJobToPending(job.id);
        report.missingOutputsRequeued.push(job.sourcePath);
      }
      continue;
    }

    // 4. Failed job recovery: reset to pending so retry run can re-encode
    if (job.state === "failed") {
      try {
        await unlink(partPath);
        report.stalePartFilesRemoved.push(partPath);
      } catch {
        /* ignore */
      }
      store.resetJobToPending(job.id);
      report.jobsRequeued.push(job.sourcePath);
      continue;
    }
  }

  // 4. Clean up any remaining orphaned .part files in known output folders
  await cleanOrphanedParts(rootPath, report);

  return report;
}

/**
 * Scan for any .part files in Prestron-Encoded directories under rootPath
 * that may not correspond to recorded jobs.
 */
async function cleanOrphanedParts(dir: string, report: RecoveryReport): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Prestron-Encoded") {
          try {
            const encodedEntries = await readdir(fullPath);
            for (const f of encodedEntries) {
              if (f.endsWith(".part")) {
                const partFile = join(fullPath, f);
                try {
                  await unlink(partFile);
                  if (!report.stalePartFilesRemoved.includes(partFile)) {
                    report.stalePartFilesRemoved.push(partFile);
                  }
                } catch {
                  /* ignore */
                }
              }
            }
          } catch {
            /* ignore */
          }
        } else {
          await cleanOrphanedParts(fullPath, report);
        }
      }
    }
  } catch {
    /* ignore unreadable dirs */
  }
}
