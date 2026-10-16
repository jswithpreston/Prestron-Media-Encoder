import { describe, it, expect } from "vitest";
import { parseEpisode } from "../../../../src/core/scanner/episodeParser.js";

describe("parseEpisode — SxxExx pattern", () => {
  it("Show.Name.S01E05", () => {
    const r = parseEpisode("Show.Name.S01E05");
    expect(r).not.toBeNull();
    expect(r?.show).toBe("Show Name");
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(5);
  });

  it("Show.Name.S01E05.Title.1080p", () => {
    const r = parseEpisode("Show.Name.S01E05.Title.1080p");
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(5);
    expect(r?.show).toBe("Show Name");
  });

  it("Show Name - S02E10 - Episode Title", () => {
    const r = parseEpisode("Show Name - S02E10 - Episode Title");
    expect(r?.season).toBe(2);
    expect(r?.episode).toBe(10);
    expect(r?.show).toBe("Show Name");
  });

  it("Show_Name_S03E12", () => {
    const r = parseEpisode("Show_Name_S03E12");
    expect(r?.show).toBe("Show Name");
    expect(r?.season).toBe(3);
    expect(r?.episode).toBe(12);
  });

  it("multi-episode S01E01E02 uses first episode", () => {
    const r = parseEpisode("Show.S01E01E02");
    expect(r?.episode).toBe(1);
    expect(r?.season).toBe(1);
  });

  it("Show (2020) - S02E03", () => {
    const r = parseEpisode("Show (2020) - S02E03");
    expect(r?.season).toBe(2);
    expect(r?.episode).toBe(3);
  });
});

describe("parseEpisode — NxNN pattern", () => {
  it("Show Name - 1x05 - Title", () => {
    const r = parseEpisode("Show Name - 1x05 - Title");
    expect(r?.show).toBe("Show Name");
    expect(r?.season).toBe(1);
    expect(r?.episode).toBe(5);
  });

  it("Show.Name.2x12", () => {
    const r = parseEpisode("Show.Name.2x12");
    expect(r?.season).toBe(2);
    expect(r?.episode).toBe(12);
  });
});

describe("parseEpisode — anime bracket pattern", () => {
  it("[SubsPlease] Show Name - 07 [1080p]", () => {
    const r = parseEpisode("[SubsPlease] Show Name - 07 [1080p]");
    expect(r?.show).toBe("Show Name");
    expect(r?.episode).toBe(7);
    expect(r?.season).toBe(1);
  });

  it("[Group] Show Name - 07v2 [tag]", () => {
    const r = parseEpisode("[Group] Show Name - 07v2 [tag]");
    expect(r?.episode).toBe(7);
  });

  it("anime with parent Season dir uses parent season", () => {
    const r = parseEpisode("[Group] Show - 03 [720p]", "Season 2");
    expect(r?.season).toBe(2);
  });

  it("no bracket group — plain dash episode", () => {
    const r = parseEpisode("Show Name - 12 [BDRip]");
    expect(r?.episode).toBe(12);
  });
});

describe("parseEpisode — season folder inference", () => {
  it("Season 01 parent dir overrides default season", () => {
    const r = parseEpisode("[Group] Show - 05 [720p]", "Season 01");
    expect(r?.season).toBe(1);
  });

  it("S02 parent dir", () => {
    const r = parseEpisode("[Group] Show - 05 [720p]", "S02");
    expect(r?.season).toBe(2);
  });

  it("SxxExx pattern ignores parent dir season (pattern is authoritative)", () => {
    const r = parseEpisode("Show.S03E07", "Season 01");
    expect(r?.season).toBe(3);
  });
});

describe("parseEpisode — specials", () => {
  it("OVA in filename → isSpecial=true", () => {
    const r = parseEpisode("[Group] Show - OVA1 [1080p]");
    expect(r?.isSpecial).toBe(true);
  });

  it("Special in filename → isSpecial=true", () => {
    const r = parseEpisode("Show.S00E01.Special");
    expect(r?.isSpecial).toBe(true);
  });

  it("NCED in filename → isSpecial=true", () => {
    const r = parseEpisode("[Group] Show - NCED [1080p]");
    expect(r?.isSpecial).toBe(true);
  });

  it("regular episode → isSpecial=false", () => {
    const r = parseEpisode("Show.S01E01");
    expect(r?.isSpecial).toBe(false);
  });
});

describe("parseEpisode — no match", () => {
  it("plain movie filename returns null", () => {
    expect(parseEpisode("The.Dark.Knight.(2008).1080p")).toBeNull();
  });

  it("empty string returns null", () => {
    expect(parseEpisode("")).toBeNull();
  });
});
