import { describe, it, expect, afterEach } from "vitest";
import { getJournalDbPath, openJournalStore } from "../../../../src/core/jobs/journalDb.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";

describe("journalDb", () => {
  const originalEnv = process.env["PRESTRON_DB_PATH"];

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env["PRESTRON_DB_PATH"] = originalEnv;
    } else {
      delete process.env["PRESTRON_DB_PATH"];
    }
  });

  it("respects custom path when provided", () => {
    const custom = "/custom/path/journal.db";
    expect(getJournalDbPath(custom)).toBe(custom);
  });

  it("respects PRESTRON_DB_PATH env variable", () => {
    process.env["PRESTRON_DB_PATH"] = "/env/path/journal.db";
    expect(getJournalDbPath()).toBe("/env/path/journal.db");
  });

  it("defaults to XDG data journal.db", () => {
    delete process.env["PRESTRON_DB_PATH"];
    const p = getJournalDbPath();
    expect(p).toContain("journal.db");
  });

  it("opens a functional journal store at custom path", async () => {
    const dbPath = join(tmpdir(), `prestron-test-${String(Date.now())}.db`);
    const store = openJournalStore(dbPath);
    expect(store).toBeDefined();

    const batch = store.createBatch({
      rootPath: "/test",
      createdAt: Date.now(),
      status: "active",
      optionsJson: "{}",
    });
    expect(batch.id).toBeDefined();

    store.close();
    try {
      await unlink(dbPath);
    } catch {
      /* ignore */
    }
  });
});
