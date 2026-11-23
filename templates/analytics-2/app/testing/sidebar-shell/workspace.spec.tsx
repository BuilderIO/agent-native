// @vitest-environment happy-dom
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ANALYTICS_CONTROL_IDS } from "../../../shared/analytics-control-ids";
import { capabilityDecisionSchema } from "../../../shared/capabilities";
import { WorkspaceShell } from "../../components/shell/WorkspaceShell";
import {
  shellProps,
  workspaceRows,
  workspaceMenuRows,
  themeRows,
  accountRows,
  notificationRows,
  moreRows,
} from "./fixtures";
import {
  init,
  dispose,
  mount,
  capture,
  button,
  click,
  key,
  media,
  input,
  navigate,
  storageEvents,
} from "./harness";
afterEach(dispose);
const base = {
  host: "WorkspaceShell",
  query: "ready",
  profile: "existing",
  notifications: "unbound",
  accountHandlers: "absent",
  workspaceHandlers: "absent",
};
function snap(
  name: string,
  rows: string[] = workspaceRows,
  state: Record<string, unknown> = {},
) {
  return capture(name, rows, { ...base, ...state });
}
it("lists every configured Help destination as an external link", async () => {
  init();
  const copyDebugInfo = vi.fn();
  await mount(
    <WorkspaceShell
      {...shellProps()}
      accountMenu={{ onCopyDebugInfo: copyDebugInfo }}
    />,
  );
  await click(button("Test Person account menu"));
  const menu = document.querySelector('[aria-label="Account menu"]');
  expect(menu).toBeTruthy();
  expect(menu?.querySelector('[role="separator"]')).not.toBeNull();
  const links = [...(menu?.querySelectorAll("a[data-menu-item]") ?? [])];
  expect(
    links.map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Documentation", "https://www.agent-native.com/docs/"],
    ["Changelog", "https://github.com/BuilderIO/agent-native/releases"],
    ["Agent-Native status", "https://status.builder.io/"],
    ["Email support", "mailto:support@builder.io"],
  ]);
  for (const link of links) expect(link.querySelector("svg")).not.toBeNull();
  await click(button("Copy debug info..."));
  expect(copyDebugInfo).toHaveBeenCalledOnce();
});

it("freezes desktop menus, disabled actions, filters and theme choices", async () => {
  init();
  await mount(<WorkspaceShell {...shellProps()} />);
  snap("desktop-default");
  await click(
    button(
      "Test workspace",
      document.querySelector(".ws-sidebar") as HTMLElement,
    ),
  );
  snap("workspace-menu", [...workspaceRows, ...workspaceMenuRows]);
  expect(
    (document.querySelectorAll(".ws-workspace-row")[1] as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  for (const label of [
    "Add a new workspace",
    "Log out of Test workspace",
    "Log out of all workspaces",
  ])
    expect(button(label).disabled).toBe(true);
  await input(
    document.querySelector(
      'input[aria-label="Search workspaces"]',
    ) as HTMLInputElement,
    "missing",
  );
  snap(
    "workspace-search-empty",
    workspaceMenuRows.filter((r) => r !== "sidebar.workspace.switch.item"),
    { search: "missing" },
  );
  expect(document.querySelectorAll(".ws-workspace-row")).toHaveLength(0);
  await input(
    document.querySelector(
      'input[aria-label="Search workspaces"]',
    ) as HTMLInputElement,
    "test",
  );
  snap("workspace-search-match", workspaceMenuRows, { search: "test" });
  await click(button("Preferences"));
  snap("workspace-preferences", [
    ...workspaceMenuRows,
    ...themeRows,
    "sidebar.workspace.preferences.all",
  ]);
  await key(
    document.querySelector('[aria-label="Test workspace menu"]') as HTMLElement,
    "Escape",
  );
  await click(button("Test Person account menu"));
  snap("account-help", [...workspaceRows, ...accountRows]);
  expect(
    [
      ...document.querySelectorAll(
        '[aria-label="Account menu"] a[data-menu-item]',
      ),
    ].map((link) => [link.textContent, link.getAttribute("href")]),
  ).toEqual([
    ["Documentation", "https://www.agent-native.com/docs/"],
    ["Changelog", "https://github.com/BuilderIO/agent-native/releases"],
    ["Agent-Native status", "https://status.builder.io/"],
    ["Email support", "mailto:support@builder.io"],
  ]);
  expect(button("Copy debug info...").disabled).toBe(true);
  await click(button("Theme"));
  snap("account-theme-system", [...accountRows, ...themeRows], {
    theme: "system",
    media: "light",
  });
  for (const theme of ["Dark", "Light", "System (Light)"]) {
    await click(button(theme));
    snap(
      `account-theme-${theme.startsWith("System") ? "system-selected" : theme.toLowerCase()}`,
      [...accountRows, ...themeRows],
      { preference: theme },
    );
  }
  expect(
    storageEvents
      .filter((e) => e.operation === "setItem" && e.key === "theme")
      .map((e) => e.value),
  ).toEqual(["dark", "light", "system"]);
  await media({ dark: true });
  snap("account-theme-system-dark", [...accountRows, ...themeRows], {
    media: "dark",
  });
  expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  await key(
    document.querySelector('[aria-label="Account menu"]') as HTMLElement,
    "Escape",
  );
  await click(button("Notifications"));
  snap("notifications-unbound", [...workspaceRows, ...notificationRows]);
  expect(button("Mark all as read").disabled).toBe(true);
  await click(button("All notifications"));
  snap("notifications-filter", [
    ...notificationRows,
    "sidebar.notifications.filter.all",
    "sidebar.notifications.filter.unread",
  ]);
  await click(button("Unread only"));
  snap("notifications-unread", notificationRows, { filter: "unread" });
  expect(document.body.textContent).toContain(
    "Notifications are not connected.",
  );
  await key(document.querySelector('[role="dialog"]') as HTMLElement, "Escape");
  await click(button("Create new"));
  snap("create-menu", [
    ...workspaceRows,
    "sidebar.create.menu.project",
    "sidebar.create.menu.thread",
    "sidebar.create.menu.upload-project",
  ]);
  await key(
    document.querySelector(
      '[aria-label="Create new"][role="menu"]',
    ) as HTMLElement,
    "Escape",
  );
  await click(button("More"));
  snap("more-manager", [...workspaceRows, ...moreRows]);
});
it.each([1280, 1051, 1050, 701, 700, 420])(
  "records breakpoint %i, drawer dismissal and resize",
  async (width) => {
    init({ width });
    await mount(<WorkspaceShell {...shellProps()} />);
    const sidebar = document.querySelector(".ws-sidebar") as HTMLElement;
    snap(
      `viewport-${width}-settled`,
      width <= 1050
        ? [
            "shell.nav",
            "shell.header.mobile",
            "shell.nav.open",
            "shell.nav.close",
            "shell.main",
          ]
        : workspaceRows,
      { width, state: "settled" },
    );
    expect(sidebar.dataset.closed).toBe(String(width <= 1050));
    if (width <= 1050) {
      await click(button("Open navigation"));
      snap(
        `viewport-${width}-open`,
        [
          ...workspaceRows,
          "shell.header.mobile",
          "shell.nav.open",
          "shell.nav.close",
          "shell.nav.dismiss",
        ],
        { width, state: "open" },
      );
      await click(document.querySelector(".ws-overlay") as HTMLElement);
      expect(sidebar.dataset.closed).toBe("true");
      await click(button("Open navigation"));
      await click(button("Close navigation", sidebar));
      expect(sidebar.dataset.closed).toBe("true");
      await click(button("Open navigation"));
      await click(sidebar.querySelector('a[href="/home/data"]') as HTMLElement);
      expect(sidebar.dataset.closed).toBe("true");
      snap(
        `viewport-${width}-navigated`,
        ["shell.nav", "shell.main", "shell.nav.open"],
        { width, path: "/home/data" },
      );
      await media({ width: 1280 });
      expect(sidebar.dataset.closed).toBe("false");
      await media({ width: 1050 });
      expect(sidebar.dataset.closed).toBe("true");
      snap(
        `viewport-${width}-resized`,
        ["shell.nav", "shell.nav.open", "shell.main"],
        { width: 1050 },
      );
    }
    expect(storageEvents.filter((e) => e.operation === "setItem")).toEqual([]);
  },
);
it("records route segment active states and exact More matching", async () => {
  init();
  await mount(<WorkspaceShell {...shellProps()} />);
  for (const path of [
    "/",
    "/home",
    "/home/data",
    "/home/data/child",
    "/home/folders/child",
    "/home/drafts/child",
    "/home/all/child",
    "/home/collections/child",
    "/home/threads/child",
    "/home/tasks/child",
    "/home/archive/child",
    "/home/trash/child",
    "/home/database",
    "/home/components",
    "/home/components/child",
    "/home/library",
    "/home/explorations",
    "/home/agent-dev-tools",
    "/context-studio/setup",
    "/context-studio/models/nested",
  ]) {
    await act(async () => navigate(path));
    snap(
      `route-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root"}`,
      workspaceRows,
      { path },
    );
  }
});
// oracle-change: WorkspaceShell.context-studio.spec.tsx checks the single Context Studio row that replaces the sidebar checklist.
it("keeps feature gates, empty sections and disclosure", async () => {
  init();
  const captureFeatureState = (
    name: string,
    rows: string[],
    state: Record<string, unknown>,
  ) =>
    capture(name, rows, { ...base, ...state }, null, {
      normalizeControlIds: true,
    });
  const fixture = shellProps();
  const props = {
    ...fixture,
    capabilities: [
      capabilityDecisionSchema.parse({
        controlId: ANALYTICS_CONTROL_IDS.dataBrowse,
        scope: { kind: "workspace", workspaceId: fixture.workspace.id },
        status: "allowed",
        target: { kind: "route", routeId: "data-browser" },
      }),
    ],
  };
  const app = await mount(<WorkspaceShell {...props} />);
  for (const label of [
    "RECENTS",
    "Favorite projects",
    "Favorite collections",
    "Favorite data",
  ])
    await click(button(label));
  captureFeatureState(
    "sections-closed",
    workspaceRows.filter(
      (row) => !row.endsWith(".item") && row !== "sidebar.nav.tasks",
    ),
    { sections: "closed" },
  );
  expect(document.querySelectorAll(".ws-section-row")).toHaveLength(0);
  await app.update(
    <WorkspaceShell
      {...shellProps({
        capabilities: [],
        recents: [],
        favorites: [],
        features: {
          ...props.features,
          folders: false,
          tasks: false,
          threads: false,
          library: false,
          developerTools: false,
          contextStudio: false,
          canCreateProject: false,
          canCreateThread: false,
        },
      })}
    />,
  );
  captureFeatureState(
    "features-off-empty",
    [
      "shell.nav",
      "sidebar.create.project",
      "sidebar.create.thread",
      "sidebar.footer",
      "shell.main",
    ],
    { features: "off", rows: "empty" },
  );
  expect(button("Project").disabled).toBe(true);
  expect(button("Thread").disabled).toBe(true);
  await click(button("Create new"));
  captureFeatureState(
    "create-disabled",
    [
      "sidebar.create.menu.project",
      "sidebar.create.menu.thread",
      "sidebar.create.menu.upload-project",
    ],
    { create: false },
  );
  expect(button("New project").disabled).toBe(true);
  await key(document.querySelector('[role="menu"]') as HTMLElement, "Escape");
  await app.update(
    <WorkspaceShell
      {...props}
      features={{ ...props.features, isManagerOrAbove: false }}
    />,
  );
  await click(button("More"));
  captureFeatureState(
    "more-member",
    ["sidebar.more.library", "sidebar.nav.context"],
    { manager: false },
  );
  await key(document.querySelector('[role="menu"]') as HTMLElement, "Escape");
});
// oracle-change: keyboard assertions moved to the application-mounted frames spec, which now owns the listener.
it("dispatches the shell's search and creation actions", async () => {
  init();
  const search = vi.fn(),
    create = vi.fn(),
    thread = vi.fn(),
    upload = vi.fn();
  await mount(
    <WorkspaceShell
      {...shellProps({
        onOpenSearch: search,
        onCreateProject: create,
        onCreateThread: thread,
        quickCreate: { onImportProject: upload },
      })}
    />,
  );
  await click(
    button("Search", document.querySelector(".ws-sidebar") as HTMLElement),
  );
  expect(search).toHaveBeenCalledTimes(1);
  await click(button("Project"));
  await click(button("Thread"));
  await click(button("Create new"));
  await click(button("Upload project"));
  expect(create).toHaveBeenCalledTimes(1);
  expect(thread).toHaveBeenCalledTimes(1);
  expect(upload).toHaveBeenCalledTimes(1);
  snap("shortcut-owner", ["shell.shortcuts", "sidebar.nav.search"], {
    owner: "WorkspaceApplication window bubble keydown",
    effectsPerShortcut: 1,
    collapseShortcut: "absent",
  });
});
it("records menu focus, Escape return, Tab dismissal and filter keyboard gap", async () => {
  init();
  await mount(<WorkspaceShell {...shellProps()} />);
  const trigger = button("More");
  await key(trigger, "ArrowDown");
  expect(document.activeElement?.textContent).toBe("Library");
  expect(document.querySelector('a[href="/home/components"]')).toBeNull();
  await key(document.activeElement as HTMLElement, "End");
  expect(document.activeElement?.textContent).toBe("Context Studio");
  await key(document.activeElement as HTMLElement, "ArrowDown");
  expect(document.activeElement?.textContent).toBe("Library");
  await key(document.activeElement as HTMLElement, "Escape");
  expect(document.activeElement).toBe(trigger);
  await click(trigger);
  await key(document.activeElement as HTMLElement, "Tab");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await click(button("Notifications"));
  await click(button("All notifications"));
  const unread = button("Unread only");
  unread.focus();
  await key(unread, "ArrowDown");
  expect(document.activeElement).toBe(unread);
  snap(
    "filter-keyboard-gap",
    ["sidebar.notifications.filter.all", "sidebar.notifications.filter.unread"],
    { arrowNavigation: "absent" },
  );
});
