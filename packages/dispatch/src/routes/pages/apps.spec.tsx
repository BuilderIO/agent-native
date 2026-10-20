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
  communityAppsEnabled: false,
  communityApps: [] as Array<Record<string, unknown>>,
  installCommunityApp: vi.fn(),
  installCommunityAppResult: null as Record<string, unknown> | null,
  sendToAgentChat: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionQuery: (action: string) => {
    const workspaceApps = action === "list-workspace-apps";
    const connectedApps = action === "list-connected-agents";
    const communityApps = action === "list-curated-community-apps";
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
          : communityApps
            ? queryState.communityApps
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
  useActionMutation: (
    _action: string,
    options?: { onSuccess?: (result: Record<string, unknown>) => void },
  ) => ({
    mutate: (input: unknown) => {
      queryState.installCommunityApp(input);
      if (queryState.installCommunityAppResult) {
        options?.onSuccess?.(queryState.installCommunityAppResult);
      }
    },
    isPending: false,
  }),
}));

vi.mock("@agent-native/core/client/agent-chat", () => ({
  sendToAgentChat: queryState.sendToAgentChat,
}));

vi.mock("@agent-native/core/client/labs", () => ({
  useLab: () => queryState.communityAppsEnabled,
}));

vi.mock("../../shared/labs.js", () => ({
  COMMUNITY_APPS_LAB: { key: "dispatch.community-apps", defaultEnabled: false },
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
    queryState.communityAppsEnabled = false;
    queryState.communityApps = [];
    queryState.installCommunityApp.mockReset();
    queryState.installCommunityAppResult = null;
    queryState.sendToAgentChat.mockReset();
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

  it("hides community apps while the Lab is off", async () => {
    await renderAppsRoute();

    expect(container.textContent).not.toContain("dispatch.pages.communityApps");
  });

  it("lists the reviewed catalog and starts the selected install", async () => {
    queryState.communityAppsEnabled = true;
    queryState.communityApps = [
      {
        id: "community-qr",
        name: "QR",
        description: "Generate QR images.",
        appId: "community-qr",
        repo: "BuilderIO/agent-native",
        sha: "a".repeat(40),
        license: "MIT",
        provenance: "Reviewed source",
        templatePath: "templates/community/qr",
        installed: false,
        pending: false,
        installable: true,
      },
    ];

    await renderAppsRoute();

    expect(container.textContent).toContain("QR");
    const installButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.includes("dispatch.pages.communityAppsInstall"),
    );
    expect(installButton).toBeDefined();
    await act(async () => installButton?.click());
    expect(queryState.installCommunityApp).toHaveBeenCalledWith({
      sourceId: "community-qr",
    });
  });

  it("sends verified source files to the local code agent", async () => {
    queryState.communityAppsEnabled = true;
    queryState.communityApps = [
      {
        id: "community-qr",
        name: "QR",
        description: "Generate QR images.",
        appId: "community-qr",
        repo: "BuilderIO/agent-native",
        sha: "a".repeat(40),
        license: "MIT",
        provenance: "Reviewed source",
        templatePath: "templates/community/qr",
        installed: false,
        pending: false,
        installable: true,
      },
    ];
    queryState.installCommunityAppResult = {
      mode: "local-agent",
      prompt: "Create this app from the pinned files.",
      attachments: [
        {
          type: "file",
          name: "community-qr/README.md",
          contentType: "text/plain",
          text: "Verified source",
        },
      ],
    };

    await renderAppsRoute();
    const installButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) =>
      button.textContent?.includes("dispatch.pages.communityAppsInstall"),
    );
    await act(async () => installButton?.click());

    expect(queryState.sendToAgentChat).toHaveBeenCalledWith({
      message: "Create this app from the pinned files.",
      attachments: [
        {
          type: "file",
          name: "community-qr/README.md",
          contentType: "text/plain",
          text: "Verified source",
        },
      ],
      submit: true,
      type: "code",
      newTab: true,
      reuseEmptyTab: true,
    });
  });

  it("explains when a community app ID is already in use", async () => {
    queryState.communityAppsEnabled = true;
    queryState.communityApps = [
      {
        id: "community-qr",
        name: "QR",
        description: "Generate QR images.",
        appId: "qr",
        repo: "BuilderIO/agent-native",
        sha: "a".repeat(40),
        license: "MIT",
        provenance: "Reviewed source",
        templatePath: "templates/community/qr",
        installed: false,
        pending: false,
        installable: false,
        installUnavailableReason: "app-id-conflict",
      },
    ];

    await renderAppsRoute();

    expect(container.textContent).toContain(
      "dispatch.pages.communityAppsIdConflict",
    );
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("dispatch.pages.communityAppsInstall"),
      ),
    ).toBe(false);
  });
});
