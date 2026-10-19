/**
 * Tests for ProgressBar and BatchProgress components.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ProgressBar, BatchProgress } from "../../../src/ui/components/ProgressBar.js";

describe("ProgressBar", () => {
  it("renders 0% bar", () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 0, width: 10 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("[");
    expect(frame).toContain("]");
    expect(frame).toContain("  0%");
    // All chars should be empty fill
    expect(frame).toContain("░░░░░░░░░░");
  });

  it("renders 100% bar", () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 100, width: 10 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain("100%");
    expect(frame).toContain("██████████");
  });

  it("renders 50% bar", () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 50, width: 10 }));
    const frame = lastFrame() ?? "";
    expect(frame).toContain(" 50%");
    // Half filled, half empty
    expect(frame).toContain("█████░░░░░");
  });

  it("clamps values > 100", () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: 150, width: 10 }));
    expect(lastFrame() ?? "").toContain("100%");
  });

  it("clamps values < 0", () => {
    const { lastFrame } = render(React.createElement(ProgressBar, { value: -10, width: 10 }));
    expect(lastFrame() ?? "").toContain("  0%");
  });

  it("renders label when provided", () => {
    const { lastFrame } = render(
      React.createElement(ProgressBar, { value: 42, width: 10, label: "File:" }),
    );
    expect(lastFrame() ?? "").toContain("File:");
  });
});

describe("BatchProgress", () => {
  it("shows done/failed/skipped counts", () => {
    const { lastFrame } = render(
      React.createElement(BatchProgress, {
        done: 3,
        failed: 1,
        skipped: 0,
        total: 5,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("3");
    expect(frame).toContain("1");
    expect(frame).toContain("5");
  });

  it("renders 0% when total is 0", () => {
    const { lastFrame } = render(
      React.createElement(BatchProgress, {
        done: 0,
        failed: 0,
        skipped: 0,
        total: 0,
        width: 10,
      }),
    );
    expect(lastFrame() ?? "").toContain("  0%");
  });
});
