/**
 * Media classifier — determines whether a file is a movie, series, or anime.
 *
 * Returns a confidence score and human-readable reasons for the classification.
 * Confidence < 0.6 → kind = 'unknown' (caller uses the conservative profile).
 *
 * Note: ffprobe cannot reliably distinguish anime from live-action video,
 * so classification relies entirely on filename patterns, directory names,
 * audio language, and subtitle codec style.
 *
 * Confidence capping: when signals for a different category are also present
 * (e.g., Japanese audio on a SxxExx-named file), the winning confidence is
 * penalised by 0.1 per opposing strong signal, so 1.0 is only reached when
 * no conflicting signals exist.
 */

import type { ParsedEpisode } from "../scanner/episodeParser.js";
import type { MediaInfo } from "../probe/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MediaKind = "movie" | "series" | "anime" | "unknown";

export interface ClassificationResult {
  kind: MediaKind;
  /** Normalised 0–1. Values below 0.6 produce kind='unknown'. */
  confidence: number;
  /** Human-readable explanation strings shown in the UI and --dry-run output.
   *  Contains only signals supporting the winning classification, plus notes
   *  about any conflicting signals that reduced confidence. */
  reasons: string[];
}

export interface ClassifierInput {
  filePath: string;
  parentDirName: string;
  grandparentDirName?: string | undefined;
  parsedEpisode: ParsedEpisode | null;
  /** Optional — only available after probing. */
  mediaInfo?: MediaInfo | undefined;
}

// ---------------------------------------------------------------------------
// Scoring constants
// ---------------------------------------------------------------------------

const ANIME_STRONG = 0.6; // bracket release group, jpn audio — alone sufficient
const ANIME_MEDIUM = 0.2; // ass/ssa subtitles, anime-style dir, no SxxExx
const SERIES_STRONG = 0.6; // SxxExx, 1x01 — alone sufficient
const SERIES_MEDIUM = 0.2; // Season N dir, short runtime — booster
const MOVIE_STRONG = 0.6; // no episode number + year in parens — alone sufficient
const MOVIE_MEDIUM = 0.2; // Movies/Films dir, long runtime, no season folder

/**
 * Penalty applied to the winner's confidence for each opposing *strong* signal
 * from a different category (e.g., Japanese audio when the file is series).
 * This keeps confidence below 1.0 whenever signals conflict.
 */
const CONFLICT_PENALTY = 0.1;

const CONFIDENCE_THRESHOLD = 0.6;

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

/**
 * Classify a media file.
 *
 * Signals are bucketed by category (anime / series / movie). The highest-scoring
 * category wins. reasons[] is then built exclusively from the winning category's
 * signals, with conflict notes appended when opposing strong signals are present.
 *
 * Anime beats series if it has the bracket signal OR a clear score gap (> 0.1).
 */
export function classify(input: ClassifierInput): ClassificationResult {
  // Per-category reason buckets — only the winner's bucket is returned.
  const animeReasons: string[] = [];
  const seriesReasons: string[] = [];
  const movieReasons: string[] = [];

  let animeScore = 0;
  let seriesScore = 0;
  let movieScore = 0;

  // Count of strong signals belonging to *each other* category (used for
  // conflict penalty on the winner).
  let animeStrongCount = 0;
  let seriesStrongCount = 0;
  let movieStrongCount = 0;

  const stem = input.filePath.split(/[/\\]/).pop() ?? "";
  const parentDir = input.parentDirName;
  const grandparentDir = input.grandparentDirName ?? "";
  const ep = input.parsedEpisode;
  const info = input.mediaInfo;

  let hasBracketGroup = false;

  // --- Anime signals ---

  // [Group] bracket at start of filename
  if (/^\[([^\]]+)\]/.test(stem)) {
    hasBracketGroup = true;
    const groupName = /^\[([^\]]+)\]/.exec(stem)?.[1] ?? "unknown";
    animeScore += ANIME_STRONG;
    animeStrongCount++;
    animeReasons.push(`Release group tag [${groupName}] detected`);
  }

  // Quality/source tags typical of anime fansubs
  if (/\[(720p|1080p|480p|BDRip|BluRay|WEBRip|HEVC|x265|x264)\]/i.test(stem)) {
    animeScore += ANIME_MEDIUM;
    animeReasons.push("Anime-style quality tags in filename");
  }

  // No SxxExx pattern but has episode-style numbering (dash + 2 digits)
  if (ep && !/[Ss]\d{1,2}[Ee]\d{1,4}/.test(stem) && !/\d{1,2}x\d{1,4}/.test(stem)) {
    animeScore += ANIME_MEDIUM;
    animeReasons.push("Anime-style episode numbering (no SxxExx pattern)");
  }

  // Japanese audio track — strong anime signal
  const hasJapaneseAudio = info?.audio.some((a) => a.language === "jpn" || a.language === "ja");
  if (hasJapaneseAudio) {
    animeScore += ANIME_STRONG;
    animeStrongCount++;
    animeReasons.push("Japanese audio track detected");
  }

  // ASS/SSA subtitles (common in anime fansubs)
  const hasAssSubtitles = info?.subtitles.some((s) => s.codec === "ass" || s.codec === "ssa");
  if (hasAssSubtitles) {
    animeScore += ANIME_MEDIUM;
    animeReasons.push("ASS/SSA subtitle track detected (common in anime)");
  }

  // Directory named 'anime' or 'animes'
  if (/^anime/i.test(parentDir) || /^anime/i.test(grandparentDir)) {
    animeScore += ANIME_MEDIUM;
    animeReasons.push(`Directory name suggests anime: "${parentDir}"`);
  }

  // --- Series signals ---

  // SxxExx pattern
  if (/[Ss]\d{1,2}[Ee]\d{1,4}/.test(stem)) {
    seriesScore += SERIES_STRONG;
    seriesStrongCount++;
    seriesReasons.push("SxxExx episode pattern in filename");
  }

  // 1x01 pattern
  if (/\d{1,2}x\d{1,4}/i.test(stem)) {
    seriesScore += SERIES_STRONG;
    seriesStrongCount++;
    seriesReasons.push("NxNN episode pattern in filename");
  }

  // Parent dir is 'Season N'
  if (/^(?:Season|Series)\s*\d{1,2}$/i.test(parentDir)) {
    seriesScore += SERIES_MEDIUM;
    seriesReasons.push(`Parent directory is a season folder: "${parentDir}"`);
  }

  // Any ancestor directory in the full path is a season folder
  const pathSegments = input.filePath.split(/[/\\]/);
  const hasSeasonAncestor = pathSegments.some((seg) =>
    /^(?:Season|Series)\s*\d{1,2}$/i.test(seg),
  );
  if (hasSeasonAncestor && !/^(?:Season|Series)\s*\d{1,2}$/i.test(parentDir)) {
    // Only count once — parent was already counted above if it matched
    seriesScore += SERIES_MEDIUM;
    seriesReasons.push("Season folder detected in file path");
  }

  // Short runtime (< 45 min) with episode number → likely episodic TV
  if (info && info.durationSecs > 0 && info.durationSecs < 45 * 60 && ep != null) {
    seriesScore += SERIES_MEDIUM;
    seriesReasons.push(
      `Short runtime (${String(Math.round(info.durationSecs / 60))} min) suggests episodic content`,
    );
  }

  // Grandparent is a show name with season folders below
  if (/^(?:Season|Series)\s*\d/i.test(parentDir) && grandparentDir.length > 0) {
    seriesScore += SERIES_MEDIUM;
    seriesReasons.push(`File is nested inside a season folder`);
  }

  // --- Movie signals ---

  // No episode number detected (only when parsedEpisode was explicitly provided as null —
  // meaning episode-parsing was attempted and found nothing; undefined means unknown)
  if (ep === null) {
    movieScore += MOVIE_STRONG;
    movieStrongCount++;
    movieReasons.push("No episode number detected in filename");
  }

  // Year in parentheses
  if (/\(\d{4}\)/.test(stem)) {
    movieScore += MOVIE_STRONG;
    movieStrongCount++;
    movieReasons.push("Year in parentheses detected — typical movie naming");
  }

  // Runtime ≥ 60 min with no episode number → likely a movie
  if (info && info.durationSecs >= 60 * 60 && ep === null) {
    movieScore += MOVIE_MEDIUM;
    movieReasons.push(
      `Long runtime (${String(Math.round(info.durationSecs / 60))} min) and no episode number`,
    );
  }

  // Directory named Movies or Films
  if (/^(?:movies?|films?)$/i.test(parentDir) || /^(?:movies?|films?)$/i.test(grandparentDir)) {
    movieScore += MOVIE_STRONG;
    movieStrongCount++;
    movieReasons.push(`Directory name suggests movies: "${parentDir}"`);
  }

  // No season folder in path
  if (
    !/^(?:Season|Series)\s*\d/i.test(parentDir) &&
    !/^(?:Season|Series)\s*\d/i.test(grandparentDir)
  ) {
    movieScore += MOVIE_MEDIUM;
    movieReasons.push("No season folder detected in path");
  }

  // --- Resolve winner ---

  // Clamp all scores to [0, 1]
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  animeScore = clamp(animeScore);
  seriesScore = clamp(seriesScore);
  movieScore = clamp(movieScore);

  let kind: MediaKind;
  let confidence: number;
  let winnerReasons: string[];

  // Track how many strong signals belong to *other* categories (conflict count).
  let conflictingStrongSignals: number;
  let conflictNotes: string[];

  if (animeScore >= seriesScore && animeScore >= movieScore) {
    // Anime beats series only if it has the bracket signal OR a clear gap
    if (hasBracketGroup || animeScore > seriesScore + 0.1) {
      kind = "anime";
      confidence = animeScore;
      winnerReasons = animeReasons;
      conflictingStrongSignals = seriesStrongCount + movieStrongCount;
      conflictNotes = buildConflictNotes("anime", seriesStrongCount, movieStrongCount);
    } else {
      // Tie-break: treat as series
      kind = "series";
      confidence = seriesScore;
      winnerReasons = seriesReasons;
      conflictingStrongSignals = animeStrongCount + movieStrongCount;
      conflictNotes = buildConflictNotes("series", animeStrongCount, movieStrongCount);
    }
  } else if (seriesScore >= movieScore) {
    kind = "series";
    confidence = seriesScore;
    winnerReasons = seriesReasons;
    conflictingStrongSignals = animeStrongCount + movieStrongCount;
    conflictNotes = buildConflictNotes("series", animeStrongCount, movieStrongCount);
  } else {
    kind = "movie";
    confidence = movieScore;
    winnerReasons = movieReasons;
    conflictingStrongSignals = animeStrongCount + seriesStrongCount;
    conflictNotes = buildConflictNotes("movie", animeStrongCount, seriesStrongCount);
  }

  // Apply conflict penalty: each opposing strong signal reduces winner confidence by
  // CONFLICT_PENALTY, preventing a score of 1.0 when signals genuinely conflict.
  if (conflictingStrongSignals > 0) {
    confidence = clamp(confidence - conflictingStrongSignals * CONFLICT_PENALTY);
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    kind = "unknown";
  }

  // reasons[] = winning signals + conflict notes (so the user can see why
  // confidence was reduced, without burying the winning rationale).
  const reasons = [...winnerReasons, ...conflictNotes];

  return { kind, confidence, reasons };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build human-readable notes about conflicting signals from other categories.
 * These are appended to reasons[] so the user understands the confidence cap.
 */
function buildConflictNotes(
  winner: MediaKind,
  ...oppsingCounts: number[]
): string[] {
  const total = oppsingCounts.reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  const penalty = total * CONFLICT_PENALTY;
  return [
    `Note: ${String(total)} conflicting signal(s) from other categories reduced ${winner} confidence by ${penalty.toFixed(1)}`,
  ];
}
