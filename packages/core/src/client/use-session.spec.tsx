// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const analyticsMocks = vi.hoisted(() => ({
  setSentryUser: vi.fn(),
  trackEvent: vi.fn(),
  trackSessionStatus: vi.fn(),
}));
vi.mock("./analytics.js", () => analyticsMocks);

import { fetchAuthSessionStatus } from "./client-status-requests.js";
import { FETCH_TRANSPORT_CHANGED_EVENT } from "./fetch-transport.js";
import {
  navigateForSession,
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
            authUserId: "canonical-user-1",
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
    expect(analyticsMocks.setSentryUser).toHaveBeenCalledWith(
      {
        id: "user-1",
        email: "person@example.com",
        username: "Person",
        authUserId: "canonical-user-1",
      },
      "org-1",
    );
  });

  it("publishes the server's test-identity flag with the session identity", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              userId: "user-qa",
              email: "lead@qa.acme.co",
              testIdentity: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await renderConsumers(["only"]);

    expect(analyticsMocks.setSentryUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "lead@qa.acme.co", testIdentity: true }),
      null,
    );
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
      vi.fn(async () => jsonResponse({ error: "Not authenticated" })),
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

  it("does not treat an unknown session error as signed out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: "Session unavailable" })),
    );

    await act(async () => {
      root.render(<StatusConsumer />);
      await Promise.resolve();
    });
    expect(container.textContent).toBe("loading");
    expect(analyticsMocks.trackSessionStatus).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(container.textContent).toBe("unavailable");
    expect(analyticsMocks.trackSessionStatus).not.toHaveBeenCalled();
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

  it("keeps a signed-in answer inside its lifetime when the browser regains focus", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ userId: "user-5", email: "focus@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    expect(container.textContent).toBe("focus@example.com");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    delete (document as { visibilityState?: string }).visibilityState;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("focus@example.com");
  });

  it("revalidates on focus once the signed-in answer outlives its lifetime", async () => {
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

    vi.spyOn(Date, "now").mockReturnValue(now + 30_001);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("signed-out");
  });

  it("re-reads a signed-out answer on focus, where signing in elsewhere shows up", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "Not authenticated" }))
      .mockResolvedValueOnce(
        jsonResponse({ userId: "user-6", email: "returned@example.com" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    expect(container.textContent).toBe("signed-out");

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe("returned@example.com");
  });

  describe("a focus inside the answer's lifetime", () => {
    async function focusThenExpire(options: { focusedAtExpiry: boolean }) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ userId: "user-a", email: "before@example.com" }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ userId: "user-b", email: "after@example.com" }),
        );
      vi.stubGlobal("fetch", fetchMock);
      const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });

      try {
        await renderConsumers(["first"]);
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        vi.spyOn(Date, "now").mockReturnValue(now + 10_000);
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);

        hasFocus.mockReturnValue(options.focusedAtExpiry);
        vi.spyOn(Date, "now").mockReturnValue(now + 30_000);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });
        return fetchMock;
      } finally {
        delete (document as { visibilityState?: string }).visibilityState;
      }
    }

    it("re-reads the answer when it expires while the tab still has focus", async () => {
      const fetchMock = await focusThenExpire({ focusedAtExpiry: true });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(container.textContent).toBe("after@example.com");
    });

    it("leaves a tab that lost focus to its next focus instead", async () => {
      const fetchMock = await focusThenExpire({ focusedAtExpiry: false });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(container.textContent).toBe("before@example.com");
    });
  });

  it("joins the read in flight when focus arrives before the first answer", async () => {
    let respond!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await renderConsumers(["first"]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      respond(jsonResponse({ userId: "user-7", email: "early@example.com" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("early@example.com");
  });
});

describe("one page-wide session answer", () => {
  it("shows a late-mounted consumer the page's answer instead of a signed-out loading state", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ userId: "user-late", email: "late@example.com" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderConsumers(["gate"]);
    expect(container.textContent).toBe("late@example.com");

    // A dialog or a remounted route mounts after the answer's lifetime.
    vi.spyOn(Date, "now").mockReturnValue(now + 45_000);
    const firstRenders: string[] = [];
    function LateConsumer() {
      const { session, status } = useSession();
      if (firstRenders.length === 0) {
        firstRenders.push(`${status}:${session?.email ?? "none"}`);
      }
      return null;
    }
    await act(async () => {
      root.render(
        <>
          <SessionConsumers labels={["gate"]} />
          <LateConsumer />
        </>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(firstRenders).toEqual(["authenticated:late@example.com"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps the definitive answer when a re-check cannot reach the server", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ userId: "user-kept", email: "kept@example.com" }),
      )
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await renderConsumers(["gate"]);
    expect(container.textContent).toBe("kept@example.com");

    vi.useFakeTimers();
    await act(async () => {
      recheckSessionAfterUnauthorized();
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(fetchMock.mock.calls.length).toBeGreaterThan(2);
    expect(container.textContent).toBe("kept@example.com");
  });

  it("treats a 401 from the session endpoint as signed out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    );
    await act(async () => {
      root.render(<StatusConsumer />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toBe("unauthenticated");
  });

  it("never reads a 403 from the session endpoint as signed out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    );
    await act(async () => {
      root.render(<StatusConsumer />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });

    expect(container.textContent).toBe("unavailable");
  });
});

describe("session navigation telemetry", () => {
  let replace: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>)
      .__agentNativeNavigationStarted;
    replace = vi.fn();
    vi.spyOn(window.location, "replace").mockImplementation(replace);
  });

  async function resolveWith(response: Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response),
    );
    await act(async () => {
      root.render(<StatusConsumer />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("records the 401 that decided a redirect to sign-in, once per page", async () => {
    await resolveWith(new Response(null, { status: 401 }));
    expect(container.textContent).toBe("unauthenticated");

    expect(navigateForSession("/sign-in?c=secret", "signed_out")).toBe(true);
    expect(navigateForSession("/elsewhere", "signed_out")).toBe(false);

    expect(replace).toHaveBeenCalledTimes(1);
    const events = analyticsMocks.trackEvent.mock.calls.filter(
      ([name]) => name === "session_navigation",
    );
    expect(events).toEqual([
      [
        "session_navigation",
        {
          reason: "signed_out",
          evidence: "http_401",
          read_failures: 0,
          resolved_after_ms: expect.any(Number),
          page_age_ms: expect.any(Number),
        },
      ],
    ]);
    // Where the visitor was sent is never recorded.
    expect(JSON.stringify(events)).not.toContain("secret");
  });

  it("tells a signed-out body from a 401", async () => {
    await resolveWith(jsonResponse({ error: "Not authenticated" }));
    navigateForSession("/sign-in", "signed_out");

    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith(
      "session_navigation",
      expect.objectContaining({ evidence: "signed_out_body" }),
    );
  });

  it("names the reason of other session-driven navigations without session evidence", async () => {
    await resolveWith(jsonResponse({ userId: "u1", email: "a@example.com" }));
    navigateForSession("/home", "signed_in_app");

    const [, properties] = analyticsMocks.trackEvent.mock.calls.find(
      ([name]) => name === "session_navigation",
    )!;
    expect(properties).toMatchObject({ reason: "signed_in_app" });
    expect(properties).not.toHaveProperty("evidence");
  });

  it("does not report a navigation another gate already claimed", async () => {
    await resolveWith(new Response(null, { status: 401 }));
    (
      window as unknown as Record<string, unknown>
    ).__agentNativeNavigationStarted = "/beta";

    expect(navigateForSession("/sign-in", "signed_out")).toBe(false);
    expect(
      analyticsMocks.trackEvent.mock.calls.filter(
        ([name]) => name === "session_navigation",
      ),
    ).toEqual([]);
  });

  it("never lets a failing tracker stop the navigation", async () => {
    await resolveWith(new Response(null, { status: 401 }));
    analyticsMocks.trackEvent.mockImplementation(() => {
      throw new Error("tracker down");
    });

    expect(navigateForSession("/sign-in", "signed_out")).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe("one session read per page load", () => {
  it("answers useSession from the read analytics started, long after it landed", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ userId: "user-8", email: "shared@example.com" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthSessionStatus()).resolves.toMatchObject({
      state: "available",
    });
    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    await renderConsumers(["gate", "header"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("shared@example.comshared@example.com");
  });

  it("answers analytics and useSession from the shell's bootstrap read with no request", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: "unexpected fetch" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.__agentNativeSessionBootstrapFetch = fetchMock;
    window.__agentNativeSessionBootstrap = Promise.resolve({
      state: "available",
      value: { userId: "user-9", email: "bootstrap@example.com" },
    });

    await fetchAuthSessionStatus();
    vi.spyOn(Date, "now").mockReturnValue(now + 2_000);
    await renderConsumers(["gate"]);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await fetchAuthSessionStatus();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("bootstrap@example.com");
  });
});

describe("isSessionFromFirstRead", () => {
  async function resolveFresh(
    fetchMock: ReturnType<typeof vi.fn>,
    before?: (module: Awaited<ReturnType<typeof freshSessionModule>>) => void,
  ) {
    const module = await freshSessionModule();
    vi.stubGlobal("fetch", fetchMock);
    before?.(module);
    function Probe() {
      module.useSession();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return module;
  }

  it("holds for the answer to the page load's own read", async () => {
    const { isSessionFromFirstRead } = await resolveFresh(
      vi.fn(async () => jsonResponse({ userId: "user-a", email: "a@x.test" })),
    );

    expect(isSessionFromFirstRead()).toBe(true);
  });

  it("ends when a retry answers instead", async () => {
    vi.useFakeTimers();
    const module = await freshSessionModule();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(
          jsonResponse({ userId: "user-b", email: "b@x.test" }),
        ),
    );
    function Probe() {
      module.useSession();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(module.isSessionFromFirstRead()).toBe(false);
  });

  it("ends when an invalidation lands before the first answer is read", async () => {
    const { isSessionFromFirstRead } = await resolveFresh(
      vi.fn(async () => jsonResponse({ userId: "user-b", email: "b@x.test" })),
      (module) => module.notifySessionInvalidated(),
    );

    expect(isSessionFromFirstRead()).toBe(false);
  });
});

describe("firstSessionReadAnswer", () => {
  async function mountProbe(
    module: Awaited<ReturnType<typeof freshSessionModule>>,
  ) {
    function Probe() {
      module.useSession();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("is pending until the page load's own read answers, then tells listeners once", async () => {
    const module = await freshSessionModule();
    let answer!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>((resolve) => (answer = resolve))),
    );
    const heard: string[] = [];
    module.subscribeFirstSessionReadAnswer(() =>
      heard.push(module.firstSessionReadAnswer()),
    );

    await mountProbe(module);
    expect(module.firstSessionReadAnswer()).toBe("pending");

    await act(async () => {
      answer(jsonResponse({ userId: "user-a", email: "a@x.test" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(module.firstSessionReadAnswer()).toBe("first-read");
    expect(heard).toEqual(["first-read"]);
  });

  it("tells listeners the read was replaced as soon as an invalidation lands", async () => {
    const module = await freshSessionModule();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {})),
    );
    const heard: string[] = [];
    module.subscribeFirstSessionReadAnswer(() =>
      heard.push(module.firstSessionReadAnswer()),
    );
    await mountProbe(module);

    void module.notifySessionInvalidated();

    expect(heard).toEqual(["replaced"]);
    expect(module.firstSessionReadAnswer()).toBe("replaced");
  });

  it("stays replaced when a retry answers, without telling listeners twice", async () => {
    vi.useFakeTimers();
    const module = await freshSessionModule();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 503 }))
        .mockResolvedValueOnce(
          jsonResponse({ userId: "user-b", email: "b@x.test" }),
        ),
    );
    const heard: string[] = [];
    module.subscribeFirstSessionReadAnswer(() =>
      heard.push(module.firstSessionReadAnswer()),
    );
    function Probe() {
      module.useSession();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(module.firstSessionReadAnswer()).toBe("replaced");
    expect(heard).toEqual(["replaced"]);
  });

  it("answers before any session consumer sees the new session", async () => {
    const module = await freshSessionModule();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ userId: "user-a", email: "a@x.test" })),
    );
    const seen: string[] = [];
    function Probe() {
      const { session } = module.useSession();
      seen.push(`${module.firstSessionReadAnswer()}:${session?.email ?? "-"}`);
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(seen).not.toContain("pending:a@x.test");
    expect(seen.at(-1)).toBe("first-read:a@x.test");
  });
});

describe("sessionReadIdentityStatus", () => {
  type SessionModule = Awaited<ReturnType<typeof freshSessionModule>>;

  // A session endpoint that answers each read when told to.
  function heldSessionReads() {
    const pending: Array<(response: Response) => void> = [];
    const fetcher = vi.fn(
      () => new Promise<Response>((resolve) => pending.push(resolve)),
    ) as unknown as typeof fetch;
    async function answerAs(user: string) {
      await act(async () => {
        await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
        pending.shift()?.(
          jsonResponse({ userId: user, email: `${user}@x.test` }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    return { fetcher, answerAs };
  }

  async function mountProbe(module: SessionModule) {
    function Probe() {
      module.useSession();
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("holds a read sent before the first answer until it, then keeps it for that account only", async () => {
    const module = await freshSessionModule();
    const reads = heldSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    const beforeAnswer = module.sessionReadIdentity();
    const heard: string[] = [];
    module.subscribeSessionReadIdentity(() =>
      heard.push(module.sessionReadIdentityStatus(beforeAnswer)),
    );

    await mountProbe(module);
    expect(module.sessionReadIdentityStatus(beforeAnswer)).toBe("pending");
    await reads.answerAs("user-a");
    expect(module.sessionReadIdentityStatus(beforeAnswer)).toBe("current");
    expect(heard).toEqual(["current"]);

    const afterAnswer = module.sessionReadIdentity();
    await act(async () => {
      void module.notifySessionInvalidated();
    });
    const duringReread = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(afterAnswer)).toBe("pending");
    expect(module.sessionReadIdentityStatus(duringReread)).toBe("pending");
    await reads.answerAs("user-b");

    expect(module.sessionReadIdentityStatus(beforeAnswer)).toBe("stale");
    expect(module.sessionReadIdentityStatus(afterAnswer)).toBe("stale");
    expect(module.sessionReadIdentityStatus(duringReread)).toBe("current");
  });

  it("keeps a read current when the session is read again as the same account", async () => {
    const module = await freshSessionModule();
    const reads = heldSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    await mountProbe(module);
    await reads.answerAs("user-a");
    const read = module.sessionReadIdentity();

    await act(async () => {
      void module.notifySessionInvalidated();
    });
    await reads.answerAs("user-a");

    expect(module.sessionReadIdentityStatus(read)).toBe("current");
  });

  it("drops a read sent over another transport than the session was read over", async () => {
    const module = await freshSessionModule();
    const cookieReads = heldSessionReads();
    const bearerReads = heldSessionReads();
    vi.stubGlobal("fetch", cookieReads.fetcher);
    const overCookies = module.sessionReadIdentity();
    const overBearer = module.sessionReadIdentity({
      fetch: bearerReads.fetcher,
    });

    vi.stubGlobal("fetch", bearerReads.fetcher);
    await mountProbe(module);
    await bearerReads.answerAs("user-b");

    expect(module.sessionReadIdentityStatus(overCookies)).toBe("stale");
    expect(module.sessionReadIdentityStatus(overBearer)).toBe("current");
  });

  it("does not answer a session read over a bearer transport with the cookie session it accepted", async () => {
    const module = await freshSessionModule();
    const cookieReads = heldSessionReads();
    const bearerReads = heldSessionReads();
    vi.stubGlobal("fetch", cookieReads.fetcher);
    let retry = () => {};
    const shown: Array<string | undefined> = [];
    function Probe() {
      const result = module.useSession();
      retry = result.retry;
      shown.push(result.session?.userId);
      return null;
    }
    await act(async () => {
      root.render(<Probe />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await cookieReads.answerAs("user-a");
    const overCookies = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(overCookies)).toBe("current");

    // An embed now signs the page's requests with B's bearer token, inside
    // the cookie answer's lifetime. The next session read goes out as B.
    vi.stubGlobal("fetch", bearerReads.fetcher);
    const switchedAt = shown.length;
    await act(async () => {
      retry();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bearerReads.fetcher).toHaveBeenCalledTimes(1);
    expect(module.sessionReadIdentityStatus(overCookies)).toBe("pending");
    const overBearer = module.sessionReadIdentity();
    await bearerReads.answerAs("user-b");

    expect(shown.slice(switchedAt)).not.toContain("user-a");
    expect(shown[shown.length - 1]).toBe("user-b");
    expect(module.sessionReadIdentityStatus(overCookies)).toBe("stale");
    expect(module.sessionReadIdentityStatus(overBearer)).toBe("current");
  });

  // Focus after the answer's lifetime: the session is read again.
  async function routineRecheck() {
    vi.spyOn(Date, "now").mockReturnValue(now + 30_001);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("keeps a read accepted, never heard otherwise, while a routine re-check names the same identity", async () => {
    const module = await freshSessionModule();
    const reads = heldSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    await mountProbe(module);
    await reads.answerAs("user-a");
    const read = module.sessionReadIdentity();
    const heard: string[] = [];
    module.subscribeSessionReadIdentity(() =>
      heard.push(module.sessionReadIdentityStatus(read)),
    );

    await routineRecheck();
    expect(reads.fetcher).toHaveBeenCalledTimes(2);
    expect(module.sessionReadIdentityStatus(read)).toBe("current");
    await reads.answerAs("user-a");

    expect(module.sessionReadIdentityStatus(read)).toBe("current");
    expect(heard.length).toBeGreaterThan(0);
    expect(new Set(heard)).toEqual(new Set(["current"]));
  });

  it("holds a read sent while a routine re-check is out, and accepts it once the re-check names the same identity", async () => {
    const module = await freshSessionModule();
    const reads = heldSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    await mountProbe(module);
    await reads.answerAs("user-a");

    await routineRecheck();
    const duringRecheck = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(duringRecheck)).toBe("pending");
    await reads.answerAs("user-a");

    expect(module.sessionReadIdentityStatus(duringRecheck)).toBe("current");
  });

  it("drops what it accepted and what was sent while it was out when a routine re-check names someone else", async () => {
    const module = await freshSessionModule();
    const reads = heldSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    await mountProbe(module);
    await reads.answerAs("user-a");
    const before = module.sessionReadIdentity();

    await routineRecheck();
    const duringRecheck = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(before)).toBe("current");
    await reads.answerAs("user-b");
    const after = module.sessionReadIdentity();

    expect(module.sessionReadIdentityStatus(before)).toBe("stale");
    expect(module.sessionReadIdentityStatus(duringRecheck)).toBe("stale");
    expect(module.sessionReadIdentityStatus(after)).toBe("current");
  });

  // A session endpoint that answers as `state.user`, or never while `state.hang`.
  function hangingSessionReads() {
    const state = { hang: false, user: "user-a" };
    const fetcher = vi.fn(() =>
      state.hang
        ? new Promise<Response>(() => {})
        : Promise.resolve(
            jsonResponse({
              userId: state.user,
              email: `${state.user}@x.test`,
            }),
          ),
    );
    return { state, fetcher };
  }

  // Timers and the monotonic clock run fake; Date.now stays the spec's own.
  function fakeTimersKeepingDate() {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "performance",
      ],
    });
  }

  it("answers what was sent while a routine re-check hung past the budget, keeping what it accepted", async () => {
    const module = await freshSessionModule();
    const reads = hangingSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    await mountProbe(module);
    const accepted = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(accepted)).toBe("current");
    const heard: string[] = [];
    module.subscribeSessionReadIdentity(() =>
      heard.push(module.sessionReadIdentityStatus(accepted)),
    );

    fakeTimersKeepingDate();
    reads.state.hang = true;
    vi.spyOn(Date, "now").mockReturnValue(now + 30_001);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
    });
    const during = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(during)).toBe("pending");

    // Every read hangs until the budget is spent and the resolver gives up.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const after = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(accepted)).toBe("current");
    expect(module.sessionReadIdentityStatus(during)).toBe("pending");
    expect(module.sessionReadIdentityStatus(after)).toBe("pending");

    // The backend comes back; reads go on in the background, backing off, and
    // one answers without a focus or any other session event.
    reads.state.hang = false;
    const callsBefore = reads.fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(reads.fetcher.mock.calls.length).toBeGreaterThan(callsBefore);
    expect(module.sessionReadIdentityStatus(during)).toBe("current");
    expect(module.sessionReadIdentityStatus(after)).toBe("current");
    expect(module.sessionReadIdentityStatus(accepted)).toBe("current");
    expect(new Set(heard)).toEqual(new Set(["current"]));
  });

  it("ends an invalidation whose read hung past the budget in a fresh answer, never the old account", async () => {
    const module = await freshSessionModule();
    const reads = hangingSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    await mountProbe(module);
    const accepted = module.sessionReadIdentity();

    fakeTimersKeepingDate();
    reads.state.hang = true;
    await act(async () => {
      void module.notifySessionInvalidated();
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const during = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(accepted)).toBe("pending");
    expect(module.sessionReadIdentityStatus(during)).toBe("pending");

    // The server now answers for someone else.
    reads.state.hang = false;
    reads.state.user = "user-b";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(module.sessionReadIdentityStatus(accepted)).toBe("stale");
    expect(module.sessionReadIdentityStatus(during)).toBe("current");
  });

  it("reads the session again over a new transport when one is announced, with no session read asked for", async () => {
    const module = await freshSessionModule();
    const cookieReads = heldSessionReads();
    const bearerReads = heldSessionReads();
    vi.stubGlobal("fetch", cookieReads.fetcher);
    await mountProbe(module);
    await cookieReads.answerAs("user-a");
    const overCookies = module.sessionReadIdentity();

    // The embed runtime takes over the page's fetch and says so.
    vi.stubGlobal("fetch", bearerReads.fetcher);
    await act(async () => {
      window.dispatchEvent(new Event(FETCH_TRANSPORT_CHANGED_EVENT));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bearerReads.fetcher).toHaveBeenCalledTimes(1);
    expect(module.sessionReadIdentityStatus(overCookies)).toBe("pending");
    await bearerReads.answerAs("user-b");

    expect(module.sessionReadIdentityStatus(overCookies)).toBe("stale");
    expect(module.sessionReadIdentityStatus(module.sessionReadIdentity())).toBe(
      "current",
    );
  });

  it("reads the session again when a request goes out over a transport nothing announced", async () => {
    const module = await freshSessionModule();
    const cookieReads = heldSessionReads();
    const bearerReads = heldSessionReads();
    vi.stubGlobal("fetch", cookieReads.fetcher);
    await mountProbe(module);
    await cookieReads.answerAs("user-a");

    vi.stubGlobal("fetch", bearerReads.fetcher);
    const overBearer = module.sessionReadIdentity();
    expect(module.sessionReadIdentityStatus(overBearer)).toBe("stale");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(bearerReads.fetcher).toHaveBeenCalledTimes(1);
    await bearerReads.answerAs("user-b");

    expect(module.sessionReadIdentityStatus(module.sessionReadIdentity())).toBe(
      "current",
    );
  });

  it("drops a read the head sent with the first session read once that read is replaced", async () => {
    const module = await freshSessionModule();
    const reads = heldSessionReads();
    vi.stubGlobal("fetch", reads.fetcher);
    const headRead = module.sessionReadIdentity({
      sentWithFirstSessionRead: true,
    });
    await mountProbe(module);

    await act(async () => {
      void module.notifySessionInvalidated();
    });
    expect(module.sessionReadIdentityStatus(headRead)).toBe("stale");
    await reads.answerAs("user-a");
    await reads.answerAs("user-a");

    expect(module.sessionReadIdentityStatus(headRead)).toBe("stale");
  });
});

describe("a peer tab's invalidation broadcast before this tab listened", () => {
  const KEY = "agent-native:session-invalidated";

  afterEach(() => {
    delete window.__agentNativeSessionBootstrap;
    delete window.__agentNativeSessionBootstrapInvalidation;
    delete window.__agentNativeSessionBootstrapFetch;
    window.localStorage.removeItem(KEY);
  });

  // The head read the session as A and recorded the marker it saw; the app
  // code then loads, with the marker as `storedNow` says.
  async function loadAfterHeadRead(storedNow: string) {
    window.localStorage.setItem(KEY, "signed-in-earlier");
    window.__agentNativeSessionBootstrapInvalidation = "signed-in-earlier";
    window.__agentNativeSessionBootstrap = Promise.resolve({
      state: "available",
      value: { userId: "user-a", email: "a@x.test" },
    });
    window.localStorage.setItem(KEY, storedNow);
    const fetchMock = vi.fn(async () =>
      jsonResponse({ userId: "user-b", email: "b@x.test" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    window.__agentNativeSessionBootstrapFetch = fetchMock;
    const module = await freshSessionModule();
    const heard: string[] = [];
    module.subscribeFirstSessionReadAnswer(() =>
      heard.push(module.firstSessionReadAnswer()),
    );
    function Gate() {
      const { session, isLoading } = module.useSession();
      return <>{isLoading ? "loading" : (session?.email ?? "signed-out")}</>;
    }
    await act(async () => {
      root.render(<Gate />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { module, fetchMock, heard };
  }

  it("replaces the head's session read and reads the session again", async () => {
    const { module, fetchMock, heard } =
      await loadAfterHeadRead("signed-in-as-b");

    expect(heard[0]).toBe("replaced");
    expect(module.firstSessionReadAnswer()).toBe("replaced");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.textContent).toBe("b@x.test");
  });

  it("keeps the head's session read when no broadcast came in between", async () => {
    const { module, fetchMock } = await loadAfterHeadRead("signed-in-earlier");

    expect(module.firstSessionReadAnswer()).toBe("first-read");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("a@x.test");
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
