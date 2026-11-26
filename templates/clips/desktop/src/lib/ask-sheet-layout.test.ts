// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  ASK_PIN_SLACK_PX,
  ASK_SHEET_DEFAULT,
  ASK_SHEET_MAX,
  ASK_SHEET_MIN,
  clampAskSheetHeight,
  isPinnedToBottom,
  isSheetGripTap,
  measureAskSheetPanel,
  SHEET_DRAG_SLOP_PX,
  TRANSCRIPT_MIN_PX,
} from "./ask-sheet-layout";

const MIN_WINDOW_PX = 260;
const HEADER_PX = 44;
const SHORTEST_PANEL_PX = MIN_WINDOW_PX - HEADER_PX;
const DIVIDER_PX = 1;

describe("clampAskSheetHeight", () => {
  it("keeps a drag inside the allowed range", () => {
    expect(clampAskSheetHeight(0.5, 600)).toBeCloseTo(0.5);
    expect(clampAskSheetHeight(0.95, 600)).toBeCloseTo(ASK_SHEET_MAX);
    expect(clampAskSheetHeight(0.02, 600)).toBeCloseTo(ASK_SHEET_MIN);
  });

  it.each([
    ["opening", ASK_SHEET_DEFAULT],
    ["fully dragged", ASK_SHEET_MAX],
  ])(
    "leaves the transcript its floor in the shortest pill when %s",
    (_label, fraction) => {
      const height = clampAskSheetHeight(
        fraction,
        SHORTEST_PANEL_PX,
        DIVIDER_PX,
      );
      const transcript =
        SHORTEST_PANEL_PX - DIVIDER_PX - height * SHORTEST_PANEL_PX;
      expect(transcript).toBeGreaterThanOrEqual(TRANSCRIPT_MIN_PX);
    },
  );

  it("counts the finished banner against the sheet, not the transcript", () => {
    const banner = 50;
    const height = clampAskSheetHeight(
      ASK_SHEET_DEFAULT,
      SHORTEST_PANEL_PX,
      DIVIDER_PX + banner,
    );
    const transcript =
      SHORTEST_PANEL_PX - DIVIDER_PX - banner - height * SHORTEST_PANEL_PX;
    expect(transcript).toBeGreaterThanOrEqual(TRANSCRIPT_MIN_PX);
  });

  it("never collapses the sheet below its own minimum", () => {
    expect(clampAskSheetHeight(0.5, 120)).toBeCloseTo(ASK_SHEET_MIN);
  });

  it("falls back to the ceiling when the panel has not been measured", () => {
    expect(clampAskSheetHeight(0.9, 0)).toBeCloseTo(ASK_SHEET_MAX);
  });
});

describe("measureAskSheetPanel", () => {
  function sized<T extends HTMLElement>(
    element: T,
    sizes: { clientHeight?: number; offsetHeight?: number },
  ): T {
    for (const [key, value] of Object.entries(sizes)) {
      Object.defineProperty(element, key, { configurable: true, value });
    }
    return element;
  }

  function row(className: string, offsetHeight: number) {
    const element = sized(document.createElement("div"), { offsetHeight });
    element.className = className;
    return element;
  }

  function expandedPill({ finished }: { finished: boolean }) {
    const pill = sized(document.createElement("div"), {
      clientHeight: MIN_WINDOW_PX,
    });
    pill.className = "pill-inner";
    pill.append(row("pill-header", HEADER_PX));
    const panel = sized(document.createElement("div"), {
      clientHeight: SHORTEST_PANEL_PX,
    });
    panel.append(row("pill-divider", DIVIDER_PX));
    if (finished) {
      const banner = row("pill-finished-banner", 38);
      banner.style.margin = "8px 12px 2px";
      panel.append(banner);
    }
    panel.append(row("pill-transcript-area", 120));
    const sheet = row("pill-ask-sheet", 96);
    const offscreenSuggestions = sized(document.createElement("div"), {
      offsetHeight: 240,
    });
    offscreenSuggestions.style.position = "fixed";
    panel.append(sheet, offscreenSuggestions);
    pill.append(panel);
    return sheet;
  }

  function measure(sheet: HTMLElement) {
    const measured = measureAskSheetPanel(sheet);
    if (!measured) throw new Error("the sheet has no panel to measure");
    return measured;
  }

  it("measures the sheet's own panel and the rows that take room in it", () => {
    expect(measure(expandedPill({ finished: false }))).toEqual({
      height: SHORTEST_PANEL_PX,
      reservedPx: DIVIDER_PX,
    });
  });

  it("reserves the finished banner with its margins", () => {
    expect(measure(expandedPill({ finished: true }))).toEqual({
      height: SHORTEST_PANEL_PX,
      reservedPx: DIVIDER_PX + 38 + 8 + 2,
    });
  });

  it.each([false, true])(
    "keeps the transcript floor at the opening height it measures (finished=%s)",
    (finished) => {
      const measured = measure(expandedPill({ finished }));
      const height = clampAskSheetHeight(
        ASK_SHEET_DEFAULT,
        measured.height,
        measured.reservedPx,
      );
      const transcript =
        measured.height - measured.reservedPx - height * measured.height;
      expect(transcript).toBeGreaterThanOrEqual(TRANSCRIPT_MIN_PX);
    },
  );

  it("has nothing to measure before the sheet is mounted", () => {
    expect(measureAskSheetPanel(null)).toBeNull();
    expect(measureAskSheetPanel(document.createElement("div"))).toBeNull();
  });
});

describe("isSheetGripTap", () => {
  it("tells a resize apart from the tap that dismisses the sheet", () => {
    expect(isSheetGripTap(0)).toBe(true);
    expect(isSheetGripTap(SHEET_DRAG_SLOP_PX)).toBe(true);
    expect(isSheetGripTap(SHEET_DRAG_SLOP_PX + 1)).toBe(false);
  });

  it("counts travel in either direction", () => {
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
