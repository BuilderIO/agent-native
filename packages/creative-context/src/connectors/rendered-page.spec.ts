import { afterEach, describe, expect, it, vi } from "vitest";

const isBlockedExtensionUrlWithDns = vi.hoisted(() => vi.fn(async () => false));

vi.mock("@agent-native/core/extensions/url-safety", () => ({
  isBlockedExtensionUrlWithDns,
  ssrfSafeFetch: vi.fn(),
}));

const { renderWithPlaywright } = await import("./rendered-page.js");

describe("renderWithPlaywright lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes isolated contexts and reports bounded stabilization failures", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    let evaluateCalls = 0;
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
      async evaluate() {
        evaluateCalls += 1;
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
  });
});
