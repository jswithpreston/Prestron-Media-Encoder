/**
 * Visual terminal string utilities using string-width.
 *
 * Ensures full-width characters (e.g. CJK glyphs, full-width colon '：', emoji)
 * align correctly into terminal columns without border or table misalignment.
 */

import stringWidth from "string-width";

/**
 * Get visual display width of a string in terminal cells.
 */
export function getDisplayWidth(str: string): number {
  return stringWidth(str);
}

/**
 * Truncate a string to a maximum visual display width, appending an ellipsis if truncated.
 * Handles full-width characters safely so truncation never splits multi-cell characters.
 */
export function truncateDisplay(str: string, maxWidth: number, ellipsis = "…"): number extends never ? never : string {
  if (maxWidth <= 0) return "";
  const ellipsisWidth = stringWidth(ellipsis);
  const totalWidth = stringWidth(str);

  if (totalWidth <= maxWidth) {
    return str;
  }

  if (maxWidth <= ellipsisWidth) {
    return ellipsis.slice(0, maxWidth);
  }

  const targetWidth = maxWidth - ellipsisWidth;
  let currentWidth = 0;
  let cutIndex = 0;

  for (const char of str) {
    const charWidth = stringWidth(char);
    if (currentWidth + charWidth > targetWidth) {
      break;
    }
    currentWidth += charWidth;
    cutIndex += char.length;
  }

  return str.slice(0, cutIndex) + ellipsis;
}

/**
 * Pad a string on the right with spaces until it reaches the specified visual display width.
 * If the string is already wider, it is returned as-is (or optionally truncated).
 */
export function padDisplayEnd(str: string, targetWidth: number): string {
  const width = stringWidth(str);
  if (width >= targetWidth) {
    return str;
  }
  return str + " ".repeat(targetWidth - width);
}

/**
 * Pad a string on the left with spaces until it reaches the specified visual display width.
 */
export function padDisplayStart(str: string, targetWidth: number): string {
  const width = stringWidth(str);
  if (width >= targetWidth) {
    return str;
  }
  return " ".repeat(targetWidth - width) + str;
}

/**
 * Fit a string into an exact column width: truncates with ellipsis if too wide,
 * or pads with spaces if shorter.
 */
export function fitDisplay(str: string, width: number, ellipsis = "…"): string {
  const truncated = truncateDisplay(str, width, ellipsis);
  return padDisplayEnd(truncated, width);
}
