/**
 * Prestron Media Encoder — entry point.
 *
 * IMPORTANT: suppressSqliteExperimentalWarning() is called synchronously
 * as the very first statement so it is in place before any dynamic import
 * of node:sqlite (which happens lazily when the CLI commands touch the DB).
 */

// Must be first — before any import that might trigger node:sqlite
import { suppressSqliteExperimentalWarning } from "../platform/suppressExperimentalWarning.js";
suppressSqliteExperimentalWarning();

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { execa } from "execa";

import { registerSignalHandlers } from "../platform/signals.js";
import { detectCapabilities as detectTerminal } from "../platform/capabilities.js";
import {
  detectCapabilities as detectFfmpeg,
  FfmpegNotFoundError,
  FfmpegVersionError,
  FfmpegMissingLibx265Error,
  EXIT_CODE_FFMPEG,
  type ProcessRunner,
} from "../core/ffmpeg/capabilities.js";
import {
  makeScanCommand,
  makeAnalyzeCommand,
  makeEncodeCommand,
  makeResumeCommand,
} from "../cli/index.js";

registerSignalHandlers();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getVersion(): Promise<string> {
  try {
    const pkgPath = join(__dirname, "../../package.json");
    const raw = await readFile(pkgPath, "utf8");
    const pkg = JSON.parse(raw) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const execaRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: command not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const version = await getVersion();

  // Handle --version / -v before anything else
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`prestron-media-encoder v${version}`);
    process.exit(0);
  }

  // Resolve ffmpeg binary (env var or flag)
  const ffmpegFlagIdx = args.indexOf("--ffmpeg-path");
  const ffmpegPath =
    process.env["PRESTRON_FFMPEG"] ??
    (ffmpegFlagIdx !== -1 ? args[ffmpegFlagIdx + 1] : undefined) ??
    "ffmpeg";

  // Determine whether we're running a sub-command or interactive mode
  const subCommands = ["scan", "analyze", "encode", "verify", "resume", "report", "profiles"];
  const hasSubCommand = args.some((a) => subCommands.includes(a));
  const terminal = detectTerminal();

  if (
    !hasSubCommand &&
    terminal.isStdoutTty &&
    !args.includes("--yes") &&
    !args.includes("--json")
  ) {
    // Interactive mode — check FFmpeg first
    try {
      await detectFfmpeg(execaRunner, ffmpegPath);
    } catch (err) {
      if (
        err instanceof FfmpegNotFoundError ||
        err instanceof FfmpegVersionError ||
        err instanceof FfmpegMissingLibx265Error
      ) {
        console.error(err.message);
        process.exit(EXIT_CODE_FFMPEG);
      }
      throw err;
    }
    // Interactive UI placeholder — implemented in M4
    console.log(`Prestron Media Encoder v${version} — interactive mode coming in M4.`);
    console.log(`Run with a sub-command for non-interactive use, e.g.: prestron --help`);
    process.exit(0);
  }

  // Non-interactive / sub-command mode — wire up commander
  const program = new Command("prestron")
    .version(version)
    .description("Batch-encode movies, TV series and anime to HEVC using FFmpeg")
    .addCommand(makeScanCommand())
    .addCommand(makeAnalyzeCommand())
    .addCommand(makeEncodeCommand())
    .addCommand(makeResumeCommand());

  // Parse — commander handles --help automatically
  await program.parseAsync(process.argv);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("[prestron] Fatal:", msg);
  process.exit(1);
});
