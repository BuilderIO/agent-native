// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CANVAS_IMAGE_DENIED_MESSAGE } from "../../../../shared/canvas-image-url";

const mocks = vi.hoisted(() => ({ callAction: vi.fn() }));

vi.mock("@agent-native/core/client/use-action", () => ({
  callAction: mocks.callAction,
}));

const PHOTO = "https://images.example.com/a/photo.jpg";
const NOW = Date.UTC(2026, 5, 10, 12, 0, 0);
const EXP = Date.UTC(2026, 5, 11, 0, 0, 0) / 1000;

function available(token: string, exp = EXP) {
  return { available: true, subject: "subj_-1", exp, token };
}

async function load() {
  vi.resetModules();
  const sources = await import("./canvas-image-sources");
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      createElement(() => {
        sources.useCanvasImagesReady();
        return null;
      }),
    );
  });
  return sources;
}

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

const listeners: Array<[string, EventListenerOrEventListenerObject]> = [];
const addListener = window.addEventListener.bind(window);

beforeEach(() => {
  vi.spyOn(window, "addEventListener").mockImplementation(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.push([type, listener]);
      addListener(type, listener);
    },
  );
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  mocks.callAction.mockReset();
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const [type, listener] of listeners.splice(0)) {
    window.removeEventListener(type, listener);
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("canvas image token", () => {
  it("requests the token once on first use and rewrites with it afterwards", async () => {
    mocks.callAction.mockResolvedValue(available("tok_1"));
    const sources = await load();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    expect(mocks.callAction).toHaveBeenCalledWith(
      "get-canvas-image-token",
      {},
      { method: "GET" },
    );
    await flush();
    const out = sources.withCanvasRenderSources(`<img src="${PHOTO}">`);
    expect(out).toContain("/api/canvas-image?src=");
    expect(out).toContain("&amp;t=tok_1");
    expect(sources.canvasImageBootstrapMarkup()).toContain("tok_1");
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
  });

  it("keeps originals when the proxy is unavailable", async () => {
    mocks.callAction.mockResolvedValue({ available: false });
    const sources = await load();
    await flush();
    const html = `<img src="${PHOTO}">`;
    expect(sources.withCanvasRenderSources(html)).toBe(html);
    expect(sources.canvasImageBootstrapMarkup()).toBe("");
  });

  it("holds frames until the request settles, then releases them once", async () => {
    let resolve: (value: unknown) => void = () => {};
    mocks.callAction.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const sources = await load();
    const seen: boolean[] = [];
    function Probe() {
      seen.push(sources.useCanvasImagesReady());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(Probe));
    });
    expect(seen).toEqual([false]);
    await act(async () => {
      resolve(available("tok_1"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen).toEqual([false, true]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(seen).toEqual([false, true]);
  });

  it("stops waiting after the bound and never revokes readiness", async () => {
    mocks.callAction.mockReturnValue(new Promise(() => {}));
    const sources = await load();
    const seen: boolean[] = [];
    function Probe() {
      seen.push(sources.useCanvasImagesReady());
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(Probe));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(seen).toEqual([false, true]);
    expect(sources.canvasImageBootstrapMarkup()).toBe("");
  });

  it("retries a failed request with backoff instead of a tight loop", async () => {
    mocks.callAction
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(available("tok_retry"));
    const sources = await load();
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1900);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(sources.canvasImageBootstrapMarkup()).toContain("tok_retry");
  });

  it("refreshes shortly before the token expires without touching the old output", async () => {
    mocks.callAction
      .mockResolvedValueOnce(available("tok_old"))
      .mockResolvedValueOnce(available("tok_new", EXP + 86400));
    const sources = await load();
    await flush();
    const before = sources.withCanvasRenderSources(`<img src="${PHOTO}">`);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXP * 1000 - NOW - 11 * 60 * 1000);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    });
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(before).toContain("tok_old");
    expect(sources.canvasImageBootstrapMarkup()).toContain("tok_new");
  });

  it("refreshes once when a frame reports a denied image, at most once a minute", async () => {
    mocks.callAction
      .mockResolvedValueOnce(available("tok_old"))
      .mockResolvedValueOnce(available("tok_new"));
    const sources = await load();
    await flush();
    const denied = () =>
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: CANVAS_IMAGE_DENIED_MESSAGE },
        }),
      );
    denied();
    expect(mocks.callAction).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    denied();
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    denied();
    await flush();
    expect(mocks.callAction).toHaveBeenCalledTimes(2);
    expect(sources.canvasImageBootstrapMarkup()).toContain("tok_new");
  });
});
