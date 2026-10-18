/**
 * Disk space checker.
 *
 * Uses Node's built-in `statfs` (available since Node 19) to query the
 * available bytes on the filesystem containing the output directory.
 *
 * Required space = sourceBytes × 1.1 (10% headroom for muxer overhead and
 * temporary growth before the .part file is verified and promoted).
 */

import { statfs, mkdir } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiskSpaceResult {
  /** True when there is enough free space to proceed. */
  available: boolean;
  /** Usable free bytes on the target filesystem. */
  freeBytes: number;
  /** Minimum bytes required (sourceBytes × 1.1). */
  requiredBytes: number;
  /** Human-readable message suitable for showing to the user. */
  message: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether the output directory has enough free space to encode a file.
 *
 * Creates the output directory if it does not already exist (so statfs has
 * a real path to query).
 *
 * @param outputDir   The directory where the encoded .part file will be written.
 * @param sourceBytes The source file size in bytes.
 */
export async function checkDiskSpace(
  outputDir: string,
  sourceBytes: number,
): Promise<DiskSpaceResult> {
  // Ensure the output directory exists before calling statfs on it
  await mkdir(outputDir, { recursive: true });

  const requiredBytes = Math.ceil(sourceBytes * 1.1);

  let freeBytes: number;
  try {
    const fs = await statfs(outputDir);
    // bavail = blocks available to unprivileged users; bsize = block size
    freeBytes = fs.bavail * fs.bsize;
  } catch (err) {
    // statfs failed (e.g. unusual filesystem) — assume sufficient space with a warning
    const message =
      `Warning: could not determine free disk space for "${outputDir}": ` +
      (err instanceof Error ? err.message : String(err));
    return {
      available: true,
      freeBytes: 0,
      requiredBytes,
      message,
    };
  }

  const available = freeBytes >= requiredBytes;

  const message = available
    ? `Disk space OK: ${formatBytes(freeBytes)} free, ${formatBytes(requiredBytes)} required`
    : `Insufficient disk space: ${formatBytes(requiredBytes)} required, ${formatBytes(freeBytes)} free in "${outputDir}"`;

  return { available, freeBytes, requiredBytes, message };
}
