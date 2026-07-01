import { describe, expect, it } from "vitest";

import { buildCodeLayerProjection } from "../../shared/code-layer";
import {
  buildActiveFileNodeIdSet,
  findMovedCodeLayerNodeInProjection,
  getAvailableContentHistoryChanges,
  getFreshActiveFileContent,
  getFreshScreenContent,
  getUndoRedoPriorityOrder,
  getContentHistoryChanges,
  getDefaultOverviewCanvasZoom,
  getDesignEditorShareUrl,
  getDesignEditorStateUrlSearch,
  getLayerMoveIterationOrder,
  getLayerMoveSourceContent,
  getLocalhostRouteSourceFile,
  getOverviewCanvasZoom,
  getOverviewDisplayZoom,
  getOverviewEnterTarget,
  getOverviewScreenIdsFromLayerSelection,
  getOverviewZoomScale,
  parseInlineStyleAttribute,
  refreshElementInfoFromContent,
  removeUndoRedoOrderKind,
  getSidebarCodeLayerSelectionState,
  hydrateMotionDockTracks,
  isScreenRootElementInfo,
  resolveCodeLayerNodeFromElementInfo,
  getSelectedScreenIdsForEditorState,
  shouldReplacePreviewAfterVisualStyleCommit,
  shouldLimitEditorChromeUntilContentReady,
  shouldEscapeToOverview,
  sortCodeLayerIdsByTreeOrder,
} from "./DesignEditor";

describe("DesignEditor overview selection state", () => {
  it("uses the explicit overview screen selection while in overview", () => {
    expect(
      getSelectedScreenIdsForEditorState({
        activeFileId: "screen-active",
        overviewSelectedScreenIds: ["screen-a", "screen-b"],
        viewMode: "overview",
      }),
    ).toEqual(["screen-a", "screen-b"]);
  });

  it("falls back to the active screen in single-screen mode", () => {
    expect(
      getSelectedScreenIdsForEditorState({
        activeFileId: "screen-active",
        overviewSelectedScreenIds: ["screen-a", "screen-b"],
        viewMode: "single",
      }),
    ).toEqual(["screen-active"]);
  });
});

describe("DesignEditor visual style preview replacement", () => {
  it("skips runtime document replacement for iframe-origin style commits", () => {
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: true,
        runtimeStyleApplied: false,
      }),
    ).toBe(false);
  });

  it("replaces the runtime document for inspector-origin style commits when no runtime bridge handled it", () => {
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: false,
        runtimeStyleApplied: false,
      }),
    ).toBe(true);
  });

  it("skips runtime document replacement when a runtime bridge already applied inspector styles", () => {
    expect(
      shouldReplacePreviewAfterVisualStyleCommit({
        runtimeApplied: false,
        runtimeStyleApplied: true,
      }),
    ).toBe(false);
  });
});

describe("DesignEditor overview layer selection", () => {
  it("extracts selected screen ids from file layer rows", () => {
    expect(
      getOverviewScreenIdsFromLayerSelection({
        fileIds: ["screen-a", "screen-b"],
        layerIds: ["screen-a", "screen-b"],
      }),
    ).toEqual(["screen-a", "screen-b"]);
  });

  it("supports code-prefixed screen row ids and keeps selection order", () => {
    expect(
      getOverviewScreenIdsFromLayerSelection({
        fileIds: ["screen-a", "screen-b"],
        layerIds: ["code:screen-b", "screen-a", "code:screen-b"],
      }),
    ).toEqual(["screen-b", "screen-a"]);
  });

  it("ignores nested element layer ids when syncing screen selection", () => {
    expect(
      getOverviewScreenIdsFromLayerSelection({
        fileIds: ["screen-a", "screen-b"],
        layerIds: ["hero-title", "element:runtime", "screen-b"],
      }),
    ).toEqual(["screen-b"]);
  });

  it("returns an empty overview selection when only nested layers remain selected", () => {
    expect(
      getOverviewScreenIdsFromLayerSelection({
        fileIds: ["screen-a", "screen-b"],
        layerIds: ["hero-title", "element:runtime"],
      }),
    ).toEqual([]);
  });
});

describe("DesignEditor overview enter target", () => {
  it("prefers the active file when it is part of the overview selection", () => {
    expect(
      getOverviewEnterTarget({
        activeFileId: "screen-b",
        overviewSelectedScreenIds: ["screen-a", "screen-b"],
      }),
    ).toBe("screen-b");
  });

  it("uses the most recently selected overview screen when active is outside the selection", () => {
    expect(
      getOverviewEnterTarget({
        activeFileId: "screen-active",
        overviewSelectedScreenIds: ["screen-a", "screen-b"],
      }),
    ).toBe("screen-b");
  });

  it("falls back to the active file when overview selection is empty", () => {
    expect(
      getOverviewEnterTarget({
        activeFileId: "screen-active",
        overviewSelectedScreenIds: [],
      }),
    ).toBe("screen-active");
  });
});

describe("DesignEditor sidebar code layer selection", () => {
  it("keeps the owning screen selected when selecting a nested layer in overview", () => {
    expect(
      getSidebarCodeLayerSelectionState({
        currentViewMode: "overview",
        ownerFileId: "screen-a",
        overviewSelectedScreenIds: ["previous-screen"],
        screenFileIds: ["screen-a", "screen-b"],
      }),
    ).toEqual({
      viewMode: "overview",
      overviewSelectedScreenIds: ["screen-a"],
    });
  });

  it("clears screen selection when selecting a board layer in overview", () => {
    expect(
      getSidebarCodeLayerSelectionState({
        currentViewMode: "overview",
        ownerFileId: "board-file",
        overviewSelectedScreenIds: ["screen-a"],
        screenFileIds: ["screen-a", "screen-b"],
      }),
    ).toEqual({
      viewMode: "overview",
      overviewSelectedScreenIds: [],
    });
  });

  it("leaves single-screen selection state alone", () => {
    expect(
      getSidebarCodeLayerSelectionState({
        currentViewMode: "single",
        ownerFileId: "board-file",
        overviewSelectedScreenIds: ["screen-a"],
        screenFileIds: ["screen-a"],
      }),
    ).toEqual({
      viewMode: "single",
      overviewSelectedScreenIds: ["screen-a"],
    });
  });
});

describe("DesignEditor screen root hover", () => {
  it("classifies document roots as screen hover instead of child-layer hover", () => {
    expect(
      isScreenRootElementInfo({
        tagName: "body",
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 320, height: 640 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
    ).toBe(true);
    expect(
      isScreenRootElementInfo({
        tagName: "h1",
        classes: [],
        computedStyles: {},
        boundingRect: { x: 0, y: 0, width: 100, height: 40 },
        isFlexChild: false,
        isFlexContainer: false,
      }),
    ).toBe(false);
  });
});

describe("DesignEditor motion timeline hydration", () => {
  it("labels persisted motion tracks from the active code-layer projection", () => {
    const projection = buildCodeLayerProjection(`
      <button
        data-agent-native-node-id="e2e-alpha-button"
        data-agent-native-layer-name="Alpha Button"
      >
        Alpha Button
      </button>
    `);

    expect(
      hydrateMotionDockTracks(
        [
          {
            targetNodeId: "e2e-alpha-button",
            property: "opacity",
            keyframes: [
              { t: 0, value: "0" },
              { t: 1, value: "1" },
            ],
          },
        ],
        projection,
      ),
    ).toEqual([
      {
        targetNodeId: "e2e-alpha-button",
        label: "Alpha Button",
        property: "opacity",
        keyframes: [
          { t: 0, value: "0" },
          { t: 1, value: "1" },
        ],
      },
    ]);
  });
});

describe("DesignEditor overview zoom display", () => {
  it("reports zoom relative to the source screen size, not the overview frame", () => {
    const scale = getOverviewZoomScale({
      frameWidth: 320,
      sourceWidth: 1280,
    });

    expect(getOverviewDisplayZoom(100, scale)).toBe(25);
    expect(getOverviewCanvasZoom(100, scale)).toBe(400);
  });

  it("defaults the overview display zoom to 60%", () => {
    const scale = getOverviewZoomScale({
      frameWidth: 1440,
      sourceWidth: 1024,
    });

    expect(
      getOverviewDisplayZoom(getDefaultOverviewCanvasZoom(scale), scale),
    ).toBe(60);
  });
});

describe("DesignEditor share URLs", () => {
  it("keeps the app base path when building editor share links", () => {
    expect(
      getDesignEditorShareUrl(
        "design-123",
        "https://builder.example",
        "/workspace",
      ),
    ).toBe("https://builder.example/workspace/design/design-123");
  });

  it("builds root-mounted editor share links without a base path", () => {
    expect(
      getDesignEditorShareUrl("design-123", "https://builder.example"),
    ).toBe("https://builder.example/design/design-123");
  });
});

describe("DesignEditor URL state", () => {
  it("serializes focused screen and selection state while preserving unrelated params", () => {
    expect(
      getDesignEditorStateUrlSearch({
        currentSearch: "?design_host=builder&view=overview&fileId=old",
        viewMode: "single",
        screenId: "screen-123",
        selectionId: "node-456",
        zoom: 100,
      }),
    ).toBe(
      "?design_host=builder&view=single&screen=screen-123&selection=node-456&zoom=100",
    );
  });

  it("removes stale selection aliases when no element is selected", () => {
    expect(
      getDesignEditorStateUrlSearch({
        currentSearch:
          "?view=single&screen=screen-123&selection=node-456&filename=old.html&zoom=125.555",
        viewMode: "overview",
        screenId: "screen-123",
        selectionId: null,
        zoom: 33.3333,
      }),
    ).toBe("?view=overview&screen=screen-123&zoom=33.33");
  });
});

describe("DesignEditor localhost route source", () => {
  it("prefers explicit route metadata sourceFile for local handoff", () => {
    expect(
      getLocalhostRouteSourceFile({
        sourceFile: "app/routes/home.tsx",
        source: '{"file":"legacy.tsx"}',
      }),
    ).toBe("app/routes/home.tsx");
  });

  it("falls back to legacy source metadata shapes", () => {
    expect(
      getLocalhostRouteSourceFile({
        source: '{"file":"app/routes/settings.tsx"}',
      }),
    ).toBe("app/routes/settings.tsx");
    expect(
      getLocalhostRouteSourceFile({ source: "app/routes/plain.tsx" }),
    ).toBe("app/routes/plain.tsx");
  });
});

describe("DesignEditor layer move source snapshots", () => {
  it("prefers the latest local active content snapshot during rapid edits", () => {
    expect(
      getFreshActiveFileContent({
        activeContent: "stale react content",
        latestContent: null,
        lastLocalContent: "fresh local content",
      }),
    ).toBe("fresh local content");

    expect(
      getFreshActiveFileContent({
        activeContent: "stale react content",
        latestContent: "remote or local latest content",
        lastLocalContent: "older local content",
      }),
    ).toBe("remote or local latest content");

    expect(
      getFreshActiveFileContent({
        activeContent: "current react content",
        latestContent: null,
        lastLocalContent: null,
      }),
    ).toBe("current react content");
  });

  it("uses the progressive source snapshot before active file content", () => {
    expect(
      getLayerMoveSourceContent({
        sourceFileId: "active",
        activeFileId: "active",
        activeContent: "original active",
        sourceFileContent: "stale file",
        sourceContentMap: new Map([["active", "after first move"]]),
      }),
    ).toBe("after first move");
  });

  it("falls back to active content or source file content for first move", () => {
    expect(
      getLayerMoveSourceContent({
        sourceFileId: "active",
        activeFileId: "active",
        activeContent: "original active",
        sourceFileContent: "stale file",
        sourceContentMap: new Map(),
      }),
    ).toBe("original active");
    expect(
      getLayerMoveSourceContent({
        sourceFileId: "other",
        activeFileId: "active",
        activeContent: "original active",
        sourceFileContent: "other file",
        sourceContentMap: new Map(),
      }),
    ).toBe("other file");
  });

  it("orders same-file multi-layer moves by tree order", () => {
    const tree = [
      {
        id: "parent",
        children: [
          { id: "heading", children: [] },
          {
            id: "content",
            children: [
              { id: "button", children: [] },
              { id: "caption", children: [] },
            ],
          },
        ],
      },
    ] as any;

    expect(
      sortCodeLayerIdsByTreeOrder(["caption", "heading", "missing"], tree),
    ).toEqual(["heading", "caption", "missing"]);
  });

  it("iterates after-drops in reverse so same-anchor inserts keep tree order", () => {
    expect(getLayerMoveIterationOrder(["a", "b", "c"], "after")).toEqual([
      "c",
      "b",
      "a",
    ]);

    expect(getLayerMoveIterationOrder(["a", "b", "c"], "before")).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(getLayerMoveIterationOrder(["a", "b", "c"], "inside")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("resolves cross-file moved nodes by remapped destination ids first", () => {
    const previousProjection = buildCodeLayerProjection(
      `<main><section data-agent-native-node-id="shared">Card</section></main>`,
    );
    const nextProjection = buildCodeLayerProjection(
      `<main><section data-agent-native-node-id="moved-shared">Card</section></main>`,
    );
    const previousNode = previousProjection.nodes.find(
      (node) => node.dataAttributes["data-agent-native-node-id"] === "shared",
    );

    expect(previousNode).toBeTruthy();
    expect(
      findMovedCodeLayerNodeInProjection(
        nextProjection,
        previousNode!,
        "moved-shared",
      )?.dataAttributes["data-agent-native-node-id"],
    ).toBe("moved-shared");
  });

  it("uses the fresh active snapshot when resolving overview screen content", () => {
    const fileContentById = new Map([
      ["active", "stale persisted active"],
      ["other", "other screen content"],
    ]);

    expect(
      getFreshScreenContent({
        screenId: "active",
        activeFileId: "active",
        freshActiveContent: "fresh active content",
        fileContentById,
      }),
    ).toBe("fresh active content");

    expect(
      getFreshScreenContent({
        screenId: "other",
        activeFileId: "active",
        freshActiveContent: "fresh active content",
        fileContentById,
      }),
    ).toBe("other screen content");
  });

  it("does not use a stale active snapshot for a different active file", () => {
    const fileContentById = new Map([
      ["screen", "screen content"],
      ["board", "board content"],
    ]);

    expect(
      getFreshScreenContent({
        screenId: "screen",
        activeFileId: "screen",
        freshActiveContentFileId: "board",
        freshActiveContent: "stale board content",
        fileContentById,
      }),
    ).toBe("screen content");
  });
});

describe("DesignEditor escape semantics", () => {
  it("returns to overview only from a plain single-screen move state", () => {
    expect(
      shouldEscapeToOverview({
        activeTool: "move",
        drawMode: false,
        mode: "edit",
        pinMode: false,
        selectedElement: null,
        viewMode: "single",
      }),
    ).toBe(true);
  });

  it("stays in direct edit when a nested element is selected", () => {
    expect(
      shouldEscapeToOverview({
        activeTool: "move",
        drawMode: false,
        mode: "edit",
        pinMode: false,
        selectedElement: {
          tagName: "div",
          selector: "[data-agent-native-node-id='hero']",
          classes: [],
          computedStyles: {},
          boundingRect: { x: 0, y: 0, width: 10, height: 10 },
          isFlexChild: false,
          isFlexContainer: false,
        },
        viewMode: "single",
      }),
    ).toBe(false);
  });

  it("stays in direct edit while another tool or mode is active", () => {
    expect(
      shouldEscapeToOverview({
        activeTool: "pen",
        drawMode: false,
        mode: "edit",
        pinMode: false,
        selectedElement: null,
        viewMode: "single",
      }),
    ).toBe(false);
    expect(
      shouldEscapeToOverview({
        activeTool: "move",
        drawMode: true,
        mode: "annotate",
        pinMode: false,
        selectedElement: null,
        viewMode: "single",
      }),
    ).toBe(false);
  });
});

describe("DesignEditor initial generation chrome", () => {
  it("limits editor chrome until generated content is ready", () => {
    expect(
      shouldLimitEditorChromeUntilContentReady({
        fileCount: 0,
        hasActiveCanvasContent: false,
        generating: true,
        pendingGenerationActive: false,
      }),
    ).toBe(true);
    expect(
      shouldLimitEditorChromeUntilContentReady({
        fileCount: 0,
        hasActiveCanvasContent: false,
        generating: false,
        pendingGenerationActive: false,
      }),
    ).toBe(false);
    expect(
      shouldLimitEditorChromeUntilContentReady({
        fileCount: 0,
        hasActiveCanvasContent: false,
        generating: false,
        pendingGenerationActive: true,
      }),
    ).toBe(true);
    expect(
      shouldLimitEditorChromeUntilContentReady({
        fileCount: 1,
        hasActiveCanvasContent: false,
        generating: false,
        pendingGenerationActive: true,
      }),
    ).toBe(true);
    expect(
      shouldLimitEditorChromeUntilContentReady({
        fileCount: 1,
        hasActiveCanvasContent: true,
        generating: true,
        pendingGenerationActive: true,
      }),
    ).toBe(false);
  });
});

describe("DesignEditor element canonicalization", () => {
  it("resolves stale runtime positional selectors by source-backed element details", () => {
    const projection = buildCodeLayerProjection(
      `<main><div class="tile">Alpha</div><div class="tile">Beta</div></main>`,
    );

    const node = resolveCodeLayerNodeFromElementInfo(projection, {
      tagName: "div",
      selector:
        'body[data-agent-native-node-id="an-runtime"] > div:nth-of-type(6)',
      classes: ["tile"],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Beta",
      isFlexChild: false,
      isFlexContainer: false,
    });

    expect(node?.textSnippet).toBe("Beta");
  });

  it("uses element details instead of treating weak selectors as exact matches", () => {
    const projection = buildCodeLayerProjection(
      `<main><div class="tile">Alpha</div><div class="tile">Beta</div></main>`,
    );

    const node = resolveCodeLayerNodeFromElementInfo(projection, {
      tagName: "div",
      selector: "div",
      classes: ["tile"],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Beta",
      isFlexChild: false,
      isFlexContainer: false,
    });

    expect(node?.textSnippet).toBe("Beta");
  });

  it("does not guess when stale runtime element details are ambiguous", () => {
    const projection = buildCodeLayerProjection(
      `<main><div class="tile">Same</div><div class="tile">Same</div></main>`,
    );

    const node = resolveCodeLayerNodeFromElementInfo(projection, {
      tagName: "div",
      selector: 'body[data-agent-native-node-id="an-runtime"] > div',
      classes: ["tile"],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Same",
      isFlexChild: false,
      isFlexContainer: false,
    });

    expect(node).toBeNull();
  });

  it("does not resolve a runtime-only chrome element that has no source signal", () => {
    // The editor injects overlay <div>s (selection/highlight/measurement/etc.)
    // directly into the iframe body. If one leaks into a selection, its payload
    // has no text, no design classes, and a body-rooted positional selector. It
    // must resolve to null (runtime-only) so the editor fails softly instead of
    // silently editing an unrelated source node.
    const projection = buildCodeLayerProjection(
      `<main><section class="hero"><div class="copy">Headline</div></section></main>`,
    );

    const node = resolveCodeLayerNodeFromElementInfo(projection, {
      tagName: "div",
      selector:
        'body[data-agent-native-node-id="an-wonwkk"] > div:nth-of-type(6)',
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "",
      isFlexChild: false,
      isFlexContainer: false,
    });

    expect(node).toBeNull();
  });

  it("refreshes selected element styles from current source content", () => {
    const previous = {
      tagName: "section",
      selector: '[data-agent-native-node-id="hero"]',
      sourceId: "hero",
      classes: [],
      computedStyles: { color: "red" },
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Hero",
      isFlexChild: false,
      isFlexContainer: false,
    };

    const refreshed = refreshElementInfoFromContent(
      `<main><section data-agent-native-node-id="hero" style="color: blue; background-color: yellow">Hero</section></main>`,
      previous,
    );

    expect(refreshed?.computedStyles.color).toBe("blue");
    expect(refreshed?.computedStyles["background-color"]).toBe("yellow");
    expect(refreshed?.computedStyles.backgroundColor).toBe("yellow");
  });

  it("does not retain stale computed styles after the source style is removed", () => {
    const previous = {
      tagName: "section",
      selector: '[data-agent-native-node-id="hero"]',
      sourceId: "hero",
      classes: [],
      computedStyles: { color: "red" },
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Hero",
      isFlexChild: false,
      isFlexContainer: false,
    };

    const refreshed = refreshElementInfoFromContent(
      `<main><section data-agent-native-node-id="hero">Hero</section></main>`,
      previous,
    );

    expect(refreshed?.computedStyles.color).toBeUndefined();
  });

  it("preserves live computed styles for class-backed source nodes", () => {
    const previous = {
      tagName: "section",
      selector: '[data-agent-native-node-id="hero"]',
      sourceId: "hero",
      classes: ["hero"],
      computedStyles: { color: "rgb(10, 20, 30)", fontSize: "32px" },
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Hero",
      isFlexChild: false,
      isFlexContainer: false,
    };

    const refreshed = refreshElementInfoFromContent(
      `<main><section class="hero" data-agent-native-node-id="hero">Hero</section></main>`,
      previous,
    );

    expect(refreshed?.computedStyles.color).toBe("rgb(10, 20, 30)");
    expect(refreshed?.computedStyles.fontSize).toBe("32px");
  });

  it("refreshes source-backed child counts and class-derived flex layout", () => {
    const previous = {
      tagName: "section",
      selector: '[data-agent-native-node-id="hero"]',
      sourceId: "hero",
      classes: [],
      computedStyles: {},
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      isFlexChild: false,
      isFlexContainer: false,
    };

    const refreshed = refreshElementInfoFromContent(
      `<main><section class="flex" data-agent-native-node-id="hero"><div>Child</div></section></main>`,
      previous,
    );

    expect(refreshed?.childElementCount).toBe(1);
    expect(refreshed?.isFlexContainer).toBe(true);
  });

  it("drops stale class-backed computed styles when the source class is removed", () => {
    const previous = {
      tagName: "section",
      selector: '[data-agent-native-node-id="hero"]',
      sourceId: "hero",
      classes: ["hero"],
      computedStyles: { color: "rgb(10, 20, 30)", fontSize: "32px" },
      boundingRect: { x: 0, y: 0, width: 10, height: 10 },
      textContent: "Hero",
      isFlexChild: false,
      isFlexContainer: false,
    };

    const refreshed = refreshElementInfoFromContent(
      `<main><section data-agent-native-node-id="hero">Hero</section></main>`,
      previous,
    );

    expect(refreshed?.classes).toEqual([]);
    expect(refreshed?.computedStyles.color).toBeUndefined();
    expect(refreshed?.computedStyles.fontSize).toBeUndefined();
  });

  it("parses inline style declarations without carrying stale properties", () => {
    expect(parseInlineStyleAttribute(" color : red ; width: 20px; ")).toEqual({
      color: "red",
      width: "20px",
    });
    expect(parseInlineStyleAttribute("")).toEqual({});
  });
});

describe("DesignEditor undo order helpers", () => {
  it("removes stale active content entries without disturbing file content or geometry entries", () => {
    expect(
      removeUndoRedoOrderKind(
        ["content", "geometry", "file-content", "content", "geometry"],
        "content",
      ),
    ).toEqual(["geometry", "file-content", "geometry"]);
  });

  it("keeps grouped file-content history changes together", () => {
    expect(
      getContentHistoryChanges({
        changes: [
          { fileId: "screen-a", before: "<a>old</a>", after: "<a>new</a>" },
          { fileId: "screen-b", before: "<b>old</b>", after: "<b>new</b>" },
        ],
      }),
    ).toEqual([
      { fileId: "screen-a", before: "<a>old</a>", after: "<a>new</a>" },
      { fileId: "screen-b", before: "<b>old</b>", after: "<b>new</b>" },
    ]);
  });

  it("skips deleted files in grouped file-content history entries", () => {
    expect(
      getAvailableContentHistoryChanges(
        {
          changes: [
            { fileId: "screen-a", before: "<a>old</a>", after: "<a>new</a>" },
            {
              fileId: "deleted-screen",
              before: "<b>old</b>",
              after: "<b>new</b>",
            },
          ],
        },
        ["screen-a"],
        null,
      ),
    ).toEqual([
      { fileId: "screen-a", before: "<a>old</a>", after: "<a>new</a>" },
    ]);
  });

  it("keeps active content and grouped file-content stacks distinct", () => {
    expect(getUndoRedoPriorityOrder("file-content")).toEqual([
      "file-content",
      "content",
      "geometry",
    ]);
    expect(getUndoRedoPriorityOrder("content")).toEqual([
      "content",
      "file-content",
      "geometry",
    ]);
  });
});

describe("buildActiveFileNodeIdSet (group/ungroup stale-id filter)", () => {
  it("includes both projection ids and data-agent-native-node-id attr values", () => {
    const html = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="node-a">A</div>
      <div data-agent-native-node-id="node-b">B</div>
    </body></html>`;
    const projection = buildCodeLayerProjection(html);
    const idSet = buildActiveFileNodeIdSet(projection);

    // Projection ids (internal) should be present.
    for (const n of projection.nodes) {
      expect(idSet.has(n.id)).toBe(true);
    }
    // data-agent-native-node-id attr values should be present.
    expect(idSet.has("node-a")).toBe(true);
    expect(idSet.has("node-b")).toBe(true);
  });

  it("excludes ids that belong to nodes outside the active file", () => {
    const activeHtml = `<!DOCTYPE html><html><body>
      <div data-agent-native-node-id="active-node-1">A</div>
      <div data-agent-native-node-id="active-node-2">B</div>
    </body></html>`;
    const activeProjection = buildCodeLayerProjection(activeHtml);
    const activeNodeIdSet = buildActiveFileNodeIdSet(activeProjection);

    // Ids from a second (non-active) file are NOT in the active set.
    expect(activeNodeIdSet.has("other-file-node")).toBe(false);

    // simulated selectedLayerIdsState that mixes active + stale ids
    const files = [{ id: "file-a" }, { id: "file-b" }];
    const fileIds = new Set(files.map((f) => f.id));
    const allLayerIds = [
      "active-node-1",
      "active-node-2",
      "other-file-node", // stale id from non-active file
      "file-a", // file-row id — should be excluded by fileIds filter
    ];

    const filteredNodeIds = allLayerIds.filter(
      (id) =>
        !id.startsWith("__") && !fileIds.has(id) && activeNodeIdSet.has(id),
    );

    // Only the two active-file node attr ids pass through.
    expect(filteredNodeIds).toEqual(["active-node-1", "active-node-2"]);
  });

  it("handles nodes without data-agent-native-node-id (only projection id exposed)", () => {
    const html = `<!DOCTYPE html><html><body>
      <div class="plain">No node id attr</div>
    </body></html>`;
    const projection = buildCodeLayerProjection(html);
    const idSet = buildActiveFileNodeIdSet(projection);

    // At least one projection id is present.
    expect(idSet.size).toBeGreaterThan(0);
    for (const n of projection.nodes) {
      expect(idSet.has(n.id)).toBe(true);
    }
  });
});
