import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeBatch } from "../../../../src/core/probe/batchProbe.js";
import { createSqliteJournalStore } from "../../../../src/core/jobs/sqliteJournalStore.js";
import type { ProcessRunner } from "../../../../src/core/ffmpeg/capabilities.js";
import type { ScannedFile } from "../../../../src/core/scanner/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "../../../fixtures/probes");

function makeScannedFile(name: string, size = 183180000, mtime = 1700000000000): ScannedFile {
  return {
    path: `/videos/${name}`,
    sizeBytes: size,
    mtimeMs: mtime,
  };
}

function fixtureRunner(fixtureName: string): ProcessRunner {
  const content = readFileSync(join(FIXTURES, fixtureName), "utf8");
  return {
    run() {
      return Promise.resolve({ stdout: content, stderr: "", exitCode: 0 });
    },
  };
}

describe("probeBatch", () => {
  it("handles empty list of files", async () => {
    const runner = fixtureRunner("h264-1080p-high.json");
    const results = await probeBatch([], runner);
    expect(results).toEqual([]);
  });

  it("probes multiple files and reports progress", async () => {
    const runner = fixtureRunner("h264-1080p-high.json");
    const files = [
      makeScannedFile("file1.mp4"),
      makeScannedFile("file2.mp4"),
      makeScannedFile("file3.mp4"),
    ];

    const progressReports: number[] = [];
    const results = await probeBatch(files, runner, {
      concurrency: 2,
      onProgress: (done, total) => {
        expect(total).toBe(3);
        progressReports.push(done);
      },
    });

    expect(results).toHaveLength(3);
    expect(results[0]?.mediaInfo?.video.codec).toBe("h264");
    expect(results[0]?.fromCache).toBe(false);
    expect(progressReports).toEqual([1, 2, 3]);
  });

  it("caches probe results in SQLite journalStore and hits cache on repeat", async () => {
    const store = createSqliteJournalStore(":memory:");
    const runner = fixtureRunner("h264-1080p-high.json");
    const file = makeScannedFile("test_file.mp4", 183180000, 1700000000000);

    // First run — probes and writes to cache
    const firstRun = await probeBatch([file], runner, { journalStore: store });
    expect(firstRun[0]?.fromCache).toBe(false);
    expect(firstRun[0]?.mediaInfo?.video.width).toBe(1920);

    // Second run with same mtime & size — should hit cache!
    const secondRunner: ProcessRunner = {
      run() {
        throw new Error("Should not be called if cache hits!");
      },
    };
    const secondRun = await probeBatch([file], secondRunner, { journalStore: store });
    expect(secondRun[0]?.fromCache).toBe(true);
    expect(secondRun[0]?.mediaInfo?.video.width).toBe(1920);

    // Third run with modified mtime — cache should invalidate and re-run
    const modifiedFile = makeScannedFile("test_file.mp4", 183180000, 1700000009999);
    const thirdRun = await probeBatch([modifiedFile], runner, { journalStore: store });
    expect(thirdRun[0]?.fromCache).toBe(false);

    store.close();
  });

  it("handles errors gracefully per file without failing the whole batch", async () => {
    let callCount = 0;
    const flakeyRunner: ProcessRunner = {
      run() {
        callCount++;
        if (callCount === 2) {
          return Promise.resolve({ stdout: "", stderr: "Invalid data found", exitCode: 1 });
        }
        const content = readFileSync(join(FIXTURES, "h264-1080p-high.json"), "utf8");
        return Promise.resolve({ stdout: content, stderr: "", exitCode: 0 });
      },
    };

    const files = [
      makeScannedFile("good1.mp4"),
      makeScannedFile("bad.mp4"),
      makeScannedFile("good2.mp4"),
    ];

    const results = await probeBatch(files, flakeyRunner, { concurrency: 1 });
    expect(results).toHaveLength(3);
    expect(results[0]?.mediaInfo).not.toBeNull();
    expect(results[0]?.error).toBeNull();

    expect(results[1]?.mediaInfo).toBeNull();
    expect(results[1]?.error).toContain("ffprobe exited with code 1");

    expect(results[2]?.mediaInfo).not.toBeNull();
    expect(results[2]?.error).toBeNull();
  });
});
