/**
 * `prestron resume [path]` — resume interrupted batch encoding from the journal.
 *
 * Runs startup recovery, picks up pending/interrupted jobs in the directory,
 * skips already finished outputs, and completes the batch.
 */

import { Command } from "commander";
import { makeEncodeCommand } from "./encode.js";

export function makeResumeCommand(): Command {
  return new Command("resume")
    .argument("[path]", "Directory to resume encoding", ".")
    .description("Resume interrupted batch encoding from the journal")
    .option("--verbose", "Show detailed verbose logs including full ffmpeg error output")
    .option("--ffmpeg-path <path>", "Override ffmpeg binary path", "ffmpeg")
    .option("--ffprobe-path <path>", "Override ffprobe binary path", "ffprobe")
    .action(async (pathArg: string, options: { verbose?: boolean; ffmpegPath?: string; ffprobePath?: string }) => {
      const encodeCmd = makeEncodeCommand();
      const argv = [
        "node",
        "encode",
        pathArg,
        "--yes",
        ...(options.verbose ? ["--verbose"] : []),
        ...(options.ffmpegPath ? ["--ffmpeg-path", options.ffmpegPath] : []),
        ...(options.ffprobePath ? ["--ffprobe-path", options.ffprobePath] : []),
      ];
      await encodeCmd.parseAsync(argv);
    });
}
