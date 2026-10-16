/**
 * Terminal capability detection.
 *
 * Detects: TTY, UTF-8 locale, color support, terminal width.
 * All detection reads from the provided source object so it is fully testable
 * without a real terminal.
 */

export interface TerminalCapabilities {
  /** stdout is a real TTY (not piped/redirected) */
  isStdoutTty: boolean;
  /** stdin is a real TTY */
  isStdinTty: boolean;
  /** UTF-8 locale detected — safe to use box-drawing chars and the banner */
  isUtf8: boolean;
  /** Color output supported — respect NO_COLOR / FORCE_COLOR / TERM=dumb */
  hasColor: boolean;
  /** Terminal column count (width). Defaults to 80 when not a TTY. */
  columns: number;
  /** Terminal row count (height). Defaults to 24 when not a TTY. */
  rows: number;
}

export interface CapabilitiesSource {
  env: Record<string, string | undefined>;
  stdoutIsTty: boolean;
  stdinIsTty: boolean;
  stdoutColumns: number | undefined;
  stdoutRows: number | undefined;
}

/**
 * Build a CapabilitiesSource from the real process environment.
 * Extracted so the caller can see what is being read.
 */
function fromProcess(): CapabilitiesSource {
  // process.stdout.isTTY is `boolean` on the tty.WriteStream subtype that Node
  // attaches to process.stdout at runtime (fd:1 is always a WriteStream).
  // We access it directly — no cast needed.
  return {
    env: process.env,
    stdoutIsTty: process.stdout.isTTY,
    stdinIsTty: process.stdin.isTTY,
    stdoutColumns: process.stdout.columns,
    stdoutRows: process.stdout.rows,
  };
}

/**
 * Detect terminal capabilities.
 *
 * @param source - injectable source for testability; defaults to the real process
 */
export function detectCapabilities(source?: Partial<CapabilitiesSource>): TerminalCapabilities {
  const defaults = fromProcess();

  const env = source?.env ?? defaults.env;
  const stdoutIsTty = source?.stdoutIsTty ?? defaults.stdoutIsTty;
  const stdinIsTty = source?.stdinIsTty ?? defaults.stdinIsTty;
  const rawColumns = source?.stdoutColumns ?? defaults.stdoutColumns;
  const rawRows = source?.stdoutRows ?? defaults.stdoutRows;

  const isUtf8 = detectUtf8(env);
  const hasColor = detectColor(env, stdoutIsTty);
  // When not a TTY, default to 80x24 (safe for plain text output)
  const columns = stdoutIsTty ? (rawColumns ?? 80) : 80;
  const rows = stdoutIsTty ? (rawRows ?? 24) : 24;

  return {
    isStdoutTty: stdoutIsTty,
    isStdinTty: stdinIsTty,
    isUtf8,
    hasColor,
    columns,
    rows,
  };
}

/**
 * Detect UTF-8 locale from environment variables.
 *
 * Checks LC_ALL, LC_CTYPE, and LANG in order of precedence.
 * If a variable is set, it is authoritative — a non-UTF-8 value stops the search.
 * Returns true only if the first-set variable in precedence order contains UTF-8/utf8.
 */
function detectUtf8(env: Record<string, string | undefined>): boolean {
  const candidates = [env["LC_ALL"], env["LC_CTYPE"], env["LANG"]];
  for (const val of candidates) {
    if (val === undefined) {
      // Variable not set — try next in precedence order
      continue;
    }
    // Variable is set — it is authoritative; return based on its value
    return /utf-?8/i.test(val);
  }
  return false;
}

/**
 * Detect color support.
 *
 * Rules (in precedence order):
 * 1. NO_COLOR env var set (any value) → no color.
 * 2. TERM=dumb → no color.
 * 3. FORCE_COLOR env var set: "0" or "false" → no color; anything else → color.
 * 4. Not a TTY → no color (pipes don't need ANSI codes).
 * 5. COLORTERM=truecolor/24bit/256color → color.
 * 6. TERM contains "color" or "256" → color.
 * 7. Default: true if TTY.
 */
function detectColor(env: Record<string, string | undefined>, isTty: boolean): boolean {
  if (env["NO_COLOR"] !== undefined) {
    return false;
  }

  if (env["TERM"] === "dumb") {
    return false;
  }

  const forceColor = env["FORCE_COLOR"];
  if (forceColor !== undefined) {
    return forceColor !== "0" && forceColor !== "false";
  }

  if (!isTty) {
    return false;
  }

  const colorterm = env["COLORTERM"];
  if (colorterm === "truecolor" || colorterm === "24bit" || colorterm === "256color") {
    return true;
  }

  const term = env["TERM"] ?? "";
  if (/color|256/.test(term)) {
    return true;
  }

  // Default: trust the TTY
  return true;
}
