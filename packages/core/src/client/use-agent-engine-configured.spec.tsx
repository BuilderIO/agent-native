// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchEnvironmentStatus,
  invalidateClientStatusRequests,
} from "./client-status-requests.js";
import {
  fetchAgentEngineConfiguredState,
  useAgentEngineConfigured,
} from "./use-agent-engine-configured.js";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

// The initial readiness probe is deferred past first paint; the fallback
// timer bounds that wait at 250ms, so settling past it is deterministic.
async function flushAfterPaint() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

function Probe({ enabled = true }: { enabled?: boolean }) {
  const status = useAgentEngineConfigured(enabled);
  return <output data-can-chat={status.canChat}>{status.state}</output>;
}

function ScopedProbe({
  tabId,
  threadId,
}: {
  tabId?: string;
  threadId?: string;
}) {
  const status = useAgentEngineConfigured(true, { tabId, threadId });
  return <output>{status.state}</output>;
}

describe("useAgentEngineConfigured", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    invalidateClientStatusRequests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not let a stale missing-key event override current Builder status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/_agent-native/builder/status")) {
          return jsonResponse({ configured: true });
        }
        if (href.includes("/_agent-native/agent-engine/status")) {
          return jsonResponse({
            configured: true,
            chatEligible: true,
            engine: "builder",
          });
        }
        return jsonResponse([]);
      }),
    );

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAfterPaint();

    expect(container.textContent).toBe("configured");
    expect(container.querySelector("output")?.dataset.canChat).toBe("true");

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
    expect(container.querySelector("output")?.dataset.canChat).toBe("true");
  });

  it("defers the readiness check past first paint and starts it on mount", async () => {
    const responses: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            responses.push(resolve);
          }),
      ),
    );

    act(() => {
      root.render(<Probe />);
    });

    expect(container.textContent).toBe("unknown");
    expect(fetch).not.toHaveBeenCalled();

    await act(async () => {
      await vi.waitFor(() => {
        expect(fetch).toHaveBeenCalledTimes(1);
      });
    });

    await act(async () => {
      for (const resolve of responses) {
        resolve(jsonResponse({ configured: true, chatEligible: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
  });

  it("an event inside the deferral window consumes the scheduled probe instead of duplicating it", async () => {
    // A failed probe is the case the shared client-status cache cannot
    // dedupe (only successful results are cached), so it is the case where
    // the stacked scheduled probe would hit the endpoint again.
    let engineFetchCount = 0;
    let resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            if (String(input).includes("/_agent-native/agent-engine/status")) {
              engineFetchCount += 1;
            }
            resolvers.push(resolve);
          }),
      ),
    );

    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    // The event-driven probe stays immediate and the scheduled initial probe
    // is consumed, not stacked behind it.
    expect(engineFetchCount).toBe(1);
    // Fail the canonical probe so the check settles on "unavailable" and
    // schedules a retry that the unmount below cancels.
    await act(async () => {
      for (const resolve of resolvers.splice(0)) {
        resolve(new Response("unavailable", { status: 500 }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      for (const resolve of resolvers.splice(0)) {
        resolve(new Response("unavailable", { status: 500 }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    // Settling past the paint window (fallback timer bounds it at 250ms)
    // must not start the duplicate scheduled probe.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engineFetchCount).toBe(1);
    expect(container.textContent).toBe("unavailable");
  });

  it("a missing-key event inside the deferral window behaves the same", async () => {
    let engineFetchCount = 0;
    let resolvers: Array<(response: Response) => void> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (input: RequestInfo | URL) =>
          new Promise<Response>((resolve) => {
            if (String(input).includes("/_agent-native/agent-engine/status")) {
              engineFetchCount += 1;
            }
            resolvers.push(resolve);
          }),
      ),
    );

    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engineFetchCount).toBe(1);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) {
        resolve(new Response("unavailable", { status: 500 }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      for (const resolve of resolvers.splice(0)) {
        resolve(new Response("unavailable", { status: 500 }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(engineFetchCount).toBe(1);
    expect(container.textContent).toBe("unavailable");
  });

  it("uses chat eligibility instead of broad engine configuration", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/_agent-native/agent-engine/status")) {
          return jsonResponse({ configured: true, chatEligible: false });
        }
        throw new Error(`Unexpected status route: ${href}`);
      }),
    );

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAfterPaint();

    expect(container.textContent).toBe("missing");
    expect(container.querySelector("output")?.dataset.canChat).toBe("false");

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("missing");
    expect(container.querySelector("output")?.dataset.canChat).toBe("false");
  });

  it("ignores missing-key events when provider checks are disabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe enabled={false} />);
      await Promise.resolve();
    });
    await flushAfterPaint();

    expect(container.textContent).toBe("configured");
    expect(container.querySelector("output")?.dataset.canChat).toBe("false");

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
    expect(container.querySelector("output")?.dataset.canChat).toBe("false");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not carry the disabled short-circuit into chat eligibility", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ configured: true, chatEligible: true })),
    );

    await act(async () => {
      root.render(<Probe enabled={false} />);
      await Promise.resolve();
    });
    await flushAfterPaint();
    expect(container.querySelector("output")?.dataset.canChat).toBe("false");

    await act(async () => {
      root.render(<Probe enabled />);
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.dataset.canChat).toBe("false");
    await flushAfterPaint();
    expect(container.querySelector("output")?.dataset.canChat).toBe("true");
  });

  it("returns missing immediately from the shared status fetch helper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/_agent-native/agent-engine/status")) {
          return jsonResponse({ configured: false, chatEligible: false });
        }
        throw new Error(`Unexpected status route: ${href}`);
      }),
    );

    await expect(fetchAgentEngineConfiguredState()).resolves.toBe("missing");
  });

  it("fails closed when a reachable server omits chat eligibility", async () => {
    const fetch = vi.fn(async (_url: string | URL | Request) =>
      jsonResponse({ configured: true }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(fetchAgentEngineConfiguredState()).resolves.toBe(
      "unavailable",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0])).toContain(
      "/_agent-native/agent-engine/status",
    );
  });

  it("sets canChat from chat eligibility instead of broad configured status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ configured: false, chatEligible: true }),
      ),
    );

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAfterPaint();

    expect(container.textContent).toBe("configured");
    expect(container.querySelector("output")?.dataset.canChat).toBe("true");
  });

  it("returns unavailable when every status check times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const status = fetchAgentEngineConfiguredState(true, { timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(50);
    await expect(status).resolves.toBe("unavailable");
  });

  it("does not abort an unrelated status request when the chat probe times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request, init?: RequestInit) => {
        const href = String(url);
        if (href.includes("/_agent-native/env-status")) {
          return new Promise<Response>((resolve, reject) => {
            const timer = setTimeout(() => {
              resolve(jsonResponse([{ key: "ANTHROPIC_API_KEY" }]));
            }, 40);
            init?.signal?.addEventListener("abort", () => {
              clearTimeout(timer);
              reject(new DOMException("Aborted", "AbortError"));
            });
          });
        }
        if (href.includes("/_agent-native/builder/status")) {
          return Promise.resolve(jsonResponse({ configured: true }));
        }
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }),
    );

    const environment = fetchEnvironmentStatus();
    const status = fetchAgentEngineConfiguredState(true, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(40);

    await expect(environment).resolves.toEqual({
      state: "available",
      value: [{ key: "ANTHROPIC_API_KEY" }],
    });
    await expect(status).resolves.toBe("unavailable");
  });

  it("does not use missing fallback after unavailable status checks", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const status = fetchAgentEngineConfiguredState(true, {
      missingFallback: true,
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(50);
    await expect(status).resolves.toBe("unavailable");
  });

  it("starts a fresh request after a timed-out shared probe", async () => {
    vi.useFakeTimers();
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        requestCount += 1;
        if (requestCount <= 1) return new Promise<Response>(() => {});
        return Promise.resolve(
          jsonResponse({ configured: true, chatEligible: true }),
        );
      }),
    );

    const first = fetchAgentEngineConfiguredState(true, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(first).resolves.toBe("unavailable");

    await expect(
      fetchAgentEngineConfiguredState(true, { timeoutMs: 25 }),
    ).resolves.toBe("configured");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries a failed check instead of latching a dead state", async () => {
    vi.useFakeTimers();
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string | URL | Request) => {
        if (failing) return Promise.reject(new Error("offline"));
        return Promise.resolve(
          jsonResponse({ configured: true, chatEligible: true }),
        );
      }),
    );

    act(() => {
      root.render(<Probe />);
    });
    expect(container.textContent).toBe("unknown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    // Never "missing": an unanswered probe is not evidence of no provider.
    expect(container.textContent).toBe("unavailable");

    failing = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(container.textContent).toBe("configured");
  });

  it("enables the composer when a slow probe eventually answers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string | URL | Request) =>
          new Promise<Response>((resolve) => {
            setTimeout(
              () =>
                resolve(jsonResponse({ configured: true, chatEligible: true })),
              6000,
            );
          }),
      ),
    );

    act(() => {
      root.render(<Probe />);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(container.textContent).toBe("unknown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4000);
    });
    expect(container.textContent).toBe("configured");
  });

  it("ignores scoped missing-key events for other tabs", async () => {
    let initialCheck = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (initialCheck) {
          if (href.includes("/_agent-native/agent-engine/status")) {
            return jsonResponse({ configured: true, chatEligible: true });
          }
        }
        return jsonResponse({ configured: false, chatEligible: false });
      }),
    );

    await act(async () => {
      root.render(<ScopedProbe tabId="active-tab" threadId="thread-a" />);
      await Promise.resolve();
      await Promise.resolve();
    });
    await flushAfterPaint();

    expect(container.textContent).toBe("configured");
    initialCheck = false;

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:missing-api-key", {
          detail: { tabId: "other-tab", threadId: "thread-b" },
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
  });
});
