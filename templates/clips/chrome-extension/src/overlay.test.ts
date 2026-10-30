// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./overlay.css", () => ({}));
vi.mock("./sentry", () => ({
  initExtensionSentry: () => undefined,
  captureExtensionError: () => undefined,
}));

describe("Clips recording toolbar clock", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:11:00Z"));
    document.body.innerHTML = '<div id="root"></div>';
    window.history.replaceState({}, "", "/overlay.html?part=toolbar");
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("shows the running time from the reply to its hello when no broadcast arrives", async () => {
    const startedAtMs = Date.now() - 125_000;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: () => undefined },
        sendMessage: (
          message: { type: string },
          callback?: (response: unknown) => void,
        ) => {
          callback?.(
            message.type === "CLIPS_OVERLAY_HELLO"
              ? {
                  ok: true,
                  state: {
                    phase: "recording",
                    baseElapsedMs: 0,
                    baseEpochMs: startedAtMs,
                    countdownEndsAtMs: 0,
                  },
                }
              : { ok: true },
          );
        },
      },
    };

    await import("./overlay");

    expect(document.querySelector(".toolbar-v-time")?.textContent).toBe("2:05");
  });
});
