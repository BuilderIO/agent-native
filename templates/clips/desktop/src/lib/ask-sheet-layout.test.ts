import { describe, expect, it } from "vitest";

import {
  ASK_SHEET_MAX,
  ASK_SHEET_MIN,
  clampAskSheetHeight,
  TRANSCRIPT_MIN_PX,
} from "./ask-sheet-layout";

describe("clampAskSheetHeight", () => {
  it("keeps a drag inside the allowed range", () => {
    expect(clampAskSheetHeight(0.5, 600)).toBeCloseTo(0.5);
    expect(clampAskSheetHeight(0.95, 600)).toBeCloseTo(ASK_SHEET_MAX);
    expect(clampAskSheetHeight(0.02, 600)).toBeCloseTo(ASK_SHEET_MIN);
  });

  it("leaves the transcript its floor on a short panel", () => {
    // 260px is the panel's own minimum, where 70% would leave the feed 78px —
    // less than two lines, which is the state that read as "cut off".
    const height = clampAskSheetHeight(ASK_SHEET_MAX, 260);
    expect(height * 260).toBeLessThanOrEqual(260 - TRANSCRIPT_MIN_PX);
    expect(260 - height * 260).toBeGreaterThanOrEqual(TRANSCRIPT_MIN_PX);
  });

  it("never collapses the sheet below its own minimum", () => {
    // A panel too short for both keeps the sheet usable and lets the transcript
    // scroll: silently reopening at zero height would look like a dead sheet.
    expect(clampAskSheetHeight(0.5, 120)).toBeCloseTo(ASK_SHEET_MIN);
  });

  it("falls back to the ceiling when the panel has not been measured", () => {
    expect(clampAskSheetHeight(0.9, 0)).toBeCloseTo(ASK_SHEET_MAX);
  });
});
