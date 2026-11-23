// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  mutateAsync: vi.fn(async (_input?: unknown) => ({
    id: "thread-1",
    deleted: true,
  })),
  actionHandlers: {} as Record<string, (input: unknown) => Promise<unknown>>,
  turns: [] as Array<Record<string, unknown>>,
  refetch: vi.fn(),
  queryError: null as Error | null,
  queryErrorCode: undefined as string | undefined,
  keepDataOnError: false,
  threads: [] as Array<Record<string, unknown>>,
  queries: [] as Array<{ name: string; input: unknown }>,
  t: (key: string, values?: Record<string, string>) =>
    key === "analytics.lists.deleteThreadDescription"
      ? `${values?.name} will be deleted for you. This cannot be undone.`
      : key === "analytics.lists.actionsFor"
        ? `Actions for ${values?.name}`
        : key.startsWith("analytics.lists.")
          ? key.slice("analytics.lists.".length)
          : key,
  workspaceEmail: "qa@example.test",
  sessionEmail: "qa@example.test",
  sessionLoading: false,
  orgId: "org-1",
  orgError: false,
  orgRefetch: vi.fn(),
  turnsError: false,
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  notifyChatThreadsUpdated: mocks.notify,
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  actionErrorCode: () => mocks.queryErrorCode,
  actionErrorMessage: () => undefined,
  getBrowserTabId: () => "tab-1",
  writeClientAppState: vi.fn(async () => {}),
  useActionMutation: (name: string) => ({
    isPending: false,
    mutateAsync: (input: unknown) => {
      const handler = mocks.actionHandlers[name];
      if (handler) return handler(input);
      return mocks.mutateAsync(input);
    },
  }),
  useActionQuery: (
    name: string,
    input?: unknown,
    options?: { enabled?: boolean },
  ) => {
    mocks.queries.push({ name, input });
    if (options?.enabled === false) {
      return {
        data: undefined,
        error: null,
        isPending: false,
        isError: false,
        refetch: mocks.refetch,
      };
    }
    if (name === "get-analytics-thread-turns" && mocks.turnsError) {
      return {
        data: undefined,
        isPending: false,
        isError: true,
        refetch: mocks.refetch,
      };
    }
    if (name === "get-analytics-thread-turns") {
      return {
        data: { turns: mocks.turns, next: null },
        isPending: false,
        isError: false,
      };
    }
    const thread = mocks.threads[0];
    return {
      data:
        mocks.queryError && !mocks.keepDataOnError
          ? undefined
          : {
              thread: thread
                ? {
                    ...thread,
                    owned: thread.accessBasis === "owner",
                  }
                : undefined,
              binding: thread?.binding ?? null,
              workingHead: null,
              listed: true,
              canSubmit: thread?.canSubmit ?? true,
              canShare: thread?.accessBasis === "owner",
              throughSequence: null,
            },
      error: mocks.queryError,
      refetch: mocks.refetch,
    };
  },
}));
vi.mock("@agent-native/core/client/use-session", () => ({
  useSession: () => ({
    session: { email: mocks.sessionEmail },
    isLoading: mocks.sessionLoading,
  }),
}));
vi.mock("@agent-native/core/client/org", () => ({
  useOrg: () =>
    mocks.orgError
      ? {
          data: undefined,
          isPending: false,
          isError: true,
          refetch: mocks.orgRefetch,
        }
      : {
          data: { orgId: mocks.orgId },
          isPending: false,
          isError: false,
          refetch: mocks.orgRefetch,
        },
}));
vi.mock("@agent-native/core/client/i18n", () => ({ useT: () => mocks.t }));
vi.mock("@/components/agent", () => ({
  WorkspaceAgent: () => <div data-testid="agent" />,
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      workspace: { id: "org-1" },
      user: { email: mocks.workspaceEmail },
    },
  }),
}));

import { ThreadPage } from "./ThreadPage";

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <output data-testid="path">{location.pathname}</output>
      <output data-testid="search">{location.search}</output>
    </>
  );
}

function pointerDown(element: HTMLElement) {
  element.dispatchEvent(
    new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
  );
}

describe("thread page delete control", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.threads = [
      { id: "thread-1", title: "Revenue by channel", accessBasis: "owner" },
    ];
    mocks.actionHandlers = {};
    mocks.queries = [];
    mocks.turns = [];
    mocks.queryError = null;
    mocks.queryErrorCode = undefined;
    mocks.keepDataOnError = false;
    mocks.workspaceEmail = "qa@example.test";
    mocks.sessionEmail = "qa@example.test";
    mocks.sessionLoading = false;
    mocks.orgId = "org-1";
    mocks.orgError = false;
    mocks.turnsError = false;
    mocks.orgRefetch.mockClear();
    mocks.refetch.mockClear();
    mocks.mutateAsync.mockResolvedValue({ id: "thread-1", deleted: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    mocks.notify.mockClear();
    mocks.mutateAsync.mockClear();
  });

  const render = (
    initialEntries = ["/thread/thread-1"],
    routeParams: Record<string, string | undefined> = { threadId: "thread-1" },
  ) =>
    act(() => {
      const queryClient = new QueryClient();
      root.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={initialEntries}>
            <LocationProbe />
            <ThreadPage route={{ params: routeParams } as never} />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

  it("shows a thread skeleton until the session loads and opens the chat only for the verified identity", async () => {
    mocks.sessionLoading = true;
    render();
    expect(host.querySelector('[data-testid="agent"]')).toBeNull();
    expect(host.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(document.title).toBe("analytics.brand");
    mocks.sessionLoading = false;
    render();
    const originalAgent = host.querySelector('[data-testid="agent"]');
    expect(originalAgent).not.toBeNull();
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Revenue by channel"]',
    );
    if (!trigger) throw new Error("Owner actions trigger was not rendered.");
    await act(async () => pointerDown(trigger));
    const item = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((element) => element.textContent?.includes("deleteThread"));
    if (!item) throw new Error("Delete menu item was not rendered.");
    await act(async () => item.click());
    expect(document.body.textContent).toContain(
      "Revenue by channel will be deleted for you.",
    );
    let completeDelete!: (value: { id: string; deleted: boolean }) => void;
    mocks.mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          completeDelete = resolve;
        }),
    );
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>("button"),
    ].find((button) => button.textContent?.includes("deleteThreadConfirm"));
    if (!confirm) throw new Error("Confirm delete was not rendered.");
    await act(async () => confirm.click());
    mocks.sessionEmail = "new@example.test";
    mocks.workspaceEmail = "new@example.test";
    render();
    expect(host.querySelector('[data-testid="agent"]')).not.toBe(originalAgent);
    expect(document.body.textContent).not.toContain(
      "Revenue by channel will be deleted for you.",
    );
    await act(async () => completeDelete({ id: "thread-1", deleted: true }));
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/thread/thread-1",
    );
    mocks.sessionEmail = "qa@example.test";
    mocks.workspaceEmail = "qa@example.test";
    mocks.orgId = "different-org";
    render();
    expect(host.querySelector('[data-testid="agent"]')).toBeNull();
    expect(document.title).toBe("analytics.brand");
    mocks.orgId = "org-1";
    mocks.sessionEmail = "other@example.test";
    render();
    expect(host.querySelector('[data-testid="agent"]')).toBeNull();
    expect(document.title).toBe("analytics.brand");
  });

  it("titles an exact blank thread absent from history and follows its renamed summary", () => {
    mocks.threads = [{ id: "thread-1", title: "", accessBasis: "owner" }];
    render();
    expect(document.title).toBe("untitledThread");
    mocks.threads = [
      { id: "thread-1", title: "Renamed exact thread", accessBasis: "owner" },
    ];
    render();
    expect(document.title).toBe("Renamed exact thread");
  });

  it("refreshes exact thread metadata after a thread update and surfaces unreadable metadata", () => {
    render();
    mocks.refetch.mockClear();
    act(() => window.dispatchEvent(new Event("agent-chat:threads-updated")));
    expect(mocks.refetch).toHaveBeenCalledOnce();
    mocks.queryError = new Error("unreadable");
    render();
    expect(document.title).toBe("analytics.brand");
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "analytics.ask.threadLoadError",
    );
    expect(
      host.querySelector('button[aria-label="Actions for Revenue by channel"]'),
    ).toBeNull();
  });

  it("keeps the open conversation mounted when a background summary refetch fails", () => {
    render();
    const agent = host.querySelector('[data-testid="agent"]');
    expect(agent).not.toBeNull();
    mocks.queryError = new Error("Too many requests");
    mocks.keepDataOnError = true;
    render();
    expect(host.querySelector('[data-testid="agent"]')).toBe(agent);
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(
      host.querySelector('button[aria-label="Actions for Revenue by channel"]'),
    ).not.toBeNull();
  });

  it("explains a missing thread and offers Retry and a way back to Threads", () => {
    mocks.queryError = new Error(
      "Thread not found in the active Analytics workspace.",
    );
    mocks.queryErrorCode = "not_found";
    render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "analytics.ask.threadNotFound",
    );
    mocks.refetch.mockClear();
    const retry = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "analytics.ask.threadRetry",
    );
    expect(retry).toBeTruthy();
    act(() => retry!.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    const back = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "analytics.ask.threadBackToThreads",
    );
    expect(back).toBeTruthy();
    act(() => back!.click());
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/home/threads",
    );
  });

  it("lets the owner confirm deletion and returns to Threads", async () => {
    render();
    expect(host.querySelector('[data-testid="agent"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/thread/thread-1",
    );
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Revenue by channel"]',
    );
    if (!trigger) throw new Error("Owner actions trigger was not rendered.");
    await act(async () => pointerDown(trigger));
    const deleteItem = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent?.includes("deleteThread"));
    if (!deleteItem) throw new Error("Delete menu item was not rendered.");
    await act(async () => {
      deleteItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain(
      "Revenue by channel will be deleted for you.",
    );

    const confirmButtons = [...document.body.querySelectorAll("button")].filter(
      (button) => button.textContent?.includes("deleteThreadConfirm"),
    );
    await act(async () => {
      confirmButtons.at(-1)?.click();
      await Promise.resolve();
    });

    expect(mocks.mutateAsync).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/home/threads",
    );
  });

  it("does not offer deletion for a thread the viewer does not own", () => {
    mocks.threads = [
      { id: "thread-1", title: "Shared thread", accessBasis: "shared" },
    ];
    render();
    expect(
      host.querySelector('button[aria-label="Actions for Shared thread"]'),
    ).toBeNull();
  });

  it("keeps the thread open and shows an error when deletion fails", async () => {
    render();
    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Actions for Revenue by channel"]',
    );
    if (!trigger) throw new Error("Owner actions trigger was not rendered.");
    await act(async () => pointerDown(trigger));
    const deleteItem = [
      ...document.querySelectorAll<HTMLElement>("[role=menuitem]"),
    ].find((item) => item.textContent?.includes("deleteThread"));
    if (!deleteItem) throw new Error("Delete menu item was not rendered.");
    await act(async () => {
      deleteItem.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    mocks.mutateAsync.mockRejectedValueOnce(new Error("failure"));
    await act(async () => {
      [...document.body.querySelectorAll("button")]
        .filter((button) => button.textContent?.includes("deleteThreadConfirm"))
        .at(-1)
        ?.click();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/thread/thread-1",
    );
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "deleteThreadFailed",
    );
  });

  it("report A2-ACTIVE-THREAD-TITLE-PAGED-METADATA renders the summary title for a shared Ask thread", () => {
    mocks.threads = [
      {
        id: "thread-1",
        title: "Q4 Revenue Breakdown",
        accessBasis: "shared",
        binding: { threadId: "thread-1", projectId: "proj-1" },
        canSubmit: false,
      },
    ];
    render();
    expect(host.querySelector("h1")?.textContent).toBe("Q4 Revenue Breakdown");
    expect(document.title).toContain("Q4 Revenue Breakdown");
  });

  it("report A2-ACTIVE-THREAD-TITLE-PAGED-METADATA renders the title of an older owned thread by asking for that exact thread", () => {
    mocks.threads = [
      { id: "thread-old-9", title: "FY22 churn review", accessBasis: "owner" },
    ];
    render(["/thread/thread-old-9"], { threadId: "thread-old-9" });
    expect(host.querySelector("h1")?.textContent).toBe("FY22 churn review");
    expect(document.title).toContain("FY22 churn review");
    expect(mocks.queries).toContainEqual({
      name: "get-thread-summary",
      input: { threadId: "thread-old-9" },
    });
    expect(mocks.queries.some(({ name }) => name === "list-threads")).toBe(
      false,
    );
  });

  it("report A2-FIND-1120F-S1-7 shows thread not-found and thread load errors instead of list load error", () => {
    mocks.queryError = new Error("Action get-thread-summary failed");
    mocks.queryErrorCode = "not_found";
    render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "analytics.ask.threadNotFound",
    );

    mocks.queryErrorCode = undefined;
    render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "analytics.ask.threadLoadError",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).not.toBe(
      "analytics.home.recents.loadError",
    );
  });

  const remount = (
    initialEntries: string[],
    routeParams: Record<string, string | undefined>,
  ) => {
    act(() => root.unmount());
    root = createRoot(host);
    render(initialEntries, routeParams);
  };

  it("report A2-FIND-1120F-S4-5 makes Notebook and App builder tabs create and open projects on unsaved and unbound threads", async () => {
    mocks.threads = [];
    const createProject = vi.fn(async () => ({
      requestId: "req-1",
      projectId: "proj-new",
      id: "proj-new",
      workingVersionId: "ver-1",
      committedAt: "2026-11-21T00:00:00.000Z",
      href: "/project/proj-new/latest",
      snapshot: {
        status: "accepted",
        snapshot: {
          workspaceId: "org-1",
          projectId: "proj-new",
          head: { versionId: "ver-1", revision: 0 },
          eventSeq: "0",
        },
        metadata: { title: "Untitled project", description: "" },
        resources: [],
        cells: [],
      },
    }));
    const bindThread = vi.fn(async () => ({
      projectId: "proj-bound",
      threadId: "thread-1",
      bindingId: "bind-1",
      workingVersionId: "ver-1",
      overlayRevision: "0",
    }));
    mocks.actionHandlers = {
      "create-project": createProject,
      "bind-notebook-thread": bindThread,
    };

    remount(["/thread"], {});
    const navButtons = () => [...host.querySelectorAll("nav a, nav button")];
    const notebookTab = navButtons().find((el) =>
      el.textContent.includes("analytics.ask.notebookTab"),
    ) as HTMLButtonElement | undefined;
    const appTab = navButtons().find((el) =>
      el.textContent.includes("analytics.ask.appBuilderTab"),
    ) as HTMLButtonElement | undefined;
    expect(notebookTab).toBeTruthy();
    expect(appTab).toBeTruthy();

    await act(async () => {
      notebookTab?.click();
      await Promise.resolve();
    });
    expect(createProject).toHaveBeenCalledTimes(1);
    expect(bindThread).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/project/proj-new/latest",
    );

    remount(["/thread"], {});
    const appTab2 = [...host.querySelectorAll("nav button")].find((el) =>
      el.textContent.includes("analytics.ask.appBuilderTab"),
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      appTab2?.click();
      await Promise.resolve();
    });
    expect(createProject).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/project/proj-new/latest/ui",
    );

    mocks.threads = [
      { id: "thread-1", title: "Draft exploration", accessBasis: "owner" },
    ];
    createProject.mockResolvedValueOnce({
      requestId: "req-2",
      projectId: "proj-bound",
      id: "proj-bound",
      workingVersionId: "ver-2",
      committedAt: "2026-11-21T00:00:00.000Z",
      href: "/project/proj-bound/latest",
      snapshot: {
        status: "accepted",
        snapshot: {
          workspaceId: "org-1",
          projectId: "proj-bound",
          head: { versionId: "ver-2", revision: 0 },
          eventSeq: "0",
        },
        metadata: { title: "Draft exploration", description: "" },
        resources: [],
        cells: [],
      },
    });
    remount(["/thread/thread-1"], { threadId: "thread-1" });
    const unboundNotebookTab = [...host.querySelectorAll("nav button")].find(
      (el) => el.textContent.includes("analytics.ask.notebookTab"),
    ) as HTMLButtonElement | undefined;
    expect(unboundNotebookTab).toBeTruthy();
    await act(async () => {
      unboundNotebookTab?.click();
      await Promise.resolve();
    });
    expect(createProject).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Draft exploration" }),
    );
    expect(bindThread).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "proj-bound",
        threadId: "thread-1",
        head: { versionId: "ver-2", revision: 0 },
      }),
    );
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/project/proj-bound/latest",
    );

    createProject.mockRejectedValueOnce(new Error("forbidden"));
    mocks.threads = [];
    remount(["/thread"], {});
    const failingNotebookTab = [...host.querySelectorAll("nav button")].find(
      (el) => el.textContent.includes("analytics.ask.notebookTab"),
    ) as HTMLButtonElement | undefined;
    await act(async () => {
      failingNotebookTab?.click();
      await Promise.resolve();
    });
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/thread",
    );
    expect(failingNotebookTab?.disabled).toBe(false);
  });

  it("report A2-FIND-1120F-S4-1 toggles the Thread Inspector panel and syncs ?threadInspector=open", async () => {
    mocks.threads = [
      {
        id: "thread-1",
        title: "Revenue analysis",
        accessBasis: "owner",
        binding: {
          threadId: "thread-1",
          projectId: "proj-1",
          bindingId: "bind-1",
          workingVersionId: "ver-1",
          href: "/thread/thread-1",
        },
        canSubmit: true,
      },
    ];
    mocks.turns = [
      {
        receipt: {
          threadId: "thread-1",
          messageId: "msg-1",
          sequence: "1",
          phase: "complete",
          runId: "run-1",
          acceptedAt: "2026-11-21T00:00:00.000Z",
        },
        denied: false,
        answerBlocks: [{ kind: "markdown", text: "Total revenue is $1M." }],
        chartArtifacts: [],
        toolReceipts: [
          {
            id: "tool-1",
            name: "run_sql_cell",
            state: "complete",
            label: "Ran SQL query",
          },
        ],
        durationMs: 2000,
      },
    ];

    render(["/thread/thread-1"], { threadId: "thread-1" });
    const toggle = host.querySelector<HTMLButtonElement>(
      'button[aria-label="analytics.ask.headerActions.showThreadInspector"]',
    );
    expect(toggle).not.toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      toggle?.click();
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain(
      "analytics.ask.headerActions.threadDetails",
    );
    expect(dialog?.textContent).toContain("thread-1");
    expect(dialog?.textContent).toContain("1");
    expect(dialog?.textContent).toContain(
      "analytics.ask.headerActions.can-reply",
    );
    expect(host.querySelector('[data-testid="search"]')?.textContent).toBe(
      "?threadInspector=open",
    );

    const closeBtn = dialog?.querySelector<HTMLButtonElement>(
      'button[aria-label="analytics.ask.headerActions.closePanel"]',
    );
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="search"]')?.textContent).toBe("");

    remount(["/thread/thread-1?threadInspector=open"], {
      threadId: "thread-1",
    });
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("report A2-FIND-S4-ORG-ERROR-BLANK shows a recoverable error instead of a blank page when the organization fails to load", () => {
    mocks.orgError = true;
    render();
    expect(host.querySelector('[data-testid="agent"]')).toBeNull();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe(
      "analytics.ask.threadLoadError",
    );
    const retry = [...host.querySelectorAll("button")].find(
      (b) => b.textContent === "analytics.ask.threadRetry",
    );
    if (!retry) throw new Error("Retry was not rendered.");
    act(() => retry.click());
    expect(mocks.orgRefetch).toHaveBeenCalledOnce();
    const back = [...host.querySelectorAll("a")].find(
      (a) => a.textContent === "analytics.ask.threadBackToThreads",
    );
    if (!back) throw new Error("Back to threads was not rendered.");
    expect(back.getAttribute("href")).toBe("/home/threads");
    act(() => back.click());
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/home/threads",
    );
  });

  it("report A2-FIND-S4-SHARED-THREAD-ERROR-NO-RETRY offers Retry and a way back when a shared thread's turns fail to load", () => {
    mocks.turnsError = true;
    mocks.threads = [
      {
        id: "thread-1",
        title: "Shared revenue",
        accessBasis: "shared",
        binding: { threadId: "thread-1", projectId: "proj-1" },
        canSubmit: false,
      },
    ];
    render();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("analytics.ask.turnsUnreadable");
    const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "analytics.ask.threadRetry",
    );
    if (!retry) throw new Error("Retry was not rendered.");
    mocks.refetch.mockClear();
    act(() => retry.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    const back = [...(alert?.querySelectorAll("a") ?? [])].find(
      (a) => a.textContent === "analytics.ask.threadBackToThreads",
    );
    if (!back) throw new Error("Back to threads was not rendered.");
    expect(back.getAttribute("href")).toBe("/home/threads");
  });

  it("report A2-FIND-S4-SHARED-THREAD-ERROR-NO-RETRY offers Retry in the Thread Inspector Tools tab when turns fail to load", async () => {
    mocks.turnsError = true;
    mocks.threads = [
      {
        id: "thread-1",
        title: "Revenue analysis",
        accessBasis: "owner",
        binding: {
          threadId: "thread-1",
          projectId: "proj-1",
          bindingId: "bind-1",
          workingVersionId: "ver-1",
          href: "/thread/thread-1",
        },
        canSubmit: true,
      },
    ];
    render(["/thread/thread-1?threadInspector=open"], {
      threadId: "thread-1",
    });
    const dialog = document.body.querySelector('[role="dialog"]');
    const toolsTab = [
      ...(dialog?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
    ].find((tab) => tab.textContent === "observability.tools");
    if (!toolsTab) throw new Error("Tools tab was not rendered.");
    await act(async () => {
      toolsTab.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      toolsTab.focus();
    });
    const alert = dialog?.querySelector('[role="tabpanel"] [role="alert"]');
    expect(alert?.textContent).toContain("analytics.ask.turnsUnreadable");
    const retry = [...(alert?.querySelectorAll("button") ?? [])].find(
      (b) => b.textContent === "analytics.ask.threadRetry",
    );
    if (!retry) throw new Error("Retry was not rendered.");
    mocks.refetch.mockClear();
    act(() => retry.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("A2-ASK-SAVE-FAILED-FLASH renders WorkspaceAgent immediately while thread summary is pending so chat streaming is not interrupted", () => {
    mocks.threads = [];
    render(["/thread/thread-streaming"], { threadId: "thread-streaming" });
    expect(host.querySelector('[data-testid="agent"]')).not.toBeNull();
  });
});
