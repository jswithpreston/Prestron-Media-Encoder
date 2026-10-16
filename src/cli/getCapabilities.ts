/**
 * Lazily detects and caches FFmpeg capabilities for CLI commands.
 * Exits with code 3 if FFmpeg is missing or incompatible.
 */

import { execa } from "execa";
import {
  detectCapabilities,
  FfmpegNotFoundError,
  FfmpegVersionError,
  FfmpegMissingLibx265Error,
  EXIT_CODE_FFMPEG,
  type FfmpegCapabilities,
  type ProcessRunner,
} from "../core/ffmpeg/capabilities.js";

let cached: FfmpegCapabilities | null = null;

const execaRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: command not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

export async function getCapabilities(ffmpegPath = "ffmpeg"): Promise<FfmpegCapabilities> {
  if (cached) return cached;
  try {
    cached = await detectCapabilities(execaRunner, ffmpegPath);
    return cached;
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
}
