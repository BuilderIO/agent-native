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

  it("honors missing fallback when timed-out status checks follow a missing-key event", async () => {
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
    await expect(status).resolves.toBe("missing");
  });
});
