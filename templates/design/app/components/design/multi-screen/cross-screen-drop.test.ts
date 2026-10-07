// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";

import {
  COMPACT_CROSS_SCREEN_GHOST_PX,
  CrossScreenPathFrameHitTracker,
  applyCrossScreenPathFrameDropTarget,
  captureCrossScreenSourceHtmlSnapshot,
  getBoardDropRoute,
  getCrossScreenPreviewTimeoutResult,
  getCrossScreenSourceGeometry,
  getCrossScreenGhostStyle,
  isCrossScreenGridPlacement,
  isPointerInsideSourceIframe,
  rememberCrossScreenPathFrameHit,
  resolveCrossScreenPathFrameHitAtRelease,
  validateCrossScreenSourceHtmlSnapshot,
} from "./cross-screen-drop";
import { SURFACE_PADDING } from "./overview-layout";

describe("cross-screen path frame drop targets", () => {
  const nestedFrameHit = {
    anchorNodeId: "nested-frame",
    anchorParentNodeId: "outer-frame",
    anchorSelector: '[data-agent-native-node-id="nested-frame"]',
    placement: "inside" as const,
    dropMode: "absolute-container" as const,
    anchorRect: { left: 120, top: 90, width: 280, height: 220 },
  };
  const outerFrameHit = {
    anchorNodeId: "outer-frame",
    anchorParentNodeId: "body",
    anchorSelector: '[data-agent-native-node-id="outer-frame"]',
    placement: "inside" as const,
    dropMode: "absolute-container" as const,
    anchorRect: { left: 80, top: 80, width: 560, height: 420 },
  };

  it("keeps the crossed child frame when the next preview resolves to its parent", () => {
    const nested = rememberCrossScreenPathFrameHit({
      previous: null,
      next: { sessionId: "drag-1", screenId: "screen-1", hit: nestedFrameHit },
    });
    expect(
      rememberCrossScreenPathFrameHit({
        previous: nested,
        next: { sessionId: "drag-1", screenId: "screen-1", hit: outerFrameHit },
      }),
    ).toMatchObject({
      ...nested,
      parentHits: [outerFrameHit],
    });
  });

  it("drops after the crossed frame while preserving the release container's rect", () => {
    const pathFrame = {
      sessionId: "drag-1",
      screenId: "screen-1",
      hit: nestedFrameHit,
    };
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: outerFrameHit,
        pathFrame,
        sessionId: "drag-1",
        screenId: "screen-1",
      }),
    ).toMatchObject({
      anchorNodeId: "nested-frame",
      anchorParentNodeId: "outer-frame",
      placement: "after",
      guidePlacement: "after",
      dropMode: "absolute-container",
      anchorRect: outerFrameHit.anchorRect,
    });
  });

  it("uses the crossed frame directly under the release container after nested exits", () => {
    const middleFrameHit = {
      ...nestedFrameHit,
      anchorNodeId: "middle-frame",
      anchorParentNodeId: "outer-frame",
    };
    const nestedHit = {
      ...nestedFrameHit,
      anchorParentNodeId: "middle-frame",
    };
    const pathFrame = rememberCrossScreenPathFrameHit({
      previous: rememberCrossScreenPathFrameHit({
        previous: null,
        next: {
          sessionId: "drag-1",
          screenId: "screen-1",
          hit: nestedHit,
        },
      }),
      next: {
        sessionId: "drag-1",
        screenId: "screen-1",
        hit: middleFrameHit,
      },
    });
    const completedPath = rememberCrossScreenPathFrameHit({
      previous: pathFrame,
      next: {
        sessionId: "drag-1",
        screenId: "screen-1",
        hit: outerFrameHit,
      },
    });

    expect(completedPath).toMatchObject({
      hit: nestedHit,
      parentHits: [middleFrameHit, outerFrameHit],
    });
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: outerFrameHit,
        pathFrame: completedPath,
        sessionId: "drag-1",
        screenId: "screen-1",
      }),
    ).toMatchObject({
      anchorNodeId: "middle-frame",
      anchorParentNodeId: "outer-frame",
      placement: "after",
    });
  });

  it.each([
    {
      kind: "auto-layout",
      hit: { ...outerFrameHit, dropMode: "flow-insert" as const },
    },
    {
      kind: "grid",
      hit: {
        ...outerFrameHit,
        gridPlacement: { column: 1, columnEnd: 2, row: 1, rowEnd: 2 },
      },
    },
    {
      kind: "Alt/ignore-auto-layout",
      hit: outerFrameHit,
      ignoreAutoLayout: true,
    },
  ])(
    "preserves the pointer-selected $kind target",
    ({ hit, ignoreAutoLayout }) => {
      expect(
        applyCrossScreenPathFrameDropTarget({
          hit,
          pathFrame: {
            sessionId: "drag-1",
            screenId: "screen-1",
            hit: nestedFrameHit,
          },
          sessionId: "drag-1",
          screenId: "screen-1",
          ignoreAutoLayout,
        }),
      ).toBe(hit);
    },
  );

  it("clears remembered path frames while Alt bypasses auto layout", () => {
    expect(
      rememberCrossScreenPathFrameHit({
        previous: {
          sessionId: "drag-1",
          screenId: "screen-1",
          hit: nestedFrameHit,
        },
        next: {
          sessionId: "drag-1",
          screenId: "screen-1",
          hit: outerFrameHit,
        },
        ignoreAutoLayout: true,
      }),
    ).toBeNull();
  });

  it("does not reuse path hits from a different drag or destination", () => {
    const pathFrame = {
      sessionId: "drag-1",
      screenId: "screen-1",
      hit: nestedFrameHit,
    };
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: outerFrameHit,
        pathFrame,
        sessionId: "drag-2",
        screenId: "screen-1",
      }),
    ).toBe(outerFrameHit);
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: outerFrameHit,
        pathFrame,
        sessionId: "drag-1",
        screenId: "screen-2",
      }),
    ).toBe(outerFrameHit);
  });
});

describe("getCrossScreenSourceGeometry", () => {
  const viewportGeometry = { x: 0, y: 0, width: 1200, height: 800 };
  const persistedGeometry = { x: 100, y: 100, width: 320, height: 200 };
  const renderedGeometry = { ...persistedGeometry, height: 560 };

  it("keeps drops in visible Hug overflow inside the source Screen", () => {
    const sourceGeometry = getCrossScreenSourceGeometry({
      renderedGeometry,
      persistedGeometry,
    });
    expect(
      getBoardDropRoute({
        point: { x: 140, y: 500 },
        viewportGeometry,
        sourceScreenGeometry: sourceGeometry,
      }),
    ).toBeNull();
    expect(
      getBoardDropRoute({
        point: { x: 140, y: 500 },
        viewportGeometry,
        sourceScreenGeometry: persistedGeometry,
      }),
    ).toBe("board-root");
  });

  it("falls back to persisted geometry until rendered bounds are available", () => {
    expect(getCrossScreenSourceGeometry({ persistedGeometry })).toBe(
      persistedGeometry,
    );
  });
});

describe("cross-screen preview path release ordering", () => {
  const nestedFrameHit = {
    anchorNodeId: "nested-frame",
    anchorParentNodeId: "middle-frame",
    anchorSelector: '[data-agent-native-node-id="nested-frame"]',
    placement: "inside" as const,
    dropMode: "absolute-container" as const,
  };
  const outerFrameHit = {
    anchorNodeId: "outer-frame",
    anchorParentNodeId: "body",
    anchorSelector: '[data-agent-native-node-id="outer-frame"]',
    placement: "inside" as const,
    dropMode: "absolute-container" as const,
    anchorRect: { left: 80, top: 80, width: 560, height: 420 },
  };

  it("keeps post-release hit tests out of the frozen path snapshot", async () => {
    const tracker = new CrossScreenPathFrameHitTracker();
    tracker.add({
      requestSeq: 41,
      sessionId: "drag-1",
      screenId: "screen-1",
      ignoreAutoLayout: false,
      hit: Promise.resolve({
        ...nestedFrameHit,
        anchorParentNodeId: "outer-frame",
      }),
    });
    tracker.add({
      requestSeq: 42,
      sessionId: "drag-1",
      screenId: "screen-1",
      ignoreAutoLayout: false,
      hit: Promise.resolve({
        ...nestedFrameHit,
        anchorNodeId: "already-after-release-child",
        anchorParentNodeId: "outer-frame",
      }),
    });
    const snapshot = tracker.snapshot(41, "screen-1", "drag-1");
    expect(snapshot.requests.map((request) => request.requestSeq)).toEqual([
      41,
    ]);
    tracker.add({
      requestSeq: 43,
      sessionId: "drag-1",
      screenId: "screen-1",
      ignoreAutoLayout: false,
      hit: Promise.resolve({
        ...nestedFrameHit,
        anchorNodeId: "late-child",
        anchorParentNodeId: "outer-frame",
      }),
    });

    const path = await resolveCrossScreenPathFrameHitAtRelease({
      ...snapshot,
      releaseHit: outerFrameHit,
    });
    expect(path?.hit.anchorNodeId).toBe("nested-frame");
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: outerFrameHit,
        pathFrame: path,
        sessionId: "drag-1",
        screenId: "screen-1",
      }),
    ).toMatchObject({ anchorNodeId: "nested-frame", placement: "after" });
  });

  it("keeps release path history isolated when a drag visits another screen", async () => {
    const path = await resolveCrossScreenPathFrameHitAtRelease({
      requests: [
        {
          requestSeq: 41,
          sessionId: "drag-1",
          screenId: "screen-a",
          ignoreAutoLayout: false,
          hit: Promise.resolve({
            ...nestedFrameHit,
            anchorParentNodeId: "outer-a",
          }),
        },
        {
          requestSeq: 42,
          sessionId: "drag-1",
          screenId: "screen-b",
          ignoreAutoLayout: false,
          hit: Promise.resolve({
            ...nestedFrameHit,
            anchorNodeId: "nested-b",
            anchorParentNodeId: "outer-b",
          }),
        },
        {
          requestSeq: 43,
          sessionId: "drag-1",
          screenId: "screen-a",
          ignoreAutoLayout: false,
          hit: Promise.resolve({
            ...outerFrameHit,
            anchorNodeId: "outer-a",
          }),
        },
      ],
      releaseRequestSeq: 43,
      sessionId: "drag-1",
      screenId: "screen-a",
      releaseHit: { ...outerFrameHit, anchorNodeId: "outer-a" },
    });

    expect(path?.hit.anchorNodeId).toBe("nested-frame");
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: { ...outerFrameHit, anchorNodeId: "outer-a" },
        pathFrame: path,
        sessionId: "drag-1",
        screenId: "screen-a",
      }),
    ).toMatchObject({ anchorNodeId: "nested-frame", placement: "after" });
  });

  it("compacts resolved hit history in order while retaining pending requests", async () => {
    const tracker = new CrossScreenPathFrameHitTracker();
    let resolveFirst!: (hit: typeof nestedFrameHit) => void;
    const firstHit = new Promise<typeof nestedFrameHit>((resolve) => {
      resolveFirst = resolve;
    });
    tracker.add({
      requestSeq: 1,
      sessionId: "drag-1",
      screenId: "screen-1",
      ignoreAutoLayout: false,
      hit: firstHit,
    });
    tracker.add({
      requestSeq: 2,
      sessionId: "drag-1",
      screenId: "screen-1",
      ignoreAutoLayout: false,
      hit: Promise.resolve(outerFrameHit),
    });
    await Promise.resolve();

    expect(tracker.snapshot(2, "screen-1", "drag-1").requests).toHaveLength(2);

    const directNestedFrameHit = {
      ...nestedFrameHit,
      anchorParentNodeId: "outer-frame",
    };
    resolveFirst(directNestedFrameHit);
    await Promise.resolve();
    expect(tracker.snapshot(2, "screen-1", "drag-1").requests).toHaveLength(0);

    for (let requestSeq = 3; requestSeq <= 100; requestSeq += 1) {
      tracker.add({
        requestSeq,
        sessionId: "drag-1",
        screenId: "screen-1",
        ignoreAutoLayout: false,
        hit: Promise.resolve({}),
      });
      await Promise.resolve();
    }

    const snapshot = tracker.snapshot(100, "screen-1", "drag-1");
    expect(snapshot.requests).toHaveLength(0);
    expect(snapshot.pathFrame).toMatchObject({
      hit: directNestedFrameHit,
      parentHits: [outerFrameHit],
    });
  });

  it("waits for out-of-order nested previews and folds the release hit last", async () => {
    let resolveNested!: (hit: typeof nestedFrameHit) => void;
    let resolveMiddle!: (hit: typeof nestedFrameHit) => void;
    let resolved = false;
    const nestedPreview = new Promise<typeof nestedFrameHit>((resolve) => {
      resolveNested = resolve;
    });
    const middlePreview = new Promise<typeof nestedFrameHit>((resolve) => {
      resolveMiddle = resolve;
    });
    const pathAtRelease = resolveCrossScreenPathFrameHitAtRelease({
      requests: [
        {
          requestSeq: 42,
          sessionId: "drag-1",
          screenId: "screen-1",
          ignoreAutoLayout: false,
          hit: middlePreview,
        },
        {
          requestSeq: 41,
          sessionId: "drag-1",
          screenId: "screen-1",
          ignoreAutoLayout: false,
          hit: nestedPreview,
        },
      ],
      releaseRequestSeq: 42,
      sessionId: "drag-1",
      screenId: "screen-1",
      releaseHit: outerFrameHit,
    }).then((path) => {
      resolved = true;
      return path;
    });

    resolveMiddle({
      ...nestedFrameHit,
      anchorNodeId: "middle-frame",
      anchorParentNodeId: "outer-frame",
    });
    await Promise.resolve();
    expect(resolved).toBe(false);
    resolveNested(nestedFrameHit);

    const path = await pathAtRelease;
    expect(path).toMatchObject({
      hit: nestedFrameHit,
      parentHits: [
        {
          anchorNodeId: "middle-frame",
          anchorParentNodeId: "outer-frame",
        },
        outerFrameHit,
      ],
    });
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: outerFrameHit,
        pathFrame: path,
        sessionId: "drag-1",
        screenId: "screen-1",
      }),
    ).toMatchObject({
      anchorNodeId: "middle-frame",
      anchorParentNodeId: "outer-frame",
      placement: "after",
    });

    const releaseExitPath = await resolveCrossScreenPathFrameHitAtRelease({
      requests: [
        {
          requestSeq: 51,
          sessionId: "drag-1",
          screenId: "screen-1",
          ignoreAutoLayout: false,
          hit: Promise.resolve(nestedFrameHit),
        },
      ],
      releaseRequestSeq: 51,
      sessionId: "drag-1",
      screenId: "screen-1",
      releaseHit: {
        ...nestedFrameHit,
        anchorNodeId: "middle-frame",
        anchorParentNodeId: "outer-frame",
      },
    });
    expect(
      applyCrossScreenPathFrameDropTarget({
        hit: {
          ...nestedFrameHit,
          anchorNodeId: "middle-frame",
          anchorParentNodeId: "outer-frame",
        },
        pathFrame: releaseExitPath,
        sessionId: "drag-1",
        screenId: "screen-1",
      }),
    ).toMatchObject({ anchorNodeId: "nested-frame", placement: "after" });
  });

  it("does not use a cached hit from another timed-out preview sequence", () => {
    const cached = {
      requestSeq: 40,
      generation: 3,
      result: nestedFrameHit,
    };
    expect(
      getCrossScreenPreviewTimeoutResult({
        requestSeq: 41,
        generation: 3,
        cached,
      }),
    ).toEqual({});
    expect(
      getCrossScreenPreviewTimeoutResult({
        requestSeq: 40,
        generation: 3,
        cached,
      }),
    ).toBe(nestedFrameHit);
  });
});

describe("isPointerInsideSourceIframe", () => {
  it("treats a pointer past the iframe's own reported viewport as OUTSIDE", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1650,
        iframeY: 100,
        viewportW: 1600,
        viewportH: 900,
        frameWidth: 1280,
        frameHeight: 900,
      }),
    ).toBe(false);
  });

  it("stays inside for a pointer within the real frame", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1000,
        iframeY: 100,
        viewportW: 1600,
        viewportH: 900,
        frameWidth: 1280,
        frameHeight: 900,
      }),
    ).toBe(true);
  });

  it("falls back to the bridge-reported viewport when no rendered geometry is known yet", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1480,
        iframeY: 100,
        viewportW: 1600,
        viewportH: 900,
      }),
    ).toBe(true);
  });

  it("does not classify a pointer near the content's real edge as outside a 0.5x-scaled card", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1200,
        iframeY: 100,
        viewportW: 1280,
        viewportH: 2560,
        frameWidth: 640,
        frameHeight: 1280,
      }),
    ).toBe(true);
  });

  it("rejects stale negative coordinates after the pointer exits", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: -1055,
        iframeY: 111,
        viewportW: 1280,
        viewportH: 844,
      }),
    ).toBe(false);
  });

  it("still classifies a pointer past the content's real edge as outside a 0.5x-scaled card", () => {
    expect(
      isPointerInsideSourceIframe({
        iframeX: 1300,
        iframeY: 100,
        viewportW: 1280,
        viewportH: 2560,
        frameWidth: 640,
        frameHeight: 1280,
      }),
    ).toBe(false);
  });
});

describe("cross-screen source HTML snapshots", () => {
  it("captures the complete board root subtree from the host-verified document", () => {
    const sourceDocument = document.implementation.createHTMLDocument();
    sourceDocument.body.innerHTML = `
      <div data-agent-native-node-id="root">
        <div data-agent-native-node-id="child">
          <span data-agent-native-node-id="grandchild">Nested</span>
        </div>
      </div>
    `;

    const snapshot = captureCrossScreenSourceHtmlSnapshot(
      sourceDocument,
      "root",
    );

    expect(snapshot).toContain('data-agent-native-node-id="root"');
    expect(snapshot).toContain('data-agent-native-node-id="child"');
    expect(snapshot).toContain('data-agent-native-node-id="grandchild"');
  });

  it("accepts exactly one matching root and rejects mismatches or siblings", () => {
    const valid =
      '<div data-agent-native-node-id="root"><div data-agent-native-node-id="child"></div></div>';

    expect(validateCrossScreenSourceHtmlSnapshot(valid, "root")).toBe(valid);
    expect(
      validateCrossScreenSourceHtmlSnapshot(valid, "different-root"),
    ).toBeUndefined();
    expect(
      validateCrossScreenSourceHtmlSnapshot(
        `${valid}<div data-agent-native-node-id="sibling"></div>`,
        "root",
      ),
    ).toBeUndefined();
  });
});

describe("cross-screen grid placements", () => {
  it("accepts positive track ranges and rejects invalid message data", () => {
    expect(
      isCrossScreenGridPlacement({
        column: 3,
        columnEnd: 4,
        row: 2,
        rowEnd: 3,
      }),
    ).toBe(true);
    expect(
      isCrossScreenGridPlacement({
        column: 3,
        columnEnd: 3,
        row: 2,
        rowEnd: 3,
      }),
    ).toBe(false);
    expect(isCrossScreenGridPlacement(null)).toBe(false);
  });
});

describe("getCrossScreenGhostStyle", () => {
  const pan = { x: 0, y: 0 };

  it("keeps the sizeless cursor ghost visible at extreme zoom-out", () => {
    const style = getCrossScreenGhostStyle({
      ghost: { boardX: 100, boardY: 200 },
      pan,
      scale: 0.1,
    });
    expect(style.width).toBe(COMPACT_CROSS_SCREEN_GHOST_PX);
    expect(style.height).toBe(COMPACT_CROSS_SCREEN_GHOST_PX);
  });

  it("centres the sizeless ghost on the board point at every zoom", () => {
    const half = COMPACT_CROSS_SCREEN_GHOST_PX / 2;
    for (const scale of [0.1, 0.36, 1, 2]) {
      const style = getCrossScreenGhostStyle({
        ghost: { boardX: 100, boardY: 200 },
        pan,
        scale,
      });
      const centreX = (style.left as number) + (style.width as number) / 2;
      const centreY = (style.top as number) + (style.height as number) / 2;
      expect(centreX).toBeCloseTo((SURFACE_PADDING + 100) * scale, 6);
      expect(centreY).toBeCloseTo((SURFACE_PADDING + 200) * scale, 6);
      expect(style.left).toBeCloseTo((SURFACE_PADDING + 100) * scale - half, 6);
    }
  });

  it("anchors a sized ghost at its own top-left and scales it", () => {
    const style = getCrossScreenGhostStyle({
      ghost: { boardX: 100, boardY: 200, width: 480, height: 390 },
      pan,
      scale: 0.5,
    });
    expect(style.left).toBeCloseTo((SURFACE_PADDING + 100) * 0.5, 6);
    expect(style.width).toBe(240);
    expect(style.height).toBe(195);
  });

  it("honours pan", () => {
    const style = getCrossScreenGhostStyle({
      ghost: { boardX: 0, boardY: 0, width: 10, height: 10 },
      pan: { x: 33, y: 77 },
      scale: 1,
    });
    expect(style.left).toBe(33 + SURFACE_PADDING);
    expect(style.top).toBe(77 + SURFACE_PADDING);
  });
});
