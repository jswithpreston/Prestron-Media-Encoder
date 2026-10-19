/**
 * Low-level terminal control helpers.
 *
 * All writes go to process.stdout (the real terminal). These helpers are kept
 * separate from Ink so they can also be used in the signals.ts cleanup handler
 * (before Ink has mounted or after it has unmounted).
 *
 * SGR 1006 mouse mode reference:
 *   https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking
 */

// ---------------------------------------------------------------------------
// Mouse tracking control sequences (SGR 1006)
// ---------------------------------------------------------------------------

/** Enable mouse button events + movement + SGR encoding. */
const MOUSE_ENABLE =
  "\x1b[?1000h" + // button events
  "\x1b[?1002h" + // button + motion (button-tracking)
  "\x1b[?1006h"; // SGR encoding (coordinates beyond 223)

/** Disable all mouse tracking. Must be sent on every exit path. */
const MOUSE_DISABLE = "\x1b[?1006l" + "\x1b[?1002l" + "\x1b[?1000l";

// ---------------------------------------------------------------------------
// Cursor visibility
// ---------------------------------------------------------------------------

const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";

// ---------------------------------------------------------------------------
// Alternative screen buffer (used by some TUI apps; we don't use it here
// because Ink manages the alternate buffer itself if the user wants it)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Write raw bytes to stdout without buffering. */
function write(seq: string): void {
  process.stdout.write(seq);
}

export function enableMouse(): void {
  write(MOUSE_ENABLE);
}

export function disableMouse(): void {
  write(MOUSE_DISABLE);
}

export function hideCursor(): void {
  write(CURSOR_HIDE);
}

export function showCursor(): void {
  write(CURSOR_SHOW);
}

/**
 * Restore the terminal to a clean state.
 * Called on all exit paths (clean, signal, crash).
 */
export function restoreTerminal(): void {
  disableMouse();
  showCursor();
}
