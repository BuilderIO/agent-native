import { describe, expect, it, vi } from "vitest";

import {
  protectedExecutionReceiptSchema,
  runWithProtectedExecutionContext,
} from "../protected-execution-context.js";
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

  it("replaces protected errors and context with content-free facts", () => {
    const canary = "protected-plaintext-canary";
    const provider = vi.fn(() => "evt_protected");
    const unregister = registerErrorCaptureProvider("protected-test", provider);
    const receipt = protectedExecutionReceiptSchema.parse({
      version: 1,
      actionName: "protected-read",
      resourceType: "document",
      placement: "enrolled_broker",
      status: "executed",
    });

    const result = runWithProtectedExecutionContext(receipt, () =>
      captureError(new Error(canary), {
        route: `/${canary}`,
        method: canary,
        userAgent: canary,
        tags: { raw: canary },
        extra: { raw: canary },
        contexts: { raw: { value: canary } },
      }),
    );
    unregister();

    expect(result).toBe("evt_protected");
    expect(provider).toHaveBeenCalledTimes(1);
    const [error, context] = provider.mock.calls[0]!;
    expect(error).toMatchObject({
      name: "ProtectedExecutionError",
      message: "Protected execution failed",
      code: "protected_execution_error",
    });
    expect(context).toEqual({
      tags: {
        action: "protected-read",
        resourceType: "document",
        placement: "enrolled_broker",
      },
    });
    expect(JSON.stringify([error, context])).not.toContain(canary);
  });
});
