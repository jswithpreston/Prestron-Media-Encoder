/**
 * Episode / season metadata parser.
 *
 * Extracts show name, season number, episode number, and special flags
 * from video file stems and parent directory names.
 *
 * Handles:
 *   - SxxExx  (Show.Name.S01E05.Title)
 *   - 1x01    (Show Name - 1x05 - Title)
 *   - Anime   ([Group] Show Name - 07 [tag])
 *   - Multi-episode S01E01E02 / S01E01-E02
 *   - Season folder inference (Season 01, S01)
 *   - Specials / OVA / NCED / NCOP / SP markers
 *   - Absolute numbering (ep > 99 with no season pattern)
 */

export interface ParsedEpisode {
  /** Normalized show name (spaces, not dots/underscores). */
  show: string;
  /** Season number (1-based; defaults to 1 when not detectable). */
  season: number;
  /** Episode number (1-based). */
  episode: number;
  /** Episode title, if present in the filename. */
  episodeTitle?: string;
  /** True for OVA / Special / NCED / NCOP / SP content. */
  isSpecial: boolean;
  /** The original filename stem passed in. */
  raw: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a raw show-name token: replace dots/underscores with spaces, collapse runs. */
function normalizeShowName(raw: string): string {
  return raw
    .replace(/[._]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Parse a fraction string like "24000/1001" → number. Returns NaN on failure. */
function parseFraction(s: string): number {
  const parts = s.split("/");
  const num = parseFloat(parts[0] ?? "");
  const den = parseFloat(parts[1] ?? "1");
  if (isNaN(num) || isNaN(den) || den === 0) return NaN;
  return num / den;
}
// exported for probe module reuse
export { parseFraction };

/** Detect special/OVA markers in a string. */
function detectSpecial(text: string): boolean {
  return /\b(OVA|OAD|ONA|Special|Specials|NCED|NCOP|SP\b|\bExtra)/i.test(text);
}

/** Try to extract a season number from a parent directory name like "Season 1", "S01". */
function seasonFromDir(dirName: string): number | null {
  const m1 = /^(?:Season|Series)\s*(\d{1,2})$/i.exec(dirName.trim());
  if (m1?.[1]) return parseInt(m1[1], 10);
  const m2 = /^S(\d{1,2})$/i.exec(dirName.trim());
  if (m2?.[1]) return parseInt(m2[1], 10);
  return null;
}

// ---------------------------------------------------------------------------
// Pattern matchers (in priority order)
// ---------------------------------------------------------------------------

interface EpMatch {
  show: string;
  season: number;
  episode: number;
  episodeTitle?: string | undefined;
}

/** SxxExx[Exx] pattern — "Show.Name.S01E05.Title" or "Show Name S01E01E02" */
function matchSxxExx(stem: string): EpMatch | null {
  const re = /^(.*?)[.\s_-]+[Ss](\d{1,2})[Ee](\d{1,4})(?:[Ee]\d{1,4})?(?:[.\s_-]+(.+))?$/;
  const m = re.exec(stem);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const rawTitle = m[4] ? normalizeShowName(m[4].replace(/\[.*?\]/g, "").trim()) : undefined;
  const episodeTitle = rawTitle && rawTitle.length > 0 ? rawTitle : undefined;
  return {
    show: normalizeShowName(m[1]),
    season: parseInt(m[2], 10),
    episode: parseInt(m[3], 10),
    ...(episodeTitle !== undefined ? { episodeTitle } : {}),
  };
}

/** NxNN pattern — "Show Name - 1x05 - Title" */
function matchNxNN(stem: string): EpMatch | null {
  const re = /^(.*?)\s*-?\s*(\d{1,2})x(\d{1,4})\s*(?:-\s*(.+))?$/i;
  const m = re.exec(stem);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const rawTitle = m[4] ? normalizeShowName(m[4].replace(/\[.*?\]/g, "").trim()) : undefined;
  const episodeTitle = rawTitle && rawTitle.length > 0 ? rawTitle : undefined;
  return {
    show: normalizeShowName(m[1]),
    season: parseInt(m[2], 10),
    episode: parseInt(m[3], 10),
    ...(episodeTitle !== undefined ? { episodeTitle } : {}),
  };
}

/**
 * Anime bracket pattern — "[Group] Show Name - 07 [tag]" or "[Group] Show Name - 07v2 [tag]"
 * Also handles no-group: "Show Name - 07 [1080p]"
 */
function matchAnimeBracket(stem: string, parentDirSeason: number | null): EpMatch | null {
  // Strip leading [Group] tag
  const stripped = stem.replace(/^\[[^\]]*\]\s*/, "");
  // Match: show - episode[v#] [tags...]
  const re = /^(.*?)\s+-\s+(\d{1,4})(?:v\d)?\s*(?:\[.*\])?$/i;
  const m = re.exec(stripped);
  if (!m?.[1] || !m[2]) return null;
  const ep = parseInt(m[2], 10);
  // If episode > 99 and no season detected, treat as absolute numbering (season=1)
  const season = parentDirSeason ?? 1;
  return {
    show: normalizeShowName(m[1]),
    season,
    episode: ep,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse episode information from a filename stem.
 *
 * @param stem - filename without extension
 * @param parentDirName - immediate parent directory name (used for season inference)
 * @returns ParsedEpisode or null if no episode pattern is found
 */
export function parseEpisode(stem: string, parentDirName?: string): ParsedEpisode | null {
  const isSpecial = detectSpecial(stem);
  const parentSeason = parentDirName ? seasonFromDir(parentDirName) : null;

  // Try patterns in priority order
  const match = matchSxxExx(stem) ?? matchNxNN(stem) ?? matchAnimeBracket(stem, parentSeason);

  // Special-only fallback: files like "[Group] Show - OVA1 [tag]" or "[Group] Show - NCED [tag]"
  // have no numeric episode number but are clearly valid content with isSpecial=true.
  // Extract a show name from the stem and return episode=0 so callers can handle them.
  if (!match) {
    if (!isSpecial) return null;
    // Strip leading [Group] tag and trailing [tags]
    const stripped = stem.replace(/^\[[^\]]*\]\s*/, "").replace(/\s*\[.*\]$/, "");
    // Remove special marker token (OVA1, NCED, etc.) from the end
    const showPart = stripped
      .replace(/\s*[-—]\s*(OVA\d*|OAD|ONA|NCED|NCOP|SP|Specials?|Extra)[^-]*/i, "")
      .trim();
    return {
      show: normalizeShowName(showPart || stripped),
      season: 0,
      episode: 0,
      isSpecial: true,
      raw: stem,
    };
  }

  // If parent dir gives a season and match defaulted to season 1 (anime), prefer parent
  const season =
    parentSeason !== null && match.season === 1 && !matchSxxExx(stem) && !matchNxNN(stem)
      ? parentSeason
      : match.season;

  return {
    show: match.show,
    season,
    episode: match.episode,
    ...(match.episodeTitle !== undefined ? { episodeTitle: match.episodeTitle } : {}),
    isSpecial,
    raw: stem,
  };
}
