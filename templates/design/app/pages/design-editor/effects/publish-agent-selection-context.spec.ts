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
    activeLeftPanel: null,
    activeTool: "move" as Args["activeTool"],
    design: null,
    designDataJson: {},
    layoutGrids: {},
    designSelectionOwnerIdRef: { current: "owner-1" },
    files: [],
    hoveredElement: null,
    id: "design-1",
    interactDevice: { name: 'MacBook Air 13"', width: 1440, height: 900 },
    interactTheme: "light",
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

describe("runPublishAgentSelectionContext Interact state", () => {
  beforeEach(() => {
    delete (window as unknown as { __designSelection?: unknown })
      .__designSelection;
  });

  it("publishes the device and theme the user chose while previewing", () => {
    runPublishAgentSelectionContext(
      argsFor({
        mode: "interact" as Args["mode"],
        interactDevice: { name: "iPhone 17", width: 402, height: 874 },
        interactTheme: "dark",
      }),
    );
    expect(publishedSelection().interact).toEqual({
      device: { name: "iPhone 17", width: 402, height: 874 },
      theme: "dark",
    });
  });

  it("publishes null outside Interact so a stale default is not read as a choice", () => {
    runPublishAgentSelectionContext(argsFor({ mode: "edit" as Args["mode"] }));
    expect(publishedSelection().interact).toBeNull();
  });

  it("publishes a Custom device with the screen's own size", () => {
    runPublishAgentSelectionContext(
      argsFor({
        mode: "interact" as Args["mode"],
        interactDevice: { name: "Custom", width: 1000, height: 700 },
      }),
    );
    expect(publishedSelection().interact).toMatchObject({
      device: { name: "Custom", width: 1000, height: 700 },
    });
  });
});

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

  it("tells the agent when the Agent tool is the active tool, and which mode it is in", () => {
    runPublishAgentSelectionContext(
      argsFor({ activeTool: "agent", mode: "interact" }),
    );
    expect(publishedSelection()).toMatchObject({
      activeTool: "agent",
      mode: "interact",
    });
  });
});

describe("runPublishAgentSelectionContext inspector", () => {
  it("publishes no inspector tab: the inspector has none", () => {
    runPublishAgentSelectionContext(argsFor());
    expect(publishedSelection()).not.toHaveProperty("inspectorTab");
  });
});
