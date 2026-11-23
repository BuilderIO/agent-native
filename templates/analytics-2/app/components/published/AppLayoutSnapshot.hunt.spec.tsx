// @vitest-environment happy-dom
import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import messages from "@/i18n/en-US";

import { PublishedAppSchedulePanel } from "./PublishedAppSchedulePanel";
import { usePublishedResultPages } from "./usePublishedResultPages";

import publishedStyles from "./app-layout-snapshot.css?raw";

const actions = vi.hoisted(() => ({
  query: vi.fn(),
  call: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("@agent-native/core/client/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/hooks")>()),
  useActionQuery: actions.query,
  callAction: actions.call,
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  writeClientAppState: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  actions.refetch.mockResolvedValue({});
});

afterEach(() => {
  actions.query.mockReset();
  actions.call.mockReset();
  actions.refetch.mockReset();
  vi.unstubAllGlobals();
});

async function mountTree(tree: ReactNode) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AgentNativeI18nProvider catalog={{ messages }} persistPreference={false}>
        {tree}
      </AgentNativeI18nProvider>,
    ),
  );
  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
}

function button(name: string) {
  const match = [...document.querySelectorAll("button")].find(
    (element) =>
      (element.getAttribute("aria-label") ?? element.textContent?.trim()) ===
      name,
  );
  if (!match) throw new Error(`Missing button ${name}`);
  return match;
}

it("keeps polling a pending published result until the server settles it", async () => {
  actions.call
    .mockResolvedValueOnce({ status: "pending", resultId: "r1", page: 1 })
    .mockResolvedValue({ status: "incomplete" });
  let latest: ReturnType<typeof usePublishedResultPages> | undefined;
  function Probe() {
    latest = usePublishedResultPages([{ cellId: "c1", resultId: "r1" }], {
      sessionId: "session",
    });
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const unmount = await mountTree(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  try {
    await vi.waitFor(() => expect(actions.call).toHaveBeenCalledTimes(1));
    expect(latest?.outputs.c1).toEqual({ artifactLoading: true });
    await vi.waitFor(
      () => expect(latest?.outputs.c1?.artifactError).toBe(true),
      { timeout: 4_000 },
    );
    expect(actions.call.mock.calls.length).toBeGreaterThan(1);
  } finally {
    await unmount();
    client.clear();
  }
});

it("returns to the previous schedule page when the last row of a later page disappears", async () => {
  const schedule = {
    scheduleId: "schedule-1",
    revision: "1",
    enabled: true,
    nextFireAt: null,
    config: {
      cadence: { kind: "daily", hour: 9, minute: 0 },
      timezone: "UTC",
      target: "default",
      updatePublishedResults: true,
      useCachedSqlResults: false,
      recipients: [],
    },
  };
  const page = (data: unknown) => ({
    data,
    isPending: false,
    isError: false,
    refetch: actions.refetch,
  });
  actions.query.mockImplementation(
    (name: string, input: { cursor?: string }) => {
      if (name === "list-published-app-schedules") {
        return page({
          schedules: input.cursor ? [] : [schedule],
          nextCursor: input.cursor ? null : "cursor-2",
          canManage: true,
          notificationsAvailable: true,
        });
      }
      return page({ runs: [], nextCursor: null });
    },
  );
  const unmount = await mountTree(
    <MemoryRouter>
      <PublishedAppSchedulePanel projectId="project-1" releaseId="release-1" />
    </MemoryRouter>,
  );
  try {
    await act(async () => button("Scheduled runs & notifications").click());
    await act(async () => button("Next page").click());
    expect(document.body.textContent).toContain("Daily");
    expect(document.body.textContent).not.toContain("No schedules");
  } finally {
    await unmount();
  }
});

it("anchors the running progress bar to a valid physical edge for each direction", () => {
  const rule = (selector: string) =>
    publishedStyles.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`))?.[1] ??
    "";
  expect(publishedStyles).not.toMatch(/transform-origin:\s*inline-start/);
  expect(rule("\\.app-session-progress")).toMatch(/transform-origin:\s*left/);
  expect(rule("\\.app-session-progress:dir\\(rtl\\)")).toMatch(
    /transform-origin:\s*right/,
  );
});
