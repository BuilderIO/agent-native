// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

const translate = vi.hoisted(() => (key: string) => key);
vi.mock("@agent-native/core/client/application-state", () => ({
  compareAndSetClientAppState: vi.fn(async () => {}),
  readClientAppState: vi.fn(async () => null),
}));
vi.mock("@agent-native/core/client/hooks", () => ({
  getBrowserTabId: () => "test-tab",
  writeClientAppState: vi.fn(async () => {}),
  useActionQuery: () => ({ data: { projects: [] }, isError: false }),
}));
vi.mock("@agent-native/core/client/i18n", async (original) => ({
  ...(await original<typeof import("@agent-native/core/client/i18n")>()),
  useT: () => translate,
}));
vi.mock("@/components/agent", () => ({
  WorkspaceAgent: () => <textarea aria-label="Composer" />,
}));

import { HomePageView } from "./HomePageView";
import type { RoutePageProps } from "./types";
import { WorkspaceDataContext } from "./WorkspaceDataContext";

it("keeps the draft and banner position when setup progress arrives", async () => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT =
    true;
  let setupReady = false;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const bootstrap = {
    user: { id: "u1", name: "Analyst", email: "analyst@example.test" },
    workspace: { id: "org-1", name: "Workspace" },
    capabilities: [],
    features: {
      contextStudio: true,
      isManagerOrAbove: true,
      isAdmin: true,
      canExplore: true,
      threads: true,
      tasks: true,
      folders: false,
      developerTools: false,
      canCreateProject: true,
      canCreateThread: true,
    },
  };
  const render = () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WorkspaceDataContext.Provider
            value={{
              shell: bootstrap,
              activity: undefined,
              activityStatus: "loading",
              contextSetup: setupReady
                ? { progressPercent: 0, completedSteps: [] }
                : undefined,
              contextSetupPending: !setupReady,
              onCreateProject: () => {},
              quickCreateProject: async () => {},
              onCreateThread: () => {},
            }}
          >
            <HomePageView {...({} as RoutePageProps)} />
          </WorkspaceDataContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  const client = new QueryClient();
  try {
    await act(async () => render());
    await vi.waitFor(() =>
      expect(host.querySelector("textarea")).not.toBeNull(),
    );
    const editor = host.querySelector("textarea");
    if (!editor) throw new Error("Composer missing");
    editor.value = "Revenue by region";
    const bannerSlot = host.querySelector(".ws-home-curate-slot");
    expect(bannerSlot?.querySelector('[aria-busy="true"]')).not.toBeNull();

    setupReady = true;
    await act(async () => render());
    expect(host.querySelector("textarea")).toBe(editor);
    expect(editor.value).toBe("Revenue by region");
    expect(host.querySelector(".ws-home-curate-slot")).toBe(bannerSlot);
    expect(bannerSlot?.textContent).toContain("Curate your context");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
