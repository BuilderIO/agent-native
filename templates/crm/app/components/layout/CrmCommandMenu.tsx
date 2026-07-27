import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  CommandMenu,
  useCommandMenuShortcut,
} from "@agent-native/core/client/navigation";
import {
  IconAlertTriangle,
  IconBuilding,
  IconChartBar,
  IconChecklist,
  IconKeyboard,
  IconLayoutBoard,
  IconLayoutDashboard,
  IconList,
  IconMessageCircle,
  IconMoon,
  IconPencilCheck,
  IconPlus,
  IconRoute,
  IconSettings,
  IconSun,
  IconTable,
  IconUsers,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useKeyboardShortcuts } from "@/hooks/use-keyboard-shortcuts";

import changelog from "../../../CHANGELOG.md?raw";
import {
  commandPaletteKeywords,
  rankCommandPaletteEntries,
} from "./command-palette-search";
import {
  CRM_EDIT_RECORD_EVENT,
  CRM_NEW_RECORD_EVENT,
  CRM_NEW_TASK_EVENT,
  emitCrmUiIntent,
  focusCrmSearch,
} from "./crm-ui-intents";
import {
  normalizeCrmLists,
  normalizeCrmSavedViews,
  savedViewHref,
} from "./sidebar-lists";

type TablerIcon = typeof IconList;

interface PaletteEntry {
  id: string;
  /** Stable ranking value; never shown. */
  value: string;
  label: string;
  keywords: string[];
  icon: TablerIcon;
  run: () => void;
}

interface PaletteGroup {
  id: string;
  heading: string;
  entries: PaletteEntry[];
}

const GO_TO_ROUTES = [
  {
    id: "overview",
    to: "/",
    labelKey: "navigation.overview",
    icon: IconLayoutDashboard,
  },
  {
    id: "accounts",
    to: "/accounts",
    labelKey: "navigation.accounts",
    icon: IconBuilding,
  },
  {
    id: "people",
    to: "/people",
    labelKey: "navigation.people",
    icon: IconUsers,
  },
  {
    id: "opportunities",
    to: "/opportunities",
    labelKey: "navigation.opportunities",
    icon: IconRoute,
  },
  { id: "lists", to: "/lists", labelKey: "navigation.lists", icon: IconList },
  {
    id: "tasks",
    to: "/tasks",
    labelKey: "navigation.tasks",
    icon: IconChecklist,
  },
  {
    id: "proposals",
    to: "/proposals",
    labelKey: "navigation.proposals",
    icon: IconPencilCheck,
  },
  {
    id: "dashboard",
    to: "/dashboard",
    labelKey: "navigation.dashboard",
    icon: IconChartBar,
  },
  {
    id: "ask",
    to: "/ask",
    labelKey: "navigation.askCrm",
    icon: IconMessageCircle,
  },
] as const;

const RECORD_KIND_ICONS: Record<string, TablerIcon> = {
  account: IconBuilding,
  person: IconUsers,
  opportunity: IconRoute,
};

function rankGroups(groups: PaletteGroup[], search: string): PaletteGroup[] {
  return groups
    .map((group, index) => {
      const ranked = rankCommandPaletteEntries(
        group.entries,
        search,
        (entry) => ({
          value: entry.value,
          keywords: entry.keywords,
        }),
      );
      return {
        index,
        topScore: ranked[0]?.score ?? 0,
        group: { ...group, entries: ranked.map(({ entry }) => entry) },
      };
    })
    .filter(({ group }) => group.entries.length > 0)
    .sort((a, b) => b.topScore - a.topScore || a.index - b.index)
    .map(({ group }) => group);
}

function CrmCommandResults({
  search,
  navigate,
  onShowShortcuts,
}: {
  search: string;
  navigate: NavigateFunction;
  onShowShortcuts: () => void;
}) {
  const t = useT();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const trimmedSearch = search.trim();

  const listsQuery = useActionQuery<unknown>(
    "list-crm-lists" as never,
    { limit: 50 } as never,
    { staleTime: 30_000, retry: false } as never,
  );
  const viewsQuery = useActionQuery<unknown>(
    "list-crm-saved-views" as never,
    { limit: 50 } as never,
    { staleTime: 30_000, retry: false } as never,
  );
  const recordsQuery = useActionQuery<unknown>(
    "list-crm-records" as never,
    { query: trimmedSearch, limit: 8 } as never,
    {
      enabled: trimmedSearch.length > 0,
      staleTime: 15_000,
      retry: false,
    } as never,
  );

  const records = useMemo(() => {
    const payload = recordsQuery.data;
    const rows =
      payload && typeof payload === "object" && "records" in payload
        ? (payload as { records: unknown }).records
        : payload;
    if (!Array.isArray(rows)) return [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const record = row as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : null;
      const displayName =
        typeof record.displayName === "string" ? record.displayName : null;
      if (!id || !displayName) return [];
      return [
        {
          id,
          displayName,
          kind: typeof record.kind === "string" ? record.kind : "",
          subtitle: typeof record.subtitle === "string" ? record.subtitle : "",
        },
      ];
    });
  }, [recordsQuery.data]);

  const lists = useMemo(
    () => normalizeCrmLists(listsQuery.data),
    [listsQuery.data],
  );
  const views = useMemo(
    () => normalizeCrmSavedViews(viewsQuery.data),
    [viewsQuery.data],
  );

  const groups: PaletteGroup[] = [
    {
      id: "records",
      heading: t("commandMenu.groupRecords"),
      entries: records.map((record) => ({
        id: `record-${record.id}`,
        value: `record:${record.id}:${record.displayName}`,
        label: record.displayName,
        keywords: commandPaletteKeywords(
          record.displayName,
          record.subtitle,
          record.kind,
        ),
        icon: RECORD_KIND_ICONS[record.kind] ?? IconTable,
        run: () => navigate(`/records/${encodeURIComponent(record.id)}`),
      })),
    },
    {
      id: "lists",
      heading: t("commandMenu.groupLists"),
      entries: lists.map((list) => ({
        id: `list-${list.id}`,
        value: `list:${list.id}:${list.name}`,
        label: list.name,
        keywords: commandPaletteKeywords(
          list.name,
          list.parentObjectType,
          "list",
        ),
        icon: IconList,
        run: () => navigate(`/lists/${encodeURIComponent(list.id)}`),
      })),
    },
    {
      id: "views",
      heading: t("commandMenu.groupViews"),
      entries: views.map((view) => ({
        id: `view-${view.id}`,
        value: `view:${view.id}:${view.name}`,
        label: view.name,
        keywords: commandPaletteKeywords(
          view.name,
          view.viewKind,
          "saved view",
        ),
        icon: view.viewKind === "board" ? IconLayoutBoard : IconTable,
        run: () => navigate(savedViewHref(view)),
      })),
    },
    {
      id: "go-to",
      heading: t("commandMenu.groupGoTo"),
      entries: GO_TO_ROUTES.map((route) => ({
        id: `go-${route.id}`,
        value: `go:${route.id}:${t(route.labelKey)}`,
        label: t(route.labelKey),
        keywords: commandPaletteKeywords(t(route.labelKey), route.id, "go to"),
        icon: route.icon,
        run: () => navigate(route.to),
      })),
    },
    {
      id: "commands",
      heading: t("commandMenu.groupCommands"),
      entries: [
        {
          id: "create-record",
          value: `command:create-record:${t("commandMenu.createRecord")}`,
          label: t("commandMenu.createRecord"),
          keywords: commandPaletteKeywords(
            t("commandMenu.createRecord"),
            "new record",
            "add",
          ),
          icon: IconPlus,
          run: () => emitCrmUiIntent(CRM_NEW_RECORD_EVENT),
        },
        {
          id: "create-list",
          value: `command:create-list:${t("commandMenu.createList")}`,
          label: t("commandMenu.createList"),
          keywords: commandPaletteKeywords(
            t("commandMenu.createList"),
            "new list",
          ),
          icon: IconList,
          run: () => navigate("/lists?new=1"),
        },
        {
          id: "new-task",
          value: `command:new-task:${t("commandMenu.newTask")}`,
          label: t("commandMenu.newTask"),
          keywords: commandPaletteKeywords(t("commandMenu.newTask"), "todo"),
          icon: IconChecklist,
          run: () => emitCrmUiIntent(CRM_NEW_TASK_EVENT),
        },
        {
          id: "open-settings",
          value: `command:settings:${t("commandMenu.openSettings")}`,
          label: t("commandMenu.openSettings"),
          keywords: commandPaletteKeywords(
            t("commandMenu.openSettings"),
            t("navigation.connections"),
            "preferences",
          ),
          icon: IconSettings,
          run: () => navigate("/settings/connections"),
        },
        {
          id: "shortcuts",
          value: `command:shortcuts:${t("commandMenu.keyboardShortcuts")}`,
          label: t("commandMenu.keyboardShortcuts"),
          keywords: commandPaletteKeywords(
            t("commandMenu.keyboardShortcuts"),
            "keys",
            "hotkeys",
          ),
          icon: IconKeyboard,
          run: onShowShortcuts,
        },
      ],
    },
    {
      id: "appearance",
      heading: t("commandMenu.groupAppearance"),
      entries: [
        {
          id: "toggle-theme",
          value: `appearance:theme:${t("commandMenu.toggleTheme")}`,
          label: t("commandMenu.toggleTheme"),
          keywords: commandPaletteKeywords(
            t("commandMenu.toggleTheme"),
            "dark",
            "light",
            "mode",
          ),
          icon: isDark ? IconSun : IconMoon,
          run: () => setTheme(isDark ? "light" : "dark"),
        },
      ],
    },
  ];

  const ranked = rankGroups(groups, search);

  return (
    <>
      {recordsQuery.isError && (
        <CommandMenu.Group heading={t("commandMenu.groupRecords")}>
          <CommandMenu.Item
            onSelect={() => void recordsQuery.refetch()}
            deferSelect={false}
          >
            <IconAlertTriangle className="size-4 text-destructive" />
            <span className="min-w-0 flex-1 truncate">
              {t("commandMenu.recordSearchFailed")}
            </span>
            <span className="text-xs text-muted-foreground">
              {t("navigation.retry")}
            </span>
          </CommandMenu.Item>
        </CommandMenu.Group>
      )}
      {ranked.map((group) => (
        <CommandMenu.Group key={group.id} heading={group.heading}>
          {group.entries.map((entry) => {
            const Icon = entry.icon;
            return (
              <CommandMenu.Item key={entry.id} onSelect={entry.run}>
                <Icon className="size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              </CommandMenu.Item>
            );
          })}
        </CommandMenu.Group>
      ))}
    </>
  );
}

const SHORTCUT_HELP = [
  {
    groupKey: "shortcuts.groupNavigation",
    rows: [
      { keys: ["g", "a"], labelKey: "shortcuts.goAccounts" },
      { keys: ["g", "p"], labelKey: "shortcuts.goPeople" },
      { keys: ["g", "o"], labelKey: "shortcuts.goOpportunities" },
      { keys: ["g", "l"], labelKey: "shortcuts.goLists" },
      { keys: ["g", "t"], labelKey: "shortcuts.goTasks" },
    ],
  },
  {
    groupKey: "shortcuts.groupActions",
    rows: [
      { keys: ["n"], labelKey: "shortcuts.newRecord" },
      { keys: ["t"], labelKey: "shortcuts.newTask" },
      { keys: ["e"], labelKey: "shortcuts.edit" },
    ],
  },
  {
    groupKey: "shortcuts.groupGeneral",
    rows: [
      { keys: ["⌘", "K"], labelKey: "shortcuts.commandMenu" },
      { keys: ["/"], labelKey: "shortcuts.focusSearch" },
      { keys: ["?"], labelKey: "shortcuts.showHelp" },
    ],
  },
] as const;

function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("shortcuts.title")}</DialogTitle>
          <DialogDescription>{t("shortcuts.description")}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-5">
          {SHORTCUT_HELP.map((group) => (
            <div key={group.groupKey} className="grid gap-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                {t(group.groupKey)}
              </p>
              {group.rows.map((row) => (
                <div
                  key={row.labelKey}
                  className="flex items-center justify-between gap-4 text-sm"
                >
                  <span className="min-w-0 truncate">{t(row.labelKey)}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {row.keys.map((key) => (
                      <kbd
                        key={key}
                        className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {key}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CrmCommandMenu() {
  const t = useT();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  useCommandMenuShortcut(useCallback(() => setOpen(true), []));

  const showShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const renderResults = useCallback(
    (search: string) => (
      <CrmCommandResults
        search={search}
        navigate={navigate}
        onShowShortcuts={showShortcuts}
      />
    ),
    [navigate, showShortcuts],
  );

  useCrmKeyboardShortcuts({
    navigate,
    enabled: !open && !shortcutsOpen,
    onShowShortcuts: showShortcuts,
  });

  return (
    <>
      <CommandMenu
        open={open}
        onOpenChange={setOpen}
        placeholder={t("commandMenu.placeholder")}
        renderResults={renderResults}
        changelog={changelog}
        changelogKey="crm"
      >
        {null}
      </CommandMenu>
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}

function useCrmKeyboardShortcuts({
  navigate,
  enabled,
  onShowShortcuts,
}: {
  navigate: NavigateFunction;
  enabled: boolean;
  onShowShortcuts: () => void;
}) {
  const shortcuts = useMemo(
    () => [
      { key: "/", handler: focusCrmSearch },
      { key: "n", handler: () => emitCrmUiIntent(CRM_NEW_RECORD_EVENT) },
      { key: "t", handler: () => emitCrmUiIntent(CRM_NEW_TASK_EVENT) },
      { key: "e", handler: () => emitCrmUiIntent(CRM_EDIT_RECORD_EVENT) },
      // `?` needs Shift on US layouts and none on several others.
      { key: "?", handler: onShowShortcuts },
      { key: "?", shift: true, handler: onShowShortcuts },
    ],
    [onShowShortcuts],
  );

  const sequences = useMemo(
    () => [
      { keys: ["g", "a"], handler: () => navigate("/accounts") },
      { keys: ["g", "p"], handler: () => navigate("/people") },
      { keys: ["g", "o"], handler: () => navigate("/opportunities") },
      { keys: ["g", "l"], handler: () => navigate("/lists") },
      { keys: ["g", "t"], handler: () => navigate("/tasks") },
    ],
    [navigate],
  );

  useKeyboardShortcuts({ shortcuts, sequences, enabled });
}
