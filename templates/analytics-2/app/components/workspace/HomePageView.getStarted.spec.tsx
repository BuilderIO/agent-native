// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import type { RoutePageProps } from "./types";

const translate = vi.hoisted(() => (key: string) => key);

vi.mock("@/components/agent", () => ({
  WorkspaceAgent: () => <div>Composer ready</div>,
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
  readClientAppState: vi.fn(async () => null),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  writeClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({
    data: { projects: [] },
    isError: false,
  }),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
}));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      user: { name: "Analyst", email: "analyst@example.test" },
      workspace: { id: "org-1", name: "Workspace" },
      capabilities: [
        { controlId: "bigquery-connection-create", status: "allowed" },
        { controlId: "create-project", status: "allowed" },
      ],
      features: { threads: true, canExplore: true },
    },
    activity: {
      recents: [],
      favorites: [],
      hasDataConnection: true,
      homeRecents: { projects: [], threads: [] },
    },
    activityStatus: "ready",
    contextSetup: { progressPercent: 0, completedSteps: [] },
    onCreateProject: () => {},
    onCreateThread: () => {},
  }),
}));

import { HomePageView } from "./HomePageView";

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
  document.body.innerHTML = "";
});

it("report QA-1795259827-HOME-ONBOARDING-PROGRESS: marks connect step complete when hasDataConnection is true even with no recent data rows", async () => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
    true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  cleanups.push(() => act(() => root.unmount()));

  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <HomePageView {...({} as RoutePageProps)} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  await vi.waitFor(() => {
    const progress = host.querySelector('[role="progressbar"]');
    expect(progress?.getAttribute("aria-valuenow")).toBe("33");
  });
});
