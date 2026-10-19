/**
 * Report module — pure, UI-free batch report generation.
 *
 * Builds structured reports from the JournalStore and formats them as
 * human-readable text, JSON, or CSV. No I/O is performed here; callers
 * are responsible for writing output to disk or stdout.
 */

import type { JournalStore, Job, JobState } from "../jobs/journalStore.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single job entry in a batch report. */
export interface BatchReportJob {
  /** Absolute path of the source file. */
  sourcePath: string;
  /** Absolute path of the encoded output file, or null if not yet produced. */
  outputPath: string | null;
  /** Source file size in bytes. */
  sourceSize: number;
  /** Output file size in bytes, or null if not produced. */
  outputSize: number | null;
  /** Final job state. */
  state: JobState;
  /** Error message, if the job failed. */
  error?: string;
  /** Encoding duration in milliseconds, if known. */
  durationMs?: number;
}

/** Aggregated report for a single batch run. */
export interface BatchReport {
  /** Unique batch identifier. */
  batchId: string;
  /** Root directory that was encoded. */
  rootPath: string;
  /** Batch creation timestamp (unix ms). */
  createdAt: number;
  /** Batch completion timestamp (unix ms), or null if still active. */
  finishedAt: number | null;
  /** Overall batch status. */
  status: string;
  /** Per-file job results. */
  jobs: BatchReportJob[];
}

// ---------------------------------------------------------------------------
// Size formatting helper
// ---------------------------------------------------------------------------

/**
 * Formats a byte count as a human-readable string.
 * Returns `-` for null/undefined values.
 */
function fmtBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  if (n >= 1_073_741_824) return `${(n / 1_073_741_824).toFixed(2)} GB`;
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} MB`;
  if (n >= 1_024) return `${(n / 1_024).toFixed(1)} KB`;
  return `${String(n)} B`;
}

// ---------------------------------------------------------------------------
// Savings percent helper
// ---------------------------------------------------------------------------

/**
 * Computes the savings percentage as a formatted string, e.g. "-73.8%".
 * Returns `-` when sizes are unavailable or the source size is zero.
 */
function savedPercent(sourceSize: number, outputSize: number | null | undefined): string {
  return sourceSize > 0 && outputSize != null
    ? `${(((sourceSize - outputSize) / sourceSize) * 100).toFixed(1)}%`
    : "-";
}

// ---------------------------------------------------------------------------
// Job mapper
// ---------------------------------------------------------------------------

/**
 * Maps a raw {@link Job} from the store to a {@link BatchReportJob}.
 */
function mapJob(job: Job): BatchReportJob {
  const durationMs =
    job.startedAt != null && job.finishedAt != null ? job.finishedAt - job.startedAt : undefined;

  return {
    sourcePath: job.sourcePath,
    outputPath: job.outputPath,
    sourceSize: job.sourceSize,
    outputSize: job.outputSize ?? null,
    state: job.state,
    ...(job.error !== undefined ? { error: job.error } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a {@link BatchReport} by reading the batch and its jobs from the
 * provided {@link JournalStore}.
 *
 * @param store - The journal store to query.
 * @param batchId - The batch identifier to report on.
 * @returns A fully populated {@link BatchReport}.
 * @throws {Error} If the batch does not exist in the store.
 */
export function buildReport(store: JournalStore, batchId: string): BatchReport {
  const batch = store.getBatch(batchId);
  if (!batch) {
    throw new Error(`Batch not found: ${batchId}`);
  }

  const jobs = store.getJobsForBatch(batchId);

  return {
    batchId: batch.id,
    rootPath: batch.rootPath,
    createdAt: batch.createdAt,
    finishedAt: batch.finishedAt ?? null,
    status: batch.status,
    jobs: jobs.map(mapJob),
  };
}

/**
 * Finds the latest batch for a root directory and builds its report.
 *
 * Queries all jobs for the root path, collects unique batchIds, fetches
 * each batch, and selects the one with the highest `createdAt` timestamp.
 *
 * @param store - The journal store to query.
 * @param rootPath - The absolute root directory path.
 * @returns The {@link BatchReport} for the latest batch, or `null` if none found.
 */
export function buildReportForRoot(store: JournalStore, rootPath: string): BatchReport | null {
  const jobs = store.getJobsForRoot(rootPath);
  if (jobs.length === 0) return null;

  // Collect unique batchIds from the jobs
  const batchIds = [...new Set(jobs.map((j) => j.batchId))];

  // Fetch each batch and find the most recent one
  let latestBatch = store.getBatch(batchIds[0] ?? "");
  for (const id of batchIds.slice(1)) {
    const candidate = store.getBatch(id);
    if (candidate && (!latestBatch || candidate.createdAt > latestBatch.createdAt)) {
      latestBatch = candidate;
    }
  }

  if (!latestBatch) return null;

  return buildReport(store, latestBatch.id);
}

// ---------------------------------------------------------------------------
// Text formatter
// ---------------------------------------------------------------------------

/**
 * Formats a {@link BatchReport} as a human-readable text report.
 *
 * Includes a header, per-file table with savings, totals row, failure
 * details, and the output location.
 *
 * @param report - The report to format.
 * @returns A multi-line string suitable for printing to stdout.
 */
export function formatReportText(report: BatchReport): string {
  const WIDE = 55;
  const HR_THICK = "═".repeat(WIDE);
  const HR_THIN = "─".repeat(WIDE);

  // Date helpers
  const fmtDate = (ms: number | null): string => {
    if (ms == null) return "-";
    const d = new Date(ms);
    const pad = (n: number): string => String(n).padStart(2, "0");
    return (
      `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
  };

  // Tally states
  const done = report.jobs.filter((j) => j.state === "done").length;
  const failed = report.jobs.filter((j) => j.state === "failed").length;
  const skipped = report.jobs.filter((j) => j.state === "skipped").length;

  // Totals
  const totalSrc = report.jobs.reduce((a, j) => a + j.sourceSize, 0);
  const totalOut = report.jobs.reduce<number | null>((a, j) => {
    if (a === null || j.outputSize == null) return null;
    return a + j.outputSize;
  }, 0);

  // Output path (directory of first done job's output)
  const firstDone = report.jobs.find((j) => j.state === "done" && j.outputPath != null);
  const outputDir = firstDone?.outputPath ? firstDone.outputPath.replace(/\/[^/]+$/, "") : "-";

  const lines: string[] = [];

  lines.push(HR_THICK);
  lines.push(" Prestron Media Encoder — Batch Report");
  lines.push(HR_THICK);
  lines.push(` Folder: ${report.rootPath}`);
  lines.push(
    ` Status: ${report.status}  │  Done: ${String(done)}  Failed: ${String(failed)}  Skipped: ${String(skipped)}`,
  );
  lines.push(` Started: ${fmtDate(report.createdAt)}  Finished: ${fmtDate(report.finishedAt)}`);
  lines.push(HR_THIN);

  // Table header
  const COL_FILE = 27;
  const COL_SRC = 9;
  const COL_OUT = 9;
  const COL_SAV = 8;
  lines.push(
    ` ${"FILE".padEnd(COL_FILE)} ${"SRC SIZE".padEnd(COL_SRC)} ${"OUT SIZE".padEnd(COL_OUT)} ${"SAVINGS".padEnd(COL_SAV)} STATE`,
  );

  // Table rows
  for (const job of report.jobs) {
    const name = job.sourcePath.split("/").pop() ?? job.sourcePath;
    const trimmed = name.length > COL_FILE ? name.slice(0, COL_FILE - 1) + "…" : name;
    const sav = savedPercent(job.sourceSize, job.outputSize);
    lines.push(
      ` ${trimmed.padEnd(COL_FILE)} ${fmtBytes(job.sourceSize).padEnd(COL_SRC)} ${fmtBytes(job.outputSize).padEnd(COL_OUT)} ${sav.padEnd(COL_SAV)} ${job.state}`,
    );
  }

  lines.push(HR_THIN);

  // Totals row
  const totalSav = savedPercent(totalSrc, totalOut);
  lines.push(
    ` ${"TOTAL".padEnd(COL_FILE)} ${fmtBytes(totalSrc).padEnd(COL_SRC)} ${fmtBytes(totalOut).padEnd(COL_OUT)} ${totalSav}`,
  );

  // Failures section
  const failures = report.jobs.filter((j) => j.state === "failed");
  if (failures.length > 0) {
    lines.push(HR_THIN);
    lines.push(" Failures:");
    for (const job of failures) {
      const name = job.sourcePath.split("/").pop() ?? job.sourcePath;
      lines.push(`   ✗ ${name}: ${job.error ?? "unknown error"}`);
    }
  }

  lines.push(HR_THICK);
  lines.push(` Output: ${outputDir}`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// JSON formatter
// ---------------------------------------------------------------------------

/**
 * Formats a {@link BatchReport} as pretty-printed JSON.
 *
 * @param report - The report to serialize.
 * @returns A JSON string with 2-space indentation.
 */
export function formatReportJson(report: BatchReport): string {
  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// CSV formatter
// ---------------------------------------------------------------------------

/**
 * Formats a {@link BatchReport} as a CSV string.
 *
 * Headers: `sourcePath,outputPath,sourceSizeBytes,outputSizeBytes,savedBytes,savedPercent,state,error`
 *
 * @param report - The report to format.
 * @returns A CSV string including a header row and one row per job.
 */
export function formatReportCsv(report: BatchReport): string {
  const escape = (v: string | number | null | undefined): string => {
    if (v == null) return "";
    const s = String(v);
    // Wrap in quotes if the value contains commas, quotes, or newlines
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const header =
    "sourcePath,outputPath,sourceSizeBytes,outputSizeBytes,savedBytes,savedPercent,state,error";

  const rows = report.jobs.map((job) => {
    const savedBytes = job.outputSize != null ? job.sourceSize - job.outputSize : null;
    const pct =
      job.sourceSize > 0 && job.outputSize != null
        ? (((job.sourceSize - job.outputSize) / job.sourceSize) * 100).toFixed(1)
        : "";

    return [
      escape(job.sourcePath),
      escape(job.outputPath),
      escape(job.sourceSize),
      escape(job.outputSize),
      escape(savedBytes),
      escape(pct),
      escape(job.state),
      escape(job.error),
    ].join(",");
  });

  return [header, ...rows].join("\n");
}
