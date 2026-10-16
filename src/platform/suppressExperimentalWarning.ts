/**
 * Suppresses the Node.js ExperimentalWarning for node:sqlite on Node 22.
 *
 * Background:
 *   - Node 22.5 introduced node:sqlite behind the --experimental-sqlite flag.
 *     Importing the module schedules an ExperimentalWarning via process.nextTick,
 *     which is then dispatched through process.emit('warning', ...).
 *   - Node 23.4 enabled node:sqlite by default (no flag, no warning).
 *   - Node 24+ treats it as stable — no warning is emitted at all.
 *
 * Why this matters:
 *   Raw text written to stderr before the Ink UI initialises its renderer will
 *   appear as garbage in the terminal output and corrupt the display.
 *
 * How it works:
 *   On Node 22 only, this function registers a one-shot 'warning' listener
 *   via process.prependOnceListener. Because we prepend before Node's built-in
 *   onWarning listener, our handler fires first. Returning early (without re-emitting)
 *   does NOT prevent subsequent listeners from running — but Node's built-in
 *   process.emitWarning internal path is the *only* place that writes to stderr,
 *   and it does so by calling process.nextTick → process.emit('warning').
 *   Since process.emit fires our prepended listener synchronously before the
 *   default onWarning listener, we can call process.removeAllListeners('warning')
 *   specifically for the sqlite warning then re-add them — but the cleanest
 *   approach is to just swallow the event by patching EventEmitter.prototype.emit
 *   for one tick, which is overly broad. Instead we use the documented approach:
 *   patch the process object's emit as an EventEmitter at the JS level.
 *
 * Implementation:
 *   We cast process to NodeJS.EventEmitter (its base type) and replace emit with a
 *   wrapper that short-circuits only for the sqlite ExperimentalWarning. The wrapper
 *   restores the original emit immediately after the first match (one-shot).
 *
 * Guarantees:
 *   - Must be called before the first import of node:sqlite.
 *   - Is a no-op on Node ≥ 23 (zero overhead, process.emit is never patched).
 *   - Does not affect any other warning type or event.
 *   - Self-removes after the first sqlite warning match.
 */
export function suppressSqliteExperimentalWarning(): void {
  const nodeMajor = parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  // Node 23+ has node:sqlite as stable — no ExperimentalWarning to suppress
  if (nodeMajor >= 23) return;

  // Cast to the base EventEmitter interface to avoid the deeply overloaded
  // process.emit signature. At runtime process IS an EventEmitter.
  const emitter = process as unknown as NodeJS.EventEmitter;
  const originalEmit = emitter.emit.bind(emitter);

  function patchedEmit(event: string | symbol, ...args: unknown[]): boolean {
    if (event === "warning") {
      const warning = args[0];
      if (
        typeof warning === "object" &&
        warning !== null &&
        (warning as { name?: string }).name === "ExperimentalWarning" &&
        /sqlite/i.test((warning as { message?: string }).message ?? "")
      ) {
        // One-shot: restore original immediately so other warnings are unaffected
        emitter.emit = originalEmit;
        // Return false — warning swallowed, stderr stays clean
        return false;
      }
    }
    return originalEmit(event, ...args);
  }

  emitter.emit = patchedEmit;
}
