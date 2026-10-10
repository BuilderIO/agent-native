// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { MultiScreenCanvas } from "./MultiScreenCanvas";

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string) => key,
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.spyOn(HTMLIFrameElement.prototype, "contentWindow", "get").mockReturnValue(
    window,
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            designId: "design-1",
            fileId: "board-file",
            approvedDefinitionHashes: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 1200,
    bottom: 800,
    width: 1200,
    height: 800,
    toJSON: () => ({}),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  container.remove();
});

async function mountBoard(enabled: boolean) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MultiScreenCanvas
          screens={[]}
          zoom={100}
          activeTool="move"
          geometryById={{}}
          onPick={() => {}}
          reviewResourceId="design-1"
          nativeApprovalsEnabled={enabled}
          boardFileId="board-file"
          boardIsActive
          boardFrameGeometry={{ x: 0, y: 0, width: 1200, height: 800 }}
          boardFileContent={
            '<!doctype html><html><body><div data-agent-native-node-id="board-frame">Frame</div><script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script></body></html>'
          }
        />
      </QueryClientProvider>,
    ),
  );
  const iframe = container.querySelector<HTMLIFrameElement>(
    "[data-board-surface-layer] iframe[data-design-preview-iframe]",
  );
  expect(iframe?.contentWindow).toBeTruthy();
  return iframe!;
}

function requestStatus(requestId: string) {
  window.dispatchEvent(
    new CustomEvent("design-native-shader-status-request", {
      detail: {
        designId: "design-1",
        fileId: "board-file",
        instanceId: "effect-1",
        nodeId: "board-frame",
        requestId,
      },
    }),
  );
}

it("delivers selected board status requests to the exact board frame and forwards its reply", async () => {
  const iframe = await mountBoard(true);
  const sent = vi.spyOn(iframe.contentWindow!, "postMessage");
  const replies: unknown[] = [];
  const onReply = (event: Event) =>
    replies.push((event as CustomEvent<unknown>).detail);
  window.addEventListener("design-native-shader-status", onReply);
  try {
    await act(async () => requestStatus("native_board_1"));
    const statusRequest = sent.mock.calls.find(
      ([message]) =>
        typeof message === "object" &&
        message !== null &&
        (message as { type?: string }).type === "native-shader-status-request",
    );
    expect(statusRequest?.[0]).toMatchObject({
      type: "native-shader-status-request",
      instanceId: "effect-1",
      nodeId: "board-frame",
    });
    expect(statusRequest?.[1]).toBe(window.location.origin);
    const requestId = (statusRequest?.[0] as { requestId: string }).requestId;
    expect(requestId).toMatch(/^native_board_1_[0-9]+$/);
    await act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: iframe.contentWindow,
          origin: window.location.origin,
          data: {
            type: "native-shader-status",
            schemaVersion: 1,
            runtimeEpoch: "board_runtime_1",
            requestId,
            instanceId: "effect-1",
            nodeId: "board-frame",
            status: "ready",
            backend: "webgpu",
            frames: 5,
            sourceCaptures: 1,
            estimatedResourceBytes: 4096,
          },
        }),
      ),
    );
    expect(replies).toEqual([
      expect.objectContaining({
        designId: "design-1",
        fileId: "board-file",
        instanceId: "effect-1",
        nodeId: "board-frame",
        status: "ready",
        backend: "webgpu",
      }),
    ]);
  } finally {
    window.removeEventListener("design-native-shader-status", onReply);
  }
});

it("keeps board status transport disabled without signed-in approval capability", async () => {
  const iframe = await mountBoard(false);
  const sent = vi.spyOn(iframe.contentWindow!, "postMessage");
  await act(async () => requestStatus("native_board_2"));
  expect(
    sent.mock.calls.some(
      ([value]) =>
        typeof value === "object" &&
        value !== null &&
        (value as { type?: string }).type === "native-shader-status-request",
    ),
  ).toBe(false);
});
