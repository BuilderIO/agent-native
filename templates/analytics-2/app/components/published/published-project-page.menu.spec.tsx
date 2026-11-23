// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkspaceDataContext } from "@/components/workspace/WorkspaceDataContext";
import messages from "@/i18n/en-US";
import { projectDocumentSchema } from "@/lib/model/contracts";
import { resolveRoute } from "@/routes/routing/registry";

const viewerSpy = vi.hoisted(() => ({
  refresh: vi.fn(),
  reset: vi.fn(),
  setInput: vi.fn(),
  saveBookmark: vi.fn(async () => ({})),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueries: () => [],
  };
});

vi.mock("@agent-native/core/client/review/use-review", () => ({
  useReviewComments: ({
    resourceType,
    resourceId,
  }: {
    resourceType: string;
    resourceId: string;
  }) => ({
    isLoading: false,
    isError: false,
    data: {
      comments: [
        {
          id: "comment-1",
          resourceType,
          resourceId,
          threadId: "thread-1",
          parentCommentId: null,
          targetId: null,
          kind: "comment",
          status: "open",
          anchor: null,
          body: "Check Q4 numbers",
          authorEmail: "editor@example.invalid",
          authorName: "Editor",
          createdBy: "human",
          resolutionTarget: "human",
          mentions: [],
          ownerEmail: "reader@example.invalid",
          orgId: "org-1",
          visibility: "private",
          resolvedBy: null,
          resolvedAt: null,
          consumedAt: null,
          deletedBy: null,
          deletedAt: null,
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "2026-11-15T00:00:00.000Z",
          metadata: null,
          canDelete: true,
          canDeleteThread: true,
        },
      ],
      discussion: {
        reactions: {},
        threadPreferences: {},
        canReact: false,
        canSetThreadPreferences: false,
      },
      reviewStatus: null,
      summary: { openCount: 1, agentQueueCount: 0 },
    },
  }),
  useCreateReviewComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReplyReviewComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useResolveReviewThread: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteReviewComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReactToReviewComment: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateReviewComment: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@agent-native/toolkit/app/chat", () => ({
  AgentChatHome: () => null,
  AgentChatSurface: ({ scope }: { scope: { id: string } }) => (
    <div data-testid="published-agent-surface">{scope.id}</div>
  ),
}));

vi.mock("@/components/sharing/PublishedAppSharePopover", () => ({
  PublishedAppSharePopover: () => <button type="button">Share</button>,
}));

vi.mock("./PublishedAppSchedulePanel", () => ({
  PublishedAppSchedulePanel: () => null,
}));

vi.mock("./usePublishedAppSession", () => ({
  usePublishedAppSession: () => ({
    session: {
      releaseId: "rel_1",
      sessionId: "sess_1",
      state: "ready",
      refreshedAt: "2026-11-15T00:00:00.000Z",
      staleAfter: { kind: "hours", value: 24 },
      refreshUnavailable: false,
      overrides: { region: "US" },
      outputs: {},
      queryStates: {},
      caps: { refreshDefault: true, saveView: true },
      projection: {
        project: {
          id: "prj_1",
          ownerEmail: "reader@example.invalid",
          title: "Revenue overview",
          description: "",
          language: "python",
          statusId: null,
          favorited: false,
          trashedAt: null,
          archivedAt: null,
          lastOpenedAt: null,
          createdAt: "2026-11-15T00:00:00.000Z",
          updatedAt: "2026-11-15T00:00:00.000Z",
          workingVersionId: "ver_working",
          publishedVersionId: "ver_published",
          collectionIds: [],
          cells: [],
        },
        outputs: {},
        queryStates: {},
      },
    },
    busy: false,
    error: null,
    refresh: viewerSpy.refresh,
    reset: viewerSpy.reset,
    setInput: viewerSpy.setInput,
    saveBookmark: viewerSpy.saveBookmark,
  }),
}));

import { PublishedProjectPage } from "./PublishedProjectPage";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const timestamp = "2026-11-15T00:00:00.000Z";
const project = {
  project: projectDocumentSchema.parse({
    id: "prj_1",
    ownerEmail: "reader@example.invalid",
    title: "Revenue overview",
    description: "",
    language: "python",
    statusId: null,
    favorited: false,
    trashedAt: null,
    archivedAt: null,
    lastOpenedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    workingVersionId: "ver_working",
    publishedVersionId: "ver_published",
    collectionIds: [],
    cells: [],
  }),
  outputs: {},
  queryStates: {},
};

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/client/hooks")>();
  return {
    ...actual,
    useActionQuery: (name: string) =>
      name === "get-published-project"
        ? {
            data: project,
            isPending: false,
            isError: false,
            error: null,
            refetch: vi.fn(),
          }
        : { data: undefined, isPending: false, isError: false },
    callAction: vi.fn(),
  };
});

describe("PublishedProjectPage options menu", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("opens the ... options menu and runs Refresh data now and Reset view", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const route = resolveRoute("/app/prj_1/latest");
    const queryClient = new QueryClient();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <AgentNativeI18nProvider
            catalog={{ messages }}
            persistPreference={false}
          >
            <MemoryRouter initialEntries={["/app/prj_1/latest"]}>
              <PublishedProjectPage route={route} />
            </MemoryRouter>
          </AgentNativeI18nProvider>
        </QueryClientProvider>,
      );
    });
    cleanups.push(() => act(() => root.unmount()));

    const trigger = host.querySelector<HTMLButtonElement>(
      'button[aria-label="More"]',
    );
    expect(trigger).not.toBeNull();

    act(() => {
      trigger!.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    const items = [...document.querySelectorAll('[role="menuitem"]')];
    const labels = items.map((item) => item.textContent?.trim());
    expect(labels).toContain("Refresh data now");
    expect(labels).toContain("Reset view");
    expect(labels).toContain("Presentation mode");

    const refreshItem = items.find((item) =>
      item.textContent?.includes("Refresh data now"),
    ) as HTMLElement;
    act(() => {
      refreshItem.click();
    });
    expect(viewerSpy.refresh).toHaveBeenCalledWith("session", "bypass");
  });

  it("report A2-FIND-1120F-S5-3: opens the Comments panel and Agent panel from the published app header", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    const route = resolveRoute("/app/prj_1/latest");
    const queryClient = new QueryClient();

    act(() => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <WorkspaceDataContext.Provider
            value={{ shell: { workspace: { id: "org-1" } } } as never}
          >
            <AgentNativeI18nProvider
              catalog={{ messages }}
              persistPreference={false}
            >
              <MemoryRouter initialEntries={["/app/prj_1/latest"]}>
                <PublishedProjectPage route={route} />
              </MemoryRouter>
            </AgentNativeI18nProvider>
          </WorkspaceDataContext.Provider>
        </QueryClientProvider>,
      );
    });
    cleanups.push(() => act(() => root.unmount()));

    const commentsButton = host.querySelector<HTMLButtonElement>(
      'header button[aria-label="Comments"]',
    );
    expect(commentsButton).not.toBeNull();
    act(() => {
      commentsButton?.click();
    });
    const commentsAside = host.querySelector<HTMLElement>(
      'aside[aria-label="Comments"]',
    );
    expect(commentsAside).not.toBeNull();
    expect(commentsAside?.textContent).toContain("Check Q4 numbers");

    const agentButton = host.querySelector<HTMLButtonElement>(
      'header button[aria-label="Toggle agent"]',
    );
    expect(agentButton).not.toBeNull();
    act(() => {
      agentButton?.click();
    });
    expect(host.querySelector('aside[aria-label="Comments"]')).toBeNull();
    const agentAside = host.querySelector<HTMLElement>(
      'aside[aria-label="Agent"]',
    );
    expect(agentAside).not.toBeNull();
    expect(
      agentAside?.querySelector('[data-testid="published-agent-surface"]')
        ?.textContent,
    ).toContain("analytics-2:org:org-1");

    const closeButton = agentAside?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close"]',
    );
    expect(closeButton).not.toBeNull();
    act(() => {
      closeButton?.click();
    });
    expect(host.querySelector('aside[aria-label="Agent"]')).toBeNull();
  });
});
