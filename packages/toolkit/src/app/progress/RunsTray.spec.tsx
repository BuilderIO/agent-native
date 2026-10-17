// @vitest-environment happy-dom

import {
  DropdownMenu,
  DropdownMenuContent,
} from "@agent-native/toolkit/ui/dropdown-menu";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunsTray, RunsTrayMenuItem } from "./RunsTray.js";

vi.mock("@agent-native/core/client/api-path", () => ({
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

  it("makes run titles keyboard-navigable menu items", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "menu-run-1",
              kind: "harness",
              source: "agent-harness",
              title: "Review slides",
              status: "completed",
              goalId: "agent-harness",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-menu" },
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
            <RunsTrayMenuItem pollMs={0} />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("Agent runs"),
      );
    });

    const trigger = document.querySelector(
      '[aria-label^="Agent runs"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const openedThreads: unknown[] = [];
    const onOpen = (event: Event) =>
      openedThreads.push((event as CustomEvent).detail);
    window.addEventListener("agent-chat:open-thread", onOpen);
    try {
      const titleItem = await vi.waitFor(() => {
        const item = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            'button[role="menuitem"]',
          ),
        ).find((button) => button.textContent?.includes("Review slides"));
        expect(item).toBeTruthy();
        return item!;
      });

      expect(titleItem.hasAttribute("data-radix-collection-item")).toBe(true);
      await act(async () => {
        titleItem.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
          }),
        );
        await vi.waitFor(() => expect(openedThreads).toHaveLength(1));
      });
      expect(openedThreads[0]).toMatchObject({ threadId: "thread-menu" });
    } finally {
      window.removeEventListener("agent-chat:open-thread", onOpen);
    }
  });

  it("keeps the runs submenu open after stopping and hiding runs", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "menu-run-2",
              kind: "agent-team",
              source: "agent-teams",
              title: "Manage the active run",
              status: "running",
              goalId: "agent-teams",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-menu-2" },
              metadata: { parentThreadId: "thread-parent-2" },
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
            <RunsTrayMenuItem pollMs={0} />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });
    const runsTrigger = document.querySelector(
      '[aria-label^="Agent runs"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      runsTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("Manage the active run"),
      );
    });

    const stopButton = document.querySelector(
      '[aria-label="Stop Manage the active run"]',
    ) as HTMLButtonElement | null;
    expect(stopButton).toBeTruthy();
    await act(async () => {
      stopButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(
          document.querySelector('[aria-label="Hide Manage the active run"]'),
        ).toBeTruthy(),
      );
    });
    expect(runsTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(runsTrigger);

    const hideButton = document.querySelector(
      '[aria-label="Hide Manage the active run"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      hideButton?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("No recent runs"),
      );
    });
    expect(runsTrigger?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(runsTrigger);
  });

  it("does not stop a run when a pointer gesture starts on another run", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "menu-run-3",
              kind: "agent-team",
              source: "agent-teams",
              title: "Manage the active run",
              status: "running",
              goalId: "agent-teams",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-menu-3" },
              metadata: { parentThreadId: "thread-parent-3" },
            },
            {
              id: "menu-run-4",
              kind: "agent-team",
              source: "agent-teams",
              title: "Another active run",
              status: "running",
              goalId: "agent-teams",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-menu-4" },
              metadata: { parentThreadId: "thread-parent-4" },
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
            <RunsTrayMenuItem pollMs={0} />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });
    const runsTrigger = document.querySelector(
      '[aria-label^="Agent runs"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      runsTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("Another active run"),
      );
    });

    const otherRunTitle = Array.from(
      document.querySelectorAll('button[role="menuitem"]'),
    ).find((button) => button.textContent?.includes("Another active run"));
    const stopButton = document.querySelector(
      '[aria-label="Stop Manage the active run"]',
    ) as HTMLButtonElement | null;
    expect(otherRunTitle).toBeTruthy();
    expect(stopButton).toBeTruthy();

    await act(async () => {
      otherRunTitle?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      stopButton?.dispatchEvent(new Event("pointerup", { bubbles: true }));
      stopButton?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          detail: 1,
        }),
      );
    });

    expect(
      fetchMock.mock.calls.filter(([input]) =>
        String(input).includes("/agent-chat/runs/menu-run-3/stop"),
      ),
    ).toHaveLength(0);
    expect(
      document.querySelector('[aria-label="Stop Manage the active run"]'),
    ).toBeTruthy();
  });

  it("does not open another run when a pointer gesture starts on an action", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "menu-run-5",
              kind: "agent-team",
              source: "agent-teams",
              title: "Manage the active run",
              status: "running",
              goalId: "agent-teams",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-menu-5" },
              metadata: { parentThreadId: "thread-parent-5" },
            },
            {
              id: "menu-run-6",
              kind: "harness",
              source: "agent-harness",
              title: "Another active run",
              status: "running",
              goalId: "agent-harness",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-menu-6" },
            },
          ],
        });
      }
      return Response.json([]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();

    await act(async () => {
      root.render(
        <DropdownMenu open onOpenChange={onOpenChange}>
          <DropdownMenuContent forceMount>
            <RunsTrayMenuItem pollMs={0} />
          </DropdownMenuContent>
        </DropdownMenu>,
      );
    });
    const runsTrigger = document.querySelector(
      '[aria-label^="Agent runs"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      runsTrigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
      await vi.waitFor(() =>
        expect(document.body.textContent).toContain("Another active run"),
      );
    });

    const openedThreads: unknown[] = [];
    const onOpen = (event: Event) =>
      openedThreads.push((event as CustomEvent).detail);
    window.addEventListener("agent-chat:open-thread", onOpen);
    try {
      const stopButton = document.querySelector(
        '[aria-label="Stop Manage the active run"]',
      ) as HTMLButtonElement | null;
      const otherRunTitle = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
      ).find((button) => button.textContent?.includes("Another active run"));
      expect(stopButton).toBeTruthy();
      expect(otherRunTitle).toBeTruthy();

      await act(async () => {
        stopButton?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        otherRunTitle?.dispatchEvent(new Event("pointerup", { bubbles: true }));
        otherRunTitle?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 0,
          }),
        );
      });

      expect(openedThreads).toHaveLength(0);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);

      const firstRunTitle = Array.from(
        document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'),
      ).find((button) => button.textContent?.includes("Manage the active run"));
      expect(firstRunTitle).toBeTruthy();

      await act(async () => {
        firstRunTitle?.dispatchEvent(
          new Event("pointerdown", { bubbles: true }),
        );
        otherRunTitle?.dispatchEvent(new Event("pointerup", { bubbles: true }));
        otherRunTitle?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 0,
          }),
        );
      });

      expect(openedThreads).toHaveLength(0);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);

      const menuContent = document.querySelector(
        '[role="menu"]',
      ) as HTMLElement | null;
      expect(menuContent).toBeTruthy();

      await act(async () => {
        menuContent?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
        otherRunTitle?.dispatchEvent(new Event("pointerup", { bubbles: true }));
        otherRunTitle?.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            detail: 0,
          }),
        );
      });

      expect(openedThreads).toHaveLength(0);
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    } finally {
      window.removeEventListener("agent-chat:open-thread", onOpen);
    }
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

  it("opens standard and unparented Agent Teams runs from their titles", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "harness-run-2",
              kind: "harness",
              source: "agent-harness",
              title: "Slides import",
              status: "running",
              goalId: "agent-harness",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "thread-slides-import" },
            },
            {
              id: "team-run-2",
              kind: "agent-team",
              source: "agent-teams",
              title: "Slides outline task",
              status: "running",
              goalId: "agent-teams",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "team-chat-thread" },
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
          document.querySelector('[aria-label="2 active runs"]'),
        ).toBeTruthy(),
      );
    });

    const trigger = document.querySelector(
      '[aria-label="2 active runs"]',
    ) as HTMLButtonElement | null;
    await act(async () => {
      trigger?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    const openedThreads: unknown[] = [];
    const onOpen = (event: Event) =>
      openedThreads.push((event as CustomEvent).detail);
    window.addEventListener("agent-chat:open-thread", onOpen);
    try {
      const titleButton = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Slides import"),
      );
      expect(titleButton).toBeTruthy();

      await act(async () => {
        titleButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await vi.waitFor(() => expect(openedThreads).toHaveLength(1));
      });

      expect(openedThreads[0]).toMatchObject({
        threadId: "thread-slides-import",
      });

      const teamTitleButton = Array.from(
        document.querySelectorAll("button"),
      ).find((button) => button.textContent?.includes("Slides outline task"));
      expect(teamTitleButton).toBeTruthy();

      await act(async () => {
        teamTitleButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await vi.waitFor(() => expect(openedThreads).toHaveLength(2));
      });

      expect(openedThreads[1]).toMatchObject({
        threadId: "team-chat-thread",
      });
    } finally {
      window.removeEventListener("agent-chat:open-thread", onOpen);
    }
  });

  it("opens an agent-team run with its parent task context", async () => {
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/agent-chat/runs/list")) {
        return Response.json({
          status: "ok",
          runs: [
            {
              id: "team-run-1",
              kind: "agent-team",
              source: "agent-teams",
              title: "Review Slides task",
              status: "running",
              goalId: "agent-teams",
              needsInput: false,
              needsApproval: false,
              createdAt: now,
              updatedAt: now,
              sourceRecord: { threadId: "child-thread" },
              metadata: {
                parentThreadId: "parent-thread",
                description: "Review the Slides task",
                name: "Slides review",
              },
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

    const openedTasks: unknown[] = [];
    const onOpen = (event: Event) =>
      openedTasks.push((event as CustomEvent).detail);
    window.addEventListener("agent-task-open", onOpen);
    try {
      const titleButton = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Review Slides task"),
      );
      expect(titleButton).toBeTruthy();

      await act(async () => {
        titleButton?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
        await vi.waitFor(() => expect(openedTasks).toHaveLength(1));
      });

      expect(openedTasks[0]).toMatchObject({
        threadId: "child-thread",
        parentThreadId: "parent-thread",
        description: "Review the Slides task",
        name: "Slides review",
      });
    } finally {
      window.removeEventListener("agent-task-open", onOpen);
    }
  });
});
