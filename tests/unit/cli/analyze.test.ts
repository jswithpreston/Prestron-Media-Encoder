import { describe, it, expect } from "vitest";
import { makeAnalyzeCommand } from "../../../src/cli/analyze.js";

describe("makeAnalyzeCommand", () => {
  it("creates analyze command with expected flags and description", () => {
    const cmd = makeAnalyzeCommand();
    expect(cmd.name()).toBe("analyze");
    expect(cmd.description()).toContain("Probe, classify, recommend");

    const optionNames = cmd.options.map((o) => o.long);
    expect(optionNames).toContain("--json");
    expect(optionNames).toContain("--detail");
    expect(optionNames).toContain("--deep");
    expect(optionNames).toContain("--ffprobe-path");
    expect(optionNames).toContain("--ffmpeg-path");
  });
});
