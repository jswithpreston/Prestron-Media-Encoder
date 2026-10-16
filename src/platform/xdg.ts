/**
 * XDG Base Directory helpers.
 *
 * Uses env-paths to follow the XDG Base Directory specification on Linux.
 * Respects XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, XDG_CACHE_HOME.
 */

import envPaths from "env-paths";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const APP_NAME = "prestron";

export interface XdgPaths {
  /** ~/.local/share/prestron — job databases, persistent data */
  data: string;
  /** ~/.config/prestron — user configuration */
  config: string;
  /** ~/.local/state/prestron — structured logs, rotating log files */
  log: string;
  /** ~/.cache/prestron — ephemeral cache */
  cache: string;
  /** ~/.local/share/prestron/temp — temporary files during encoding */
  temp: string;
}

/**
 * Returns typed XDG paths for the application.
 * Respects XDG_DATA_HOME, XDG_CONFIG_HOME, XDG_STATE_HOME, XDG_CACHE_HOME.
 *
 * env-paths reads XDG_DATA_HOME for `data`, XDG_CONFIG_HOME for `config`,
 * XDG_LOG_HOME (non-standard; falls back to XDG_STATE_HOME) for `log`,
 * XDG_CACHE_HOME for `cache`.
 *
 * We additionally honour XDG_STATE_HOME explicitly for `log` on Linux.
 */
export function getXdgPaths(): XdgPaths {
  const paths = envPaths(APP_NAME, { suffix: "" });

  // env-paths uses "log" for the log path which maps to XDG_STATE_HOME on Linux
  // On Linux: ~/.local/state/<name>
  // Fallback to paths.log if XDG_STATE_HOME is not set
  const stateHome = process.env["XDG_STATE_HOME"];
  const logPath = stateHome ? join(stateHome, APP_NAME) : paths.log;

  return {
    data: paths.data,
    config: paths.config,
    log: logPath,
    cache: paths.cache,
    temp: join(paths.data, "temp"),
  };
}

/**
 * Returns XDG paths and ensures the directories exist.
 * Safe to call multiple times (uses mkdirSync with recursive:true).
 */
export function getXdgPathsEnsured(): XdgPaths {
  const paths = getXdgPaths();
  const dirs: string[] = [paths.data, paths.config, paths.log, paths.cache, paths.temp];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
