// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getPrimaryIframeId } from "./multi-screen/iframe-targeting";
import {
  __clearLinkedScreenPreviewHandlersForTests,
  registerLinkedScreenPreviewHandlers,
} from "./multi-screen/linked-screen-preview";
import { MultiScreenCanvas } from "./MultiScreenCanvas";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));

describe("cross-screen drag identity provenance", () => {
  let container: HTMLDivElement;
  let root: Root;
  let rectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    rectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const screenId = this.getAttribute("data-screen-iframe-id");
        const rect =
          screenId === "source"
            ? { x: 500, y: 300, width: 400, height: 300 }
            : screenId === "target"
              ? { x: 1100, y: 300, width: 400, height: 300 }
              : { x: 0, y: 0, width: 2000, height: 1400 };
        return {
          ...rect,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
          left: rect.x,
          toJSON: () => ({}),
        };
      });
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
    __clearLinkedScreenPreviewHandlersForTests();
    rectSpy.mockRestore();
    container.remove();
  });

  it("keeps start identity through move and forwards the target hit-test proof", async () => {
    const onCrossScreenElementDrop = vi.fn();
    const previewPendingDelete = vi.fn(() => true);
    registerLinkedScreenPreviewHandlers(getPrimaryIframeId("source"), {
      replaceContent: () => true,
      sendStyleChange: () => true,
      pendingDelete: previewPendingDelete,
    });
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "source", filename: "source.html", content: "<html></html>" },
            { id: "target", filename: "target.html", content: "<html></html>" },
          ]}
          zoom={100}
          activeId="source"
          activeTool="move"
          editableScreenIds={new Set(["source", "target"])}
          geometryById={{
            source: { x: 0, y: 0, width: 400, height: 300 },
            target: { x: 600, y: 0, width: 400, height: 300 },
          }}
          renderScreenContent={(screen) => (
            <iframe
              data-design-preview-iframe=""
              data-screen-iframe-id={screen.id}
            />
          )}
          onPick={() => {}}
          onCrossScreenElementDrop={onCrossScreenElementDrop}
        />,
      );
    });

    const sourceIframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="source"]',
    );
    const targetIframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="target"]',
    );
    expect(sourceIframe?.contentWindow).toBeTruthy();
    expect(targetIframe?.contentWindow).toBeTruthy();

    const targetProof = {
      versionHash: "target-document-proof",
      uniqueNodeId: "target-anchor-proof",
    };
    const targetWindow = targetIframe!.contentWindow!;
    const targetPostMessage = vi
      .spyOn(targetWindow, "postMessage")
      .mockImplementation(((message: { correlationId: string }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:hit-test-result",
              correlationId: message.correlationId,
              targetAnchorProvenance: targetProof,
              anchorNodeId: "target-anchor-proof",
            },
            source: targetWindow as unknown as Window,
          }),
        );
      }) as typeof targetWindow.postMessage);

    const startProof = {
      versionHash: "source-start-document",
      uniqueNodeId: "source-start-node",
    };
    const moveProof = {
      versionHash: "source-move-document",
      uniqueNodeId: "source-move-node",
    };
    const sendDrag = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:cross-screen-drag", ...data },
          source: sourceIframe!.contentWindow as unknown as Window,
        }),
      );

    await act(async () => {
      sendDrag({
        phase: "start",
        screenId: "source",
        selector: ".source-at-start",
        sourceId: "source-start-node",
        sourceDeleteRequestId: "source-delete-request",
        sourceProvenance: startProof,
      });
      sendDrag({
        phase: "move",
        screenId: "source",
        selector: ".source-after-move",
        sourceId: "source-move-node",
        sourceProvenance: moveProof,
        iframeX: 650,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
      sendDrag({
        phase: "end",
        screenId: "source",
        selector: ".source-at-end",
        sourceId: "source-end-node",
        sourceProvenance: moveProof,
        iframeX: 650,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
    });

    expect(targetPostMessage).toHaveBeenCalled();
    expect(onCrossScreenElementDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceSelector: ".source-at-start",
        sourceNodeId: "source-start-node",
        sourceProvenance: startProof,
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorProvenance: targetProof,
        targetAnchorNodeId: "target-anchor-proof",
      }),
    );
    expect(previewPendingDelete).not.toHaveBeenCalled();
  });

  it("uses the source frame geometry from drag start after a Hug screen grows", async () => {
    const onCrossScreenElementDrop = vi.fn();
    const render = (sourceHeight: number) => (
      <MultiScreenCanvas
        screens={[
          { id: "source", filename: "source.html", content: "<html></html>" },
          { id: "target", filename: "target.html", content: "<html></html>" },
        ]}
        zoom={100}
        activeId="source"
        activeTool="move"
        geometryById={{
          source: { x: 0, y: 0, width: 400, height: sourceHeight },
          target: { x: 600, y: 300, width: 400, height: 300 },
        }}
        renderScreenContent={(screen) => (
          <iframe
            data-design-preview-iframe=""
            data-screen-iframe-id={screen.id}
          />
        )}
        onPick={() => {}}
        onCrossScreenElementDrop={onCrossScreenElementDrop}
      />
    );

    await act(async () => root.render(render(300)));
    const sourceIframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="source"]',
    );
    const targetIframe = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="target"]',
    );
    expect(sourceIframe?.contentWindow).toBeTruthy();
    expect(targetIframe?.contentWindow).toBeTruthy();
    const targetWindow = targetIframe!.contentWindow!;
    const targetPostMessage = vi
      .spyOn(targetWindow, "postMessage")
      .mockImplementation(((message: { correlationId: string }) => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:hit-test-result",
              correlationId: message.correlationId,
              targetAnchorProvenance: {
                versionHash: "target-document",
                uniqueNodeId: "target-anchor",
              },
              anchorNodeId: "target-anchor",
            },
            source: targetWindow as unknown as Window,
          }),
        );
      }) as typeof targetWindow.postMessage);
    const sendDrag = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:cross-screen-drag", ...data },
          source: sourceIframe!.contentWindow as unknown as Window,
        }),
      );

    await act(async () => {
      sendDrag({
        phase: "start",
        screenId: "source",
        selector: ".source",
        sourceId: "source-node",
        iframeX: 200,
        iframeY: 150,
        viewportW: 400,
        viewportH: 300,
      });
      root.render(render(500));
    });
    await act(async () => {
      sendDrag({
        phase: "move",
        screenId: "source",
        selector: ".source",
        sourceId: "source-node",
        iframeX: 650,
        iframeY: 350,
        viewportW: 400,
        viewportH: 500,
      });
      await Promise.resolve();
    });
    expect(targetPostMessage).toHaveBeenCalled();

    await act(async () => {
      sendDrag({
        phase: "end",
        screenId: "source",
        selector: ".source",
        sourceId: "source-node",
        iframeX: 650,
        iframeY: 350,
        viewportW: 400,
        viewportH: 500,
      });
    });

    expect(onCrossScreenElementDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceScreenId: "source",
        targetScreenId: "target",
      }),
    );
  });

  it("ignores stale moves and cancels after a newer iframe drag starts", async () => {
    const onCrossScreenElementDrop = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "source", filename: "source.html", content: "<html></html>" },
            { id: "target", filename: "target.html", content: "<html></html>" },
            {
              id: "previous",
              filename: "previous.html",
              content: "<html></html>",
            },
          ]}
          zoom={100}
          activeId="source"
          activeTool="move"
          geometryById={{
            source: { x: 0, y: 0, width: 400, height: 300 },
            target: { x: 600, y: 0, width: 400, height: 300 },
            previous: { x: 1200, y: 0, width: 400, height: 300 },
          }}
          renderScreenContent={(screen) => (
            <iframe
              data-design-preview-iframe=""
              data-screen-iframe-id={screen.id}
            />
          )}
          onPick={() => {}}
          onCrossScreenElementDrop={onCrossScreenElementDrop}
        />,
      );
    });

    const iframe = (id: string) =>
      container.querySelector<HTMLIFrameElement>(
        `iframe[data-screen-iframe-id="${id}"]`,
      )!;
    const sourceWindow = iframe("source").contentWindow!;
    const targetWindow = iframe("target").contentWindow!;
    const send = (iframeId: string, data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:cross-screen-drag", ...data },
          source: iframe(iframeId).contentWindow as unknown as Window,
        }),
      );

    vi.spyOn(sourceWindow, "postMessage").mockImplementation(((message: {
      type?: string;
      requestId?: string;
    }) => {
      if (
        message.type === "agent-native:cross-screen-modifier-snapshot-probe"
      ) {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:cross-screen-modifier-snapshot",
              requestId: message.requestId,
              ignoreAutoLayout: false,
            },
            source: sourceWindow as unknown as Window,
          }),
        );
      }
    }) as typeof sourceWindow.postMessage);
    vi.spyOn(targetWindow, "postMessage").mockImplementation(((message: {
      type?: string;
      correlationId?: string;
    }) => {
      if (message.type !== "agent-native:hit-test" || !message.correlationId) {
        return;
      }
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:hit-test-result",
            correlationId: message.correlationId,
            anchorNodeId: "target-anchor",
          },
          source: targetWindow as unknown as Window,
        }),
      );
    }) as typeof targetWindow.postMessage);

    await act(async () => {
      send("previous", {
        phase: "start",
        screenId: "previous",
        selector: ".previous",
        sourceId: "previous-node",
        sourceDeleteRequestId: "previous-request",
      });
      send("source", {
        phase: "start",
        screenId: "source",
        selector: ".current",
        sourceId: "current-node",
        sourceDeleteRequestId: "current-request",
      });
      send("source", {
        phase: "move",
        screenId: "source",
        selector: ".current",
        sourceId: "current-node",
        sourceDeleteRequestId: "current-request",
        iframeX: 650,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
      send("source", {
        phase: "move",
        screenId: "source",
        selector: ".previous",
        sourceId: "previous-node",
        sourceDeleteRequestId: "previous-request",
        iframeX: 150,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
      send("previous", {
        phase: "move",
        screenId: "previous",
        selector: ".previous",
        sourceId: "previous-node",
        sourceDeleteRequestId: "previous-request",
        iframeX: 150,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
      await Promise.resolve();
    });
    expect(
      container.querySelector("[data-cross-screen-drag-ghost]"),
    ).toBeTruthy();

    await act(async () => {
      send("previous", {
        phase: "cancel",
        sourceDeleteRequestId: "previous-request",
      });
      send("source", { phase: "cancel" });
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 1150,
          clientY: 400,
        }),
      );
      await Promise.resolve();
    });

    expect(onCrossScreenElementDrop).toHaveBeenCalledTimes(1);
    expect(onCrossScreenElementDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceNodeId: "current-node",
        sourceScreenId: "source",
        targetScreenId: "target",
        targetAnchorNodeId: "target-anchor",
      }),
    );
  });

  it("keeps a cross-screen drag active when parent blur leaves the document focused", async () => {
    const onCrossScreenElementDrop = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "source", filename: "source.html", content: "<html></html>" },
            { id: "target", filename: "target.html", content: "<html></html>" },
          ]}
          zoom={100}
          activeId="source"
          activeTool="move"
          geometryById={{
            source: { x: 0, y: 0, width: 400, height: 300 },
            target: { x: 600, y: 0, width: 400, height: 300 },
          }}
          renderScreenContent={(screen) => (
            <iframe
              data-design-preview-iframe=""
              data-screen-iframe-id={screen.id}
            />
          )}
          onPick={() => {}}
          onCrossScreenElementDrop={onCrossScreenElementDrop}
        />,
      );
    });

    const iframe = (id: string) =>
      container.querySelector<HTMLIFrameElement>(
        `iframe[data-screen-iframe-id="${id}"]`,
      )!;
    const sourceWindow = iframe("source").contentWindow!;
    const targetWindow = iframe("target").contentWindow!;
    const send = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:cross-screen-drag", ...data },
          source: sourceWindow as unknown as Window,
        }),
      );
    vi.spyOn(targetWindow, "postMessage").mockImplementation(((message: {
      type?: string;
      correlationId?: string;
    }) => {
      if (message.type !== "agent-native:hit-test" || !message.correlationId) {
        return;
      }
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:hit-test-result",
            correlationId: message.correlationId,
            anchorNodeId: "target-anchor",
          },
          source: targetWindow as unknown as Window,
        }),
      );
    }) as typeof targetWindow.postMessage);

    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
    try {
      await act(async () => {
        send({
          phase: "start",
          screenId: "source",
          selector: ".source",
          sourceId: "source-node",
          sourceDeleteRequestId: "focus-handoff-request",
        });
        send({
          phase: "move",
          screenId: "source",
          selector: ".source",
          sourceId: "source-node",
          sourceDeleteRequestId: "focus-handoff-request",
          iframeX: 650,
          iframeY: 100,
          viewportW: 400,
          viewportH: 300,
        });
        await Promise.resolve();
      });
      expect(
        container.querySelector("[data-cross-screen-drag-ghost]"),
      ).toBeTruthy();

      await act(async () => {
        window.dispatchEvent(new Event("blur"));
        await Promise.resolve();
      });

      expect(document.hasFocus()).toBe(true);
      expect(
        container.querySelector("[data-cross-screen-drag-ghost]"),
      ).toBeTruthy();
      expect(onCrossScreenElementDrop).not.toHaveBeenCalled();
    } finally {
      hasFocus.mockRestore();
    }
  });

  it("settles overlapping board drops by transaction without leaking pending state", async () => {
    vi.useFakeTimers();
    const runtimeTransactionRef = { current: null as string | null };
    let dropIndex = 0;
    const onCrossScreenElementDrop = vi.fn(() => {
      dropIndex += 1;
      runtimeTransactionRef.current = `${dropIndex === 1 ? "first" : "second"}-transaction`;
    });
    const onBoardRuntimeStructureInsertApplied = vi.fn();
    const onBoardRuntimeStructureInsertRejected = vi.fn(() => false);
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "source", filename: "source.html", content: "<html></html>" },
          ]}
          zoom={100}
          activeId="source"
          activeTool="move"
          geometryById={{
            source: { x: 0, y: 0, width: 400, height: 300 },
          }}
          renderScreenContent={(screen) => (
            <iframe
              data-design-preview-iframe=""
              data-screen-iframe-id={screen.id}
            />
          )}
          boardFileId="board"
          boardFileContent=""
          boardFrameGeometry={{ x: 0, y: 0, width: 1200, height: 600 }}
          boardEditMode
          runtimeStructurePendingTransactionRef={runtimeTransactionRef}
          onPick={() => {}}
          onCrossScreenElementDrop={onCrossScreenElementDrop}
          onBoardRuntimeStructureInsertApplied={
            onBoardRuntimeStructureInsertApplied
          }
          onBoardRuntimeStructureInsertRejected={
            onBoardRuntimeStructureInsertRejected
          }
        />,
      );
    });

    const iframe = (selector: string) =>
      container.querySelector<HTMLIFrameElement>(selector)!;
    const sourceIframe = iframe('iframe[data-screen-iframe-id="source"]');
    expect(
      container.querySelector(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBeNull();
    const sourceWindow = sourceIframe.contentWindow!;
    let boardWindow: Window;
    const boardHitTests: Array<{ correlationId: string }> = [];
    vi.spyOn(sourceWindow, "postMessage").mockImplementation(((message: {
      type?: string;
      requestId?: string;
    }) => {
      if (
        message.type === "agent-native:cross-screen-modifier-snapshot-probe"
      ) {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:cross-screen-modifier-snapshot",
              requestId: message.requestId,
              ignoreAutoLayout: false,
            },
            origin: window.location.origin,
            source: sourceWindow as unknown as Window,
          }),
        );
      }
    }) as typeof sourceWindow.postMessage);
    const send = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:cross-screen-drag", ...data },
          origin: window.location.origin,
          source: sourceWindow as unknown as Window,
        }),
      );
    const startBoardDrop = (requestId: string, nodeId: string) =>
      send({
        phase: "start",
        screenId: "source",
        selector: `.${nodeId}`,
        sourceId: nodeId,
        sourceDeleteRequestId: requestId,
      });

    const releaseBoardDrop = async (requestId: string, nodeId: string) => {
      send({
        phase: "move",
        screenId: "source",
        selector: `.${nodeId}`,
        sourceId: nodeId,
        sourceDeleteRequestId: requestId,
        iframeX: 650,
        iframeY: 450,
        viewportW: 400,
        viewportH: 300,
      });
      window.dispatchEvent(
        new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 1150,
          clientY: 750,
        }),
      );
      await Promise.resolve();
    };

    await act(async () => {
      startBoardDrop("first-request", "first-node");
    });
    const boardIframe = iframe(
      "[data-board-surface-layer] iframe[data-design-preview-iframe]",
    );
    boardWindow = boardIframe.contentWindow!;
    vi.spyOn(boardWindow, "postMessage").mockImplementation(((message: {
      type?: string;
      correlationId?: string;
      preview?: boolean;
    }) => {
      if (
        message.type === "agent-native:hit-test" &&
        message.correlationId &&
        message.preview !== true
      ) {
        boardHitTests.push({ correlationId: message.correlationId });
      }
    }) as typeof boardWindow.postMessage);
    await act(async () => {
      await releaseBoardDrop("first-request", "first-node");
    });
    expect(
      container.querySelector(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBe(boardIframe);
    expect(boardHitTests).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:hit-test-result",
            correlationId: boardHitTests[0]!.correlationId,
            anchorNodeId: "board-anchor",
          },
          origin: window.location.origin,
          source: boardWindow as unknown as Window,
        }),
      );
      await Promise.resolve();
    });
    expect(onCrossScreenElementDrop).toHaveBeenCalledTimes(1);
    expect(runtimeTransactionRef.current).toBe("first-transaction");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });

    await act(async () => {
      startBoardDrop("second-request", "second-node");
    });
    await act(async () => {
      await releaseBoardDrop("second-request", "second-node");
    });
    expect(boardHitTests).toHaveLength(2);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:hit-test-result",
            correlationId: boardHitTests[1]!.correlationId,
            anchorNodeId: "board-anchor",
          },
          origin: window.location.origin,
          source: boardWindow as unknown as Window,
        }),
      );
      await Promise.resolve();
    });
    expect(
      container.querySelector(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBe(boardIframe);
    expect(onCrossScreenElementDrop).toHaveBeenCalledTimes(2);
    expect(runtimeTransactionRef.current).toBe("second-transaction");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(onBoardRuntimeStructureInsertRejected).toHaveBeenCalledWith(
      "board-drop-timeout",
      "first-transaction",
    );
    expect(
      container.querySelector(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBe(boardIframe);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "runtime-structure-insert-applied",
            requestId: "first-request",
            transactionId: "first-transaction",
            selector: ".first-node",
            applied: false,
          },
          origin: window.location.origin,
          source: boardWindow as unknown as Window,
        }),
      );
      await Promise.resolve();
    });
    expect(onBoardRuntimeStructureInsertApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "first-transaction",
        applied: false,
      }),
    );
    expect(
      container.querySelector(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBe(boardIframe);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "runtime-structure-insert-applied",
            requestId: "second-request",
            transactionId: "second-transaction",
            selector: ".second-node",
            applied: false,
          },
          origin: window.location.origin,
          source: boardWindow as unknown as Window,
        }),
      );
      await Promise.resolve();
    });
    expect(onBoardRuntimeStructureInsertApplied).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: "second-transaction",
        applied: false,
      }),
    );
    expect(
      container.querySelector(
        "[data-board-surface-layer] iframe[data-design-preview-iframe]",
      ),
    ).toBeNull();
  });

  it("finalizes a release the source frame never saw and ends its gesture", async () => {
    const onCrossScreenElementDrop = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "source", filename: "source.html", content: "<html></html>" },
            { id: "target", filename: "target.html", content: "<html></html>" },
          ]}
          zoom={100}
          activeId="source"
          activeTool="move"
          geometryById={{
            source: { x: 0, y: 0, width: 400, height: 300 },
            target: { x: 600, y: 0, width: 400, height: 300 },
          }}
          renderScreenContent={(screen) => (
            <iframe
              data-design-preview-iframe=""
              data-screen-iframe-id={screen.id}
            />
          )}
          onPick={() => {}}
          onCrossScreenElementDrop={onCrossScreenElementDrop}
        />,
      );
    });
    const sourceWindow = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="source"]',
    )!.contentWindow!;
    const targetWindow = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="target"]',
    )!.contentWindow!;
    vi.spyOn(targetWindow, "postMessage").mockImplementation(((message: {
      correlationId: string;
    }) => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:hit-test-result",
            correlationId: message.correlationId,
            anchorNodeId: "target-anchor",
          },
          source: targetWindow as unknown as Window,
        }),
      );
    }) as typeof targetWindow.postMessage);
    const sourcePostMessage = vi
      .spyOn(sourceWindow, "postMessage")
      .mockImplementation(() => {});
    const sendSourceMessage = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          source: sourceWindow as unknown as Window,
        }),
      );
    const sendDrag = (data: Record<string, unknown>) =>
      sendSourceMessage({ type: "agent-native:cross-screen-drag", ...data });
    const sourceCloneHtml =
      '<button data-agent-native-node-id="source-node">Move me</button>';

    await act(async () => {
      sendDrag({
        phase: "start",
        screenId: "source",
        selector: '[data-agent-native-node-id="source-node"]',
        sourceId: "source-node",
        sourceCloneHtml,
      });
      sendDrag({
        phase: "move",
        screenId: "source",
        selector: '[data-agent-native-node-id="source-node"]',
        sourceId: "source-node",
        iframeX: 650,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
      window.dispatchEvent(
        new MouseEvent("mouseup", { clientX: 1150, clientY: 400 }),
      );
    });

    expect(onCrossScreenElementDrop).not.toHaveBeenCalled();
    const probe = sourcePostMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .find(
        (message) =>
          message.type === "agent-native:cross-screen-modifier-snapshot-probe",
      );
    expect(probe?.requestId).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 75));
    });

    expect(onCrossScreenElementDrop).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceScreenId: "source",
        targetScreenId: "target",
        sourceCloneHtml,
      }),
    );
    expect(sourcePostMessage).toHaveBeenCalledWith(
      {
        type: "agent-native:cancel-active-drag",
        pressedAt: expect.any(Number),
      },
      "*",
    );
  });

  it("keeps each released drop tied to its modifier snapshot across later drags and blur", async () => {
    const onCrossScreenElementDrop = vi.fn();
    await act(async () => {
      root.render(
        <MultiScreenCanvas
          screens={[
            { id: "source", filename: "source.html", content: "<html></html>" },
            { id: "target", filename: "target.html", content: "<html></html>" },
          ]}
          zoom={100}
          activeId="source"
          activeTool="move"
          geometryById={{
            source: { x: 0, y: 0, width: 400, height: 300 },
            target: { x: 600, y: 0, width: 400, height: 300 },
          }}
          renderScreenContent={(screen) => (
            <iframe
              data-design-preview-iframe=""
              data-screen-iframe-id={screen.id}
            />
          )}
          onPick={() => {}}
          onCrossScreenElementDrop={onCrossScreenElementDrop}
        />,
      );
    });

    const sourceWindow = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="source"]',
    )!.contentWindow!;
    const targetWindow = container.querySelector<HTMLIFrameElement>(
      'iframe[data-screen-iframe-id="target"]',
    )!.contentWindow!;
    const sourcePostMessage = vi
      .spyOn(sourceWindow, "postMessage")
      .mockImplementation(() => {});
    const hitTestMessages: Array<{
      correlationId: string;
      preview?: boolean;
      modifiers?: { ignoreAutoLayout?: boolean };
    }> = [];
    const respondToHitTest = (correlationId: string, anchorNodeId: string) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:hit-test-result",
            correlationId,
            anchorNodeId,
          },
          source: targetWindow as unknown as Window,
        }),
      );
    vi.spyOn(targetWindow, "postMessage").mockImplementation(((message: {
      type?: string;
      correlationId?: string;
      preview?: boolean;
      modifiers?: { ignoreAutoLayout?: boolean };
    }) => {
      if (message.type !== "agent-native:hit-test" || !message.correlationId) {
        return;
      }
      hitTestMessages.push(message as (typeof hitTestMessages)[number]);
      if (message.preview === true) {
        respondToHitTest(message.correlationId, "preview-anchor");
      }
    }) as typeof targetWindow.postMessage);
    const sendSourceMessage = (data: Record<string, unknown>) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:cross-screen-drag", ...data },
          source: sourceWindow as unknown as Window,
        }),
      );
    const start = (
      sourceDeleteRequestId: string,
      sourceId: string,
      modifiers?: { ignoreAutoLayout: boolean },
      startedAt = Date.now(),
    ) =>
      sendSourceMessage({
        phase: "start",
        screenId: "source",
        selector: `.${sourceId}`,
        sourceId,
        sourceDeleteRequestId,
        startedAt,
        modifiers,
      });
    const move = (sourceDeleteRequestId: string, sourceId: string) =>
      sendSourceMessage({
        phase: "move",
        screenId: "source",
        selector: `.${sourceId}`,
        sourceId,
        sourceDeleteRequestId,
        iframeX: 650,
        iframeY: 100,
        viewportW: 400,
        viewportH: 300,
      });
    const release = () => {
      const releasedAt = Date.now();
      const mouseup = new MouseEvent("mouseup", {
        bubbles: true,
        clientX: 1150,
        clientY: 400,
      });
      Object.defineProperty(mouseup, "timeStamp", { value: releasedAt });
      window.dispatchEvent(mouseup);
      return releasedAt;
    };

    let firstReleasedAt = 0;
    let firstStartedAt = 0;
    await act(async () => {
      firstStartedAt = Date.now() - 100;
      start(
        "first-request",
        "first-node",
        { ignoreAutoLayout: true },
        firstStartedAt,
      );
      move("first-request", "first-node");
      firstReleasedAt = release();
    });
    expect(onCrossScreenElementDrop).not.toHaveBeenCalled();
    const firstProbe = sourcePostMessage.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .find(
        (message) =>
          message.type === "agent-native:cross-screen-modifier-snapshot-probe",
      );
    expect(firstProbe?.requestId).toBeTruthy();

    await act(async () => {
      start("second-request", "second-node");
      sendSourceMessage({
        type: "agent-native:cross-screen-modifiers",
        ignoreAutoLayout: true,
        changedAt: Date.now(),
      });
      await Promise.resolve();
    });
    await act(async () => {
      sendSourceMessage({
        phase: "end",
        screenId: "source",
        selector: ".first-node",
        sourceId: "first-node",
        sourceDeleteRequestId: "first-request",
        sourceCloneHtml: '<div data-copy="first"></div>',
      });
      sendSourceMessage({
        type: "agent-native:cross-screen-modifier-snapshot",
        requestId: firstProbe?.requestId,
        ignoreAutoLayout: false,
        changedAt: firstReleasedAt - 1,
      });
      await Promise.resolve();
    });
    await act(async () => {
      move("second-request", "second-node");
      release();
      window.dispatchEvent(new Event("blur"));
      await Promise.resolve();
    });

    expect(onCrossScreenElementDrop).not.toHaveBeenCalled();
    const commitHitTests = hitTestMessages.filter(
      (message) => message.preview !== true,
    );
    expect(commitHitTests[0]?.modifiers).toMatchObject({
      ignoreAutoLayout: false,
    });
    expect(commitHitTests[1]?.modifiers).toMatchObject({
      ignoreAutoLayout: true,
    });
    await act(async () => {
      respondToHitTest(commitHitTests[0]!.correlationId, "first-anchor");
      await Promise.resolve();
    });
    expect(onCrossScreenElementDrop).toHaveBeenCalledTimes(1);
    expect(onCrossScreenElementDrop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceNodeId: "first-node",
        sourceCloneHtml: '<div data-copy="first"></div>',
        targetAnchorNodeId: "first-anchor",
      }),
    );
    await act(async () => {
      respondToHitTest(commitHitTests[1]!.correlationId, "second-anchor");
      await Promise.resolve();
    });
    expect(onCrossScreenElementDrop).toHaveBeenCalledTimes(2);
    expect(onCrossScreenElementDrop).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceNodeId: "second-node",
        targetAnchorNodeId: "second-anchor",
      }),
    );
  });

  it.each([
    ["before", -1, false],
    ["after", 1, true],
  ] as const)(
    "uses the source keyup timestamp when delivered after host mouseup (%s release)",
    async (_timing, keyupOffset, expectedIgnoreAutoLayout) => {
      const onCrossScreenElementDrop = vi.fn();
      await act(async () => {
        root.render(
          <MultiScreenCanvas
            screens={[
              {
                id: "source",
                filename: "source.html",
                content: "<html></html>",
              },
              {
                id: "target",
                filename: "target.html",
                content: "<html></html>",
              },
            ]}
            zoom={100}
            activeId="source"
            activeTool="move"
            geometryById={{
              source: { x: 0, y: 0, width: 400, height: 300 },
              target: { x: 600, y: 0, width: 400, height: 300 },
            }}
            renderScreenContent={(screen) => (
              <iframe
                data-design-preview-iframe=""
                data-screen-iframe-id={screen.id}
              />
            )}
            onPick={() => {}}
            onCrossScreenElementDrop={onCrossScreenElementDrop}
          />,
        );
      });

      const sourceWindow = container.querySelector<HTMLIFrameElement>(
        'iframe[data-screen-iframe-id="source"]',
      )!.contentWindow!;
      const targetWindow = container.querySelector<HTMLIFrameElement>(
        'iframe[data-screen-iframe-id="target"]',
      )!.contentWindow!;
      const hitTestMessages: Array<{
        correlationId: string;
        modifiers?: { ignoreAutoLayout?: boolean };
      }> = [];
      const modifierProbes: Array<{ type?: string; requestId?: string }> = [];
      vi.spyOn(sourceWindow, "postMessage").mockImplementation(((message: {
        type?: string;
        requestId?: string;
      }) => {
        modifierProbes.push(message);
      }) as typeof sourceWindow.postMessage);
      vi.spyOn(targetWindow, "postMessage").mockImplementation(((message: {
        type?: string;
        correlationId?: string;
        modifiers?: { ignoreAutoLayout?: boolean };
      }) => {
        if (
          message.type !== "agent-native:hit-test" ||
          !message.correlationId
        ) {
          return;
        }
        hitTestMessages.push(message as (typeof hitTestMessages)[number]);
        window.dispatchEvent(
          new MessageEvent("message", {
            data: {
              type: "agent-native:hit-test-result",
              correlationId: message.correlationId,
              anchorNodeId: "target-anchor",
            },
            source: targetWindow as unknown as Window,
          }),
        );
      }) as typeof targetWindow.postMessage);
      const sendSourceMessage = (data: Record<string, unknown>) =>
        window.dispatchEvent(
          new MessageEvent("message", {
            data,
            source: sourceWindow as unknown as Window,
          }),
        );
      const releasedAt = Date.now();
      await act(async () => {
        sendSourceMessage({
          type: "agent-native:cross-screen-drag",
          phase: "start",
          screenId: "source",
          selector: ".source",
          sourceId: "source-node",
          startedAt: releasedAt - 100,
          modifiers: { ignoreAutoLayout: true },
        });
        sendSourceMessage({
          type: "agent-native:cross-screen-drag",
          phase: "move",
          screenId: "source",
          selector: ".source",
          sourceId: "source-node",
          iframeX: 650,
          iframeY: 100,
          viewportW: 400,
          viewportH: 300,
        });

        const mouseup = new MouseEvent("mouseup", {
          bubbles: true,
          clientX: 1150,
          clientY: 400,
        });
        Object.defineProperty(mouseup, "timeStamp", { value: releasedAt });
        window.dispatchEvent(mouseup);
      });

      expect(onCrossScreenElementDrop).not.toHaveBeenCalled();
      const probe = modifierProbes.find(
        (message) =>
          message.type === "agent-native:cross-screen-modifier-snapshot-probe",
      );
      expect(probe?.requestId).toBeTruthy();

      const keyupAt = releasedAt + keyupOffset;
      await act(async () => {
        sendSourceMessage({
          type: "agent-native:cross-screen-modifiers",
          ignoreAutoLayout: false,
          changedAt: keyupAt,
        });
        sendSourceMessage({
          type: "agent-native:cross-screen-drag",
          phase: "end",
          screenId: "source",
          selector: ".source",
          sourceId: "source-node",
          releasedAt: keyupAt,
          iframeX: 399,
          iframeY: 299,
          viewportW: 400,
          viewportH: 300,
          sourceCloneHtml: '<div class="source"></div>',
        });
        sendSourceMessage({
          type: "agent-native:cross-screen-modifier-snapshot",
          requestId: probe?.requestId,
          ignoreAutoLayout: false,
          changedAt: keyupAt,
        });
      });

      expect(hitTestMessages.length).toBeGreaterThan(0);
      expect(
        hitTestMessages[hitTestMessages.length - 1]?.modifiers,
      ).toMatchObject({
        ignoreAutoLayout: expectedIgnoreAutoLayout,
      });
      expect(onCrossScreenElementDrop).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceScreenId: "source",
          targetScreenId: "target",
        }),
      );
    },
  );
});
