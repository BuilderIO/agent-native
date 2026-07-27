// @vitest-environment happy-dom

import http, { type Server } from "node:http";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./DesignCanvas";

let container: HTMLDivElement;
let root: Root;
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

describe("DesignCanvas authenticated localhost source hydration", () => {
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
    const fallback = container.querySelector<HTMLIFrameElement>(
      "[data-live-edit-transition-fallback]",
    );
    expect(fallback?.getAttribute("srcdoc")).toContain("Chat preview");
    expect(fallback?.getAttribute("srcdoc")).not.toBe(previewUrl);

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

    // A source write that forces a Vite full reload must put the authenticated
    // snapshot back over the SAME iframe until its replacement bridge is
    // ready. This covers the unavoidable HMR navigation without a white flash.
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
      container
        .querySelector<HTMLIFrameElement>(
          "[data-live-edit-transition-fallback]",
        )
        ?.getAttribute("srcdoc"),
    ).toContain("Chat preview");
    expect(container.querySelector("[data-design-preview-iframe]")).toBe(
      focusedIframe,
    );

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
