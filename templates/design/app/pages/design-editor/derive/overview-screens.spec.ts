import { describe, expect, it } from "vitest";

import type { DesignFile } from "../types";
import { deriveOverviewScreens } from "./overview-screens";

function file(partial: Partial<DesignFile> & { id: string }): DesignFile {
  return {
    filename: `${partial.id}.html`,
    fileType: "html",
    content: "",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-02",
    ...partial,
  };
}

const base = {
  designDataJson: {},
  activeBreakpointWidthState: undefined,
  breakpointFramesHidden: false,
  locallyPinnedHeightIds: new Set<string>(),
};

describe("deriveOverviewScreens", () => {
  it("keeps only html files and drops the board file", () => {
    const screens = deriveOverviewScreens({
      ...base,
      files: [
        file({ id: "a" }),
        file({ id: "styles", filename: "styles.css", fileType: "css" }),
        file({ id: "board", filename: "__board__.html" }),
      ],
    });
    expect(screens.map((s) => s.id)).toEqual(["a"]);
  });

  it("reads per-screen metadata and maps variantSetId to layoutGroupId", () => {
    const [screen] = deriveOverviewScreens({
      ...base,
      designDataJson: {
        screenMetadata: {
          a: { title: "Home", variantSetId: "grp", width: 390, height: 844 },
        },
      },
      files: [file({ id: "a" })],
    });
    expect(screen.title).toBe("Home");
    expect(screen.layoutGroupId).toBe("grp");
    expect(screen.width).toBe(390);
    expect(screen.height).toBe(844);
  });

  it("treats a session-pinned height as pinned even without persisted metadata", () => {
    const [screen] = deriveOverviewScreens({
      ...base,
      files: [file({ id: "a" })],
      locallyPinnedHeightIds: new Set(["a"]),
    });
    expect(screen.heightPinned).toBe(true);
  });

  it("omits breakpoint widths when breakpoint frames are hidden", () => {
    const args = {
      ...base,
      designDataJson: {
        breakpointSet: {
          id: "s",
          breakpoints: [{ id: "m", widthPx: 390 }],
        },
      },
      files: [file({ id: "a" })],
    };
    expect(deriveOverviewScreens(args)[0].breakpointWidths).toEqual([390]);
    expect(
      deriveOverviewScreens({ ...args, breakpointFramesHidden: true })[0]
        .breakpointWidths,
    ).toBeUndefined();
  });

  it("only reports an active breakpoint width that exists in the set", () => {
    const args = {
      ...base,
      designDataJson: {
        breakpointSet: {
          id: "s",
          breakpoints: [{ id: "m", widthPx: 390 }],
        },
      },
      files: [file({ id: "a" })],
    };
    expect(
      deriveOverviewScreens({ ...args, activeBreakpointWidthState: 390 })[0]
        .activeBreakpointWidth,
    ).toBe(390);
    expect(
      deriveOverviewScreens({ ...args, activeBreakpointWidthState: 1440 })[0]
        .activeBreakpointWidth,
    ).toBeUndefined();
  });
});
