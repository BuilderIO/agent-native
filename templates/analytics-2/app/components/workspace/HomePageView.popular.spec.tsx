// @vitest-environment jsdom

import { compareAndSetClientAppState } from "@agent-native/core/client/application-state";
import { writeClientAppState } from "@agent-native/core/client/hooks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projects: [] as Array<Record<string, unknown>>,
  failed: false,
  refetch: vi.fn(),
  state: new Map<string, unknown>(),
  t: (key: string) =>
    ({
      "analytics.lists.untitledProject": "Untitled project",
      "analytics.lists.createThread": "New thread",
      "analytics.home.promptActions.generateApp": "Generate an app",
      "analytics.home.promptActions.analyzeInNotebook": "Analyze in a notebook",
    })[key] ?? key,
}));

vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
  readClientAppState: vi.fn(
    async (key: string) => mocks.state.get(key) ?? null,
  ),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  writeClientAppState: vi.fn(async (key: string, value: unknown) => {
    mocks.state.set(key, value);
    return value;
  }),
  useActionQuery: () =>
    mocks.failed
      ? {
          data: undefined,
          isError: true,
          isLoading: false,
          refetch: mocks.refetch,
        }
      : {
          data: {
            projects: mocks.projects.map((project) => ({
              ownerName: "Owner",
              creatorName: "Creator",
              createdAt: "2026-01-01T00:00:00Z",
              lastEditedAt: "2026-01-01T00:00:00Z",
              namesUnavailable: false,
              ...project,
            })),
          },
          isError: false,
          isLoading: false,
        },
}));
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => mocks.t,
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      user: { name: "Analyst", email: "analyst@example.test" },
      workspace: { id: "org-1", name: "Workspace" },
      capabilities: [{ controlId: "create-project", status: "allowed" }],
      features: { threads: true, canExplore: true, canCreateThread: true },
    },
    activityStatus: "ready",
    contextSetup: { progressPercent: 0, completedSteps: [] },
    onCreateProject: () => undefined,
    onCreateThread: () => undefined,
  }),
}));
vi.mock("@/components/agent", () => ({
  WorkspaceAgent: ({ homeIntent }: { homeIntent?: string }) => (
    <>
      <textarea aria-label="Home prompt" />
      <output data-testid="intent">{homeIntent}</output>
    </>
  ),
}));

import { HomePageView } from "./HomePageView";
import type { RoutePageProps } from "./types";

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.hash}
    </output>
  );
}

describe("home popular projects", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.failed = false;
    mocks.state.clear();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    document.body.innerHTML = "";
  });

  const render = () =>
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <HomePageView {...({} as RoutePageProps)} />
            <LocationProbe />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

  it("row 127 restores the dismissed setup checklist and keeps it restored on remount", async () => {
    await act(async () => {
      render();
    });
    expect(host.querySelector(".ws-home-checklist")).not.toBeNull();
    await act(async () => {
      host
        .querySelector<HTMLButtonElement>(
          '.ws-home-checklist button[aria-label="Dismiss"]',
        )
        ?.click();
    });
    expect(host.querySelector(".ws-home-checklist")).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => {
      render();
    });
    expect(host.querySelector(".ws-home-checklist")).toBeNull();
    const restore = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show setup checklist",
    );
    expect(restore).toBeDefined();
    await act(async () => {
      restore!.click();
    });
    expect(host.querySelector(".ws-home-checklist")).not.toBeNull();
    expect(writeClientAppState).toHaveBeenCalledWith(
      "get-started-dismissed:org-1",
      { dismissed: false },
      { requestSource: "test-tab" },
    );
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => {
      render();
    });
    expect(host.querySelector(".ws-home-checklist")).not.toBeNull();
  });

  it("row 127 rolls back a rejected restore and allows retry after the pending write", async () => {
    mocks.state.set("get-started-dismissed:org-1", { dismissed: true });
    await act(async () => {
      render();
    });
    let rejectWrite!: (error: Error) => void;
    vi.mocked(writeClientAppState).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectWrite = reject;
        }),
    );
    const restore = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show setup checklist",
    )!;
    await act(async () => {
      restore.click();
    });
    expect(host.querySelector(".ws-home-checklist")).not.toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>(
        '.ws-home-checklist button[aria-label="Dismiss"]',
      )?.disabled,
    ).toBe(true);
    await act(async () => {
      rejectWrite(new Error("save failed"));
    });
    expect(host.querySelector(".ws-home-checklist")).toBeNull();
    const retry = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Show setup checklist",
    )!;
    expect(retry.disabled).toBe(false);
    await act(async () => {
      retry.click();
    });
    expect(host.querySelector(".ws-home-checklist")).not.toBeNull();
    expect(mocks.state.get("get-started-dismissed:org-1")).toEqual({
      dismissed: false,
    });
  });

  it("row 127 exposes management without claiming unavailable suggestions are empty", async () => {
    await act(async () => {
      render();
    });
    expect(host.textContent).toContain("Context management");
    expect(host.textContent).toContain(
      "Context suggestions are unavailable in this workspace.",
    );
    expect(host.textContent).not.toContain("No suggestions yet");
    expect(host.textContent).toContain("Your favorites");
    expect(host.textContent).toContain("Popular projects");
    const open = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Open Context Studio",
    );
    expect(open).toBeDefined();
    act(() => open!.click());
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/context-studio",
    );
  });

  it("shows the Explorations recent-work tab and retains the Threads create action", async () => {
    render();
    await act(async () => {
      await import("@/components/agent");
    });
    const tabs = [
      ...host.querySelectorAll<HTMLButtonElement>(
        '.ws-home-recents [role="tab"]',
      ),
    ];
    expect(tabs.map((tab) => tab.textContent)).toContain("Explorations");
    const explorations = tabs.find((tab) => tab.textContent === "Explorations");
    act(() => explorations?.click());
    expect(explorations?.getAttribute("aria-selected")).toBe("true");
    expect(host.querySelector('[role="tabpanel"]')?.textContent).toContain(
      "exploration",
    );
    const threads = tabs.find((tab) => tab.textContent === "Threads");
    act(() => threads?.click());
    const create = [
      ...host.querySelectorAll<HTMLButtonElement>(".ws-home-recents button"),
    ].find((button) => button.textContent === "New thread");
    expect(create).toBeDefined();
    expect(create?.disabled).toBe(false);
    act(() => create?.click());
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/thread",
    );
  });

  it("report 1794901001.666809 opens the selected context setup step", async () => {
    mocks.projects = [];
    render();
    await act(async () => {
      await import("@/components/agent");
    });
    expect(host.textContent).toContain("Curate your context");
    const connect = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Connect",
    );
    expect(connect).toBeDefined();
    act(() => connect?.click());
    expect(host.querySelector('[data-testid="location"]')?.textContent).toBe(
      "/context-studio/setup#context-setup-connect",
    );
  });

  it("report 1794901001.666809 snoozes context setup for the session", async () => {
    mocks.projects = [];
    render();
    await act(async () => {
      await import("@/components/agent");
    });
    const dismiss = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Remind me later"]',
    );
    expect(dismiss).not.toBeNull();
    await act(async () => {
      dismiss?.click();
    });
    expect(host.textContent).not.toContain("Curate your context");
    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => {
      render();
    });
    expect(host.textContent).not.toContain("Curate your context");
  });

  it("report 1794901001.666809 restores the banner if snoozing fails", async () => {
    mocks.projects = [];
    await act(async () => {
      render();
      await import("@/components/agent");
    });
    vi.mocked(writeClientAppState).mockRejectedValueOnce(
      new Error("write failed"),
    );
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Remind me later"]',
        )
        ?.click(),
    );
    expect(host.textContent).toContain("Curate your context");
  });

  it("report 1794901001.666809 wires the Get Started checklist ask step to focus the Home composer", async () => {
    await act(async () => {
      render();
      await import("@/components/agent");
    });
    const askStep = [
      ...host.querySelectorAll<HTMLButtonElement>(
        ".ws-home-checklist-steps button",
      ),
    ].find((button) =>
      button.textContent?.includes("Ask the agent a question"),
    );
    expect(askStep).toBeDefined();
    act(() => askStep?.click());
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Home prompt",
    );
  });

  it("offers notebook intent while omitting unbacked app generation", () => {
    render();
    const buttons = [...host.querySelectorAll("button")];
    expect(
      buttons.find((item) => item.textContent === "Generate an app"),
    ).toBeUndefined();
    const ask = buttons.find((item) => item.textContent === "Ask");
    const notebook = buttons.find(
      (item) => item.textContent === "Analyze in a notebook",
    );
    expect(ask?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "What do you want to know?",
    );
    expect(notebook).toBeDefined();
    act(() => notebook?.click());
    expect(host.querySelector('[data-testid="intent"]')?.textContent).toBe(
      "notebook",
    );
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "What do you want to analyze?",
    );
    expect(notebook?.getAttribute("aria-pressed")).toBe("true");
    expect(ask?.getAttribute("aria-pressed")).toBe("false");
    act(() => ask?.click());
    expect(host.querySelector(".ws-home-title")?.textContent).toBe(
      "What do you want to know?",
    );
    expect(ask?.getAttribute("aria-pressed")).toBe("true");
  });

  it("report 1794899960.825799 preserves a new Home intent when old cleanup is delayed", async () => {
    let stored: Record<string, unknown> | null = null;
    let release: (() => void) | undefined;
    let held = false;
    vi.mocked(writeClientAppState).mockImplementation(async (_key, value) => {
      stored = value as Record<string, unknown>;
      return value;
    });
    vi.mocked(compareAndSetClientAppState).mockImplementation(
      async (_key, expected) => {
        if (expected?.intent === "notebook" && !held) {
          held = true;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        if (JSON.stringify(stored) !== JSON.stringify(expected)) return false;
        stored = null;
        return true;
      },
    );
    render();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Analyze in a notebook")
        ?.click();
    });
    await vi.waitFor(() =>
      expect(stored).toMatchObject({ intent: "notebook" }),
    );
    await act(async () => root.unmount());
    await vi.waitFor(() => expect(release).toBeDefined());
    root = createRoot(host);
    render();
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent === "Analyze in a notebook")
        ?.click();
    });
    await vi.waitFor(() =>
      expect(stored).toMatchObject({ intent: "notebook" }),
    );
    await act(async () => {
      release?.();
    });
    expect(stored).toMatchObject({ intent: "notebook" });
    vi.mocked(writeClientAppState).mockReset().mockResolvedValue(null);
    vi.mocked(compareAndSetClientAppState).mockReset().mockResolvedValue(false);
  });

  it("report 281 displays an error when popular projects fail to load", () => {
    mocks.failed = true;
    render();
    expect(host.textContent).toContain(
      "There was an error loading popular projects",
    );
  });

  it("report 281 retries the popular projects read from the error state", () => {
    mocks.failed = true;
    mocks.refetch.mockClear();
    render();
    const retry = Array.from(host.querySelectorAll("button")).find(
      (button) => button.textContent === "Try again",
    );
    expect(retry).toBeDefined();
    act(() => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });

  it("renders the most-viewed projects with their viewer counts", () => {
    mocks.projects = [
      { id: "d1", title: "Quarterly revenue", viewCount: 7 },
      { id: "d2", title: "", viewCount: 3 },
    ];
    render();
    const text = host.textContent ?? "";
    expect(text).toContain("Popular this week");
    expect(text).toContain("Quarterly revenue");
    expect(text).toContain("Untitled project");
    expect(text).toContain("7");
    expect(text).toContain("3");
  });

  it("renders the section's own empty state when nothing has been viewed", () => {
    mocks.projects = [];
    render();
    expect(host.textContent ?? "").toContain(
      "Popular projects will show you what's being frequently viewed in your workspace.",
    );
  });
});
