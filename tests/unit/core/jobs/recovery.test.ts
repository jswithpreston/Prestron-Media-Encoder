import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSqliteJournalStore } from "../../../../src/core/jobs/sqliteJournalStore.js";
import { recoverFolder } from "../../../../src/core/jobs/recovery.js";
import type { JournalStore } from "../../../../src/core/jobs/journalStore.js";

describe("recoverFolder", () => {
  let tmpDir: string;
  let store: JournalStore;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `prestron-recovery-test-${String(Date.now())}`);
    await mkdir(tmpDir, { recursive: true });
    store = createSqliteJournalStore(":memory:");
  });

  afterEach(async () => {
    try {
      store.close();
    } catch {
      /* ignore */
    }
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("re-queues jobs stuck in 'encoding' and deletes stale .part file", async () => {
    const encodedDir = join(tmpDir, "Prestron-Encoded");
    await mkdir(encodedDir, { recursive: true });
    const partFile = join(encodedDir, "test.mkv.part");
    await writeFile(partFile, "in-progress-data");

    const batch = store.createBatch({
      rootPath: tmpDir,
      createdAt: Date.now(),
      status: "active",
      optionsJson: "{}",
    });

    const job = store.createJob({
      batchId: batch.id,
      sourcePath: join(tmpDir, "test.mkv"),
      sourceSize: 1000,
      sourceMtimeMs: Date.now(),
      outputPath: join(encodedDir, "test.mkv"),
      state: "pending",
      planJson: "{}",
      attempts: 0,
    });

    store.transitionJobState(job.id, "pending", "encoding");

    const report = await recoverFolder(store, tmpDir);

    expect(report.jobsRequeued).toContain(join(tmpDir, "test.mkv"));
    expect(report.stalePartFilesRemoved).toContain(partFile);

    // .part file should be unlinked
    await expect(stat(partFile)).rejects.toThrow();

    // Job should be reset to pending with attempts incremented
    const updated = store.getJob(job.id);
    expect(updated?.state).toBe("pending");
    expect(updated?.attempts).toBe(1);
  });

  it("re-queues jobs in 'interrupted' state", async () => {
    const encodedDir = join(tmpDir, "Prestron-Encoded");
    await mkdir(encodedDir, { recursive: true });

    const batch = store.createBatch({
      rootPath: tmpDir,
      createdAt: Date.now(),
      status: "active",
      optionsJson: "{}",
    });

    const job = store.createJob({
      batchId: batch.id,
      sourcePath: join(tmpDir, "interrupted.mkv"),
      sourceSize: 1000,
      sourceMtimeMs: Date.now(),
      outputPath: join(encodedDir, "interrupted.mkv"),
      state: "pending",
      planJson: "{}",
      attempts: 0,
    });

    store.transitionJobState(job.id, "pending", "encoding");
    store.transitionJobState(job.id, "encoding", "interrupted");

    const report = await recoverFolder(store, tmpDir);

    expect(report.jobsRequeued).toContain(join(tmpDir, "interrupted.mkv"));
    const updated = store.getJob(job.id);
    expect(updated?.state).toBe("pending");
    expect(updated?.attempts).toBe(1);
  });

  it("re-queues 'done' jobs when output file on disk is deleted", async () => {
    const encodedDir = join(tmpDir, "Prestron-Encoded");
    await mkdir(encodedDir, { recursive: true });

    const batch = store.createBatch({
      rootPath: tmpDir,
      createdAt: Date.now(),
      status: "active",
      optionsJson: "{}",
    });

    const job = store.createJob({
      batchId: batch.id,
      sourcePath: join(tmpDir, "missing-out.mkv"),
      sourceSize: 1000,
      sourceMtimeMs: Date.now(),
      outputPath: join(encodedDir, "missing-out.mkv"),
      state: "pending",
      planJson: "{}",
      attempts: 0,
    });

    store.transitionJobState(job.id, "pending", "encoding");
    store.transitionJobState(job.id, "encoding", "verifying");
    store.transitionJobState(job.id, "verifying", "done", { outputSize: 800 });

    // Output file doesn't exist on disk (user deleted it)
    const report = await recoverFolder(store, tmpDir);

    expect(report.missingOutputsRequeued).toContain(join(tmpDir, "missing-out.mkv"));
    const updated = store.getJob(job.id);
    expect(updated?.state).toBe("pending");
  });

  it("leaves 'done' jobs untouched when output file exists on disk", async () => {
    const encodedDir = join(tmpDir, "Prestron-Encoded");
    await mkdir(encodedDir, { recursive: true });
    const outFile = join(encodedDir, "completed.mkv");
    await writeFile(outFile, "output-media-bytes");

    const batch = store.createBatch({
      rootPath: tmpDir,
      createdAt: Date.now(),
      status: "active",
      optionsJson: "{}",
    });

    const job = store.createJob({
      batchId: batch.id,
      sourcePath: join(tmpDir, "completed.mkv"),
      sourceSize: 1000,
      sourceMtimeMs: Date.now(),
      outputPath: outFile,
      state: "pending",
      planJson: "{}",
      attempts: 0,
    });

    store.transitionJobState(job.id, "pending", "encoding");
    store.transitionJobState(job.id, "encoding", "verifying");
    store.transitionJobState(job.id, "verifying", "done", { outputSize: 18 });

    const report = await recoverFolder(store, tmpDir);

    expect(report.missingOutputsRequeued).toHaveLength(0);
    const updated = store.getJob(job.id);
    expect(updated?.state).toBe("done");
  });
});
