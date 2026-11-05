// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const queryState = vi.hoisted(() => ({
  workspaceApps: [] as Array<Record<string, unknown>> | undefined,
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
  pinnedIds: [] as string[],
  canManageOrg: false,
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
  ActionQueryError: ({
    error,
    queryName,
  }: {
    error: Error;
    queryName?: string;
  }) => (
    <div role="alert">
      {queryName}: {error.message}
    </div>
  ),
}));

vi.mock("@agent-native/core/client/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/org")>()),
  useOrgRole: () => ({
    org: { orgId: "org-1" },
    canManageOrg: queryState.canManageOrg,
    isLoading: false,
    role: queryState.canManageOrg ? "admin" : "member",
  }),
}));

vi.mock("../../components/create-app-popover", () => ({
  CreateAppPopover: () => <span data-create-app />,
  NewAppButton: () => <span data-create-app />,
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

vi.mock("../../lib/workspace-app-layout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/workspace-app-layout")>()),
  orderWorkspaceApps: (apps: unknown[]) => apps,
  useWorkspaceAppLayout: () => ({
    layout: { pinnedIds: queryState.pinnedIds, orderedIds: [] },
    persistenceError: null,
    togglePinned: vi.fn(),
  }),
  workspaceAppMatchesQuery: () => true,
}));

import { TooltipProvider } from "../../components/ui/tooltip";
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
    queryState.pinnedIds = [];
    queryState.canManageOrg = false;
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
          <TooltipProvider>
            <AppsRouteEntry />
          </TooltipProvider>
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

  it.each([
    [true, "link"],
    [false, "disabled"],
  ] as const)(
    "puts pinned hosted apps first and hosted apps last (admin %s)",
    async (canManageOrg, manage) => {
      queryState.canManageOrg = canManageOrg;
      queryState.pinnedIds = ["clips"];
      queryState.workspaceApps = [
        { id: "notes", name: "Notes", path: "/notes", status: "ready" },
      ];
      queryState.connectedApps = [
        {
          id: "mail",
          name: "Mail",
          url: "https://mail.agent-native.com",
          source: "builtin",
        },
        {
          id: "clips",
          name: "Clips",
          url: "https://clips.agent-native.com",
          source: "builtin",
        },
      ];

      await renderAppsRoute();

      const sections = [...container.querySelectorAll("section[aria-label]")];
      expect(
        sections.map((section) => section.getAttribute("aria-label")),
      ).toEqual([
        "dispatch.pages.pinnedApps",
        "dispatch.pages.workspaceApps",
        "dispatch.pages.hostedApps",
      ]);
      expect(sections[0]?.textContent).toContain("Clips");
      expect(sections[1]?.textContent).toContain("Notes");
      expect(sections[2]?.textContent).toContain("Mail");
      expect(sections[2]?.textContent).not.toContain("Clips");
      const mailRow = sections[2]!;
      expect(
        mailRow.querySelector('a[href^="https://mail.agent-native.com"] svg'),
      ).not.toBeNull();
      expect(
        mailRow
          .querySelector('button[aria-label="dispatch.pages.pinApp"]')
          ?.getAttribute("aria-pressed"),
      ).toBe("false");
      const manageLink = mailRow.querySelector('a[href="/settings/apps"]');
      const manageButton = [...mailRow.querySelectorAll("button")].find(
        (button) => button.textContent === "dispatch.pages.manageHostedApps",
      );
      if (manage === "link") {
        expect(manageLink?.textContent).toBe("dispatch.pages.manageHostedApps");
      } else {
        expect(manageLink).toBeNull();
        expect(manageButton?.disabled).toBe(true);
      }
    },
  );

  it.each([
    ["loading", null],
    ["failed", new Error("Workspace app list failed")],
  ])(
    "lists no apps until the workspace list arrives (%s)",
    async (_state, error) => {
      queryState.workspaceApps = undefined;
      queryState.workspaceAppsError = error;
      queryState.connectedApps = [
        {
          id: "mail",
          name: "Mail",
          url: "https://mail.agent-native.com",
          source: "builtin",
        },
      ];

      await renderAppsRoute();

      expect(container.textContent).not.toContain("No workspace apps");
      expect(container.textContent).not.toContain("Mail");
    },
  );

  it("shows the empty state after successful app discovery", async () => {
    await renderAppsRoute();

    expect(container.textContent).toContain("No workspace apps");
  });

  it("keeps Add app when app discovery fails", async () => {
    queryState.workspaceApps = [];
    queryState.connectedAppsError = new Error("discovery down");
    await renderAppsRoute();

    expect(container.querySelectorAll("[data-create-app]")).toHaveLength(1);
  });

  it("offers one Add app when only hosted apps are listed", async () => {
    queryState.connectedApps = [
      {
        id: "mail",
        name: "Mail",
        url: "https://mail.agent-native.com",
        source: "builtin",
      },
    ];
    await renderAppsRoute();

    expect(container.textContent).toContain("No workspace apps");
    expect(container.querySelectorAll("[data-create-app]")).toHaveLength(1);
  });

  it("identifies each app discovery query when both fail", async () => {
    queryState.workspaceAppsError = new Error("Workspace app list failed");
    queryState.connectedAppsError = new Error("Connected agent list failed");

    await renderAppsRoute();

    const errors = Array.from(
      container.querySelectorAll('[role="alert"]'),
      (alert) => alert.textContent,
    );
    expect(errors).toContain("list-workspace-apps: Workspace app list failed");
    expect(errors).toContain(
      "list-connected-agents: Connected agent list failed",
    );
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
        ref: "main",
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
    expect(
      container.querySelector<HTMLAnchorElement>("a[href*='github.com']")?.href,
    ).toContain("/tree/main/templates/community/qr");
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
        ref: "main",
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
        ref: "main",
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

  it("explains when Builder-mode community installs cannot be verified", async () => {
    queryState.communityAppsEnabled = true;
    queryState.communityApps = [
      {
        id: "community-qr",
        name: "QR",
        description: "Generate QR images.",
        appId: "community-qr",
        repo: "BuilderIO/agent-native",
        ref: "main",
        license: "MIT",
        provenance: "Reviewed source",
        templatePath: "templates/community/qr",
        installed: false,
        pending: false,
        installable: false,
        installUnavailableReason: "builder-install-unverified",
      },
    ];

    await renderAppsRoute();

    expect(container.textContent).toContain(
      "dispatch.pages.communityAppsBuilderInstallUnavailable",
    );
    expect(
      Array.from(container.querySelectorAll("button")).some((button) =>
        button.textContent?.includes("dispatch.pages.communityAppsInstall"),
      ),
    ).toBe(false);
  });
});
