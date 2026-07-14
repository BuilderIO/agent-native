// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("returns unknown when every status check times out", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const status = fetchAgentEngineConfiguredState(true, { timeoutMs: 25 });

    await vi.advanceTimersByTimeAsync(25);
    await expect(status).resolves.toBe("unknown");
  });

  it("does not use missing fallback after timed-out status checks", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );

    const status = fetchAgentEngineConfiguredState(true, {
      missingFallback: true,
      timeoutMs: 25,
    });

    await vi.advanceTimersByTimeAsync(25);
    await expect(status).resolves.toBe("unknown");
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
