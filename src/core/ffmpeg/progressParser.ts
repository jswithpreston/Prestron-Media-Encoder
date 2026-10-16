/**
 * FFmpeg progress parser.
 *
 * Parses the `-progress pipe:1` output format from ffmpeg, which emits
 * newline-delimited `key=value` pairs terminated by a `progress=continue`
 * or `progress=end` line after each encoded frame.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EncodeProgress {
  /** Elapsed output time in seconds (from out_time_ms, which is in microseconds). */
  outTimeSecs: number;
  /** Current encode frames per second. */
  fps: number;
  /** Encode speed multiplier (e.g. 2.3 means 2.3× real-time). */
  speed: number;
  /** Current output file size in bytes. */
  totalSizeBytes: number;
  /** Percentage done: outTimeSecs / sourceDurationSecs * 100, clamped [0, 100]. */
  percentDone: number;
}

// ---------------------------------------------------------------------------
// ProgressParser
// ---------------------------------------------------------------------------

/**
 * Stateful parser that accumulates streaming stdout from ffmpeg -progress pipe:1.
 *
 * Lines may arrive in incomplete chunks (partial lines), so we buffer them
 * until a `progress=continue` or `progress=end` frame-boundary line appears.
 * Each complete frame yields one EncodeProgress.
 */
export class ProgressParser {
  private readonly sourceDurationSecs: number;
  /** Accumulates incomplete line data between feed() calls. */
  private leftover = "";
  /** Current frame key-value pairs. */
  private frame: Record<string, string> = {};

  constructor(sourceDurationSecs: number) {
    this.sourceDurationSecs = sourceDurationSecs;
  }

  /**
   * Feed a chunk of text (stdout data from ffmpeg) into the parser.
   *
   * Returns an array of parsed EncodeProgress objects (one per completed frame).
   * An empty array means no complete frames were seen in this chunk.
   */
  feed(chunk: string): EncodeProgress[] {
    const results: EncodeProgress[] = [];
    // Prepend any leftover from previous chunk
    const data = this.leftover + chunk;
    const lines = data.split("\n");

    // The last element may be an incomplete line — save it for next call
    this.leftover = lines[lines.length - 1] ?? "";

    // Process all complete lines (all but the last)
    for (let i = 0; i < lines.length - 1; i++) {
      const line = (lines[i] ?? "").trim();
      if (!line) continue;

      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) continue;

      const key = line.slice(0, eqIdx).trim();
      const value = line.slice(eqIdx + 1).trim();

      if (key === "progress") {
        // Frame boundary — emit accumulated frame if we have data
        const progress = this.buildProgress();
        if (progress !== null) {
          results.push(progress);
        }
        // Reset frame accumulator
        this.frame = {};
      } else {
        this.frame[key] = value;
      }
    }

    return results;
  }

  /** Reset internal state (e.g. for reuse after an error). */
  reset(): void {
    this.leftover = "";
    this.frame = {};
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildProgress(): EncodeProgress | null {
    // ffmpeg -progress emits out_time_ms in microseconds (despite the name)
    const rawOutTimeMs = this.frame["out_time_ms"];
    if (rawOutTimeMs === undefined) return null;

    const outTimeMicros = parseFloat(rawOutTimeMs);
    const outTimeSecs = isNaN(outTimeMicros) ? 0 : outTimeMicros / 1_000_000;

    const fps = parseFloat(this.frame["fps"] ?? "0");
    const speedRaw = (this.frame["speed"] ?? "0").replace("x", "");
    const speed = parseFloat(speedRaw);
    const totalSizeBytes = parseInt(this.frame["total_size"] ?? "0", 10);

    let percentDone = 0;
    if (this.sourceDurationSecs > 0) {
      percentDone = (outTimeSecs / this.sourceDurationSecs) * 100;
    }
    // Clamp to [0, 100]
    percentDone = Math.min(100, Math.max(0, percentDone));

    return {
      outTimeSecs,
      fps: isNaN(fps) ? 0 : fps,
      speed: isNaN(speed) ? 0 : speed,
      totalSizeBytes: isNaN(totalSizeBytes) ? 0 : totalSizeBytes,
      percentDone,
    };
  }
}
