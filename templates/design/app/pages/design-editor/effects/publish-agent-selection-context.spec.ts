// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { runPublishAgentSelectionContext } from "./publish-agent-selection-context";

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  setClientAppState: vi.fn(() => Promise.resolve()),
}));

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
