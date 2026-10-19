/**
 * Per-folder instance lock.
 *
 * Prevents two Prestron instances from encoding the same folder simultaneously,
 * which could race on the same .part files and journal rows.
 *
 * The lock is a file in the XDG state directory, keyed by a hash of the resolved
 * root path. It is acquired with O_EXCL|O_CREAT (atomic — fails if already held)
 * and released on exit by deleting the file. A stale lock (holding PID no longer
 * alive) is automatically reclaimed.
 */

import {
  openSync,
  closeSync,
  unlinkSync,
  writeFileSync,
  readFileSync,
  constants,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { getXdgPathsEnsured } from "../../platform/xdg.js";

const LOCK_DIR_NAME = "locks";

/** Hash a root path to a short, filesystem-safe lock name. */
function rootPathHash(rootPath: string): string {
  return createHash("sha256").update(rootPath).digest("hex").slice(0, 16);
}

/** Check whether a PID is currently alive (signal 0 = existence check). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface InstanceLock {
  /** True when this instance holds the lock. */
  held: boolean;
  /** Release the lock (delete the lock file). No-op if not held. */
  release: () => void;
  /** Path of the lock file (for diagnostics). */
  lockPath: string;
}

/**
 * Try to acquire a per-folder instance lock.
 *
 * @param rootPath - The resolved root directory being encoded.
 * @returns An {@link InstanceLock}. If `held` is false, another instance is
 *          actively encoding this folder and the caller should abort.
 */
export function acquireInstanceLock(rootPath: string): InstanceLock {
  const xdg = getXdgPathsEnsured();
  const lockDir = join(xdg.log, LOCK_DIR_NAME);
  const lockFile = `${rootPathHash(rootPath)}.lock`;
  const lockPath = join(lockDir, lockFile);

  let held = false;
  let fd: number | null = null;

  try {
    // Atomic create: O_EXCL | O_CREAT fails if the file already exists.
    fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    // Write our PID so a stale lock can be diagnosed.
    try {
      writeFileSync(lockPath, String(process.pid), "utf8");
    } catch {
      /* best-effort */
    }
    held = true;
  } catch {
    // Lock exists — check if the holder is still alive.
    let holderPid: number | null = null;
    try {
      const content = readFileSync(lockPath, "utf8");
      const parsed = Number(content.trim());
      if (Number.isFinite(parsed)) holderPid = parsed;
    } catch {
      /* unreadable — treat as stale */
    }

    if (holderPid !== null && !isPidAlive(holderPid)) {
      // Stale lock: holder is dead. Reclaim it.
      try {
        unlinkSync(lockPath);
        fd = openSync(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
        held = true;
      } catch {
        // Race: another instance grabbed it between our check and create.
        held = false;
      }
    }
    // Otherwise: another instance is actively holding the lock.
  }

  const release = () => {
    if (!held) return;
    held = false;
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
      fd = null;
    }
    try {
      unlinkSync(lockPath);
    } catch {
      /* ignore */
    }
  };

  return { held, release, lockPath };
}
