import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import {
  SettingsScreen,
  DEFAULT_SETTINGS,
  type Settings,
} from "../../../src/ui/screens/SettingsScreen.js";
import { cycleValue } from "../../../src/ui/screens/SettingsScreen.js";

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

  it("clamps CRF override to 51 and never reaches 99", () => {
    // Start from auto (null) and crank right-arrow far past 51 (attempt 99)
    let settings: Settings = { ...DEFAULT_SETTINGS, crfOverride: null };
    for (let i = 0; i < 200; i++) {
      settings = cycleValue("crfOverride", settings, 1);
    }
    // Clamped at 51; 99 must never be reachable
    expect(settings.crfOverride).toBe(51);
    expect(settings.crfOverride).not.toBe(99);

    // From 51, further right-arrow presses stay at 51
    for (let i = 0; i < 200; i++) {
      settings = cycleValue("crfOverride", settings, 1);
    }
    expect(settings.crfOverride).toBe(51);

    // Left-arrow clamps at 0
    for (let i = 0; i < 200; i++) {
      settings = cycleValue("crfOverride", settings, -1);
    }
    expect(settings.crfOverride).toBe(0);
  });
});
