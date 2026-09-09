// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  isRateLimited,
  rateLimitCooldownRemainingMs,
  resetRateLimitSignalForTests,
} from "./rate-limit-signal.js";
import {
  AgentNativeRouteWarmup,
  __routeWarmupInternalsForTests,
} from "./route-warmup.js";

/**
 * Regression cover for the Slides 429 report: a stalled chat left the origin
 * throttled, and route warmup then retried every queued `.data` route on a
 * 500ms ladder, keeping the whole site — including plain deck page loads —
 * rate limited across reloads.
 */

/** Minimal production-shaped manifest with two warmable child routes. */
function installManifest(): void {
  window.__reactRouterManifest = {
    routes: {
      root: { id: "root", path: "/", module: "/assets/root-abc123.js" },
      "routes/deck": {
        id: "routes/deck",
        parentId: "root",
        path: "deck/:id",
        module: "/assets/deck-abc123.js",
      },
      "routes/decks": {
        id: "routes/decks",
        parentId: "root",
        path: "decks",
        module: "/assets/decks-abc123.js",
      },
    },
  } as unknown as typeof window.__reactRouterManifest;
}

function installLinks(hrefs: string[]): void {
  document.body.innerHTML = hrefs
    .map((href) => `<a href="${href}" data-prefetch="render">link</a>`)
    .join("");
}

let container: HTMLDivElement;
let root: Root | null = null;

function mountWarmup(): void {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(<AgentNativeRouteWarmup config={{ strategy: "render" }} />);
  });
}

describe("route warmup under a rate-limited origin", () => {
  beforeEach(() => {
    resetRateLimitSignalForTests();
    __routeWarmupInternalsForTests.resetRouteWarmupCachesForTests();
    document.body.innerHTML = "";
    // IntersectionObserver is absent in happy-dom; "render" strategy does not
    // need it, and the component already falls back to warming directly.
    installManifest();
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    root = null;
    vi.useRealTimers();
    resetRateLimitSignalForTests();
    __routeWarmupInternalsForTests.resetRouteWarmupCachesForTests();
    delete window.__reactRouterManifest;
    vi.unstubAllGlobals();
  });

  it("stops warming on a 429 instead of retrying it, and records the cooldown", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 429,
          headers: { "Retry-After": "60" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof window.fetch;

    installLinks(["/deck/abc", "/decks"]);
    mountWarmup();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    const callsAfterFirstPass = fetchMock.mock.calls.length;
    expect(callsAfterFirstPass).toBeGreaterThan(0);

    // The old ladder retried at 500ms, 1s and 2s per route. Run well past it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstPass);
    expect(isRateLimited()).toBe(true);
    // Retry-After: 60 was honored; the clock has since advanced ~5s.
    expect(rateLimitCooldownRemainingMs()).toBeGreaterThan(54_000);
    expect(rateLimitCooldownRemainingMs()).toBeLessThanOrEqual(60_000);
  });

  it("does not warm at all while a cooldown from a previous load is live", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof window.fetch;

    // Simulates the reload the reporter did: sessionStorage still holds the
    // deadline recorded on the previous load.
    window.sessionStorage.setItem(
      "agent-native:rate-limit-until",
      String(Date.now() + 60_000),
    );

    installLinks(["/deck/abc", "/decks"]);
    mountWarmup();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still retries a 5xx, which is a transient origin blip rather than a limit", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    window.fetch = fetchMock as unknown as typeof window.fetch;

    installLinks(["/deck/abc"]);
    mountWarmup();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const first = fetchMock.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(first);
    expect(isRateLimited()).toBe(false);
  });
});
