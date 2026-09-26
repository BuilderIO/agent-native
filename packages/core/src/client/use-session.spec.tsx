// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  setSentryUser: vi.fn(),
  trackSessionStatus: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

import {
  notifySessionInvalidated,
  recheckSessionAfterUnauthorized,
  useSession,
} from "./use-session.js";

async function freshSessionModule() {
  vi.resetModules();
  return import("./use-session.js");
}

let container: HTMLDivElement;
let root: Root;
let now = 0;

function SessionConsumer({ label }: { label: string }) {
  const { session, isLoading } = useSession();
  return (
    <div data-testid={label}>
      {isLoading ? "loading" : (session?.email ?? "signed-out")}
    </div>
  );
}

function SessionConsumers({ labels }: { labels: string[] }) {
  return labels.map((label) => <SessionConsumer key={label} label={label} />);
}

function StatusConsumer() {
  const { status } = useSession();
  return <div data-testid="status">{status}</div>;
}

function RetryConsumer() {
  const { status, retry } = useSession();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <button type="button" onClick={retry}>
        Retry
      </button>
    </div>
  );
}

async function renderConsumers(labels: string[]) {
  await act(async () => {
    root.render(<SessionConsumers labels={labels} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  now += 60_001;
  vi.spyOn(Date, "now").mockReturnValue(now);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  notifySessionInvalidated();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("useSession", () => {
  it("shares one in-flight session request across mounted consumers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            userId: "user-1",
            email: "person@example.com",
            name: "Person",
            orgId: "org-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first", "second"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("person@example.comperson@example.com");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledTimes(1);
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(true);
  });

  it("reports the definitive session state to an embedding host", async () => {
    const postMessage = vi.fn();
    const parentWindow = { postMessage };
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentWindow,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agentNative.frameOrigin",
          origin: "https://host.example",
        },
        origin: "https://host.example",
        source: parentWindow as Window,
      }),
    );
    postMessage.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "signed out" })),
    );

    try {
      await renderConsumers(["embedded"]);

      expect(postMessage).toHaveBeenCalledWith(
        {
          type: "agentNative.authState",
          data: { status: "unauthenticated" },
        },
        "https://host.example",
      );
    } finally {
      if (parentDescriptor) {
        Object.defineProperty(window, "parent", parentDescriptor);
      }
    }
  });

  it("keeps loading and retries after a non-OK response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: "user-2",
            email: "recovered@example.com",
            name: "Recovered",
            orgId: "org-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SessionConsumers labels={["first"]} />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");
    expect(analyticsMocks.trackSessionStatus).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("recovered@example.com");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(true);
  });

  it("keeps loading and retries after a thrown fetch", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            userId: "user-3",
            email: "retry@example.com",
            name: "Retry",
            orgId: "org-3",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SessionConsumers labels={["first"]} />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("retry@example.com");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(true);
  });

  it("keeps retrying an instantly-failing endpoint for the whole time budget", async () => {
    vi.useFakeTimers();
    const failingFetch = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", failingFetch);

    await act(async () => {
      root.render(<StatusConsumer />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(container.textContent).toBe("loading");
    expect(failingFetch.mock.calls.length).toBeGreaterThan(4);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(container.textContent).toBe("unavailable");
    expect(analyticsMocks.trackSessionStatus).not.toHaveBeenCalled();
  });

  it("reports unavailable at the budget boundary, not after the request's own timeout", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount += 1;
      if (callCount < 9) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StatusConsumer />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });

    expect(container.textContent).toBe("unavailable");
  });

  it("issues a fresh request on retry instead of reusing the timed-out shared read", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn(() => {
      callCount += 1;
      if (callCount < 9) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }
      if (callCount === 9) return new Promise<Response>(() => {});
      return Promise.resolve(
        new Response(
          JSON.stringify({
            userId: "user-retry",
            email: "retry-fresh@example.com",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RetryConsumer />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(35_000);
    });

    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe(
      "authenticated",
    );
  });

  it("recovers on its own when a cold backend comes back mid-budget", async () => {
    vi.useFakeTimers();
    let elapsed = 0;
    const fetchMock = vi.fn(async () => {
      if (elapsed < 10_000) return new Response(null, { status: 503 });
      return new Response(
        JSON.stringify({
          userId: "user-cold-start",
          email: "cold-start@example.com",
          name: "Cold Start",
          orgId: "org-cold-start",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<StatusConsumer />);
      await Promise.resolve();
    });

    while (elapsed < 25_000 && container.textContent === "loading") {
      await act(async () => {
        elapsed += 500;
        await vi.advanceTimersByTimeAsync(500);
      });
    }

    expect(container.textContent).toBe("authenticated");
  });

  it("keeps legacy isLoading consumers from misreading unavailable as signed-out", async () => {
    vi.useFakeTimers();
    const failingFetch = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", failingFetch);

    await act(async () => {
      root.render(<SessionConsumers labels={["first"]} />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(failingFetch.mock.calls.length).toBeGreaterThan(4);
    expect(container.textContent).toBe("loading");
  });

  it("retries successfully after the unavailable notice is shown", async () => {
    vi.useFakeTimers();
    let recovered = false;
    const fetchMock = vi.fn(async () => {
      if (!recovered) return new Response(null, { status: 503 });
      return new Response(
        JSON.stringify({
          userId: "user-recovered",
          email: "retry-after-unavailable@example.com",
          name: "Recovered",
          orgId: "org-recovered",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RetryConsumer />);
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe(
      "unavailable",
    );

    recovered = true;
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="status"]')?.textContent).toBe(
      "authenticated",
    );
  });

  it("caches a definitive unauthenticated response", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "Not authenticated" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    await renderConsumers(["first", "second"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("signed-outsigned-out");
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledOnce();
    expect(analyticsMocks.trackSessionStatus).toHaveBeenCalledWith(false);
  });

  it("revalidates a cached session after logout invalidates it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          userId: "user-4",
          email: "logout@example.com",
          name: "Logout",
          orgId: "org-4",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Not authenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    expect(container.textContent).toBe("logout@example.com");

    await act(async () => {
      notifySessionInvalidated();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("signed-out");
  });

  it("revalidates a peer invalidation again after the session cache TTL", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          userId: "user-peer",
          email: "peer@example.com",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          userId: "user-peer",
          email: "peer@example.com",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Not authenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<SessionConsumers labels={["peer"]} />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("peer@example.com");

    await act(async () => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "agent-native:session-invalidated",
        }),
      );
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(container.textContent).toBe("signed-out");
  });

  it("reports signing-out instead of the last authenticated answer", async () => {
    const { beginSignOut: begin, useSession: useFreshSession } =
      await freshSessionModule();
    const statuses: string[] = [];
    function Probe() {
      statuses.push(useFreshSession().status);
      return null;
    }
    const fetchMock = vi.fn(async () =>
      jsonResponse({ userId: "user-9", email: "leaving@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(statuses.at(-1)).toBe("authenticated");

    statuses.length = 0;
    fetchMock.mockClear();
    await act(async () => {
      begin();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(statuses[0]).toBe("signing-out");
    expect(new Set(statuses)).toEqual(new Set(["signing-out"]));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("notifies a trusted embedding host only after sign-out succeeds", async () => {
    const { beginSignOut: begin, completeSignOut: complete } =
      await freshSessionModule();
    const postMessage = vi.fn();
    const parentWindow = { postMessage };
    const parentDescriptor = Object.getOwnPropertyDescriptor(window, "parent");
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: parentWindow,
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "agentNative.frameOrigin",
          origin: "https://host.example",
        },
        origin: "https://host.example",
        source: parentWindow as Window,
      }),
    );
    postMessage.mockClear();

    try {
      begin();
      expect(postMessage).not.toHaveBeenCalled();

      complete();

      expect(postMessage).toHaveBeenLastCalledWith(
        {
          type: "agentNative.authState",
          data: { status: "unauthenticated" },
        },
        "https://host.example",
      );
    } finally {
      if (parentDescriptor) {
        Object.defineProperty(window, "parent", parentDescriptor);
      }
    }
  });

  it("keeps signing-out terminal for the life of the document", async () => {
    const { beginSignOut: begin, useSession: useFreshSession } =
      await freshSessionModule();
    function Probe() {
      return <div data-testid="status">{useFreshSession().status}</div>;
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ userId: "user-10", email: "back@example.com" }),
      ),
    );

    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      begin();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("signing-out");
  });

  it("re-resolves the session after an authenticated request comes back 401", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ userId: "user-401", email: "stale@example.com" }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Not authenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    expect(container.textContent).toBe("stale@example.com");

    await act(async () => {
      recheckSessionAfterUnauthorized();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("signed-out");
  });

  it("throttles the 401 re-check so one failing screen cannot storm the session endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ userId: "user-storm", email: "storm@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      recheckSessionAfterUnauthorized();
      recheckSessionAfterUnauthorized();
      recheckSessionAfterUnauthorized();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ignores a 401 re-check once sign-out has started", async () => {
    const {
      beginSignOut: begin,
      recheckSessionAfterUnauthorized: recheck,
      useSession: useFreshSession,
    } = await freshSessionModule();
    function Probe() {
      return <div data-testid="status">{useFreshSession().status}</div>;
    }
    const fetchMock = vi.fn(async () =>
      jsonResponse({ userId: "user-out", email: "leaving@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      begin();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fetchMock.mockClear();

    await act(async () => {
      recheck();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("signing-out");
  });

  it("revalidates a cached session when the browser regains focus", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          userId: "user-5",
          email: "focus@example.com",
          name: "Focus",
          orgId: "org-5",
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "Not authenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    expect(container.textContent).toBe("focus@example.com");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("signed-out");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
