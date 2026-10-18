/**
 * Journal DB helper — opens the SQLite journal store in XDG data or custom path.
 */

import { join } from "node:path";
import { getXdgPathsEnsured } from "../../platform/xdg.js";
import { createSqliteJournalStore } from "./sqliteJournalStore.js";
import type { JournalStore } from "./journalStore.js";

export function getJournalDbPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env["PRESTRON_DB_PATH"]) return process.env["PRESTRON_DB_PATH"];
  const xdg = getXdgPathsEnsured();
  return join(xdg.data, "journal.db");
}

export function openJournalStore(customPath?: string): JournalStore {
  return createSqliteJournalStore(getJournalDbPath(customPath));
}
