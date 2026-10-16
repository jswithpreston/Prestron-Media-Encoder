import { describe, it, expect } from "vitest";
import { detectCapabilities, type CapabilitiesSource } from "../../../src/platform/capabilities.js";

function makeSource(overrides: Partial<CapabilitiesSource> = {}): CapabilitiesSource {
  return {
    env: {},
    stdoutIsTty: false,
    stdinIsTty: false,
    stdoutColumns: 80,
    stdoutRows: 24,
    ...overrides,
  };
}

describe("detectCapabilities — TTY detection", () => {
  it("marks stdout as non-TTY when stdoutIsTty is false", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: false }));
    expect(caps.isStdoutTty).toBe(false);
  });

  it("marks stdout as TTY when stdoutIsTty is true", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: true }));
    expect(caps.isStdoutTty).toBe(true);
  });

  it("marks stdin as non-TTY when stdinIsTty is false", () => {
    const caps = detectCapabilities(makeSource({ stdinIsTty: false }));
    expect(caps.isStdinTty).toBe(false);
  });
});

describe("detectCapabilities — UTF-8 detection", () => {
  it("detects UTF-8 from LANG=en_US.UTF-8", () => {
    const caps = detectCapabilities(makeSource({ env: { LANG: "en_US.UTF-8" } }));
    expect(caps.isUtf8).toBe(true);
  });

  it("detects UTF-8 from LC_ALL=en_GB.UTF-8", () => {
    const caps = detectCapabilities(makeSource({ env: { LC_ALL: "en_GB.UTF-8" } }));
    expect(caps.isUtf8).toBe(true);
  });

  it("detects UTF-8 from LC_CTYPE containing utf8 (lowercase)", () => {
    const caps = detectCapabilities(makeSource({ env: { LC_CTYPE: "C.utf8" } }));
    expect(caps.isUtf8).toBe(true);
  });

  it("returns false when no UTF-8 locale vars are set", () => {
    const caps = detectCapabilities(makeSource({ env: { LANG: "C", LC_ALL: "POSIX" } }));
    expect(caps.isUtf8).toBe(false);
  });

  it("LC_ALL takes precedence over LANG", () => {
    // LC_ALL=C (non-UTF-8) should override LANG=en_US.UTF-8
    const caps = detectCapabilities(makeSource({ env: { LC_ALL: "C", LANG: "en_US.UTF-8" } }));
    expect(caps.isUtf8).toBe(false);
  });

  it("returns false when env is empty", () => {
    const caps = detectCapabilities(makeSource({ env: {} }));
    expect(caps.isUtf8).toBe(false);
  });
});

describe("detectCapabilities — color detection", () => {
  it("returns false when NO_COLOR is set (any value)", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: true, env: { NO_COLOR: "" } }));
    expect(caps.hasColor).toBe(false);
  });

  it("returns false when TERM=dumb", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: true, env: { TERM: "dumb" } }));
    expect(caps.hasColor).toBe(false);
  });

  it("returns true when FORCE_COLOR=1 even without TTY", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: false, env: { FORCE_COLOR: "1" } }));
    expect(caps.hasColor).toBe(true);
  });

  it("returns false when FORCE_COLOR=0", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: true, env: { FORCE_COLOR: "0" } }));
    expect(caps.hasColor).toBe(false);
  });

  it("returns false when not a TTY and no FORCE_COLOR", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: false, env: {} }));
    expect(caps.hasColor).toBe(false);
  });

  it("returns true when TTY and COLORTERM=truecolor", () => {
    const caps = detectCapabilities(
      makeSource({ stdoutIsTty: true, env: { COLORTERM: "truecolor" } }),
    );
    expect(caps.hasColor).toBe(true);
  });

  it("returns true when TTY and TERM=xterm-256color", () => {
    const caps = detectCapabilities(
      makeSource({ stdoutIsTty: true, env: { TERM: "xterm-256color" } }),
    );
    expect(caps.hasColor).toBe(true);
  });

  it("NO_COLOR takes precedence over FORCE_COLOR", () => {
    const caps = detectCapabilities(
      makeSource({ stdoutIsTty: true, env: { NO_COLOR: "", FORCE_COLOR: "1" } }),
    );
    expect(caps.hasColor).toBe(false);
  });

  it("defaults to true when TTY with no color-related vars", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: true, env: {} }));
    expect(caps.hasColor).toBe(true);
  });
});

describe("detectCapabilities — dimensions", () => {
  it("uses provided column count when TTY", () => {
    const caps = detectCapabilities(
      makeSource({ stdoutIsTty: true, stdoutColumns: 120, stdoutRows: 40 }),
    );
    expect(caps.columns).toBe(120);
    expect(caps.rows).toBe(40);
  });

  it("defaults to 80x24 when not a TTY", () => {
    const caps = detectCapabilities(makeSource({ stdoutIsTty: false }));
    expect(caps.columns).toBe(80);
    expect(caps.rows).toBe(24);
  });

  it("defaults to 80x24 when TTY but no size provided", () => {
    const caps = detectCapabilities(
      makeSource({ stdoutIsTty: true, stdoutColumns: undefined, stdoutRows: undefined }),
    );
    expect(caps.columns).toBe(80);
    expect(caps.rows).toBe(24);
  });
});
