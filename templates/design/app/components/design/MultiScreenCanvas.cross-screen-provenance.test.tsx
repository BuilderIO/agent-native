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
