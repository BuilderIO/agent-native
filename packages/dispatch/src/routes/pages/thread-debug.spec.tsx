// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ThreadDebugRoute from "./thread-debug";

const queryState = vi.hoisted(() => ({
  calls: [] as Array<{
    name: string;
    params: Record<string, unknown>;
    enabled: boolean;
  }>,
}));

const failedRun = {
  id: "run-mail-1",
  threadId: "thread-mail-1",
  source: {
    id: "mail",
    label: "Mail",
    kind: "configured",
    databaseUrlEnv: "MAIL_DATABASE_URL",
  },
  ownerEmail: "ops@example.com",
  threadTitle: "Mail agent failed",
  threadPreview: "Provider timed out",
  status: "errored",
  errorCode: "stale_run",
  errorDetail:
    "The run heartbeat stopped while the run was still marked running.",
  terminalReason: "stale_run",
  abortReason: null,
  dispatchMode: "background-processing",
  diagStage: null,
  workerStage: "model",
  heartbeatAt: 1_722_400_029_000,
  lastProgressAt: 1_722_400_028_000,
  regime: "scheduled",
  startedAt: 1_722_400_000_000,
  completedAt: 1_722_400_030_000,
  durationMs: 30_000,
};

const detail = {
  source: failedRun.source,
  access: {
    viewerEmail: "ops@example.com",
    scope: "current organization",
    canInspectAll: true,
  },
  thread: {
    id: failedRun.threadId,
    ownerEmail: failedRun.ownerEmail,
    title: failedRun.threadTitle,
    preview: failedRun.threadPreview,
    messageCount: 0,
    createdAt: failedRun.startedAt,
    updatedAt: failedRun.completedAt,
    snippet: "",
  },
  lookup: {
    requestedId: failedRun.id,
    threadId: failedRun.threadId,
    runId: failedRun.id,
  },
  messages: [],
  debug: null,
  debugRuns: [],
  queuedMessages: [],
  threadData: {},
  rawThreadData: "{}",
  runs: [
    {
      ...failedRun,
      events: [
        {
          seq: 1,
          event: { type: "tool_start", tool: "search-mail" },
          rawEventData: '{"type":"tool_start","tool":"search-mail"}',
        },
        {
          seq: 2,
          event: { type: "error", errorCode: "stale_run" },
          rawEventData: '{"type":"error","errorCode":"stale_run"}',
        },
      ],
      completedAt: null,
      durationMs: null,
    },
  ],
  traces: { summaries: [], spans: [] },
  feedback: [],
  satisfaction: [],
  evals: [],
  checkpoints: [],
};

const threadResult = {
  id: "thread-chat-1",
  ownerEmail: "ops@example.com",
  title: "Job: builder-agent-refresh — 8/9/2026",
  preview: "thread-chat-1",
  messageCount: 3,
  createdAt: 1_722_400_000_000,
  updatedAt: 1_722_400_030_000,
  snippet: "{}",
};

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (
    name: string,
    params: Record<string, unknown>,
    options?: { enabled?: boolean },
  ) => {
    const enabled = options?.enabled !== false;
    queryState.calls.push({ name, params, enabled });
    const base = {
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    };
    if (name === "list-agent-thread-sources") {
      return {
        ...base,
        data: {
          access: {
            viewerEmail: "ops@example.com",
            orgId: "org-1",
            role: "admin",
            envAdmin: false,
            canInspectAll: true,
            memberCount: 1,
          },
          sources: [
            {
              id: "current",
              label: "Current Dispatch DB",
              kind: "current",
              current: true,
              connected: true,
              databaseUrlEnv: null,
              databaseAuthTokenEnv: null,
              canInspectAll: true,
            },
            {
              id: "mail",
              label: "Mail",
              kind: "configured",
              current: false,
              connected: true,
              databaseUrlEnv: "MAIL_DATABASE_URL",
              databaseAuthTokenEnv: null,
              canInspectAll: true,
            },
          ],
        },
      };
    }
    if (name === "list-agent-run-failures") {
      return {
        ...base,
        data: enabled
          ? {
              failures: [failedRun],
              count: 1,
              partial: true,
              access: {
                viewerEmail: "ops@example.com",
                scope: "current organization",
                canInspectAll: true,
              },
              sources: [
                {
                  source: failedRun.source,
                  status: "ok",
                  failureCount: 1,
                },
                {
                  source: { id: "clips", label: "Clips" },
                  status: "unavailable",
                  failureCount: 0,
                },
              ],
            }
          : undefined,
      };
    }
    if (name === "get-agent-thread-debug") {
      return { ...base, data: enabled ? detail : undefined };
    }
    if (name === "search-agent-threads") {
      return {
        ...base,
        data: enabled
          ? {
              count: 1,
              threads: [threadResult],
              access: {
                scope: "current organization",
                canInspectAll: true,
              },
              source: {
                id: "current",
                label: "Current Dispatch DB",
              },
            }
          : undefined,
      };
    }
    return { ...base, data: undefined };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { defaultValue?: string }) =>
    values?.defaultValue ?? key,
}));

vi.mock("../../components/dispatch-shell", () => ({
  DispatchShell: ({
    title,
    description,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));

describe("ThreadDebugRoute", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryState.calls = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("uses 24-hour defaults, preserves partial health, and inspects a cross-source failure", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/thread-debug"]}>
          <ThreadDebugRoute />
        </MemoryRouter>,
      );
    });

    expect(
      queryState.calls.find(
        (call) => call.name === "list-agent-run-failures" && call.enabled,
      )?.params,
    ).toMatchObject({
      sourceId: "all",
      status: "all",
      regime: "all",
      lookbackHours: 24,
    });
    expect(container.textContent).toContain("Partial results");
    expect(container.textContent).toContain("Clips (unavailable)");
    expect(container.textContent).not.toContain(failedRun.id);
    expect(container.textContent).not.toContain(failedRun.threadId);

    const failureButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("Inspect failed run"),
    );
    expect(failureButton).toBeTruthy();
    await act(async () => {
      failureButton?.click();
    });

    expect(
      queryState.calls.find(
        (call) =>
          call.name === "get-agent-thread-debug" &&
          call.enabled &&
          call.params.runId === failedRun.id,
      )?.params,
    ).toMatchObject({
      sourceId: "mail",
      runId: failedRun.id,
    });
    expect(container.textContent).toContain("Worker stopped reporting");
    expect(container.textContent).toContain("retained 2 execution events");
  });

  it("passes valid URL-backed failure filters to the action", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/thread-debug?source=mail&owner=ops%40example.com&status=errored&regime=scheduled&range=7d",
          ]}
        >
          <ThreadDebugRoute />
        </MemoryRouter>,
      );
    });

    expect(
      queryState.calls.find(
        (call) => call.name === "list-agent-run-failures" && call.enabled,
      )?.params,
    ).toMatchObject({
      sourceId: "mail",
      ownerEmail: "ops@example.com",
      status: "errored",
      regime: "scheduled",
      lookbackHours: 168,
    });
  });

  it("keeps thread list rows human-readable without technical identifiers", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/thread-debug?mode=threads"]}>
          <ThreadDebugRoute />
        </MemoryRouter>,
      );
    });

    expect(container.textContent).toContain("Builder Agent Refresh");
    expect(container.textContent).toContain("3 messages");
    expect(container.textContent).toContain("ops@example.com");
    expect(container.textContent).toContain("Advanced");
    expect(container.textContent).not.toContain("Owner email");
    expect(container.textContent).not.toContain("Find a thread");
    expect(container.textContent).not.toContain("Search by title");
    expect(container.textContent).not.toContain(threadResult.id);
    expect(container.textContent).not.toContain("{}");
    expect(container.querySelector("summary svg")).toBeTruthy();
    const searchCall = queryState.calls.find(
      (call) => call.name === "search-agent-threads" && call.enabled,
    );
    expect(searchCall?.params).toMatchObject({
      sourceId: "current",
      limit: 25,
    });
    expect(searchCall?.params).not.toHaveProperty("ownerEmail");

    const searchInput = container.querySelector(
      'input[aria-label="Search threads or email"]',
    );
    expect(searchInput).toBeTruthy();
    await act(async () => {
      (searchInput as HTMLInputElement).focus();
    });
    expect(document.body.querySelector('[role="option"]')?.textContent).toBe(
      "ops@example.com",
    );
  });
});
