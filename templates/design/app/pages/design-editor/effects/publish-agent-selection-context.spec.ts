// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ElementInfo } from "@/components/design/types";

import {
  DesignSelectionPublishError,
  runPublishAgentSelectionContext,
} from "./publish-agent-selection-context";

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
    motionAutoKeyframeEnabled: false,
    motionDockOpen: false,
    motionDockLiveState: {
      previewing: false,
      selectedTrackId: null,
      selectedKeyframeIds: [],
    },
    motionDurationMs: 2000,
    motionPlayhead: 0,
    motionPlaybackMode: "once",
    motionTimelineId: null,
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

  it("publishes System as System, so the agent sees the choice and not a resolved guess", () => {
    runPublishAgentSelectionContext(
      argsFor({
        mode: "interact" as Args["mode"],
        interactTheme: "system",
      }),
    );
    expect(publishedSelection().interact).toMatchObject({ theme: "system" });
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

  it("publishes the live Motion timeline and keyframe selection", () => {
    runPublishAgentSelectionContext(
      argsFor({
        motionAutoKeyframeEnabled: true,
        motionDockOpen: true,
        motionDockLiveState: {
          previewing: true,
          selectedTrackId: "node-1\u001ftranslate",
          selectedKeyframeIds: [
            '["node-1\\u001ftranslate",0.5]',
            '["node-1\\u001ftranslate",1]',
          ],
        },
        motionDurationMs: 3600,
        motionPlayhead: 0.5,
        motionPlaybackMode: "ping-pong",
        motionTimelineId: "timeline-1",
      }),
    );

    expect(publishedSelection().motion).toEqual({
      previewing: true,
      playheadMs: 1800,
      durationMs: 3600,
      timelineId: "timeline-1",
      playbackMode: "ping-pong",
      autoKeyframe: true,
      selectedTrackId: "node-1\u001ftranslate",
      selectedKeyframeId: null,
      selectedKeyframeIds: [
        '["node-1\\u001ftranslate",0.5]',
        '["node-1\\u001ftranslate",1]',
      ],
    });
  });

  it("tells the agent which tool is active and which mode it is in", () => {
    runPublishAgentSelectionContext(
      argsFor({ activeTool: "comment", mode: "annotate" }),
    );
    expect(publishedSelection()).toMatchObject({
      activeTool: "comment",
      mode: "annotate",
    });
  });
});

describe("runPublishAgentSelectionContext inspector", () => {
  it("publishes no inspector tab: the inspector has none", () => {
    runPublishAgentSelectionContext(argsFor());
    expect(publishedSelection()).not.toHaveProperty("inspectorTab");
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

  it("sends a bounded selection as keepalive so a write just before navigating away lands", () => {
    runPublishAgentSelectionContext(
      argsFor({ selectedElement: deepScreenElement() }),
    );

    const calls = vi.mocked(setClientAppState).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[2]?.keepalive).toBe(true);
  });

  it("drops keepalive when the writes would exceed the browser's 64 KB keepalive budget", () => {
    const files = Array.from({ length: 600 }, (_, index) => ({
      id: `screen-${index}`,
      filename: `${"long-screen-name-".repeat(4)}${index}.html`,
      fileType: "html",
    })) as Args["files"];
    runPublishAgentSelectionContext(argsFor({ files }));

    const calls = vi.mocked(setClientAppState).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[2]?.keepalive).toBe(false);
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

  it("retries a failed write after 1, 2 and 4 seconds, then stops", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(setClientAppState).mockImplementation(() =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      const args = argsFor({ selectedElement: deepScreenElement() });
      runPublishAgentSelectionContext(args);
      const writesPerAttempt = vi.mocked(setClientAppState).mock.calls.length;
      const attempts = () =>
        vi.mocked(setClientAppState).mock.calls.length / writesPerAttempt;

      await vi.advanceTimersByTimeAsync(999);
      expect(attempts()).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts()).toBe(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(attempts()).toBe(3);
      await vi.advanceTimersByTimeAsync(4_000);
      expect(attempts()).toBe(4);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(attempts()).toBe(4);
      expect(args.persistedSelectionWriteTimerRef.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels the pending retry when the selection changes", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(setClientAppState).mockImplementation(() =>
        Promise.reject(new TypeError("Failed to fetch")),
      );
      const args = argsFor({ selectedElement: deepScreenElement() });
      runPublishAgentSelectionContext(args);
      await vi.advanceTimersByTimeAsync(0);
      expect(args.persistedSelectionWriteTimerRef.current).not.toBeNull();

      vi.mocked(setClientAppState).mockClear();
      vi.mocked(setClientAppState).mockImplementation(() =>
        Promise.resolve(null),
      );
      runPublishAgentSelectionContext({ ...args, selectedElement: null });
      const writesForNewSelection =
        vi.mocked(setClientAppState).mock.calls.length;
      await vi.advanceTimersByTimeAsync(10_000);

      const calls = vi.mocked(setClientAppState).mock.calls;
      expect(calls.length).toBe(writesForNewSelection);
      for (const call of calls) {
        expect((call[1] as { selectedElement: unknown }).selectedElement).toBe(
          null,
        );
      }
    } finally {
      vi.useRealTimers();
    }
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
      classes: [],
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
      sourceLayerIdentity: { screenId: "screen-1", nodeId: "node-source-7" },
      imageSource: "[inline image/gif data omitted]",
      computedStyles: {
        backgroundImage: "url('[inline image/svg+xml data omitted]')",
        objectFit: "cover",
      },
    });
    expect(JSON.stringify(tabValue)).not.toMatch(/data:image|base64,/i);
    expect(() => assertNoInlineImageBytes(tabValue)).not.toThrow();
  });
});
