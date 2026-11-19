import { describe, expect, it } from "vitest";

import {
  clampListWidth,
  readingPaneLayout,
  readStoredListWidth,
  readStoredPaneEnabled,
  storeListWidth,
  storePaneEnabled,
} from "./reading-pane";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("readingPaneLayout", () => {
  const wide = { enabled: true, viewportWidth: 1440, preferredListWidth: null };

  it("stays off when the setting is off or the window is narrow", () => {
    expect(
      readingPaneLayout({ ...wide, enabled: false, containerWidth: 1300 }),
    ).toEqual({ mode: "off" });
    expect(
      readingPaneLayout({ ...wide, viewportWidth: 1023, containerWidth: 1000 }),
    ).toEqual({ mode: "off" });
  });

  it("stays off when the inbox can't fit the list and a 600 px email", () => {
    expect(readingPaneLayout({ ...wide, containerWidth: 919 })).toEqual({
      mode: "off",
    });
    expect(readingPaneLayout({ ...wide, containerWidth: 920 })).toMatchObject({
      mode: "pane",
      listWidth: 320,
      listMaxWidth: 320,
      showSidePanel: false,
    });
  });

  it("drops the contact panel before the email gets narrower than 600 px", () => {
    expect(readingPaneLayout({ ...wide, containerWidth: 1179 })).toMatchObject({
      showSidePanel: false,
      listMaxWidth: 579,
    });
    expect(readingPaneLayout({ ...wide, containerWidth: 1180 })).toMatchObject({
      showSidePanel: true,
      listMaxWidth: 320,
    });
  });

  it("keeps a saved list width that still leaves the email room", () => {
    expect(
      readingPaneLayout({
        ...wide,
        containerWidth: 1600,
        preferredListWidth: 520,
      }),
    ).toMatchObject({ listWidth: 520, listMaxWidth: 740 });
    expect(
      readingPaneLayout({
        ...wide,
        containerWidth: 1100,
        preferredListWidth: 900,
      }),
    ).toMatchObject({ listWidth: 500, listMaxWidth: 500 });
  });
});

describe("clampListWidth", () => {
  it("holds the list between its minimum and the room left", () => {
    expect(clampListWidth(100, 600)).toBe(320);
    expect(clampListWidth(410.6, 600)).toBe(411);
    expect(clampListWidth(900, 600)).toBe(600);
  });
});

describe("stored list width", () => {
  it("round-trips a width and ignores a missing or unusable one", () => {
    const storage = memoryStorage();
    expect(readStoredListWidth(storage)).toBeNull();
    storeListWidth(storage, 412.4);
    expect(readStoredListWidth(storage)).toBe(412);

    expect(
      readStoredListWidth(
        memoryStorage({ "mail-reading-pane-list-width": "wide" }),
      ),
    ).toBeNull();
    expect(
      readStoredListWidth(
        memoryStorage({ "mail-reading-pane-list-width": "120" }),
      ),
    ).toBeNull();
  });
});

describe("remembered pane choice", () => {
  it("round-trips on and off and reads anything else as unknown", () => {
    const storage = memoryStorage();
    expect(readStoredPaneEnabled(storage)).toBeNull();
    storePaneEnabled(storage, false);
    expect(readStoredPaneEnabled(storage)).toBe(false);
    storePaneEnabled(storage, true);
    expect(readStoredPaneEnabled(storage)).toBe(true);

    expect(
      readStoredPaneEnabled(
        memoryStorage({ "mail-reading-pane-enabled": "true" }),
      ),
    ).toBeNull();
  });
});
