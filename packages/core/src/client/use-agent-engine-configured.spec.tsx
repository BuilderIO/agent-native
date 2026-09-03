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

function Probe({ enabled = true }: { enabled?: boolean }) {
  const status = useAgentEngineConfigured(enabled);
  return <output>{status.state}</output>;
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
          return jsonResponse({ configured: true, engine: "builder" });
        }
        return jsonResponse([]);
      }),
    );

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
  });

  it("starts the readiness check on mount without blocking the initial state", async () => {
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
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      for (const resolve of responses) {
        resolve(jsonResponse({ configured: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
  });

  it("uses missing-key events when no current engine is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/_agent-native/builder/status")) {
          return jsonResponse({ configured: false });
        }
        if (href.includes("/_agent-native/agent-engine/status")) {
          return jsonResponse({ configured: false });
        }
        return jsonResponse([]);
      }),
    );

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("missing");

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("missing");
  });

  it("ignores missing-key events when provider checks are disabled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe enabled={false} />);
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");

    await act(async () => {
      window.dispatchEvent(new Event("agent-chat:missing-api-key"));
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns missing immediately from the shared status fetch helper", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/_agent-native/builder/status")) {
          return jsonResponse({ configured: false });
        }
        if (href.includes("/_agent-native/agent-engine/status")) {
          return jsonResponse({ configured: false });
        }
        return jsonResponse([]);
      }),
    );

    await expect(fetchAgentEngineConfiguredState()).resolves.toBe("missing");
  });

  it("uses the canonical engine status when legacy status checks are partial", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request) => {
        const href = String(url);
        if (href.includes("/_agent-native/env-status")) {
          return jsonResponse([]);
        }
        if (href.includes("/_agent-native/agent-engine/status")) {
          return jsonResponse({ configured: false });
        }
        return new Promise<Response>(() => {});
      }),
    );

    await expect(
      fetchAgentEngineConfiguredState(true, { timeoutMs: 25 }),
    ).resolves.toBe("missing");
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

  it("does not abort another status endpoint when its own probe times out", async () => {
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
    await expect(status).resolves.toBe("configured");
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
        if (requestCount <= 3) return new Promise<Response>(() => {});
        return Promise.resolve(jsonResponse({ configured: true }));
      }),
    );

    const first = fetchAgentEngineConfiguredState(true, { timeoutMs: 25 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(first).resolves.toBe("unavailable");

    await expect(
      fetchAgentEngineConfiguredState(true, { timeoutMs: 25 }),
    ).resolves.toBe("configured");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("retries a failed check instead of latching a dead state", async () => {
    vi.useFakeTimers();
    let failing = true;
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string | URL | Request) => {
        if (failing) return Promise.reject(new Error("offline"));
        const href = String(url);
        if (href.includes("/_agent-native/env-status")) {
          return Promise.resolve(jsonResponse([]));
        }
        return Promise.resolve(jsonResponse({ configured: true }));
      }),
    );

    act(() => {
      root.render(<Probe />);
    });
    expect(container.textContent).toBe("unknown");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
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
        (url: string | URL | Request) =>
          new Promise<Response>((resolve) => {
            const href = String(url);
            setTimeout(
              () =>
                resolve(
                  href.includes("/_agent-native/env-status")
                    ? jsonResponse([])
                    : jsonResponse({ configured: true }),
                ),
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
          if (href.includes("/_agent-native/builder/status")) {
            return jsonResponse({ configured: true });
          }
          if (href.includes("/_agent-native/agent-engine/status")) {
            return jsonResponse({ configured: true });
          }
          return jsonResponse([]);
        }
        if (href.includes("/_agent-native/env-status")) {
          return jsonResponse([]);
        }
        return jsonResponse({ configured: false });
      }),
    );

    await act(async () => {
      root.render(<ScopedProbe tabId="active-tab" threadId="thread-a" />);
      await Promise.resolve();
      await Promise.resolve();
    });

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
