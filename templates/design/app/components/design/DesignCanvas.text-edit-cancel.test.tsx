// @vitest-environment happy-dom

import http, { type Server } from "node:http";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  armPendingTextCapture,
  beginTextEditForOwner,
  isPendingTextRequestLive,
  onPendingTextCaptureCancel,
  peekPendingTextCapture,
  takePendingTextCapture,
} from "./design-canvas/pending-text-capture";
import { PENDING_TEXT_INTERCEPT_CAP_MS } from "./design-canvas/pending-text-edit";
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

it("drops a queued begin-text-edit when the creation is stood down before the bridge is ready", async () => {
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
        contentKey="screen-live"
        screenId="screen-live"
        sourceType="localhost"
        bridgeUrl={bridgeUrl}
        previewToken="text-edit-cancel-preview-token"
        liveEditCapability="text-edit-cancel-live-capability"
        liveEditRegistrationCapability="text-edit-cancel-registration-capability"
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
  const beginTextEdits = () =>
    posted.filter(
      (message) =>
        (message as { type?: string } | null)?.type === "begin-text-edit",
    );

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-cancel-1");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-cancel-1");
  });
  expect(beginTextEdits()).toHaveLength(0);

  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerdown"));
  });
  expect(isPendingTextRequestLive("screen-live", "text-cancel-1")).toBe(false);

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
  expect(beginTextEdits()).toHaveLength(0);

  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "text-edit-pending",
          nodeId: "text-cancel-1",
          pending: true,
        },
        origin: bridgeUrl,
        source: iframeWindow,
      }),
    );
  });
  const swallowed = new KeyboardEvent("keydown", {
    key: "x",
    cancelable: true,
  });
  window.dispatchEvent(swallowed);
  expect(swallowed.defaultPrevented).toBe(false);
});

async function mountCanvas(
  previewToken: string,
  options: { previewFrameId?: string; screenId?: string } = {},
) {
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
    mounted: boolean,
    overrides: { screenId?: string; key?: string } = {},
  ) => {
    await act(async () => {
      root.render(
        mounted ? (
          <DesignCanvas
            key={overrides.key}
            content="http://localhost:5173/"
            contentKey="screen-live"
            screenId={overrides.screenId ?? options.screenId ?? "screen-live"}
            sourceType="localhost"
            bridgeUrl={bridgeUrl}
            previewToken={previewToken}
            liveEditCapability="text-edit-cancel-live-capability"
            liveEditRegistrationCapability="text-edit-cancel-registration-capability"
            previewFrameId={options.previewFrameId}
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />
        ) : null,
      );
    });
  };

  const posted: unknown[] = [];
  const attachFrame = async () => {
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
    iframeWindow.postMessage = ((message: unknown) => {
      posted.push(message);
    }) as Window["postMessage"];
    return iframeWindow;
  };

  const fromFrame = async (iframeWindow: Window, data: unknown) => {
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data,
          origin: bridgeUrl,
          source: iframeWindow,
        }),
      );
    });
  };

  await render(true);
  const iframeWindow = await attachFrame();
  return {
    posted,
    render,
    attachFrame,
    fromFrame,
    iframeWindow,
    typed: (type: string) =>
      posted.filter(
        (message) => (message as { type?: string } | null)?.type === type,
      ),
    markReady: async (frame: Window) => {
      await fromFrame(frame, {
        type: "agent-native:runtime-layer-snapshot",
        payload: { html: "<body></body>", nodeCount: 1 },
      });
      await fromFrame(frame, {
        type: "agent-native:editor-chrome-ready",
      });
    },
  };
}

it("stands the whole request down when Escape is swallowed by the mounted canvas", async () => {
  const canvas = await mountCanvas("text-edit-escape-preview-token");

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-escape");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-escape");
  });
  const teardown = vi.fn();
  onPendingTextCaptureCancel("screen-live", "text-escape", teardown);
  expect(canvas.typed("begin-text-edit")).toHaveLength(0);

  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
  });
  expect(teardown).toHaveBeenCalledOnce();
  expect(isPendingTextRequestLive("screen-live", "text-escape")).toBe(false);

  await canvas.markReady(canvas.iframeWindow);
  expect(canvas.typed("begin-text-edit")).toHaveLength(0);
});

it("commits keystrokes escaped before the session opened, on a bridge that is not ready yet", async () => {
  const canvas = await mountCanvas("text-edit-escape-commit-preview-token");

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-kept");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-kept");
  });
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
  });

  expect(canvas.typed("begin-text-edit")).toHaveLength(0);
  await canvas.markReady(canvas.iframeWindow);
  expect(canvas.typed("begin-text-edit")).toEqual([
    {
      type: "begin-text-edit",
      nodeId: "text-kept",
      force: true,
      insertText: "Sta",
      commitImmediately: true,
    },
  ]);
});

it("cancels the exact host request when the frame reports it abandoned the begin", async () => {
  const canvas = await mountCanvas("text-edit-frame-abandon-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-frame");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-frame");
  });
  const teardown = vi.fn();
  onPendingTextCaptureCancel("screen-live", "text-frame", teardown);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-other",
    pending: false,
    reason: "escape",
  });
  expect(teardown).not.toHaveBeenCalled();
  expect(isPendingTextRequestLive("screen-live", "text-frame")).toBe(true);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-frame",
    pending: false,
    reason: "deadline",
  });
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-frame",
    pending: false,
  });
  expect(teardown).not.toHaveBeenCalled();
  expect(isPendingTextRequestLive("screen-live", "text-frame")).toBe(true);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-frame",
    pending: false,
    reason: "pointerdown",
  });
  expect(teardown).toHaveBeenCalledOnce();
  expect(isPendingTextRequestLive("screen-live", "text-frame")).toBe(false);
});

it("never lets a breakpoint preview canvas take the creation's buffer", async () => {
  const canvas = await mountCanvas("text-edit-preview-preview-token", {
    previewFrameId: "bp-390",
  });
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-preview");
  await act(async () => {
    for (const char of "Hi") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-preview",
    pending: true,
  });
  expect(takePendingTextCapture("screen-live", "text-preview")).toBe("Hi");
});

it("re-arming the same node keeps its buffer and never cancels its bridge request", async () => {
  const canvas = await mountCanvas("text-edit-rearm-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-rearm");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-rearm");
  });
  await act(async () => {
    for (const char of "Re") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-rearm");
  });

  expect(canvas.typed("agent-native:cancel-text-edit")).toHaveLength(0);
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-rearm",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-rearm",
      text: "Re",
    },
  ]);
});

it("a remounted owner begins the edit holding the buffer the old instance held", async () => {
  const canvas = await mountCanvas("text-edit-remount-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-remount");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-remount");
  });
  await act(async () => {
    for (const char of "Un") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  await canvas.render(false);
  await canvas.render(true);
  const remountedFrame = await canvas.attachFrame();
  await canvas.markReady(remountedFrame);

  await vi.waitFor(() => {
    const begins = canvas
      .typed("begin-text-edit")
      .filter(
        (message) => (message as { nodeId?: string }).nodeId === "text-remount",
      );
    expect(begins[begins.length - 1]).toEqual({
      type: "begin-text-edit",
      nodeId: "text-remount",
      force: true,
      insertText: "Un",
    });
  });

  await canvas.fromFrame(remountedFrame, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-remount",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([]);
  await canvas.fromFrame(remountedFrame, {
    type: "text-edit-insert-result",
    nodeId: "text-remount",
    inserted: true,
  });
  expect(isPendingTextRequestLive("screen-live", "text-remount")).toBe(false);
});

it("a keyed remount in one commit keeps intercepting and flushes every key into the new session", async () => {
  const canvas = await mountCanvas("text-edit-keyed-remount-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-keyed");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-keyed");
  });
  await act(async () => {
    for (const char of "Un") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  await canvas.render(true, { key: "replacement" });
  const remountedFrame = await canvas.attachFrame();
  const afterSwap = new KeyboardEvent("keydown", {
    key: "i",
    cancelable: true,
  });
  await act(async () => {
    window.dispatchEvent(afterSwap);
  });
  expect(afterSwap.defaultPrevented).toBe(true);

  await canvas.markReady(remountedFrame);
  await canvas.fromFrame(remountedFrame, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-keyed",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-keyed",
      text: "Uni",
    },
  ]);
});

it("keeps the typed buffer when the frame reports its own deadline", async () => {
  const canvas = await mountCanvas("text-edit-deadline-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-slow");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-slow");
  });
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-slow",
    pending: false,
    reason: "deadline",
  });
  expect(isPendingTextRequestLive("screen-live", "text-slow")).toBe(true);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-slow",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-slow",
      text: "Sta",
    },
  ]);
});

it("cancels under the CURRENT owner after the canvas switches screens", async () => {
  const canvas = await mountCanvas("text-edit-owner-swap-preview-token", {
    screenId: "screen-a",
  });
  await canvas.render(true, { screenId: "screen-b" });
  await canvas.attachFrame();

  const capture = armPendingTextCapture({ owner: "screen-b" });
  capture.bind("text-swap");
  const teardown = vi.fn();
  onPendingTextCaptureCancel("screen-b", "text-swap", teardown);
  await act(async () => {
    beginTextEditForOwner("screen-b", "text-swap");
  });
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
  });

  expect(teardown).toHaveBeenCalledOnce();
  expect(isPendingTextRequestLive("screen-b", "text-swap")).toBe(false);
});

it("keeps the escaped text until the frame acknowledges the commit", async () => {
  const canvas = await mountCanvas("text-edit-ack-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-ack");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-ack");
  });
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", cancelable: true }),
    );
  });

  expect(peekPendingTextCapture("screen-live", "text-ack")).toBe("Sta");
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-ack",
    pending: false,
    reason: "not-taken",
  });
  expect(peekPendingTextCapture("screen-live", "text-ack")).toBe("Sta");

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-ack",
    pending: false,
    reason: "committed",
  });
  expect(isPendingTextRequestLive("screen-live", "text-ack")).toBe(false);
});

it("never flushes a buffer into a session that belongs to another node", async () => {
  const canvas = await mountCanvas("text-edit-crosstalk-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-beta");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-beta");
  });
  await act(async () => {
    for (const char of "Beta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-alpha",
  });
  expect(canvas.typed("text-edit-insert-text")).toHaveLength(0);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-beta",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-beta",
      text: "Beta",
    },
  ]);
});

it("opens the session holding text typed before the cap, and intercepts nothing after it", async () => {
  const canvas = await mountCanvas("text-edit-owed-preview-token");

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-owed");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-owed");
  });
  await act(async () => {
    for (const char of "Standalone") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  const armedAt = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(
    armedAt + PENDING_TEXT_INTERCEPT_CAP_MS + 1,
  );
  const late = new KeyboardEvent("keydown", { key: "x", cancelable: true });
  await act(async () => {
    window.dispatchEvent(late);
  });
  expect(late.defaultPrevented).toBe(false);

  await canvas.markReady(canvas.iframeWindow);
  expect(canvas.typed("begin-text-edit")).toEqual([
    {
      type: "begin-text-edit",
      nodeId: "text-owed",
      force: true,
      insertText: "Standalone",
    },
  ]);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-owed",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([]);
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-owed",
    inserted: true,
  });
  expect(isPendingTextRequestLive("screen-live", "text-owed")).toBe(false);
});

it("completes the request when the session opens, so the cap never abandons a live session", async () => {
  const canvas = await mountCanvas("text-edit-complete-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-live");
  const teardown = vi.fn();
  onPendingTextCaptureCancel("screen-live", "text-live", teardown);
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-live");
  });
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-live",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-live",
      text: "Sta",
    },
  ]);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-live",
    inserted: true,
  });

  const armedAt = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(
    armedAt + PENDING_TEXT_INTERCEPT_CAP_MS + 1,
  );
  expect(isPendingTextRequestLive("screen-live", "text-live")).toBe(false);
  expect(teardown).not.toHaveBeenCalled();
  expect(canvas.typed("agent-native:cancel-text-edit")).toHaveLength(0);
});

it("flushes keys the capture still holds when the session opens without a canvas handoff", async () => {
  const canvas = await mountCanvas("text-edit-held-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-held");
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-held",
  });

  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-held",
      text: "Sta",
    },
  ]);
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-held",
    inserted: true,
  });

  expect(isPendingTextRequestLive("screen-live", "text-held")).toBe(false);
});

it("keeps owing the text when the frame reports the insert did not land", async () => {
  const canvas = await mountCanvas("text-edit-insert-drop-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-drop");
  await act(async () => {
    beginTextEditForOwner("screen-live", "text-drop");
  });
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-drop",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([
    {
      type: "text-edit-insert-text",
      nodeId: "text-drop",
      text: "Sta",
    },
  ]);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-drop",
    inserted: false,
  });
  expect(peekPendingTextCapture("screen-live", "text-drop")).toBe("Sta");
  expect(isPendingTextRequestLive("screen-live", "text-drop")).toBe(true);

  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-drop",
    inserted: true,
  });
  expect(isPendingTextRequestLive("screen-live", "text-drop")).toBe(false);
});

it("revokes an owed delivery the frame may already hold when the request stands down", async () => {
  const canvas = await mountCanvas("text-edit-revoke-preview-token");
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-revoke");
  await act(async () => {
    for (const char of "Sta") {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: char }));
    }
  });

  const armedAt = Date.now();
  vi.spyOn(Date, "now").mockReturnValue(
    armedAt + PENDING_TEXT_INTERCEPT_CAP_MS + 1,
  );
  await act(async () => {
    expect(isPendingTextRequestLive("screen-live", "text-revoke")).toBe(true);
  });
  const begins = canvas
    .typed("begin-text-edit")
    .filter(
      (message) => (message as { nodeId?: string }).nodeId === "text-revoke",
    );
  expect(begins[begins.length - 1]).toMatchObject({
    nodeId: "text-revoke",
    insertText: "Sta",
  });

  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerdown"));
  });
  expect(
    canvas
      .typed("agent-native:cancel-text-edit")
      .filter(
        (message) => (message as { nodeId?: string }).nodeId === "text-revoke",
      ),
  ).toHaveLength(1);
});

it("never arms a preview canvas's key buffer from a pending report", async () => {
  const canvas = await mountCanvas("text-edit-preview-pending-token", {
    previewFrameId: "bp-390",
  });
  await canvas.markReady(canvas.iframeWindow);

  const capture = armPendingTextCapture({ owner: "screen-live" });
  capture.bind("text-preview-pending");
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-preview-pending",
    pending: true,
  });

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  });
  expect(peekPendingTextCapture("screen-live", "text-preview-pending")).toBe(
    "x",
  );
});
