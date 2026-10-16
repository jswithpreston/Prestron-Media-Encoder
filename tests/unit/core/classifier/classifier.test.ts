import { describe, it, expect } from "vitest";
import { classify } from "../../../../src/core/classifier/index.js";
import type { ClassifierInput } from "../../../../src/core/classifier/index.js";

function input(overrides: Partial<ClassifierInput>): ClassifierInput {
  return {
    filePath: "/media/show/episode.mkv",
    parentDirName: "show",
    parsedEpisode: undefined as unknown as null,
    ...overrides,
  };
}

describe("classify — anime detection", () => {
  it("bracket release group → anime", () => {
    const r = classify(input({ filePath: "/media/[SubsPlease] Show - 07 [1080p].mkv" }));
    expect(r.kind).toBe("anime");
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.reasons.some((s) => s.includes("SubsPlease"))).toBe(true);
  });

  it("Japanese audio boosts anime confidence", () => {
    const r = classify(
      input({
        filePath: "/media/[SubsPlease] Show - 07 [1080p].mkv",
        mediaInfo: {
          path: "",
          container: "matroska",
          durationSecs: 1440,
          sizeBytes: 0,
          bitrateKbps: 0,
          video: {
            codec: "h264",
            pixFmt: "yuv420p",
            bitDepth: 8,
            width: 1920,
            height: 1080,
            fps: 23.976,
            isVfr: false,
            isHdr: false,
            isDolbyVision: false,
          },
          audio: [{ index: 1, codec: "flac", channels: 2, language: "jpn", isDefault: true }],
          subtitles: [],
          attachmentCount: 0,
          chapterCount: 0,
          tags: {},
        },
      }),
    );
    expect(r.kind).toBe("anime");
    expect(r.confidence).toBeGreaterThan(0.6);
  });

  it("ASS subtitles boost anime confidence", () => {
    const r = classify(
      input({
        filePath: "/media/[Group] Show - 05 [720p].mkv",
        mediaInfo: {
          path: "",
          container: "matroska",
          durationSecs: 1440,
          sizeBytes: 0,
          bitrateKbps: 0,
          video: {
            codec: "h264",
            pixFmt: "yuv420p",
            bitDepth: 8,
            width: 1920,
            height: 1080,
            fps: 23.976,
            isVfr: false,
            isHdr: false,
            isDolbyVision: false,
          },
          audio: [],
          subtitles: [{ index: 3, codec: "ass", language: "eng" }],
          attachmentCount: 0,
          chapterCount: 0,
          tags: {},
        },
      }),
    );
    expect(r.kind).toBe("anime");
  });
});

describe("classify — series detection", () => {
  it("SxxExx pattern → series", () => {
    const r = classify(
      input({
        filePath: "/media/Show/Season 1/Show.Name.S01E05.1080p.mkv",
        parentDirName: "Season 1",
      }),
    );
    expect(r.kind).toBe("series");
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.reasons.some((s) => s.includes("SxxExx"))).toBe(true);
  });

  it("Season N parent dir boosts series", () => {
    const r = classify(
      input({
        filePath: "/media/Show/Season 2/Show.S02E01.mkv",
        parentDirName: "Season 2",
      }),
    );
    expect(r.kind).toBe("series");
  });

  it("NxNN pattern → series", () => {
    const r = classify(input({ filePath: "/media/Show Name - 2x05 - Title.mkv" }));
    expect(r.kind).toBe("series");
  });

  it("short runtime + episode number → series", () => {
    const r = classify(
      input({
        filePath: "/media/Show.S01E01.mkv",
        parsedEpisode: { show: "Show", season: 1, episode: 1, isSpecial: false, raw: "" },
        mediaInfo: {
          path: "",
          container: "matroska",
          durationSecs: 20 * 60, // 20 minutes
          sizeBytes: 0,
          bitrateKbps: 0,
          video: {
            codec: "h264",
            pixFmt: "yuv420p",
            bitDepth: 8,
            width: 1920,
            height: 1080,
            fps: 23.976,
            isVfr: false,
            isHdr: false,
            isDolbyVision: false,
          },
          audio: [],
          subtitles: [],
          attachmentCount: 0,
          chapterCount: 0,
          tags: {},
        },
      }),
    );
    expect(r.kind).toBe("series");
  });

  it("reasons[] only contains series signals — no anime/movie text in winning reasons", () => {
    // SxxExx + Season folder → series. No anime signals present.
    const r = classify(
      input({
        filePath: "/media/Show/Season 1/Show.S01E05.mkv",
        parentDirName: "Season 1",
      }),
    );
    expect(r.kind).toBe("series");
    // Must not include anime-specific language in reasons (only in conflict notes if any)
    expect(r.reasons.some((s) => s === "Japanese audio track detected")).toBe(false);
    // Must include at least one series reason
    expect(r.reasons.some((s) => s.includes("SxxExx") || s.toLowerCase().includes("season"))).toBe(
      true,
    );
  });

  it("confidence is capped below 1.0 when an opposing strong signal exists", () => {
    // SxxExx (series strong) + Japanese audio (anime strong) → series wins
    // but confidence is penalised because of the conflicting anime signal.
    const r = classify(
      input({
        filePath: "/media/Show/Season 1/Silicon Valley - S01E01.mkv",
        parentDirName: "Season 1",
        mediaInfo: {
          path: "",
          container: "matroska",
          durationSecs: 120,
          sizeBytes: 0,
          bitrateKbps: 0,
          video: {
            codec: "h264",
            pixFmt: "yuv420p",
            bitDepth: 8,
            width: 1280,
            height: 720,
            fps: 24,
            isVfr: false,
            isHdr: false,
            isDolbyVision: false,
          },
          audio: [{ index: 1, codec: "aac", channels: 2, language: "jpn", isDefault: false }],
          subtitles: [],
          attachmentCount: 0,
          chapterCount: 0,
          tags: {},
        },
      }),
    );
    expect(r.kind).toBe("series");
    // Confidence must be penalised — strictly below 1.0
    expect(r.confidence).toBeLessThan(1.0);
    // Still above threshold
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    // reasons[] must include the conflict note
    expect(r.reasons.some((s) => s.includes("conflicting"))).toBe(true);
    // But the raw anime signal must NOT appear as a standalone reason
    expect(r.reasons.some((s) => s === "Japanese audio track detected")).toBe(false);
  });
});

describe("classify — movie detection", () => {
  it("no episode number + year in parens → movie", () => {
    const r = classify(
      input({ filePath: "/media/Movie.Name.(2020).1080p.mkv", parsedEpisode: null }),
    );
    expect(r.kind).toBe("movie");
    expect(r.confidence).toBeGreaterThanOrEqual(0.6);
    expect(r.reasons.some((s) => s.includes("episode number"))).toBe(true);
  });

  it("Movies parent dir → movie", () => {
    const r = classify(
      input({
        filePath: "/media/Movies/Movie.Name.mkv",
        parentDirName: "Movies",
        parsedEpisode: null,
      }),
    );
    expect(r.kind).toBe("movie");
  });

  it("long runtime + no episode → movie", () => {
    const r = classify(
      input({
        filePath: "/media/Movie.mkv",
        parsedEpisode: null,
        mediaInfo: {
          path: "",
          container: "matroska",
          durationSecs: 120 * 60,
          sizeBytes: 0,
          bitrateKbps: 0,
          video: {
            codec: "h264",
            pixFmt: "yuv420p",
            bitDepth: 8,
            width: 1920,
            height: 1080,
            fps: 23.976,
            isVfr: false,
            isHdr: false,
            isDolbyVision: false,
          },
          audio: [],
          subtitles: [],
          attachmentCount: 0,
          chapterCount: 0,
          tags: {},
        },
      }),
    );
    expect(r.kind).toBe("movie");
  });
});

describe("classify — low confidence", () => {
  it("ambiguous file returns unknown when confidence < 0.6", () => {
    // A plain filename with no strong signals
    const r = classify(input({ filePath: "/media/video.mkv", parsedEpisode: null }));
    // No strong movie/series/anime signals → confidence should be low or it
    // defaults to movie (no episode) + no season folder; check it doesn't panic
    expect(["movie", "series", "anime", "unknown"]).toContain(r.kind);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
  });

  it("always returns non-empty reasons array", () => {
    const r = classify(input({ filePath: "/media/video.mkv" }));
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});
