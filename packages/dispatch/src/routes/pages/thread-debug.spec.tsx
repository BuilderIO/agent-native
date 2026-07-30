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
  errorCode: "provider_timeout",
  errorDetail: "The provider did not respond.",
  terminalReason: "provider_timeout",
  abortReason: null,
  dispatchMode: "background-processing",
  diagStage: null,
  workerStage: "model",
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
  runs: [],
  traces: { summaries: [], spans: [] },
  feedback: [],
  satisfaction: [],
  evals: [],
  checkpoints: [],
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
      lookbackHours: 24,
    });
    expect(container.textContent).toContain("Partial results");
    expect(container.textContent).toContain("Clips (unavailable)");

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
  });

  it("passes valid URL-backed failure filters to the action", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter
          initialEntries={[
            "/thread-debug?source=mail&owner=ops%40example.com&status=errored&range=7d",
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
      lookbackHours: 168,
    });
  });
});
