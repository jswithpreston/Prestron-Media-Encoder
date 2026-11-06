import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { probeFile } from "../../../../src/core/probe/index.js";
import type { ProcessRunner } from "../../../../src/core/ffmpeg/capabilities.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, "../../../fixtures/probes");

function fixtureRunner(fixtureName: string): ProcessRunner {
  const content = readFileSync(join(FIXTURES, fixtureName), "utf8");
  return {
    run() {
      return Promise.resolve({ stdout: content, stderr: "", exitCode: 0 });
    },
  };
}

describe("deep probe metrics and fixtures", () => {
  it("h264-1080p-high: extracts bpp, level, dar/sar, field_order, tags", async () => {
    const info = await probeFile("/fake/h264-1080p-high.mp4", fixtureRunner("h264-1080p-high.json"));
    expect(info.video.codec).toBe("h264");
    expect(info.video.profile).toBe("High");
    expect(info.video.level).toBe(41);
    expect(info.video.dar).toBe("16:9");
    expect(info.video.sar).toBe("1:1");
    expect(info.video.fieldOrder).toBe("progressive");
    expect(info.video.bitDepth).toBe(8);
    expect(info.video.bpp).toBeGreaterThan(0.2); // 12000kbps on 1080p24
    expect(info.video.isBitrateDerived).toBe(false);
    expect(info.audio[0]?.sampleRateHz).toBe(48000);
    expect(info.audio[0]?.channelLayout).toBe("stereo");
    expect(info.audio[0]?.isDefault).toBe(true);
    expect(info.containerLongName).toBe("QuickTime / MOV");
    expect(info.encoderTag).toBe("Lavf60.16.100");
  });

  it("h264-low-bitrate: detects low bpp", async () => {
    const info = await probeFile("/fake/low.mp4", fixtureRunner("h264-low-bitrate.json"));
    expect(info.video.bpp).toBeLessThan(0.05);
    expect(info.video.bitrateKbps).toBe(1000);
  });

  it("hevc-4k: extracts 10-bit depth and 4K dimensions", async () => {
    const info = await probeFile("/fake/hevc-4k.mp4", fixtureRunner("hevc-4k.json"));
    expect(info.video.codec).toBe("hevc");
    expect(info.video.width).toBe(3840);
    expect(info.video.height).toBe(2160);
    expect(info.video.bitDepth).toBe(10);
    expect(info.video.fps).toBe(60);
  });

  it("av1-web and vp9-web: probes modern web codecs", async () => {
    const av1 = await probeFile("/fake/av1.webm", fixtureRunner("av1-web.json"));
    expect(av1.video.codec).toBe("av1");
    expect(av1.audio[0]?.codec).toBe("opus");

    const vp9 = await probeFile("/fake/vp9.webm", fixtureRunner("vp9-web.json"));
    expect(vp9.video.codec).toBe("vp9");
  });

  it("h264-10bit: extracts 10-bit pix_fmt", async () => {
    const info = await probeFile("/fake/10bit.mkv", fixtureRunner("h264-10bit.json"));
    expect(info.video.bitDepth).toBe(10);
    expect(info.video.pixFmt).toBe("yuv420p10le");
  });

  it("hdr10: detects HDR10 metadata", async () => {
    const info = await probeFile("/fake/hdr10.mkv", fixtureRunner("hdr10.json"));
    expect(info.video.isHdr).toBe(true);
    expect(info.video.hdrFormat).toBe("HDR10");
    expect(info.video.colorTransfer).toBe("smpte2084");
    expect(info.video.colorPrimaries).toBe("bt2020");
  });

  it("dolby-vision: detects Dolby Vision from side data", async () => {
    const info = await probeFile("/fake/dovi.mp4", fixtureRunner("dolby-vision.json"));
    expect(info.video.isDolbyVision).toBe(true);
    expect(info.video.hdrFormat).toBe("Dolby Vision");
  });

  it("mpeg2-interlaced: detects interlaced field_order", async () => {
    const info = await probeFile("/fake/interlaced.ts", fixtureRunner("mpeg2-interlaced.json"));
    expect(info.video.fieldOrder).toBe("interlaced");
  });

  it("vfr-phone: detects VFR and rotation", async () => {
    const info = await probeFile("/fake/phone.mp4", fixtureRunner("vfr-phone.json"));
    expect(info.video.isVfr).toBe(true);
    expect(info.video.rotation).toBe(90);
  });

  it("multi-audio-subs-chapters: parses all tracks, subs, attachments, and chapters", async () => {
    const info = await probeFile("/fake/multi.mkv", fixtureRunner("multi-audio-subs-chapters.json"));
    expect(info.audio).toHaveLength(2);
    expect(info.subtitles).toHaveLength(2);
    expect(info.subtitles[0]?.formatType).toBe("text");
    expect(info.subtitles[1]?.formatType).toBe("bitmap");
    expect(info.attachments).toHaveLength(1);
    expect(info.attachments[0]?.filename).toBe("font.ttf");
    expect(info.chapterCount).toBe(3);
    expect(info.chapters[0]?.title).toBe("Intro");
    expect(info.nonVideoSizeBytes).toBeGreaterThan(0);
  });

  it("missing-odd-fields: gracefully derives video bitrate and non-video bytes", async () => {
    const info = await probeFile("/fake/odd.mp4", fixtureRunner("missing-odd-fields.json"));
    expect(info.video.isBitrateDerived).toBe(true);
    expect(info.video.bitrateKbps).toBeGreaterThan(0);
    expect(info.nonVideoSizeBytes).toBeGreaterThanOrEqual(0);
  });
});
