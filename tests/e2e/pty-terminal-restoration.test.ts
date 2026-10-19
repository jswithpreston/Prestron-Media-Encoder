/**
 * E2E pseudo-terminal tests for terminal restoration.
 *
 * These tests launch the interactive Ink UI inside a real pseudo-terminal
 * (via node-pty), send keystrokes and signals, and assert that the terminal
 * is restored on every exit path:
 *   - cursor visible (`\x1b[?25h`)
 *   - mouse tracking disabled (`\x1b[?1006l`, `\x1b[?1002l`, `\x1b[?1000l`)
 *
 * Runs on the built dist binary so it exercises the real entry point.
 *
 * Note: node-pty's `exit` event does not fire until the master side is
 * closed, so we wait for restoration escape sequences in the output rather
 * than the exit event, then kill the pty to clean up.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execa } from "execa";
import pty from "node-pty";

const BIN = `${process.cwd()}/dist/bin/prestron.js`;

interface PtySession {
  pty: pty.IPty;
  getOutput: () => string;
}

function createPtySession(args: string[]): PtySession {
  const outputChunks: string[] = [];

  const ptyProcess = pty.spawn("node", [BIN, ...args], {
    name: "xterm-256color",
    cols: 100,
    rows: 40,
    cwd: process.cwd(),
    env: {
      ...process.env,
      FORCE_COLOR: "1",
      TERM: "xterm-256color",
    },
  });

  ptyProcess.on("data", (data: string) => {
    outputChunks.push(data);
  });

  return {
    pty: ptyProcess,
    getOutput: () => outputChunks.join(""),
  };
}

function waitForOutput(session: PtySession, needle: string, timeoutMs = 15000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const out = session.getOutput();
      if (out.includes(needle)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for output: ${needle}\nOutput so far: ${JSON.stringify(out.slice(-200))}`,
          ),
        );
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

function endsWithRestoration(output: string): boolean {
  const hasCursorShow = output.includes("\x1b[?25h");
  const hasMouseDisable =
    output.includes("\x1b[?1006l") &&
    output.includes("\x1b[?1002l") &&
    output.includes("\x1b[?1000l");
  return hasCursorShow && hasMouseDisable;
}

async function sendAndWaitForRestore(
  session: PtySession,
  input: string,
  timeoutMs = 10000,
): Promise<string> {
  session.pty.write(input);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const out = session.getOutput();
      if (endsWithRestoration(out)) {
        resolve(out);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(
          new Error(
            `Timed out waiting for restoration after input: ${JSON.stringify(input)}\nOutput: ${JSON.stringify(out.slice(-200))}`,
          ),
        );
        return;
      }
      setTimeout(check, 50);
    };
    check();
  });
}

describe("PTY terminal restoration", () => {
  let tmpDir: string;

  beforeAll(async () => {
    tmpDir = await mkdtemp(`${tmpdir()}/prestron-pty-test-XXXXXX`);
    await mkdir(`${tmpDir}/Prestron-Encoded`, { recursive: true });
    // Generate a real ~15s video so an encode stays active long enough to
    // interrupt with SIGHUP mid-encode.
    await execa(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=duration=15:size=640x360:rate=30",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=15",
        "-c:v",
        "libx264",
        "-crf",
        "23",
        "-preset",
        "ultrafast",
        "-c:a",
        "aac",
        `${tmpDir}/test.mkv`,
        "-y",
      ],
      { stdio: "ignore" },
    );
  });

  afterAll(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("restores terminal on 'q' quit (cursor show, mouse disabled)", async () => {
    const session = createPtySession([tmpDir]);

    await waitForOutput(session, "Folder:", 15000);

    const output = await sendAndWaitForRestore(session, "q");

    expect(endsWithRestoration(output)).toBe(true);
    session.pty.kill();
  }, 30000);

  it("restores terminal on SIGHUP signal (terminal window closed)", async () => {
    const session = createPtySession([tmpDir]);

    await waitForOutput(session, "Folder:", 15000);

    session.pty.kill("SIGHUP");

    const output = await new Promise<string>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const out = session.getOutput();
        if (endsWithRestoration(out)) {
          resolve(out);
          return;
        }
        if (Date.now() - start > 10000) {
          reject(
            new Error(
              `Timed out waiting for restoration after SIGHUP\nOutput: ${JSON.stringify(out.slice(-200))}`,
            ),
          );
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });

    expect(endsWithRestoration(output)).toBe(true);
    session.pty.kill();
  }, 30000);

  it("restores terminal on SIGINT signal (Ctrl+C)", async () => {
    const session = createPtySession([tmpDir]);

    await waitForOutput(session, "Folder:", 15000);

    session.pty.kill("SIGINT");

    const output = await new Promise<string>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        const out = session.getOutput();
        if (endsWithRestoration(out)) {
          resolve(out);
          return;
        }
        if (Date.now() - start > 10000) {
          reject(
            new Error(
              `Timed out waiting for restoration after SIGINT\nOutput: ${JSON.stringify(out.slice(-200))}`,
            ),
          );
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });

    expect(endsWithRestoration(output)).toBe(true);
    session.pty.kill();
  }, 30000);

  it("accepts mouse SGR sequences and disables mouse tracking on exit", async () => {
    const session = createPtySession([tmpDir]);

    await waitForOutput(session, "Folder:", 15000);

    // Send an SGR mouse press event (left button at col 10, row 5).
    // Ink consumes mouse events (they are not echoed), so we only assert
    // that terminal restoration still occurs after mouse input was received.
    session.pty.write("\x1b[<37;10;5M");

    // Brief delay so the mouse sequence is processed before 'q'
    await new Promise((r) => setTimeout(r, 200));

    const output = await sendAndWaitForRestore(session, "q");

    const mouseDisableIdx = output.lastIndexOf("\x1b[?1006l");
    expect(mouseDisableIdx).toBeGreaterThan(-1);
    expect(endsWithRestoration(output)).toBe(true);
    session.pty.kill();
  }, 30000);

  it("SIGHUP during an active encode kills ffmpeg and removes the .part file", async () => {
    const session = createPtySession(["encode", tmpDir, "--yes"]);

    // Wait until the encode is actively running (ffmpeg spawned).
    await waitForOutput(session, "Encoding:", 30000);

    // ffmpeg must be running mid-encode before we hang up the terminal.
    const before = await execa("pgrep", ["-x", "ffmpeg"], { reject: false });
    expect(before.stdout.trim()).not.toBe("");

    // Simulate the terminal window being closed (SIGHUP).
    session.pty.kill("SIGHUP");

    // Give cleanup (SIGTERM ffmpeg, unlink .part) time to run.
    await new Promise((r) => setTimeout(r, 2000));

    // No ffmpeg process may remain orphaned after the hangup.
    const after = await execa("pgrep", ["-x", "ffmpeg"], { reject: false });
    expect(after.stdout.trim()).toBe("");

    // No .part file may be left behind in Prestron-Encoded.
    const encoded = await readdir(`${tmpDir}/Prestron-Encoded`);
    const partFiles = encoded.filter((f) => f.endsWith(".part"));
    expect(partFiles).toHaveLength(0);

    session.pty.kill();
  }, 40000);
});
