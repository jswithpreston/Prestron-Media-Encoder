/**
 * Recursive video file scanner.
 *
 * - Does NOT follow symlinks.
 * - Ignores Prestron-Encoded, sample dirs, hidden dirs (configurable).
 * - Parses episode metadata from filenames and parent folder names.
 * - Flags probable duplicate episodes for user review.
 */

import { readdir, stat } from "node:fs/promises";
import { extname, basename, join, resolve } from "node:path";
import { parseEpisode, type ParsedEpisode } from "./episodeParser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScannedFile {
  /** Absolute path */
  path: string;
  /** Absolute path of the parent directory */
  parentDir: string;
  sizeBytes: number;
  mtimeMs: number;
  episode: ParsedEpisode | null;
}

export interface ScanOptions {
  /** Follow symlinks during traversal. Default: false (never follow). */
  followSymlinks?: boolean;
  /** Additional directory names to ignore (exact match, case-insensitive). */
  extraIgnoreDirs?: string[];
  /** Not yet used in M1 — reserved for glob filtering in M2. */
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface DuplicateGroup {
  /** Key identifying the duplicates: "<show>:<season>:<episode>" */
  key: string;
  files: ScannedFile[];
}

export interface ScanResult {
  files: ScannedFile[];
  /** Groups of files that appear to be the same episode. */
  duplicates: DuplicateGroup[];
  /** Number of directories that were skipped due to ignore rules. */
  ignoredCount: number;
  /** Number of symlinks encountered (and skipped). */
  symlinkCount: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Accepted video file extensions (lower-case). */
const VIDEO_EXTENSIONS = new Set([".mkv", ".mp4", ".m4v", ".avi", ".mov", ".ts", ".webm", ".wmv"]);

/**
 * Directory names that are always ignored (case-insensitive exact match).
 * Users can add extras via ScanOptions.extraIgnoreDirs.
 */
const DEFAULT_IGNORE_DIRS = new Set([
  "prestron-encoded",
  "sample",
  "samples",
  "extras",
  "featurettes",
  "trailers",
  "behind the scenes",
  "deleted scenes",
  "interviews",
  "scenes",
  "shorts",
  "specials", // genre folder — not the same as a Special episode
]);

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

/**
 * Recursively scan `dir` for video files.
 * Symlinks are detected via lstat and skipped.
 */
export async function scanDirectory(dir: string, options?: ScanOptions): Promise<ScanResult> {
  const absDir = resolve(dir);
  const files: ScannedFile[] = [];
  let ignoredCount = 0;
  let symlinkCount = 0;

  const extraIgnore = new Set((options?.extraIgnoreDirs ?? []).map((d) => d.toLowerCase()));

  async function walk(currentDir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(currentDir, { withFileTypes: true });
    } catch {
      // Permission error or missing dir — skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);

      // Symlink check: use lstat to detect even when the entry looks like a file/dir
      if (entry.isSymbolicLink()) {
        symlinkCount++;
        continue;
      }

      if (entry.isDirectory()) {
        const nameLower = entry.name.toLowerCase();
        // Ignore hidden directories
        if (entry.name.startsWith(".")) {
          ignoredCount++;
          continue;
        }
        // Ignore default and extra ignore dirs
        if (DEFAULT_IGNORE_DIRS.has(nameLower) || extraIgnore.has(nameLower)) {
          ignoredCount++;
          continue;
        }
        await walk(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      const ext = extname(entry.name).toLowerCase();
      if (!VIDEO_EXTENSIONS.has(ext)) continue;

      let fileStat;
      try {
        fileStat = await stat(fullPath);
      } catch {
        continue;
      }

      const stem = basename(entry.name, ext);
      const parentDirName = basename(currentDir);
      const episode = parseEpisode(stem, parentDirName);

      files.push({
        path: fullPath,
        parentDir: currentDir,
        sizeBytes: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        episode,
      });
    }
  }

  await walk(absDir);

  // Sort files by path for deterministic output
  files.sort((a, b) => a.path.localeCompare(b.path));

  const duplicates = findDuplicates(files);

  return { files, duplicates, ignoredCount, symlinkCount };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

function findDuplicates(files: ScannedFile[]): DuplicateGroup[] {
  const groups = new Map<string, ScannedFile[]>();

  for (const file of files) {
    if (!file.episode) continue;
    const { show, season, episode } = file.episode;
    // Strip leading [Group] bracket tags so "[Group2] Show Name" and "Show Name" hash alike
    const normalizedShow = show
      .replace(/^\[[^\]]*\]\s*/g, "")
      .trim()
      .toLowerCase();
    // Only flag duplicates within the same parent directory tree segment
    // Key: normalized show + season + episode
    const key = `${normalizedShow}:${String(season)}:${String(episode)}`;
    const group = groups.get(key);
    if (group) {
      group.push(file);
    } else {
      groups.set(key, [file]);
    }
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [key, groupFiles] of groups) {
    if (groupFiles.length > 1) {
      duplicates.push({ key, files: groupFiles });
    }
  }
  return duplicates;
}
