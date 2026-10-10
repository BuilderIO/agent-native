// @vitest-environment happy-dom

import { SESSION_REPLAY_IFRAME_PROBE } from "@agent-native/core/client/host";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let root: Root;

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
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DesignCanvas inline boot", () => {
  it("keeps native status transport available when the first effect is applied without remounting", async () => {
    vi.spyOn(
      HTMLIFrameElement.prototype,
      "contentWindow",
      "get",
    ).mockReturnValue(window);
    const source = "<!doctype html><html><body><div>Plain</div></body></html>";
    const withEffect = source.replace(
      "</body>",
      '<script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script></body>',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              designId: "design-1",
              fileId: "screen-1",
              approvedDefinitionHashes: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const queryClient = new QueryClient();
    const render = async (content: string) =>
      act(async () =>
        root.render(
          <QueryClientProvider client={queryClient}>
            <DesignCanvas
              content={content}
              contentKey="screen-1:stable"
              designId="design-1"
              screenId="screen-1"
              nativeApprovalsEnabled
              zoom={100}
              deviceFrame="none"
              editMode
              interactMode={false}
              onElementSelect={() => {}}
              onElementHover={() => {}}
              tweakValues={{}}
            />
          </QueryClientProvider>,
        ),
      );
    await render(source);
    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const sent = vi.spyOn(iframe.contentWindow!, "postMessage");
    expect(iframe.dataset.nativeShaderApprovals).toBeUndefined();
    const replies: unknown[] = [];
    const onReply = (event: Event) =>
      replies.push((event as CustomEvent<unknown>).detail);
    window.addEventListener("design-native-shader-status", onReply);
    try {
      await act(async () =>
        window.dispatchEvent(
          new CustomEvent("design-native-shader-status-request", {
            detail: {
              designId: "design-1",
              fileId: "screen-1",
              instanceId: "effect-1",
              nodeId: "node-1",
              requestId: "native_first_1",
            },
          }),
        ),
      );
      const firstRequest = sent.mock.calls
        .map(([message]) => message as { type?: string; requestId?: string })
        .find((message) => message.type === "native-shader-status-request");
      expect(firstRequest?.requestId).toMatch(/^native_first_1_[0-9]+$/);

      await render(withEffect);
      expect(
        container.querySelector("iframe[data-design-preview-iframe]"),
      ).toBe(iframe);
      expect(iframe.getAttribute("srcdoc")).toContain("Plain");
      await vi.waitFor(() =>
        expect(iframe.dataset.nativeShaderApprovals).toBe("ready"),
      );
      await act(async () =>
        window.dispatchEvent(
          new MessageEvent("message", {
            source: iframe.contentWindow,
            origin: window.location.origin,
            data: {
              type: "native-shader-status",
              schemaVersion: 1,
              requestId: firstRequest!.requestId,
              runtimeEpoch: "runtime_1",
              instanceId: "effect-1",
              nodeId: "node-1",
              status: "ready",
              backend: "webgpu",
              frames: 1,
              sourceCaptures: 0,
              estimatedResourceBytes: 4096,
            },
          }),
        ),
      );
      expect(replies).toEqual([
        expect.objectContaining({
          designId: "design-1",
          fileId: "screen-1",
          status: "ready",
          backend: "webgpu",
        }),
      ]);
    } finally {
      window.removeEventListener("design-native-shader-status", onReply);
    }
  });

  it("reports an inline srcdoc document booted once it loads", async () => {
    const onBootReady = vi.fn();
    await act(async () => {
      root.render(
        <DesignCanvas
          content="<!doctype html><html><body><h1>Inline</h1></body></html>"
          contentKey="screen-inline"
          screenId="screen-inline"
          onBootReady={onBootReady}
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

    const iframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    expect(iframe?.getAttribute("srcdoc")).toContain("Inline");

    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });
    await act(async () => {
      iframe?.dispatchEvent(new Event("load"));
    });
    expect(onBootReady).toHaveBeenCalledTimes(1);
  });

  it("reports an inline document booted when its editor bridge is ready, before load", async () => {
    const dispatchEvent = HTMLIFrameElement.prototype.dispatchEvent;
    vi.spyOn(HTMLIFrameElement.prototype, "dispatchEvent").mockImplementation(
      function (this: HTMLIFrameElement, event: Event) {
        return event.type === "load" || dispatchEvent.call(this, event);
      },
    );
    const onBootReady = vi.fn();
    await act(async () => {
      root.render(
        <DesignCanvas
          content="<!doctype html><html><body><h1>Inline</h1></body></html>"
          contentKey="screen-inline"
          screenId="screen-inline"
          onBootReady={onBootReady}
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
    const iframeWindow = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )?.contentWindow;
    expect(iframeWindow).toBeTruthy();
    const post = async (type: string) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { type },
            origin: "null",
            source: iframeWindow,
          }),
        );
      });

    expect(onBootReady).not.toHaveBeenCalled();
    await post(SESSION_REPLAY_IFRAME_PROBE);
    expect(onBootReady).not.toHaveBeenCalled();
    await post("agent-native:editor-chrome-ready");
    expect(onBootReady).toHaveBeenCalledTimes(1);
  });
});

it("rebinds native status transport to the replacement inline frame after a source revision", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            designId: "design-1",
            fileId: "screen-1",
            approvedDefinitionHashes: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const queryClient = new QueryClient();
  const render = async (rotation: number) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <DesignCanvas
            content={`<!doctype html><html><body><div data-agent-native-node-id="node-1" style="transform:rotate(${rotation}deg)">Layer</div></body></html>`}
            contentKey={`screen-1:revision-${rotation}`}
            designId="design-1"
            screenId="screen-1"
            nativeApprovalsEnabled
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />
        </QueryClientProvider>,
      ),
    );
  const requests = (sent: { mock: { calls: unknown[][] } }) =>
    sent.mock.calls
      .map(([message]) => message as { type?: string; requestId?: string })
      .filter((message) => message.type === "native-shader-status-request");
  const request = async (requestId: string) =>
    act(async () =>
      window.dispatchEvent(
        new CustomEvent("design-native-shader-status-request", {
          detail: {
            designId: "design-1",
            fileId: "screen-1",
            instanceId: "effect-1",
            nodeId: "node-1",
            requestId,
          },
        }),
      ),
    );
  const reply = async (
    source: Window,
    requestId: string | undefined,
    runtimeEpoch: string,
    origin = window.location.origin,
  ) =>
    act(async () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source,
          origin,
          data: {
            type: "native-shader-status",
            schemaVersion: 1,
            requestId,
            runtimeEpoch,
            instanceId: "effect-1",
            nodeId: "node-1",
            status: "ready",
            backend: "webgpu",
            frames: 1,
            sourceCaptures: 0,
            estimatedResourceBytes: 4096,
          },
        }),
      ),
    );
  const replies: unknown[] = [];
  const onReply = (event: Event) =>
    replies.push((event as CustomEvent<unknown>).detail);
  window.addEventListener("design-native-shader-status", onReply);
  try {
    await render(0);
    const first = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const firstWindow = first.contentWindow!;
    expect(firstWindow).toBeTruthy();
    const firstSent = vi
      .spyOn(firstWindow, "postMessage")
      .mockImplementation(() => {});
    await request("native_before");
    const firstRequests = requests(firstSent);
    const firstRequest = firstRequests[firstRequests.length - 1]!;
    expect(firstRequest.requestId).toMatch(/^native_before_[0-9]+$/);
    await reply(firstWindow, firstRequest.requestId, "runtime_before");
    expect(replies).toHaveLength(1);

    await render(90);
    const second = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    )!;
    const secondWindow = second.contentWindow!;
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
    expect(second.getAttribute("srcdoc")).toContain("rotate(90deg)");
    expect(secondWindow).toBeTruthy();
    expect(secondWindow).not.toBe(firstWindow);
    const secondSent = vi
      .spyOn(secondWindow, "postMessage")
      .mockImplementation(() => {});
    const oldRequestCount = requests(firstSent).length;
    await request("native_after");
    expect(requests(secondSent)).toHaveLength(1);
    expect(requests(firstSent)).toHaveLength(oldRequestCount);
    const secondRequest = requests(secondSent)[0]!;
    expect(secondRequest.requestId).toMatch(/^native_after_[0-9]+$/);
    expect(secondSent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "native-shader-status-request",
        instanceId: "effect-1",
        nodeId: "node-1",
      }),
      window.location.origin,
    );

    await reply(firstWindow, secondRequest.requestId, "runtime_after");
    await reply(
      secondWindow,
      secondRequest.requestId,
      "runtime_after",
      "https://untrusted.invalid",
    );
    await reply(secondWindow, firstRequest.requestId, "runtime_before");
    await reply(secondWindow, undefined, "runtime_after");
    expect(replies).toHaveLength(1);
    await reply(secondWindow, secondRequest.requestId, "runtime_after");
    expect(replies).toHaveLength(2);
    expect(replies[replies.length - 1]).toEqual(
      expect.objectContaining({
        designId: "design-1",
        fileId: "screen-1",
        requestId: secondRequest.requestId,
        runtimeEpoch: "runtime_after",
        status: "ready",
        backend: "webgpu",
      }),
    );
    await reply(secondWindow, undefined, "runtime_before");
    expect(replies).toHaveLength(2);
    await reply(secondWindow, undefined, "runtime_after");
    expect(replies).toHaveLength(3);

    await act(async () => second.dispatchEvent(new Event("load")));
    const reloadedRequests = requests(secondSent);
    const reloadedRequest = reloadedRequests[reloadedRequests.length - 1]!;
    expect(reloadedRequest.requestId).toMatch(/^native_after_[0-9]+$/);
    expect(reloadedRequest.requestId).not.toBe(secondRequest.requestId);
    await reply(secondWindow, secondRequest.requestId, "runtime_after");
    await reply(secondWindow, undefined, "runtime_after");
    expect(replies).toHaveLength(3);
    await reply(secondWindow, reloadedRequest.requestId, "runtime_reloaded");
    expect(replies).toHaveLength(4);
    expect(replies[replies.length - 1]).toEqual(
      expect.objectContaining({
        requestId: reloadedRequest.requestId,
        runtimeEpoch: "runtime_reloaded",
        status: "ready",
      }),
    );
  } finally {
    window.removeEventListener("design-native-shader-status", onReply);
  }
});

it("delivers the existing native approvals to a replacement inline frame with the same authored source", async () => {
  const dispatchEvent = HTMLIFrameElement.prototype.dispatchEvent;
  const suppressLoad = vi
    .spyOn(HTMLIFrameElement.prototype, "dispatchEvent")
    .mockImplementation(function (this: HTMLIFrameElement, event: Event) {
      return event.type === "load" || dispatchEvent.call(this, event);
    });
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
            fileId: "screen-1",
            approvedDefinitionHashes: ["a".repeat(64)],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ),
  );
  const sent = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const source =
    '<!doctype html><html><body><div>Layer</div><script type="application/x-agent-native-effects">{"schemaVersion":2,"definitions":[],"instances":[]}</script></body></html>';
  const queryClient = new QueryClient();
  const render = async (contentKey: string) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={queryClient}>
          <DesignCanvas
            content={source}
            contentKey={contentKey}
            designId="design-1"
            screenId="screen-1"
            nativeApprovalsEnabled
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />
        </QueryClientProvider>,
      ),
    );
  const approvedMessages = () =>
    sent.mock.calls.filter(
      ([message]) =>
        (message as { type?: string; status?: string }).type ===
          "native-shader-approvals" &&
        (message as { status?: string }).status === "ready",
    );
  await render("screen-1:revision-1");
  const first = container.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  )!;
  await vi.waitFor(() =>
    expect(first.dataset.nativeShaderApprovals).toBe("ready"),
  );
  const firstApprovalCount = approvedMessages().length;
  expect(firstApprovalCount).toBeGreaterThan(0);
  await render("screen-1:revision-2");
  const second = container.querySelector<HTMLIFrameElement>(
    "iframe[data-design-preview-iframe]",
  )!;
  expect(second).not.toBe(first);
  expect(first.isConnected).toBe(false);
  expect(second.dataset.nativeShaderApprovals).toBe("ready");
  expect(approvedMessages()).toHaveLength(firstApprovalCount + 1);
  const currentApprovals = approvedMessages();
  expect(currentApprovals[currentApprovals.length - 1]).toEqual([
    {
      type: "native-shader-approvals",
      status: "ready",
      hashes: ["a".repeat(64)],
    },
    window.location.origin,
  ]);
  const beforeOldLoad = approvedMessages().length;
  suppressLoad.mockRestore();
  await act(async () => first.dispatchEvent(new Event("load")));
  expect(approvedMessages()).toHaveLength(beforeOldLoad);
  await act(async () => second.dispatchEvent(new Event("load")));
  expect(approvedMessages()).toHaveLength(beforeOldLoad + 1);
});
