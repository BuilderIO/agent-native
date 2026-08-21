import { afterEach, describe, expect, it, vi } from "vitest";

const isBlockedExtensionUrlWithDns = vi.hoisted(() => vi.fn(async () => false));
const ssrfSafeFetch = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch,
}));

const { renderWithPlaywright } = await import("./rendered-page.js");

describe("renderWithPlaywright lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
    ssrfSafeFetch.mockReset();
  });

  it("closes isolated contexts and reports bounded stabilization failures", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let evaluateCalls = 0;
    let browserCaptureExpression: string | undefined;
    const page = {
      async route() {},
      async goto() {},
      async waitForLoadState(state: string) {
        throw new Error(`${state} timed out`);
      },
      async title() {
        return "Example";
      },
      url() {
        return "https://example.com/";
      },
      locator() {
        return { innerText: async () => "Example content" };
      },
      async setViewportSize() {},
      async screenshot() {
        return new Uint8Array([1]);
      },
      async evaluate(pageFunction: string | (() => unknown)) {
        evaluateCalls += 1;
        if (typeof pageFunction === "string") {
          browserCaptureExpression = pageFunction;
        }
        if (evaluateCalls === 1) return new Promise(() => {});
        if (evaluateCalls === 2) return undefined;
        throw new Error("computed styles unavailable");
      },
    };
    const context = {
      pages: () => [],
      newPage: async () => page,
      async close() {
        events.push("context.close");
      },
    };
    const browser = {
      contexts: () => [],
      async newContext() {
        events.push("context.new");
        return context;
      },
      async close() {
        events.push("browser.close");
      },
    };
    const renderPromise = renderWithPlaywright(
      {
        chromium: {
          async launch() {
            return browser;
          },
          async connectOverCDP() {
            return browser;
          },
        },
      } as never,
      { url: "https://example.com/", timeoutMs: 1_000 },
      [],
      "local-playwright",
    );

    await vi.advanceTimersByTimeAsync(1_200);
    const result = await renderPromise;

    expect(events).toEqual(["context.new", "context.close", "browser.close"]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "Browser load stabilization unavailable: load timed out",
        "Browser network-idle stabilization unavailable: networkidle timed out",
        "Browser font readiness unavailable: font readiness timed out after 1000ms",
        "Browser style extraction unavailable: computed styles unavailable",
      ]),
    );
    expect(result.diagnostics).toEqual(expect.arrayContaining(result.warnings));
    expect(browserCaptureExpression).toContain(
      "const __name = (value) => value",
    );
    expect(browserCaptureExpression).toContain("captureRenderedWebsiteContext");
  });

  it("hydrates through the SSRF-safe network proxy without forwarding cookies", async () => {
    ssrfSafeFetch
      .mockResolvedValueOnce(
        new Response(
          "<!doctype html><html><head><title>Proxy example</title></head><body>Hydrated CTA</body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(".cta{color:rgb(13 20 27)}", {
          status: 200,
          headers: { "content-type": "text/css" },
        }),
      );

    let routeHandler:
      | ((route: {
          request: () => {
            url: () => string;
            isNavigationRequest: () => boolean;
            resourceType: () => string;
            method: () => string;
            headers: () => Record<string, string>;
          };
          continue: () => Promise<void>;
          abort: () => Promise<void>;
          fulfill: (options: {
            status: number;
            headers: Record<string, string>;
            body: Uint8Array;
          }) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    const fulfilled: Array<{
      status: number;
      headers: Record<string, string>;
      body: Uint8Array;
    }> = [];

    const invokeRoute = async (
      url: string,
      navigation: boolean,
      type: string,
    ) => {
      if (!routeHandler) throw new Error("route handler was not installed");
      await routeHandler({
        request: () => ({
          url: () => url,
          isNavigationRequest: () => navigation,
          resourceType: () => type,
          method: () => "GET",
          headers: () => ({
            accept: "text/html",
            cookie: "session=must-not-forward",
            "user-agent": "fixture-browser",
          }),
        }),
        continue: async () => undefined,
        abort: async () => undefined,
        fulfill: async (options) => {
          fulfilled.push(options);
        },
      });
    };

    let evaluateCalls = 0;
    const page = {
      async route(_pattern: string, handler: (route: never) => Promise<void>) {
        routeHandler = handler as typeof routeHandler;
      },
      async goto() {
        await invokeRoute("https://example.com/", true, "document");
        await invokeRoute(
          "https://example.com/styles.css",
          false,
          "stylesheet",
        );
      },
      async waitForLoadState() {},
      async title() {
        return "Proxy example";
      },
      url() {
        return "https://example.com/";
      },
      locator() {
        return { innerText: async () => "Hydrated CTA" };
      },
      async setViewportSize() {},
      async screenshot() {
        return new Uint8Array([1]);
      },
      async evaluate<T>() {
        evaluateCalls += 1;
        if (evaluateCalls === 3) {
          return {
            title: "Proxy example",
            text: "Hydrated CTA",
            assets: [],
            internalLinks: [],
            designTokens: {
              colors: ["rgb(13 20 27)"],
              typography: [],
              spacing: [],
              radii: [],
              cssVariables: {},
            },
          } as T;
        }
        return undefined as T;
      },
    };
    const context = {
      async newPage() {
        return page;
      },
      async close() {},
    };
    const browser = {
      contexts: () => [],
      async newContext() {
        return context;
      },
      async close() {},
    };

    const result = await renderWithPlaywright(
      {
        chromium: {
          async launch() {
            return browser;
          },
          async connectOverCDP() {
            return browser;
          },
        },
      } as never,
      { url: "https://example.com/", timeoutMs: 5_000 },
      [],
      "local-playwright",
    );

    expect(result).toMatchObject({
      rendered: true,
      method: "local-playwright",
      text: "Hydrated CTA",
    });
    expect(fulfilled).toHaveLength(2);
    expect(new TextDecoder().decode(fulfilled[0].body)).toContain(
      "Proxy example",
    );
    expect(ssrfSafeFetch).toHaveBeenCalledTimes(2);
    expect(ssrfSafeFetch.mock.calls[0][1].headers).toEqual({
      accept: "text/html",
      "user-agent": "fixture-browser",
    });
  });

  it("reserves browser resource slots before overlapping proxy fetches", async () => {
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    let fetchCount = 0;
    ssrfSafeFetch.mockImplementation(async () => {
      fetchCount += 1;
      await fetchGate;
      return new Response("resource", { status: 200 });
    });

    let routeHandler:
      | ((route: {
          request: () => {
            url: () => string;
            isNavigationRequest: () => boolean;
            resourceType: () => string;
            method: () => string;
            headers: () => Record<string, string>;
          };
          continue: () => Promise<void>;
          abort: (reason?: string) => Promise<void>;
          fulfill: (options: {
            status: number;
            headers: Record<string, string>;
            body: Uint8Array;
          }) => Promise<void>;
        }) => Promise<void>)
      | undefined;
    let abortCount = 0;

    const page = {
      async route(_pattern: string, handler: (route: never) => Promise<void>) {
        routeHandler = handler as typeof routeHandler;
      },
      async goto() {
        if (!routeHandler) throw new Error("route handler was not installed");
        const requests = Array.from({ length: 401 }, (_, index) =>
          routeHandler!({
            request: () => ({
              url: () => `https://example.com/resource-${index}`,
              isNavigationRequest: () => index === 0,
              resourceType: () => "script",
              method: () => "GET",
              headers: () => ({}),
            }),
            continue: async () => undefined,
            abort: async () => {
              abortCount += 1;
            },
            fulfill: async () => undefined,
          }),
        );
        while (fetchCount < 400) await Promise.resolve();
        releaseFetch();
        await Promise.all(requests);
      },
      async waitForLoadState() {},
      async title() {
        return "Example";
      },
      url() {
        return "https://example.com/";
      },
      locator() {
        return { innerText: async () => "Example" };
      },
      async setViewportSize() {},
      async screenshot() {
        return new Uint8Array([1]);
      },
      async evaluate<T>() {
        return {
          title: "Example",
          text: "Example",
          assets: [],
          internalLinks: [],
          designTokens: {
            colors: [],
            typography: [],
            spacing: [],
            radii: [],
            cssVariables: {},
          },
        } as T;
      },
    };
    const context = {
      pages: () => [],
      async newPage() {
        return page;
      },
      async close() {},
    };
    const browser = {
      contexts: () => [],
      async newContext() {
        return context;
      },
      async close() {},
    };

    const result = await renderWithPlaywright(
      {
        chromium: {
          async launch() {
            return browser;
          },
          async connectOverCDP() {
            return browser;
          },
        },
      } as never,
      { url: "https://example.com/", timeoutMs: 5_000 },
      [],
      "local-playwright",
    );

    expect(fetchCount).toBe(400);
    expect(abortCount).toBe(1);
    expect(result.warnings).toContain(
      "Browser resource budget reached (400 requests).",
    );
  });
});
