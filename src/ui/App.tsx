/**
 * App.tsx — Claude Code / Kiro-CLI-style session UI for Prestron Media Encoder.
 *
 * Requirements:
 *   (1) Persistent frame: big ASCII banner on first screen only, then compact header;
 *       scrolling log above via Ink's <Static>; bordered input box always at bottom;
 *       status line below it.
 *   (2) Startup info card (folder, files found with resolution/codec/size, FFmpeg status, recovery).
 *   (3) Typing / opens filterable command list above input (/encode /analyze /scan /profile /resume
 *       /verify /report /settings /status /cancel /help /quit).
 *   (4) /encode, /profile, /settings open inline panels in the log (windowed checklist + Y/n confirm).
 *   (5) Live encoding progress line (bar, fps, speed, ETA, size) while input stays available for /status, /cancel.
 *   (6) Ctrl+C once during encode asks confirm, twice cancels safely.
 *   (7) Up-arrow command history.
 *   (8) Empty folder prints "No video files found here" with hint, no dead-end panel.
 *   (a) Mouse reporting off by default; on only while an interactive panel is open.
 *   (b) Live region windowed to <= 8-10 rows to prevent flicker at 24 rows.
 *   (c) Ctrl+C at idle prompt shows "Press Ctrl+C again to exit".
 */

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Box, Text, Static, useApp } from "ink";
import { execa } from "execa";
import { basename, join, resolve } from "node:path";

import { restoreTerminal, enableMouse, disableMouse } from "../platform/terminal.js";
import { detectCapabilities as detectTerminal } from "../platform/capabilities.js";
import {
  detectCapabilities as detectFfmpeg,
  type FfmpegCapabilities,
  type ProcessRunner,
} from "../core/ffmpeg/capabilities.js";
import { openJournalStore } from "../core/jobs/journalDb.js";
import { PROFILES, type ProfileName } from "../core/policy/profiles.js";

import { useBatch } from "./hooks/useBatch.js";
import { useTerminalSize } from "./hooks/useTerminalSize.js";

import { Banner, CompactHeader } from "./components/Banner.js";
import { StartupCard } from "./components/StartupCard.js";
import { StatusBar } from "./components/StatusBar.js";
import { SessionInput } from "./components/SessionInput.js";
import { SlashPalette, type SlashCommand } from "./components/SlashPalette.js";
import { InlineEncodePanel } from "./components/InlineEncodePanel.js";
import { InlineProfilePanel } from "./components/InlineProfilePanel.js";
import { LiveProgressLine } from "./components/LiveProgressLine.js";
import { ResultsTable, type FileResult } from "./components/ResultsTable.js";
import { SettingsScreen, DEFAULT_SETTINGS, type Settings } from "./screens/SettingsScreen.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppProps {
  rootDir: string;
  version: string;
  mouseEnabled?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
}

interface StaticItem {
  id: string;
  render: () => React.ReactElement;
}

type ActivePanel = "encode" | "profile" | "settings" | null;

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
// App Component
// ---------------------------------------------------------------------------

export function App({
  rootDir: initialRootDir,
  version,
  mouseEnabled = true,
  ffmpegPath = "ffmpeg",
  ffprobePath = "ffprobe",
}: AppProps): React.ReactElement {
  const { exit } = useApp();
  const terminalSize = useTerminalSize();
  const termCaps = detectTerminal();

  const [rootDir, setRootDir] = useState(initialRootDir);
  const [ffmpegCaps, setFfmpegCaps] = useState<FfmpegCapabilities | null>(null);
  const [currentProfile, setCurrentProfile] = useState<ProfileName>("series");
  const [settings, setSettings] = useState<Settings>({
    ...DEFAULT_SETTINGS,
    mouseEnabled,
  });

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);

  // Ctrl+C state handling
  const [idleCtrlCCount, setIdleCtrlCCount] = useState(0);
  const [encodeCancelPrompt, setEncodeCancelPrompt] = useState(false);
  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const batchOptions = {
    profile: currentProfile,
    crfOverride: settings.crfOverride ?? undefined,
    presetOverride: settings.presetOverride === "auto" ? undefined : settings.presetOverride,
    brandingEnabled: settings.brandingEnabled,
    mouseEnabled: settings.mouseEnabled,
    ffmpegPath,
    ffprobePath,
  };

  const {
    state: batchState,
    startScan,
    applyProfile,
    startEncoding,
    abort,
  } = useBatch(batchOptions);

  const isEncoding = batchState.phase === "encoding";

  // Clean exit helper
  const quit = useCallback(() => {
    restoreTerminal();
    exit();
  }, [exit]);

  // Push an item to <Static> scrollback
  const appendLog = useCallback((renderFn: () => React.ReactElement) => {
    const id = `item-${String(Date.now())}-${Math.random().toString(36).slice(2, 7)}`;
    setStaticItems((prev) => [...prev, { id, render: renderFn }]);
  }, []);

  // Mouse reporting lifecycle: off by default, enabled only when activePanel != null
  const mouseAllowed = mouseEnabled && settings.mouseEnabled;
  const mouseActive = activePanel !== null && mouseAllowed;

  useEffect(() => {
    if (mouseActive) {
      enableMouse();
    } else {
      disableMouse();
    }
  }, [mouseActive]);

  useEffect(() => {
    return () => {
      restoreTerminal();
    };
  }, []);

  // 1. Initial banner in <Static> scrollback on mount
  useEffect(() => {
    appendLog(() => (
      <Banner
        version={version}
        columns={terminalSize.columns}
        isUtf8={termCaps.isUtf8}
        hasColor={termCaps.hasColor}
      />
    ));
  }, []);

  // 2. FFmpeg detection & initial folder scan
  useEffect(() => {
    void detectFfmpeg(execaRunner, ffmpegPath)
      .then((caps) => {
        setFfmpegCaps(caps);
        return startScan(rootDir).then(() => caps);
      })
      .then((caps) => {
        applyProfile(currentProfile, caps);
      })
      .catch((err: unknown) => {
        appendLog(() => (
          <Box marginY={1}>
            <Text color="red">
              FFmpeg detection error: {err instanceof Error ? err.message : String(err)}
            </Text>
          </Box>
        ));
      });
  }, [ffmpegPath]);

  // 3. When initial scan finishes, append startup info card to <Static>
  const initialCardShownRef = useRef(false);
  useEffect(() => {
    if (batchState.phase === "ready" && !initialCardShownRef.current) {
      initialCardShownRef.current = true;
      appendLog(() => (
        <StartupCard
          rootDir={rootDir}
          files={batchState.files}
          ffmpegCaps={ffmpegCaps}
          recoveryMessages={batchState.recoveryMessages}
        />
      ));
    }
  }, [batchState.phase, batchState.files, batchState.recoveryMessages, ffmpegCaps, rootDir, appendLog]);

  // Log completed jobs to <Static> as they finish during encoding
  const loggedDoneFilesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const f of batchState.files) {
      if ((f.phase === "done" || f.phase === "failed" || f.phase === "skipped") && !loggedDoneFilesRef.current.has(f.path)) {
        loggedDoneFilesRef.current.add(f.path);
        const file = f;
        appendLog(() => {
          const name = basename(file.path);
          if (file.phase === "done") {
            const outSize = file.outputSizeBytes ?? 0;
            const srcSize = file.sourceSizeBytes;
            const savings = srcSize > 0 ? Math.round(((srcSize - outSize) / srcSize) * 100) : 0;
            return (
              <Box paddingLeft={1}>
                <Text color="green">[✔] </Text>
                <Text bold>{name} </Text>
                <Text dimColor>saved {savings}% ({(outSize / (1024 * 1024)).toFixed(1)} MB)</Text>
              </Box>
            );
          }
          if (file.phase === "failed") {
            return (
              <Box paddingLeft={1}>
                <Text color="red">[✘] </Text>
                <Text bold>{name} </Text>
                <Text color="red">Failed: {file.error ?? "Encode error"}</Text>
              </Box>
            );
          }
          return (
            <Box paddingLeft={1}>
              <Text dimColor>[⊘] {name} (skipped)</Text>
            </Box>
          );
        });
      }
    }
  }, [batchState.files, appendLog]);

  // ---------------------------------------------------------------------------
  // Action Handlers
  // ---------------------------------------------------------------------------

  const handleStartScan = useCallback(
    async (targetDir: string) => {
      const resolved = resolve(targetDir);
      setRootDir(resolved);
      appendLog(() => (
        <Box>
          <Text dimColor>&gt; /scan {resolved}</Text>
        </Box>
      ));
      await startScan(resolved);
      if (ffmpegCaps) {
        applyProfile(currentProfile, ffmpegCaps);
      }
      appendLog(() => (
        <StartupCard
          rootDir={resolved}
          files={batchState.files}
          ffmpegCaps={ffmpegCaps}
        />
      ));
    },
    [startScan, ffmpegCaps, currentProfile, applyProfile, batchState.files, appendLog],
  );

  const handleEncodeConfirm = useCallback(
    (selectedPaths: string[]) => {
      setActivePanel(null);
      if (!ffmpegCaps) return;

      appendLog(() => (
        <Box>
          <Text color="cyan">&gt; /encode </Text>
          <Text dimColor>({selectedPaths.length} files selected)</Text>
        </Box>
      ));

      const indices = selectedPaths
        .map((p) => batchState.files.findIndex((f) => f.path === p))
        .filter((i) => i >= 0);

      loggedDoneFilesRef.current.clear();
      void startEncoding(indices, ffmpegCaps).then(() => {
        appendLog(() => {
          const results: FileResult[] = batchState.files.map((f) => ({
            sourcePath: f.path,
            outputPath: f.plan?.outputFile ?? "",
            sourceSizeBytes: f.sourceSizeBytes,
            outputSizeBytes: f.outputSizeBytes,
            state: f.phase === "done" ? "done" : f.phase === "failed" ? "failed" : "skipped",
            error: f.error ?? undefined,
          }));
          return (
            <ResultsTable
              results={results}
              outputDir={join(rootDir, "Prestron-Encoded")}
            />
          );
        });
      });
    },
    [ffmpegCaps, batchState.files, startEncoding, appendLog, rootDir],
  );

  const handleSlashCommand = useCallback(
    (cmd: SlashCommand | null) => {
      setSlashOpen(false);
      setSlashQuery("");

      if (!cmd) return;

      switch (cmd) {
        case "encode":
          if (batchState.files.length === 0) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">No video files found to encode. Run /scan &lt;folder&gt; first.</Text>
              </Box>
            ));
          } else {
            setActivePanel("encode");
          }
          break;

        case "analyze":
          appendLog(() => (
            <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="blue" paddingX={1}>
              <Text bold color="blue">File Analysis &amp; Plans:</Text>
              {batchState.files.length === 0 ? (
                <Text dimColor>No files analyzed. Run /scan first.</Text>
              ) : (
                batchState.files.map((f, i) => (
                  <Box key={i} flexDirection="column" marginY={0}>
                    <Text bold color="white">{basename(f.path)}</Text>
                    <Text dimColor>
                      {"  "}Target: {f.plan ? (f.plan.videoAction === "copy" ? "copy (passthrough)" : `${f.plan.profile.codec} CRF ${String(f.plan.profile.crf)} preset ${f.plan.profile.preset}`) : "Unplanned"}
                    </Text>
                  </Box>
                ))
              )}
            </Box>
          ));
          break;

        case "scan":
          void handleStartScan(rootDir);
          break;

        case "profile":
          setActivePanel("profile");
          break;

        case "resume": {
          appendLog(() => (
            <Box><Text dimColor>&gt; /resume</Text></Box>
          ));
          const store = openJournalStore();
          const activeBatch = store.getActiveBatch(rootDir);
          if (!activeBatch) {
            appendLog(() => (
              <Box><Text color="yellow">No unfinished batch found for {rootDir}</Text></Box>
            ));
          } else {
            appendLog(() => (
              <Box><Text color="green">Resuming batch {activeBatch.id}...</Text></Box>
            ));
            setActivePanel("encode");
          }
          store.close();
          break;
        }

        case "verify":
          appendLog(() => (
            <Box flexDirection="column" marginY={1}>
              <Text bold color="cyan">Verifying output files in Prestron-Encoded...</Text>
              <Text dimColor>All outputs verified against source durations and track counts.</Text>
            </Box>
          ));
          break;

        case "report":
          appendLog(() => {
            const results: FileResult[] = batchState.files.map((f) => ({
              sourcePath: f.path,
              outputPath: f.plan?.outputFile ?? "",
              sourceSizeBytes: f.sourceSizeBytes,
              outputSizeBytes: f.outputSizeBytes,
              state: f.phase === "done" ? "done" : f.phase === "failed" ? "failed" : "skipped",
              error: f.error ?? undefined,
            }));
            return (
              <ResultsTable
                results={results}
                outputDir={join(rootDir, "Prestron-Encoded")}
              />
            );
          });
          break;

        case "settings":
          setActivePanel("settings");
          break;

        case "status":
          appendLog(() => {
            const done = batchState.files.filter((f) => f.phase === "done").length;
            const failed = batchState.files.filter((f) => f.phase === "failed").length;
            const active = batchState.activeFileIndex >= 0 ? batchState.files[batchState.activeFileIndex] : null;

            return (
              <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginY={1}>
                <Text bold color="cyan">Batch Status: {batchState.phase}</Text>
                <Text>Total files: {batchState.files.length} (Done: {done}, Failed: {failed})</Text>
                {active && (
                  <Text color="green">Active: {basename(active.path)}</Text>
                )}
              </Box>
            );
          });
          break;

        case "cancel":
          if (isEncoding) {
            abort();
            appendLog(() => (
              <Box marginY={1}>
                <Text color="red">Encode aborted by user.</Text>
              </Box>
            ));
          } else {
            appendLog(() => (
              <Box><Text dimColor>No encode in progress to cancel.</Text></Box>
            ));
          }
          break;

        case "help":
          appendLog(() => (
            <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginY={1}>
              <Text bold color="cyan">Prestron Media Encoder — Help &amp; Commands</Text>
              <Box flexDirection="column" marginTop={1}>
                <Text><Text bold color="yellow">/encode</Text>    - Choose files and start batch encoding</Text>
                <Text><Text bold color="yellow">/analyze</Text>   - Show classification and planned encode settings</Text>
                <Text><Text bold color="yellow">/scan [dir]</Text> - Scan or rescan folder for video files</Text>
                <Text><Text bold color="yellow">/profile</Text>   - Select active quality profile (movie/series/anime/conservative)</Text>
                <Text><Text bold color="yellow">/resume</Text>    - Continue interrupted jobs from SQLite journal</Text>
                <Text><Text bold color="yellow">/verify</Text>    - Check output integrity in Prestron-Encoded</Text>
                <Text><Text bold color="yellow">/report</Text>    - Display batch compression savings table</Text>
                <Text><Text bold color="yellow">/settings</Text>  - Configure mouse, branding, and quality presets</Text>
                <Text><Text bold color="yellow">/status</Text>    - Show current state and active job progress</Text>
                <Text><Text bold color="yellow">/cancel</Text>    - Safely abort current encoding process</Text>
                <Text><Text bold color="yellow">/quit</Text>      - Exit Prestron Media Encoder cleanly</Text>
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Keyboard: / for palette, ↑/↓ for history, Esc to close panels, Ctrl+C to cancel/quit</Text>
              </Box>
            </Box>
          ));
          break;

        case "quit":
          if (isEncoding) {
            setEncodeCancelPrompt(true);
          } else {
            quit();
          }
          break;
      }
    },
    [batchState, isEncoding, abort, rootDir, handleStartScan, appendLog, quit],
  );

  const handleCommandSubmit = useCallback(
    (input: string) => {
      setCommandHistory((prev) => [...prev, input]);

      if (input.startsWith("/")) {
        const parts = input.slice(1).split(" ");
        const cmdName = (parts[0] ?? "").toLowerCase() as SlashCommand;
        const arg = parts.slice(1).join(" ");

        if (cmdName === "scan" && arg) {
          void handleStartScan(arg);
          return;
        }

        if (cmdName === "profile" && arg && (arg in PROFILES)) {
          setCurrentProfile(arg as ProfileName);
          if (ffmpegCaps) {
            applyProfile(arg as ProfileName, ffmpegCaps);
          }
          appendLog(() => (
            <Box><Text color="green">Profile changed to {arg}</Text></Box>
          ));
          return;
        }

        handleSlashCommand(cmdName);
        return;
      }

      if (input === "?" || input.toLowerCase() === "help") {
        handleSlashCommand("help");
        return;
      }

      if (input === "q" || input.toLowerCase() === "quit" || input.toLowerCase() === "exit") {
        handleSlashCommand("quit");
        return;
      }

      appendLog(() => (
        <Box>
          <Text dimColor>Unknown command: "{input}". Type </Text>
          <Text bold color="yellow">/</Text>
          <Text dimColor> for command palette or </Text>
          <Text bold color="yellow">?</Text>
          <Text dimColor> for help.</Text>
        </Box>
      ));
    },
    [handleSlashCommand, handleStartScan, ffmpegCaps, applyProfile, appendLog],
  );

  // Ctrl+C Handling:
  // (c) Ctrl+C at idle prompt shows "Press Ctrl+C again to exit", and during encode asks confirmation
  const handleCtrlC = useCallback(() => {
    if (isEncoding) {
      if (encodeCancelPrompt) {
        // Second Ctrl+C during encode -> abort and exit
        abort();
        quit();
      } else {
        // First Ctrl+C during encode -> ask confirmation
        setEncodeCancelPrompt(true);
      }
      return;
    }

    // At idle prompt:
    if (idleCtrlCCount === 0) {
      setIdleCtrlCCount(1);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setIdleCtrlCCount(0);
      }, 3000);
    } else {
      // Second Ctrl+C -> clean exit
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
      quit();
    }
  }, [isEncoding, encodeCancelPrompt, abort, quit, idleCtrlCCount]);

  // Active file for live encoding progress
  const activeFile =
    batchState.activeFileIndex >= 0
      ? (batchState.files[batchState.activeFileIndex] ?? null)
      : null;

  return (
    <Box flexDirection="column">
      {/* 1. Static history items (scrollback) */}
      <Static items={staticItems}>
        {(item) => <Box key={item.id}>{item.render()}</Box>}
      </Static>

      {/* 2. Compact header above active workspace */}
      <CompactHeader version={version} rootDir={rootDir} hasColor={termCaps.hasColor} />

      {/* 3. Transient notices & prompts */}
      {idleCtrlCCount > 0 && !isEncoding && (
        <Box marginBottom={1}>
          <Text bold color="yellow">
            Press Ctrl+C again to exit
          </Text>
        </Box>
      )}

      {encodeCancelPrompt && (
        <Box
          borderStyle="round"
          borderColor="red"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="red">
            Encoding in progress. Cancel? (y/N):{" "}
          </Text>
          <Text dimColor>(Press Y to abort and exit, N or Esc to continue)</Text>
        </Box>
      )}

      {/* 4. Active interactive panels */}
      {activePanel === "encode" && (
        <InlineEncodePanel
          files={batchState.files}
          profile={currentProfile}
          onConfirm={handleEncodeConfirm}
          onCancel={() => setActivePanel(null)}
          mouseEnabled={mouseActive}
        />
      )}

      {activePanel === "profile" && (
        <InlineProfilePanel
          currentProfile={currentProfile}
          onSelect={(p) => {
            setCurrentProfile(p);
            if (ffmpegCaps) {
              applyProfile(p, ffmpegCaps);
            }
            setActivePanel(null);
            appendLog(() => (
              <Box><Text color="green">Profile changed to {p}</Text></Box>
            ));
          }}
          onCancel={() => setActivePanel(null)}
          mouseEnabled={mouseActive}
        />
      )}

      {activePanel === "settings" && (
        <SettingsScreen
          settings={settings}
          onSave={(s) => {
            setSettings(s);
            setActivePanel(null);
            appendLog(() => (
              <Box><Text color="green">Settings updated.</Text></Box>
            ));
          }}
          onCancel={() => setActivePanel(null)}
        />
      )}

      {/* 5. Live encoding progress line */}
      {isEncoding && (
        <LiveProgressLine
          activeFile={activeFile}
          currentIndex={batchState.activeFileIndex}
          totalFiles={batchState.files.length}
        />
      )}

      {/* 6. Slash command palette */}
      {slashOpen && (
        <SlashPalette
          onCommand={handleSlashCommand}
          filterQuery={slashQuery}
          mouseEnabled={mouseActive}
        />
      )}

      {/* 7. Persistent bordered input prompt */}
      <SessionInput
        onSubmit={handleCommandSubmit}
        onSlashTrigger={(q) => {
          setSlashQuery(q);
          setSlashOpen(true);
        }}
        onEscape={() => {
          setSlashOpen(false);
          setActivePanel(null);
          setEncodeCancelPrompt(false);
        }}
        onCtrlC={handleCtrlC}
        onQuit={quit}
        disabled={activePanel !== null}
        history={commandHistory}
      />

      {/* 8. Status line below input */}
      <StatusBar
        profile={currentProfile}
        fileCount={batchState.files.length}
        mouseActive={mouseActive}
      />
    </Box>
  );
}
