/**
 * App.tsx — Ink application root.
 *
 * Manages the top-level screen state machine:
 *
 *   startup → guided → encoding → results
 *                ↑           |
 *                └──(cancel)──┘
 *
 * Also handles:
 *   - /quit confirm when encoding is active
 *   - resize → re-read terminal size
 *   - terminal restore on unmount (cursor, mouse)
 *   - global q/Ctrl+C → clean exit
 */

import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { execa } from "execa";

import { restoreTerminal } from "../platform/terminal.js";

import { detectCapabilities as detectFfmpeg } from "../core/ffmpeg/capabilities.js";
import type { FfmpegCapabilities } from "../core/ffmpeg/capabilities.js";
import type { ProcessRunner } from "../core/ffmpeg/capabilities.js";

import { useBatch } from "./hooks/useBatch.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";
import { detectCapabilities as detectTerminal } from "../platform/capabilities.js";

import { StartupScreen } from "./screens/StartupScreen.js";
import { GuidedFlow } from "./screens/GuidedFlow.js";
import { EncodingScreen } from "./screens/EncodingScreen.js";
import { ResultsScreen } from "./screens/ResultsScreen.js";
import { SlashPalette, type SlashCommand } from "./components/SlashPalette.js";
import { SettingsScreen, DEFAULT_SETTINGS, type Settings } from "./screens/SettingsScreen.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppScreen =
  "startup" | "guided" | "encoding" | "results" | "palette" | "quit_confirm" | "settings";

export interface AppProps {
  rootDir: string;
  version: string;
  mouseEnabled?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
}

// ---------------------------------------------------------------------------
// Runner for FFmpeg capability detection
// ---------------------------------------------------------------------------

const execaRunner: ProcessRunner = {
  async run(binary, args) {
    const result = await execa(binary, args, { reject: false });
    if (result.exitCode === undefined) {
      throw Object.assign(new Error(`${binary}: command not found`), { code: "ENOENT" });
    }
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
  },
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export function App({
  rootDir,
  version,
  mouseEnabled = true,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const terminalSize = useTerminalSize();
  const termCaps = detectTerminal();

  /**
   * Clean exit path: restore terminal (cursor, mouse) before terminating.
   * Ink's exit() calls process.exit() directly, bypassing signal handlers,
   * so we must restore the terminal ourselves.
   */
  const quit = useCallback(() => {
    restoreTerminal();
    exit();
  }, [exit]);

  const [screen, setScreen] = useState<AppScreen>("startup");
  const [ffmpegCaps, setFfmpegCaps] = useState<FfmpegCapabilities | null>(null);
  const [ffmpegError, setFfmpegError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [prevScreen, setPrevScreen] = useState<AppScreen>("startup");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const batchOptions = {
    mouseEnabled,
    ffmpegPath,
    ffprobePath,
  };

  const {
    state: batchState,
    startScan,
    applyProfile,
    startEncoding,
    abort: _abort,
    reset: _reset,
  } = useBatch(batchOptions);

  // Detect FFmpeg on mount
  useEffect(() => {
    void detectFfmpeg(execaRunner, ffmpegPath)
      .then((caps) => {
        setFfmpegCaps(caps);
      })
      .catch((err: unknown) => {
        setFfmpegError(err instanceof Error ? err.message : String(err));
      });
  }, [ffmpegPath]);

  // Global keyboard handler
  useInput(
    useCallback(
      (input: string, key: { ctrl?: boolean; escape?: boolean }) => {
        // Ctrl+C handled by Ink + signals.ts; q on non-encoding screens exits
        if ((input === "q" || (key.ctrl && input === "c")) && screen !== "encoding") {
          quit();
        }
        if (input === "/" && screen !== "palette" && screen !== "encoding") {
          setPrevScreen(screen);
          setScreen("palette");
        }
        if (key.escape && screen === "palette") {
          setScreen(prevScreen);
        }
        if (key.escape && screen === "quit_confirm") {
          setScreen("encoding");
        }
      },
      [screen, prevScreen, exit],
    ),
  );

  // -------------------------------------------------------------------------
  // Event handlers
  // -------------------------------------------------------------------------

  const handleScan = useCallback(() => {
    void startScan(rootDir);
  }, [rootDir, startScan]);

  const handleStartFlow = useCallback(() => {
    if (batchState.files.length > 0) {
      setScreen("guided");
    }
  }, [batchState.files.length]);

  const handleFlowConfirm = useCallback(
    (paths: string[], profile: string) => {
      setSelectedPaths(paths);
      if (ffmpegCaps) {
        applyProfile(profile as Parameters<typeof applyProfile>[0], ffmpegCaps);
        setScreen("encoding");

        const selectedIndices = paths
          .map((p) => batchState.files.findIndex((f) => f.path === p))
          .filter((i) => i >= 0);

        void startEncoding(selectedIndices, ffmpegCaps).then(() => {
          setScreen("results");
        });
      }
    },
    [ffmpegCaps, applyProfile, startEncoding, batchState.files],
  );

  const handlePaletteCommand = useCallback(
    (cmd: SlashCommand | null) => {
      if (cmd === null) {
        // Empty enter → guided flow
        setScreen("guided");
        return;
      }
      setScreen(prevScreen);

      switch (cmd) {
        case "encode":
          setScreen("guided");
          break;
        case "scan":
          void startScan(rootDir);
          setScreen("startup");
          break;
        case "quit":
          if (batchState.phase === "encoding") {
            setScreen("quit_confirm");
          } else {
            quit();
          }
          break;
        case "resume":
          // For now route to guided flow; full resume wire-up is M5
          setScreen("guided");
          break;
        case "settings":
          setPrevScreen(screen === "palette" ? prevScreen : screen);
          setScreen("settings");
          break;
        case "report":
          if (batchState.phase === "done" || batchState.files.some((f) => f.phase === "done")) {
            setScreen("results");
          } else {
            setScreen("startup");
          }
          break;
        case "profile":
          if (batchState.files.length > 0) {
            setScreen("guided");
          } else {
            setScreen("startup");
          }
          break;
        case "help":
          // Falls through to startup which has hints
          setScreen("startup");
          break;
        default:
          setScreen("startup");
      }
    },
    [prevScreen, screen, startScan, rootDir, batchState.phase, batchState.files, exit],
  );

  // -------------------------------------------------------------------------
  // Quit confirm (when encoding is active)
  // -------------------------------------------------------------------------

  if (screen === "quit_confirm") {
    return (
      <Box flexDirection="column">
        <Text bold color="yellow">
          Encoding is in progress. Abort and quit?
        </Text>
        <Box marginTop={1}>
          <Text>Press y to abort and quit, Esc/n to continue encoding</Text>
        </Box>
      </Box>
    );
  }

  // -------------------------------------------------------------------------
  // Palette overlay
  // -------------------------------------------------------------------------

  if (screen === "palette") {
    return <SlashPalette onCommand={handlePaletteCommand} mouseEnabled={mouseEnabled} />;
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  if (screen === "results") {
    return <ResultsScreen batchState={batchState} onDone={quit} />;
  }

  // -------------------------------------------------------------------------
  // Encoding
  // -------------------------------------------------------------------------

  if (screen === "encoding") {
    return <EncodingScreen batchState={batchState} totalSelected={selectedPaths.length} />;
  }

  // -------------------------------------------------------------------------
  // Guided flow
  // -------------------------------------------------------------------------

  if (screen === "guided" && ffmpegCaps) {
    return (
      <GuidedFlow
        batchFiles={batchState.files}
        caps={ffmpegCaps}
        onConfirm={handleFlowConfirm}
        onCancel={() => setScreen("startup")}
        mouseEnabled={mouseEnabled}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  if (screen === "settings") {
    return (
      <SettingsScreen
        settings={settings}
        onSave={(newSettings) => {
          setSettings(newSettings);
          setScreen(prevScreen);
        }}
        onCancel={() => setScreen(prevScreen)}
      />
    );
  }

  // -------------------------------------------------------------------------
  // Startup (default)
  // -------------------------------------------------------------------------

  return (
    <StartupScreen
      version={version}
      rootDir={rootDir}
      batchState={batchState}
      ffmpegCaps={ffmpegCaps}
      ffmpegError={ffmpegError}
      columns={terminalSize.columns}
      isUtf8={termCaps.isUtf8}
      hasColor={termCaps.hasColor}
      onStartFlow={handleStartFlow}
      onOpenPalette={() => {
        setPrevScreen("startup");
        setScreen("palette");
      }}
      onScan={handleScan}
    />
  );
}
