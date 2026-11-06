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
import { readdir, stat } from "node:fs/promises";

import { restoreTerminal, enableMouse, disableMouse } from "../platform/terminal.js";
import { detectCapabilities as detectTerminal } from "../platform/capabilities.js";
import {
  detectCapabilities as detectFfmpeg,
  type FfmpegCapabilities,
  type ProcessRunner,
} from "../core/ffmpeg/capabilities.js";
import { runSampleEncode } from "../core/ffmpeg/sampleRunner.js";
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
import { FilesScreen } from "./components/FilesScreen.js";
import { InfoScreen } from "./components/InfoScreen.js";
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

type ActivePanel = "encode" | "profile" | "settings" | "files" | "info" | null;

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
  const [selectedInfoIndex, setSelectedInfoIndex] = useState<number>(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [commandInput, setCommandInput] = useState("");
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
          currentProfile={currentProfile}
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
      const scannedFiles = await startScan(resolved);
      if (ffmpegCaps) {
        applyProfile(currentProfile, ffmpegCaps);
      }
      appendLog(() => (
        <StartupCard
          rootDir={resolved}
          files={scannedFiles}
          ffmpegCaps={ffmpegCaps}
          currentProfile={currentProfile}
        />
      ));
    },
    [startScan, ffmpegCaps, currentProfile, applyProfile, appendLog],
  );

  const handleEncodeConfirm = useCallback(
    (selectedPaths: string[]) => {
      setActivePanel(null);
      if (!ffmpegCaps) return;

      appendLog(() => (
        <Box>
          <Text color="cyan">&gt; /encode </Text>
          <Text dimColor>({String(selectedPaths.length)} files selected)</Text>
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
          if (isEncoding) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">An encode job is already in progress. Use /status to view progress or /cancel to abort.</Text>
              </Box>
            ));
          } else if (batchState.phase === "scanning" || batchState.phase === "probing") {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">Scanning and probing files in progress... please wait a moment before encoding.</Text>
              </Box>
            ));
          } else if (batchState.files.length === 0) {
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
          appendLog(() => {
            if (batchState.phase === "scanning" || batchState.phase === "probing") {
              return (
                <Box marginY={1}>
                  <Text color="yellow">Scanning and probing files in progress... please wait a moment.</Text>
                </Box>
              );
            }
            if (batchState.files.length === 0) {
              return (
                <Box marginY={1} borderStyle="single" borderColor="blue" paddingX={1} flexDirection="column">
                  <Text bold color="blue">File Analysis &amp; Plans:</Text>
                  <Text dimColor>No video files found in {rootDir}. Run /scan &lt;folder&gt; first.</Text>
                </Box>
              );
            }

            const reencodeCount = batchState.files.filter((f) => f.plan?.videoAction === "encode").length;
            const copyCount = batchState.files.filter((f) => f.plan?.videoAction === "copy").length;

            const DISPLAY_LIMIT = 8;
            const shownFiles = batchState.files.slice(0, DISPLAY_LIMIT);
            const remainingCount = batchState.files.length - shownFiles.length;

            return (
              <Box flexDirection="column" marginY={1} borderStyle="single" borderColor="blue" paddingX={1}>
                <Text bold color="blue">File Analysis &amp; Plans ({String(batchState.files.length)} files):</Text>
                <Text dimColor>Profile: {currentProfile} │ {String(reencodeCount)} to re-encode, {String(copyCount)} to copy passthrough</Text>
                <Box marginY={0} />
                {shownFiles.map((f, i) => {
                  const name = basename(f.path);
                  const isCopy = f.plan?.videoAction === "copy";
                  const targetDesc = f.plan
                    ? isCopy
                      ? "copy (passthrough — no quality loss)"
                      : `${f.plan.profile.codec} CRF ${String(f.plan.profile.crf)} preset ${f.plan.profile.preset}`
                    : "Analyzing...";
                  const reason = f.plan?.reasons[0] ?? "";
                  return (
                    <Box key={i} flexDirection="column" marginY={0}>
                      <Box>
                        <Text bold color="white">{name}</Text>
                        <Text color={isCopy ? "green" : "cyan"}> → {targetDesc}</Text>
                      </Box>
                      {reason !== "" && <Text dimColor>  ↳ {reason}</Text>}
                    </Box>
                  );
                })}
                {remainingCount > 0 && (
                  <Box marginTop={1}>
                    <Text dimColor>… and {String(remainingCount)} more files (run /encode to inspect full interactive checklist)</Text>
                  </Box>
                )}
              </Box>
            );
          });
          break;

        case "files":
          if (batchState.files.length === 0) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">No video files found in {rootDir}. Run /scan &lt;folder&gt; first.</Text>
              </Box>
            ));
          } else {
            setActivePanel("files");
          }
          break;

        case "info":
          if (batchState.files.length === 0) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">No video files found in {rootDir}. Run /scan &lt;folder&gt; first.</Text>
              </Box>
            ));
          } else {
            setSelectedInfoIndex(0);
            setActivePanel("info");
          }
          break;

        case "calibrate": {
          if (batchState.files.length === 0) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">No video files found in {rootDir}. Run /scan &lt;folder&gt; first.</Text>
              </Box>
            ));
            break;
          }
          if (isEncoding) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">An encode job is already running.</Text>
              </Box>
            ));
            break;
          }
          if (!ffmpegCaps) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">FFmpeg capabilities not ready yet.</Text>
              </Box>
            ));
            break;
          }

          const targetFile = batchState.files.find((f) => f.mediaInfo && f.plan?.videoAction === "encode") ?? batchState.files[0];
          const media = targetFile?.mediaInfo;
          const plan = targetFile?.plan;

          if (!targetFile || !media || !plan) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">No suitable video files found to run calibration sample.</Text>
              </Box>
            ));
            break;
          }

          appendLog(() => (
            <Box flexDirection="column" marginY={1}>
              <Text bold color="cyan">&gt; /calibrate: Running 20s sample encode on {basename(targetFile.path)}...</Text>
              <Text dimColor>Measuring real-world encoder compression ratio &amp; speed to calibrate local estimates.</Text>
            </Box>
          ));

          void (async () => {
            const store = openJournalStore();
            try {
              const result = await runSampleEncode(
                media,
                plan,
                ffmpegCaps,
                store,
                { ffmpegPath, ffprobePath },
              );
              const savedPct = Math.round((1 - result.measuredCompressionRatio) * 100);
              appendLog(() => (
                <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginY={1}>
                  <Text bold color="green">✔ Calibration Completed!</Text>
                  <Text>Source: <Text bold>{basename(result.sourcePath)}</Text></Text>
                  <Text>Sample Duration: {String(result.sampleDurationSecs)}s │ Encode Time: {(result.encodeTimeMs / 1000).toFixed(1)}s ({result.encodeSpeed})</Text>
                  <Text>Measured Output Ratio: <Text bold color="cyan">{String(result.measuredCompressionRatio)}</Text> (saves ~{String(savedPct)}% storage)</Text>
                  <Text>Measured Video Ratio: <Text bold color="magenta">{String(result.measuredVideoCompressionRatio)}</Text></Text>
                  <Text dimColor>Recorded to local journal. Future estimates for matching files are now calibrated.</Text>
                </Box>
              ));
            } catch (err) {
              appendLog(() => (
                <Box marginY={1}>
                  <Text color="red">Calibration sample failed: {err instanceof Error ? err.message : String(err)}</Text>
                </Box>
              ));
            } finally {
              store.close();
            }
          })();
          break;
        }

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
          if (isEncoding) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">An encode job is already running.</Text>
              </Box>
            ));
            break;
          }
          const store = openJournalStore();
          const activeBatch = store.getActiveBatch(rootDir);
          if (!activeBatch) {
            appendLog(() => (
              <Box marginY={1} flexDirection="column">
                <Text color="yellow">No unfinished batch found in journal for {rootDir}</Text>
                <Text dimColor>Type /encode to start a new encoding batch.</Text>
              </Box>
            ));
          } else {
            const pendingJobs = store.getJobsForBatch(activeBatch.id).filter(
              (j) => j.state === "pending" || j.state === "encoding",
            );
            appendLog(() => (
              <Box flexDirection="column" marginY={1}>
                <Text color="green">Found interrupted batch {activeBatch.id} ({String(pendingJobs.length)} unfinished job(s)).</Text>
                <Text dimColor>Resuming encoding...</Text>
              </Box>
            ));
            if (pendingJobs.length > 0 && ffmpegCaps) {
              const pendingPaths = new Set(pendingJobs.map((j) => j.sourcePath));
              const indices = batchState.files
                .map((f, idx) => (pendingPaths.has(f.path) ? idx : -1))
                .filter((idx) => idx >= 0);
              if (indices.length > 0) {
                void startEncoding(indices, ffmpegCaps);
              } else {
                setActivePanel("encode");
              }
            } else {
              setActivePanel("encode");
            }
          }
          store.close();
          break;
        }

        case "verify": {
          appendLog(() => (
            <Box><Text dimColor>&gt; /verify</Text></Box>
          ));
          const encodedDir = join(rootDir, "Prestron-Encoded");
          void (async () => {
            try {
              const entries = await readdir(encodedDir, { withFileTypes: true });
              const mkvFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".mkv"));
              if (mkvFiles.length === 0) {
                appendLog(() => (
                  <Box marginY={1} flexDirection="column">
                    <Text color="yellow">No encoded video files found in Prestron-Encoded/ to verify.</Text>
                    <Text dimColor>Directory: {encodedDir}</Text>
                  </Box>
                ));
                return;
              }

              const verifiedItems: { name: string; size: string; status: string; ok: boolean }[] = [];
              for (const f of mkvFiles) {
                const fullPath = join(encodedDir, f.name);
                const s = await stat(fullPath);
                const sizeMb = (s.size / (1024 * 1024)).toFixed(1);
                if (s.size > 0) {
                  verifiedItems.push({
                    name: f.name,
                    size: `${sizeMb} MB`,
                    status: "Valid output (non-empty container)",
                    ok: true,
                  });
                } else {
                  verifiedItems.push({
                    name: f.name,
                    size: "0 B",
                    status: "Corrupt output (0 bytes)",
                    ok: false,
                  });
                }
              }

              appendLog(() => (
                <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginY={1}>
                  <Text bold color="cyan">Output Verification ({String(verifiedItems.length)} files in Prestron-Encoded/):</Text>
                  {verifiedItems.map((item, idx) => (
                    <Box key={idx}>
                      <Text bold color={item.ok ? "green" : "red"}>{item.ok ? "✔ " : "✖ "}</Text>
                      <Text bold>{item.name.padEnd(32).slice(0, 32)} </Text>
                      <Text color="blue">{item.size.padEnd(10)} </Text>
                      <Text color={item.ok ? "green" : "red"}>{item.status}</Text>
                    </Box>
                  ))}
                </Box>
              ));
            } catch {
              appendLog(() => (
                <Box marginY={1} flexDirection="column">
                  <Text color="yellow">Prestron-Encoded directory does not exist yet for this folder.</Text>
                  <Text dimColor>Run /encode to process files first.</Text>
                </Box>
              ));
            }
          })();
          break;
        }

        case "report":
          appendLog(() => {
            const finishedFiles = batchState.files.filter((f) => f.phase === "done" || f.phase === "failed");
            if (finishedFiles.length === 0) {
              return (
                <Box marginY={1} borderStyle="single" borderColor="cyan" paddingX={1} flexDirection="column">
                  <Text bold color="cyan">Batch Report:</Text>
                  <Text dimColor>No encoding jobs have been executed yet in this session.</Text>
                  <Text dimColor>Run /encode to select and encode files first.</Text>
                </Box>
              );
            }

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
            const pending = batchState.files.filter((f) => f.phase === "pending").length;
            const done = batchState.files.filter((f) => f.phase === "done").length;
            const failed = batchState.files.filter((f) => f.phase === "failed").length;
            const active = batchState.activeFileIndex >= 0 ? batchState.files[batchState.activeFileIndex] : null;

            return (
              <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} marginY={1}>
                <Text bold color="cyan">Prestron Status: {batchState.phase.toUpperCase()}</Text>
                <Text>Directory: <Text bold>{rootDir}</Text></Text>
                <Text>Active Profile: <Text bold color="green">{currentProfile}</Text></Text>
                <Text>Total files: {String(batchState.files.length)} │ Done: {String(done)} │ Pending: {String(pending)} │ Failed: {String(failed)}</Text>
                {active && (
                  <Text color="green">Currently encoding: {basename(active.path)}</Text>
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
          } else if (activePanel !== null) {
            setActivePanel(null);
            appendLog(() => (
              <Box marginY={1}>
                <Text dimColor>Closed active panel.</Text>
              </Box>
            ));
          } else {
            appendLog(() => (
              <Box marginY={1}>
                <Text dimColor>No encode or panel in progress to cancel.</Text>
              </Box>
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
                <Text><Text bold color="yellow">/files</Text>     - Browse all files with estimates &amp; recommendations</Text>
                <Text><Text bold color="yellow">/info [n]</Text>   - Deep inspection of streams, reasons &amp; settings</Text>
                <Text><Text bold color="yellow">/calibrate</Text>  - Run quick 20s sample to measure real compression</Text>
                <Text><Text bold color="yellow">/scan [dir]</Text> - Scan or rescan folder for video files</Text>
                <Text><Text bold color="yellow">/profile [p]</Text>- Select active quality profile (movie/series/anime/conservative)</Text>
                <Text><Text bold color="yellow">/resume</Text>    - Continue interrupted jobs from SQLite journal</Text>
                <Text><Text bold color="yellow">/verify</Text>    - Check output integrity in Prestron-Encoded</Text>
                <Text><Text bold color="yellow">/report</Text>    - Display batch compression savings table</Text>
                <Text><Text bold color="yellow">/settings</Text>  - Configure mouse, branding, and quality presets</Text>
                <Text><Text bold color="yellow">/status</Text>    - Show current state and active job progress</Text>
                <Text><Text bold color="yellow">/cancel</Text>    - Safely abort current encode or close panel</Text>
                <Text><Text bold color="yellow">/quit</Text>      - Exit Prestron Media Encoder cleanly</Text>
              </Box>
              <Box marginTop={1}>
                <Text dimColor>Keyboard: / for palette, Tab to complete, ↑/↓ for history, Esc to close panels, Ctrl+C to cancel/quit</Text>
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
      setCommandInput("");
      setSlashOpen(false);

      if (input.startsWith("/")) {
        const withoutSlash = input.slice(1).trim();
        const firstSpace = withoutSlash.indexOf(" ");
        const rawCmd = (firstSpace === -1 ? withoutSlash : withoutSlash.slice(0, firstSpace)).toLowerCase();
        let arg = (firstSpace === -1 ? "" : withoutSlash.slice(firstSpace + 1)).trim();
        // Strip enclosing quotes from paths (e.g. "C:\Path with spaces" -> C:\Path with spaces)
        arg = arg.replace(/^["']|["']$/g, "").trim();

        if (rawCmd === "scan") {
          if (arg) {
            void handleStartScan(arg);
          } else {
            void handleStartScan(rootDir);
          }
          return;
        }

        if (rawCmd === "analyze" || rawCmd === "analyse") {
          if (arg) {
            void handleStartScan(arg).then(() => {
              handleSlashCommand("analyze");
            });
          } else {
            handleSlashCommand("analyze");
          }
          return;
        }

        if (rawCmd === "profile") {
          if (arg) {
            if (arg in PROFILES) {
              setCurrentProfile(arg as ProfileName);
              if (ffmpegCaps) {
                applyProfile(arg as ProfileName, ffmpegCaps);
              }
              appendLog(() => (
                <Box><Text color="green">Profile changed to {arg}</Text></Box>
              ));
            } else {
              appendLog(() => (
                <Box flexDirection="column" marginY={1}>
                  <Text color="yellow">Unknown profile: "{arg}"</Text>
                  <Text dimColor>Valid profiles: series, movie, anime, conservative</Text>
                </Box>
              ));
            }
          } else {
            handleSlashCommand("profile");
          }
          return;
        }

        if (rawCmd === "files") {
          handleSlashCommand("files");
          return;
        }

        if (rawCmd === "info") {
          if (batchState.files.length === 0) {
            appendLog(() => (
              <Box marginY={1}>
                <Text color="yellow">No video files found in {rootDir}. Run /scan &lt;folder&gt; first.</Text>
              </Box>
            ));
            return;
          }

          if (arg) {
            // Check if arg is a 1-based index
            const parsedNum = parseInt(arg.replace(/^#/, ""), 10);
            if (!Number.isNaN(parsedNum) && parsedNum >= 1 && parsedNum <= batchState.files.length) {
              setSelectedInfoIndex(parsedNum - 1);
              setActivePanel("info");
              return;
            }

            // Check if arg matches a filename
            const lowerArg = arg.toLowerCase();
            const matchedIdx = batchState.files.findIndex((f) =>
              basename(f.path).toLowerCase().includes(lowerArg),
            );
            if (matchedIdx >= 0) {
              setSelectedInfoIndex(matchedIdx);
              setActivePanel("info");
              return;
            }

            appendLog(() => (
              <Box flexDirection="column" marginY={1}>
                <Text color="yellow">No file matching "{arg}".</Text>
                <Text dimColor>Usage: /info &lt;index (1..{String(batchState.files.length)})&gt; or /info &lt;filename&gt;</Text>
              </Box>
            ));
            return;
          }

          setSelectedInfoIndex(0);
          setActivePanel("info");
          return;
        }

        if (rawCmd === "calibrate") {
          handleSlashCommand("calibrate");
          return;
        }

        handleSlashCommand(rawCmd as SlashCommand);
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
    [handleSlashCommand, handleStartScan, ffmpegCaps, applyProfile, appendLog, rootDir],
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

      {activePanel === "files" && (
        <FilesScreen
          files={batchState.files}
          currentProfile={currentProfile}
          onSelectFile={(idx) => {
            setSelectedInfoIndex(idx);
            setActivePanel("info");
          }}
          onClose={() => setActivePanel(null)}
          mouseEnabled={mouseActive}
        />
      )}

      {activePanel === "info" && batchState.files.length > 0 && batchState.files[Math.min(selectedInfoIndex, batchState.files.length - 1)] && (
        <InfoScreen
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          file={batchState.files[Math.min(selectedInfoIndex, batchState.files.length - 1)]!}
          fileIndex={Math.min(selectedInfoIndex, batchState.files.length - 1)}
          totalFiles={batchState.files.length}
          currentProfile={currentProfile}
          onClose={() => setActivePanel("files")}
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
          onCommand={(cmd) => {
            if (cmd) {
              setSlashOpen(false);
              setCommandInput("");
              handleSlashCommand(cmd);
            } else {
              setSlashOpen(false);
            }
          }}
          onComplete={(cmd) => {
            setSlashOpen(false);
            setCommandInput(`/${cmd} `);
          }}
          filterQuery={slashQuery}
          mouseEnabled={mouseActive}
        />
      )}

      {/* 7. Persistent bordered input prompt */}
      <SessionInput
        value={commandInput}
        onChange={setCommandInput}
        onSubmit={handleCommandSubmit}
        onSlashTrigger={(q) => {
          setSlashQuery(q);
          setSlashOpen(true);
        }}
        onSlashClose={() => {
          setSlashOpen(false);
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
