/**
 * useMouse — SGR 1006 mouse reporting hook for Ink.
 *
 * Ink has no built-in mouse support. This hook:
 *   1. Enables terminal mouse reporting on mount (? 1000 + 1002 + SGR 1006).
 *   2. Parses raw stdin bytes for SGR mouse events.
 *   3. Calls the provided callback with each MouseEvent.
 *   4. Disables mouse reporting on unmount (or when disabled is true).
 *
 * SGR 1006 format:  \x1b [ < Pb ; Px ; Py M/m
 *   Pb = button code  (0=L, 1=M, 2=R, 32=motion, 64=wheel-up, 65=wheel-down)
 *   Px = column (1-based)
 *   Py = row    (1-based)
 *   M  = press, m = release
 *
 * NOTES:
 * - Mouse tracking must be GNOME Terminal / COSMIC Terminal / Alacritty / kitty compatible.
 * - Inside tmux: mouse passthrough works if `set -g mouse on` is in ~/.tmux.conf.
 * - Keyboard must always be the primary input — mouse is an enhancement.
 * - The hook does nothing when disabled=true (--no-mouse flag).
 */

import { useEffect } from "react";
import { enableMouse, disableMouse } from "../../platform/terminal.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MouseButton = "left" | "middle" | "right" | "wheelUp" | "wheelDown" | "motion";
export type MouseEventType = "press" | "release" | "motion";

export interface MouseEvent {
  button: MouseButton;
  type: MouseEventType;
  /** 1-based column */
  col: number;
  /** 1-based row */
  row: number;
}

// ---------------------------------------------------------------------------
// SGR parser
// ---------------------------------------------------------------------------

/** Parse a single SGR mouse sequence into a MouseEvent, or null if invalid. */
export function parseSgrMouseEvent(seq: string): MouseEvent | null {
  // Sequence: ESC [ < Pb ; Px ; Py M/m
  // eslint-disable-next-line no-control-regex
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(seq);
  if (!match) {
    return null;
  }

  const pb = parseInt(match[1] ?? "0", 10);
  const col = parseInt(match[2] ?? "1", 10);
  const row = parseInt(match[3] ?? "1", 10);
  const isRelease = match[4] === "m";

  const buttonCode = pb & 0b11; // low 2 bits
  const isMotion = (pb & 32) !== 0;
  const isWheel = (pb & 64) !== 0;

  let button: MouseButton;
  if (isWheel) {
    button = (pb & 1) === 0 ? "wheelUp" : "wheelDown";
  } else if (isMotion) {
    button = "motion";
  } else {
    button = buttonCode === 0 ? "left" : buttonCode === 1 ? "middle" : "right";
  }

  const type: MouseEventType = isRelease ? "release" : isMotion ? "motion" : "press";

  return { button, type, col, row };
}

/**
 * Extract all SGR mouse sequences from a raw stdin chunk.
 * Returns the parsed events (any non-mouse bytes are ignored for our purposes).
 */
function extractMouseEvents(chunk: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  // SGR mouse sequences start with ESC[< and end with M or m
  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[<\d+;\d+;\d+[Mm]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk)) !== null) {
    const evt = parseSgrMouseEvent(m[0]);
    if (evt) {
      events.push(evt);
    }
  }
  return events;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * React hook that enables SGR 1006 mouse reporting and calls `onMouse` for
 * each terminal mouse event.
 *
 * @param onMouse  - callback invoked for every parsed MouseEvent
 * @param disabled - when true, mouse reporting is left disabled (--no-mouse)
 */
export function useMouse(onMouse: (evt: MouseEvent) => void, disabled = false): void {
  useEffect(() => {
    if (disabled) {
      return;
    }

    // stdin must be in raw mode for mouse events to come through as bytes.
    // Ink sets raw mode itself, so we can rely on it being set.
    // We just need to enable mouse tracking and parse stdin.
    // If the terminal doesn't support mouse reporting, degrade gracefully
    // to keyboard-only input rather than crashing.
    try {
      enableMouse();
    } catch {
      // Mouse not supported — keyboard-only fallback
      return;
    }

    const handler = (data: Buffer | string) => {
      const chunk = typeof data === "string" ? data : data.toString("utf8");
      const events = extractMouseEvents(chunk);
      for (const evt of events) {
        onMouse(evt);
      }
    };

    process.stdin.on("data", handler);

    return () => {
      process.stdin.off("data", handler);
      disableMouse();
    };
  }, [disabled, onMouse]);
}
