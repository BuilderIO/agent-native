// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentNativeRouteWarmup,
  __routeWarmupInternalsForTests,
} from "./route-warmup.js";

const WARMUP_SELECTOR = "link[data-agent-native-route-warmup]";

function setReadyState(value: DocumentReadyState) {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => value,
  });
}

describe("AgentNativeRouteWarmup", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    __routeWarmupInternalsForTests.resetRouteWarmupCachesForTests();
    document.head.innerHTML = "";
    document.body.innerHTML =
      '<a href="/screenshots" data-an-prefetch="render">Screenshots</a>';
    window.__reactRouterManifest = {
      routes: {
        root: { id: "root", path: "", module: "/assets/root-AbC123.js" },
        "routes/screenshots": {
          id: "routes/screenshots",
          parentId: "root",
          path: "screenshots",
          hasLoader: true,
          module: "/assets/screenshots-DeF456.js",
          imports: ["/assets/IconCamera-GhI789.js"],
        },
      },
    };
    fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([]);
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    delete (document as { readyState?: DocumentReadyState }).readyState;
    delete window.__reactRouterManifest;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function mount() {
    await act(async () => {
      root = createRoot(container);
      root.render(<AgentNativeRouteWarmup config={{ strategy: "render" }} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  function warmedModulePaths(): string[] {
    return Array.from(
      document.querySelectorAll<HTMLLinkElement>(WARMUP_SELECTOR),
    ).map((link) => new URL(link.href).pathname);
  }

  it("holds module preloads until WebKit's unused-preload check after load has run", async () => {
    setReadyState("complete");
    await mount();

    expect(warmedModulePaths()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/screenshots.data");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(warmedModulePaths()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(warmedModulePaths()).toEqual([
      "/assets/root-AbC123.js",
      "/assets/screenshots-DeF456.js",
      "/assets/IconCamera-GhI789.js",
    ]);
  });

  it("starts the hold at the load event when the page is still loading", async () => {
    setReadyState("loading");
    await mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
    });
    expect(warmedModulePaths()).toEqual([]);

    setReadyState("complete");
    await act(async () => {
      window.dispatchEvent(new Event("load"));
      await vi.advanceTimersByTimeAsync(3_999);
    });
    expect(warmedModulePaths()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(warmedModulePaths()).toHaveLength(3);
  });

  it("warms modules anyway when the load event never comes", async () => {
    setReadyState("loading");
    await mount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_999);
    });
    expect(warmedModulePaths()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(warmedModulePaths()).toHaveLength(3);
  });

  it("preloads at once when the load event ended long enough ago", async () => {
    setReadyState("complete");
    vi.spyOn(performance, "now").mockReturnValue(20_000);
    vi.spyOn(performance, "getEntriesByType").mockReturnValue([
      { loadEventEnd: 1_000 } as PerformanceNavigationTiming,
    ]);
    await mount();

    expect(warmedModulePaths()).toHaveLength(3);
  });

  it("holds hover warmup during the window too", async () => {
    setReadyState("complete");
    document.body.innerHTML = '<a href="/screenshots">Screenshots</a>';
    container = document.createElement("div");
    document.body.appendChild(container);
    await act(async () => {
      root = createRoot(container);
      root.render(<AgentNativeRouteWarmup config={{ strategy: "intent" }} />);
    });

    const link = document.querySelector("a")!;
    await act(async () => {
      link.dispatchEvent(new Event("pointerover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(warmedModulePaths()).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(warmedModulePaths()).toHaveLength(3);
  });

  it("drops the hold when it unmounts", async () => {
    setReadyState("complete");
    await mount();
    await act(async () => root?.unmount());
    root = null;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(warmedModulePaths()).toEqual([]);
  });
});
