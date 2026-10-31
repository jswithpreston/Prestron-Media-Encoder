import { describe, it, expect, vi, afterEach } from "vitest";
import { suppressSqliteExperimentalWarning } from "../../../src/platform/suppressExperimentalWarning.js";

/**
 * Tests for suppressSqliteExperimentalWarning.
 *
 * The function casts process to NodeJS.EventEmitter and replaces .emit with a
 * wrapper that short-circuits only for the sqlite ExperimentalWarning. We test
 * by saving/restoring the emitter.emit reference and injecting a mock.
 *
 * ESLint note: we must read and compare `emitter.emit` as an unbound reference
 * to verify the patch/restore behaviour. The eslint-disable comments below are
 * intentional and narrowly scoped.
 */
describe("suppressSqliteExperimentalWarning", () => {
  // Cast to EventEmitter base type — same cast used in the implementation
  const emitter = process as unknown as NodeJS.EventEmitter;
  let savedNodeVersion: string;
  let savedEmit: NodeJS.EventEmitter["emit"];

  afterEach(() => {
    Object.defineProperty(process.versions, "node", {
      value: savedNodeVersion,
      configurable: true,
      writable: true,
    });
    delete (emitter as unknown as { __sqlite_warning_suppressed?: boolean }).__sqlite_warning_suppressed;
    emitter.emit = savedEmit;
  });

  function captureVersionAndEmit() {
    savedNodeVersion = process.versions.node;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    savedEmit = emitter.emit;
    delete (emitter as unknown as { __sqlite_warning_suppressed?: boolean }).__sqlite_warning_suppressed;
  }

  function setNodeVersion(v: string) {
    Object.defineProperty(process.versions, "node", {
      value: v,
      configurable: true,
      writable: true,
    });
  }

  it("is a no-op on Node ≥ 23 — process.emit is never patched", () => {
    captureVersionAndEmit();
    setNodeVersion("23.4.0");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const emitBefore = emitter.emit;
    suppressSqliteExperimentalWarning();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(emitter.emit).toBe(emitBefore);
  });

  it("is a no-op on Node 24 — process.emit is never patched", () => {
    captureVersionAndEmit();
    setNodeVersion("24.0.0");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    const emitBefore = emitter.emit;
    suppressSqliteExperimentalWarning();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(emitter.emit).toBe(emitBefore);
  });

  it("swallows the sqlite ExperimentalWarning and returns false on Node 22", () => {
    captureVersionAndEmit();
    setNodeVersion("22.5.0");

    const mockEmit = vi.fn<NodeJS.EventEmitter["emit"]>().mockReturnValue(true);
    emitter.emit = mockEmit;

    suppressSqliteExperimentalWarning();

    const sqliteWarning = new Error("SQLite is an experimental feature");
    sqliteWarning.name = "ExperimentalWarning";

    const result = emitter.emit("warning", sqliteWarning);
    // Should be suppressed — mockEmit (the underlying) is NOT called
    expect(result).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("persists suppression across multiple sqlite warnings", () => {
    captureVersionAndEmit();
    setNodeVersion("22.5.0");

    const mockEmit = vi.fn<NodeJS.EventEmitter["emit"]>().mockReturnValue(true);
    emitter.emit = mockEmit;

    suppressSqliteExperimentalWarning();

    const sqliteWarning = new Error("SQLite is an experimental feature");
    sqliteWarning.name = "ExperimentalWarning";

    // First call: suppressed
    const res1 = emitter.emit("warning", sqliteWarning);
    expect(res1).toBe(false);
    // Second call: still suppressed (no leak)
    const res2 = emitter.emit("warning", sqliteWarning);
    expect(res2).toBe(false);
    expect(mockEmit).not.toHaveBeenCalled();
  });

  it("passes non-sqlite warnings through on Node 22", () => {
    captureVersionAndEmit();
    setNodeVersion("22.5.0");

    const mockEmit = vi.fn<NodeJS.EventEmitter["emit"]>().mockReturnValue(true);
    emitter.emit = mockEmit;

    suppressSqliteExperimentalWarning();

    const otherWarning = new Error("vm is an experimental feature");
    otherWarning.name = "ExperimentalWarning";

    emitter.emit("warning", otherWarning);
    expect(mockEmit).toHaveBeenCalledWith("warning", otherWarning);
  });

  it("passes non-warning events through on Node 22", () => {
    captureVersionAndEmit();
    setNodeVersion("22.5.0");

    const mockEmit = vi.fn<NodeJS.EventEmitter["emit"]>().mockReturnValue(true);
    emitter.emit = mockEmit;

    suppressSqliteExperimentalWarning();

    emitter.emit("exit", 0);
    expect(mockEmit).toHaveBeenCalledWith("exit", 0);
  });
});
