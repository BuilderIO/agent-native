import { afterEach, describe, expect, it, vi } from "vitest";
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
});
