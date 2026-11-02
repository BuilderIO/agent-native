// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launcherState = vi.hoisted(() => ({
  value: {
    apps: [
      { id: "plan", name: "Plan" },
      { id: "mail", name: "Mail" },
    ],
    workspaceApps: [
      {
        id: "plan",
        name: "Plan",
        description: "Structured project plans",
        path: "/plan",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Email and inbox",
        path: "/mail",
      },
    ],
    workspaceAppsStatus: "ready" as "loading" | "error" | "ready",
    error: undefined as unknown,
    errorQueryName: undefined as
      | "list-workspace-apps"
      | "list-connected-agents"
      | undefined,
    openApp: vi.fn(),
    retry: vi.fn(),
  },
}));
const appLayoutState = vi.hoisted(() => ({
  value: { pinnedIds: ["mail"], orderedIds: ["mail", "plan"] },
  togglePinned: vi.fn(),
}));

vi.mock("@agent-native/core/client/i18n", () => ({
  useT: () => (key: string, values?: { name?: string }) =>
    ({
      "dispatch.nav.apps": "Apps",
      "dispatch.pages.allApps": "All apps",
      "dispatch.pages.openApp": "Open",
      "dispatch.pages.chatFirstOpenApp": "Open {{name}}",
      "dispatch.pages.chatFirstOpenInNewTab": "Open in new tab",
      "dispatch.pages.chatFirstDefaultDescriptionCalendar":
        "Localized Calendar description",
      "extensions.optionsFor": "Options for {{name}}",
      "dispatch.pages.searchApps": "Search apps",
      "dispatch.pages.searchAppsPlaceholder": "Search apps",
      "dispatch.pages.hostedApps": "Hosted apps",
      "dispatch.pages.pinApp": "Pin {{name}}",
      "dispatch.pages.unpinApp": "Unpin {{name}}",
      "dispatch.pages.pinnedApps": "Pinned apps",
      "dispatch.pages.workspaceApps": "Workspace apps",
      "dispatch.pages.viewAllApps": "View all",
      "dispatch.pages.newApp": "New app",
    })[key]?.replace("{{name}}", values?.name ?? "") ?? key,
}));

vi.mock("@agent-native/core/client/org", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/client/org")>()),
  useOrgRole: () => ({
    org: { orgId: "org-1" },
    canManageOrg: true,
    isLoading: false,
  }),
}));

vi.mock("./layout/Layout", () => ({
  dispatchNavLinkTarget: (path: string) => path,
  useDispatchWorkspaceAppLauncher: () => launcherState.value,
}));

vi.mock("../lib/workspace-app-layout", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/workspace-app-layout")>();
  return {
    ...actual,
    useWorkspaceAppLayout: () => ({
      layout: appLayoutState.value,
      togglePinned: appLayoutState.togglePinned,
    }),
  };
});

import { DispatchChatHomeApps } from "./chat-home-apps";
import { TooltipProvider } from "./ui/tooltip";

function renderChatHome(root: Root) {
  root.render(
    <MemoryRouter initialEntries={["/chat"]}>
      <TooltipProvider>
        <DispatchChatHomeApps />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("DispatchChatHomeApps", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    launcherState.value.workspaceApps = [
      {
        id: "plan",
        name: "Plan",
        description: "Structured project plans",
        path: "/plan",
      },
      {
        id: "mail",
        name: "Mail",
        description: "Email and inbox",
        path: "/mail",
      },
    ];
    launcherState.value.openApp.mockReset();
    appLayoutState.togglePinned.mockReset();
    appLayoutState.value = {
      pinnedIds: ["mail"],
      orderedIds: ["mail", "plan"],
    };
    launcherState.value.retry.mockReset();
    launcherState.value.workspaceAppsStatus = "ready";
    launcherState.value.error = undefined;
    launcherState.value.errorQueryName = undefined;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("renders the searchable Electron-style app directory and open actions", async () => {
    await act(async () => {
      renderChatHome(root);
    });

    const section = container.querySelector("section[aria-label='Workspace apps']");
    const grid = section?.querySelector(".grid.grid-cols-1");
    expect(grid?.className.split(" ")).toContain("sm:grid-cols-2");
    expect(section?.querySelectorAll("article")).toHaveLength(1);
    expect(section?.textContent).toContain("Plan");
    expect(
      container.querySelector("section[aria-label='Pinned apps']")?.textContent,
    ).toContain("Mail");
    expect(container.textContent).toContain("Structured project plans");
    expect(
      container.querySelector("button[aria-label='Options for Mail']"),
    ).not.toBeNull();
    expect(
      container.querySelector("button[aria-label='Options for Plan']"),
    ).not.toBeNull();
    expect(container.querySelector("button[aria-label='Open Plan']")).not.toBe(
      null,
    );
    expect(
      container.querySelector<HTMLElement>(
        "article [aria-hidden='true'][style*='--dispatch-app-icon-color-rgb']",
      ),
    ).not.toBeNull();

    const allAppsLink =
      container.querySelector<HTMLAnchorElement>("a[href='/apps']");
    expect(allAppsLink?.textContent?.trim()).toBe("View all");
    // View all sits in the header cluster, not below the list.
    expect(allAppsLink?.closest("section[aria-label]")).not.toBeNull();
  });

  it("filters app descriptions and opens the selected app", async () => {
    await act(async () => {
      renderChatHome(root);
    });

    const search = container.querySelector<HTMLInputElement>(
      "input[placeholder='Search apps']",
    );
    expect(search).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(search, "inbox");
      search!.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container.querySelectorAll("article")).toHaveLength(1);
    expect(container.textContent).toContain("Mail");
    expect(container.textContent).not.toContain("Plan");
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>("button[aria-label='Open Mail']")
        ?.click();
    });
    expect(launcherState.value.openApp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "mail" }),
    );
  });

  it("localizes the default description for a built-in app", async () => {
    launcherState.value.workspaceApps = [
      {
        id: "calendar",
        name: "Calendar",
        description: "Default English text",
        defaultDescriptionKey:
          "dispatch.pages.chatFirstDefaultDescriptionCalendar",
        path: "/calendar",
      },
    ];

    await act(async () => {
      renderChatHome(root);
    });

    expect(container.textContent).toContain("Localized Calendar description");
    expect(container.textContent).not.toContain("Default English text");
  });

  it("tiers pinned, workspace and hosted apps with a pin button on each row", async () => {
    launcherState.value.workspaceApps = [
      { id: "zeta", name: "Zeta", path: "/zeta" },
      { id: "mail", name: "Mail", source: "builtin", url: "https://m.test" },
      { id: "alpha", name: "Alpha", path: "/alpha" },
      { id: "plan", name: "Plan", path: "/plan" },
      { id: "clips", name: "Clips", source: "builtin", url: "https://c.test" },
    ] as typeof launcherState.value.workspaceApps;
    appLayoutState.value = { pinnedIds: ["plan", "mail"], orderedIds: [] };

    await act(async () => renderChatHome(root));

    const names = (label: string) =>
      [
        ...container.querySelectorAll(
          `section[aria-label='${label}'] article .font-semibold`,
        ),
      ].map((node) => node.textContent);
    expect(names("Pinned apps")).toEqual(["Plan", "Mail"]);
    expect(names("Workspace apps")).toEqual(["Alpha", "Zeta"]);
    expect(names("Hosted apps")).toEqual(["Clips"]);
    expect(
      container.querySelector("section[aria-label='Hosted apps'] a")
        ?.textContent,
    ).toBe("dispatch.pages.manageHostedApps");

    const unpinMail = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Unpin Mail']",
    );
    expect(unpinMail?.getAttribute("aria-pressed")).toBe("true");
    const pinClips = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Pin Clips']",
    );
    expect(pinClips?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => pinClips?.click());
    expect(appLayoutState.togglePinned).toHaveBeenCalledWith("clips");
    expect(launcherState.value.openApp).not.toHaveBeenCalled();
  });

  it("says the workspace has no apps under Apps when only hosted apps exist", async () => {
    launcherState.value.workspaceApps = [
      { id: "mail", name: "Mail", source: "builtin", url: "https://m.test" },
    ] as typeof launcherState.value.workspaceApps;
    appLayoutState.value = { pinnedIds: [], orderedIds: [] };

    await act(async () => renderChatHome(root));

    expect(
      container.querySelector("section[aria-label='Workspace apps']")?.textContent,
    ).toContain("dispatch.pages.chatFirstNoWorkspaceApps");
    expect(
      container.querySelectorAll("section[aria-label='Hosted apps'] article"),
    ).toHaveLength(1);
  });

  it("does not claim there are no apps while workspace apps load", async () => {
    launcherState.value.workspaceApps = [];
    launcherState.value.workspaceAppsStatus = "loading";

    await act(async () => renderChatHome(root));

    expect(container.textContent).not.toContain(
      "dispatch.pages.chatFirstNoWorkspaceApps",
    );
  });

  it("keeps the Apps header and New app trigger with no apps at all", async () => {
    launcherState.value.workspaceApps = [];

    await act(async () => renderChatHome(root));

    const apps = container.querySelector("section[aria-label='Workspace apps']");
    expect(apps?.textContent).toContain("New");
    expect(apps?.textContent).toContain(
      "dispatch.pages.chatFirstNoWorkspaceApps",
    );
  });

  it.each([
    ["list-workspace-apps", "Workspace apps failed"],
    ["list-connected-agents", "Connected agents failed"],
  ] as const)("identifies the failed %s query", async (queryName, message) => {
    launcherState.value.workspaceApps = [];
    launcherState.value.error = Object.assign(new Error(message), {
      statusCode: 503,
      errorCode: "workspace_gateway_unavailable",
    });
    launcherState.value.errorQueryName = queryName;

    await act(async () => {
      renderChatHome(root);
    });

    expect(container.textContent).toContain(
      `${queryName} · HTTP 503 · workspace_gateway_unavailable`,
    );
    expect(container.textContent).not.toContain(message);
  });
});
