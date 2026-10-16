/**
 * `prestron scan [path]` — discover and list video files in a folder.
 */

import { Command } from "commander";
import { resolve } from "node:path";
import { scanDirectory } from "../core/scanner/index.js";

function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${String(bytes)} B`;
}

export function makeScanCommand(): Command {
  return new Command("scan")
    .argument("[path]", "Directory to scan", ".")
    .description("Scan a folder and list discovered video files")
    .action(async (pathArg: string) => {
      const dir = resolve(pathArg);
      const result = await scanDirectory(dir);

      if (result.files.length === 0) {
        console.log(`No video files found in: ${dir}`);
        return;
      }

      let totalBytes = 0;
      for (const file of result.files) {
        const ep = file.episode
          ? ` [S${String(file.episode.season).padStart(2, "0")}E${String(file.episode.episode).padStart(2, "0")}]`
          : "";
        console.log(`  ${file.path}${ep}  (${formatBytes(file.sizeBytes)})`);
        totalBytes += file.sizeBytes;
      }

      console.log("");
      console.log(
        `Found ${String(result.files.length)} file(s)  •  total ${formatBytes(totalBytes)}`,
      );

      if (result.duplicates.length > 0) {
        console.log(
          `\nWarning: ${String(result.duplicates.length)} probable duplicate episode group(s):`,
        );
        for (const dup of result.duplicates) {
          console.log(`  [${dup.key}]`);
          for (const f of dup.files) {
            console.log(`    ${f.path}`);
          }
        }
      }

      if (result.ignoredCount > 0) {
        console.log(
          `Ignored: ${String(result.ignoredCount)} ${result.ignoredCount === 1 ? "directory" : "directories"} (Prestron-Encoded, samples, etc.)`,
        );
      }
      if (result.symlinkCount > 0) {
        console.log(`Symlinks skipped: ${String(result.symlinkCount)}`);
      }
    });
}
