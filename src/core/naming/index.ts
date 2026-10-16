/**
 * Naming module — pure function, no I/O.
 *
 * Builds output filenames from MediaInfo + parsed episode data using
 * configurable templates. Invalid filesystem characters are stripped/replaced.
 */

import type { MediaInfo } from "../probe/index.js";
import type { ParsedEpisode } from "../scanner/episodeParser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NamingContext {
  mediaInfo: MediaInfo;
  episode?: ParsedEpisode | null;
}

// ---------------------------------------------------------------------------
// Default templates
// ---------------------------------------------------------------------------

const SERIES_TEMPLATE = "{title} - S{season:02}E{episode:02} [{height}p].{ext}";
const MOVIE_TEMPLATE = "{title} ({year}) [{height}p] [{video_codec}].{ext}";

// ---------------------------------------------------------------------------
// Filesystem-safe character handling
// ---------------------------------------------------------------------------

/**
 * Strip characters that are invalid on Windows, macOS, or Linux filesystems.
 * Replaces each bad character with '-', collapses whitespace, trims, and
 * enforces a maximum of 200 UTF-8 bytes.
 */
export function sanitizeFilename(name: string): string {
  // Strip chars invalid on all common filesystems: / \ : * ? " < > |
  let safe = name.replace(/[/\\:*?"<>|]/g, "-");
  // Collapse multiple spaces/dashes introduced by replacements
  safe = safe.replace(/\s{2,}/g, " ").replace(/-{2,}/g, "-");
  safe = safe.trim();

  // Enforce 200 UTF-8 byte limit (slice on Buffer to avoid splitting multi-byte chars)
  const buf = Buffer.from(safe, "utf8");
  if (buf.byteLength > 200) {
    // Slice to 200 bytes, then decode — may strip a trailing partial char
    safe = buf.subarray(0, 200).toString("utf8").replace(/\ufffd$/, "").trim();
  }

  return safe;
}

// ---------------------------------------------------------------------------
// Template token substitution
// ---------------------------------------------------------------------------

/** Zero-pad a number to a given width. */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Extract a 4-digit year from MediaInfo tags. */
function extractYear(mediaInfo: MediaInfo): string {
  const tagYear =
    mediaInfo.tags["year"] ??
    mediaInfo.tags["YEAR"] ??
    mediaInfo.tags["date"] ??
    mediaInfo.tags["DATE"];
  if (tagYear) {
    const m = /(\d{4})/.exec(tagYear);
    if (m?.[1]) return m[1];
  }
  return "";
}

/**
 * Substitute all tokens in a template string.
 *
 * Available tokens:
 *   {title}       — show/movie title (sanitized)
 *   {year}        — 4-digit year from tags or ""
 *   {season}      — season number (supports :02 padding)
 *   {season:02}   — zero-padded season
 *   {episode}     — episode number (supports :02 padding)
 *   {episode:02}  — zero-padded episode
 *   {height}      — video height in pixels
 *   {width}       — video width in pixels
 *   {video_codec} — source video codec name
 *   {ext}         — always "mkv"
 */
function applyTemplate(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_match, key: string) => {
    // Handle padding format: {season:02}
    const colonIdx = key.indexOf(":");
    if (colonIdx !== -1) {
      const baseKey = key.slice(0, colonIdx);
      const fmtSpec = key.slice(colonIdx + 1);
      const value = tokens[baseKey] ?? "";
      // Only numeric zero-padding supported (e.g. "02")
      const widthMatch = /^0(\d+)$/.exec(fmtSpec);
      if (widthMatch?.[1]) {
        const width = parseInt(widthMatch[1], 10);
        const n = parseInt(value, 10);
        if (!isNaN(n)) return pad(n, width);
      }
      return value;
    }
    return tokens[key] ?? "";
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an output filename (without directory) from naming context.
 *
 * - Uses the series template when episode metadata is present (season + episode > 0).
 * - Falls back to the movie template otherwise.
 * - Falls back to the original stem if title is empty after sanitization.
 */
export function buildOutputName(ctx: NamingContext): string {
  const { mediaInfo, episode } = ctx;
  const { video } = mediaInfo;

  const hasEpisode =
    episode != null && episode.season > 0 && episode.episode > 0;

  // Determine title: prefer episode show name, then format tags
  let rawTitle = "";
  if (hasEpisode && episode != null) {
    rawTitle = episode.show;
  } else {
    rawTitle =
      mediaInfo.tags["title"] ??
      mediaInfo.tags["TITLE"] ??
      mediaInfo.tags["show"] ??
      mediaInfo.tags["SHOW"] ??
      "";
  }

  // Fall back to original stem (basename without extension) when title is empty
  if (!rawTitle.trim()) {
    const pathParts = mediaInfo.path.split(/[/\\]/);
    const filename = pathParts[pathParts.length - 1] ?? "";
    // Strip all known video extensions
    rawTitle = filename.replace(/\.(mkv|mp4|m4v|avi|mov|ts|webm|wmv)$/i, "");
  }

  const title = sanitizeFilename(rawTitle);

  const tokens: Record<string, string> = {
    title,
    year: extractYear(mediaInfo),
    season: hasEpisode && episode != null ? String(episode.season) : "1",
    episode: hasEpisode && episode != null ? String(episode.episode) : "1",
    height: String(video.height),
    width: String(video.width),
    video_codec: video.codec,
    ext: "mkv",
  };

  const template = hasEpisode ? SERIES_TEMPLATE : MOVIE_TEMPLATE;
  const rawName = applyTemplate(template, tokens);
  return sanitizeFilename(rawName);
}
