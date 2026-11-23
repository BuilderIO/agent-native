// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import type { RoutePageProps } from "./types";

const state = vi.hoisted(() => ({
  read: (() => Promise.resolve(null)) as () => Promise<unknown>,
}));
vi.mock("@/components/agent", () => ({
  WorkspaceAgent: () => <div>Composer ready</div>,
}));
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
  readClientAppState: vi.fn(() => state.read()),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  writeClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: { projects: [] }, isError: false }),
}));
const translate = vi.hoisted(() => (key: string) => key);
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("./WorkspaceDataContext", () => ({
  useWorkspaceData: () => ({
    shell: {
      user: { name: "Analyst", email: "analyst@example.test" },
      workspace: { id: "org-1", name: "Workspace" },
      capabilities: [
        { controlId: "bigquery-connection-create", status: "allowed" },
      ],
      features: { threads: true, canExplore: true },
    },
    activityStatus: "ready",
    contextSetup: { progressPercent: 0, completedSteps: [] },
    onCreateProject: () => {},
    onCreateThread: () => {},
  }),
}));

afterEach(() => {
  document.body.innerHTML = "";
});

async function mountHome() {
  const { HomePageView } = await import("./HomePageView");
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
    true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <HomePageView {...({} as RoutePageProps)} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return { host, unmount: () => act(async () => root.unmount()) };
}

const connectLink = (host: HTMLElement) =>
  host.querySelector<HTMLAnchorElement>("a[href='/home/data?connect=1']");

it("A2-CDE-02: Connect your data stays reachable while the saved checklist state is still loading", async () => {
  state.read = () => new Promise(() => {});
  const { host, unmount } = await mountHome();
  expect(connectLink(host)).not.toBeNull();
  expect(host.querySelector("button[aria-label='Dismiss']")).toBeNull();
  await unmount();
});

it("A2-CDE-02: Connect your data stays reachable when the saved checklist state cannot be read", async () => {
  state.read = () => Promise.reject(new Error("offline"));
  const { host, unmount } = await mountHome();
  expect(connectLink(host)).not.toBeNull();
  expect(host.querySelector("button[aria-label='Dismiss']")).not.toBeNull();
  await unmount();
});
