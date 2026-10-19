/**
 * Recovery module — runs on startup before encoding begins.
 *
 * Checks journal state and filesystem consistency:
 * 1. Jobs left in 'encoding' or 'verifying' (crashed / killed via kill -9) have their
 *    stale .part files unlinked and are re-queued to 'pending' with attempts++.
 *    Any tracked ffmpeg child PID is terminated (SIGTERM → SIGKILL) to clean up
 *    orphaned processes left behind by a kill -9 of the tool.
 * 2. Jobs left in 'interrupted' (SIGINT/SIGTERM) have any lingering .part unlinked
 *    and are re-queued to 'pending'.
 * 3. Jobs marked 'done' whose output file on disk was deleted (e.g. Prestron-Encoded
 *    was removed by the user) are safely re-queued to 'pending' without corrupting the journal.
 * 4. Stale/orphaned .part files in Prestron-Encoded directories are removed.
 */

import { stat, unlink, readdir } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import type { JournalStore } from "./journalStore.js";

export interface RecoveryReport {
  stalePartFilesRemoved: string[];
  jobsRequeued: string[];
  missingOutputsRequeued: string[];
  orphanedFfmpegPidsTerminated: number[];
}

/**
 * Send SIGTERM to a PID, wait briefly, then SIGKILL if still alive.
 * Returns true if the process was (or is believed to be) terminated.
 */
async function terminatePid(pid: number): Promise<boolean> {
  try {
    // Check if process exists (signal 0 = existence check, no signal sent)
    try {
      process.kill(pid, 0);
    } catch {
      // Process already gone
      return true;
    }

    // Send SIGTERM
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* process may have vanished between check and kill */
    }

    // Wait up to 5 seconds for it to exit
    for (let i = 0; i < 50; i++) {
      await new Promise((res) => setTimeout(res, 100));
      try {
        process.kill(pid, 0);
        // still alive
      } catch {
        return true; // gone
      }
    }

    // Force kill
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort scan for ffmpeg processes that are not tracked in the journal
 * (e.g. the tool crashed before recording the PID). Uses `pgrep ffmpeg` on
 * Linux; returns an empty list if pgrep is unavailable.
 */
async function scanOrphanedFfmpegPids(): Promise<number[]> {
  try {
    const result = await execa("pgrep", ["ffmpeg"], { reject: false });
    if (result.exitCode !== 0 || !result.stdout) {
      return [];
    }
    return result.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

export async function recoverFolder(
  store: JournalStore,
  rootPath: string,
): Promise<RecoveryReport> {
  const report: RecoveryReport = {
    stalePartFilesRemoved: [],
    jobsRequeued: [],
    missingOutputsRequeued: [],
    orphanedFfmpegPidsTerminated: [],
  };

  const jobs = store.getJobsForRoot(rootPath);

  const knownPids = new Set<number>();
  for (const job of jobs) {
    if (job.ffmpegPid) {
      knownPids.add(job.ffmpegPid);
    }
  }

  for (const job of jobs) {
    const partPath = `${job.outputPath}.part`;

    // Terminate any tracked ffmpeg PID still running for a job that was
    // mid-encode when the tool was killed (kill -9 leaves the child orphaned).
    if (
      (job.state === "encoding" || job.state === "verifying") &&
      job.ffmpegPid
    ) {
      const terminated = await terminatePid(job.ffmpegPid);
      if (terminated) {
        report.orphanedFfmpegPidsTerminated.push(job.ffmpegPid);
      }
    }

    // 1. Crash recovery: job was actively encoding or verifying when killed
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

    // 3. Deleted output recovery: job was 'done', but output was deleted
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

  // 5. Best-effort: kill ffmpeg processes not tracked by any job (true orphans)
  const orphanPids = await scanOrphanedFfmpegPids();
  for (const pid of orphanPids) {
    if (knownPids.has(pid)) continue; // already handled above
    const terminated = await terminatePid(pid);
    if (terminated) {
      report.orphanedFfmpegPidsTerminated.push(pid);
    }
  }

  // 6. Clean up any remaining orphaned .part files in known output folders
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
