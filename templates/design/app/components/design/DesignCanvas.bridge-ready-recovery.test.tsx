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
  /**
   * A live-edit screen keeps its already-loaded iframe when the canvas
   * remounts, so the replacement instance never sees the one-time
   * `editor-chrome-ready` handshake. Before readiness was re-derived from any
   * trusted frame message, every one-shot command (the board→live drop, text
   * edits, deletes) sat in the pending queue forever with nothing to flush it:
   * the gesture reported success and changed nothing.
   */
  it("flushes a queued command when the bridge talks without a fresh ready handshake", async () => {
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
      insertRequest: {
        requestId: number;
        screenId: string;
        html: string;
        additionalHtml?: string[];
        anchor: { selector: string; sourceId?: string };
        placement: "before" | "after" | "inside";
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
            runtimeStructureInsertRequest={insertRequest}
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

    // The bridge proves it is live in this document by posting anything else.
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
    await render("screen-live", "screen-live-remount", [pendingPatch]);
    expect(typesOf("style-change")).toHaveLength(0);
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
