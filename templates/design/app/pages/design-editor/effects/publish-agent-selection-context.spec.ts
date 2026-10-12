// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPublishAgentSelectionContext } from "./publish-agent-selection-context";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBrowserTabId: vi.fn(() => "tab-123"),
  setClientAppState: vi.fn(() => Promise.resolve()),
}));

import { setClientAppState } from "@agent-native/core/client/hooks";
import { assertNoInlineImageBytes } from "@agent-native/core/testing";

type Args = Parameters<typeof runPublishAgentSelectionContext>[0];

function argsFor(overrides: Partial<Args> = {}): Args {
  return {
    activeBreakpointWidthState: undefined,
    activeCodeFile: null,
    activeFile: {
      id: "screen-1",
      filename: "index.html",
    } as Args["activeFile"],
    activeInspectorTab: "design" as Args["activeInspectorTab"],
    activeLeftPanel: null,
    activeTool: "move" as Args["activeTool"],
    design: null,
    designDataJson: {},
    layoutGrids: {},
    designSelectionOwnerIdRef: { current: "owner-1" },
    files: [],
    hoveredElement: null,
    id: "design-1",
    isSignedIn: true,
    mode: "edit" as Args["mode"],
    motionDockOpen: false,
    pendingPersistedSelectionWriteRef: { current: null },
    persistedSelectionContextRef: { current: null },
    persistedSelectionStateRef: { current: null },
    persistedSelectionWriteTimerRef: { current: null },
    responsiveEditScope: "base" as Args["responsiveEditScope"],
    selectedElement: null,
    selectedScreenIds: [],
    selectedStateId: null,
    viewMode: "overview" as Args["viewMode"],
    zoom: 100,
    ...overrides,
  };
}

function publishedSelection(): Record<string, unknown> {
  return (window as unknown as { __designSelection: Record<string, unknown> })
    .__designSelection;
}

describe("runPublishAgentSelectionContext layout grid", () => {
  beforeEach(() => {
    delete (window as unknown as { __designSelection?: unknown })
      .__designSelection;
  });

  it("publishes the active screen's grid so the agent places on the same multiples", () => {
    runPublishAgentSelectionContext(
      argsFor({
        layoutGrids: {
          "screen-1": { kind: "uniform", size: 8, visible: true },
        },
      }),
    );
    expect(publishedSelection().layoutGrid).toEqual({
      kind: "uniform",
      size: 8,
      visible: true,
    });
  });

  it("publishes null for a screen with no grid, not a default 8px one", () => {
    runPublishAgentSelectionContext(argsFor());
    expect(publishedSelection().layoutGrid).toBeNull();
  });

  it("publishes with no active file at all — the editor mounts before one exists", () => {
    expect(() =>
      runPublishAgentSelectionContext(argsFor({ activeFile: undefined })),
    ).not.toThrow();
    expect(publishedSelection().layoutGrid).toBeNull();
    expect(publishedSelection().activeFileId).toBeNull();
  });
});

describe("runPublishAgentSelectionContext published image data", () => {
  beforeEach(() => {
    vi.mocked(setClientAppState).mockClear();
    delete (window as unknown as { __designSelection?: unknown })
      .__designSelection;
  });

  it("sanitizes only persisted tab and global selection values", () => {
    const inlineImage = "data:image/gif;base64,R0lGODlhAQABAIAA";
    const inlineSvg =
      "DATA:image/svg+xml;charset=utf-8,%3Csvg%20aria-label%3D%22caf%C3%A9%22%3E";
    const selectedElement = {
      tagName: "img",
      id: "hero-image",
      sourceId: "node-source-7",
      selector: "#hero-image",
      path: [0, 2, 1],
      sourceLayerIdentity: { screenId: "screen-1", nodeId: "node-source-7" },
      imageSource: inlineImage,
      htmlContent: `<img src="${inlineImage}">`,
      computedStyles: {
        backgroundImage: `url('${inlineSvg}')`,
        objectFit: "cover",
      },
      referenceUrl: "https://cdn.example.test/hero.png",
    } as unknown as Args["selectedElement"];

    runPublishAgentSelectionContext(argsFor({ selectedElement }));

    expect(publishedSelection().selectedElement).toBe(selectedElement);
    expect(selectedElement?.imageSource).toBe(inlineImage);
    expect(setClientAppState).toHaveBeenCalledTimes(2);

    const writes = vi.mocked(setClientAppState).mock.calls;
    expect(writes.map(([key]) => key)).toEqual([
      "design-selection:tab-123",
      "design-selection",
    ]);
    const [tabValue, globalValue] = writes.map(([, value]) => value as any);
    expect(tabValue).toEqual(globalValue);
    expect(tabValue.selectedElement).toMatchObject({
      id: "hero-image",
      sourceId: "node-source-7",
      selector: "#hero-image",
      path: [0, 2, 1],
      sourceLayerIdentity: { screenId: "screen-1", nodeId: "node-source-7" },
      imageSource: "[inline image/gif data omitted]",
      computedStyles: {
        backgroundImage: "url('[inline image/svg+xml data omitted]')",
        objectFit: "cover",
      },
      referenceUrl: "https://cdn.example.test/hero.png",
    });
    expect(JSON.stringify(tabValue)).not.toMatch(/data:image|base64,/i);
    expect(() => assertNoInlineImageBytes(tabValue)).not.toThrow();
  });
});
