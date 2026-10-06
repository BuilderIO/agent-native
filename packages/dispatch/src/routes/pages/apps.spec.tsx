// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  workspaceApps: [] as Array<Record<string, unknown>>,
  workspaceAppsError: null as Error | null,
  workspaceAppsLoading: false,
  connectedApps: [] as Array<Record<string, unknown>>,
  connectedAppsError: null as Error | null,
  connectedAppsLoading: false,
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    const workspaceApps = action === "list-workspace-apps";
    const connectedApps = action === "list-connected-agents";
    const error = workspaceApps
      ? queryState.workspaceAppsError
      : connectedApps
        ? queryState.connectedAppsError
        : null;
    return {
      data: workspaceApps
        ? queryState.workspaceApps
        : connectedApps
          ? queryState.connectedApps
          : { name: null, displayName: null, appCount: 0 },
      error,
      isError: Boolean(error),
      isLoading: workspaceApps
        ? queryState.workspaceAppsLoading
        : connectedApps
          ? queryState.connectedAppsLoading
          : false,
      refetch: vi.fn(),
    };
  },
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: Record<string, unknown>) =>
    key === "dispatch.pages.noWorkspaceApps"
      ? "No workspace apps"
      : String(values?.defaultValue ?? key),
}));

vi.mock("../../components/action-query-error", () => ({
  ActionQueryError: ({ error }: { error: Error }) => (
    <div role="alert">{error.message}</div>
  ),
}));

vi.mock("../../components/create-app-popover", () => ({
  CreateAppPopover: () => null,
}));

vi.mock("../../components/dispatch-shell", () => ({
  DispatchShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../../components/workspace-app-search", () => ({
  WorkspaceAppSearch: () => null,
  WorkspaceAppSearchEmpty: () => <div>No search results</div>,
}));

vi.mock("../../lib/workspace-app-layout", () => ({
  orderWorkspaceApps: (apps: unknown[]) => apps,
  useWorkspaceAppLayout: () => ({
    layout: { pinnedIds: [], orderedIds: [] },
    persistenceError: null,
    togglePinned: vi.fn(),
  }),
  workspaceAppMatchesQuery: () => true,
}));

import AppsRouteEntry from "./apps";

describe("Dispatch apps route", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    queryState.workspaceApps = [];
    queryState.workspaceAppsError = null;
    queryState.workspaceAppsLoading = false;
    queryState.connectedApps = [];
    queryState.connectedAppsError = null;
    queryState.connectedAppsLoading = false;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderAppsRoute() {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/apps"]}>
          <AppsRouteEntry />
        </MemoryRouter>,
      );
    });
  }

  it("does not show the empty state when connected-app discovery fails", async () => {
    queryState.connectedAppsError = new Error("Connected apps unavailable");

    await renderAppsRoute();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Connected apps unavailable",
    );
    expect(container.textContent).not.toContain("No workspace apps");
  });

  it("shows the empty state after successful app discovery", async () => {
    await renderAppsRoute();

    expect(container.textContent).toContain("No workspace apps");
  });
});
