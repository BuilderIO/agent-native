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

/**
 * Cancelling only the delayed-activation timer is not enough. A begin-text-edit
 * posted while the bridge was not ready waits in the one-shot ready queue, and
 * the flush that follows readiness focuses the node INSIDE the iframe — by then
 * no host-side check can take the session back. The cancel has to reach the
 * queue that holds the command.
 */
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
  // Never delivered: the canvas has not seen a ready handshake yet.
  expect(beginTextEdits()).toHaveLength(0);

  await act(async () => {
    window.dispatchEvent(new PointerEvent("pointerdown"));
  });
  expect(isPendingTextRequestLive("screen-live", "text-cancel-1")).toBe(false);

  // The bridge finally proves it is live and the queue flushes.
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

  // A late pending report for the cancelled request must not re-arm the host
  // buffer either — nothing is left to replay keystrokes into.
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

/** Render + iframe/postMessage plumbing shared by the cancellation cases. */
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
    /** Mark both the runtime bridge and the editor-chrome listener ready. */
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

/**
 * The canvas's own keystroke listener registered on MOUNT, so it runs before
 * the capture's — and it stopImmediatePropagation()s. Escape therefore never
 * reached the capture's listener: the request, its retry ladder and its bridge
 * copy all stayed live and could re-focus the node the user just escaped.
 */
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

  // The bridge finally becomes ready: nothing queued survives to focus it.
  await canvas.markReady(canvas.iframeWindow);
  expect(canvas.typed("begin-text-edit")).toHaveLength(0);
});

/**
 * Escape ends the session and KEEPS what was typed (Figma). Inside the
 * activation delay the keystrokes are still host-side, and dropping them there
 * lost the text AND left an empty layer behind — the reported ~200 ms window.
 */
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

  // Queued until the frame is ready, then delivered with the text aboard: one
  // command that opens the session, lands "Sta", and closes it again.
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

/**
 * The frame can abandon a begin on its own — Escape or a pointerdown inside it,
 * a superseding dblclick, or its own deadline — and says so with
 * text-edit-pending:false. The host used to drop only its local buffer, leaving
 * the capture and the retry ladder alive to re-open the request.
 */
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

  // A report about some other node changes nothing.
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-pending",
    nodeId: "text-other",
    pending: false,
    reason: "escape",
  });
  expect(teardown).not.toHaveBeenCalled();
  expect(isPendingTextRequestLive("screen-live", "text-frame")).toBe(true);

  // The frame's own pump deadline only means the node has not arrived there
  // yet. Escalating it to abandonment deletes a node the host ladder is still
  // working on, so the host request survives it — as does an unlabelled report.
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

/**
 * A breakpoint preview renders the SAME screenId as the primary frame, which is
 * why owner registration excludes it. The pending-window handoff has to be
 * excluded for the same reason: a preview draining the buffer sends the
 * gesture's keystrokes to a frame that will never own the session.
 */
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
  // Still the primary frame's to take.
  expect(takePendingTextCapture("screen-live", "text-preview")).toBe("Hi");
});

/**
 * Re-arming the same node is how the retry ladder keeps a slow activation
 * alive. Tearing the previous request down on that path threw away the buffer
 * the call had just adopted and told the bridge to forget a request about to be
 * re-issued.
 */
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

/**
 * The buffer alone is not enough to survive a remount: takePendingTextCapture
 * also consumed the begin INTENT, so the replacement canvas registered with
 * nothing telling it to open the session, and the keystrokes sat in the capture
 * with no one to flush them. An owner that is gone for a whole render is not
 * mounted, so interception ends there and the text rides in the replacement's
 * begin command instead.
 */
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

  // The session opens in the new frame already holding the keystrokes.
  await canvas.fromFrame(remountedFrame, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-remount",
  });
  expect(canvas.typed("text-edit-insert-text")).toEqual([]);
  // The frame confirms the keystrokes landed — that, not the session opening,
  // is what ends the request.
  await canvas.fromFrame(remountedFrame, {
    type: "text-edit-insert-result",
    nodeId: "text-remount",
    inserted: true,
  });
  expect(isPendingTextRequestLive("screen-live", "text-remount")).toBe(false);
});

/**
 * A keyed remount unmounts the old owner and mounts its replacement in ONE
 * commit. Judging "the owner is gone" before that commit settles ended
 * interception mid-swap, and the next key typed hit host shortcuts.
 */
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

/**
 * The frame's own pending deadline fires on a slow board mount, and it means
 * "the node has not arrived here yet" — not "the user gave up". Clearing the
 * host buffer on it discarded everything typed while the board was mounting.
 */
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

  // Still there to commit: the session finally opens and takes it.
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

/**
 * The single-screen canvas renders without a key, so `screenId` mutates in
 * place when the active file changes. The keystroke listener installs once —
 * reading the prop through the closure cancelled a capture under the OLD
 * owner, which silently matched nothing.
 */
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

/**
 * The escaped text is a COPY in the bridge payload; the capture keeps the
 * original until the frame says it took it. An iframe swap or an unmount
 * before the flush must not be able to lose it.
 */
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

  // Delivered, but not yet acknowledged — the host still owns the original.
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

/**
 * A late activation for the PREVIOUS creation used to drain whatever buffer the
 * host held, splicing the next creation's keystrokes into the wrong layer —
 * "Beta" typed for the second text box arriving inside the first one as
 * "BetaAlpha", and the second box left empty.
 */
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

  // The earlier creation's session finally reports active.
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-editing-state",
    active: true,
    sourceId: "text-alpha",
  });
  expect(canvas.typed("text-edit-insert-text")).toHaveLength(0);

  // The buffer is still the second creation's, and lands in ITS session.
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

/**
 * A frame still loading when the interception cap passed used to lose every
 * key typed into it: the capture's clock tore the request down and the canvas
 * buffer went with it. The keys become an owed delivery instead, and the
 * session opens already holding them.
 */
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
  // The frame confirms the keystrokes landed — that, not the session opening,
  // is what ends the request.
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-owed",
    inserted: true,
  });
  expect(isPendingTextRequestLive("screen-live", "text-owed")).toBe(false);
});

/**
 * The creation ends where its session opens. Left open, the request ran on to
 * the interception cap, which tore it down as abandoned and scheduled the
 * empty-node cleanup against the node still being typed into — its source
 * stays empty until the session commits.
 */
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

  // The frame says the keystrokes landed: that, not the session opening, is
  // what ends the request.
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

/**
 * The retry ladder posts begin-text-edit straight at the frame, so a session
 * can open before any canvas took the keys. Those keys used to stay in the
 * capture until the cap, then land after whatever was typed into the session.
 */
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
  // The frame says the keystrokes landed: that, not the session opening, is
  // what ends the request.
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-held",
    inserted: true,
  });

  expect(isPendingTextRequestLive("screen-live", "text-held")).toBe(false);
});

/**
 * The frame drops an insert it cannot place — the editable was replaced or
 * detached between the session opening and the flush. Releasing the request on
 * activation left those keystrokes in no session, no source, and no buffer.
 */
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

  // Dropped: the host still holds the only copy, and owes it to that node.
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-drop",
    inserted: false,
  });
  expect(peekPendingTextCapture("screen-live", "text-drop")).toBe("Sta");
  expect(isPendingTextRequestLive("screen-live", "text-drop")).toBe(true);

  // Landed on the re-delivery: only that ends the request.
  await canvas.fromFrame(canvas.iframeWindow, {
    type: "text-edit-insert-result",
    nodeId: "text-drop",
    inserted: true,
  });
  expect(isPendingTextRequestLive("screen-live", "text-drop")).toBe(false);
});

/**
 * The host-side commit fallback writes the owed text into the source. If the
 * frame is still holding the begin that carries those same characters, that
 * commit is a SECOND copy — dropping the queued message never reached the copy
 * the iframe already had. The owed delivery is the ONLY begin here on purpose:
 * the ordinary activation path registers its own revoke, which would mask this.
 */
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

  // The cap passes with the text still owed: interception ends and the owner is
  // asked to open the session holding it.
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

  // The frame holds that begin now. Standing the request down — the same path
  // the host-side commit takes before it writes — has to revoke it there.
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

/**
 * A breakpoint preview renders the same screen with NO owner identity, so it
 * can never take the capture, drain it, or acknowledge it. Arming its key
 * listener from a pending report swallowed keys that nothing could deliver.
 */
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

  // The key must reach the creation's own capture, not this preview.
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
  });
  expect(peekPendingTextCapture("screen-live", "text-preview-pending")).toBe(
    "x",
  );
});
