import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSqliteJournalStore } from "../../../../src/core/jobs/sqliteJournalStore.js";
import { StateTransitionError } from "../../../../src/core/jobs/journalStore.js";
import type { JournalStore } from "../../../../src/core/jobs/journalStore.js";

let store: JournalStore;
let tmpFile: string | null = null;

afterEach(() => {
  try {
    store.close();
  } catch {
    // already closed
  }
  if (tmpFile) {
    try {
      rmSync(tmpFile);
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpFile + "-wal");
    } catch {
      /* ignore */
    }
    try {
      rmSync(tmpFile + "-shm");
    } catch {
      /* ignore */
    }
    tmpFile = null;
  }
});

function makeStore(): JournalStore {
  store = createSqliteJournalStore(":memory:");
  return store;
}

function makeFileStore(): { store: JournalStore; path: string } {
  const dir = mkdtempSync(join(tmpdir(), "prestron-sqlite-test-"));
  const path = join(dir, "test.sqlite");
  const s = createSqliteJournalStore(path);
  store = s;
  tmpFile = path;
  return { store: s, path };
}

function makeBatch(s: JournalStore) {
  return s.createBatch({
    rootPath: "/media/shows",
    createdAt: Date.now(),
    status: "active",
    optionsJson: "{}",
  });
}

function makeJobData(batchId: string) {
  return {
    batchId,
    sourcePath: "/media/shows/ep01.mkv",
    sourceSize: 1_000_000,
    sourceMtimeMs: Date.now(),
    outputPath: "/media/shows/Prestron-Encoded/ep01.mkv",
    state: "pending" as const,
    planJson: "{}",
    attempts: 0,
  };
}

// ---------------------------------------------------------------------------
// Condition 3 — WAL mode and synchronous=FULL
// ---------------------------------------------------------------------------

describe("sqliteJournalStore — WAL mode and synchronous=FULL", () => {
  it("PRAGMA journal_mode returns 'wal' (requires file-based DB)", () => {
    // WAL mode is not available for :memory: databases — SQLite returns 'memory'.
    // We use a real temp file to verify WAL mode is actually applied.
    const { store: s } = makeFileStore();
    expect(s.pragma("journal_mode")).toBe("wal");
  });

  it("PRAGMA synchronous returns 2 (FULL)", () => {
    const s = makeStore();
    // SQLite PRAGMA synchronous: 0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA
    // synchronous=FULL works with :memory: too
    expect(s.pragma("synchronous")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Batch CRUD
// ---------------------------------------------------------------------------

describe("sqliteJournalStore — batch operations", () => {
  it("createBatch returns a batch with a generated id", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    expect(batch.id).toBeTruthy();
    expect(batch.rootPath).toBe("/media/shows");
    expect(batch.status).toBe("active");
  });

  it("getBatch round-trip returns the same data", () => {
    const s = makeStore();
    const created = makeBatch(s);
    const fetched = s.getBatch(created.id);
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.rootPath).toBe(created.rootPath);
    expect(fetched?.optionsJson).toBe("{}");
  });

  it("getBatch returns undefined for unknown id", () => {
    const s = makeStore();
    expect(s.getBatch("nonexistent")).toBeUndefined();
  });

  it("getActiveBatch returns the active batch for a root path", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const found = s.getActiveBatch("/media/shows");
    expect(found?.id).toBe(batch.id);
  });

  it("getActiveBatch returns undefined when no active batch", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    s.updateBatch(batch.id, { status: "done" });
    expect(s.getActiveBatch("/media/shows")).toBeUndefined();
  });

  it("updateBatch changes status and finishedAt", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    s.updateBatch(batch.id, { status: "done", finishedAt: 12345 });
    const updated = s.getBatch(batch.id);
    expect(updated?.status).toBe("done");
    expect(updated?.finishedAt).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// Job CRUD
// ---------------------------------------------------------------------------

describe("sqliteJournalStore — job operations", () => {
  it("createJob returns a job with a generated id", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    expect(job.id).toBeTruthy();
    expect(job.state).toBe("pending");
    expect(job.attempts).toBe(0);
  });

  it("getJob round-trip returns the same data", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const created = s.createJob(makeJobData(batch.id));
    const fetched = s.getJob(created.id);
    expect(fetched?.sourcePath).toBe("/media/shows/ep01.mkv");
    expect(fetched?.sourceSize).toBe(1_000_000);
    expect(fetched?.error).toBeUndefined();
  });

  it("getJob returns undefined for unknown id", () => {
    const s = makeStore();
    expect(s.getJob("nonexistent")).toBeUndefined();
  });

  it("getJobsForBatch returns all jobs for the batch in insertion order", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const j1 = s.createJob({ ...makeJobData(batch.id), sourcePath: "/a.mkv" });
    const j2 = s.createJob({ ...makeJobData(batch.id), sourcePath: "/b.mkv" });
    const jobs = s.getJobsForBatch(batch.id);
    expect(jobs.length).toBe(2);
    expect(jobs[0]?.id).toBe(j1.id);
    expect(jobs[1]?.id).toBe(j2.id);
  });

  it("getJobsForBatch returns empty array when no jobs", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    expect(s.getJobsForBatch(batch.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

describe("sqliteJournalStore — transitionJobState", () => {
  it("transitions pending → encoding successfully", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    s.transitionJobState(job.id, "pending", "encoding", { startedAt: 9000, attempts: 1 });
    const updated = s.getJob(job.id);
    expect(updated?.state).toBe("encoding");
    expect(updated?.startedAt).toBe(9000);
    expect(updated?.attempts).toBe(1);
  });

  it("transitions encoding → done with outputSize", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    s.transitionJobState(job.id, "pending", "encoding");
    s.transitionJobState(job.id, "encoding", "verifying");
    s.transitionJobState(job.id, "verifying", "done", { finishedAt: 99999, outputSize: 500_000 });
    const done = s.getJob(job.id);
    expect(done?.state).toBe("done");
    expect(done?.outputSize).toBe(500_000);
  });

  it("throws StateTransitionError when current state does not match 'from'", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id)); // state = pending
    expect(() => s.transitionJobState(job.id, "encoding", "done")).toThrowError(
      StateTransitionError,
    );
  });

  it("StateTransitionError contains the correct states", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    try {
      s.transitionJobState(job.id, "encoding", "done");
    } catch (err) {
      expect(err).toBeInstanceOf(StateTransitionError);
      const e = err as StateTransitionError;
      expect(e.expectedState).toBe("encoding");
      expect(e.actualState).toBe("pending");
    }
  });

  it("state is unchanged after a failed transition", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    try {
      s.transitionJobState(job.id, "encoding", "done");
    } catch {
      // expected
    }
    expect(s.getJob(job.id)?.state).toBe("pending");
  });

  it("stores error message on failed job", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    s.transitionJobState(job.id, "pending", "encoding");
    s.transitionJobState(job.id, "encoding", "failed", { error: "decode test failed" });
    expect(s.getJob(job.id)?.error).toBe("decode test failed");
  });

  it("getJobsForRoot returns all jobs matching root path across batches", () => {
    const s = makeStore();
    const b1 = s.createBatch({
      rootPath: "/media/shows",
      createdAt: 1000,
      status: "done",
      optionsJson: "{}",
    });
    const b2 = s.createBatch({
      rootPath: "/media/shows",
      createdAt: 2000,
      status: "active",
      optionsJson: "{}",
    });
    const b3 = s.createBatch({
      rootPath: "/media/movies",
      createdAt: 3000,
      status: "active",
      optionsJson: "{}",
    });

    s.createJob({ ...makeJobData(b1.id), sourcePath: "/media/shows/ep1.mkv" });
    s.createJob({ ...makeJobData(b2.id), sourcePath: "/media/shows/ep2.mkv" });
    s.createJob({ ...makeJobData(b3.id), sourcePath: "/media/movies/movie1.mkv" });

    const showJobs = s.getJobsForRoot("/media/shows");
    expect(showJobs.length).toBe(2);
    expect(showJobs.map((j) => j.sourcePath)).toEqual([
      "/media/shows/ep1.mkv",
      "/media/shows/ep2.mkv",
    ]);
  });

  it("findJobBySourcePath returns the latest job for a source path", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    s.createJob({ ...makeJobData(batch.id), sourcePath: "/media/shows/ep1.mkv" });
    const found = s.findJobBySourcePath("/media/shows/ep1.mkv");
    expect(found).toBeDefined();
    expect(found?.sourcePath).toBe("/media/shows/ep1.mkv");

    expect(s.findJobBySourcePath("/nonexistent.mkv")).toBeUndefined();
  });

  it("resetJobToPending resets state, increments attempts, and clears error/output", () => {
    const s = makeStore();
    const batch = makeBatch(s);
    const job = s.createJob(makeJobData(batch.id));
    s.transitionJobState(job.id, "pending", "encoding");
    s.transitionJobState(job.id, "encoding", "failed", {
      error: "crashed",
      finishedAt: 5000,
      outputSize: 1234,
    });

    s.resetJobToPending(job.id);
    const reset = s.getJob(job.id);
    expect(reset?.state).toBe("pending");
    expect(reset?.attempts).toBe(1);
    expect(reset?.error).toBeUndefined();
    expect(reset?.finishedAt).toBeUndefined();
    expect(reset?.outputSize).toBeUndefined();
  });
});
