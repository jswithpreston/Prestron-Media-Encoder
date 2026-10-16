/**
 * FFmpeg capability detection.
 *
 * Parses `ffmpeg -version` and `ffmpeg -encoders` to determine:
 * - FFmpeg semver (major.minor.patch)
 * - Whether libx265 encoder is available
 * - Which fps passthrough flag to use (-fps_mode ≥5.1 vs -vsync <5.1)
 *
 * All detection is done through the injected ProcessRunner interface so
 * unit tests can provide fixture strings without spawning a real process.
 */

/** Minimum required FFmpeg version */
export const MIN_FFMPEG_MAJOR = 4;
export const MIN_FFMPEG_MINOR = 4;

/** The exit code for missing/incompatible FFmpeg */
export const EXIT_CODE_FFMPEG = 3;

export interface FfmpegVersion {
  major: number;
  minor: number;
  patch: number;
  /** Original version string from ffmpeg -version, e.g. "4.4.2" or "n6.1.1" */
  raw: string;
}

export type FpsModeFlag = "-fps_mode" | "-vsync";

export interface FfmpegCapabilities {
  version: FfmpegVersion;
  hasLibx265: boolean;
  /**
   * The flag to use for passthrough timestamp mode.
   * FFmpeg ≥ 5.1 uses -fps_mode; earlier versions use -vsync.
   */
  fpsModeFlag: FpsModeFlag;
  fpsModeValue: "passthrough";
}

/** Thin interface for running a process — injectable for tests */
export interface ProcessRunner {
  run(
    binary: string,
    args: string[],
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

/**
 * Parse a version string from `ffmpeg -version` output.
 *
 * Handles formats like:
 *   "ffmpeg version 4.4.2 Copyright..."
 *   "ffmpeg version n6.1.1-0+deb12u1 Copyright..."
 *   "ffmpeg version 7.0 Copyright..."
 *   "ffmpeg version N-112244-g8a2e02028c Copyright..."  (git snapshot — treated as latest)
 */
export function parseVersion(versionOutput: string): FfmpegVersion | null {
  // Match the first line: "ffmpeg version <version_string> ..."
  const match = /^ffmpeg version ([^\s]+)/m.exec(versionOutput);
  if (!match?.[1]) {
    return null;
  }

  const raw = match[1];

  // Git snapshot format: "N-<number>-g<hash>" — treat as current major version (7+)
  // These are development builds and always well above any minimum requirement.
  if (/^N-\d+-g[0-9a-f]+/i.test(raw)) {
    return { major: 99, minor: 0, patch: 0, raw };
  }

  // Strip leading non-numeric prefixes like "n", then extract major.minor.patch
  const numericMatch = /(\d+)\.(\d+)(?:\.(\d+))?/.exec(raw);
  if (!numericMatch) {
    return null;
  }

  const major = parseInt(numericMatch[1] ?? "0", 10);
  const minor = parseInt(numericMatch[2] ?? "0", 10);
  const patch = parseInt(numericMatch[3] ?? "0", 10);

  return { major, minor, patch, raw };
}

/**
 * Determine whether libx265 is listed in the encoders output.
 *
 * `ffmpeg -encoders` lines look like:
 *   " V....D libx265              libx265 H.265 / HEVC"
 */
export function detectLibx265(encodersOutput: string): boolean {
  return /^\s*V[^ ]* libx265\b/m.test(encodersOutput);
}

/**
 * Choose the fps passthrough flag based on the FFmpeg version.
 *
 * -fps_mode was introduced in FFmpeg 5.1.
 * Versions before 5.1 use the deprecated -vsync.
 */
export function chooseFpsModeFlag(version: FfmpegVersion): FpsModeFlag {
  if (version.major > 5) {
    return "-fps_mode";
  }
  if (version.major === 5 && version.minor >= 1) {
    return "-fps_mode";
  }
  return "-vsync";
}

/**
 * Detect FFmpeg capabilities by running ffmpeg.
 *
 * @throws {FfmpegNotFoundError} when ffmpeg binary cannot be found
 * @throws {FfmpegVersionError} when version is below minimum
 * @throws {FfmpegMissingLibx265Error} when libx265 encoder is not present
 */
export async function detectCapabilities(
  runner: ProcessRunner,
  ffmpegBinary = "ffmpeg",
): Promise<FfmpegCapabilities> {
  let versionOutput: string;
  let encodersOutput: string;

  try {
    const result = await runner.run(ffmpegBinary, ["-version"]);
    versionOutput = result.stdout || result.stderr;
  } catch (err) {
    throw new FfmpegNotFoundError(ffmpegBinary, err);
  }

  const version = parseVersion(versionOutput);
  if (!version) {
    throw new FfmpegVersionError(
      `Could not parse FFmpeg version from output:\n${versionOutput.slice(0, 200)}`,
    );
  }

  if (!isSupportedVersion(version)) {
    throw new FfmpegVersionError(
      `FFmpeg ${version.raw} is too old. Prestron requires FFmpeg >= ${String(MIN_FFMPEG_MAJOR)}.${String(MIN_FFMPEG_MINOR)}.\n\n` +
        installHints(),
    );
  }

  try {
    const result = await runner.run(ffmpegBinary, ["-encoders"]);
    encodersOutput = result.stdout || result.stderr;
  } catch (err) {
    throw new FfmpegNotFoundError(ffmpegBinary, err);
  }

  if (!detectLibx265(encodersOutput)) {
    throw new FfmpegMissingLibx265Error();
  }

  return {
    version,
    hasLibx265: true,
    fpsModeFlag: chooseFpsModeFlag(version),
    fpsModeValue: "passthrough",
  };
}

/** Returns true when the version meets the minimum requirement */
export function isSupportedVersion(version: FfmpegVersion): boolean {
  if (version.major > MIN_FFMPEG_MAJOR) return true;
  if (version.major === MIN_FFMPEG_MAJOR && version.minor >= MIN_FFMPEG_MINOR) return true;
  return false;
}

/** Install hints printed when ffmpeg is missing or incompatible */
export function installHints(): string {
  return [
    "Install FFmpeg with:",
    "  Linux:   sudo apt install ffmpeg",
    "  macOS:   brew install ffmpeg",
    "  Windows: winget install ffmpeg",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Typed error classes
// ---------------------------------------------------------------------------

export class FfmpegNotFoundError extends Error {
  readonly exitCode = EXIT_CODE_FFMPEG;
  constructor(binary: string, cause?: unknown) {
    super(`FFmpeg binary not found: "${binary}"\n\n${installHints()}`);
    this.name = "FfmpegNotFoundError";
    this.cause = cause;
  }
}

export class FfmpegVersionError extends Error {
  readonly exitCode = EXIT_CODE_FFMPEG;
  constructor(message: string) {
    super(message);
    this.name = "FfmpegVersionError";
  }
}

export class FfmpegMissingLibx265Error extends Error {
  readonly exitCode = EXIT_CODE_FFMPEG;
  constructor() {
    super(
      `FFmpeg is missing the libx265 encoder.\n` +
        `Prestron requires FFmpeg built with --enable-libx265.\n\n` +
        installHints(),
    );
    this.name = "FfmpegMissingLibx265Error";
  }
}
