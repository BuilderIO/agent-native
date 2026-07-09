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
