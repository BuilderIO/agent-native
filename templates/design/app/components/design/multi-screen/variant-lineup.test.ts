import {
  getResponsiveGroupWidth,
  visibleBreakpointWidths,
} from "@shared/responsive-frame-layout";
import { describe, expect, it } from "vitest";

import {
  getResponsiveScreenGroupSize,
  resolveFrameGeometrySync,
} from "./frame-geometry";
import type { FrameGeometry } from "./types";

/**
 * A generated variant set must never land one direction on top of the previous
 * one's breakpoint row. present-design-variants installs a design-wide
 * breakpoint set, so every primary frame grows a preview row to its right; the
 * lineup it writes has to reserve that width.
 *
 * Reported as "the variants are overlapping each other" plus flicker while
 * zooming, because the overlapping row also pushed the board past the live
 * browsing-context pool.
 */
const VARIANT_GAP = 96;
const PRIMARY_WIDTH = 1440;
const PRIMARY_HEIGHT = 900;

/** Mirrors present-design-variants.placeVariantScreens. */
function placeVariantScreens(
  screens: ReadonlyArray<{ id: string; width: number; height: number }>,
  breakpointWidths: readonly number[],
) {
  const placements: Record<string, FrameGeometry> = {};
  const columns = Math.min(3, Math.max(1, screens.length));
  let rowY = 0;
  for (let rowStart = 0; rowStart < screens.length; rowStart += columns) {
    const row = screens.slice(rowStart, rowStart + columns);
    let x = 0;
    let rowHeight = 0;
    for (const [offset, screen] of row.entries()) {
      placements[screen.id] = {
        x,
        y: rowY,
        width: screen.width,
        height: screen.height,
        z: rowStart + offset,
      };
      x +=
        getResponsiveGroupWidth({
          primaryWidth: screen.width,
          scale: 1,
          visibleWidths: visibleBreakpointWidths(
            breakpointWidths,
            screen.width,
          ),
        }) + VARIANT_GAP;
      rowHeight = Math.max(rowHeight, screen.height);
    }
    rowY += rowHeight + VARIANT_GAP;
  }
  return placements;
}

function variantScreens(breakpointWidths: number[]) {
  return ["classic-8bit", "modern-3d", "comic-poster"].map((id) => ({
    id,
    metadata: { width: PRIMARY_WIDTH, height: PRIMARY_HEIGHT },
    breakpointWidths,
    layoutGroupId: "set-1",
  }));
}

type VariantScreen = ReturnType<typeof variantScreens>[number];

function overlappingPairs(
  screens: readonly VariantScreen[],
  geometryById: Record<string, FrameGeometry>,
) {
  const boxes = screens.map((screen) => {
    const geometry = geometryById[screen.id]!;
    const size = getResponsiveScreenGroupSize(screen, geometry);
    return {
      id: screen.id,
      left: geometry.x,
      right: geometry.x + size.width,
      top: geometry.y,
      bottom: geometry.y + size.height,
    };
  });
  const pairs: string[] = [];
  for (let a = 0; a < boxes.length; a += 1) {
    for (let b = a + 1; b < boxes.length; b += 1) {
      const first = boxes[a]!;
      const second = boxes[b]!;
      if (
        first.left < second.right - 1 &&
        first.right > second.left + 1 &&
        first.top < second.bottom - 1 &&
        first.bottom > second.top + 1
      ) {
        pairs.push(`${first.id}/${second.id}`);
      }
    }
  }
  return pairs;
}

function place(screens: readonly VariantScreen[], breakpointWidths: number[]) {
  return placeVariantScreens(
    screens.map((screen) => ({
      id: screen.id,
      width: screen.metadata.width,
      height: screen.metadata.height,
    })),
    breakpointWidths,
  );
}

describe("generated variant lineup", () => {
  it("reserves the breakpoint row so the persisted lineup never overlaps", () => {
    const screens = variantScreens([390]);
    const persisted = place(screens, [390]);

    // 1440 + 24 + 390 = 1854 painted, so the next cell starts at 1854 + 96.
    expect(persisted["classic-8bit"]!.x).toBe(0);
    expect(persisted["modern-3d"]!.x).toBe(1950);
    expect(persisted["comic-poster"]!.x).toBe(3900);
    expect(overlappingPairs(screens, persisted)).toEqual([]);
  });

  it("reserves every breakpoint when the design already has a full set", () => {
    // The reported design: 1440 base with 768 and 390 previews. The primary's
    // own width is not a preview, so only 768 + 390 are reserved.
    const screens = variantScreens([1440, 768, 390]);
    const persisted = place(screens, [1440, 768, 390]);

    expect(persisted["modern-3d"]!.x).toBe(2646 + VARIANT_GAP);
    expect(overlappingPairs(screens, persisted)).toEqual([]);
  });

  it("is left alone by the client lineup repair, in any file order", () => {
    const screens = variantScreens([390]);
    const persisted = place(screens, [390]);
    // get-design now orders files deterministically, but the lineup must not
    // depend on that: a correct lineup has to survive any ordering.
    for (const order of [
      [0, 1, 2],
      [2, 0, 1],
      [1, 2, 0],
    ]) {
      const ordered = order.map((index) => screens[index]!);
      const { next } = resolveFrameGeometrySync({
        screens: ordered,
        currentGeometryById: {},
        persistedGeometryById: persisted,
      });
      expect(overlappingPairs(ordered, next)).toEqual([]);
      for (const screen of ordered) {
        expect(next[screen.id]!.x).toBe(persisted[screen.id]!.x);
      }
    }
  });

  it("survives a hide/show of the breakpoint frames", () => {
    const screens = variantScreens([390]);
    const persisted = place(screens, [390]);
    // DesignEditor passes breakpointWidths: undefined while the frames are
    // hidden, which used to be the only signal the repair keyed on.
    const hidden = screens.map((screen) => ({
      ...screen,
      breakpointWidths: undefined as unknown as number[],
    }));
    const { next } = resolveFrameGeometrySync({
      screens: hidden,
      currentGeometryById: {},
      persistedGeometryById: persisted,
    });
    expect(overlappingPairs(screens, next)).toEqual([]);
  });

  it("keeps a designer's own arrangement after they move one direction", () => {
    const screens = variantScreens([390]);
    const persisted = place(screens, [390]);
    const nudged = {
      ...persisted,
      "comic-poster": { ...persisted["comic-poster"]!, x: 12_000, y: 4_000 },
    };
    const { next } = resolveFrameGeometrySync({
      screens,
      currentGeometryById: {},
      persistedGeometryById: nudged,
    });
    expect(next["comic-poster"]!.x).toBe(12_000);
    expect(next["comic-poster"]!.y).toBe(4_000);
    expect(overlappingPairs(screens, next)).toEqual([]);
  });
});
