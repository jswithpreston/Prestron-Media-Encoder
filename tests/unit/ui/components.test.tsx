/**
 * Tests for WarningList and ResultsTable components.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { WarningList } from "../../../src/ui/components/WarningList.js";
import { ResultsTable, type FileResult } from "../../../src/ui/components/ResultsTable.js";

describe("WarningList", () => {
  it("renders nothing when warnings are empty", () => {
    const { lastFrame } = render(React.createElement(WarningList, { warnings: [] }));
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("⚠");
    expect(frame.trim()).toBe("");
  });

  it("renders each warning", () => {
    const { lastFrame } = render(
      React.createElement(WarningList, {
        warnings: ["HDR source: color signaling not re-injected", "VFR source detected"],
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("HDR source");
    expect(frame).toContain("VFR source");
    expect(frame).toContain("⚠");
  });
});

describe("ResultsTable", () => {
  const makeResult = (overrides: Partial<FileResult> = {}): FileResult => ({
    sourcePath: "/media/Season 1/S01E01.mkv",
    outputPath: "/media/Season 1/Prestron-Encoded/S01E01.mkv",
    sourceSizeBytes: 2_000_000_000,
    outputSizeBytes: 1_200_000_000,
    state: "done",
    ...overrides,
  });

  it("shows done file with savings", () => {
    const { lastFrame } = render(
      React.createElement(ResultsTable, {
        results: [makeResult()],
        outputDir: "/media/Season 1/Prestron-Encoded",
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("S01E01.mkv");
    expect(frame).toContain("done");
    // Savings should be shown (source > output)
    expect(frame).toContain("↓");
  });

  it("shows failed file with error", () => {
    const { lastFrame } = render(
      React.createElement(ResultsTable, {
        results: [makeResult({ state: "failed", error: "Verify failed: duration" })],
        outputDir: "/media/Season 1/Prestron-Encoded",
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("S01E01.mkv");
    expect(frame).toContain("Verify failed: duration");
  });

  it("shows skipped file", () => {
    const { lastFrame } = render(
      React.createElement(ResultsTable, {
        results: [makeResult({ state: "skipped", outputSizeBytes: null })],
        outputDir: "/media/Prestron-Encoded",
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("skipped");
  });

  it("shows output directory", () => {
    const { lastFrame } = render(
      React.createElement(ResultsTable, {
        results: [makeResult()],
        outputDir: "/my/output/folder",
      }),
    );
    expect(lastFrame() ?? "").toContain("/my/output/folder");
  });

  it("shows total savings when multiple done files", () => {
    const { lastFrame } = render(
      React.createElement(ResultsTable, {
        results: [
          makeResult({ sourceSizeBytes: 2_000_000_000, outputSizeBytes: 1_000_000_000 }),
          makeResult({
            sourcePath: "/media/S01E02.mkv",
            sourceSizeBytes: 1_500_000_000,
            outputSizeBytes: 800_000_000,
          }),
        ],
        outputDir: "/media/Prestron-Encoded",
      }),
    );
    const frame = lastFrame() ?? "";
    // Total line should appear
    expect(frame).toContain("Total");
  });

  it("renders nothing for totals when no done files", () => {
    const { lastFrame } = render(
      React.createElement(ResultsTable, {
        results: [makeResult({ state: "failed" })],
        outputDir: "/media/Prestron-Encoded",
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).not.toContain("Total");
  });
});
