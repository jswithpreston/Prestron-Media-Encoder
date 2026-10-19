/**
 * `prestron report [path]` — show or export batch report.
 *
 * Reads the journal for the given root directory and prints the results.
 * Supports --format json|csv|text (default: text), --output <file> to write to file.
 */
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openJournalStore } from "../core/jobs/journalDb.js";
import {
  buildReportForRoot,
  formatReportText,
  formatReportJson,
  formatReportCsv,
} from "../core/report/index.js";

export function makeReportCommand(): Command {
  return new Command("report")
    .argument("[path]", "Directory to report on", ".")
    .description("Show or export the batch encoding report")
    .option("--format <format>", "Output format: text, json, csv", "text")
    .option("--output <file>", "Write report to file instead of stdout")
    .option("--db <path>", "Custom journal DB path")
    .action(async (pathArg: string, options: { format?: string; output?: string; db?: string }) => {
      const rootPath = resolve(pathArg);
      const store = openJournalStore(options.db);

      try {
        const report = buildReportForRoot(store, rootPath);

        if (!report) {
          console.error(`No batch found for: ${rootPath}`);
          console.error("Run `prestron encode` first to create a batch.");
          process.exit(1);
        }

        const format = options.format ?? "text";
        let output: string;

        if (format === "json") {
          output = formatReportJson(report);
        } else if (format === "csv") {
          output = formatReportCsv(report);
        } else {
          output = formatReportText(report);
        }

        if (options.output) {
          await writeFile(options.output, output, "utf8");
          console.log(`Report written to: ${options.output}`);
        } else {
          process.stdout.write(output + "\n");
        }
      } finally {
        store.close();
      }
    });
}
