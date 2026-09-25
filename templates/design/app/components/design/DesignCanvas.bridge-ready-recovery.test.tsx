// @vitest-environment happy-dom

import http, { type Server } from "node:http";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let root: Root;
let iframeServer: Server | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  if (iframeServer) {
    await new Promise<void>((resolve) => iframeServer!.close(() => resolve()));
    iframeServer = null;
  }
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DesignCanvas one-shot bridge queue", () => {
  it("keeps local layers immediate and captures shared HTML after its reservation", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const reservations: Array<{
      promise: Promise<{ reservationToken: string }>;
      resolve: (value: { reservationToken: string }) => void;
    }> = [];
    const onRuntimeLayerSnapshot = vi.fn();
    const onReserveVisualEditSnapshot = vi.fn(() => {
      let resolve!: (value: { reservationToken: string }) => void;
      const promise = new Promise<{ reservationToken: string }>((done) => {
        resolve = done;
      });
      reservations.push({ promise, resolve });
      return promise;
    });

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/"
          contentKey="screen-live"
          screenId="screen-live"
          sourceType="localhost"
          bridgeUrl={bridgeUrl}
          previewToken="ready-recovery-preview-token"
          liveEditCapability="ready-recovery-live-edit-capability"
          onRuntimeLayerSnapshot={onRuntimeLayerSnapshot}
          onReserveVisualEditSnapshot={onReserveVisualEditSnapshot}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframePostMessage = vi.spyOn(iframe.contentWindow!, "postMessage");

    const sendBridgeMessage = async (data: Record<string, unknown>) => {
      await act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data,
            origin: bridgeUrl,
            source: iframe.contentWindow,
          }),
        );
      });
    };
    const requestReservation = (requestId: number) =>
      sendBridgeMessage({
        type: "agent-native:runtime-layer-snapshot-reservation-request",
        requestId,
      });
    const sendSnapshot = (
      requestId: number,
      html: string,
      reservationToken?: string,
    ) =>
      sendBridgeMessage({
        type: "agent-native:runtime-layer-snapshot",
        payload: {
          requestId,
          html,
          nodeCount: 2,
          ...(reservationToken ? { reservationToken } : {}),
        },
      });
    const expectImmediateSnapshot = async (requestId: number, html: string) => {
      await sendSnapshot(requestId, html);
      expect(onRuntimeLayerSnapshot).toHaveBeenLastCalledWith({
        html,
        nodeCount: 2,
        documentId: undefined,
        reservationToken: undefined,
      });
    };
    const resolveReservation = async (index: number, token: string) => {
      await act(async () => {
        reservations[index]!.resolve({ reservationToken: token });
        await reservations[index]!.promise;
      });
    };

    await sendBridgeMessage({
      type: "agent-native:editor-chrome-ready",
      routePath: "/",
    });
    await requestReservation(41);
    await requestReservation(42);
    expect(onReserveVisualEditSnapshot).toHaveBeenCalledTimes(2);
    expect(onReserveVisualEditSnapshot).toHaveBeenNthCalledWith(
      1,
      "screen-live",
    );
    expect(onReserveVisualEditSnapshot).toHaveBeenNthCalledWith(
      2,
      "screen-live",
    );

    await expectImmediateSnapshot(41, "<body>First</body>");
    await expectImmediateSnapshot(42, "<body>Second</body>");
    expect(onRuntimeLayerSnapshot).toHaveBeenCalledTimes(2);

    await resolveReservation(1, "reservation-for-42");
    expect(
      iframePostMessage.mock.calls
        .map(([message]) => message)
        .filter(
          (message) =>
            (message as { type?: string })?.type ===
            "grant-runtime-layer-snapshot-reservation",
        ),
    ).toContainEqual({
      type: "grant-runtime-layer-snapshot-reservation",
      requestId: 42,
      reservationToken: "reservation-for-42",
    });
    await sendSnapshot(
      42,
      "<body>Fresh after reservation</body>",
      "reservation-for-42",
    );
    expect(onRuntimeLayerSnapshot).toHaveBeenLastCalledWith({
      html: "<body>Fresh after reservation</body>",
      nodeCount: 2,
      documentId: undefined,
      reservationToken: "reservation-for-42",
    });

    await resolveReservation(0, "reservation-for-41");
    expect(onRuntimeLayerSnapshot).toHaveBeenCalledTimes(3);
    expect(onRuntimeLayerSnapshot.mock.calls[2]?.[0]).toEqual({
      html: "<body>Fresh after reservation</body>",
      nodeCount: 2,
      documentId: undefined,
      reservationToken: "reservation-for-42",
    });

    await requestReservation(43);
    await expectImmediateSnapshot(43, "<body>Third</body>");
    expect(onRuntimeLayerSnapshot).toHaveBeenCalledTimes(4);
    await resolveReservation(2, "reservation-for-43");
    await sendSnapshot(43, "<body>Fresh third</body>", "reservation-for-43");
    expect(onRuntimeLayerSnapshot).toHaveBeenLastCalledWith({
      html: "<body>Fresh third</body>",
      nodeCount: 2,
      documentId: undefined,
      reservationToken: "reservation-for-43",
    });
  });

  /**
   * A live-edit screen keeps its already-loaded iframe when the canvas
   * remounts, so the replacement instance can see ordinary bridge traffic
   * before the editor-chrome listener has attached. Runtime inserts must not
   * flush on that traffic: the board→live drop would otherwise be posted into
   * an empty document and disappear before the explicit ready handshake.
   */
  it("holds runtime inserts until the explicit editor-chrome handshake", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const onRuntimeStructureInsertRejected = vi.fn();
    const onRuntimeStructureRollbackResult = vi.fn();
    const onRuntimeStructureDeleteRejected = vi.fn();

    const render = async (
      insertRequest: {
        requestId: number;
        transactionId?: string;
        screenId: string;
        html: string;
        additionalHtml?: string[];
        anchor: { selector: string; sourceId?: string };
        placement: "before" | "after" | "inside";
      } | null,
      rollbackRequest?: {
        requestId: string;
        transactionId?: string;
        screenId: string;
        selector: string;
        sourceId?: string;
      } | null,
      targetTransactionId?: string | null,
      deleteRequest?: {
        requestId: string;
        transactionId?: string;
        screenId: string;
        selector: string;
        selectorCandidates?: string[];
        waitForInsertTransaction?: boolean;
        rollbackScreenId?: string;
        rollbackSelector?: string;
        rollbackSourceId?: string;
        cancelRequested?: boolean;
      } | null,
    ) => {
      await act(async () => {
        root.render(
          <DesignCanvas
            content="http://localhost:5173/"
            contentKey="screen-live"
            screenId="screen-live"
            sourceType="localhost"
            bridgeUrl={bridgeUrl}
            previewToken="ready-recovery-preview-token"
            liveEditCapability="ready-recovery-live-edit-capability"
            runtimeStructureInsertRequest={insertRequest}
            runtimeStructureRollbackRequest={rollbackRequest}
            runtimeStructureTargetTransactionId={targetTransactionId}
            runtimeStructureDeleteRequest={deleteRequest}
            onRuntimeStructureInsertRejected={onRuntimeStructureInsertRejected}
            onRuntimeStructureDeleteRejected={onRuntimeStructureDeleteRejected}
            onRuntimeStructureRollbackResult={onRuntimeStructureRollbackResult}
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        );
      });
    };

    await render(null);
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframeWindow = iframe.contentWindow as Window;
    const posted: unknown[] = [];
    iframeWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];

    // Queue the command while the canvas has never seen a ready handshake.
    await render({
      requestId: 1,
      transactionId: "move-1",
      screenId: "screen-live",
      html: '<div data-agent-native-node-id="drop-1"></div>',
      additionalHtml: ['<div data-agent-native-node-id="drop-2"></div>'],
      anchor: { selector: "#anchor", sourceId: "anchor-1" },
      placement: "after",
    });
    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type ===
          "runtime-structure-insert",
      ),
    ).toHaveLength(0);

    const sendStyleChangeForScreen = (
      window as unknown as {
        __designCanvasSendStyleForScreen?: (
          screenId: string,
          selector: string,
          property: string,
          value: string,
        ) => boolean;
      }
    ).__designCanvasSendStyleForScreen;
    await vi.waitFor(() =>
      expect(sendStyleChangeForScreen).toBeTypeOf("function"),
    );
    await act(async () => {
      expect(
        sendStyleChangeForScreen!(
          "screen-live",
          "#anchor",
          "borderRadius",
          "12px",
        ),
      ).toBe(true);
    });
    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type === "style-change",
      ),
    ).toHaveLength(0);

    // Ordinary bridge traffic proves the document is reachable, but not that
    // the editor-chrome message listener is attached yet.
    posted.length = 0;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:runtime-layer-snapshot",
            payload: { html: "<body></body>", nodeCount: 1 },
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type ===
          "runtime-structure-insert",
      ),
    ).toHaveLength(0);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/",
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(
      posted.filter(
        (message) =>
          (message as { type?: unknown }).type ===
          "agent-native:editor-chrome-ready-probe",
      ),
    ).toHaveLength(1);
    expect(posted).toContainEqual({
      type: "set-text-editing-enabled",
      enabled: true,
    });

    const inserts = posted.filter(
      (message) =>
        (message as { type?: string } | null)?.type ===
        "runtime-structure-insert",
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toMatchObject({
      requestId: 1,
      placement: "after",
      anchorSourceId: "anchor-1",
    });
    expect(inserts[1]).toMatchObject({
      requestId: 1.001,
      placement: "after",
      anchorSourceId: "drop-1",
    });
    const relevantTypes = posted
      .map((message) => (message as { type?: string } | null)?.type)
      .filter(
        (type) =>
          type === "runtime-structure-insert" || type === "style-change",
      );
    expect(relevantTypes).toEqual([
      "runtime-structure-insert",
      "runtime-structure-insert",
      "style-change",
    ]);
    expect(onRuntimeStructureInsertRejected).not.toHaveBeenCalled();
    posted.length = 0;
    await render(null, null, "move-1", {
      screenId: "screen-live",
      requestId: "move-1:source",
      transactionId: "move-1",
      selector: "#source",
      waitForInsertTransaction: true,
      cancelRequested: true,
    });
    expect(
      posted.filter((message) =>
        ["cancel-pending-delete-element", "visual-structure-ack"].includes(
          (message as { type?: string }).type ?? "",
        ),
      ),
    ).toEqual([
      {
        type: "cancel-pending-delete-element",
        selector: "#source",
        selectorCandidates: [],
        requestId: "move-1:source",
        transactionId: "move-1",
      },
      {
        type: "visual-structure-ack",
        requestId: "move-1:source",
        applied: false,
      },
    ]);
    expect(onRuntimeStructureDeleteRejected).toHaveBeenCalledExactlyOnceWith({
      screenId: "screen-live",
      requestId: "move-1:source",
      transactionId: "move-1",
      reason: "cancelled",
    });
    await act(async () => root.render(null));
    expect(onRuntimeStructureInsertRejected).toHaveBeenCalledExactlyOnceWith(
      "target-canvas-unmounted",
      "move-1",
    );

    onRuntimeStructureInsertRejected.mockClear();
    await render(null, {
      screenId: "screen-live",
      requestId: "move-2:rollback",
      transactionId: "move-2",
      selector: "",
    });
    await vi.waitFor(() =>
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        ),
      ).not.toBeNull(),
    );
    const rollbackIframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const rollbackWindow = rollbackIframe.contentWindow as Window;
    rollbackWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];
    posted.length = 0;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready", routePath: "/" },
          origin: bridgeUrl,
          source: rollbackWindow,
        }),
      );
    });
    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type ===
          "runtime-structure-rollback-insert",
      ),
    ).toHaveLength(1);
    posted.length = 0;
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:runtime-reloading" },
          origin: bridgeUrl,
          source: rollbackWindow,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready", routePath: "/" },
          origin: bridgeUrl,
          source: rollbackWindow,
        }),
      );
    });
    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type ===
          "runtime-structure-rollback-insert",
      ),
    ).toHaveLength(1);
    await act(async () => root.render(null));
    expect(onRuntimeStructureRollbackResult).toHaveBeenCalledExactlyOnceWith({
      requestId: "move-2:rollback",
      transactionId: "move-2",
      applied: false,
      reason: "target-canvas-unmounted",
    });
    expect(onRuntimeStructureInsertRejected).not.toHaveBeenCalled();

    onRuntimeStructureRollbackResult.mockClear();
    await render(null, null, "move-3");
    await act(async () => root.render(null));
    expect(onRuntimeStructureInsertRejected).toHaveBeenCalledExactlyOnceWith(
      "target-canvas-unmounted",
      "move-3",
    );
    expect(onRuntimeStructureRollbackResult).not.toHaveBeenCalled();
  });

  it("cancels an acknowledged insert when the destination document reloads before source ack", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const onRuntimeStructureInsertRejected = vi.fn();

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/target"
          contentKey="screen-target"
          screenId="screen-target"
          sourceType="localhost"
          bridgeUrl={bridgeUrl}
          previewToken="ready-recovery-preview-token"
          liveEditCapability="ready-recovery-live-edit-capability"
          // The editor supplies this only after insert ack while the source
          // delete request is still awaiting its own ack.
          runtimeStructureTargetTransactionId="move-reload"
          onRuntimeStructureInsertRejected={onRuntimeStructureInsertRejected}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframeWindow = iframe.contentWindow as Window;
    iframeWindow.postMessage = vi.fn() as unknown as Window["postMessage"];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/target",
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:runtime-reloading" },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:runtime-reloading" },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(onRuntimeStructureInsertRejected).toHaveBeenCalledExactlyOnceWith(
      "target-document-replaced",
      "move-reload",
    );
  });

  it("keeps a live iframe bridge ready when its source snapshot key changes", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
    const render = async (contentKey: string) => {
      await act(async () =>
        root.render(
          <DesignCanvas
            content="http://localhost:5173/"
            contentKey={contentKey}
            screenId="screen-live"
            sourceType="localhost"
            bridgeUrl={bridgeUrl}
            previewToken="snapshot-refresh-preview-token"
            liveEditCapability="snapshot-refresh-live-edit-capability"
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        ),
      );
    };

    await render("snapshot-before");
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframeWindow = iframe.contentWindow as Window;
    const posted: unknown[] = [];
    iframeWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready", routePath: "/" },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    posted.length = 0;

    await render("snapshot-after");
    expect(container.querySelector("iframe[data-design-preview-iframe]")).toBe(
      iframe,
    );
    posted.length = 0;
    const sendStyleChange = (
      window as unknown as {
        __designCanvasSendStyleForScreen?: (
          screenId: string,
          selector: string,
          property: string,
          value: string,
        ) => boolean;
      }
    ).__designCanvasSendStyleForScreen;
    expect(sendStyleChange).toBeTypeOf("function");
    await act(async () => {
      expect(sendStyleChange!("screen-live", "#probe", "opacity", "0.5")).toBe(
        true,
      );
    });

    expect(posted).toContainEqual(
      expect.objectContaining({
        type: "style-change",
        selector: "#probe",
        property: "opacity",
        value: "0.5",
      }),
    );
  });

  it("does not roll back a runtime insert from its informational structure echo", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    const onVisualStructureChange = vi.fn(() => false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/"
          contentKey="runtime-insert-ack"
          screenId="screen-live"
          sourceType="localhost"
          bridgeUrl={bridgeUrl}
          previewToken="runtime-insert-ack-preview-token"
          liveEditCapability="runtime-insert-ack-live-edit-capability"
          runtimeStructureInsertRequest={{
            requestId: 1,
            screenId: "screen-live",
            html: '<div data-agent-native-node-id="inserted" />',
            anchor: { selector: "body", sourceId: "body" },
            placement: "inside",
          }}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          onVisualStructureChange={onVisualStructureChange}
          tweakValues={{}}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframeWindow = iframe.contentWindow as Window;
    const posted: unknown[] = [];
    iframeWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/",
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    posted.length = 0;

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "visual-structure-change",
            runtimeInsert: true,
            requestId: "1",
            transactionId: "runtime-insert-transaction",
            selector: '[data-agent-native-node-id="inserted"]',
            sourceId: "inserted",
            anchorSelector: "body",
            anchorSourceId: "body",
            placement: "inside",
            insertedHtml: '<div data-agent-native-node-id="inserted" />',
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(onVisualStructureChange).not.toHaveBeenCalled();
    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type ===
          "visual-structure-ack",
      ),
    ).toEqual([]);

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "runtime-structure-insert-applied",
            requestId: "1",
            transactionId: "runtime-insert-transaction",
            selector: '[data-agent-native-node-id="inserted"]',
            applied: true,
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(
      posted.filter(
        (message) =>
          (message as { type?: string } | null)?.type ===
          "visual-structure-ack",
      ),
    ).toEqual([]);
  });

  /**
   * The recovery above is passive — it needs the frame to speak first. An idle
   * live-edit frame never does, so an inspector style commit into a canvas
   * that missed the ready handshake queued forever: the inspector showed the
   * new value, the running app kept the old one, and nothing reported a
   * failure. Queueing must now ASK the bridge whether it is there.
   */
  it("probes the bridge when a style commit has to queue, and delivers it on the reply", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    const render = async (
      screenId: string,
      contentKey: string,
      pendingStylePreviewPatches?: Array<{
        screenId: string;
        selector: string;
        sourceId?: string;
        styles: Record<string, string>;
      }>,
    ) => {
      await act(async () => {
        root.render(
          <DesignCanvas
            content="http://localhost:5173/"
            contentKey={contentKey}
            screenId={screenId}
            sourceType="localhost"
            bridgeUrl={bridgeUrl}
            previewToken="style-probe-preview-token"
            liveEditCapability="style-probe-live-edit-capability"
            pendingStylePreviewPatches={pendingStylePreviewPatches}
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        );
      });
    };

    await render("screen-live", "screen-live");
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframeWindow = iframe.contentWindow as Window;
    const posted: unknown[] = [];
    iframeWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];
    const typesOf = (type: string) =>
      posted.filter(
        (message) => (message as { type?: string } | null)?.type === type,
      );

    const sendStyleChangeForScreen = (
      window as unknown as {
        __designCanvasSendStyleForScreen?: (
          screenId: string,
          selector: string,
          property: string,
          value: string,
          options?: { selectorCandidates?: string[]; nodeId?: string | null },
        ) => boolean;
      }
    ).__designCanvasSendStyleForScreen;
    expect(typeof sendStyleChangeForScreen).toBe("function");

    const probesBefore = typesOf("agent-native:text-edit-status").length;
    await act(async () => {
      expect(
        sendStyleChangeForScreen!(
          "another-screen",
          "#card",
          "borderRadius",
          "8px",
        ),
      ).toBe(false);
      expect(
        sendStyleChangeForScreen!(
          "screen-live",
          "#card",
          "borderRadius",
          "24px",
          {
            selectorCandidates: ["#card"],
          },
        ),
      ).toBe(true);
    });
    expect(typesOf("style-change")).toHaveLength(0);
    expect(typesOf("agent-native:text-edit-status").length).toBeGreaterThan(
      probesBefore,
    );
    const probesAfterQueue = typesOf("agent-native:text-edit-status").length;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });
    expect(typesOf("agent-native:text-edit-status").length).toBeGreaterThan(
      probesAfterQueue,
    );

    // The bridge answers the probe — that reply is the readiness proof.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:text-edit-status-result",
            correlationId: "",
            status: false,
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready", routePath: "/" },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(typesOf("style-change")).toEqual([
      {
        type: "style-change",
        selector: "#card",
        property: "borderRadius",
        value: "24px",
        selectorCandidates: ["#card"],
        nodeId: "",
      },
    ]);
    const probesAfterReady = typesOf("agent-native:text-edit-status").length;
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 300));
    });
    expect(typesOf("agent-native:text-edit-status")).toHaveLength(
      probesAfterReady,
    );

    posted.length = 0;
    const pendingPatch = {
      screenId: "screen-live",
      selector: "#card",
      sourceId: "card",
      styles: { color: "red" },
    };
    await render("screen-live", "screen-live-snapshot-refresh", [pendingPatch]);
    expect(typesOf("style-change")).toContainEqual({
      type: "style-change",
      selector: "#card",
      property: "color",
      value: "red",
      selectorCandidates: ["#card", '[data-agent-native-node-id="card"]'],
      nodeId: "card",
    });

    posted.length = 0;
    await render("screen-other", "screen-other-remount", [pendingPatch]);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:text-edit-status-result",
            correlationId: "",
            status: false,
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready", routePath: "/" },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    expect(typesOf("style-change")).toHaveLength(0);
  });

  /**
   * The probe above is only a recovery if it repeats. A frame that is
   * mid-navigation (or has not attached its bridge listener yet) silently
   * drops the first probe, and an otherwise-idle frame never speaks again —
   * so a single fire-and-forget probe strands the queue permanently while
   * every queued command still reports success. Undo of a live style edit is
   * the visible case: handleUndo runs, the revert reports sent, and the
   * running app never changes.
   */
  it("keeps probing when the frame ignores the first probe, and delivers once it answers", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Runtime</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/"
          contentKey="silent-frame"
          screenId="screen-live"
          sourceType="localhost"
          bridgeUrl={bridgeUrl}
          previewToken="silent-frame-preview-token"
          liveEditCapability="silent-frame-live-edit-capability"
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const iframeWindow = iframe.contentWindow as Window;
    const posted: unknown[] = [];
    iframeWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];
    const typesOf = (type: string) =>
      posted.filter(
        (message) => (message as { type?: string } | null)?.type === type,
      );

    const sendStyleChangeForScreen = (
      window as unknown as {
        __designCanvasSendStyleForScreen?: (
          screenId: string,
          selector: string,
          property: string,
          value: string,
          options?: { selectorCandidates?: string[]; nodeId?: string | null },
        ) => boolean;
      }
    ).__designCanvasSendStyleForScreen!;

    // An undo revert: empty value means "drop the inline override".
    await act(async () => {
      sendStyleChangeForScreen("screen-live", "#card", "borderRadius", "", {
        selectorCandidates: ["#card"],
      });
    });
    expect(typesOf("style-change")).toHaveLength(0);

    // The frame stays silent. The probe must repeat rather than give up.
    await vi.waitFor(
      () => {
        expect(typesOf("agent-native:text-edit-status").length).toBeGreaterThan(
          1,
        );
      },
      { timeout: 4000 },
    );

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:text-edit-status-result",
            correlationId: "",
            status: false,
          },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready", routePath: "/" },
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });

    expect(typesOf("style-change")).toEqual([
      {
        type: "style-change",
        selector: "#card",
        property: "borderRadius",
        value: "",
        selectorCandidates: ["#card"],
        nodeId: "",
      },
    ]);
  });
});
