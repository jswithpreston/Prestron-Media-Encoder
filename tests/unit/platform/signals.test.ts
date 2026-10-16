import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerCleanup, runCleanup, _resetForTesting } from "../../../src/platform/signals.js";

describe("signals — registerCleanup / runCleanup", () => {
  beforeEach(() => {
    _resetForTesting();
  });

  it("calls a registered cleanup function", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    registerCleanup(fn);
    await runCleanup();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("calls multiple cleanup functions", async () => {
    const fn1 = vi.fn().mockResolvedValue(undefined);
    const fn2 = vi.fn().mockResolvedValue(undefined);
    registerCleanup(fn1);
    registerCleanup(fn2);
    await runCleanup();
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("calls cleanup functions in LIFO order", async () => {
    const order: number[] = [];
    registerCleanup(() => {
      order.push(1);
    });
    registerCleanup(() => {
      order.push(2);
    });
    registerCleanup(() => {
      order.push(3);
    });
    await runCleanup();
    expect(order).toEqual([3, 2, 1]);
  });

  it("is idempotent — calling runCleanup twice only invokes callbacks once", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    registerCleanup(fn);
    await runCleanup();
    await runCleanup();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("continues cleanup even if one callback throws", async () => {
    const fn1 = vi.fn().mockRejectedValue(new Error("boom"));
    const fn2 = vi.fn().mockResolvedValue(undefined);
    // fn2 registered first → called last (LIFO: fn2 at index 0, fn1 at index 1)
    registerCleanup(fn2);
    registerCleanup(fn1);
    await runCleanup();
    // Both should have been called despite fn1 throwing
    expect(fn1).toHaveBeenCalledTimes(1);
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("works with sync cleanup functions", async () => {
    let called = false;
    registerCleanup(() => {
      called = true;
    });
    await runCleanup();
    expect(called).toBe(true);
  });

  it("does nothing when no cleanup functions are registered", async () => {
    // Should not throw
    await expect(runCleanup()).resolves.toBeUndefined();
  });
});
