// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DropdownMenu,
  DropdownMenuContent,
} from "../components/ui/dropdown-menu.js";
import { RunsTray, RunsTrayMenuItem } from "./RunsTray.js";

vi.mock("../api-path.js", () => ({
  agentNativePath: (path: string) => path,
}));

describe("RunsTrayMenuItem", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([])),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("opens the runs submenu from a click", async () => {
    await act(async () => {
      root.render(
        <DropdownMenu open>
          <DropdownMenuContent forceMount>
            <RunsTrayMenuItem pollMs={0} />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });

    expect(document.body.textContent).not.toContain("No recent runs");

    const trigger = document.querySelector(
      '[aria-label="Agent runs, No recent runs"]',
    );
    expect(trigger).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.textContent).toContain("No recent runs");
  });
});

describe("RunsTray polling", () => {
  let container: HTMLDivElement;
  let root: Root;

  const runningRun = {
    id: "run-1",
    owner: "user@example.com",
    title: "Build deck",
    percent: null,
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("keeps refreshing an active run even when idle polling is disabled", async () => {
    const fetchMock = vi.fn(async () => Response.json([runningRun]));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={0} />);
    });

    const afterMount = fetchMock.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);

    await act(async () => {
      await vi.waitFor(
        () => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterMount),
        { timeout: 15_000, interval: 250 },
      );
    });
  }, 20_000);

  it("does not poll when nothing is running and idle polling is disabled", async () => {
    const fetchMock = vi.fn(async () => Response.json([]));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={0} />);
    });

    const afterMount = fetchMock.mock.calls.length;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(fetchMock.mock.calls.length).toBe(afterMount);
  });

  it("renders a harness run from the shared background-run surface", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "harness-run-1",
              kind: "harness",
              source: "agent-harness",
              sourceLabel: "Agent Harness",
              title: "Codex harness",
              status: "needs-approval",
              goalId: "agent-harness",
              needsInput: true,
              needsApproval: true,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-harness" },
            },
          ],
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={0} hideWhenIdle={false} showRecent />);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="1 active run"]'),
        ).toBeTruthy(),
      );
    });

    const trigger = document.querySelector(
      '[aria-label="1 active run"]',
    ) as HTMLButtonElement | null;
    expect(trigger).toBeTruthy();
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.textContent).toContain("Needs approval");
    expect(
      document.querySelector('[aria-label="Stop Codex harness"]'),
    ).toBeTruthy();
  });

  // The reported bug: a chat turn streams tool calls next to the tray while the
  // tray insists there is no tracked work. Chat turns now arrive on the shared
  // background-run surface, and stopping one has to reach /abort — /stop only
  // knows durable task-backed runs and 404s on a run-manager run.
  it("renders an in-flight chat turn and stops it through the abort route", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "chat-run-1",
              kind: "chat",
              source: "agent-chat",
              sourceLabel: "Chat",
              title: "Build the triage app",
              status: "running",
              goalId: "agent-chat",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-1" },
              metadata: { threadId: "thread-1" },
            },
          ],
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={0} hideWhenIdle={false} showRecent />);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="1 active run"]'),
        ).toBeTruthy(),
      );
    });

    const trigger = document.querySelector(
      '[aria-label="1 active run"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.textContent).toContain("Build the triage app");
    expect(document.body.textContent).not.toContain("No tracked work yet");

    const stop = document.querySelector(
      '[aria-label="Stop Build the triage app"]',
    );
    expect(stop).toBeTruthy();
    await act(async () => {
      stop?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const stopCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("/runs/chat-run-1/"),
    );
    expect(stopCalls).toHaveLength(1);
    expect(String(stopCalls[0][0])).toContain("/runs/chat-run-1/abort");
  });

  it("does not offer Stop on a shared run the caller cannot abort", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "chat-run-shared",
              kind: "chat",
              source: "agent-chat",
              sourceLabel: "Chat",
              title: "Someone else's turn",
              status: "running",
              goalId: "agent-chat",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-shared" },
              metadata: { threadId: "thread-shared", canStop: false },
            },
          ],
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={0} hideWhenIdle={false} showRecent />);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="1 active run"]'),
        ).toBeTruthy(),
      );
    });
    const trigger = document.querySelector('[aria-label="1 active run"]');
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.textContent).toContain("Someone else's turn");
    expect(
      document.querySelector('[aria-label="Stop Someone else\'s turn"]'),
    ).toBeNull();
  });

  // A legacy progress run is dismissed on the server. If that DELETE fails the
  // row must come back, so the session-local filter must not have claimed it.
  it("restores a legacy run when its dismissal request fails", async () => {
    const now = new Date().toISOString();
    const legacyRun = {
      id: "legacy-run-1",
      owner: "user@example.com",
      title: "Legacy progress run",
      percent: null,
      status: "succeeded",
      startedAt: now,
      updatedAt: now,
      completedAt: now,
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: any) => {
      const url = String(input);
      if (init?.method === "DELETE") return new Response("", { status: 500 });
      if (url.includes("/agent-chat/runs/list")) {
        return Response.json({ status: "ok", runs: [] });
      }
      return Response.json([legacyRun]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={0} hideWhenIdle={false} showRecent />);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="Recent runs"]'),
        ).toBeTruthy(),
      );
    });
    const trigger = document.querySelector('[aria-label="Recent runs"]');
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.textContent).toContain("Legacy progress run");

    const hide = document.querySelector(
      '[aria-label="Hide Legacy progress run"]',
    );
    await act(async () => {
      hide?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("Legacy progress run"),
      );
    });
  });

  // Hide has no server-side dismissal for background or chat rows, and their
  // listings keep returning finished work, so without a session-local record
  // the row comes straight back on the next refresh.
  it("keeps a hidden chat run hidden across refreshes", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "chat-run-3",
              kind: "chat",
              source: "agent-chat",
              sourceLabel: "Chat",
              title: "Finished triage turn",
              status: "completed",
              goalId: "agent-chat",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-3" },
              metadata: { threadId: "thread-3" },
            },
          ],
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(<RunsTray pollMs={50} hideWhenIdle={false} showRecent />);
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="Recent runs"]'),
        ).toBeTruthy(),
      );
    });

    const trigger = document.querySelector('[aria-label="Recent runs"]');
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.textContent).toContain("Finished triage turn");

    const hide = document.querySelector(
      '[aria-label="Hide Finished triage turn"]',
    );
    expect(hide).toBeTruthy();
    await act(async () => {
      hide?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.textContent).not.toContain("Finished triage turn");

    const afterHide = fetchMock.mock.calls.length;
    await act(async () => {
      await vi.waitFor(
        () => expect(fetchMock.mock.calls.length).toBeGreaterThan(afterHide),
        { timeout: 2000, interval: 25 },
      );
    });
    expect(document.body.textContent).not.toContain("Finished triage turn");
  });

  it("shows a completed chat turn as a recent run", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "chat-run-2",
              kind: "chat",
              source: "agent-chat",
              sourceLabel: "Chat",
              title: "Add the GitHub integration skill",
              status: "completed",
              goalId: "agent-chat",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-2" },
              metadata: { threadId: "thread-2" },
            },
          ],
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      root.render(
        <DropdownMenu open>
          <DropdownMenuContent forceMount>
            <RunsTrayMenuItem pollMs={0} limit={12} showRecent />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="Agent runs, Recent runs"]'),
        ).toBeTruthy(),
      );
    });

    const trigger = document.querySelector(
      '[aria-label="Agent runs, Recent runs"]',
    );
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    expect(document.body.textContent).toContain(
      "Add the GitHub integration skill",
    );
    expect(document.body.textContent).not.toContain("No recent runs");
  });
});
