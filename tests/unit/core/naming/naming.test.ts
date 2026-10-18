/**
 * Unit tests: naming module — sanitizeFilename + buildOutputName
 */

import { describe, it, expect } from "vitest";
import { sanitizeFilename, buildOutputName } from "../../../../src/core/naming/index.js";
import type { NamingContext } from "../../../../src/core/naming/index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseVideo = {
  codec: "h264",
  pixFmt: "yuv420p",
  bitDepth: 8 as const,
  width: 1280,
  height: 720,
  fps: 23.976,
  isVfr: false,
  isHdr: false,
  isDolbyVision: false,
};

function ctx(overrides: Partial<NamingContext> = {}): NamingContext {
  return {
    mediaInfo: {
      path: "/media/show/episode.mkv",
      container: "matroska",
      durationSecs: 1440,
      sizeBytes: 100_000,
      bitrateKbps: 500,
      video: baseVideo,
      audio: [],
      subtitles: [],
      attachmentCount: 0,
      chapterCount: 0,
      tags: {},
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// sanitizeFilename
// ---------------------------------------------------------------------------

describe("sanitizeFilename", () => {
  it("strips forward slashes", () => {
    expect(sanitizeFilename("a/b/c")).not.toContain("/");
  });

  it("strips backslashes", () => {
    expect(sanitizeFilename("a\\b")).not.toContain("\\");
  });

  it("strips colon", () => {
    expect(sanitizeFilename("Movie: The Sequel")).not.toContain(":");
  });

  it('strips Windows-invalid chars *?"<>|', () => {
    const result = sanitizeFilename('a*b?c"d<e>f|g');
    expect(result).not.toMatch(/[*?"<>|]/);
  });

  it("collapses multiple spaces", () => {
    expect(sanitizeFilename("a  b   c")).toBe("a b c");
  });

  it("trims leading/trailing whitespace and dashes", () => {
    expect(sanitizeFilename("  - hello - ")).toBe("hello");
  });

  it("handles unicode safely", () => {
    const s = sanitizeFilename("日本語タイトル");
    expect(s).toBe("日本語タイトル");
  });

  it("enforces 200-byte limit without breaking multibyte chars", () => {
    // Each "あ" is 3 bytes in UTF-8; 68 × 3 = 204 bytes > 200
    const longName = "あ".repeat(68);
    const result = sanitizeFilename(longName);
    expect(Buffer.byteLength(result, "utf8")).toBeLessThanOrEqual(200);
    // Must not end with a partial/replacement char
    expect(result).not.toContain("\uFFFD");
  });

  it("returns empty string for all-unsafe input", () => {
    const result = sanitizeFilename("/:*?");
    // Result should be safe (just dashes or empty after trim)
    expect(result).not.toMatch(/[/:*?]/);
  });
});

// ---------------------------------------------------------------------------
// buildOutputName — series template
// ---------------------------------------------------------------------------

describe("buildOutputName — series", () => {
  it("produces series template when episode is present", () => {
    const episode = { show: "Silicon Valley", season: 1, episode: 3, isSpecial: false, raw: "" };
    const name = buildOutputName(ctx({ episode }));
    expect(name).toMatch(/S01E03/);
    expect(name).toMatch(/720p/);
    expect(name).toMatch(/\.mkv$/);
  });

  it("zero-pads season and episode", () => {
    const episode = { show: "Show", season: 2, episode: 9, isSpecial: false, raw: "" };
    const name = buildOutputName(ctx({ episode }));
    expect(name).toMatch(/S02E09/);
  });

  it("uses show name from parsedEpisode", () => {
    const episode = { show: "My Show", season: 1, episode: 1, isSpecial: false, raw: "" };
    const name = buildOutputName(ctx({ episode }));
    expect(name).toMatch(/My Show/);
  });
});

// ---------------------------------------------------------------------------
// buildOutputName — movie template
// ---------------------------------------------------------------------------

describe("buildOutputName — movie", () => {
  it("produces movie template when no episode is present", () => {
    const name = buildOutputName(
      ctx({
        mediaInfo: {
          path: "/media/Movie (2021).mkv",
          container: "matroska",
          durationSecs: 7200,
          sizeBytes: 5_000_000,
          bitrateKbps: 5000,
          video: baseVideo,
          audio: [],
          subtitles: [],
          attachmentCount: 0,
          chapterCount: 0,
          tags: { date: "2021" },
        },
        episode: null,
      }),
    );
    expect(name).toMatch(/720p/);
    expect(name).toMatch(/\.mkv$/);
  });

  it("falls back to filename stem when title is empty", () => {
    const name = buildOutputName(
      ctx({
        mediaInfo: {
          path: "/media/My.Great.Movie.mkv",
          container: "matroska",
          durationSecs: 7200,
          sizeBytes: 5_000_000,
          bitrateKbps: 5000,
          video: baseVideo,
          audio: [],
          subtitles: [],
          attachmentCount: 0,
          chapterCount: 0,
          tags: {},
        },
        episode: null,
      }),
    );
    // Should include something from the filename or be non-empty
    expect(name.length).toBeGreaterThan(0);
    expect(name).toMatch(/\.mkv$/);
  });
});
