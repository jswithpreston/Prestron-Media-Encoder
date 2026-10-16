import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { scanDirectory } from "../../../../src/core/scanner/index.js";

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "prestron-scanner-test-"));

  // Season 1 episodes
  await writeFile(join(tmpDir, "Show.Name.S01E01.mkv"), "fake");
  await writeFile(join(tmpDir, "Show.Name.S01E02.mkv"), "fake");
  await writeFile(join(tmpDir, "Show.Name.S01E03.avi"), "fake");

  // A Prestron-Encoded dir — must be ignored
  await mkdir(join(tmpDir, "Prestron-Encoded"));
  await writeFile(join(tmpDir, "Prestron-Encoded", "Show.Name.S01E01.mkv"), "encoded");

  // A sample dir — must be ignored
  await mkdir(join(tmpDir, "sample"));
  await writeFile(join(tmpDir, "sample", "sample.mkv"), "sample");

  // A hidden dir — must be ignored
  await mkdir(join(tmpDir, ".thumbnails"));
  await writeFile(join(tmpDir, ".thumbnails", "thumb.mkv"), "thumb");

  // A symlink to a video file — must be skipped
  await symlink(join(tmpDir, "Show.Name.S01E01.mkv"), join(tmpDir, "symlink.mkv")).catch(() => {
    // symlinks may not work in all CI environments — test still counts symlinkCount
  });

  // Duplicate episode (same show/season/episode, different release group)
  await writeFile(join(tmpDir, "[Group2] Show Name - S01E01 [720p].mkv"), "fake2");

  // A non-video file — must be excluded
  await writeFile(join(tmpDir, "readme.txt"), "text");

  // Nested season dir
  await mkdir(join(tmpDir, "Season 2"));
  await writeFile(join(tmpDir, "Season 2", "Show.Name.S02E01.mkv"), "fake");
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("scanDirectory", () => {
  it("finds video files with correct extensions", async () => {
    const result = await scanDirectory(tmpDir);
    const names = result.files.map((f) => f.path.split("/").pop());
    expect(names).toContain("Show.Name.S01E01.mkv");
    expect(names).toContain("Show.Name.S01E02.mkv");
    expect(names).toContain("Show.Name.S01E03.avi");
    // Non-video file not included
    expect(names).not.toContain("readme.txt");
  });

  it("ignores the Prestron-Encoded directory", async () => {
    const result = await scanDirectory(tmpDir);
    const inEncoded = result.files.filter((f) => f.path.includes("Prestron-Encoded"));
    expect(inEncoded).toHaveLength(0);
    expect(result.ignoredCount).toBeGreaterThanOrEqual(1);
  });

  it("ignores the sample directory", async () => {
    const result = await scanDirectory(tmpDir);
    const inSample = result.files.filter((f) => f.path.includes("/sample/"));
    expect(inSample).toHaveLength(0);
  });

  it("ignores hidden directories", async () => {
    const result = await scanDirectory(tmpDir);
    const inHidden = result.files.filter((f) => f.path.includes("/."));
    expect(inHidden).toHaveLength(0);
  });

  it("does not follow symlinks", async () => {
    const result = await scanDirectory(tmpDir);
    // symlinkCount should be >= 0 (1 if symlinks are supported in this env)
    expect(result.symlinkCount).toBeGreaterThanOrEqual(0);
    // The symlink.mkv should NOT appear as a regular file
    const names = result.files.map((f) => f.path.split("/").pop());
    expect(names).not.toContain("symlink.mkv");
  });

  it("scans nested season directories", async () => {
    const result = await scanDirectory(tmpDir);
    const season2 = result.files.filter((f) => f.path.includes("Season 2"));
    expect(season2.length).toBeGreaterThanOrEqual(1);
  });

  it("parses episode info for SxxExx files", async () => {
    const result = await scanDirectory(tmpDir);
    const ep1 = result.files.find((f) => f.path.endsWith("Show.Name.S01E01.mkv"));
    expect(ep1?.episode).not.toBeNull();
    expect(ep1?.episode?.season).toBe(1);
    expect(ep1?.episode?.episode).toBe(1);
  });

  it("detects duplicate episodes", async () => {
    const result = await scanDirectory(tmpDir);
    // S01E01 appears twice (original + [Group2] version)
    expect(result.duplicates.length).toBeGreaterThanOrEqual(1);
    const dup = result.duplicates.find((d) => d.key.includes(":1:1"));
    expect(dup).toBeDefined();
    expect(dup?.files.length).toBeGreaterThanOrEqual(2);
  });

  it("returns sizeBytes and mtimeMs for each file", async () => {
    const result = await scanDirectory(tmpDir);
    for (const file of result.files) {
      expect(file.sizeBytes).toBeGreaterThanOrEqual(0);
      expect(file.mtimeMs).toBeGreaterThan(0);
    }
  });

  it("extra ignore dirs option excludes matching directories", async () => {
    await mkdir(join(tmpDir, "extras")).catch(() => {
      /* ignore if directory already exists */
    });
    await writeFile(join(tmpDir, "extras", "bonus.mkv"), "bonus");
    const result = await scanDirectory(tmpDir, { extraIgnoreDirs: ["extras"] });
    const inExtras = result.files.filter((f) => f.path.includes("/extras/"));
    expect(inExtras).toHaveLength(0);
  });
});
