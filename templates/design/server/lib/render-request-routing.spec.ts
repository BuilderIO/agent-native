import { describe, expect, it, vi } from "vitest";

import { routeAllowedRenderRequests } from "./design-to-figma-svg.js";

function fakeContext() {
  let handler: ((route: unknown) => Promise<void>) | undefined;
  const context = {
    route: async (_pattern: string, fn: typeof handler) => {
      handler = fn;
    },
  };
  return {
    context: context as unknown as import("@playwright/test").BrowserContext,
    run: (route: unknown) => {
      if (!handler) throw new Error("route handler not registered");
      return handler(route);
    },
  };
}

function fakeRoute(url: string, init: { method?: string; headers?: object }) {
  return {
    request: () => ({
      url: () => url,
      method: () => init.method ?? "GET",
      headers: () => init.headers ?? {},
      postDataBuffer: () => null,
      isNavigationRequest: () => false,
      frame: () => ({ parentFrame: () => null }),
    }),
    abort: vi.fn(async () => {}),
    fulfill: vi.fn(async () => {}),
    continue: vi.fn(async () => {}),
  };
}

describe("routeAllowedRenderRequests via ssrfSafeFetch", () => {
  it("refuses a hop to a private address and aborts the request", async () => {
    const { context, run } = fakeContext();
    const safeFetch = vi.fn(async (_url: string, _init: unknown, options) => {
      await options?.assertUrlAllowed?.("http://169.254.169.254/latest");
      return new Response("unreachable");
    });
    await routeAllowedRenderRequests(
      context,
      async (url) => !url.startsWith("http://169.254."),
      safeFetch as never,
    );
    const route = fakeRoute("https://example.com/img.png", {});
    await run(route);
    expect(safeFetch).toHaveBeenCalledTimes(1);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.fulfill).not.toHaveBeenCalled();
  });

  it("forwards method and headers without host and fulfils with the response", async () => {
    const { context, run } = fakeContext();
    const safeFetch = vi.fn(
      async () =>
        new Response("hello", {
          status: 201,
          headers: { "content-type": "text/plain" },
        }),
    );
    await routeAllowedRenderRequests(
      context,
      async () => true,
      safeFetch as never,
    );
    const route = fakeRoute("https://example.com/a", {
      method: "GET",
      headers: { host: "example.com", accept: "image/png" },
    });
    await run(route);
    const call = safeFetch.mock.calls[0] as unknown as [
      string,
      { method: string; headers: Headers },
    ];
    expect(call[1].method).toBe("GET");
    expect(call[1].headers.get("host")).toBeNull();
    expect(call[1].headers.get("accept")).toBe("image/png");
    expect(route.fulfill).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 201,
        headers: { "content-type": "text/plain" },
      }),
    );
  });

  it("refuses a private IP through the real ssrfSafeFetch", async () => {
    const { context, run } = fakeContext();
    await routeAllowedRenderRequests(context, async () => true);
    const route = fakeRoute("http://10.0.0.5/secret", {});
    await run(route);
    expect(route.abort).toHaveBeenCalledWith("blockedbyclient");
    expect(route.fulfill).not.toHaveBeenCalled();
  });
});
