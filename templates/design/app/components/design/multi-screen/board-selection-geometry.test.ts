import { describe, expect, it } from "vitest";

import {
  boardSurfaceLocalPointToBoardPoint,
  getBoardSelectionWorldBounds,
  getCurrentBoardSelectionWorldBounds,
} from "./overview-layout";
import type { FrameGeometry } from "./types";

// oracle-change: removed the round-trip fixtures; MultiScreenCanvas.primitives.test.ts asserts the same board/local point round trip

describe("board selection geometry round-trip", () => {
  it("fits the current Board selection at its negative world X, not iframe-local X", () => {
    const worldBounds = getBoardSelectionWorldBounds({
      rect: { left: 2896, top: 4196, width: 120, height: 90 },
      contentOffsetX: 4096,
      contentOffsetY: 4096,
    });
    const selection = {
      screenId: "board",
      selector: "[data-agent-native-node-id='node-1']",
      worldBounds,
    };

    expect(worldBounds).toMatchObject({
      left: -1200,
      top: 100,
      right: -1080,
      bottom: 190,
      width: 120,
      height: 90,
    });
    expect(
      getCurrentBoardSelectionWorldBounds({
        selection,
        boardFileId: "board",
        ownerFileId: "board",
        selectedLayerId: "node-1",
        sourceLayerIdentity: { screenId: "board", nodeId: "node-1" },
        currentSelectors: [selection.selector],
      }),
    ).toEqual(worldBounds);
  });

  it("converts a rotated iframe-local rect once before fitting", () => {
    const rotatedBounds = getBoardSelectionWorldBounds({
      rect: { left: 2896, top: 4196, width: 120, height: 90 },
      rotationDeg: 90,
      contentOffsetX: 4096,
      contentOffsetY: 4096,
    });

    expect(rotatedBounds).toMatchObject({
      left: -1185,
      top: 85,
      right: -1095,
      bottom: 205,
      width: 90,
      height: 120,
      centerX: -1140,
      centerY: 145,
    });
  });

  it("accepts only an exact one-to-one Board member snapshot", () => {
    const worldBounds = getBoardSelectionWorldBounds({
      rect: { left: 2896, top: 4196, width: 220, height: 190 },
      contentOffsetX: 4096,
      contentOffsetY: 4096,
    });
    const selection = {
      screenId: "board",
      selector: "#node\\:2",
      memberSelectors: ["#node\\:2", "#node-1"],
      memberSourceIds: ["node:2", "node-1"],
      worldBounds,
    };
    const current = {
      selection,
      boardFileId: "board",
      ownerFileId: "board",
      selectedLayerId: "node-2",
      sourceLayerIdentity: { screenId: "board", nodeId: "node-2" },
      currentSelectors: ['[data-agent-native-node-id="node:2"]'],
      currentSourceIds: ["node-1", "node:2"],
    };

    expect(getCurrentBoardSelectionWorldBounds(current)).toEqual(worldBounds);
    expect(
      getCurrentBoardSelectionWorldBounds({
        ...current,
        currentSourceIds: [current.currentSourceIds[1]],
      }),
    ).toBeNull();
    expect(
      getCurrentBoardSelectionWorldBounds({
        ...current,
        selection: {
          ...selection,
          memberSourceIds: ["node:2", "node:2"],
        },
      }),
    ).toBeNull();
  });

  it.each([
    {
      name: "foreign screen",
      selection: {
        screenId: "screen",
        selector: "node-1",
        worldBounds: {
          left: 1,
          top: 2,
          right: 3,
          bottom: 4,
          width: 2,
          height: 2,
          centerX: 2,
          centerY: 3,
        },
      },
      boardFileId: "board",
      ownerFileId: "board",
      selectedLayerId: "node-1",
      sourceLayerIdentity: { screenId: "board", nodeId: "node-1" },
      currentSelectors: ["node-1"],
    },
    {
      name: "stale selector",
      selection: {
        screenId: "board",
        selector: "old-selector",
        worldBounds: {
          left: 1,
          top: 2,
          right: 3,
          bottom: 4,
          width: 2,
          height: 2,
          centerX: 2,
          centerY: 3,
        },
      },
      boardFileId: "board",
      ownerFileId: "board",
      selectedLayerId: "node-1",
      sourceLayerIdentity: { screenId: "board", nodeId: "node-1" },
      currentSelectors: ["node-1"],
    },
    {
      name: "stale selected layer identity",
      selection: {
        screenId: "board",
        selector: "node-1",
        worldBounds: {
          left: 1,
          top: 2,
          right: 3,
          bottom: 4,
          width: 2,
          height: 2,
          centerX: 2,
          centerY: 3,
        },
      },
      boardFileId: "board",
      ownerFileId: "board",
      selectedLayerId: "node-2",
      sourceLayerIdentity: { screenId: "board", nodeId: "node-1" },
      currentSelectors: ["node-1"],
    },
    {
      name: "new Board document",
      selection: {
        screenId: "old-board",
        selector: "node-1",
        worldBounds: {
          left: 1,
          top: 2,
          right: 3,
          bottom: 4,
          width: 2,
          height: 2,
          centerX: 2,
          centerY: 3,
        },
      },
      boardFileId: "new-board",
      ownerFileId: "new-board",
      selectedLayerId: "node-1",
      sourceLayerIdentity: { screenId: "new-board", nodeId: "node-1" },
      currentSelectors: ["node-1"],
    },
  ])("does not fit $name geometry", ({ selection, ...identity }) => {
    expect(
      getCurrentBoardSelectionWorldBounds({
        ...identity,
        selection,
      }),
    ).toBeNull();
  });

  it("offsets the local rect by exactly the render geometry's origin (non-zero origin)", () => {
    const renderGeometry: FrameGeometry = {
      x: 12_288,
      y: -8192,
      width: 16_384,
      height: 16_384,
    };
    const worldPoint = boardSurfaceLocalPointToBoardPoint(
      { x: 50, y: 25 },
      renderGeometry,
    );
    expect(worldPoint).toEqual({ x: 12_338, y: -8167 });
  });
});
