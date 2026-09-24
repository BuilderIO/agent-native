import { describe, expect, it } from "vitest";

import {
  ASK_PIN_SLACK_PX,
  ASK_SHEET_MAX,
  ASK_SHEET_MIN,
  clampAskSheetHeight,
  isPinnedToBottom,
  isSheetGripTap,
  SHEET_DRAG_SLOP_PX,
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

describe("isSheetGripTap", () => {
  // The dismissal used to be gated on whether a drag was in progress, which
  // `click` can never observe: it fires after `pointerup` has already cleared
  // it. So every resize closed the sheet, including one that grew it.
  it("tells a resize apart from the tap that dismisses the sheet", () => {
    expect(isSheetGripTap(0)).toBe(true);
    expect(isSheetGripTap(SHEET_DRAG_SLOP_PX)).toBe(true);
    expect(isSheetGripTap(SHEET_DRAG_SLOP_PX + 1)).toBe(false);
  });

  it("counts travel in either direction", () => {
    // Dragging the sheet taller is the case that made this obvious.
    expect(isSheetGripTap(-40)).toBe(false);
    expect(isSheetGripTap(40)).toBe(false);
  });
});

describe("isPinnedToBottom", () => {
  it("follows the answer while the reader is at the live edge", () => {
    expect(
      isPinnedToBottom({
        scrollHeight: 900,
        scrollTop: 700,
        clientHeight: 200,
      }),
    ).toBe(true);
  });

  it("leaves a reader who scrolled up where they are", () => {
    expect(
      isPinnedToBottom({
        scrollHeight: 900,
        scrollTop: 100,
        clientHeight: 200,
      }),
    ).toBe(false);
  });

  it("allows slack so a part-scrolled line still counts as the edge", () => {
    expect(
      isPinnedToBottom({
        scrollHeight: 900,
        scrollTop: 700 - ASK_PIN_SLACK_PX,
        clientHeight: 200,
      }),
    ).toBe(true);
  });

  it("treats a container with nothing to scroll as pinned", () => {
    expect(
      isPinnedToBottom({ scrollHeight: 0, scrollTop: 0, clientHeight: 0 }),
    ).toBe(true);
  });
});
