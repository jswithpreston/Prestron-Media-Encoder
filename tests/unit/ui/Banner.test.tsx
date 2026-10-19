/**
 * Tests for the Banner component.
 * Uses ink-testing-library to render into a virtual terminal.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { Banner } from "../../../src/ui/components/Banner.js";

describe("Banner", () => {
  it("renders full ASCII banner when cols >= 70 and UTF-8", () => {
    const { lastFrame } = render(
      React.createElement(Banner, {
        version: "1.2.3",
        columns: 80,
        isUtf8: true,
        hasColor: false,
      }),
    );
    const frame = lastFrame() ?? "";
    // Full banner should contain box-drawing chars
    expect(frame).toContain("██████╗");
    expect(frame).toContain("Media Encoder  v1.2.3");
  });

  it("renders narrow fallback when cols < 70", () => {
    const { lastFrame } = render(
      React.createElement(Banner, {
        version: "0.5.0",
        columns: 60,
        isUtf8: true,
        hasColor: false,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PRESTRON Media Encoder");
    expect(frame).toContain("v0.5.0");
    expect(frame).not.toContain("██");
  });

  it("renders narrow fallback when not UTF-8", () => {
    const { lastFrame } = render(
      React.createElement(Banner, {
        version: "0.1.0",
        columns: 120,
        isUtf8: false,
        hasColor: false,
      }),
    );
    const frame = lastFrame() ?? "";
    expect(frame).toContain("PRESTRON Media Encoder");
    expect(frame).not.toContain("██");
  });

  it("renders version in fallback", () => {
    const { lastFrame } = render(
      React.createElement(Banner, {
        version: "2.0.0",
        columns: 40,
        isUtf8: false,
        hasColor: false,
      }),
    );
    expect(lastFrame() ?? "").toContain("v2.0.0");
  });
});
