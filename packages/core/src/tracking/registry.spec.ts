import { afterEach, describe, expect, it, vi } from "vitest";

import {
  protectedExecutionReceiptSchema,
  runWithProtectedExecutionContext,
} from "../protected-execution-context.js";
import {
  flushTracking,
  registerTrackingProvider,
  track,
  unregisterTrackingProvider,
} from "./registry.js";

describe("tracking registry", () => {
  afterEach(() => {
    unregisterTrackingProvider("qa-throwing-track");
    unregisterTrackingProvider("qa-rejecting-flush");
    unregisterTrackingProvider("qa-protected-track");
    vi.restoreAllMocks();
  });

  it("does not let a throwing provider break track callers", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    registerTrackingProvider({
      name: "qa-throwing-track",
      track() {
        throw new Error("provider offline");
      },
    });

    expect(() => track("qa.event", { local: true })).not.toThrow();
    expect(errorSpy).toHaveBeenCalledWith(
      '[tracking] Provider "qa-throwing-track" threw:',
      expect.any(Error),
    );
  });

  it("treats async flush failures as best-effort", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    registerTrackingProvider({
      name: "qa-rejecting-flush",
      track() {},
      async flush() {
        throw new Error("flush failed");
      },
    });

    await expect(flushTracking()).resolves.toEqual([undefined]);
    expect(errorSpy).toHaveBeenCalledWith(
      '[tracking] Provider "qa-rejecting-flush" flush rejected:',
      expect.any(Error),
    );
  });

  it("drops protected events without suppressing concurrent ordinary events", async () => {
    const canary = "protected-plaintext-canary";
    const events: unknown[] = [];
    registerTrackingProvider({
      name: "qa-protected-track",
      track(event) {
        events.push(event);
      },
    });
    const receipt = protectedExecutionReceiptSchema.parse({
      version: 1,
      actionName: "protected-read",
      resourceType: "document",
      placement: "enrolled_broker",
      status: "executed",
    });

    await Promise.all([
      runWithProtectedExecutionContext(receipt, async () => {
        await Promise.resolve();
        track("protected.event", { body: canary });
      }),
      Promise.resolve().then(() => track("ordinary.event", { visible: true })),
    ]);

    expect(events).toEqual([
      expect.objectContaining({
        name: "ordinary.event",
        properties: { visible: true },
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain(canary);
  });
});
