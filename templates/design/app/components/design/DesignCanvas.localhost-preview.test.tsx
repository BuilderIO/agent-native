// @vitest-environment happy-dom

import http, { type Server } from "node:http";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const callActionMock = vi.hoisted(() => vi.fn());
const useActionQueryMock = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: callActionMock,
  usePinchZoom: () => {},
  useActionQuery: useActionQueryMock,
}));

import {
  getDesignCanvasIframeAllow,
  getLocalNetworkAccessPermissionState,
} from "./design-canvas/external-preview";
import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let root: Root;
const queryClient = new QueryClient();
let iframeServer: Server | null = null;

function requestInfoUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

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
  const render = root.render.bind(root);
  root.render = (children) =>
    render(
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>,
    );
  queryClient.clear();
  callActionMock.mockReset();
  useActionQueryMock.mockReset();
  useActionQueryMock.mockReturnValue({ data: undefined });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  if (iframeServer) {
    await new Promise<void>((resolve) => iframeServer!.close(() => resolve()));
    iframeServer = null;
  }
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DesignCanvas authenticated localhost source hydration", () => {
  it("renders the shared snapshot without contacting or embedding the owner's localhost", async () => {
    useActionQueryMock.mockReturnValue({
      data: {
        designId: "design-one",
        fileId: "screen-account",
        html: '<!doctype html><html><head><script>top.alert("unsafe-snapshot")</script></head><body><main onclick="unsafe()"><a href="javascript:unsafe()">Shared screen</a><img src="http://localhost:5173/private.png"></main></body></html>',
        updatedAt: "2026-09-24T00:00:00.000Z",
        publishedRevision: "4",
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          designId="design-one"
          sourceType="localhost"
          snapshotOnly
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
    expect(iframe?.getAttribute("src")).toBeNull();
    expect(iframe?.getAttribute("srcdoc")).toContain("Shared screen");
    expect(iframe?.getAttribute("srcdoc")).not.toContain("localhost:5173");
    expect(iframe?.getAttribute("srcdoc")).not.toContain("unsafe-snapshot");
    expect(iframe?.getAttribute("srcdoc")).not.toContain("onclick");
    expect(iframe?.getAttribute("srcdoc")).not.toContain("href=");
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(
      fetchMock.mock.calls.some(([input]) =>
        requestInfoUrl(input).includes("localhost:5173"),
      ),
    ).toBe(false);
    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-visual-edit-snapshot",
      {
        designId: "design-one",
        fileId: "screen-account",
        knownPublishedRevision: null,
      },
      { refetchInterval: 2_000 },
    );
    expect(useActionQueryMock).toHaveBeenCalledWith(
      "get-visual-edit-snapshot",
      {
        designId: "design-one",
        fileId: "screen-account",
        knownPublishedRevision: "4",
      },
      { refetchInterval: 2_000 },
    );
  });

  it("waits instead of mounting the URL when a shared snapshot is not ready", async () => {
    useActionQueryMock.mockReturnValue({
      data: {
        designId: "design-one",
        fileId: "screen-account",
        html: null,
        updatedAt: null,
        publishedRevision: null,
      },
    });

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          designId="design-one"
          sourceType="localhost"
          snapshotOnly
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

    expect(
      container.querySelector("iframe[data-design-preview-iframe]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-design-live-canvas-waiting]"),
    ).not.toBeNull();
    expect(container.innerHTML).not.toContain("localhost:5173");
  });

  it("clears a cached snapshot when a newer published revision is empty", async () => {
    let data: {
      designId: string;
      fileId: string;
      html: string | null;
      updatedAt: string | null;
      publishedRevision: string | null;
      unchanged: boolean;
    } = {
      designId: "design-one",
      fileId: "screen-account",
      html: "<html><body>Old snapshot</body></html>",
      updatedAt: "2026-09-24T00:00:00.000Z",
      publishedRevision: "4",
      unchanged: false,
    };
    useActionQueryMock.mockImplementation(() => ({ data }));
    const renderSnapshotCanvas = () => (
      <DesignCanvas
        content="http://localhost:5173/account"
        contentKey="screen-account"
        screenId="screen-account"
        designId="design-one"
        sourceType="localhost"
        snapshotOnly
        zoom={100}
        deviceFrame="none"
        editMode
        interactMode={false}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />
    );

    await act(async () => root.render(renderSnapshotCanvas()));
    expect(
      container
        .querySelector<HTMLIFrameElement>("iframe[data-design-preview-iframe]")
        ?.getAttribute("srcdoc"),
    ).toContain("Old snapshot");

    data = {
      ...data,
      html: null,
      updatedAt: null,
      publishedRevision: "5",
    };
    await act(async () => root.render(renderSnapshotCanvas()));

    expect(
      container.querySelector("iframe[data-design-preview-iframe]"),
    ).toBeNull();
    expect(
      container.querySelector("[data-design-live-canvas-waiting]"),
    ).not.toBeNull();
    expect(container.innerHTML).not.toContain("Old snapshot");
    expect(container.innerHTML).not.toContain("localhost:5173");
  });

  it("polls shared snapshots only while focused and refetches on activation", async () => {
    const refetch = vi.fn().mockResolvedValue({ data: undefined });
    useActionQueryMock.mockReturnValue({ data: undefined, refetch });

    const renderSnapshotCanvas = (active: boolean) => (
      <DesignCanvas
        content="http://localhost:5173/account"
        contentKey="screen-account"
        screenId="screen-account"
        designId="design-one"
        sourceType="localhost"
        snapshotOnly
        sharedSnapshotPollActive={active}
        zoom={100}
        deviceFrame="none"
        editMode
        interactMode={false}
        onElementSelect={() => {}}
        onElementHover={() => {}}
        tweakValues={{}}
      />
    );
    const latestSnapshotQueryOptions = () => {
      const calls = useActionQueryMock.mock.calls.filter(
        ([action]) => action === "get-visual-edit-snapshot",
      );
      const call = calls[calls.length - 1];
      return call?.[2];
    };

    await act(async () => {
      root.render(renderSnapshotCanvas(false));
    });

    expect(latestSnapshotQueryOptions()).toMatchObject({
      refetchInterval: false,
    });
    expect(refetch).not.toHaveBeenCalled();

    await act(async () => {
      root.render(renderSnapshotCanvas(true));
    });

    expect(latestSnapshotQueryOptions()).toMatchObject({
      refetchInterval: 2_000,
    });
    expect(refetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(renderSnapshotCanvas(true));
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("waits for registration without mounting srcdoc, then mounts one real live iframe", async () => {
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
    const onBootReady = vi.fn();
    const onRoutePathChange = vi.fn();
    let resolveRegistration!: (response: Response) => void;
    const registration = new Promise<Response>((resolve) => {
      resolveRegistration = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => registration),
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          bridgeUrl={bridgeUrl}
          previewToken="registration-preview-token"
          liveEditCapability="test-live-edit-capability"
          onBootReady={onBootReady}
          onRoutePathChange={onRoutePathChange}
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

    expect(
      container.querySelector("iframe[data-design-preview-iframe]"),
    ).toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain("srcdoc");
    expect(container.textContent).toContain("Preparing live editor");

    resolveRegistration(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "iframe[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const liveIframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );
    expect(liveIframe?.hasAttribute("srcdoc")).toBe(false);
    // A successful registration is not enough to release the running app: the
    // cross-origin document must prove that the injected editor bridge booted.
    expect(liveIframe?.style.pointerEvents).toBe("none");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/account",
            documentId: "document-account",
          },
          origin: bridgeUrl,
          source: liveIframe?.contentWindow,
        }),
      );
    });
    expect(onBootReady).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Preparing live editor");
    expect(liveIframe?.style.pointerEvents).toBe("");

    await act(async () => {
      liveIframe?.dispatchEvent(new Event("load"));
    });
    expect(onBootReady).toHaveBeenCalledTimes(1);
    expect(container.querySelector("iframe[data-design-preview-iframe]")).toBe(
      liveIframe,
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          previewUrlOverride="http://localhost:5173/settings"
          bridgeUrl={bridgeUrl}
          previewToken="registration-preview-token"
          liveEditCapability="test-live-edit-capability"
          onBootReady={onBootReady}
          onRoutePathChange={onRoutePathChange}
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
      const currentUrl = new URL(liveIframe!.src);
      expect(currentUrl.searchParams.get("url")).toBe(
        "http://localhost:5173/settings",
      );
    });
    expect(container.querySelector("iframe[data-design-preview-iframe]")).toBe(
      liveIframe,
    );
    expect(liveIframe?.style.pointerEvents).toBe("none");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/account",
            documentId: "document-account",
          },
          origin: bridgeUrl,
          source: liveIframe?.contentWindow,
        }),
      );
    });
    expect(onBootReady).toHaveBeenCalledTimes(1);
    expect(liveIframe?.style.pointerEvents).toBe("none");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/settings",
            documentId: "document-settings",
          },
          origin: bridgeUrl,
          source: liveIframe?.contentWindow,
        }),
      );
    });
    expect(onBootReady).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Preparing live editor");
    expect(liveIframe?.style.pointerEvents).toBe("");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/profile",
            documentId: "document-profile",
          },
          origin: bridgeUrl,
          source: liveIframe?.contentWindow,
        }),
      );
    });
    expect(onRoutePathChange).toHaveBeenLastCalledWith(
      "screen-account",
      "/profile",
    );
    expect(container.textContent).toContain("Preparing live editor");
    expect(liveIframe?.style.pointerEvents).toBe("none");

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          previewUrlOverride="http://localhost:5173/profile"
          bridgeUrl={bridgeUrl}
          previewToken="registration-preview-token"
          liveEditCapability="test-live-edit-capability"
          onBootReady={onBootReady}
          onRoutePathChange={onRoutePathChange}
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
      const currentUrl = new URL(liveIframe!.src);
      expect(currentUrl.searchParams.get("url")).toBe(
        "http://localhost:5173/profile",
      );
    });
    expect(container.querySelector("iframe[data-design-preview-iframe]")).toBe(
      liveIframe,
    );
    expect(container.textContent).not.toContain("Preparing live editor");
    expect(liveIframe?.style.pointerEvents).toBe("");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:editor-chrome-ready",
            routePath: "/settings",
            documentId: "document-settings",
          },
          origin: bridgeUrl,
          source: liveIframe?.contentWindow,
        }),
      );
    });
    expect(onRoutePathChange).toHaveBeenCalledTimes(3);
    expect(container.textContent).not.toContain("Preparing live editor");
    expect(liveIframe?.style.pointerEvents).toBe("");

    const postMessage = vi.spyOn(liveIframe!.contentWindow!, "postMessage");
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            type: "agent-native:live-route-path",
            routePath: "/designer",
          },
          origin: bridgeUrl,
          source: liveIframe?.contentWindow,
        }),
      );
    });
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        { type: "request-runtime-layer-snapshot" },
        "*",
      );
    });
    expect(onRoutePathChange).toHaveBeenLastCalledWith(
      "screen-account",
      "/designer",
    );
  });

  it("stops retrying a stale bridge token and tells the user to reconnect the screen", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestInfoUrl(input);
      if (url.endsWith("/live-edit-bridge") || url.includes("/snapshot?")) {
        return Promise.resolve(new Response("Unauthorized", { status: 401 }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken="stale-preview-token"
          liveEditCapability="test-live-edit-capability"
          onExternalContentSnapshot={() => {}}
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
        fetchMock.mock.calls.filter(([input]) =>
          requestInfoUrl(input).endsWith("/live-edit-bridge"),
        ),
      ).toHaveLength(1);
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          requestInfoUrl(input).includes("/snapshot?"),
        ),
      ).toHaveLength(1);
      expect(container.textContent).toContain("Reconnect this screen");
    });
    expect(
      container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      )?.style.pointerEvents,
    ).toBe("none");
    expect(container.textContent).toContain(
      "Live editing is waiting for a connection",
    );

    await new Promise((resolve) => window.setTimeout(resolve, 1800));
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        requestInfoUrl(input).endsWith("/live-edit-bridge"),
      ),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        requestInfoUrl(input).includes("/snapshot?"),
      ),
    ).toHaveLength(1);
  });

  it("shields a live app when bridge registration returns a conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = requestInfoUrl(input);
        if (url.endsWith("/live-edit-bridge")) {
          return Promise.resolve(
            new Response("Bridge key is not ready", { status: 409 }),
          );
        }
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }),
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/library"
          contentKey="screen-library"
          screenId="screen-library"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken="preview-token"
          liveEditCapability="test-live-edit-capability"
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
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.style.pointerEvents).toBe("none");
      expect(container.textContent).toContain(
        "The running app is shielded until Design connects to the local bridge.",
      );
    });
  });

  it("refreshes a stale public preview token after a bridge restart", async () => {
    let registrationCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = requestInfoUrl(input);
      if (!url.endsWith("/live-edit-bridge")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }
      registrationCount += 1;
      return Promise.resolve(
        registrationCount === 1
          ? new Response("Unauthorized", { status: 401 })
          : new Response(
              JSON.stringify({ ok: true, bridgeInstanceId: "restarted" }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    callActionMock.mockResolvedValue({
      previewToken: "fresh-preview-token",
      liveEditRegistrationCapability: "fresh-registration-capability",
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <DesignCanvas
            content="http://localhost:5173/library"
            contentKey="screen-library"
            screenId="screen-library"
            sourceType="localhost"
            bridgeUrl="http://127.0.0.1:7331"
            connectionId="localhost_connection"
            designId="design_public"
            publicVisualEdit
            previewToken="stale-preview-token"
            liveEditRegistrationCapability="test-registration-capability"
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(callActionMock).toHaveBeenCalledWith(
        "refresh-localhost-preview-token",
        {
          designId: "design_public",
          connectionId: "localhost_connection",
          publicVisualEdit: true,
        },
        { method: "GET" },
      );
      expect(registrationCount).toBeGreaterThanOrEqual(2);
    });
    const registrationCalls = fetchMock.mock.calls.filter(([input]) =>
      requestInfoUrl(input).endsWith("/live-edit-bridge"),
    );
    expect(
      (registrationCalls[1]?.[1]?.headers as Record<string, string>)[
        "x-design-preview-token"
      ],
    ).toBe("fresh-preview-token");
    expect(
      (registrationCalls[1]?.[1]?.headers as Record<string, string>)[
        "x-agent-native-live-edit-registration-capability"
      ],
    ).toBe("fresh-registration-capability");
  });

  it("re-registers when refresh returns the same deterministic preview token", async () => {
    let registrationCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = requestInfoUrl(input);
      if (!url.endsWith("/live-edit-bridge")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }
      registrationCount += 1;
      return Promise.resolve(
        registrationCount === 1
          ? new Response("Unauthorized", { status: 401 })
          : new Response(
              JSON.stringify({ ok: true, bridgeInstanceId: "restarted" }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              },
            ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    callActionMock.mockResolvedValue({
      previewToken: "same-preview-token",
      liveEditRegistrationCapability: "fresh-registration-capability",
    });

    await act(async () => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <DesignCanvas
            content="http://localhost:5173/library"
            contentKey="screen-library"
            screenId="screen-library"
            sourceType="localhost"
            bridgeUrl="http://127.0.0.1:7331"
            connectionId="localhost_connection"
            designId="design_public"
            publicVisualEdit
            previewToken="same-preview-token"
            liveEditRegistrationCapability="old-registration-capability"
            zoom={100}
            deviceFrame="none"
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />
        </QueryClientProvider>,
      );
    });

    await vi.waitFor(() => {
      expect(registrationCount).toBe(2);
    });
    const registrationCalls = fetchMock.mock.calls.filter(([input]) =>
      requestInfoUrl(input).endsWith("/live-edit-bridge"),
    );
    expect(
      (registrationCalls[1]?.[1]?.headers as Record<string, string>)[
        "x-design-preview-token"
      ],
    ).toBe("same-preview-token");
  });

  it("keeps a failed-bridge Interact preview interactive", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestInfoUrl(input);
      if (url.endsWith("/live-edit-bridge") || url.includes("/snapshot?")) {
        return Promise.resolve(new Response("Unauthorized", { status: 401 }));
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken="stale-preview-token"
          liveEditCapability="test-live-edit-capability"
          onExternalContentSnapshot={() => {}}
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(container.textContent).toContain("Reconnect this screen");
    });
    expect(
      container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      )?.style.pointerEvents,
    ).toBe("");
  });

  it("allows Chrome local-network access on the raw localhost fallback", async () => {
    expect(
      getDesignCanvasIframeAllow("https://design.agent-native.com/app"),
    ).toBe(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken="permission-preview-token"
          liveEditCapability="test-live-edit-capability"
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
      const iframe = container.querySelector<HTMLIFrameElement>(
        "iframe[data-design-preview-iframe]",
      );
      expect(iframe?.src).toBe("http://localhost:5173/account");
      expect(iframe?.getAttribute("allow")).toBe("local-network-access");
    });
  });

  it("asks for local-network permission before leaving the live editor read-only", async () => {
    vi.stubGlobal("navigator", {
      permissions: {
        query: vi.fn().mockResolvedValue({ state: "prompt" }),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/account"
          contentKey="screen-account"
          screenId="screen-account"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken="permission-preview-token"
          liveEditCapability="test-live-edit-capability"
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
      expect(document.body.textContent).toContain("Connect your local screens");
      expect(document.body.textContent).not.toContain(
        "Can't reach your local dev server",
      );
    });
    expect(await getLocalNetworkAccessPermissionState()).toBe("prompt");
  });

  it("mounts source verification in a separate hidden runtime without replacing the editable iframe", async () => {
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
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestInfoUrl(input);
      if (!url.endsWith("/live-edit-bridge")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const render = async (requestId: number | null) => {
      await act(async () => {
        root.render(
          <DesignCanvas
            content="http://localhost:5173/account"
            contentKey="screen-account"
            screenId="screen-account"
            sourceType="localhost"
            bridgeUrl={bridgeUrl}
            previewToken="verification-preview-token"
            liveEditCapability="test-live-edit-capability"
            runtimeVerificationRequest={
              requestId === null ? null : { requestId }
            }
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
    const editableIframe = container.querySelector<HTMLIFrameElement>(
      "iframe[data-design-preview-iframe]",
    );

    await render(1);
    const firstVerification = container.querySelector<HTMLIFrameElement>(
      "iframe[data-runtime-verification-iframe]",
    );
    expect(firstVerification).not.toBeNull();
    expect(firstVerification).not.toBe(editableIframe);
    expect(firstVerification?.src).toBe(editableIframe?.src);
    expect(firstVerification?.getAttribute("data-screen-iframe-id")).toBeNull();
    expect(container.querySelector("iframe[data-design-preview-iframe]")).toBe(
      editableIframe,
    );

    await render(2);
    const secondVerification = container.querySelector<HTMLIFrameElement>(
      "iframe[data-runtime-verification-iframe]",
    );
    expect(secondVerification).not.toBe(firstVerification);
    expect(container.querySelector("iframe[data-design-preview-iframe]")).toBe(
      editableIframe,
    );
  });

  it("hands a successful overview registration to Full view without a placeholder reload or URL-only frame", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Live chat</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    const previewUrl = "http://localhost:5173/chat";
    let resolveSecondRegistration!: (response: Response) => void;
    const secondRegistration = new Promise<Response>((resolve) => {
      resolveSecondRegistration = resolve;
    });
    let registrationCount = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestInfoUrl(input);
      if (!url.endsWith("/live-edit-bridge")) {
        return Promise.reject(new Error(`Unexpected fetch: ${url}`));
      }
      registrationCount += 1;
      if (registrationCount === 1) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, bridgeInstanceId: "instance-1" }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return secondRegistration;
    });
    vi.stubGlobal("fetch", fetchMock);

    const renderCanvas = async (overview: boolean) => {
      await act(async () => {
        root.render(
          <DesignCanvas
            content={previewUrl}
            contentKey="screen-chat"
            screenId="screen-chat"
            sourceType="localhost"
            bridgeUrl={bridgeUrl}
            previewToken="handoff-preview-token"
            liveEditCapability="test-live-edit-capability"
            externalSnapshotHtml="<!doctype html><html><body><main>Chat preview</main></body></html>"
            zoom={100}
            deviceFrame="none"
            embeddedFrame={
              overview
                ? {
                    viewportWidth: 390,
                    viewportHeight: 844,
                    displayWidth: 390,
                    displayHeight: 844,
                  }
                : undefined
            }
            editMode
            interactMode={false}
            onElementSelect={() => {}}
            onElementHover={() => {}}
            tweakValues={{}}
          />,
        );
      });
    };

    await renderCanvas(true);
    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });

    await act(async () => root.unmount());
    root = createRoot(container);
    await renderCanvas(false);

    // The second registration is deliberately unresolved. Full view must
    // still mount the one real live-edit URL immediately from the successful
    // overview handoff, never an empty srcdoc that is replaced later.
    const focusedIframe = container.querySelector<HTMLIFrameElement>(
      "[data-design-preview-iframe]",
    );
    expect(focusedIframe?.getAttribute("src")).toContain("/live-edit?");
    expect(focusedIframe?.getAttribute("srcdoc")).toBeNull();
    // No frozen copy is ever painted over the live frame, not even mid-swap:
    // a snapshot that outlives a stalled swap is indistinguishable from a
    // working screen.
    expect(
      container.querySelector("[data-live-edit-transition-fallback]"),
    ).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready" },
          origin: bridgeUrl,
          source: focusedIframe?.contentWindow,
        }),
      );
    });
    expect(
      container.querySelector("[data-live-edit-transition-fallback]"),
    ).toBeNull();
    expect(container.querySelector("[data-design-preview-iframe]")).toBe(
      focusedIframe,
    );

    // A source write that forces a Vite full reload must keep the SAME live
    // iframe (no remount, no state loss) and must not cover it with a
    // snapshot while the replacement bridge comes back.
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:runtime-reloading" },
          origin: bridgeUrl,
          source: focusedIframe?.contentWindow,
        }),
      );
    });
    expect(
      container.querySelector("[data-live-edit-transition-fallback]"),
    ).toBeNull();
    expect(container.querySelector("[data-design-preview-iframe]")).toBe(
      focusedIframe,
    );
    expect(
      container
        .querySelector<HTMLIFrameElement>("[data-design-preview-iframe]")
        ?.getAttribute("src"),
    ).toContain("/live-edit?");

    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agent-native:editor-chrome-ready" },
          origin: bridgeUrl,
          source: focusedIframe?.contentWindow,
        }),
      );
    });
    expect(
      container.querySelector("[data-live-edit-transition-fallback]"),
    ).toBeNull();

    resolveSecondRegistration(
      new Response(
        JSON.stringify({ ok: true, bridgeInstanceId: "instance-1" }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  });

  it("hydrates source HTML in parallel without replacing the keyed live iframe", async () => {
    iframeServer = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body>Live preview</body></html>");
    });
    const iframePort = await new Promise<number>((resolve, reject) => {
      iframeServer!.once("error", reject);
      iframeServer!.listen(0, "127.0.0.1", () => {
        const address = iframeServer!.address();
        resolve(typeof address === "object" && address ? address.port : 0);
      });
    });
    const bridgeUrl = `http://127.0.0.1:${iframePort}`;
    let resolveSnapshot!: (response: Response) => void;
    const snapshotResponse = new Promise<Response>((resolve) => {
      resolveSnapshot = resolve;
    });
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = requestInfoUrl(input);
      if (url.endsWith("/live-edit-bridge")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/snapshot?")) return snapshotResponse;
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);
    const onExternalContentSnapshot = vi.fn();

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/settings"
          contentKey="screen-settings"
          screenId="screen-settings"
          sourceType="localhost"
          bridgeUrl={bridgeUrl}
          previewToken="example-preview-token"
          liveEditCapability="test-live-edit-capability"
          zoom={100}
          deviceFrame="none"
          editMode
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
          onExternalContentSnapshot={onExternalContentSnapshot}
        />,
      );
    });

    await vi.waitFor(() => {
      expect(
        container.querySelector<HTMLIFrameElement>(
          "[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const liveIframe = container.querySelector<HTMLIFrameElement>(
      "[data-design-preview-iframe]",
    );
    const liveSrc = liveIframe?.src;
    expect(liveSrc).toContain("previewToken=example-preview-token");
    expect(liveSrc).toContain("bridgeKey=");

    resolveSnapshot(
      new Response(
        JSON.stringify({
          ok: true,
          url: "http://localhost:5173/settings",
          status: 200,
          contentType: "text/html; charset=utf-8",
          html: `<!doctype html><html><head>
            <script type="module" src="/@vite/client"></script>
            <script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);</script>
          </head><body><main>Settings source</main><script type="module" src="/src/main.tsx"></script></body></html>`,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    await vi.waitFor(() => {
      expect(onExternalContentSnapshot).toHaveBeenCalledTimes(1);
    });
    expect(onExternalContentSnapshot.mock.calls[0]?.[0].html).toContain(
      "Settings source",
    );
    expect(onExternalContentSnapshot.mock.calls[0]?.[0].html).not.toContain(
      "/@vite/client",
    );
    expect(onExternalContentSnapshot.mock.calls[0]?.[0].html).not.toContain(
      "/@react-refresh",
    );
    expect(onExternalContentSnapshot.mock.calls[0]?.[0].html).toContain(
      "/src/main.tsx",
    );
    const iframeAfterSnapshot = container.querySelector<HTMLIFrameElement>(
      "[data-design-preview-iframe]",
    );
    expect(iframeAfterSnapshot).toBe(liveIframe);
    expect(iframeAfterSnapshot?.src).toBe(liveSrc);

    const registrationCall = fetchMock.mock.calls.find(([input]) =>
      requestInfoUrl(input).endsWith("/live-edit-bridge"),
    );
    const registrationHeaders = registrationCall?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(registrationHeaders?.["x-design-preview-token"]).toBe(
      "example-preview-token",
    );
    const snapshotCall = fetchMock.mock.calls.find(([input]) =>
      requestInfoUrl(input).includes("/snapshot?"),
    );
    const snapshotHeaders = snapshotCall?.[1]?.headers as
      | Record<string, string>
      | undefined;
    expect(snapshotHeaders?.["x-design-preview-token"]).toBe(
      "example-preview-token",
    );
  });
});

describe("DesignCanvas localhost screens never render a source snapshot", () => {
  // A viewer without a previewToken (public link, signed-out session, an inline
  // browser with no cookies) used to get `externalSnapshotHtml` as srcdoc: a
  // frozen copy that looks exactly like the running app but has no live DOM
  // behind it, so selection, layers, and edits all silently addressed a corpse.
  it("loads the dev-server URL live when the viewer has no bridge entitlement", async () => {
    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/settings"
          contentKey="screen-settings"
          screenId="screen-settings"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken={undefined}
          externalSnapshotHtml="<!doctype html><html><body>Frozen snapshot</body></html>"
          zoom={100}
          deviceFrame="none"
          editMode={false}
          readOnly
          interactMode={false}
          onElementSelect={() => {}}
          onElementHover={() => {}}
          tweakValues={{}}
        />,
      );
    });

    const iframe = container.querySelector<HTMLIFrameElement>(
      "[data-design-preview-iframe]",
    );
    expect(iframe?.getAttribute("src")).toBe("http://localhost:5173/settings");
    expect(iframe?.hasAttribute("srcdoc")).toBe(false);
    expect(container.innerHTML).not.toContain("Frozen snapshot");
  });

  it("blocks an editable localhost URL until its bridge credential is available", async () => {
    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/settings"
          contentKey="screen-settings"
          screenId="screen-settings"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken={undefined}
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
      "[data-design-preview-iframe]",
    );
    expect(iframe?.src).toBe("http://localhost:5173/settings");
    expect(iframe?.style.pointerEvents).toBe("none");
    expect(container.textContent).toContain("Preparing live editor");
  });

  it("keeps an entitled viewer on the proxied document instead of the snapshot", async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestInfoUrl(input);
      if (url.endsWith("/live-edit-bridge")) {
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <DesignCanvas
          content="http://localhost:5173/settings"
          contentKey="screen-settings"
          screenId="screen-settings"
          sourceType="localhost"
          bridgeUrl="http://127.0.0.1:7331"
          previewToken="example-preview-token"
          liveEditCapability="test-live-edit-capability"
          externalSnapshotHtml="<!doctype html><html><body>Frozen snapshot</body></html>"
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
          "[data-design-preview-iframe]",
        )?.src,
      ).toContain("/live-edit?");
    });
    const iframe = container.querySelector<HTMLIFrameElement>(
      "[data-design-preview-iframe]",
    );
    expect(iframe?.hasAttribute("srcdoc")).toBe(false);
    // The transition fallback may briefly paint the snapshot, but only as an
    // inert aria-hidden layer — never as the editable document.
    expect(iframe?.getAttribute("srcdoc") ?? "").not.toContain(
      "Frozen snapshot",
    );
  });
});
