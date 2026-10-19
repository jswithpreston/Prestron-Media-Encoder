/**
 * Tests for SlashPalette component — rendering only.
 *
 * NOTE: ink-testing-library 3.0 + Ink 5.x stdin mock does not implement
 * ref()/unref() that Ink 5 uses for raw-mode lifecycle. stdin.write() keyboard
 * interaction tests are deferred to the integration/manual acceptance tests
 * (M4 acceptance criteria). Here we test static rendering only.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { SlashPalette } from "../../../src/ui/components/SlashPalette.js";

/** Add the ref()/unref() stubs that Ink 5 expects on a TTY stdin. */
function patchStdin(stdin: Record<string, unknown>): void {
  stdin["ref"] ??= () => {
    /* no-op stub */
  };
  stdin["unref"] ??= () => {
    /* no-op stub */
  };
}

describe("SlashPalette — rendering", () => {
  it("shows all 10 commands with no filter", () => {
    const instance = render(
      React.createElement(SlashPalette, { onCommand: vi.fn(), mouseEnabled: false }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    const frame = instance.lastFrame() ?? "";
    const commands = [
      "/scan",
      "/analyze",
      "/encode",
      "/profile",
      "/resume",
      "/verify",
      "/report",
      "/settings",
      "/help",
      "/quit",
    ];
    for (const cmd of commands) {
      expect(frame).toContain(cmd);
    }
  });

  it("shows Command Palette header and usage hint", () => {
    const instance = render(
      React.createElement(SlashPalette, { onCommand: vi.fn(), mouseEnabled: false }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Command Palette");
    expect(frame).toContain("Esc to close");
  });

  it("highlights first item with ▶ cursor", () => {
    const instance = render(
      React.createElement(SlashPalette, { onCommand: vi.fn(), mouseEnabled: false }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    expect(instance.lastFrame() ?? "").toContain("▶");
  });

  it("shows / search prompt", () => {
    const instance = render(
      React.createElement(SlashPalette, { onCommand: vi.fn(), mouseEnabled: false }),
    );
    patchStdin(instance.stdin as Record<string, unknown>);
    expect(instance.lastFrame() ?? "").toContain("/ ");
  });
});
