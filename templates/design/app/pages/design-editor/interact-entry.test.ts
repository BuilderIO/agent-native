import { describe, expect, it } from "vitest";

import { resolveInteractEntry } from "./interact-entry";

const home = { id: "home" };
const about = { id: "about" };
const pricing = { id: "pricing" };
const pages = [home, about, pricing];

function resolve(
  overrides: Partial<Parameters<typeof resolveInteractEntry>[0]> = {},
) {
  return resolveInteractEntry({
    screens: pages,
    selectedScreenIds: [],
    selectionScreenId: null,
    hiddenScreenIds: new Set(),
    ...overrides,
  });
}

describe("resolveInteractEntry", () => {
  it("opens the first page when nothing is selected", () => {
    expect(resolve()).toEqual({ kind: "screen", screenId: "home" });
  });

  it("opens the selected page", () => {
    expect(resolve({ selectedScreenIds: ["about"] })).toEqual({
      kind: "screen",
      screenId: "about",
    });
  });

  it("opens the page an element is selected in when no page is selected", () => {
    expect(resolve({ selectionScreenId: "pricing" })).toEqual({
      kind: "screen",
      screenId: "pricing",
    });
  });

  it("prefers a selected page over the page of an element selection", () => {
    expect(
      resolve({ selectedScreenIds: ["about"], selectionScreenId: "pricing" }),
    ).toEqual({ kind: "screen", screenId: "about" });
  });

  it("opens the first selected page of a multi-selection", () => {
    expect(resolve({ selectedScreenIds: ["pricing", "about"] })).toEqual({
      kind: "screen",
      screenId: "pricing",
    });
  });

  it("opens the page a caller names over the selection", () => {
    expect(
      resolve({
        requestedScreenId: "pricing",
        selectedScreenIds: ["about"],
      }),
    ).toEqual({ kind: "screen", screenId: "pricing" });
  });

  it("ignores a selection that is not a page of the design", () => {
    expect(
      resolve({ selectedScreenIds: ["board-file"], selectionScreenId: "css" }),
    ).toEqual({ kind: "screen", screenId: "home" });
  });

  it("skips a hidden page when it picks the default", () => {
    expect(resolve({ hiddenScreenIds: new Set(["home"]) })).toEqual({
      kind: "screen",
      screenId: "about",
    });
    expect(
      resolve({
        selectedScreenIds: ["home"],
        hiddenScreenIds: new Set(["home"]),
      }),
    ).toEqual({ kind: "screen", screenId: "about" });
  });

  it("opens a page a caller names even when it is hidden", () => {
    expect(
      resolve({
        requestedScreenId: "home",
        hiddenScreenIds: new Set(["home"]),
      }),
    ).toEqual({ kind: "screen", screenId: "home" });
  });

  it("refuses a requested screen that is not a page instead of landing elsewhere", () => {
    expect(resolve({ requestedScreenId: "styles-css" })).toEqual({
      kind: "none",
      reason: "unknown-screen",
    });
    expect(
      resolve({
        requestedScreenId: "styles-css",
        selectedScreenIds: ["about"],
      }),
    ).toEqual({ kind: "none", reason: "unknown-screen" });
  });

  it("reports a design with no pages instead of inventing one", () => {
    expect(resolve({ screens: [] })).toEqual({
      kind: "none",
      reason: "no-pages",
    });
    expect(
      resolve({ hiddenScreenIds: new Set(pages.map((page) => page.id)) }),
    ).toEqual({ kind: "none", reason: "no-pages" });
  });
});
