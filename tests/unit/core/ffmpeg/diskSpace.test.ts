import { describe, it, expect } from "vitest";
import { checkDiskSpace } from "../../../../src/core/ffmpeg/diskSpace.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("checkDiskSpace", () => {
  it("returns available when free space exceeds required space", async () => {
    const testDir = join(tmpdir(), `prestron-disk-test-${String(Date.now())}`);
    const result = await checkDiskSpace(testDir, 1_000); // 1 KB source -> 1.1 KB required
    expect(result.available).toBe(true);
    expect(result.requiredBytes).toBe(1_100);
    expect(result.freeBytes).toBeGreaterThan(0);
    expect(result.message).toContain("Disk space OK");
  });

  it("returns unavailable when required space exceeds free space", async () => {
    const testDir = join(tmpdir(), `prestron-disk-test-${String(Date.now())}-huge`);
    // 100 PB source -> impossible to have on current fs
    const result = await checkDiskSpace(testDir, 100_000_000_000_000_000);
    expect(result.available).toBe(false);
    expect(result.message).toContain("Insufficient disk space");
  });
});
