// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeepTabOpenNotice } from "./KeepTabOpenNotice.js";

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

function activeRun(overrides?: Record<string, unknown>) {
  return {
    active: true,
    runId: "run-1",
    status: "running",
    heartbeatAt: Date.now(),
    lastProgressAt: Date.now(),
    serverNow: Date.now(),
    dispatchMode: null,
    ...overrides,
  };
}

describe("KeepTabOpenNotice", () => {
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

  it("stays hidden for short foreground turns and appears once the run approaches the chunk boundary", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(activeRun()));
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <KeepTabOpenNotice threadId="thread-1" hosted showAfterMs={30_000} />,
      );
    });
    // First poll fires at ~2s; a run a few seconds old shows nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(container.textContent ?? "").toBe("");

    // Still the same foreground run 30s+ later — the client-driven
    // continuation boundary is imminent, so the notice appears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent).toContain("Keep this tab open");
  });

  it("never shows for a background-dispatched run (server owns the turn)", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse(activeRun({ dispatchMode: "background-processing" })),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <KeepTabOpenNotice threadId="thread-1" hosted showAfterMs={5_000} />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    expect(container.textContent ?? "").toBe("");
  });

  it("hides immediately when the run transitions to a server-owned background dispatch", async () => {
    let dispatchMode: string | null = null;
    const fetchSpy = vi.fn(async () =>
      jsonResponse(activeRun({ dispatchMode })),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <KeepTabOpenNotice threadId="thread-1" hosted showAfterMs={5_000} />,
      );
    });
    // Stepped advancement: the first act lands the poll + effect (which arms
    // the show timer); the second lets that timer fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(container.textContent).toContain("Keep this tab open");

    // The foreground self-chain handed the turn to a server-side successor
    // (or the client adopted a durable worker): the tab is no longer
    // load-bearing — no linger, hide on the next poll.
    dispatchMode = "background-processing";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(container.textContent ?? "").toBe("");
  });

  it("hides after the turn ends (with a linger so chunk gaps do not flicker it)", async () => {
    let active = true;
    const fetchSpy = vi.fn(async () =>
      active
        ? jsonResponse(activeRun())
        : jsonResponse({ active: false, status: "idle", heartbeatAt: null }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <KeepTabOpenNotice threadId="thread-1" hosted showAfterMs={5_000} />,
      );
    });
    // Stepped advancement: the first act lands the poll + effect (which arms
    // the show timer); the second lets that timer fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(container.textContent).toContain("Keep this tab open");

    active = false;
    // Shortly after the run stops the notice lingers (a continuation chunk
    // gap is sub-second; hiding instantly would flicker across boundaries)…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(container.textContent).toContain("Keep this tab open");
    // …then clears once the thread is confirmed idle.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(container.textContent ?? "").toBe("");
  });

  it("renders nothing when not hosted (local dev runs a turn in one unbounded chunk)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(activeRun()));
    vi.stubGlobal("fetch", fetchSpy);

    await act(async () => {
      root.render(
        <KeepTabOpenNotice
          threadId="thread-1"
          hosted={false}
          showAfterMs={1_000}
        />,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(container.textContent ?? "").toBe("");
    // Not hosted → the poll loop is not even scheduled.
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
