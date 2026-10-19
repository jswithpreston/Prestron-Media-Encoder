/**
 * Unit tests for useMouse SGR parser (pure function, no React/Ink needed).
 */

import { describe, it, expect } from "vitest";
import { parseSgrMouseEvent } from "../../../src/ui/hooks/useMouse.js";

describe("parseSgrMouseEvent", () => {
  it("parses left button press", () => {
    const evt = parseSgrMouseEvent("\x1b[<0;10;5M");
    expect(evt).not.toBeNull();
    expect(evt?.button).toBe("left");
    expect(evt?.type).toBe("press");
    expect(evt?.col).toBe(10);
    expect(evt?.row).toBe(5);
  });

  it("parses left button release", () => {
    const evt = parseSgrMouseEvent("\x1b[<0;10;5m");
    expect(evt?.button).toBe("left");
    expect(evt?.type).toBe("release");
  });

  it("parses middle button press", () => {
    const evt = parseSgrMouseEvent("\x1b[<1;3;3M");
    expect(evt?.button).toBe("middle");
    expect(evt?.type).toBe("press");
  });

  it("parses right button press", () => {
    const evt = parseSgrMouseEvent("\x1b[<2;1;1M");
    expect(evt?.button).toBe("right");
  });

  it("parses wheel up (button code 64)", () => {
    const evt = parseSgrMouseEvent("\x1b[<64;5;5M");
    expect(evt?.button).toBe("wheelUp");
    expect(evt?.type).toBe("press");
  });

  it("parses wheel down (button code 65)", () => {
    const evt = parseSgrMouseEvent("\x1b[<65;5;5M");
    expect(evt?.button).toBe("wheelDown");
  });

  it("parses motion event (button code 32)", () => {
    const evt = parseSgrMouseEvent("\x1b[<32;20;10M");
    expect(evt?.button).toBe("motion");
    expect(evt?.type).toBe("motion");
  });

  it("returns null for non-SGR sequences", () => {
    expect(parseSgrMouseEvent("\x1b[A")).toBeNull();
    expect(parseSgrMouseEvent("hello")).toBeNull();
    expect(parseSgrMouseEvent("")).toBeNull();
  });

  it("returns null for incomplete sequences", () => {
    expect(parseSgrMouseEvent("\x1b[<0;10")).toBeNull();
    expect(parseSgrMouseEvent("\x1b[<0;10;")).toBeNull();
  });

  it("parses large coordinates correctly", () => {
    const evt = parseSgrMouseEvent("\x1b[<0;100;50M");
    expect(evt?.col).toBe(100);
    expect(evt?.row).toBe(50);
  });
});
