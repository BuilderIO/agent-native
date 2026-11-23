// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { AskThreadHeader, SharedAskThread } from "./AskThreadContents";

const mocks = vi.hoisted(() => ({
  queryOptions: new Map<string, Record<string, unknown>>(),
  createProject: vi.fn(async () => ({
    projectId: "proj-unsaved-1",
    href: "/project/proj-unsaved-1/latest",
    snapshot: {
      snapshot: { head: { versionId: "ver-1", revision: 0 } },
    },
  })),
  bindThread: vi.fn(async () => ({})),
  turns: [
    {
      receipt: {
        threadId: "thr_1",
        messageId: "msg_1",
        sequence: "1",
        phase: "complete",
        runId: "run_1",
        acceptedAt: "2026-11-21T00:00:00.000Z",
      },
      denied: false,
      durationMs: 1200,
      toolReceipts: [
        {
          id: "tool_1",
          name: "run_sql_cell",
          state: "complete",
          label: "Ran SQL query",
        },
      ],
      answerBlocks: [{ text: "Here is the revenue chart." }],
      chartArtifacts: [
        {
          id: "chart_1",
          title: "Monthly Revenue",
          widget: {
            chartSeries: {
              type: "bar",
              xKey: "month",
              series: [{ key: "revenue", label: "Revenue" }],
              data: [
                { month: "Jan", revenue: 100 },
                { month: "Feb", revenue: 200 },
              ],
            },
          },
        },
      ],
    },
  ],
}));

vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useActionQuery: (
    name?: string,
    _input?: unknown,
    options?: Record<string, unknown>,
  ) => {
    if (name && options) mocks.queryOptions.set(name, options);
    if (name === "list-analytics-thread-access") {
      return {
        isPending: false,
        isError: false,
        data: { revision: "0", grants: [] },
        refetch: vi.fn(),
      };
    }
    if (name === "search-analytics-thread-members") {
      return {
        isPending: false,
        isError: false,
        data: { members: [] },
      };
    }
    return {
      isPending: false,
      isError: false,
      data: { turns: mocks.turns },
    };
  },
  useActionMutation: (name: string) => ({
    mutateAsync:
      name === "create-project"
        ? mocks.createProject
        : name === "bind-notebook-thread"
          ? mocks.bindThread
          : vi.fn(),
    isPending: false,
  }),
}));

vi.mock("@/components/notebook/VegaChart", () => ({
  VegaChart: ({ title }: { title: string }) => (
    <div data-testid="vega-chart">{title}</div>
  ),
}));

let root: ReturnType<typeof createRoot> | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

describe("SharedAskThread chart card-header actions", () => {
  it("renders chart header actions and opens full-screen dialog", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <MemoryRouter>
          <AgentNativeI18nProvider
            catalog={{ messages: enUS }}
            persistPreference={false}
          >
            <SharedAskThread threadId="thr_1" identity="qa@example.test" />
          </AgentNativeI18nProvider>
        </MemoryRouter>,
      );
    });

    const downloadButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Download CSV"]',
    );
    const fullScreenButton = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Full screen"]',
    );
    expect(downloadButton).not.toBeNull();
    expect(fullScreenButton).not.toBeNull();

    await act(async () => {
      fullScreenButton?.click();
    });

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Monthly Revenue");
  });
});

function RouterPathProbe() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

describe("AskThreadHeader unsaved tabs and Thread Inspector", () => {
  it("report A2-FIND-1120F-S4-5 opens App builder from an unsaved thread header", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.createProject.mockClear();
    mocks.bindThread.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const queryClient = new QueryClient();

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/thread"]}>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <RouterPathProbe />
              <AskThreadHeader
                binding={null}
                threadId={null}
                title="New thread"
                listed={true}
                workingHead={null}
                canShare={false}
                identity="qa@example.test"
                refetch={async () => undefined}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const appBuilderButton = [...host.querySelectorAll("nav button")].find(
      (btn) => btn.textContent.includes("App builder"),
    ) as HTMLButtonElement | undefined;
    expect(appBuilderButton).toBeTruthy();

    await act(async () => {
      appBuilderButton?.click();
      await Promise.resolve();
    });

    expect(mocks.createProject).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="path"]')?.textContent).toBe(
      "/project/proj-unsaved-1/latest/ui",
    );
  });

  it("report A2-FIND-1120F-S4-1 opens Thread Inspector with real labels and tool receipts", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const queryClient = new QueryClient();

    await act(async () => {
      root?.render(
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/thread/thr_1"]}>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <AskThreadHeader
                binding={{
                  threadId: "thr_1",
                  projectId: "proj_1",
                  bindingId: "bind_1",
                  workingVersionId: "ver_1",
                  href: "/thread/thr_1",
                }}
                threadId="thr_1"
                title="Revenue summary"
                listed={true}
                workingHead={null}
                canShare={true}
                canSubmit={true}
                identity="qa@example.test"
                refetch={async () => undefined}
              />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const inspectorBtn = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Show thread inspector"]',
    );
    expect(inspectorBtn).not.toBeNull();

    await act(async () => {
      inspectorBtn?.click();
    });

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.textContent).toContain("Conversation details");
    expect(dialog?.textContent).toContain("Conversation ID");
    expect(dialog?.textContent).toContain("thr_1");
    expect(dialog?.textContent).toContain("Messages");
    expect(dialog?.textContent).toContain("Reply access");
    expect(dialog?.textContent).toContain("Can reply");
    expect(dialog?.textContent).toContain("Tools");
    const toolsTab = [
      ...(dialog?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []),
    ].find((tab) => tab.textContent.includes("Tools"));
    expect(toolsTab).toBeTruthy();
    await act(async () => {
      toolsTab?.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, button: 0 }),
      );
      toolsTab?.click();
    });
    expect(dialog?.textContent).toContain("Ran SQL query");

    const closeBtn = dialog?.querySelector<HTMLButtonElement>(
      'button[aria-label="Close panel"]',
    );
    expect(closeBtn).not.toBeNull();
    await act(async () => {
      closeBtn?.click();
    });
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    const homeLink = host.querySelector<HTMLAnchorElement>(
      'a[href="/home"][aria-label="Home"]',
    );
    expect(homeLink).not.toBeNull();
  });

  it("polls thread turns only while a turn is queued or admitted", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const client = new QueryClient();
    await act(async () => {
      root?.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={["/threads/thr_1"]}>
            <AgentNativeI18nProvider
              catalog={{ messages: enUS }}
              persistPreference={false}
            >
              <SharedAskThread threadId="thr_1" identity="qa@example.test" />
            </AgentNativeI18nProvider>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });

    const turnsOpts = mocks.queryOptions.get("get-analytics-thread-turns");
    const refetchInterval = turnsOpts?.refetchInterval as
      | ((query: {
          state: { data?: { turns: typeof mocks.turns } };
        }) => number | false)
      | undefined;
    expect(typeof refetchInterval).toBe("function");
    expect(refetchInterval?.({ state: { data: { turns: mocks.turns } } })).toBe(
      false,
    );
    expect(
      refetchInterval?.({
        state: {
          data: {
            turns: [
              {
                ...mocks.turns[0]!,
                receipt: { ...mocks.turns[0]!.receipt, phase: "admitted" },
              },
            ],
          },
        },
      }),
    ).toBe(5000);
  });
});
