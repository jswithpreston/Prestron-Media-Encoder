/**
 * useTerminalSize — tracks terminal width/height and re-renders on SIGWINCH.
 *
 * Ink exposes useStdout() which provides the stdout stream, but does not
 * expose a reactive terminal-size hook. This hook listens to the Node
 * 'resize' event on process.stdout and re-renders when the terminal resizes.
 */

import { useState, useEffect } from "react";

export interface TerminalSize {
  columns: number;
  rows: number;
}

function getSize(): TerminalSize {
  // process.stdout.columns/rows are numbers when stdout is a TTY,
  // but may be undefined in test/pipe environments — use type assertion with fallback
  const cols = (process.stdout.columns as number | undefined) ?? 80;
  const rows = (process.stdout.rows as number | undefined) ?? 24;
  return { columns: cols, rows };
}

export function useTerminalSize(): TerminalSize {
  const [size, setSize] = useState<TerminalSize>(getSize);

  useEffect(() => {
    const handler = () => {
      setSize(getSize());
    };
    process.stdout.on("resize", handler);
    return () => {
      process.stdout.off("resize", handler);
    };
  }, []);

  return size;
}
