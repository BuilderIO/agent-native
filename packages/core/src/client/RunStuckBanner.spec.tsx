// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunStuckBanner } from "./RunStuckBanner.js";

vi.mock("./analytics.js", () => ({
  trackEvent: vi.fn(),
}));

vi.mock("./api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

describe("RunStuckBanner", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("automatically aborts and retries a stuck active run once", async () => {
    const onRetry = vi.fn();
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-stuck",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      if (url.includes("/runs/run-stuck/abort")) {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <RunStuckBanner threadId="thread-1" autoRetry onRetry={onRetry} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("Retrying automatically now.");
    expect(onRetry).toHaveBeenCalledWith("run-stuck");
    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/runs/run-stuck/abort") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
    expect(
      fetchSpy.mock.calls.find(
        ([url, init]) =>
          String(url).includes("/runs/run-stuck/abort") &&
          init?.method === "POST",
      )?.[1]?.body,
    ).toBe(JSON.stringify({ reason: "auto_stuck_retry" }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });

    expect(
      fetchSpy.mock.calls.filter(
        ([url, init]) =>
          String(url).includes("/runs/run-stuck/abort") &&
          init?.method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("keeps manual retry/cancel controls when auto retry is disabled", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.includes("/runs/active")) {
        return jsonResponse({
          active: true,
          runId: "run-manual",
          status: "running",
          heartbeatAt: 10_000,
          lastProgressAt: 10_000,
          serverNow: 101_000,
        });
      }
      return jsonResponse({ error: "unexpected" }, false);
    });
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(<RunStuckBanner threadId="thread-1" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(container.textContent).toContain("This chat looks stuck.");
    expect(container.textContent).toContain("Retry");
    expect(container.textContent).toContain("Cancel");
    expect(
      fetchSpy.mock.calls.some(
        ([url, init]) =>
          String(url).includes("/runs/run-manual/abort") &&
          init?.method === "POST",
      ),
    ).toBe(false);
  });
});
