import {
  useNavigationDisclosure,
  useNavigationOpener,
  type AppShellSubPart,
  type ShellRegion,
  type NavigationEntry,
  type NavigationSection,
  type ShellActionEffect,
  type ShellBinding,
  type ShellModel,
  type ShellShortcutDescriptor,
} from "@agent-native/toolkit/app-shell/sidebar-shell";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

import { useThemePreference } from "../../../components/shell/theme-preference";
import type { WorkspaceShellRow } from "../../../components/shell/types";
import { shellProps } from "../fixtures";
import type { HomeShellFixture } from "./shell";
import type { WorkspaceFixture } from "./workspace";

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
const searchShortcut: ShellShortcutDescriptor = {
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

type ThemeState = ReturnType<typeof useThemePreference>;
type ThemeOwner = "workspace" | "mobile" | "account" | "standalone";
type ThemeStates = Partial<Record<ThemeOwner, ThemeState>>;

function useScopedNavigationModel(
  fixture: WorkspaceFixture,
  themes: ThemeStates,
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
    ...(["workspace", "mobile", "account", "standalone"] as const).flatMap(
      (owner) =>
        (["system", "light", "dark"] as const).map(
          (value): ShellActionEffect => ({
            kind: "action",
            id: `theme-${owner}-${value}`,
            actionName: "set-theme",
            run() {
              const theme = themes[owner];
              if (!theme)
                throw new Error(`Theme owner is not mounted: ${owner}`);
              theme.setPreference(value);
            },
          }),
        ),
    ),
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
  const themeEntries = (owner: ThemeOwner): NavigationEntry[] => {
    const theme = themes[owner];
    return [
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
              ? `System (${theme?.systemTheme === "dark" ? "Dark" : "Light"})`
              : value === "light"
                ? "Light"
                : "Dark",
          ),
          kind: "choice",
          effect: action(`theme-${owner}-${value}`),
          active: resolved(theme?.preference === value),
          metadata: { current: theme?.preference === value },
        }),
      ),
    ];
  };
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
              ...themeEntries("workspace"),
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
            children: themeEntries("account"),
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

function themeOwnerEntry(
  entry: NavigationEntry,
  owner: ThemeOwner,
  themes: ThemeStates,
): NavigationEntry {
  const value = entry.id.slice("sidebar.theme.".length);
  const choice =
    entry.id.startsWith("sidebar.theme.") &&
    (value === "system" || value === "light" || value === "dark");
  const theme = themes[owner];
  return {
    ...entry,
    ...(choice
      ? {
          label:
            value === "system"
              ? `System (${theme?.systemTheme === "dark" ? "Dark" : "Light"})`
              : value === "light"
                ? "Light"
                : "Dark",
          active: resolved(theme?.preference === value),
          metadata: { current: theme?.preference === value },
          effect: action(`theme-${owner}-${value}`),
        }
      : {}),
    ...(entry.children
      ? {
          children: entry.children.map((child) =>
            themeOwnerEntry(child, owner, themes),
          ),
        }
      : {}),
  };
}
function region(id: string, subPart: AppShellSubPart): ShellRegion {
  return {
    id,
    part: "app-shell",
    subPart,
    containerId: "shell",
    order: 0,
    content: { owner: "model", key: id },
  };
}
const main = () => ({
  ...region("shell.main", "app-shell.main"),
  content: { owner: "page" as const, key: "current-route" },
});

function shellEntry(
  id: string,
  containerId: string,
  label: string,
  effectId: string,
): NavigationEntry {
  return {
    id,
    part: "app-shell",
    subPart: "app-shell.nav",
    containerId,
    order: 0,
    kind: "action",
    label,
    effect: action(effectId),
  };
}
function useScopedShellRegions(
  fixture: HomeShellFixture,
  base: ShellModel,
  themes: ThemeStates,
): ShellModel {
  const [mobileOpened, setMobileOpened] = useState<Record<string, boolean>>({
    workspace: fixture.mobileMenu ?? false,
  });
  const [mobileSearch, setMobileSearch] = useState("");
  const [bannerVisible, setBannerVisible] = useState(true);
  const header = base.navigation.entries.find(
    (entry) => entry.containerId === "sidebar-header",
  );
  const workspace = header?.children?.find(
    (entry) => entry.containerId === "header-workspace",
  );
  if (!workspace) throw new Error("Missing workspace fixture source");
  function mobileEntry(entry: NavigationEntry): NavigationEntry {
    const effect = entry.effect;
    return {
      ...entry,
      ...(effect?.kind === "open"
        ? {
            effect: {
              ...effect,
              open: {
                value: mobileOpened[effect.surfaceId] ?? false,
                set(value: boolean) {
                  setMobileOpened((previous) => ({
                    ...previous,
                    [effect.surfaceId]: value,
                    ...(!value && effect.surfaceId === "workspace"
                      ? { preferences: false }
                      : {}),
                  }));
                },
              },
            },
          }
        : effect?.kind === "action" &&
            effect.effectId === "close-workspace-menu"
          ? {
              effect: { ...effect, effectId: "close-mobile-workspace-menu" },
            }
          : {}),
      ...(entry.search
        ? {
            search: {
              ...entry.search,
              binding: { value: mobileSearch, set: setMobileSearch },
            },
          }
        : {}),
      ...(entry.children ? { children: entry.children.map(mobileEntry) } : {}),
      ...(entry.trailingActions
        ? { trailingActions: entry.trailingActions.map(mobileEntry) }
        : {}),
    };
  }
  const mobileWorkspace = {
    ...themeOwnerEntry(mobileEntry(workspace), "mobile", themes),
    containerId: "mobile-workspace",
  };
  const error = fixture.writeError;
  return {
    ...base,
    regions: [
      main(),
      {
        ...region("shell.header.mobile", "app-shell.topbar"),
        actions: [
          {
            ...shellEntry("shell.nav.open", "mobile-opener", "", "open-drawer"),
            accessibleLabel: "Open navigation",
          },
          mobileWorkspace,
          {
            ...shellEntry(
              "shell.search.mobile",
              "mobile-search",
              "",
              "open-search",
            ),
            accessibleLabel: "Search",
            tooltip: "Search",
          },
        ],
      },
      {
        ...region("shell.nav.dismiss", "app-shell.aside"),
        visible:
          (fixture.width ?? 1280) <= 1050 &&
          base.navigation.presentation.mobileOpen.value,
        actions: [
          {
            ...shellEntry(
              "shell.nav.dismiss",
              "drawer-dismiss",
              "",
              "close-drawer",
            ),
            accessibleLabel: "Close navigation",
          },
        ],
      },
      ...(error
        ? [
            {
              ...region("shell.write-error", "app-shell.banner"),
              visible: bannerVisible,
              title: "Could not start thread: ",
              actions: [
                shellEntry(
                  "shell.write-error.retry",
                  "write-retry",
                  "Retry",
                  "failed-write",
                ),
                shellEntry(
                  "shell.write-error.dismiss",
                  "write-dismiss",
                  "Dismiss",
                  "dismiss-write-error",
                ),
              ],
            },
          ]
        : []),
    ],
    effects: [
      ...base.effects,
      {
        kind: "action",
        id: "open-drawer",
        actionName: "open-navigation",
        run: () => base.navigation.presentation.mobileOpen.set?.(true),
      },
      {
        kind: "action",
        id: "close-mobile-workspace-menu",
        actionName: "close-mobile-workspace-menu",
        run: () => setMobileOpened({ workspace: false, preferences: false }),
      },
      ...(error
        ? [
            {
              kind: "action" as const,
              id: "failed-write",
              actionName: error.action,
              error: error.message,
              run: () => fixture.retry?.(),
            },
            {
              kind: "action" as const,
              id: "dismiss-write-error",
              actionName: "dismiss-write-error",
              run: () => setBannerVisible(false),
            },
          ]
        : []),
    ],
  };
}

function useScopedShellModel(
  fixture: HomeShellFixture,
  themes: ThemeStates,
): ShellModel {
  const location = useLocation();
  // Match the media hook's desktop-assumed first commit before its passive sync.
  const [viewport, setViewport] = useState(1280);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1050px)");
    const sync = () => setViewport(window.innerWidth);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const narrow = viewport <= 1050;
  const opener = useNavigationOpener({
    initialOpen: true,
    routeKey: location.pathname,
    dismissOnNavigation: narrow,
  });
  useEffect(() => opener.setOpen(!narrow), [narrow]);
  const base = useScopedNavigationModel(
    { ...fixture, width: viewport, path: location.pathname },
    themes,
  );
  const shell = useScopedShellRegions(fixture, base, themes);
  return {
    ...shell,
    navigation: {
      ...shell.navigation,
      presentation: {
        ...shell.navigation.presentation,
        mobileOpen: { value: opener.open, set: opener.setOpen },
      },
    },
    regions: shell.regions.map((region) =>
      region.id === "shell.nav.dismiss"
        ? { ...region, visible: narrow && opener.open }
        : region,
    ),
    effects: shell.effects.map((effect) =>
      effect.id === "close-drawer"
        ? {
            ...effect,
            run() {
              if (narrow) opener.dismiss();
            },
          }
        : effect.id === "open-drawer"
          ? { ...effect, run: opener.show }
          : effect,
    ),
  };
}
function open(entry: NavigationEntry | undefined) {
  return entry?.effect?.kind === "open" && entry.effect.open.value;
}
function find(
  entries: readonly NavigationEntry[],
  container: string,
): NavigationEntry | undefined {
  for (const entry of entries) {
    if (entry.containerId === container) return entry;
    const child = find(entry.children ?? [], container);
    if (child) return child;
  }
  return undefined;
}
function MountedThemeOwner({
  owner,
  publish,
}: {
  owner: ThemeOwner;
  publish: (owner: ThemeOwner, theme: ThemeState) => void;
}) {
  const theme = useThemePreference();
  useLayoutEffect(() => {
    publish(owner, theme);
  }, [
    owner,
    publish,
    theme.preference,
    theme.systemTheme,
    theme.setPreference,
  ]);
  return null;
}

/** Controllers precede skin selection; no theme hook exists for a closed submenu. */
export function ScopedWorkspaceController({
  fixture = { name: "desktop-default" },
  standaloneTheme = false,
  children,
}: {
  fixture?: HomeShellFixture;
  standaloneTheme?: boolean;
  children: (model: ShellModel) => ReactNode;
}) {
  const [themes, setThemes] = useState<ThemeStates>({});
  const publish = useCallback((owner: ThemeOwner, theme: ThemeState) => {
    setThemes((current) => ({ ...current, [owner]: theme }));
  }, []);
  const model = useScopedShellModel(fixture, themes);
  const entries = model.navigation.entries;
  const mobile =
    model.regions.find((region) => region.id === "shell.header.mobile")
      ?.actions ?? [];
  const owners: ThemeOwner[] = [];
  if (
    open(find(entries, "header-workspace")) &&
    open(find(entries, "workspace-preferences"))
  )
    owners.push("workspace");
  if (
    open(find(entries, "footer-account")) &&
    open(find(entries, "account-theme"))
  )
    owners.push("account");
  if (
    open(find(mobile, "mobile-workspace")) &&
    open(find(mobile, "workspace-preferences"))
  )
    owners.push("mobile");
  if (standaloneTheme) owners.push("standalone");
  const selectedModel = standaloneTheme
    ? {
        ...model,
        navigation: {
          ...model.navigation,
          entries: model.navigation.entries.map((entry) =>
            entry.id === "sidebar.footer"
              ? themeOwnerEntry(entry, "standalone", themes)
              : entry,
          ),
        },
      }
    : model;
  return (
    <>
      {owners.map((owner) => (
        <MountedThemeOwner key={owner} owner={owner} publish={publish} />
      ))}
      {children(selectedModel)}
    </>
  );
}
