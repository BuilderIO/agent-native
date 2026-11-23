import {
  useNavigationDisclosure,
  type NavigationEntry,
  type NavigationSection,
  type ShellActionEffect,
  type ShellBinding,
  type ShellModel,
  type ShellShortcutDescriptor,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import { useState } from "react";

import { useThemePreference } from "../../../components/shell/theme-preference";
import type {
  WorkspaceShellProps,
  WorkspaceShellRow,
} from "../../../components/shell/types";
import { shellProps } from "../fixtures";
import type { ContextSetupState } from "./setup";

export interface WorkspaceFixture {
  name: string;
  path?: string;
  width?: number;
  dark?: boolean;
  theme?: string;
  props?: Partial<WorkspaceShellProps> & { contextSetup?: ContextSetupState };
  menu?: "workspace" | "account" | "notifications" | "create" | "more";
  submenu?: "preferences" | "theme";
  search?: string;
  filter?: "all" | "unread";
  filterOpen?: boolean;
  sectionsClosed?: boolean;
  closedSections?: readonly string[];
  drawerOpen?: boolean;
}

const identity = (
  id: string,
  containerId: string,
  order: number,
): NavigationEntry => ({
  id,
  part: "sidebar",
  subPart: "sidebar.item",
  containerId,
  order,
  kind: "action",
});
const symbol = (key: string): NonNullable<NavigationEntry["icon"]> => ({
  kind: "symbol",
  key,
});
const resolved = (value: boolean): NonNullable<NavigationEntry["active"]> => ({
  kind: "resolved",
  value,
  ruleId: "workspace-path",
});
const action = (effectId: string): NonNullable<NavigationEntry["effect"]> => ({
  kind: "action",
  effectId,
});
const entry = (
  id: string,
  container: string,
  order: number,
  label: string,
  icon?: string,
): NavigationEntry => ({
  ...identity(id, container, order),
  label,
  ...(icon ? { icon: symbol(icon) } : {}),
});
const guard: ShellShortcutDescriptor["guard"] = {
  focusKinds: ["page"],
  allowRepeat: true,
  composition: "allow",
  overlay: "allow",
  respectDefaultPrevented: false,
};
export const searchShortcut: ShellShortcutDescriptor = {
  id: "shell.search.meta",
  actionName: "open-search",
  ownerId: "workspace",
  keys: [{ key: "k", meta: true }],
  displayLabel: "⌘ K",
  platform: "all",
  scope: "home",
  phase: "bubble",
  guard,
};

export function useWorkspaceModel(
  fixture: WorkspaceFixture = { name: "desktop-default" },
): ShellModel {
  const props = shellProps(fixture.props);
  const path = fixture.path ?? "/home";
  const [opened, setOpened] = useState<Record<string, boolean>>(() => ({
    workspace: fixture.menu === "workspace",
    account: fixture.menu === "account",
    notifications: fixture.menu === "notifications",
    create: fixture.menu === "create",
    more: fixture.menu === "more",
    preferences: fixture.submenu === "preferences",
    theme: fixture.submenu === "theme",
    filter: fixture.filterOpen ?? false,
  }));
  const [search, setSearch] = useState(fixture.search ?? "");
  const [filter, setFilter] = useState(fixture.filter ?? "all");
  const [drawerOpen, setDrawerOpen] = useState(
    fixture.drawerOpen ?? (fixture.width ?? 1280) > 1050,
  );
  const sectionKeys = [
    "recents",
    "favorite-projects",
    "favorite-collections",
    "favorite-data",
  ];
  const disclosure = useNavigationDisclosure(
    fixture.sectionsClosed
      ? []
      : sectionKeys.filter((key) => !fixture.closedSections?.includes(key)),
    { revealActive: false, expandNewFavorites: false },
  );
  const theme = useThemePreference();
  function open(key: string): ShellBinding<boolean> {
    return {
      value: opened[key] ?? false,
      set(value) {
        setOpened((current) => ({
          ...current,
          [key]: value,
          ...(!value && key === "workspace" ? { preferences: false } : {}),
          ...(!value && key === "account" ? { theme: false } : {}),
          ...(!value && key === "notifications" ? { filter: false } : {}),
        }));
      },
    };
  }
  function menu(model: NavigationEntry, key: string): NavigationEntry {
    return {
      ...model,
      kind: "disclosure",
      effect: {
        kind: "open",
        surfaceId: key,
        open: open(key),
        body: { owner: "model", key },
      },
    };
  }
  const effects: ShellActionEffect[] = [
    {
      kind: "action",
      id: "close-workspace-menu",
      actionName: "close-workspace-menu",
      run() {
        open("workspace").set?.(false);
      },
    },
    {
      kind: "action",
      id: "create-project",
      actionName: "create-project",
      run: () => props.onCreateProject(),
    },
    {
      kind: "action",
      id: "create-thread",
      actionName: "create-thread",
      run: () => props.onCreateThread(),
    },
    {
      kind: "action",
      id: "open-search",
      actionName: "open-search",
      run: () => props.onOpenSearch(),
    },
    {
      kind: "action",
      id: "close-drawer",
      actionName: "close-navigation",
      run() {
        if ((fixture.width ?? 1280) <= 1050) setDrawerOpen(false);
      },
    },
    {
      kind: "action",
      id: "filter-all",
      actionName: "filter-notifications",
      run() {
        setFilter("all");
      },
    },
    {
      kind: "action",
      id: "filter-unread",
      actionName: "filter-notifications",
      run() {
        setFilter("unread");
      },
    },
    {
      kind: "action",
      id: "theme-system",
      actionName: "set-theme",
      run() {
        theme.setPreference("system");
      },
    },
    {
      kind: "action",
      id: "theme-light",
      actionName: "set-theme",
      run() {
        theme.setPreference("light");
      },
    },
    {
      kind: "action",
      id: "theme-dark",
      actionName: "set-theme",
      run() {
        theme.setPreference("dark");
      },
    },
  ];
  if (props.quickCreate?.onImportProject)
    effects.push({
      kind: "action",
      id: "import-project",
      actionName: "import-project",
      run: () => props.quickCreate?.onImportProject?.(),
    });
  const closeIntent: NavigationEntry = {
    ...identity("shell.nav.close", "drawer-close", 0),
    part: "app-shell",
    subPart: "app-shell.nav",
    accessibleLabel: "Close navigation",
    effect: action("close-drawer"),
  };
  function destination(
    id: string,
    container: string,
    order: number,
    label: string,
    icon: string,
    to: string,
    active: boolean,
  ): NavigationEntry {
    return {
      ...entry(id, container, order, label, icon),
      kind: "destination",
      effect: { kind: "navigate", to, close: "mobile" },
      active: resolved(active),
      trailingActions: [closeIntent],
    };
  }
  const themeEntries = (): NavigationEntry[] => [
    {
      ...entry("sidebar.theme.heading", "theme-choices", 0, "Theme"),
      kind: "heading",
    },
    ...(["system", "light", "dark"] as const).map(
      (value, order): NavigationEntry => ({
        ...entry(
          `sidebar.theme.${value}`,
          "theme-choices",
          order + 1,
          value === "system"
            ? `System (${theme.systemTheme === "dark" ? "Dark" : "Light"})`
            : value === "light"
              ? "Light"
              : "Dark",
        ),
        kind: "choice",
        effect: action(`theme-${value}`),
        active: resolved(theme.preference === value),
        metadata: { current: theme.preference === value },
      }),
    ),
  ];
  const workspaceEntries = props.workspaceMenu?.workspaces?.length
    ? props.workspaceMenu.workspaces
    : [props.workspace];
  const authenticatedCount = workspaceEntries.filter(
    (row) => !("needsLogin" in row && row.needsLogin),
  ).length;
  const workspace = menu(
    {
      ...entry(
        "sidebar.workspace.open",
        "header-workspace",
        0,
        props.workspace.name,
      ),
      kind: "identity",
      accessibleLabel: `${props.workspace.name} menu`,
      children: [
        menu(
          {
            ...entry(
              "sidebar.workspace.preferences",
              "workspace-preferences",
              0,
              "Preferences",
              "adjustments",
            ),
            children: [
              ...themeEntries(),
              {
                ...destination(
                  "sidebar.workspace.preferences.all",
                  "preferences-link",
                  4,
                  "All preferences",
                  "",
                  "/settings/preferences",
                  false,
                ),
                trailingActions: [
                  closeIntent,
                  {
                    ...entry(
                      "sidebar.workspace.preferences.close",
                      "workspace-menu-close",
                      0,
                      "",
                    ),
                    effect: action("close-workspace-menu"),
                  },
                ],
              },
            ],
          },
          "preferences",
        ),
        ...(workspaceEntries.length > 3
          ? [
              {
                ...entry("sidebar.workspace.search", "workspace-search", 1, ""),
                kind: "filter" as const,
                accessibleLabel: "Search workspaces",
                search: {
                  binding: { value: search, set: setSearch },
                  placeholder: "Search workspaces...",
                  match: "label-substring" as const,
                },
              },
            ]
          : []),
        ...workspaceEntries.map((row, order): NavigationEntry => {
          const needsLogin = "needsLogin" in row && row.needsLogin === true;
          const current = row.id === props.workspace.id;
          const children: NavigationEntry[] = [];
          if ("memberCount" in row && row.memberCount && row.memberCount > 0)
            children.push(
              entry(
                "sidebar.workspace.subtitle.members",
                "workspace-subtitle",
                0,
                `${row.memberCount} ${row.memberCount === 1 ? "member" : "members"}`,
              ),
            );
          if ("role" in row && row.role)
            children.push(
              entry(
                "sidebar.workspace.subtitle.role",
                "workspace-subtitle",
                children.length,
                row.role,
              ),
            );
          return {
            ...entry(
              "sidebar.workspace.switch.item",
              "workspace-choices",
              order,
              row.name,
            ),
            kind: "choice",
            entityKey: row.id,
            active: resolved(current),
            disabled: !current,
            ...(!current
              ? {
                  tooltip: needsLogin
                    ? "Workspace login is not connected."
                    : "Workspace switching is not connected.",
                }
              : {}),
            effect: current ? action("close-drawer") : { kind: "none" },
            children,
            ...(needsLogin ? { icon: symbol("login") } : {}),
            family: {
              members: workspaceEntries.map((workspace) => workspace.id),
              entityKeySource: "workspaceMenu.workspaces[*].id",
            },
            badge: {
              kind: "text",
              text: "SSO required",
              visible:
                needsLogin && "ssoEnforced" in row && row.ssoEnforced === true,
            },
          };
        }),
        {
          ...entry(
            "sidebar.workspace.add",
            "workspace-add",
            0,
            "Add a new workspace",
            "plus",
          ),
          disabled: true,
          tooltip: "Adding a workspace is not connected.",
          effect: { kind: "none" },
        },
        {
          ...entry(
            "sidebar.workspace.log-out",
            "workspace-logout",
            0,
            authenticatedCount > 1
              ? `Log out of ${props.workspace.name}`
              : "Log out",
            "arrow",
          ),
          disabled: true,
          tooltip: "Log out is not connected.",
          effect: { kind: "none" },
        },
        ...(authenticatedCount > 1
          ? [
              {
                ...entry(
                  "sidebar.workspace.log-out-all",
                  "workspace-logout",
                  1,
                  "Log out of all workspaces",
                  "logout",
                ),
                disabled: true,
                tooltip: "Log out of all workspaces is not connected.",
                effect: { kind: "none" as const },
              },
            ]
          : []),
      ],
    },
    "workspace",
  );
  const notificationFilter = menu(
    {
      ...entry(
        "sidebar.notifications.filter",
        "notification-filter",
        0,
        filter === "all" ? "All notifications" : "Unread only",
      ),
      children: (["all", "unread"] as const).map((value, order) => ({
        ...entry(
          `sidebar.notifications.filter.${value}`,
          "notification-choices",
          order,
          value === "all" ? "All notifications" : "Unread only",
        ),
        kind: "choice",
        active: resolved(filter === value),
        effect: action(`filter-${value}`),
      })),
    },
    "filter",
  );
  const notifications = menu(
    {
      ...entry(
        "sidebar.notifications.open",
        "header-notifications",
        1,
        "Notifications",
      ),
      accessibleLabel: "Notifications",
      controlLabel: "Notifications",
      tooltip: "Notifications",
      children: [
        notificationFilter,
        {
          ...entry(
            "sidebar.notifications.mark-all-read",
            "notification-mark",
            1,
            "Mark all as read",
          ),
          disabled: true,
          effect: { kind: "none" },
        },
        {
          ...entry(
            "sidebar.notifications.empty",
            "notification-body",
            2,
            "Notifications are not connected.",
          ),
          kind: "status",
          description: "Notification data has not been provided to this shell.",
        },
      ],
    },
    "notifications",
  );
  const displayName = props.user.name || props.user.email || "Account";
  const avatar =
    (props.user.name.trim() || props.user.email.trim()).charAt(0) || "?";
  const help = [
    [
      "documentation",
      "Documentation",
      "book",
      "Documentation is not connected.",
    ],
    ["changelog", "Changelog", "history", "Changelog is not connected."],
    [
      "service-status",
      "Service status",
      "activity",
      "Service status is not connected.",
    ],
    [
      "email-support",
      "Email support",
      "mail",
      "Email support is not connected.",
    ],
    [
      "copy-debug-info",
      "Copy debug info...",
      "copy",
      "Copying debug info is not connected.",
    ],
  ] as const;
  const account = menu(
    {
      ...entry("sidebar.account.open", "footer-account", 0, displayName),
      accessibleLabel: `${displayName} account menu`,
      controlLabel: "Account menu",
      icon: {
        kind: "initial",
        text: avatar,
        ...(props.user.avatarUrl
          ? { image: { src: props.user.avatarUrl, alt: "" } }
          : {}),
      },
      children: [
        menu(
          {
            ...entry(
              "sidebar.account.theme",
              "account-theme",
              0,
              "Theme",
              "palette",
            ),
            children: themeEntries(),
          },
          "theme",
        ),
        {
          ...entry("sidebar.account.help", "account-help", 0, "Help"),
          kind: "heading",
        },
        ...help.map(
          ([id, label, icon, tooltip], order): NavigationEntry => ({
            ...entry(
              `sidebar.account.${id}`,
              order < 3 ? "account-help" : "account-support",
              order + 1,
              label,
              icon,
            ),
            disabled: true,
            tooltip,
            trailingActions:
              order < 4
                ? [
                    {
                      ...entry(
                        "sidebar.account.external-marker",
                        "help-adornment",
                        0,
                        "",
                        "external",
                      ),
                      kind: "status",
                    },
                  ]
                : [],
            effect: { kind: "none" },
          }),
        ),
      ],
    },
    "account",
  );
  const features = props.features;
  const routeActive = (to: string) => path === to || path.startsWith(`${to}/`);
  const nav: NavigationEntry[] = [
    destination(
      "sidebar.nav.home",
      "sidebar-primary",
      0,
      "Home",
      "home",
      "/home",
      path === "/" || path === "/home",
    ),
    destination(
      "sidebar.nav.data",
      "sidebar-primary",
      1,
      "Data",
      "database",
      "/home/data",
      routeActive("/home/data"),
    ),
    ...(fixture.props?.contextSetup
      ? [
          {
            ...entry("sidebar.context-setup", "sidebar-primary", 2, ""),
            kind: "controller" as const,
            subPart: "sidebar.slot" as const,
            part: "sidebar" as const,
            effect: {
              kind: "open" as const,
              surfaceId: "context-setup",
              open: { value: true },
              body: {
                owner: "custom" as const,
                key: "context-setup",
                reason:
                  "Setup checklist card and progress illustration remain app-owned.",
              },
            },
          },
        ]
      : []),
    ...(!fixture.props?.contextSetup &&
    features.contextStudio &&
    features.isManagerOrAbove
      ? [
          destination(
            "sidebar.nav.context",
            "sidebar-primary",
            2,
            "Context Studio",
            "stack",
            "/context-studio/setup",
            path.startsWith("/context-studio"),
          ),
        ]
      : []),
    ...(
      [
        ["folders", "Folders", "folder", "/home/folders", features.folders],
        ["drafts", "Drafts", "file", "/home/drafts", features.folders],
        ["projects", "Projects", "project", "/home/all", true],
        [
          "collections",
          "Collections",
          "collections",
          "/home/collections",
          true,
        ],
        ["threads", "Threads", "threads", "/home/threads", features.threads],
        ["tasks", "Tasks", "tasks", "/home/tasks", features.tasks],
      ] as const
    ).map(([id, label, icon, to, show], order) => ({
      ...destination(
        `sidebar.nav.${id}`,
        "sidebar-scroll",
        order,
        label,
        icon,
        to,
        routeActive(to),
      ),
      visible: show,
    })),
    destination(
      "sidebar.nav.archive",
      "sidebar-bottom",
      0,
      "Archive",
      "archive",
      "/home/archive",
      routeActive("/home/archive"),
    ),
    destination(
      "sidebar.nav.trash",
      "sidebar-bottom",
      1,
      "Trash",
      "trash",
      "/home/trash",
      routeActive("/home/trash"),
    ),
  ];
  const morePaths = [
    "/home/components",
    "/home/library",
    "/home/explorations",
    "/context-studio/setup",
    "/home/agent-dev-tools",
  ];
  const more = menu(
    {
      ...entry("sidebar.more.open", "sidebar-more", 0, "More", "dots"),
      active: resolved(morePaths.includes(path)),
      children: [
        destination(
          "sidebar.more.components",
          "more",
          0,
          "Components",
          "collections",
          "/home/components",
          false,
        ),
        {
          ...destination(
            "sidebar.more.library",
            "more",
            1,
            "Library",
            "book",
            "/home/library",
            false,
          ),
          visible: features.library === true,
        },
        destination(
          "sidebar.more.explorations",
          "more",
          2,
          "Explorations",
          "branch",
          "/home/explorations",
          false,
        ),
        {
          ...destination(
            "sidebar.nav.context",
            "more",
            3,
            "Context Studio",
            "stack",
            "/context-studio/setup",
            false,
          ),
          visible: features.contextStudio && !features.isManagerOrAbove,
        },
        {
          ...destination(
            "sidebar.more.agent-dev-tools",
            "more",
            4,
            "Agent Dev Tools",
            "automation",
            "/home/agent-dev-tools",
            false,
          ),
          visible: features.developerTools,
        },
      ],
    },
    "more",
  );
  const create = menu(
    {
      ...entry("sidebar.create.open", "create-menu", 0, "Create new", "plus"),
      accessibleLabel: "Create new",
      tooltip: "Create new",
      children: [
        {
          ...entry(
            "sidebar.create.menu.project",
            "create-primary",
            0,
            "New project",
            "project",
          ),
          disabled: !features.canCreateProject,
          effect: action("create-project"),
        },
        {
          ...entry(
            "sidebar.create.menu.thread",
            "create-primary",
            1,
            "New thread",
            "thread",
          ),
          disabled: !features.canCreateThread,
          effect: action("create-thread"),
        },
        ...(props.quickCreate?.onImportProject
          ? [
              {
                ...entry(
                  "sidebar.create.menu.upload-project",
                  "create-import",
                  0,
                  "Upload project",
                  "upload",
                ),
                effect: action("import-project"),
              },
            ]
          : []),
      ],
    },
    "create",
  );
  function section(
    key: string,
    title: string,
    rows: WorkspaceShellRow[],
    order: number,
  ): NavigationSection {
    return {
      id: `sidebar.${key}`,
      part: "sidebar",
      subPart: "sidebar.section",
      containerId: "sidebar-sections",
      order,
      label: title,
      hideIfEmpty: true,
      disclosure: {
        binding: {
          value: disclosure.openKeys.has(key),
          set() {
            disclosure.toggle(key);
          },
        },
        unmountWhenClosed: true,
      },
      entries: rows.map((row, index) => ({
        ...destination(
          `sidebar.${key}.item`,
          `section-${key}`,
          index,
          row.title,
          row.kind === "project"
            ? "file"
            : row.kind === "collection"
              ? "folder"
              : row.kind === "data"
                ? "database"
                : row.kind,
          row.href,
          false,
        ),
        entityKey: row.id,
        family: {
          members: rows.map((item) => item.id),
          entityKeySource: "WorkspaceShellRow.id",
        },
        active: { kind: "none" },
      })),
    };
  }
  return {
    frame: { key: "home", routeRuleId: "workspace-home" },
    regions: [],
    navigation: {
      entries: [
        {
          ...entry("sidebar.header", "sidebar-header", 0, ""),
          kind: "controller",
          part: "sidebar",
          subPart: "sidebar.header",
          accessibleLabel: "Workspace",
          children: [
            workspace,
            notifications,
            { ...closeIntent, visible: (fixture.width ?? 1280) <= 1050 },
          ],
        },
        {
          ...entry("sidebar.footer", "sidebar-footer", 0, ""),
          kind: "controller",
          part: "sidebar",
          subPart: "sidebar.footer",
          children: [
            account,
            {
              ...destination(
                "sidebar.nav.settings",
                "footer-settings",
                1,
                "",
                "settings",
                "/settings",
                false,
              ),
              accessibleLabel: "Settings",
              tooltip: "Go to settings",
            },
          ],
        },
        {
          ...entry(
            "sidebar.nav.search",
            "sidebar-search",
            0,
            "Search",
            "search",
          ),
          effect: action("open-search"),
          shortcut: searchShortcut,
        },
        {
          ...entry(
            "sidebar.create.project",
            "create-buttons",
            0,
            "Project",
            "project",
          ),
          disabled: !features.canCreateProject,
          effect: action("create-project"),
        },
        {
          ...entry(
            "sidebar.create.thread",
            "create-buttons",
            1,
            "Thread",
            "thread",
          ),
          disabled: !features.canCreateThread,
          effect: action("create-thread"),
        },
        create,
        ...nav,
        more,
      ],
      sections: [
        section("recents", "RECENTS", props.recents, 0),
        ...(["project", "collection", "data"] as const).map((kind, index) =>
          section(
            `favorite-${kind === "data" ? "data" : `${kind}s`}`,
            `Favorite ${kind === "data" ? "data" : `${kind}s`}`,
            props.favorites.filter((row) => row.kind === kind),
            index + 1,
          ),
        ),
      ],
      presentation: {
        collapsed: { value: false },
        mobileOpen: { value: drawerOpen, set: setDrawerOpen },
        peekOpen: false,
        profile: "workspace",
        themeFamily: "original",
        visibility: "visible",
        width: (fixture.width ?? 1280) <= 700 ? (fixture.width ?? 1280) : 265,
      },
    },
    shortcuts: [
      ...[false, true].flatMap((meta) =>
        [false, true]
          .filter((ctrl) => meta || ctrl)
          .flatMap((ctrl) =>
            [false, true].flatMap((alt) =>
              [false, true].map((shift) => ({
                ...searchShortcut,
                id: `shell.search.k.${meta}.${ctrl}.${alt}.${shift}`,
                keys: [{ key: "k", meta, ctrl, alt, shift }],
              })),
            ),
          ),
      ),
      ...[false, true].map((shift) => ({
        ...searchShortcut,
        id: `shell.search.slash.${shift}`,
        keys: [{ key: "/", shift }],
        displayLabel: "/",
      })),
    ],
    preferences: [
      {
        key: "theme",
        storage: "local",
        encoding: "theme",
        readStatus: fixture.theme ? "value" : "absent",
        write: "controller",
      },
    ],
    effects,
  };
}

export const workspaceFixtures: WorkspaceFixture[] = [
  ...["features-off-empty", "create-disabled"].map(
    (name): WorkspaceFixture => ({
      name,
      ...(name === "create-disabled" ? { menu: "create" } : {}),
      sectionsClosed: true,
      props: {
        recents: [],
        favorites: [],
        features: {
          ...shellProps().features,
          folders: false,
          tasks: false,
          threads: false,
          library: false,
          developerTools: false,
          contextStudio: false,
          canCreateProject: false,
          canCreateThread: false,
        },
      },
    }),
  ),

  { name: "desktop-default" },
  { name: "sections-closed", sectionsClosed: true },
  ...[
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
  ].map((path) => ({
    name: `route-${path.replace(/\W+/g, "-").replace(/^-|-$/g, "") || "root"}`,
    path,
  })),
  ...[1050, 701, 700, 420].map((width) => ({
    name: `viewport-${width}-open`,
    width,
    drawerOpen: true,
  })),
  ...[1280, 1051, 1050, 701, 700, 420].map((width) => ({
    name: `viewport-${width}-settled`,
    width,
  })),
  { name: "workspace-menu", menu: "workspace" },
  { name: "workspace-search-empty", menu: "workspace", search: "missing" },
  { name: "workspace-search-match", menu: "workspace", search: "test" },
  {
    name: "workspace-preferences",
    menu: "workspace",
    search: "test",
    submenu: "preferences",
  },
  ...[1, 2, 3].map(
    (count): WorkspaceFixture => ({
      name: `workspace-count-${count}`,
      menu: "workspace",
      props: {
        workspaceMenu: {
          workspaces: (shellProps().workspaceMenu?.workspaces ?? []).slice(
            0,
            count,
          ),
        },
      },
    }),
  ),
  { name: "account-help", menu: "account" },
  { name: "account-theme-system", menu: "account", submenu: "theme" },
  {
    name: "account-theme-dark",
    menu: "account",
    submenu: "theme",
    theme: "dark",
  },
  {
    name: "account-theme-light",
    menu: "account",
    submenu: "theme",
    theme: "light",
  },
  {
    name: "account-theme-system-selected",
    menu: "account",
    submenu: "theme",
    theme: "system",
  },
  {
    name: "account-theme-system-dark",
    menu: "account",
    submenu: "theme",
    theme: "system",
    dark: true,
  },
  { name: "notifications-unbound", menu: "notifications" },
  { name: "notifications-filter", menu: "notifications", filterOpen: true },
  { name: "notifications-unread", menu: "notifications", filter: "unread" },
  { name: "filter-keyboard-gap", menu: "notifications", filterOpen: true },
  { name: "create-menu", menu: "create" },
  { name: "more-manager", menu: "more" },
  {
    name: "more-member",
    menu: "more",
    closedSections: ["recents"],
    props: { features: { ...shellProps().features, isManagerOrAbove: false } },
  },
  ...["email", "empty", "image"].map(
    (variant): WorkspaceFixture => ({
      name: `account-identity-${variant}`,
      props: {
        user: {
          id: "person-a",
          name: variant === "image" ? "Test Person" : "",
          email: variant === "empty" ? "" : "person@example.test",
          ...(variant === "image" ? { avatarUrl: "/fixture-avatar.svg" } : {}),
        },
      },
    }),
  ),
  ...["light", "dark", "system"].flatMap((theme) =>
    (["account", "more", "create"] as const).map(
      (menu): WorkspaceFixture => ({
        name: `mobile-${theme}-${menu}`,
        width: 700,
        drawerOpen: true,
        theme,
        dark: theme === "system",
        menu,
        ...(menu === "account" ? { submenu: "theme" } : {}),
      }),
    ),
  ),
];
