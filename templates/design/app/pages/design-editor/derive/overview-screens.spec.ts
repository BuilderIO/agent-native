import { MAX_SANE_FRAME_DIMENSION_PX } from "@shared/responsive-frame-layout";
import { describe, expect, it } from "vitest";

import type { DesignFile } from "../types";
import {
  deriveOverviewScreens,
  reuseUnchangedOverviewScreens,
} from "./overview-screens";

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
        file({ id: "component", filename: "component.jsx", fileType: "jsx" }),
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

  it("reads only valid persisted breakpoint content heights", () => {
    const [screen] = deriveOverviewScreens({
      ...base,
      designDataJson: {
        screenMetadata: {
          a: {
            breakpointHeights: {
              "390": 2400,
              "768": "1800",
              "0390": 2000,
              "1440": 0,
              "500": MAX_SANE_FRAME_DIMENSION_PX + 1,
            },
          },
        },
      },
      files: [file({ id: "a" })],
    });
    expect(screen.breakpointHeights).toEqual({ "390": 2400 });
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

describe("reuseUnchangedOverviewScreens", () => {
  const breakpointSet = {
    breakpointSet: { id: "s", breakpoints: [{ id: "m", widthPx: 390 }] },
  };
  const derive = (
    files: DesignFile[],
    designDataJson: Record<string, unknown> = breakpointSet,
  ) =>
    deriveOverviewScreens({ ...base, designDataJson, files }).map((screen) => ({
      ...screen,
      codeLayerSource: { kind: "design-file" as const, fileId: screen.id },
    }));

  it("returns the previous array when a rebuild changed nothing", () => {
    const files = [file({ id: "a" }), file({ id: "b" })];
    const previous = derive(files);
    const next = derive(files.map((entry) => ({ ...entry })));
    expect(next[0]).not.toBe(previous[0]);
    expect(reuseUnchangedOverviewScreens(previous, next)).toBe(previous);
  });

  it("replaces only the screen whose content changed", () => {
    const previous = derive([file({ id: "a" }), file({ id: "b" })]);
    const reused = reuseUnchangedOverviewScreens(
      previous,
      derive([file({ id: "a" }), file({ id: "b", content: "<p>new</p>" })]),
    );
    expect(reused).not.toBe(previous);
    expect(reused[0]).toBe(previous[0]);
    expect(reused[1]).not.toBe(previous[1]);
    expect(reused[1].content).toBe("<p>new</p>");
  });

  it("propagates breakpoint and metadata changes", () => {
    const files = [file({ id: "a" })];
    const previous = derive(files);
    const widened = reuseUnchangedOverviewScreens(
      previous,
      derive(files, {
        breakpointSet: {
          id: "s",
          breakpoints: [
            { id: "m", widthPx: 390 },
            { id: "t", widthPx: 768 },
          ],
        },
      }),
    );
    expect(widened[0]).not.toBe(previous[0]);
    expect(widened[0].breakpointWidths).toEqual([390, 768]);

    const retitled = reuseUnchangedOverviewScreens(
      previous,
      derive(files, {
        ...breakpointSet,
        screenMetadata: { a: { title: "T" } },
      }),
    );
    expect(retitled[0]).not.toBe(previous[0]);
    expect(retitled[0].title).toBe("T");
  });

  it("follows the new order and drops removed screens", () => {
    const previous = derive([file({ id: "a" }), file({ id: "b" })]);
    const reordered = reuseUnchangedOverviewScreens(
      previous,
      derive([file({ id: "b" }), file({ id: "a" })]),
    );
    expect(reordered).toEqual([previous[1], previous[0]]);
    expect(reordered[0]).toBe(previous[1]);
    const removed = reuseUnchangedOverviewScreens(
      previous,
      derive([file({ id: "a" })]),
    );
    expect(removed).toEqual([previous[0]]);
    expect(removed).not.toBe(previous);
  });
});
