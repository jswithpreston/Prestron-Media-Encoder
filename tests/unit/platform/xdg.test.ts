import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getXdgPaths } from "../../../src/platform/xdg.js";
import { homedir } from "node:os";
import { join, isAbsolute, sep } from "node:path";

const isLinux = process.platform === "linux";

describe("getXdgPaths", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear XDG overrides before each test
    delete process.env["XDG_DATA_HOME"];
    delete process.env["XDG_CONFIG_HOME"];
    delete process.env["XDG_STATE_HOME"];
    delete process.env["XDG_CACHE_HOME"];
  });

  afterEach(() => {
    // Restore original env
    process.env["XDG_DATA_HOME"] = originalEnv["XDG_DATA_HOME"];
    process.env["XDG_CONFIG_HOME"] = originalEnv["XDG_CONFIG_HOME"];
    process.env["XDG_STATE_HOME"] = originalEnv["XDG_STATE_HOME"];
    process.env["XDG_CACHE_HOME"] = originalEnv["XDG_CACHE_HOME"];
  });

  it("returns paths containing 'prestron' in the name", () => {
    const paths = getXdgPaths();
    expect(paths.data).toContain("prestron");
    expect(paths.config).toContain("prestron");
    expect(paths.log).toContain("prestron");
    expect(paths.cache).toContain("prestron");
  });

  describe.skipIf(!isLinux)("Linux defaults", () => {
    it("data path defaults to ~/.local/share/prestron", () => {
      const paths = getXdgPaths();
      const expected = join(homedir(), ".local", "share", "prestron");
      expect(paths.data).toBe(expected);
    });

    it("config path defaults to ~/.config/prestron", () => {
      const paths = getXdgPaths();
      const expected = join(homedir(), ".config", "prestron");
      expect(paths.config).toBe(expected);
    });
  });

  it("temp path is a subdirectory of data", () => {
    const paths = getXdgPaths();
    expect(paths.temp).toContain(paths.data);
    expect(paths.temp).toContain("temp");
  });

  describe.skipIf(!isLinux)("XDG overrides", () => {
    it("respects XDG_DATA_HOME override", () => {
      process.env["XDG_DATA_HOME"] = "/custom/data";
      const paths = getXdgPaths();
      expect(paths.data).toBe("/custom/data/prestron");
    });

    it("respects XDG_CONFIG_HOME override", () => {
      process.env["XDG_CONFIG_HOME"] = "/custom/config";
      const paths = getXdgPaths();
      expect(paths.config).toBe("/custom/config/prestron");
    });

    it("respects XDG_STATE_HOME override for log path", () => {
      process.env["XDG_STATE_HOME"] = "/custom/state";
      const paths = getXdgPaths();
      expect(paths.log).toBe("/custom/state/prestron");
    });
  });

  it("returns absolute paths", () => {
    const paths = getXdgPaths();
    for (const p of Object.values(paths)) {
      const checks = [isAbsolute(p), p.startsWith(sep), /^[A-Z]:/i.test(p)];
      expect(checks.some(Boolean)).toBe(true);
    }
  });
});
