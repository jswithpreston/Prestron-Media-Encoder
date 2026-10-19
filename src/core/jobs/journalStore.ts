/**
 * JournalStore — abstract interface for the job journal backend.
 *
 * Keeping the interface separate from the SQLite implementation means:
 * - Tests can use an in-memory fake without touching the filesystem.
 * - A future backend (e.g. JSON file, cloud store) can be swapped in
 *   by implementing this interface and passing it to the batch runner.
 */

export type JobState =
  "pending" | "encoding" | "verifying" | "done" | "failed" | "skipped" | "interrupted";

export type BatchStatus = "active" | "done" | "failed" | "partial";

export interface Batch {
  id: string;
  rootPath: string;
  createdAt: number; // unix ms
  finishedAt?: number;
  status: BatchStatus;
  optionsJson: string;
}

export interface Job {
  id: string;
  batchId: string;
  sourcePath: string;
  sourceSize: number;
  sourceMtimeMs: number;
  outputPath: string;
  state: JobState;
  planJson: string;
  attempts: number;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  outputSize?: number;
  /** PID of the ffmpeg child process while this job is encoding (set at runtime). */
  ffmpegPid?: number;
}

export interface JournalStore {
  /** Create a new batch record. Returns the created batch with generated id. */
  createBatch(batch: Omit<Batch, "id">): Batch;

  /** Fetch a batch by id. Returns undefined if not found. */
  getBatch(id: string): Batch | undefined;

  /**
   * Fetch the most recent batch with status 'active' for the given root path.
   * Returns undefined if no active batch exists.
   */
  getActiveBatch(rootPath: string): Batch | undefined;

  /** Update mutable batch fields. */
  updateBatch(id: string, updates: Partial<Pick<Batch, "status" | "finishedAt">>): void;

  /** Create a new job record. Returns the created job with generated id. */
  createJob(job: Omit<Job, "id">): Job;

  /** Fetch a job by id. Returns undefined if not found. */
  getJob(id: string): Job | undefined;

  /** Fetch all jobs belonging to a batch, ordered by rowid. */
  getJobsForBatch(batchId: string): Job[];

  /** Fetch all jobs associated with a given root path across all batches. */
  getJobsForRoot(rootPath: string): Job[];

  /** Find the most recent job record for a given source file path. */
  findJobBySourcePath(sourcePath: string): Job | undefined;

  /** Reset an interrupted, crashed, or missing-output job back to pending state. */
  resetJobToPending(id: string): void;

  /**
   * Atomically transition a job's state.
   *
   * Reads the current state inside a transaction; if it does not equal `from`,
   * throws a StateTransitionError. If it matches, applies the new state and
   * any provided updates in a single commit.
   *
   * This ensures a crash between "before" and "after" state writes leaves the DB
   * in a consistent pre- or post-state, never mid-transition.
   */
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
  ): void;

  /**
   * Run a raw PRAGMA query and return the result value.
   * Used in tests to verify WAL mode and synchronous=FULL are applied.
   * @internal exposed for testing only
   */
  pragma(name: string): unknown;

  /** Close the underlying database connection. */
  close(): void;
}

/** Thrown when transitionJobState finds the current state does not match `from`. */
export class StateTransitionError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly expectedState: JobState,
    public readonly actualState: JobState,
  ) {
    super(`Job ${jobId}: expected state '${expectedState}' but found '${actualState}'`);
    this.name = "StateTransitionError";
  }
}
