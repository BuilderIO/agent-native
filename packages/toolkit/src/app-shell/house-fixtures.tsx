import { useState, type ReactNode } from "react";

import type {
  NavigationEntry,
  NavigationSection,
  ShellActionEffect,
  ShellIdentity,
  ShellModel,
  ShellReadState,
  ShellRegion,
  ShellShortcutDescriptor,
  ShellValue,
} from "./contracts.js";
import type { ShellHost } from "./house-shell-host.js";
import {
  useNavigationDisclosure,
  useNavigationOpener,
  useSidebarCollapse,
  useSidebarPeek,
  useShellShortcuts,
} from "./shell-hooks.js";

export type HouseFixtureKind = "tracker" | "data" | "notes";
export const houseFixtureKinds: readonly HouseFixtureKind[] = [
  "tracker",
  "data",
  "notes",
];
const identity = (
  id: string,
  subPart: ShellIdentity["subPart"],
  order: number,
  containerId = "navigation",
): ShellIdentity =>
  subPart.startsWith("sidebar")
    ? {
        id,
        part: "sidebar",
        subPart: subPart as Extract<
          ShellIdentity,
          { part: "sidebar" }
        >["subPart"],
        order,
        containerId,
      }
    : {
        id,
        part: "app-shell",
        subPart: subPart as Extract<
          ShellIdentity,
          { part: "app-shell" }
        >["subPart"],
        order,
        containerId,
      };
const localStore = () => window.sessionStorage;
type EntryOverrides<Entry> = Entry extends unknown
  ? { [Key in keyof Entry]?: Entry[Key] | undefined }
  : never;
export interface HouseFixture {
  model: ShellModel;
  host: ShellHost;
  log: readonly { action: string; input?: ShellValue }[];
  setCollapsed: (value: boolean) => void;
  setMobileOpen: (value: boolean) => void;
  peek: { enter: () => void; leave: () => void };
  shortcuts: ReturnType<typeof useShellShortcuts>;
}
/** Invented domain data; controllers are mounted once, above either renderer. */
export function useHouseFixture(
  kind: HouseFixtureKind,
  initialCollapsed = false,
): HouseFixture {
  const [log, setLog] = useState<{ action: string; input?: ShellValue }[]>([]);
  const [pathname, setPathname] = useState("/inbox");
  const [width, setWidth] = useState(248);
  const collapse = useSidebarCollapse(
    {
      key: `house-fixture.${kind}.collapse`,
      encoding: "zero-one",
      defaultCollapsed: initialCollapsed,
      writeOnReady: "never",
      boot: {
        absent: initialCollapsed,
        invalid: initialCollapsed,
        unavailable: initialCollapsed,
      },
      widths: { expanded: width, collapsed: 56, bootCollapsed: 56 },
    },
    localStore,
  );
  const mobile = useNavigationOpener({
    initialOpen: false,
    routeKey: pathname,
    dismissOnNavigation: true,
  });
  const peek = useSidebarPeek({
    collapsed: collapse.collapsed,
    openDelayMs: 120,
    closeDelayMs: 200,
  });
  const disclosure = useNavigationDisclosure(["teams", "folders"], {
    revealActive: false,
    expandNewFavorites: false,
  });
  const [search, setSearch] = useState("");
  const [choice, setChoice] = useState("all");
  const [checked, setChecked] = useState(true);
  const [title, setTitle] = useState("Morning notes");
  const [editing, setEditing] = useState(false);
  const [opened, setOpened] = useState(false);
  const [order, setOrder] = useState<readonly string[]>([
    "plan",
    "research",
    "release",
  ]);
  const [read, setRead] = useState<ShellReadState>({
    status: "error",
    message: "Folders could not be loaded",
    reloadEffectId: "reload",
    retryLabel: "Reload folders",
  });
  const [writeError, setWriteError] = useState<string | undefined>(
    "The update was not saved",
  );
  const record = (action: string, input?: ShellValue) =>
    setLog((previous) => [
      ...previous,
      { action, ...(input === undefined ? {} : { input }) },
    ]);
  const effect = (
    id: string,
    run?: (input?: ShellValue) => void,
  ): ShellActionEffect => ({
    id,
    kind: "action",
    actionName: id,
    run: (input) => {
      record(id, input);
      run?.(input);
    },
  });
  const effects: ShellActionEffect[] = [
    effect("collapse", () => collapse.setCollapsed(!collapse.collapsed)),
    effect("mobile", () => mobile.show()),
    effect("resize"),
    effect("reorder"),
    effect("rename"),
    effect("begin-rename", () => setEditing(true)),
    effect("choice"),
    effect("search"),
    effect("checked"),
    effect("reload", () => setRead({ status: "ready" })),
    { ...effect("sync"), pending: true },
    {
      ...effect("publish"),
      error: writeError,
      retry: () => {
        record("retry-publish");
        setWriteError(undefined);
      },
    },
  ];
  const shortcut: ShellShortcutDescriptor = {
    id: "collapse-key",
    actionName: "collapse",
    ownerId: "fixture",
    keys: [{ key: "\\", mod: true }],
    displayLabel: "⌘\\",
    platform: "all",
    scope: "shell",
    phase: "bubble",
    guard: {
      focusKinds: ["page"],
      allowRepeat: false,
      composition: "ignore",
      overlay: "ignore",
      respectDefaultPrevented: true,
    },
  };
  const shortcuts = useShellShortcuts("fixture", [shortcut], (action) => {
    void effects.find((item) => item.actionName === action)?.run();
  });
  const item = (
    id: string,
    label: string,
    order: number,
    extra: EntryOverrides<NavigationEntry> = {},
  ): NavigationEntry =>
    ({
      ...identity(id, "sidebar.item", order),
      kind: "destination",
      label,
      effect: { kind: "navigate", to: `/${id}`, close: "mobile" },
      active: { kind: "exact", paths: [`/${id}`] },
      ...extra,
    }) as NavigationEntry;
  const entries: NavigationEntry[] = [
    item(
      "workspace",
      kind === "tracker"
        ? "Stonebridge"
        : kind === "data"
          ? "Northfield"
          : "Greenbank",
      0,
      {
        subPart: "sidebar.header",
        kind: "identity",
        icon: { kind: "initial", text: "N" },
        effect: { kind: "none" },
      },
    ),
    item(
      "collapse",
      collapse.collapsed ? "Expand navigation" : "Collapse navigation",
      1,
      {
        kind: "action",
        effect: { kind: "action", effectId: "collapse" },
        shortcut,
        icon: { kind: "symbol", key: "sidebar" },
      },
    ),
    item("search", "Search navigation", 2, {
      kind: "filter",
      effect: undefined,
      search: {
        binding: { value: search, set: setSearch, changeEffectId: "search" },
        placeholder: "Search",
        match: "label-substring",
        emptyLabel: "No matches",
      },
      children: [
        item("search-plan", "Planning", 0),
        item("search-research", "Research", 1),
      ],
    }),
    item("inbox", "Inbox", 3, {
      icon: { kind: "symbol", key: "inbox" },
      badge: {
        kind: "count",
        value: 12,
        visible: true,
        accessibleLabel: "12 unread",
      },
    }),
    item("activity", "Activity", 4, {
      badge: { kind: "dot", visible: true, accessibleLabel: "New activity" },
    }),
    item("scope", "View", 5, {
      kind: "choice",
      effect: undefined,
      binding: { value: choice, set: setChoice, changeEffectId: "choice" },
      choices: [
        { value: "all", label: "All items" },
        { value: "mine", label: "Assigned to me" },
        { value: "archived", label: "Archived", disabled: true },
      ],
    }),
    item("unread", "Unread only", 6, {
      kind: "choice",
      effect: undefined,
      binding: { value: checked, set: setChecked, changeEffectId: "checked" },
    }),
    item("sync", "Sync", 7, {
      kind: "action",
      effect: { kind: "action", effectId: "sync" },
    }),
    item("publish", "Publish", 8, {
      kind: "action",
      effect: { kind: "action", effectId: "publish" },
    }),
    item("loading", "Recent items", 9, {
      kind: "status",
      state: { status: "loading", label: "Loading recent items" },
      effect: undefined,
    }),
    item("restricted", "Manage members", 10, {
      gate: { key: "members", allowed: false, denied: "disabled" },
    }),
    item("hidden", "Hidden item", 11, { visible: false }),
    item("rename-title", title, 12, {
      kind: "action",
      effect: { kind: "none" },
      rename: {
        binding: { value: title, set: setTitle },
        editing: { value: editing, set: setEditing },
        controlLabel: "Note title",
        trim: true,
        ignoreEmpty: true,
        ignoreUnchanged: true,
        commitOnBlur: true,
        cancelKey: "Escape",
        submitKey: "Enter",
        commitEffectId: "rename",
        autoFocus: true,
        blurBoundary: "row",
      },
      trailingActions: [
        item("rename", "Rename note", 0, {
          kind: "action",
          effect: { kind: "action", effectId: "begin-rename" },
        }),
      ],
    }),
    item("help", "Keyboard shortcuts", 13, {
      subPart: "sidebar.footer",
      kind: "action",
      effect: {
        kind: "open",
        surfaceId: "shortcuts",
        open: { value: opened, set: setOpened },
        body: {
          owner: "later-pattern",
          key: "shortcuts",
          reason: "Command surfaces have a separate owner",
        },
      },
    }),
    item("resize", "Resize navigation", 14, {
      subPart: "sidebar.resize-handle",
      kind: "controller",
      effect: undefined,
    }),
  ];
  entries.push(
    item("navigation-heading", "Workspace tools", 14.1, {
      kind: "heading",
      effect: undefined,
    }),
  );
  entries.push(
    item("ready-status", "All changes saved", 14.2, {
      kind: "status",
      effect: undefined,
      subPart: "sidebar.slot",
    }),
  );
  const teamEntries = [
    item("team-design", "Design", 0, {
      containerId: "teams",
      icon: { kind: "initial", text: "D" },
      badge: { kind: "text", text: "Team", visible: true },
      children: [
        item("team-cycle", "Current cycle", 0, { containerId: "design" }),
      ],
    }),
    item("team-product", "Product", 1, {
      containerId: "teams",
      icon: { kind: "initial", text: "P" },
    }),
  ];
  const section = (
    id: string,
    label: string,
    order: number,
    items: NavigationEntry[],
    extra: Partial<NavigationSection> = {},
  ): NavigationSection =>
    ({
      ...identity(id, "sidebar.section", order),
      label,
      entries: items,
      hideIfEmpty: false,
      ...extra,
    }) as NavigationSection;
  const sections: NavigationSection[] = [
    section("teams", "Teams", 15, teamEntries, {
      disclosure: {
        binding: {
          value: disclosure.openKeys.has("teams"),
          set: () => disclosure.toggle("teams"),
        },
        unmountWhenClosed: true,
      },
    }),
    section(
      "favorites",
      "Favorites",
      16,
      order.map((key, index) =>
        item(
          "favorite",
          key === "plan"
            ? "Planning"
            : key === "research"
              ? "Research"
              : "Release",
          index,
          { entityKey: key, containerId: "favorites" },
        ),
      ),
      {
        reorder: {
          controllerId: "favorites",
          policy: {
            containerId: "favorites",
            pointerThreshold: 4,
            collision: "closestCenter",
            keyboard: {
              start: "Space",
              move: "arrows",
              end: "Space",
              cancel: "Escape",
            },
            cancel: "restore-order",
            missingDropTarget: "no-commit",
            merge: "visible-into-complete-order",
            persist: "none",
            disableWhileEffectPending: true,
          },
          commitEffectId: "reorder",
          preview: setOrder,
        },
      },
    ),
    section(
      "folders",
      "Folders",
      17,
      [
        item("folder-ideas", "Ideas", 0, {
          subPart: "sidebar.tree",
          kind: "disclosure",
          effect: undefined,
          disclosure: {
            binding: {
              value: disclosure.openKeys.has("ideas"),
              set: () => disclosure.toggle("ideas"),
            },
            unmountWhenClosed: false,
          },
          children: [item("folder-drafts", "Drafts", 0)],
        }),
      ],
      { state: read, subPart: "sidebar.tree" },
    ),
    section("empty", "Saved views", 18, [], { emptyLabel: "No saved views" }),
  ];
  if (kind === "data")
    sections.push(
      section(
        "data",
        "Data",
        19,
        [
          item("data-orders", "Orders", 0, {
            subPart: "sidebar.rail",
            metadata: { secondaryText: "Table" },
          }),
          item("data-people", "People", 1, { subPart: "sidebar.rail" }),
        ],
        { subPart: "sidebar.rail" },
      ),
    );
  const region = (
    id: string,
    subPart: ShellRegion["subPart"],
    order: number,
    extra: Partial<ShellRegion> = {},
  ): ShellRegion =>
    ({
      ...identity(id, subPart, order, "shell"),
      content: { owner: "kit", key: id },
      ...extra,
    }) as ShellRegion;
  const regions: ShellRegion[] = [
    region("frame-nav", "app-shell.nav", 0),
    region("topbar", "app-shell.topbar", 1, {
      title: "Workspace",
      actions: [
        {
          ...item("open-navigation", "Open navigation", 0, {
            kind: "action",
            effect: { kind: "action", effectId: "mobile" },
          }),
          part: "app-shell",
          subPart: "app-shell.topbar",
          containerId: "topbar",
        },
      ],
    }),
    region("banner", "app-shell.banner", 2, {
      title: "Offline changes will sync when connected",
    }),
    region("main", "app-shell.main", 3, {
      content: { owner: "page", key: "page" },
    }),
    region("aside", "app-shell.aside", 4, {
      title: "Details",
      content: { owner: "page", key: "details" },
      visible: kind !== "notes",
    }),
    region("overlay", "app-shell.overlays", 5, {
      content: {
        owner: "custom",
        key: "overlay",
        reason: "Application overlay boundary",
      },
    }),
    region("skeleton", "app-shell.skeleton", 6, {
      visible: false,
      state: { status: "loading", label: "Loading workspace" },
    }),
  ];
  if (kind === "data")
    regions.push(
      region("split", "app-shell.split", 7, {
        title: "Preview",
        content: { owner: "page", key: "split" },
      }),
    );
  const slots: Record<string, ReactNode> = {
    page: (
      <div className="grid gap-3">
        {["Planning", "Research", "Release"].map((label, index) => (
          <div
            key={label}
            className="flex min-h-16 items-center gap-3 rounded-lg border border-border bg-background p-4"
          >
            <span className="text-sm font-medium">{label}</span>
            <span className="ms-auto text-xs text-muted-foreground">
              {index + 2} items
            </span>
          </div>
        ))}
      </div>
    ),
    details: (
      <p className="py-3 text-sm text-muted-foreground">
        Select an item to inspect it.
      </p>
    ),
    overlay: null,
    split: (
      <div className="rounded-md border border-border p-4 text-sm">
        A selected record appears here.
      </div>
    ),
    shortcuts: (
      <p className="text-sm">
        Use the navigation shortcut to collapse or expand.
      </p>
    ),
  };
  return {
    model: {
      frame: { key: kind, routeRuleId: "workspace" },
      regions,
      navigation: {
        entries,
        sections,
        presentation: {
          collapsed: { value: collapse.collapsed, set: collapse.setCollapsed },
          mobileOpen: { value: mobile.open, set: mobile.setOpen },
          peekOpen: peek.open,
          profile: "standard",
          themeFamily: "house",
          visibility: "visible",
          width,
        },
        resize: {
          policy: {
            min: 200,
            max: 360,
            step: 4,
            shiftStep: 16,
            reset: 248,
            round: true,
            keyboard: true,
            pointerCancel: "restore-start-and-commit",
            lostPointerCapture: "commit-current",
            persist: "end",
            storageKey: "house-fixture.width",
            codec: "decimal",
          },
          width: { value: width, set: setWidth },
          preview: setWidth,
          finishEffectId: "resize",
        },
      },
      shortcuts: [shortcut],
      preferences: [
        {
          key: `house-fixture.${kind}.collapse`,
          storage: "session",
          encoding: "zero-one",
          readStatus: collapse.stored.status,
          write: "controller",
        },
      ],
      effects,
    },
    host: {
      pathname,
      navigate: (effect) => {
        record("navigate", effect.to);
        setPathname(effect.to);
      },
      close: (surface) => {
        if (surface === "mobile") mobile.dismiss();
        if (surface === "peek") peek.dismiss();
      },
      slots,
      labels: {
        navigation: "Workspace navigation",
        retry: "Retry",
        reorder: (name) => `Reorder ${name}`,
      },
    },
    log,
    setCollapsed: collapse.setCollapsed,
    setMobileOpen: mobile.setOpen,
    peek,
    shortcuts,
  };
}
