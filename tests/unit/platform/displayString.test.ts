import { describe, it, expect } from "vitest";
import {
  getDisplayWidth,
  truncateDisplay,
  padDisplayEnd,
  fitDisplay,
} from "../../../src/platform/displayString.js";

describe("displayString utilities", () => {
  it("computes visual display width accurately", () => {
    expect(getDisplayWidth("hello")).toBe(5);
    // Full-width colon '：' takes 2 columns
    expect(getDisplayWidth("：")).toBe(2);
    expect(getDisplayWidth("96 Years of WISDOM： The 3 Le")).toBe(29);
  });

  it("truncates with display-width aware ellipsis", () => {
    const raw = "96 Years of WISDOM： The 3 Lessons";
    const truncated = truncateDisplay(raw, 20);
    // Total visual display width must be <= 20
    expect(getDisplayWidth(truncated)).toBeLessThanOrEqual(20);
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("pads end to exact terminal cell width", () => {
    const s1 = "hello";
    const padded1 = padDisplayEnd(s1, 10);
    expect(getDisplayWidth(padded1)).toBe(10);

    const s2 = "WISDOM："; // 6 ASCII (6) + 1 full-width (2) = 8 cells
    const padded2 = padDisplayEnd(s2, 12);
    expect(getDisplayWidth(padded2)).toBe(12);
  });

  it("fits exactly into specified column width", () => {
    const title = "96 Years of WISDOM： The 3 Lessons";
    const fitted = fitDisplay(title, 25);
    expect(getDisplayWidth(fitted)).toBe(25);

    const short = "Pilot";
    const fittedShort = fitDisplay(short, 25);
    expect(getDisplayWidth(fittedShort)).toBe(25);
  });
});
