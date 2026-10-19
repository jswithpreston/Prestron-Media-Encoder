/**
 * Public API surface for the Prestron core library.
 * UI-free; importable and testable without a terminal.
 */

export const CORE_VERSION = "0.1.0";

// Scanner
export { scanDirectory } from "./scanner/index.js";
export { parseEpisode } from "./scanner/episodeParser.js";
export type { ScannedFile, ScanResult, DuplicateGroup, ScanOptions } from "./scanner/index.js";
export type { ParsedEpisode } from "./scanner/episodeParser.js";

// Probe
export { probeFile, ProbeError } from "./probe/index.js";
export type {
  MediaInfo,
  VideoInfo,
  AudioInfo,
  SubtitleInfo,
  ChapterInfo,
  ProbeOptions,
} from "./probe/index.js";

// Classifier
export { classify } from "./classifier/index.js";
export type { ClassificationResult, MediaKind, ClassifierInput } from "./classifier/index.js";

// Policy & Profiles
export { buildPlan } from "./policy/planBuilder.js";
export { PROFILES, PRESETS } from "./policy/profiles.js";
export type { EncodePlan } from "./policy/planBuilder.js";
export type { Profile, ProfileName, Preset } from "./policy/profiles.js";

// FFmpeg
export { buildArgs } from "./ffmpeg/argBuilder.js";
export { runEncode } from "./ffmpeg/runner.js";
export { ProgressParser } from "./ffmpeg/progressParser.js";
export { detectCapabilities as detectFfmpegCapabilities } from "./ffmpeg/capabilities.js";
export { checkDiskSpace } from "./ffmpeg/diskSpace.js";
export type { FfmpegCapabilities } from "./ffmpeg/capabilities.js";
export type { EncodeProgress } from "./ffmpeg/progressParser.js";

// Jobs & Journal
export { createSqliteJournalStore } from "./jobs/sqliteJournalStore.js";
export { openJournalStore, getJournalDbPath } from "./jobs/journalDb.js";
export { recoverFolder } from "./jobs/recovery.js";
export type { JournalStore, Batch, Job, JobState, BatchStatus } from "./jobs/journalStore.js";

// Verification
export { verifyOutput } from "./verify/index.js";
export type { VerifyResult, VerifyOptions } from "./verify/index.js";

// Naming
export { buildOutputName, sanitizeFilename } from "./naming/index.js";
export type { NamingContext } from "./naming/index.js";

// Report
export {
  buildReport,
  buildReportForRoot,
  formatReportText,
  formatReportJson,
  formatReportCsv,
} from "./report/index.js";
export type { BatchReport, BatchReportJob } from "./report/index.js";
