import { describe, expect, it, vi } from "vitest";

import { captureError, registerErrorCaptureProvider } from "./capture-error.js";

describe("server captureError", () => {
  it("no-ops when no capture provider is registered", () => {
    expect(captureError(new Error("boom"))).toBeUndefined();
  });

  it("forwards errors and context to registered providers", () => {
    const err = new Error("boom");
    const provider = vi.fn(() => "evt_test");
    const unregister = registerErrorCaptureProvider("test", provider);

    const result = captureError(err, {
      route: "/_agent-native/agent-chat",
      tags: { source: "agent-run-manager" },
      extra: { runId: "run_123" },
    });

    unregister();

    expect(result).toBe("evt_test");
    expect(provider).toHaveBeenCalledWith(err, {
      route: "/_agent-native/agent-chat",
      tags: { source: "agent-run-manager" },
      extra: { runId: "run_123" },
    });
  });

  it("keeps going when a provider throws", () => {
    const throwing = vi.fn(() => {
      throw new Error("provider failed");
    });
    const working = vi.fn(() => "evt_ok");
    const unregisterThrowing = registerErrorCaptureProvider(
      "throwing",
      throwing,
    );
    const unregisterWorking = registerErrorCaptureProvider("working", working);

    const result = captureError(new Error("boom"));

    unregisterThrowing();
    unregisterWorking();

    expect(result).toBe("evt_ok");
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(working).toHaveBeenCalledTimes(1);
  });
});
