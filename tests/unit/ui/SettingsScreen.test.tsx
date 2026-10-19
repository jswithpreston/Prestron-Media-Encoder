import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { SettingsScreen, DEFAULT_SETTINGS } from "../../../src/ui/screens/SettingsScreen.js";

beforeAll(() => {
  // Patch mock Stdin prototype from ink-testing-library for Ink 5 useInput support
  const temp = render(React.createElement("div"));
  const proto = Object.getPrototypeOf(temp.stdin) as Record<string, unknown>;
  proto["ref"] ??= () => {
    /* no-op */
  };
  proto["unref"] ??= () => {
    /* no-op */
  };
  temp.unmount();
});

describe("SettingsScreen", () => {
  it("renders settings heading", () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { lastFrame } = render(
      React.createElement(SettingsScreen, {
        settings: DEFAULT_SETTINGS,
        onSave,
        onCancel,
      }),
    );
    expect(lastFrame()).toContain("Settings");
  });

  it("shows mouse support setting", () => {
    const { lastFrame } = render(
      React.createElement(SettingsScreen, {
        settings: DEFAULT_SETTINGS,
        onSave: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain("Mouse support");
  });

  it("shows branding metadata setting", () => {
    const { lastFrame } = render(
      React.createElement(SettingsScreen, {
        settings: DEFAULT_SETTINGS,
        onSave: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain("Branding");
  });

  it("shows preset override setting", () => {
    const { lastFrame } = render(
      React.createElement(SettingsScreen, {
        settings: DEFAULT_SETTINGS,
        onSave: vi.fn(),
        onCancel: vi.fn(),
      }),
    );
    expect(lastFrame()).toContain("Preset");
  });
});
