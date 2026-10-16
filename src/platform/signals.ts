/**
 * Signal handling and clean shutdown.
 *
 * Provides a registry of async cleanup callbacks that are guaranteed to run
 * on all exit paths: clean exit, SIGINT, SIGTERM, SIGHUP,
 * uncaughtException, and unhandledRejection.
 *
 * Handlers are idempotent — cleanup only runs once even if multiple signals fire.
 */

export type CleanupFn = () => Promise<void> | void;

const cleanupFns: CleanupFn[] = [];
let cleanupRunning = false;
let cleanupComplete = false;
let handlersRegistered = false;

/**
 * Register a cleanup callback to be called on any exit path.
 * Callbacks are called in LIFO order (last registered, first called).
 */
export function registerCleanup(fn: CleanupFn): void {
  cleanupFns.push(fn);
}

/**
 * Run all registered cleanup callbacks.
 * Idempotent — safe to call multiple times; only executes once.
 */
export async function runCleanup(): Promise<void> {
  if (cleanupRunning || cleanupComplete) {
    return;
  }
  cleanupRunning = true;

  // Call in LIFO order
  for (let i = cleanupFns.length - 1; i >= 0; i--) {
    try {
      await cleanupFns[i]?.();
    } catch {
      // Swallow errors in cleanup — we must continue to clean up remaining callbacks
    }
  }

  cleanupComplete = true;
  cleanupRunning = false;
}

/**
 * Register global signal/error handlers.
 * Must be called once at startup (src/bin/prestron.ts).
 * Safe to call multiple times — only registers handlers once.
 */
export function registerSignalHandlers(): void {
  if (handlersRegistered) {
    return;
  }
  handlersRegistered = true;

  // SIGINT — Ctrl+C (exit code 130 by convention)
  process.on("SIGINT", () => {
    void runCleanup().then(() => {
      process.exit(130);
    });
  });

  // SIGTERM — kill / systemd stop (graceful exit code 0 for a batch cancel)
  process.on("SIGTERM", () => {
    void runCleanup().then(() => {
      process.exit(0);
    });
  });

  // SIGHUP — terminal window closed
  process.on("SIGHUP", () => {
    void runCleanup().then(() => {
      process.exit(0);
    });
  });

  // Uncaught exceptions — log then clean up
  process.on("uncaughtException", (err: Error) => {
    console.error("\n[prestron] Uncaught exception:", err.message);
    void runCleanup().then(() => {
      process.exit(1);
    });
  });

  // Unhandled promise rejections
  process.on("unhandledRejection", (reason: unknown) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error("\n[prestron] Unhandled rejection:", msg);
    void runCleanup().then(() => {
      process.exit(1);
    });
  });
}

/**
 * Reset state — used in tests only.
 * @internal
 */
export function _resetForTesting(): void {
  cleanupFns.length = 0;
  cleanupRunning = false;
  cleanupComplete = false;
  handlersRegistered = false;
}
