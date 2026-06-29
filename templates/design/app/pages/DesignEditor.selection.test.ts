import { describe, expect, it } from "vitest";

import {
  getDesignEditorShareUrl,
  getOverviewCanvasZoom,
  getOverviewDisplayZoom,
  getOverviewEnterTarget,
  getOverviewZoomScale,
  getSelectedScreenIdsForEditorState,
  shouldLockInspectorForInitialGeneration,
  shouldEscapeToOverview,
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

describe("DesignEditor overview zoom display", () => {
  it("reports zoom relative to the source screen size, not the overview frame", () => {
    const scale = getOverviewZoomScale({
      frameWidth: 320,
      sourceWidth: 1280,
    });

    expect(getOverviewDisplayZoom(100, scale)).toBe(25);
    expect(getOverviewCanvasZoom(100, scale)).toBe(400);
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

describe("DesignEditor initial generation inspector lock", () => {
  it("locks the inspector only while an empty design is generating", () => {
    expect(
      shouldLockInspectorForInitialGeneration({
        fileCount: 0,
        generating: true,
        pendingGenerationActive: false,
      }),
    ).toBe(true);
    expect(
      shouldLockInspectorForInitialGeneration({
        fileCount: 0,
        generating: false,
        pendingGenerationActive: true,
      }),
    ).toBe(true);
    expect(
      shouldLockInspectorForInitialGeneration({
        fileCount: 1,
        generating: true,
        pendingGenerationActive: true,
      }),
    ).toBe(false);
  });
});
