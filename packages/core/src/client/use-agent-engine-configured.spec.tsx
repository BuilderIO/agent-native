// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AgentChatAiSetupRequiredError,
  agentEngineStatusUrlForChatApi,
  ensureAgentEngineReadiness,
  getAgentEngineReadiness,
  getAgentEngineReadinessStoreCountForTests,
  invalidateAgentEngineReadiness,
  requireAgentEngineConfiguredForDispatch,
  resetAgentEngineReadinessForTests,
  subscribeAgentEngineReadiness,
  type AgentEngineReadinessSource,
} from "./agent-engine-readiness.js";
import { agentNativePath } from "./api-path.js";
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

// The probe begins on mount; settling past the request turn lets the UI update.
async function flushAfterPaint() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
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

function ReadinessSourceProbe({
  source,
}: {
  source: AgentEngineReadinessSource;
}) {
  const status = useAgentEngineConfigured(true, { source });
  return <output>{status.state}</output>;
}

describe("useAgentEngineConfigured", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    resetAgentEngineReadinessForTests();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    resetAgentEngineReadinessForTests();
    invalidateClientStatusRequests();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("refreshes cached missing readiness after the provider connects", async () => {
    let configured = false;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/_agent-native/agent-engine/status")) {
        return jsonResponse({ configured, chatEligible: configured });
      }
      return jsonResponse([]);
    });
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe />);
    });
    await flushAfterPaint();

    expect(container.textContent).toBe("missing");
    configured = true;
    await act(async () => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      fetch.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/agent-engine/status"),
      ),
    ).toHaveLength(2);
    expect(container.textContent).toBe("configured");
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

  it("starts the shared readiness check on mount", async () => {
    const responses: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          responses.push(resolve);
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      root.render(<Probe />);
    });

    expect(container.textContent).toBe("unknown");
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1);
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

  it("coalesces repeated readiness invalidation events", async () => {
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
    // The boot probe is already pending. Two same-turn invalidations collapse
    // into one authoritative refresh after that request settles.
    expect(engineFetchCount).toBe(2);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) {
        resolve(jsonResponse({ configured: true, chatEligible: true }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engineFetchCount).toBe(2);
    expect(container.textContent).toBe("configured");
  });

  it("refreshes every store named by same-turn scoped invalidations", async () => {
    let readyA = false;
    let readyB = false;
    const sourceA = {
      statusUrl:
        "https://chat-a.example.test/_agent-native/agent-engine/status",
      fetch: vi.fn(async () =>
        jsonResponse({ chatEligible: readyA }),
      ) as typeof fetch,
    };
    const sourceB = {
      statusUrl:
        "https://chat-b.example.test/_agent-native/agent-engine/status",
      fetch: vi.fn(async () =>
        jsonResponse({ chatEligible: readyB }),
      ) as typeof fetch,
    };
    const unsubscribeA = subscribeAgentEngineReadiness(vi.fn(), {
      source: sourceA,
      threadId: "thread-a",
    });
    const unsubscribeB = subscribeAgentEngineReadiness(vi.fn(), {
      source: sourceB,
      threadId: "thread-b",
    });

    try {
      await Promise.all([
        ensureAgentEngineReadiness({ source: sourceA }),
        ensureAgentEngineReadiness({ source: sourceB }),
      ]);
      expect(sourceA.fetch).toHaveBeenCalledOnce();
      expect(sourceB.fetch).toHaveBeenCalledOnce();
      readyA = true;
      readyB = true;

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("agent-chat:missing-api-key", {
            detail: { threadId: "thread-a" },
          }),
        );
        window.dispatchEvent(
          new CustomEvent("agent-chat:missing-api-key", {
            detail: { threadId: "thread-b" },
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(sourceA.fetch).toHaveBeenCalledTimes(2);
      expect(sourceB.fetch).toHaveBeenCalledTimes(2);
      expect(getAgentEngineReadiness(sourceA)).toBe("configured");
      expect(getAgentEngineReadiness(sourceB)).toBe("configured");
    } finally {
      unsubscribeA();
      unsubscribeB();
    }
  });

  it("isolates readiness by transport and auth scope at a shared status URL", async () => {
    const statusUrl =
      "https://shared.example.test/_agent-native/agent-engine/status";
    const scopedFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const authorization = new Headers(init?.headers).get("authorization");
        return jsonResponse({
          chatEligible: authorization === "Bearer user-a",
        });
      },
    );
    const sourceA = {
      statusUrl,
      fetch: scopedFetch as typeof fetch,
      headers: { Authorization: "Bearer user-a" },
      credentials: "include" as const,
    };
    const sourceB = {
      statusUrl,
      fetch: scopedFetch as typeof fetch,
      headers: { Authorization: "Bearer user-b" },
      credentials: "include" as const,
    };

    await expect(
      Promise.all([
        ensureAgentEngineReadiness({ source: sourceA }),
        ensureAgentEngineReadiness({ source: sourceB }),
      ]),
    ).resolves.toEqual(["configured", "missing"]);
    expect(scopedFetch).toHaveBeenCalledTimes(2);
    expect(getAgentEngineReadiness(sourceA)).toBe("configured");
    expect(getAgentEngineReadiness(sourceB)).toBe("missing");

    const equivalentSource = {
      ...sourceA,
      headers: { authorization: "Bearer user-a" },
    };
    await expect(
      ensureAgentEngineReadiness({ source: equivalentSource }),
    ).resolves.toBe("configured");
    expect(scopedFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps readiness stores separate for different fetchers at the same URL", async () => {
    const statusUrl =
      "https://shared.example.test/_agent-native/agent-engine/status";
    const sourceA = {
      statusUrl,
      fetch: vi.fn(async () =>
        jsonResponse({ chatEligible: true }),
      ) as typeof fetch,
    };
    const sourceB = {
      statusUrl,
      fetch: vi.fn(async () =>
        jsonResponse({ chatEligible: false }),
      ) as typeof fetch,
    };

    await expect(
      Promise.all([
        ensureAgentEngineReadiness({ source: sourceA }),
        ensureAgentEngineReadiness({ source: sourceB }),
      ]),
    ).resolves.toEqual(["configured", "missing"]);
    expect(sourceA.fetch).toHaveBeenCalledOnce();
    expect(sourceB.fetch).toHaveBeenCalledOnce();
    expect(getAgentEngineReadiness(sourceA)).toBe("configured");
    expect(getAgentEngineReadiness(sourceB)).toBe("missing");
  });

  it("rechecks readiness after a missing-key event", async () => {
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
    expect(engineFetchCount).toBe(2);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) {
        resolve(jsonResponse({ configured: false, chatEligible: false }));
      }
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(engineFetchCount).toBe(2);
    expect(container.textContent).toBe("missing");
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
    let resolveStatus: ((response: Response) => void) | undefined;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe enabled={false} />);
      await Promise.resolve();
    });
    await flushAfterPaint();
    expect(container.querySelector("output")?.dataset.canChat).toBe("false");

    await act(async () => {
      root.render(<Probe enabled />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("output")?.dataset.canChat).toBe("false");
    expect(fetch).toHaveBeenCalled();
    await act(async () => {
      resolveStatus?.(jsonResponse({ configured: true, chatEligible: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.canChat).toBe("true");
    expect(fetch).toHaveBeenCalled();
  });

  it("uses the supplied transport source for the composer readiness check", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ configured: true, chatEligible: true }),
    );
    const source: AgentEngineReadinessSource = {
      statusUrl: "https://clips.example.test/_agent-native/agent-engine/status",
      fetch: fetch as typeof globalThis.fetch,
      credentials: "include",
    };

    await act(async () => {
      root.render(<ReadinessSourceProbe source={source} />);
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    expect(container.textContent).toBe("configured");
    expect(fetch).toHaveBeenCalledWith(
      source.statusUrl,
      expect.objectContaining({ credentials: "include" }),
    );
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

  it("uses the chat transport origin, fetcher, and headers for readiness", async () => {
    const transportFetch = vi.fn(async () =>
      jsonResponse({ chatEligible: true }),
    );
    const statusUrl = agentEngineStatusUrlForChatApi(
      "https://api.example.com/prefix/_agent-native/agent-chat?surface=clips",
    );

    await expect(
      fetchAgentEngineConfiguredState(true, {
        source: {
          statusUrl,
          fetch: transportFetch,
          headers: { Authorization: "Bearer test-token" },
          credentials: "include",
        },
      }),
    ).resolves.toBe("configured");

    expect(statusUrl).toBe(
      "https://api.example.com/prefix/_agent-native/agent-engine/status",
    );
    expect(transportFetch).toHaveBeenCalledWith(
      statusUrl,
      expect.objectContaining({
        cache: "no-store",
        credentials: "include",
        headers: { Authorization: "Bearer test-token" },
      }),
    );
  });

  it("preserves a custom public framework prefix in the readiness URL", () => {
    vi.stubGlobal("__AGENT_NATIVE_APP_CONFIG__", {
      runtime: { frameworkRoutePrefix: "/an" },
    });
    vi.stubEnv("VITE_APP_BASE_PATH", "/docs");

    const chatApiUrl = agentNativePath("/_agent-native/agent-chat");

    expect(chatApiUrl).toBe("/docs/an/agent-chat");
    expect(agentEngineStatusUrlForChatApi(chatApiUrl)).toBe(
      "/docs/an/agent-engine/status",
    );
  });

  it("prunes expired idle readiness stores for old transport URLs", async () => {
    vi.useFakeTimers();
    const makeSource = (host: string) => ({
      statusUrl: `https://${host}.example.test/_agent-native/agent-engine/status`,
      fetch: vi.fn(async () =>
        jsonResponse({ chatEligible: true }),
      ) as typeof fetch,
    });

    for (const host of ["old-a", "old-b", "old-c"]) {
      await ensureAgentEngineReadiness({ source: makeSource(host) });
    }
    expect(getAgentEngineReadinessStoreCountForTests()).toBe(3);

    await vi.advanceTimersByTimeAsync(10_001);
    await ensureAgentEngineReadiness({ source: makeSource("current") });

    expect(getAgentEngineReadinessStoreCountForTests()).toBe(1);
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

  it("releases a hung shared probe at its deadline and allows retry", async () => {
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

    // A caller's shorter deadline does not cancel the shared probe. The
    // shared probe itself has a hard bound so a hung request cannot block
    // later callers forever.
    await vi.advanceTimersByTimeAsync(15_000);

    await expect(
      fetchAgentEngineConfiguredState(true, { timeoutMs: 25 }),
    ).resolves.toBe("configured");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight probe with a send while readiness is unknown", async () => {
    let resolvePassive!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolvePassive = resolve;
          }),
      )
      .mockResolvedValueOnce(jsonResponse({ chatEligible: false }));
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe />);
    });
    await flushAfterPaint();
    expect(fetch).toHaveBeenCalledOnce();

    const sendReadiness = fetchAgentEngineConfiguredState(true, {
      fresh: true,
    });
    resolvePassive(jsonResponse({ chatEligible: true }));
    await expect(sendReadiness).resolves.toBe("configured");
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toBe("configured");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rechecks replacement readiness when setup changes during a send", async () => {
    let resolveInitial!: (response: Response) => void;
    let resolveReplacement!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReplacement = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe />);
    });
    await flushAfterPaint();
    expect(fetch).toHaveBeenCalledOnce();

    const sendReadiness = requireAgentEngineConfiguredForDispatch({
      fresh: true,
      timeoutMs: 1_000,
    });
    const sendAssertion = expect(sendReadiness).resolves.toBeUndefined();
    await act(async () => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      resolveInitial(jsonResponse({ configured: false, chatEligible: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      resolveReplacement(
        jsonResponse({ configured: true, chatEligible: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    await sendAssertion;
    await flushAfterPaint();
    expect(container.textContent).toBe("configured");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps the original send deadline when setup replaces its readiness check", async () => {
    vi.useFakeTimers();
    let resolveInitial!: (response: Response) => void;
    let resolveReplacement!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReplacement = resolve;
          }),
      );
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe />);
    });
    await flushAfterPaint();
    expect(fetch).toHaveBeenCalledOnce();

    const sendReadiness = requireAgentEngineConfiguredForDispatch({
      fresh: true,
      timeoutMs: 25,
    });
    const sendFailure = expect(sendReadiness).rejects.toMatchObject({
      name: AgentChatAiSetupRequiredError.name,
      state: "unavailable",
    });
    await vi.advanceTimersByTimeAsync(10);
    await act(async () => {
      window.dispatchEvent(new Event("agent-engine:configured-changed"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      resolveInitial(jsonResponse({ configured: false, chatEligible: false }));
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(16);
    await sendFailure;

    await act(async () => {
      resolveReplacement(
        jsonResponse({ configured: true, chatEligible: true }),
      );
      await vi.advanceTimersByTimeAsync(0);
    });
    await expect(ensureAgentEngineReadiness()).resolves.toBe("configured");
  });

  it("applies a send deadline when joining a passive probe, then reuses its answer", async () => {
    vi.useFakeTimers();
    let resolveStatus!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const source = {
      statusUrl:
        "https://passive-probe.example.test/_agent-native/agent-engine/status",
      fetch: fetch as typeof globalThis.fetch,
    };
    const passiveProbe = ensureAgentEngineReadiness({ source });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const sendReadiness = requireAgentEngineConfiguredForDispatch({
      source,
      timeoutMs: 25,
    });
    const timedOutSend = expect(sendReadiness).rejects.toMatchObject({
      name: AgentChatAiSetupRequiredError.name,
      state: "unavailable",
    });
    await vi.advanceTimersByTimeAsync(25);
    await timedOutSend;
    expect(fetch).toHaveBeenCalledOnce();

    resolveStatus(jsonResponse({ configured: true, chatEligible: true }));
    await expect(passiveProbe).resolves.toBe("configured");
    await expect(
      requireAgentEngineConfiguredForDispatch({ source }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("joins the replacement probe when readiness is invalidated during a send", async () => {
    let resolveOldProbe!: (response: Response) => void;
    let resolveReplacementProbe!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOldProbe = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReplacementProbe = resolve;
          }),
      );
    const source = {
      statusUrl:
        "https://replaced-probe.example.test/_agent-native/agent-engine/status",
      fetch: fetch as typeof globalThis.fetch,
    };

    const pendingSend = requireAgentEngineConfiguredForDispatch({
      source,
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    invalidateAgentEngineReadiness(source);
    const replacementProbe = ensureAgentEngineReadiness({
      source,
      fresh: true,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    resolveOldProbe(jsonResponse({ configured: false, chatEligible: false }));
    resolveReplacementProbe(
      jsonResponse({ configured: true, chatEligible: true }),
    );

    await expect(replacementProbe).resolves.toBe("configured");
    await expect(pendingSend).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a later caller's longer deadline when an invalidated probe is replaced", async () => {
    vi.useFakeTimers();
    let resolveOldProbe!: (response: Response) => void;
    let resolveReplacementProbe!: (response: Response) => void;
    const fetch = vi
      .fn<() => Promise<Response>>()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveOldProbe = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveReplacementProbe = resolve;
          }),
      );
    const source = {
      statusUrl:
        "https://caller-deadline.example.test/_agent-native/agent-engine/status",
      fetch: fetch as typeof globalThis.fetch,
    };
    const shortCaller = ensureAgentEngineReadiness({
      source,
      fresh: true,
      timeoutMs: 25,
    });
    const longCaller = ensureAgentEngineReadiness({
      source,
      fresh: true,
      timeoutMs: 100,
    });

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(10);
    invalidateAgentEngineReadiness(source);
    resolveOldProbe(jsonResponse({ configured: false, chatEligible: false }));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    let longCallerSettled = false;
    void longCaller.then(() => {
      longCallerSettled = true;
    });
    await vi.advanceTimersByTimeAsync(16);
    await expect(shortCaller).resolves.toBe("unavailable");
    expect(longCallerSettled).toBe(false);

    resolveReplacementProbe(
      jsonResponse({ configured: true, chatEligible: true }),
    );
    await expect(longCaller).resolves.toBe("configured");
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

  it("refreshes an unscoped composer after a scoped missing-key event", async () => {
    let chatEligible = true;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/_agent-native/agent-engine/status")) {
        return jsonResponse({ chatEligible });
      }
      throw new Error(`Unexpected status route: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetch);

    await act(async () => {
      root.render(<Probe />);
    });
    await flushAfterPaint();
    expect(container.textContent).toBe("configured");

    chatEligible = false;
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("agent-chat:missing-api-key", {
          detail: { threadId: "thread-a" },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(
      fetch.mock.calls.filter(([input]) =>
        String(input).includes("/_agent-native/agent-engine/status"),
      ),
    ).toHaveLength(2);
    expect(container.textContent).toBe("missing");
  });
});

describe("requireAgentEngineConfiguredForDispatch", () => {
  const sourceFor = (name: string, fetch: typeof globalThis.fetch) => ({
    statusUrl: `https://${name}.example.test/_agent-native/agent-engine/status`,
    fetch,
  });

  it("waits for an unknown readiness probe before allowing dispatch", async () => {
    let resolveStatus!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveStatus = resolve;
        }),
    );
    const readiness = requireAgentEngineConfiguredForDispatch({
      source: sourceFor("pending-dispatch", fetch),
    });
    let settled = false;
    void readiness.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(settled).toBe(false);

    resolveStatus(jsonResponse({ configured: true, chatEligible: true }));
    await expect(readiness).resolves.toBeUndefined();
  });

  it.each([
    {
      name: "missing eligibility",
      fetch: async () =>
        jsonResponse({ configured: false, chatEligible: false }),
      state: "missing",
    },
    {
      name: "an HTTP 503",
      fetch: async () => new Response("Unavailable", { status: 503 }),
      state: "unavailable",
    },
  ] as const)(
    "blocks dispatch when readiness reports $name",
    async ({ name, fetch, state }) => {
      await expect(
        requireAgentEngineConfiguredForDispatch({
          source: sourceFor(`blocked-${name.replaceAll(" ", "-")}`, fetch),
        }),
      ).rejects.toMatchObject({
        name: AgentChatAiSetupRequiredError.name,
        state,
      });
    },
  );

  it("allows dispatch after readiness confirms chat eligibility", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ configured: true, chatEligible: true }),
    );

    await expect(
      requireAgentEngineConfiguredForDispatch({
        source: sourceFor("configured-dispatch", fetch),
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not probe for an explicitly selected local runtime engine", async () => {
    const fetch = vi.fn(async () => jsonResponse({ chatEligible: false }));

    await expect(
      requireAgentEngineConfiguredForDispatch({
        engine: "codex-cli",
        source: sourceFor("local-dispatch", fetch),
      }),
    ).resolves.toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });
});
