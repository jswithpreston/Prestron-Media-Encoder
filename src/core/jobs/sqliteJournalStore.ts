/**
 * SQLite implementation of JournalStore using node:sqlite (built-in, Node ≥ 22.5).
 *
 * WAL mode + synchronous=FULL ensures the journal survives kill -9 and power cuts.
 * Transactions are managed with explicit BEGIN/COMMIT/ROLLBACK since node:sqlite
 * does not have a `.transaction()` helper like better-sqlite3.
 */

import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  StateTransitionError,
  type Batch,
  type BatchStatus,
  type Job,
  type JobState,
  type JournalStore,
} from "./journalStore.js";

// ---------------------------------------------------------------------------
// Schema DDL
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;

CREATE TABLE IF NOT EXISTS batches (
  id          TEXT PRIMARY KEY,
  root_path   TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  finished_at INTEGER,
  status      TEXT NOT NULL CHECK(status IN ('active','done','failed','partial')),
  options_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id              TEXT PRIMARY KEY,
  batch_id        TEXT NOT NULL REFERENCES batches(id),
  source_path     TEXT NOT NULL,
  source_size     INTEGER NOT NULL,
  source_mtime_ms INTEGER NOT NULL,
  output_path     TEXT NOT NULL,
  state           TEXT NOT NULL CHECK(state IN (
    'pending','encoding','verifying','done','failed','skipped','interrupted'
  )),
  plan_json       TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  started_at      INTEGER,
  finished_at     INTEGER,
  output_size     INTEGER,
  ffmpeg_pid      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs(batch_id);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
`;

// ---------------------------------------------------------------------------
// SqliteJournalStore
// ---------------------------------------------------------------------------

class SqliteJournalStore implements JournalStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  createBatch(batch: Omit<Batch, "id">): Batch {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO batches (id, root_path, created_at, finished_at, status, options_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        batch.rootPath,
        batch.createdAt,
        batch.finishedAt ?? null,
        batch.status,
        batch.optionsJson,
      );
    return { ...batch, id };
  }

  getBatch(id: string): Batch | undefined {
    const row = this.db.prepare(`SELECT * FROM batches WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? rowToBatch(row) : undefined;
  }

  getActiveBatch(rootPath: string): Batch | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM batches WHERE root_path = ? AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(rootPath) as Record<string, unknown> | undefined;
    return row ? rowToBatch(row) : undefined;
  }

  updateBatch(id: string, updates: Partial<Pick<Batch, "status" | "finishedAt">>): void {
    this.db
      .prepare(
        `UPDATE batches SET status = COALESCE(?, status),
         finished_at = COALESCE(?, finished_at) WHERE id = ?`,
      )
      .run(updates.status ?? null, updates.finishedAt ?? null, id);
  }

  createJob(job: Omit<Job, "id">): Job {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO jobs
           (id, batch_id, source_path, source_size, source_mtime_ms, output_path,
            state, plan_json, attempts, error, started_at, finished_at, output_size, ffmpeg_pid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        job.batchId,
        job.sourcePath,
        job.sourceSize,
        job.sourceMtimeMs,
        job.outputPath,
        job.state,
        job.planJson,
        job.attempts,
        job.error ?? null,
        job.startedAt ?? null,
        job.finishedAt ?? null,
        job.outputSize ?? null,
        job.ffmpegPid ?? null,
      );
    return { ...job, id };
  }

  getJob(id: string): Job | undefined {
    const row = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? rowToJob(row) : undefined;
  }

  getJobsForBatch(batchId: string): Job[] {
    const rows = this.db
      .prepare(`SELECT * FROM jobs WHERE batch_id = ? ORDER BY rowid`)
      .all(batchId) as Record<string, unknown>[];
    return rows.map(rowToJob);
  }

  getJobsForRoot(rootPath: string): Job[] {
    const rows = this.db
      .prepare(
        `SELECT j.* FROM jobs j
         JOIN batches b ON b.id = j.batch_id
         WHERE b.root_path = ?
         ORDER BY j.rowid`,
      )
      .all(rootPath) as Record<string, unknown>[];
    return rows.map(rowToJob);
  }

  findJobBySourcePath(sourcePath: string): Job | undefined {
    const row = this.db
      .prepare(`SELECT * FROM jobs WHERE source_path = ? ORDER BY rowid DESC LIMIT 1`)
      .get(sourcePath) as Record<string, unknown> | undefined;
    return row ? rowToJob(row) : undefined;
  }

  resetJobToPending(id: string): void {
    this.db
      .prepare(
        `UPDATE jobs
         SET state = 'pending',
             attempts = attempts + 1,
             error = NULL,
             finished_at = NULL,
             output_size = NULL
         WHERE id = ?`,
      )
      .run(id);
  }

  transitionJobState(
    id: string,
    from: JobState,
    to: JobState,
    updates?: Partial<
      Pick<
        Job,
        "error" | "startedAt" | "finishedAt" | "outputSize" | "attempts" | "ffmpegPid"
      >
    >,
  ): void {
    // Manual transaction: BEGIN → check state → update → COMMIT (or ROLLBACK on error)
    this.db.exec("BEGIN");
    try {
      const row = this.db.prepare(`SELECT state FROM jobs WHERE id = ?`).get(id) as
        Record<string, unknown> | undefined;

      if (!row) {
        this.db.exec("ROLLBACK");
        throw new StateTransitionError(id, from, "pending");
      }
      const currentState = String(row["state"]);
      if (currentState !== from) {
        this.db.exec("ROLLBACK");
        throw new StateTransitionError(id, from, currentState as JobState);
      }
      this.db
        .prepare(
          `UPDATE jobs SET state = ?,
           error = COALESCE(?, error),
           started_at = COALESCE(?, started_at),
           finished_at = COALESCE(?, finished_at),
           output_size = COALESCE(?, output_size),
           attempts = COALESCE(?, attempts),
           ffmpeg_pid = COALESCE(?, ffmpeg_pid)
           WHERE id = ?`,
        )
        .run(
          to,
          updates?.error ?? null,
          updates?.startedAt ?? null,
          updates?.finishedAt ?? null,
          updates?.outputSize ?? null,
          updates?.attempts ?? null,
          updates?.ffmpegPid ?? null,
          id,
        );
      this.db.exec("COMMIT");
    } catch (err) {
      // If the db.exec("ROLLBACK") or COMMIT already ran, this may throw — ignore
      try {
        this.db.exec("ROLLBACK");
      } catch {
        /* already rolled back */
      }
      throw err;
    }
  }

  pragma(name: string): unknown {
    const row = this.db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown> | undefined;
    return row !== undefined ? Object.values(row)[0] : undefined;
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToBatch(row: Record<string, unknown>): Batch {
  const finishedAt = row["finished_at"];
  return {
    id: String(row["id"]),
    rootPath: String(row["root_path"]),
    createdAt: Number(row["created_at"]),
    ...(finishedAt != null ? { finishedAt: Number(finishedAt) } : {}),
    status: String(row["status"]) as BatchStatus,
    optionsJson: String(row["options_json"]),
  };
}

function rowToJob(row: Record<string, unknown>): Job {
  const error = row["error"];
  const startedAt = row["started_at"];
  const finishedAt = row["finished_at"];
  const outputSize = row["output_size"];
  const ffmpegPid = row["ffmpeg_pid"];
  return {
    id: String(row["id"]),
    batchId: String(row["batch_id"]),
    sourcePath: String(row["source_path"]),
    sourceSize: Number(row["source_size"]),
    sourceMtimeMs: Number(row["source_mtime_ms"]),
    outputPath: String(row["output_path"]),
    state: String(row["state"]) as JobState,
    planJson: String(row["plan_json"]),
    attempts: Number(row["attempts"]),
    ...(typeof error === "string" ? { error } : {}),
    ...(startedAt != null ? { startedAt: Number(startedAt) } : {}),
    ...(finishedAt != null ? { finishedAt: Number(finishedAt) } : {}),
    ...(outputSize != null ? { outputSize: Number(outputSize) } : {}),
    ...(ffmpegPid != null ? { ffmpegPid: Number(ffmpegPid) } : {}),
  };
}

/**
 * Factory — creates a JournalStore backed by a SQLite database at `dbPath`.
 * Use ':memory:' for in-memory databases (useful in tests).
 */
export function createSqliteJournalStore(dbPath: string): JournalStore {
  return new SqliteJournalStore(dbPath);
}
