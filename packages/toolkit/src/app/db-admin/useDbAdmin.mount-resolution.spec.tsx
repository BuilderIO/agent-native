// @vitest-environment happy-dom

import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiPath = vi.hoisted(() => ({
  resolve: vi.fn((path: string) => {
    throw new Error(`Workspace mount unavailable for ${path}`);
  }),
}));

vi.mock("@agent-native/core/client/api-path", () => ({
  agentNativePath: apiPath.resolve,
}));
vi.mock("@agent-native/core/client/agent-chat", () => ({
  useCodeMode: () => ({
    isCodeMode: true,
    canToggle: true,
    isLoading: false,
    setCodeMode: vi.fn(),
  }),
}));
vi.mock("./useAgentSync.js", () => ({
  useDbAdminAgentSync: vi.fn(),
  useNavigateConsumer: vi.fn(),
}));
vi.mock("./SqlEditor.js", () => ({ SqlEditor: () => null }));
vi.mock("./TableBrowser.js", () => ({ TableBrowser: () => null }));
vi.mock("./TableEditor.js", () => ({ TableEditor: () => null }));

import { DbAdminPage } from "./DbAdminPage.js";
import { useOverview } from "./useDbAdmin.js";

function OverviewHarness() {
  const { error } = useOverview();
  return <span>{error?.message ?? "Loading"}</span>;
}

describe("useOverview mount resolution", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    apiPath.resolve.mockImplementation((path) => {
      throw new Error(`Workspace mount unavailable for ${path}`);
    });
    onlineManager.setOnline(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reports a mount-resolution failure through query state instead of render", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <OverviewHarness />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(queryClient.getQueryCache().getAll()[0]?.state.error?.message).toBe(
      "Workspace mount unavailable for /_agent-native/db-admin",
    );
  });

  it("shows and retries overview failures instead of showing an empty database", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          tables: [{ name: "workspace_apps", rowCount: 1 }],
        }),
      ),
    );

    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <DbAdminPage />
        </QueryClientProvider>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await act(async () => {
      await vi.waitFor(() =>
        expect(container.querySelector('[role="alert"]')).not.toBeNull(),
      );
    });
    expect(container.textContent).not.toContain("Workspace mount unavailable");
    expect(container.textContent).not.toContain("0 tables");
    expect(container.textContent).not.toContain("No table selected");

    apiPath.resolve.mockImplementation((path) => path);
    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(container.querySelector('[role="alert"]')).toBeNull();
        expect(
          queryClient
            .getQueryCache()
            .getAll()
            .find((query) => query.queryKey[2] === "overview")?.state.data,
        ).toEqual({
          tables: [{ name: "workspace_apps", rowCount: 1 }],
        });
      });
    });
  });
});
