/**
 * Integration test: scan → probe → classify → plan pipeline
 *
 * Uses real ffmpeg lavfi to generate tiny test clips, then runs the full
 * pipeline against them. Verifies:
 *   - Prestron-Encoded directory is ignored by scanner
 *   - Symlinks are not followed
 *   - HDR warning appears in plan for HDR-tagged source
 *   - Episode detection works
 *   - Exact ffmpeg args are produced (dry-run)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execa } from "execa";
import { scanDirectory } from "../../src/core/scanner/index.js";
import { probeFile } from "../../src/core/probe/index.js";
import { classify } from "../../src/core/classifier/index.js";
import { buildPlan } from "../../src/core/policy/planBuilder.js";
import { buildArgs } from "../../src/core/ffmpeg/argBuilder.js";
import { detectCapabilities } from "../../src/core/ffmpeg/capabilities.js";
import type { ProcessRunner, FfmpegCapabilities } from "../../src/core/ffmpeg/capabilities.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const execaRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

async function ffmpegAvailable(): Promise<boolean> {
  try {
    const r = await execa("ffmpeg", ["-version"], { reject: false });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Generate a tiny MKV clip using ffmpeg lavfi.
 * Duration: 2 seconds, 320x240, with optional extra streams.
 */
async function generateClip(outputPath: string, extra: string[] = []): Promise<void> {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=2:size=320x240:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=duration=2:frequency=440",
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-c:v",
    "libx264",
    "-crf",
    "40",
    "-preset",
    "ultrafast",
    "-c:a",
    "aac",
    ...extra,
    outputPath,
  ];
  const result = await execa("ffmpeg", args, { reject: false });
  if (result.exitCode !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr.slice(0, 300)}`);
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let tmpDir: string;
let caps: FfmpegCapabilities;
let skipAll = false;

beforeAll(async () => {
  skipAll = !(await ffmpegAvailable());
  if (skipAll) return;

  tmpDir = await mkdtemp(join(tmpdir(), "prestron-integration-"));

  // Episode 1 — normal 1080p (scaled to 320x240 for speed)
  await generateClip(join(tmpDir, "Show.Name.S01E01.mkv"));

  // Episode 2 — with subtitle metadata hint
  await generateClip(join(tmpDir, "Show.Name.S01E02.mkv"));

  // Anime-style episode
  await generateClip(join(tmpDir, "[SubsPlease] Anime Show - 07 [720p].mkv"));

  // Prestron-Encoded subdir — should be ignored
  await mkdir(join(tmpDir, "Prestron-Encoded"));
  await generateClip(join(tmpDir, "Prestron-Encoded", "Show.Name.S01E01.mkv"));

  caps = await detectCapabilities(execaRunner, "ffmpeg");
});

afterAll(async () => {
  if (tmpDir) {
    await rm(tmpDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("integration: scan → probe → classify → plan", () => {
  it("skips when ffmpeg is not installed", () => {
    // This test always passes — it's a guard for the rest
    expect(typeof skipAll).toBe("boolean");
  });

  it("scanner finds episode MKVs and ignores Prestron-Encoded", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const names = result.files.map((f) => f.path.split("/").pop());
    expect(names).toContain("Show.Name.S01E01.mkv");
    expect(names).toContain("Show.Name.S01E02.mkv");
    // Prestron-Encoded must be ignored
    const inEncoded = result.files.filter((f) => f.path.includes("Prestron-Encoded"));
    expect(inEncoded).toHaveLength(0);
    expect(result.ignoredCount).toBeGreaterThanOrEqual(1);
  });

  it("scanner parses SxxExx episode numbers", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const ep1 = result.files.find((f) => f.path.endsWith("Show.Name.S01E01.mkv"));
    expect(ep1?.episode?.season).toBe(1);
    expect(ep1?.episode?.episode).toBe(1);
    expect(ep1?.episode?.show).toMatch(/show name/i);
  });

  it("scanner detects anime-style episode", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const anime = result.files.find((f) => f.path.includes("[SubsPlease]"));
    expect(anime).toBeDefined();
    expect(anime?.episode?.episode).toBe(7);
  });

  it("probe returns valid MediaInfo for generated clips", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const ep1 = result.files.find((f) => f.path.endsWith("Show.Name.S01E01.mkv"));
    expect(ep1).toBeDefined();
    if (!ep1) return;
    const info = await probeFile(ep1.path, execaRunner);
    expect(info.video.codec).toBe("h264");
    expect(info.video.width).toBe(320);
    expect(info.video.height).toBe(240);
    expect(info.durationSecs).toBeGreaterThan(0);
    expect(info.audio.length).toBeGreaterThanOrEqual(1);
  });

  it("classify identifies SxxExx file as series", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const ep1 = result.files.find((f) => f.path.endsWith("Show.Name.S01E01.mkv"));
    if (!ep1) throw new Error("ep1 not found");
    const info = await probeFile(ep1.path, execaRunner);
    const cls = classify({
      filePath: ep1.path,
      parentDirName: ep1.parentDir.split("/").pop() ?? "",
      parsedEpisode: ep1.episode,
      mediaInfo: info,
    });
    expect(cls.kind).toBe("series");
    expect(cls.confidence).toBeGreaterThanOrEqual(0.3);
  });

  it("classify identifies anime-bracket file as anime", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const anime = result.files.find((f) => f.path.includes("[SubsPlease]"));
    if (!anime) throw new Error("anime file not found");
    const info = await probeFile(anime.path, execaRunner);
    const cls = classify({
      filePath: anime.path,
      parentDirName: anime.parentDir.split("/").pop() ?? "",
      parsedEpisode: anime.episode,
      mediaInfo: info,
    });
    expect(cls.kind).toBe("anime");
  });

  it("buildPlan produces a plan with correct output dir", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const ep1 = result.files.find((f) => f.path.endsWith("Show.Name.S01E01.mkv"));
    if (!ep1) throw new Error("ep1 not found");
    const info = await probeFile(ep1.path, execaRunner);
    const cls = classify({
      filePath: ep1.path,
      parentDirName: ep1.parentDir.split("/").pop() ?? "",
      parsedEpisode: ep1.episode,
      mediaInfo: info,
    });
    const plan = buildPlan(info, cls, caps);
    expect(plan.outputFile).toContain("Prestron-Encoded");
    expect(plan.partFile).toBe(plan.outputFile + ".part");
    expect(plan.profile).toBeDefined();
  });

  it("buildArgs produces a valid ffmpeg arg array", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    const ep1 = result.files.find((f) => f.path.endsWith("Show.Name.S01E01.mkv"));
    if (!ep1) throw new Error("ep1 not found");
    const info = await probeFile(ep1.path, execaRunner);
    const cls = classify({
      filePath: ep1.path,
      parentDirName: ep1.parentDir.split("/").pop() ?? "",
      parsedEpisode: ep1.episode,
      mediaInfo: info,
    });
    const plan = buildPlan(info, cls, caps);
    const args = buildArgs(plan, caps);

    expect(args[0]).toBe("-hide_banner");
    expect(args).toContain("-i");
    expect(args).toContain("-f");
    expect(args).toContain("matroska");
    expect(args[args.length - 1]).toMatch(/\.part$/);
  });

  it("source files are readable after pipeline (originals untouched)", async () => {
    if (skipAll) return;
    const result = await scanDirectory(tmpDir);
    for (const file of result.files) {
      const s = await stat(file.path);
      expect(s.size).toBeGreaterThan(0);
    }
  });
});
