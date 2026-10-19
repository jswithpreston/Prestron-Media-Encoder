import { describe, it, expect } from "vitest";
import { runEncode } from "../../../../src/core/ffmpeg/runner.js";

describe("runEncode", () => {
  it("fails gracefully with non-zero exit code when given invalid arguments", async () => {
    const result = await runEncode(["-invalid_flag_xyz", "/tmp/non-existent.part"], {
      ffmpegBinary: "ffmpeg",
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.error).toBeDefined();
  });

  it("fails when binary does not exist", async () => {
    const result = await runEncode(["-version", "/tmp/test.part"], {
      ffmpegBinary: "non_existent_ffmpeg_binary_xyz",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ENOENT|not recognized/);
  });
});
