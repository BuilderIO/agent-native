// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { deriveOverviewScreens } from "@/pages/design-editor/derive/overview-screens";

import { sizeNeedsMeasurement } from "../edit-panel/element-classification";
import type { ElementInfo } from "../types";
import {
  designPreviewWindowsForScreen,
  requestSelectionMeasurement,
  selectionMeasurementBreakpoint,
  useSelectionMeasurement,
} from "./measure-selection";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("selection measurement lifecycle", () => {
  it.each(["single", "overview"] as const)(
    "measures the selected %s frame and installs live layout metadata",
    async (viewMode) => {
      const container = document.createElement("div");
      document.body.append(container);
      const desktop = document.createElement("iframe");
      desktop.dataset.screenIframeId = "screen-a";
      const mobile = document.createElement("iframe");
      mobile.dataset.screenIframeId = "screen-a::bp-390";
      document.body.append(desktop, mobile);
      const desktopPost = vi
        .spyOn(desktop.contentWindow!, "postMessage")
        .mockImplementation(() => {});
      const mobilePost = vi
        .spyOn(mobile.contentWindow!, "postMessage")
        .mockImplementation(() => {});
      const initial: ElementInfo = {
        tagName: "div",
        sourceId: "a",
        selector: "#a",
        classes: [],
        computedStyles: { width: "50%" },
        boundingRect: { x: 1, y: 2, width: 90, height: 30 },
        isFlexChild: false,
        isFlexContainer: false,
        needsLiveMeasurement: true,
      };
      let current: ElementInfo | null = null;
      function Harness() {
        const [selected, setSelected] = useState<ElementInfo | null>(initial);
        current = selected;
        useSelectionMeasurement({
          selectedElement: selected,
          setSelectedElement: setSelected,
          screenId: "screen-a",
          breakpointWidth: 390,
          viewMode,
          activeFileIdRef: { current: "screen-a" },
        });
        return null;
      }
      const root = createRoot(container);
      try {
        await act(async () => root.render(createElement(Harness)));
        const target = viewMode === "single" ? desktop : mobile;
        const targetPost = viewMode === "single" ? desktopPost : mobilePost;
        const otherPost = viewMode === "single" ? mobilePost : desktopPost;
        expect(targetPost).toHaveBeenCalledTimes(1);
        const request = targetPost.mock.calls[0]![0] as {
          correlationId: string;
        };
        const live = {
          ...initial,
          computedStyles: { width: "90px", color: "blue" },
          isFlexChild: true,
          parentDisplay: "flex",
          parentBoundingRect: { x: 0, y: 0, width: 300, height: 100 },
          editCapabilities: [
            {
              kind: "deterministic-style-edit",
              label: "Style",
              confidence: 0.9,
            },
          ],
          portableStyleSnapshot: {
            version: 1,
            nodes: [{ path: [], styles: { color: "blue" } }],
          },
        };
        await act(async () =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: target.contentWindow,
              data: {
                type: "agent-native:selection-measured",
                screenId: "screen-a",
                correlationId: request.correlationId,
                payload: live,
              },
            }),
          ),
        );
        expect(current).toMatchObject({
          computedStyles: { width: "90px", color: "blue" },
          isFlexChild: true,
          parentDisplay: "flex",
          parentBoundingRect: live.parentBoundingRect,
          editCapabilities: live.editCapabilities,
          portableStyleSnapshot: live.portableStyleSnapshot,
          needsLiveMeasurement: false,
        });
        expect(otherPost).not.toHaveBeenCalled();
      } finally {
        await act(async () => root.unmount());
        desktopPost.mockRestore();
        mobilePost.mockRestore();
        desktop.remove();
        mobile.remove();
        container.remove();
      }
    },
  );

  it.each([
    { viewMode: "overview" as const, editBeforeSwitch: true },
    { viewMode: "overview" as const, editBeforeSwitch: false },
    { viewMode: "single" as const, editBeforeSwitch: false },
  ])(
    "remeasures $viewMode after breakpoint changes (edit=$editBeforeSwitch)",
    async ({ viewMode, editBeforeSwitch }) => {
      const container = document.createElement("div");
      document.body.append(container);
      const desktop = document.createElement("iframe");
      desktop.dataset.screenIframeId = "screen-a";
      const mobile = document.createElement("iframe");
      mobile.dataset.screenIframeId = "screen-a::bp-390";
      document.body.append(desktop, mobile);
      const desktopPost = vi
        .spyOn(desktop.contentWindow!, "postMessage")
        .mockImplementation(() => {});
      const mobilePost = vi
        .spyOn(mobile.contentWindow!, "postMessage")
        .mockImplementation(() => {});
      const initial: ElementInfo = {
        tagName: "div",
        sourceId: "a",
        selector: "#a",
        classes: [],
        computedStyles: { width: "50%" },
        boundingRect: { x: 0, y: 0, width: 120, height: 30 },
        isFlexChild: false,
        isFlexContainer: false,
        needsLiveMeasurement: true,
      };
      const activeFileIdRef = { current: "screen-a" };
      let current: ElementInfo | null = null;
      let editSelection = () => {};
      function Harness({ breakpointWidth }: { breakpointWidth?: number }) {
        const [selected, setSelected] = useState<ElementInfo | null>(initial);
        current = selected;
        editSelection = () =>
          setSelected((prev) =>
            prev
              ? {
                  ...prev,
                  computedStyles: { ...prev.computedStyles, color: "green" },
                }
              : prev,
          );
        const [screen] = deriveOverviewScreens({
          designDataJson: {
            breakpointSet: {
              id: "set",
              breakpoints: [{ id: "mobile", widthPx: 390 }],
            },
          },
          files: [
            {
              id: "screen-a",
              filename: "screen-a.html",
              fileType: "html",
              content: "",
              createdAt: "2026-01-01",
              updatedAt: "2026-01-01",
            },
          ],
          activeBreakpointWidthState: breakpointWidth,
          breakpointFramesHidden: viewMode === "single",
          locallyPinnedHeightIds: new Set(),
        });
        useSelectionMeasurement({
          selectedElement: selected,
          setSelectedElement: setSelected,
          screenId: "screen-a",
          breakpointWidth: selectionMeasurementBreakpoint(
            viewMode,
            breakpointWidth,
            screen?.activeBreakpointWidth,
          ),
          viewMode,
          activeFileIdRef,
        });
        return null;
      }
      const root = createRoot(container);
      const reply = async (
        frame: HTMLIFrameElement,
        correlationId: string,
        width: number,
      ) =>
        act(async () =>
          window.dispatchEvent(
            new MessageEvent("message", {
              source: frame.contentWindow,
              data: {
                type: "agent-native:selection-measured",
                screenId: "screen-a",
                correlationId,
                payload: {
                  ...initial,
                  computedStyles: { width: `${width}px` },
                  boundingRect: { ...initial.boundingRect, width },
                },
              },
            }),
          ),
        );
      try {
        await act(async () => root.render(createElement(Harness, {})));
        const first = desktopPost.mock.calls[0]![0] as {
          correlationId: string;
        };
        await reply(desktop, first.correlationId, 120);
        expect(current).toMatchObject({
          computedStyles: { width: "120px" },
          needsLiveMeasurement: false,
        });
        if (editBeforeSwitch) await act(async () => editSelection());
        await act(async () =>
          root.render(createElement(Harness, { breakpointWidth: 390 })),
        );
        const targetPost = viewMode === "single" ? desktopPost : mobilePost;
        const target = viewMode === "single" ? desktop : mobile;
        expect(targetPost).toHaveBeenCalledTimes(viewMode === "single" ? 2 : 1);
        const second = targetPost.mock.calls[
          viewMode === "single" ? 1 : 0
        ]![0] as { correlationId: string };
        await reply(target, second.correlationId, 60);
        expect(current).toMatchObject({
          computedStyles: { width: "60px" },
          boundingRect: { width: 60 },
        });
      } finally {
        await act(async () => root.unmount());
        desktopPost.mockRestore();
        mobilePost.mockRestore();
        desktop.remove();
        mobile.remove();
        container.remove();
      }
    },
  );

  it("does not remeasure an unrelated selection sharing the selector", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const frame = document.createElement("iframe");
    frame.dataset.screenIframeId = "screen-a";
    document.body.append(frame);
    const post = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    const initial: ElementInfo = {
      tagName: "div",
      sourceId: "a",
      selector: "#same",
      classes: [],
      computedStyles: { width: "50%" },
      boundingRect: { x: 0, y: 0, width: 90, height: 30 },
      isFlexChild: false,
      isFlexContainer: false,
      needsLiveMeasurement: true,
    };
    const activeFileIdRef = { current: "screen-a" };
    let selectOther = () => {};
    function Harness({ breakpointWidth }: { breakpointWidth?: number }) {
      const [selected, setSelected] = useState<ElementInfo | null>(initial);
      selectOther = () =>
        setSelected({
          ...initial,
          sourceId: "b",
          computedStyles: { width: "60px" },
          needsLiveMeasurement: false,
        });
      useSelectionMeasurement({
        selectedElement: selected,
        setSelectedElement: setSelected,
        screenId: "screen-a",
        breakpointWidth,
        viewMode: "single",
        activeFileIdRef,
      });
      return null;
    }
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness, {})));
      const request = post.mock.calls[0]![0] as { correlationId: string };
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: {
              type: "agent-native:selection-measured",
              screenId: "screen-a",
              correlationId: request.correlationId,
              payload: { ...initial, computedStyles: { width: "90px" } },
            },
          }),
        ),
      );
      await act(async () => selectOther());
      await act(async () =>
        root.render(createElement(Harness, { breakpointWidth: 390 })),
      );
      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      await act(async () => root.unmount());
      post.mockRestore();
      frame.remove();
      container.remove();
    }
  });

  it("does not apply a reply to a newer same-selector selection", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const frame = document.createElement("iframe");
    frame.dataset.screenIframeId = "screen-a";
    document.body.append(frame);
    const post = vi
      .spyOn(frame.contentWindow!, "postMessage")
      .mockImplementation(() => {});
    const initial: ElementInfo = {
      tagName: "div",
      sourceId: "a",
      selector: "#a",
      classes: [],
      computedStyles: { width: "50%", color: "red" },
      boundingRect: { x: 0, y: 0, width: 90, height: 30 },
      isFlexChild: false,
      isFlexContainer: false,
      needsLiveMeasurement: true,
    };
    let current: ElementInfo | null = null;
    let update: (value: ElementInfo) => void = () => {};
    function Harness() {
      const [selected, setSelected] = useState<ElementInfo | null>(initial);
      current = selected;
      update = setSelected;
      useSelectionMeasurement({
        selectedElement: selected,
        setSelectedElement: setSelected,
        screenId: "screen-a",
        viewMode: "overview",
        activeFileIdRef: { current: "screen-a" },
      });
      return null;
    }
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness)));
      const request = post.mock.calls[0]![0] as { correlationId: string };
      const newer = {
        ...initial,
        computedStyles: { width: "50%", color: "green" },
      };
      await act(async () => update(newer));
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: {
              type: "agent-native:selection-measured",
              screenId: "screen-a",
              correlationId: request.correlationId,
              payload: {
                ...initial,
                computedStyles: { width: "90px", color: "red" },
              },
            },
          }),
        ),
      );
      expect(current).toEqual(newer);
      expect(post).toHaveBeenCalledTimes(2);
      const currentRequest = post.mock.calls[1]![0] as {
        correlationId: string;
      };
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: frame.contentWindow,
            data: {
              type: "agent-native:selection-measured",
              screenId: "screen-a",
              correlationId: currentRequest.correlationId,
              payload: {
                ...newer,
                computedStyles: { width: "90px", color: "green" },
              },
            },
          }),
        ),
      );
      expect(current).toMatchObject({
        computedStyles: { width: "90px", color: "green" },
        needsLiveMeasurement: false,
      });
    } finally {
      await act(async () => root.unmount());
      post.mockRestore();
      frame.remove();
      container.remove();
    }
  });
});

describe("sizeNeedsMeasurement", () => {
  it.each([
    "fit-content",
    "auto",
    "max-content",
    "min-content",
    "100%",
    ".5rem",
  ])("flags %s as unresolvable by the host", (value) => {
    expect(sizeNeedsMeasurement({ width: value })).toBe(true);
  });

  it.each(["180px", "12.5px", "0px", "0"])(
    "trusts the px size %s as-is",
    (value) => {
      expect(sizeNeedsMeasurement({ width: value })).toBe(false);
    },
  );

  it("checks height as well as width", () => {
    expect(sizeNeedsMeasurement({ height: "fit-content" })).toBe(true);
  });

  it("ignores properties that are not a size", () => {
    expect(sizeNeedsMeasurement({ flexBasis: "auto", color: "red" })).toBe(
      false,
    );
  });
});

describe("requestSelectionMeasurement", () => {
  const rect = { x: 0, y: 0, width: 101, height: 20 };
  const complete = {
    tagName: "div",
    classes: [],
    computedStyles: { width: "101px", color: "blue" },
    boundingRect: rect,
    isFlexChild: false,
    isFlexContainer: false,
  };

  function frame(payload: unknown, screenId = "screen-1"): Window {
    const target = {
      postMessage: (message: { correlationId: string }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selection-measured",
              correlationId: message.correlationId,
              screenId,
              payload,
            },
            source: target,
          }),
        );
      },
    } as unknown as Window;
    return target;
  }

  it("resolves with the measurement from the frame that has the element", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [frame(null), frame(complete)],
      screenId: "screen-1",
      selector: '[data-agent-native-node-id="a"]',
    });
    expect(measured?.boundingRect.width).toBe(101);
  });

  it("ignores incomplete responses and waits for a full live measurement", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [
        frame({ tagName: "div", boundingRect: rect }),
        frame(complete),
      ],
      screenId: "screen-1",
      attempts: 1,
      timeoutMs: 30,
    });
    expect(measured).toEqual(complete);
  });

  it("does not accept malformed style or geometry data as a measurement", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [
        frame({ ...complete, computedStyles: null }),
        frame({ ...complete, computedStyles: undefined }),
        frame({ ...complete, computedStyles: { width: 101 } }),
        frame({ ...complete, boundingRect: { ...rect, x: "invalid" } }),
        frame({ ...complete, inlineStyles: { width: 101 } }),
      ],
      screenId: "screen-1",
      attempts: 1,
      timeoutMs: 30,
    });
    expect(measured).toBeNull();
  });

  it.each([
    { editCapabilities: {} },
    { editCapabilities: [null] },
    { editCapabilities: [{ kind: 12, label: "edit", confidence: 1 }] },
    { parentBoundingRect: { x: "invalid", y: 0, width: 1, height: 1 } },
    { childLayouts: { children: null, complete: true, looseText: false } },
    { portableStyleSnapshot: { version: 1, nodes: null } },
    {
      portableStyleSnapshot: {
        version: 1,
        nodes: [{ path: [], styles: { color: 1 } }],
      },
    },
    {
      portableStyleSnapshot: {
        version: 1,
        nodes: [{ path: ["0"], styles: {} }],
      },
    },
  ])(
    "waits for a valid response after malformed metadata %j",
    async (metadata) => {
      const measured = await requestSelectionMeasurement({
        targetWindows: () => [
          frame({ ...complete, ...metadata }),
          frame(complete),
        ],
        screenId: "screen-1",
        attempts: 1,
        timeoutMs: 30,
      });
      expect(measured).toEqual(complete);
    },
  );

  it("keeps waiting past a frame that does not have the element", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [frame(null), frame(null)],
      screenId: "screen-1",
      attempts: 1,
      timeoutMs: 30,
    });
    expect(measured).toBeNull();
  });

  it("ignores a reply from a window that was never asked", async () => {
    const asked = frame(null);
    const promise = requestSelectionMeasurement({
      targetWindows: () => [asked],
      screenId: "screen-1",
      attempts: 1,
      timeoutMs: 40,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agent-native:selection-measured",
          correlationId: "measure-anything",
          screenId: "screen-1",
          payload: complete,
        },
        source: {} as Window,
      }),
    );
    expect(await promise).toBeNull();
  });

  it("does not post when there is no live preview frame", async () => {
    const post = vi.fn();
    expect(
      await requestSelectionMeasurement({
        targetWindows: () => [null, undefined],
        screenId: "screen-1",
      }),
    ).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it("ignores a positive match from a different screen", async () => {
    const measured = await requestSelectionMeasurement({
      targetWindows: () => [frame(complete, "screen-mobile")],
      screenId: "screen-desktop",
      attempts: 1,
      timeoutMs: 40,
    });
    expect(measured).toBeNull();
  });

  it("retries so a frame whose bridge installs late still answers", async () => {
    let installed = false;
    const target = {
      postMessage: (message: { correlationId: string }) => {
        if (!installed) return;
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:selection-measured",
              correlationId: message.correlationId,
              screenId: "screen-1",
              payload: complete,
            },
            source: target,
          }),
        );
      },
    } as unknown as Window;
    window.setTimeout(() => {
      installed = true;
    }, 60);

    const measured = await requestSelectionMeasurement({
      targetWindows: () => [target],
      screenId: "screen-1",
      attempts: 3,
      timeoutMs: 40,
      retryDelayMs: 40,
    });
    expect(measured?.boundingRect.width).toBe(101);
  });

  it("sees a frame that only mounts after the first attempt", async () => {
    const late: Window[] = [];
    window.setTimeout(() => {
      late.push(frame(complete));
    }, 60);

    const measured = await requestSelectionMeasurement({
      targetWindows: () => late,
      screenId: "screen-1",
      attempts: 3,
      timeoutMs: 40,
      retryDelayMs: 40,
    });
    expect(measured?.boundingRect.width).toBe(101);
  });
});

describe("designPreviewWindowsForScreen", () => {
  it("keeps same-node selectors scoped to the requested screen and breakpoint", () => {
    document.body.innerHTML = `
      <iframe data-screen-iframe-id="screen-a"></iframe>
      <iframe data-screen-iframe-id="screen-a::bp-390"></iframe>
      <iframe data-screen-iframe-id="screen-b"></iframe>
    `;

    const primary = designPreviewWindowsForScreen("screen-a");
    const breakpoint = designPreviewWindowsForScreen("screen-a", 390);

    expect(primary).toHaveLength(1);
    expect(breakpoint).toHaveLength(1);
    expect(primary[0]).not.toBe(breakpoint[0]);
    expect(designPreviewWindowsForScreen("screen-b")).toHaveLength(1);
    expect(designPreviewWindowsForScreen("screen-c")).toHaveLength(0);

    document.body.innerHTML = "";
  });

  it("resolves the board surface iframe when the board has no screen iframe id", () => {
    document.body.innerHTML = `
      <iframe data-screen-iframe-id="board-1"></iframe>
      <div data-board-surface-layer>
        <iframe data-design-preview-iframe></iframe>
      </div>
    `;
    const boardIframe = document.querySelector<HTMLIFrameElement>(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );

    expect(
      designPreviewWindowsForScreen("board-1", undefined, "board-1"),
    ).toEqual([boardIframe?.contentWindow]);

    document.body.innerHTML = "";
  });

  it("keeps board measurement on the board iframe with an active breakpoint", () => {
    document.body.innerHTML = `
      <iframe data-screen-iframe-id="board-1::bp-390"></iframe>
      <div data-board-surface-layer>
        <iframe data-design-preview-iframe></iframe>
      </div>
    `;
    const boardIframe = document.querySelector<HTMLIFrameElement>(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );

    expect(designPreviewWindowsForScreen("board-1", 390, "board-1")).toEqual([
      boardIframe?.contentWindow,
    ]);

    document.body.innerHTML = "";
  });
});
