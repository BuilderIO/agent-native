import { describe, expect, it } from "vitest";

import {
  chooseTabToDetach,
  fetchXhrFromResourceTiming,
  lookbackElapsedMs,
  MAX_DEBUGGED_TABS,
  pickDebugTabIds,
  RECENT_TAB_WINDOW_MS,
  recordTabActivation,
  removeTabActivation,
} from "./debugger-scope";

const NOW = 1_000_000_000;
const MINUTE = 60_000;

describe("pickDebugTabIds", () => {
  it("starts with the recording's own tab, then recent tabs most recent first", () => {
    expect(
      pickDebugTabIds({
        targetTabId: 7,
        nowMs: NOW,
        activations: [
          { tabId: 1, lastActiveMs: NOW - 2 * MINUTE },
          { tabId: 2, lastActiveMs: NOW - MINUTE },
        ],
      }),
    ).toEqual([7, 2, 1]);
  });

  it("leaves out tabs active longer ago than the recent window", () => {
    expect(
      pickDebugTabIds({
        targetTabId: 7,
        nowMs: NOW,
        activations: [
          { tabId: 1, lastActiveMs: NOW - RECENT_TAB_WINDOW_MS - 1 },
          { tabId: 2, lastActiveMs: NOW - RECENT_TAB_WINDOW_MS },
        ],
      }),
    ).toEqual([7, 2]);
  });

  it("caps the set at MAX_DEBUGGED_TABS and keeps the recording's tab", () => {
    const activations = Array.from({ length: 12 }, (_, index) => ({
      tabId: index + 1,
      lastActiveMs: NOW - index * 1000,
    }));
    const picked = pickDebugTabIds({
      targetTabId: 99,
      nowMs: NOW,
      activations,
    });
    expect(picked).toHaveLength(MAX_DEBUGGED_TABS);
    expect(picked[0]).toBe(99);
  });

  it("never lists the recording's tab twice", () => {
    expect(
      pickDebugTabIds({
        targetTabId: 7,
        nowMs: NOW,
        activations: [{ tabId: 7, lastActiveMs: NOW }],
      }),
    ).toEqual([7]);
  });
});

describe("recordTabActivation", () => {
  it("moves a tab to the front and drops entries outside the window", () => {
    const next = recordTabActivation(
      [
        { tabId: 1, lastActiveMs: NOW - MINUTE },
        { tabId: 2, lastActiveMs: NOW - RECENT_TAB_WINDOW_MS - MINUTE },
      ],
      1,
      NOW,
    );
    expect(next).toEqual([{ tabId: 1, lastActiveMs: NOW }]);
  });
});

describe("removeTabActivation", () => {
  it("forgets a closed tab", () => {
    expect(
      removeTabActivation(
        [
          { tabId: 1, lastActiveMs: NOW },
          { tabId: 2, lastActiveMs: NOW },
        ],
        1,
      ),
    ).toEqual([{ tabId: 2, lastActiveMs: NOW }]);
  });
});

describe("chooseTabToDetach", () => {
  it("picks the least recently active tab and never the tab being kept", () => {
    expect(
      chooseTabToDetach({
        keepTabId: 3,
        attached: [
          { tabId: 1, lastActiveMs: NOW - 3 * MINUTE },
          { tabId: 2, lastActiveMs: NOW - MINUTE },
          { tabId: 3, lastActiveMs: NOW - 9 * MINUTE },
        ],
      }),
    ).toBe(1);
  });

  it("returns null when only the kept tab is attached", () => {
    expect(
      chooseTabToDetach({
        keepTabId: 3,
        attached: [{ tabId: 3, lastActiveMs: NOW }],
      }),
    ).toBeNull();
  });
});

describe("lookbackElapsedMs", () => {
  const START = 5_000_000;

  it("gives a negative offset for entries shortly before the start", () => {
    expect(lookbackElapsedMs(START - 12_345, START)).toBe(-12_345);
  });

  it("keeps the entry exactly 30 seconds back and drops anything older", () => {
    expect(lookbackElapsedMs(START - 30_000, START)).toBe(-30_000);
    expect(lookbackElapsedMs(START - 30_001, START)).toBeNull();
  });

  it("leaves entries at or after the start to the recording itself", () => {
    expect(lookbackElapsedMs(START, START)).toBeNull();
    expect(lookbackElapsedMs(START + 1, START)).toBeNull();
  });
});

describe("fetchXhrFromResourceTiming", () => {
  it("keeps fetch and XHR entries and drops everything else", () => {
    const mapped = fetchXhrFromResourceTiming(
      [
        {
          name: "https://app.example.test/api/a",
          initiatorType: "fetch",
          startTime: 100.4,
          duration: 20.6,
          responseStatus: 500,
        },
        {
          name: "https://app.example.test/b",
          initiatorType: "xmlhttprequest",
          startTime: 200,
          duration: 5,
          responseStatus: 0,
        },
        {
          name: "https://app.example.test/app.js",
          initiatorType: "script",
          startTime: 50,
          duration: 9,
        },
      ],
      1_000,
    );
    expect(mapped).toEqual([
      {
        timestampMs: 1_100,
        durationMs: 21,
        type: "fetch",
        url: "https://app.example.test/api/a",
        status: 500,
      },
      {
        timestampMs: 1_200,
        durationMs: 5,
        type: "xhr",
        url: "https://app.example.test/b",
      },
    ]);
  });
});
