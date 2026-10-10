// @vitest-environment happy-dom

import { setClientAppState } from "@agent-native/core/client/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  DesignSelectionPublishError,
  runPublishAgentSelectionContext,
} from "./publish-agent-selection-context";

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

function deepScreenElement(): ElementInfo {
  const dataUrl = `data:image/png;base64,${"A".repeat(200_000)}`;
  return {
    tagName: "section",
    sourceId: "node-root",
    selector: '[data-agent-native-node-id="node-root"]',
    classes: [
      ...Array.from({ length: 500 }, (_, index) => `class-${index}`),
      `bg-[url('${dataUrl}')]`,
    ],
    computedStyles: {
      color: "rgb(0, 0, 0)",
      fontFamily: "Inter, sans-serif",
      backgroundImage: `url("${dataUrl}")`,
    },
    portableStyleSnapshot: {
      version: 1,
      rootSourceId: "node-root",
      nodes: Array.from({ length: 5_000 }, (_, index) => ({
        sourceId: `node-${index}`,
        path: [index],
        styles: { color: "rgb(1, 2, 3)", "--token": "x".repeat(400) },
      })),
    },
    imageSource: dataUrl,
    textContent: "t".repeat(50_000),
    htmlContent: "<div></div>".repeat(400),
    boundingRect: { x: 0, y: 0, width: 1440, height: 9000 },
    isFlexChild: false,
    isFlexContainer: true,
  };
}

function writtenSelection(): Record<string, unknown> {
  const calls = vi.mocked(setClientAppState).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![1] as Record<string, unknown>;
}

describe("runPublishAgentSelectionContext application state write", () => {
  beforeEach(() => {
    vi.mocked(setClientAppState).mockClear();
    vi.mocked(setClientAppState).mockImplementation(() =>
      Promise.resolve(null),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it("writes the selected element's ids and a bounded summary, never its style snapshot", () => {
    const files = Array.from({ length: 48 }, (_, index) => ({
      id: `screen-${index}`,
      filename: `nested-${index}.html`,
      fileType: "html",
    })) as Args["files"];
    runPublishAgentSelectionContext(
      argsFor({ files, selectedElement: deepScreenElement() }),
    );

    const value = writtenSelection();
    const selected = value.selectedElement as Record<string, unknown>;
    expect(selected).toMatchObject({
      tagName: "section",
      sourceId: "node-root",
      selector: '[data-agent-native-node-id="node-root"]',
      classCount: 501,
      textContentTruncated: true,
      computedStyles: {
        color: "rgb(0, 0, 0)",
        fontFamily: "Inter, sans-serif",
      },
    });
    expect(selected).not.toHaveProperty("portableStyleSnapshot");
    expect(JSON.stringify(selected).length).toBeLessThan(4_000);
    expect(JSON.stringify(value)).not.toContain("data:image");
    expect(JSON.stringify(value).length).toBeLessThan(16_000);
  });

  it("does not send the write as keepalive, whose 64 KB cap rejects a large body", () => {
    runPublishAgentSelectionContext(
      argsFor({ selectedElement: deepScreenElement() }),
    );

    for (const call of vi.mocked(setClientAppState).mock.calls) {
      expect(call[2]?.keepalive).not.toBe(true);
    }
  });

  it("reports a rejected write as a typed error and retries the same selection next time", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const cause = new TypeError("Failed to fetch");
    vi.mocked(setClientAppState).mockImplementation(() =>
      Promise.reject(cause),
    );
    const args = argsFor({ selectedElement: deepScreenElement() });

    runPublishAgentSelectionContext(args);
    const firstWriteCount = vi.mocked(setClientAppState).mock.calls.length;
    await vi.waitFor(() =>
      expect(consoleError).toHaveBeenCalledTimes(firstWriteCount),
    );

    const reported = consoleError.mock.calls.map((call) => call[0]);
    for (const error of reported) {
      expect(error).toBeInstanceOf(DesignSelectionPublishError);
      expect(error).toMatchObject({
        name: "DesignSelectionPublishError",
        cause,
      });
    }
    expect(
      reported.map((error) => (error as DesignSelectionPublishError).key),
    ).toEqual(vi.mocked(setClientAppState).mock.calls.map((call) => call[0]));
    expect(args.persistedSelectionStateRef.current).toBeNull();

    vi.mocked(setClientAppState).mockImplementation(() =>
      Promise.resolve(null),
    );
    runPublishAgentSelectionContext(args);
    expect(vi.mocked(setClientAppState).mock.calls.length).toBe(
      firstWriteCount * 2,
    );
  });
});
