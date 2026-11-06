/**
 * SQLite implementation of JournalStore using node:sqlite (built-in, Node ≥ 22.5).
 *
 * WAL mode + synchronous=FULL ensures the journal survives kill -9 and power cuts.
 * Transactions are managed with explicit BEGIN/COMMIT/ROLLBACK since node:sqlite
 * does not have a `.transaction()` helper like better-sqlite3.
 */

import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { suppressSqliteExperimentalWarning } from "../../platform/suppressExperimentalWarning.js";

// Ensure SQLite warning filter is installed before loading node:sqlite
suppressSqliteExperimentalWarning();

const require = createRequire(import.meta.url);
const sqliteModule = require("node:sqlite") as {
  DatabaseSync: new (path: string) => DatabaseSyncType;
};
const DatabaseSync = sqliteModule.DatabaseSync;
import type { MediaInfo } from "../probe/index.js";
import {
  StateTransitionError,
  type Batch,
  type BatchStatus,
  type Job,
  type JobState,
  type JournalStore,
  type EncodeHistoryRecord,
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

CREATE TABLE IF NOT EXISTS probe_cache (
  path        TEXT PRIMARY KEY,
  size        INTEGER NOT NULL,
  mtime_ms    INTEGER NOT NULL,
  probe_json  TEXT NOT NULL,
  probed_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_probe_cache_lookup ON probe_cache(path, size, mtime_ms);

CREATE TABLE IF NOT EXISTS encode_history (
  id                      TEXT PRIMARY KEY,
  source_path             TEXT NOT NULL,
  source_size_bytes       INTEGER NOT NULL,
  output_size_bytes       INTEGER NOT NULL,
  source_codec            TEXT NOT NULL,
  target_codec            TEXT NOT NULL,
  profile_name            TEXT NOT NULL,
  crf                     INTEGER NOT NULL,
  preset                  TEXT NOT NULL,
  bpp                     REAL NOT NULL,
  duration_secs           REAL NOT NULL,
  encode_duration_ms      INTEGER NOT NULL,
  compression_ratio       REAL NOT NULL,
  video_compression_ratio REAL NOT NULL,
  timestamp               INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_encode_history_lookup ON encode_history(source_codec, profile_name);
`;

// ---------------------------------------------------------------------------
// SqliteJournalStore
// ---------------------------------------------------------------------------

class SqliteJournalStore implements JournalStore {
  private readonly db: DatabaseSyncType;

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
      Pick<Job, "error" | "startedAt" | "finishedAt" | "outputSize" | "attempts" | "ffmpegPid">
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

  getCachedProbe(filePath: string, sizeBytes: number, mtimeMs: number): MediaInfo | null {
    const row = this.db
      .prepare(`SELECT probe_json, size, mtime_ms FROM probe_cache WHERE path = ?`)
      .get(filePath) as { probe_json: string; size: number; mtime_ms: number } | undefined;
    if (!row) return null;
    if (row.size !== sizeBytes || row.mtime_ms !== mtimeMs) {
      this.db.prepare(`DELETE FROM probe_cache WHERE path = ?`).run(filePath);
      return null;
    }
    try {
      return JSON.parse(row.probe_json) as MediaInfo;
    } catch {
      return null;
    }
  }

  cacheProbe(mediaInfo: MediaInfo, mtimeMs: number): void {
    const json = JSON.stringify(mediaInfo);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO probe_cache (path, size, mtime_ms, probe_json, probed_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(mediaInfo.path, mediaInfo.sizeBytes, mtimeMs, json, Date.now());
  }

  recordEncodeHistory(record: EncodeHistoryRecord): void {
    const id = record.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO encode_history (
           id, source_path, source_size_bytes, output_size_bytes,
           source_codec, target_codec, profile_name, crf, preset,
           bpp, duration_secs, encode_duration_ms,
           compression_ratio, video_compression_ratio, timestamp
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        record.sourcePath,
        record.sourceSizeBytes,
        record.outputSizeBytes,
        record.sourceCodec,
        record.targetCodec,
        record.profileName,
        record.crf,
        record.preset,
        record.bpp,
        record.durationSecs,
        record.encodeDurationMs,
        record.compressionRatio,
        record.videoCompressionRatio,
        record.timestamp,
      );
  }

  getEncodeHistory(
    sourceCodec?: string,
    profileName?: string,
    limit = 50,
  ): EncodeHistoryRecord[] {
    let sql = `SELECT * FROM encode_history`;
    const clauses: string[] = [];
    const params: (string | number)[] = [];

    if (sourceCodec) {
      clauses.push(`source_codec = ?`);
      params.push(sourceCodec.toLowerCase());
    }
    if (profileName) {
      clauses.push(`profile_name = ?`);
      params.push(profileName);
    }
    if (clauses.length > 0) {
      sql += ` WHERE ` + clauses.join(" AND ");
    }
    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row["id"]),
      sourcePath: String(row["source_path"]),
      sourceSizeBytes: Number(row["source_size_bytes"]),
      outputSizeBytes: Number(row["output_size_bytes"]),
      sourceCodec: String(row["source_codec"]),
      targetCodec: String(row["target_codec"]),
      profileName: String(row["profile_name"]),
      crf: Number(row["crf"]),
      preset: String(row["preset"]),
      bpp: Number(row["bpp"]),
      durationSecs: Number(row["duration_secs"]),
      encodeDurationMs: Number(row["encode_duration_ms"]),
      compressionRatio: Number(row["compression_ratio"]),
      videoCompressionRatio: Number(row["video_compression_ratio"]),
      timestamp: Number(row["timestamp"]),
    }));
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
