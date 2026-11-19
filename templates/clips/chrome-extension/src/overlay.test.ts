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

  const mockHello = (state: Record<string, unknown>) => {
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: () => undefined },
        sendMessage: (
          message: { type: string },
          callback?: (response: unknown) => void,
        ) =>
          callback?.(
            message.type === "CLIPS_OVERLAY_HELLO"
              ? { ok: true, state }
              : { ok: true },
          ),
      },
    };
  };

  it("excludes paused time from the visible clock without broadcasts", async () => {
    let phase = "recording";
    let baseElapsedMs = 0;
    let baseEpochMs = Date.now();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: () => undefined },
        sendMessage: (
          message: { type: string },
          callback?: (response: unknown) => void,
        ) => {
          if (message.type === "CLIPS_OVERLAY_PAUSE") {
            baseElapsedMs += Date.now() - baseEpochMs;
            phase = "paused";
          } else if (message.type === "CLIPS_OVERLAY_RESUME") {
            baseEpochMs = Date.now();
            phase = "recording";
          }
          callback?.({
            ok: true,
            state: { phase, baseElapsedMs, baseEpochMs },
          });
        },
      },
    };
    await import("./overlay");
    const clock = () => document.querySelector(".toolbar-v-time")?.textContent;
    const pause = document.querySelector<HTMLButtonElement>(".toolbar-v-pause");
    expect(pause).not.toBeNull();

    vi.advanceTimersByTime(5_000);
    expect(clock()).toBe("0:05");
    pause?.click();
    expect(clock()).toBe("0:05");
    vi.advanceTimersByTime(60_000);
    expect(clock()).toBe("0:05");
    pause?.click();
    expect(clock()).toBe("0:05");
    vi.advanceTimersByTime(3_000);
    expect(clock()).toBe("0:08");
  });

  it("ignores an older hello reply after a pause has reconciled", async () => {
    const startedAt = Date.now();
    let firstHello: ((response: unknown) => void) | undefined;
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: () => undefined },
        sendMessage: (
          message: { type: string },
          callback?: (response: unknown) => void,
        ) => {
          if (message.type === "CLIPS_OVERLAY_HELLO" && !firstHello) {
            firstHello = callback;
          } else if (message.type === "CLIPS_OVERLAY_HELLO") {
            callback?.({
              ok: true,
              state: {
                phase: "paused",
                baseElapsedMs: 5_000,
                baseEpochMs: startedAt,
              },
            });
          } else {
            callback?.({ ok: true });
          }
        },
      },
    };
    await import("./overlay");
    vi.advanceTimersByTime(5_000);
    document.querySelector<HTMLButtonElement>(".toolbar-v-pause")?.click();
    firstHello?.({
      ok: true,
      state: { phase: "recording", baseElapsedMs: 0, baseEpochMs: startedAt },
    });
    vi.advanceTimersByTime(10_000);
    expect(document.querySelector(".toolbar-v-time")?.textContent).toBe("0:05");
    expect(
      document.querySelector<HTMLButtonElement>(".toolbar-v-pause")?.title,
    ).toBe("Resume");
  });

  it("restores the authoritative clock when pause fails", async () => {
    const startedAt = Date.now();
    (globalThis as { chrome?: unknown }).chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: () => undefined },
        sendMessage: (
          message: { type: string },
          callback?: (response: unknown) => void,
        ) =>
          callback?.(
            message.type === "CLIPS_OVERLAY_HELLO"
              ? {
                  ok: true,
                  state: {
                    phase: "recording",
                    baseElapsedMs: 0,
                    baseEpochMs: startedAt,
                  },
                }
              : { ok: false },
          ),
      },
    };
    await import("./overlay");
    vi.advanceTimersByTime(5_000);
    document.querySelector<HTMLButtonElement>(".toolbar-v-pause")?.click();
    vi.advanceTimersByTime(3_000);
    expect(document.querySelector(".toolbar-v-time")?.textContent).toBe("0:08");
    expect(
      document.querySelector<HTMLButtonElement>(".toolbar-v-pause")?.title,
    ).toBe("Pause");
  });

  it("shows a paused recording's frozen time", async () => {
    mockHello({
      phase: "paused",
      baseElapsedMs: 65_000,
      baseEpochMs: Date.now() - 30_000,
      countdownEndsAtMs: 0,
    });
    await import("./overlay");
    expect(document.querySelector(".toolbar-v-time")?.textContent).toBe("1:05");
  });

  it("freezes the timer at zero on an idle reply instead of counting from epoch zero", async () => {
    mockHello({
      phase: "idle",
      baseElapsedMs: 0,
      baseEpochMs: 0,
      countdownEndsAtMs: 0,
    });
    await import("./overlay");
    expect(document.querySelector(".toolbar-v-time")?.textContent).toBe("0:00");
    vi.advanceTimersByTime(5_000);
    expect(document.querySelector(".toolbar-v-time")?.textContent).toBe("0:00");
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
