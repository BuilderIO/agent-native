// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";

import type { RoutePageProps } from "./types";

const gate = vi.hoisted(() => {
  let release: () => void = () => {
    throw new Error("Composer gate was not initialized");
  };
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
});
const translate = vi.hoisted(() => (key: string) => key);
vi.mock("@/components/agent", async () => {
  await gate.pending;
  return { WorkspaceAgent: () => <div>Composer ready</div> };
});
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
      ],
      features: { threads: true, canExplore: true },
    },
    activityStatus: "ready",
    contextSetup: { progressPercent: 0, completedSteps: [] },
    onCreateProject: () => {},
    onCreateThread: () => {},
  }),
}));

it("report A2-HOME-COMPOSER-BLOCKS-SETUP: makes the setup link usable while the composer module is pending", async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const loaded = import("./HomePageView");
  try {
    const module = await Promise.race([
      loaded,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Home waits for composer module")),
          20000,
        );
      }),
    ]);
    (
      globalThis as unknown as Record<string, unknown>
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter>
              <module.HomePageView {...({} as RoutePageProps)} />
            </MemoryRouter>
          </QueryClientProvider>,
        );
      });
      const link = [...host.querySelectorAll("a")].find(
        (node) => node.textContent === "dataBrowser.firstRun.connectTitle",
      );
      expect(link?.getAttribute("href")).toBe("/home/data?connect=1");
      expect(host.textContent).not.toContain("Composer ready");
      expect(
        [...host.querySelectorAll("button")].some(
          (button) => button.textContent === "Ask",
        ),
      ).toBe(false);
      await act(async () => {
        gate.release();
        await gate.pending;
      });
      await vi.waitFor(() =>
        expect(host.textContent).toContain("Composer ready"),
      );
      expect(
        [...host.querySelectorAll("button")].some(
          (button) => button.textContent === "Ask",
        ),
      ).toBe(true);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  } finally {
    clearTimeout(timer);
    gate.release();
    await loaded;
  }
}, 30000);
