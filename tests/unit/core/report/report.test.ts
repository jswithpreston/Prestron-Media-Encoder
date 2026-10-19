import { describe, it, expect } from "vitest";
import {
  buildReport,
  buildReportForRoot,
  formatReportText,
  formatReportJson,
  formatReportCsv,
} from "../../../../src/core/report/index.js";
import type { JournalStore, Job, Batch } from "../../../../src/core/jobs/journalStore.js";

function makeStubStore(batch: Batch, jobs: Job[]): JournalStore {
  return {
    createBatch: () => batch,
    getBatch: (id) => (id === batch.id ? batch : undefined),
    getActiveBatch: () => undefined,
    updateBatch: () => {
      /* no-op */
    },
    createJob: () => {
      const j = jobs[0];
      if (!j) throw new Error();
      return j;
    },
    getJob: (id) => jobs.find((j) => j.id === id),
    getJobsForBatch: () => jobs,
    getJobsForRoot: () => jobs,
    findJobBySourcePath: () => undefined,
    resetJobToPending: () => {
      /* no-op */
    },
    transitionJobState: () => {
      /* no-op */
    },
    pragma: () => null,
    close: () => {
      /* no-op */
    },
  } as unknown as JournalStore;
}

const BATCH: Batch = {
  id: "batch-1",
  rootPath: "/media/Season 1",
  createdAt: 1_700_000_000_000,
  finishedAt: 1_700_000_060_000,
  status: "done",
  optionsJson: "{}",
};

const JOBS: Job[] = [
  {
    id: "job-1",
    batchId: "batch-1",
    sourcePath: "/media/Season 1/Show.S01E01.mkv",
    sourceSize: 4_294_967_296, // 4 GB
    sourceMtimeMs: 1_699_000_000_000,
    outputPath: "/media/Season 1/Prestron-Encoded/Show.S01E01.mkv",
    state: "done",
    planJson: "{}",
    attempts: 1,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_060_000,
    outputSize: 1_073_741_824, // 1 GB
  },
  {
    id: "job-2",
    batchId: "batch-1",
    sourcePath: "/media/Season 1/Show.S01E02.mkv",
    sourceSize: 3_000_000_000,
    sourceMtimeMs: 1_699_000_000_000,
    outputPath: "/media/Season 1/Prestron-Encoded/Show.S01E02.mkv",
    state: "failed",
    planJson: "{}",
    attempts: 1,
    error: "Verify failed: duration_mismatch",
    startedAt: 1_700_000_060_000,
    finishedAt: 1_700_000_090_000,
  },
];

describe("buildReport", () => {
  it("returns a report with correct job count", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    expect(report.jobs).toHaveLength(2);
    expect(report.batchId).toBe("batch-1");
    expect(report.status).toBe("done");
  });

  it("correctly maps done job with sizes and state", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const job = report.jobs.find((j) => j.state === "done");
    expect(job).toBeDefined();
    expect(job?.sourceSize).toBe(4_294_967_296);
    expect(job?.outputSize).toBe(1_073_741_824);
  });

  it("maps failed job with error", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const job = report.jobs.find((j) => j.state === "failed");
    expect(job?.error).toBe("Verify failed: duration_mismatch");
  });

  it("throws when batch is not found", () => {
    const store = makeStubStore(BATCH, JOBS);
    expect(() => buildReport(store, "non-existent")).toThrow("Batch not found");
  });
});

describe("buildReportForRoot", () => {
  it("finds the latest batch for root", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReportForRoot(store, "/media/Season 1");
    expect(report).not.toBeNull();
    expect(report?.batchId).toBe("batch-1");
  });

  it("returns null if no jobs found for root", () => {
    const emptyStore = {
      getJobsForRoot: () => [],
    } as unknown as JournalStore;
    const report = buildReportForRoot(emptyStore, "/empty");
    expect(report).toBeNull();
  });
});

describe("formatReportText", () => {
  it("includes header and folder", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const text = formatReportText(report);
    expect(text).toContain("Prestron Media Encoder");
    expect(text).toContain("/media/Season 1");
  });

  it("includes file names", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const text = formatReportText(report);
    expect(text).toContain("Show.S01E01.mkv");
  });

  it("includes failure reason", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const text = formatReportText(report);
    expect(text).toContain("duration_mismatch");
  });
});

describe("formatReportJson", () => {
  it("is valid JSON", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const json = formatReportJson(report);
    expect(() => JSON.parse(json)).not.toThrow();
    const parsed = JSON.parse(json) as typeof report;
    expect(parsed.batchId).toBe("batch-1");
  });
});

describe("formatReportCsv", () => {
  it("has headers", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const csv = formatReportCsv(report);
    expect(csv).toContain("sourcePath");
    expect(csv).toContain("outputSizeBytes");
    expect(csv).toContain("savedPercent");
  });

  it("has data rows", () => {
    const store = makeStubStore(BATCH, JOBS);
    const report = buildReport(store, "batch-1");
    const csv = formatReportCsv(report);
    const lines = csv.split("\n").filter(Boolean);
    expect(lines.length).toBe(3); // header + 2 jobs
  });
});
