import {
  agentNativePath,
  appApiPath,
  callAction,
  useChangeVersions,
  ChangelogDialog,
  LanguagePicker,
  useT,
} from "@agent-native/core/client";
import { extensionPath } from "@agent-native/core/client/extensions";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  IconFlask,
  IconTool,
  IconChartBar,
  IconLayoutDashboard,
  IconSun,
  IconMoon,
  IconHistory,
  IconLanguage,
  IconRefresh,
  IconBrain,
  IconSettings,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  Children,
  cloneElement,
  Fragment,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useReplayStorageStatus } from "@/hooks/use-replay-storage-status";
import { dashboards } from "@/pages/adhoc/registry";
import {
  buildAnalyticsGeneralSettingsSearchEntries,
  buildAnalyticsSettingsCommandItems,
} from "@/pages/settings/settings-search";

import changelog from "../../../CHANGELOG.md?raw";
import {
  commandPaletteKeywords,
  rankCommandPaletteEntries,
  uniqueCommandItems,
} from "./command-palette-search";

interface SavedConfig {
  id: string;
  name: string;
}

interface ExplorerDashboard {
  id: string;
  name: string;
  hiddenAt?: string | null;
}

interface ExtensionSearchItem {
  id: string;
  name: string;
  description?: string;
}

const defaultTools = [
  {
    id: "agents",
    nameKey: "navigation.admin",
    href: "/agents?view=dashboards",
    keywords: [
      "agent monitoring",
      "observability",
      "evals",
      "experiments",
      "feedback",
      "database",
      "db admin",
      "dashboard usage",
      "dashboard audit",
      "ab testing",
      "llm",
    ],
  },
  {
    id: "explorer",
    nameKey: "commandPalette.toolExplorer",
    href: "/dashboards/explorer",
    keywords: [],
  },
  {
    id: "customer-health",
    nameKey: "commandPalette.toolCustomerHealth",
    href: "/dashboards/customer-health",
    keywords: [],
  },
];

const loadingRowWidths = ["w-[58%]", "w-[71%]", "w-[84%]"] as const;

function CommandLoadingGroup({
  heading,
  rows = 3,
}: {
  heading: string;
  rows?: number;
}) {
  return (
    <CommandGroup heading={heading} forceMount>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={`${heading}-loading-${index}`}
          aria-hidden="true"
          className="flex items-center px-2 py-3"
        >
          <Skeleton className="me-2 h-4 w-4 shrink-0 rounded-sm" />
          <Skeleton
            className={`h-4 rounded ${
              loadingRowWidths[index % loadingRowWidths.length]
            }`}
          />
        </div>
      ))}
    </CommandGroup>
  );
}

type CommandGroupElement = ReactElement<ComponentProps<typeof CommandGroup>>;
type CommandItemElement = ReactElement<ComponentProps<typeof CommandItem>>;

function isCommandGroupElement(node: ReactNode): node is CommandGroupElement {
  return isValidElement(node) && node.type === CommandGroup;
}

function isCommandItemElement(node: ReactNode): node is CommandItemElement {
  return isValidElement(node) && node.type === CommandItem;
}

function RankedCommandGroups({
  search,
  emptyLabel,
  showEmpty,
  children,
}: {
  search: string;
  emptyLabel: string;
  showEmpty: boolean;
  children: ReactNode;
}) {
  const groups = Children.toArray(children).filter(isCommandGroupElement);
  const query = search.trim();
  if (!query) return <>{groups}</>;

  const rankedGroups = groups
    .map((group, index) => {
      const items = Children.toArray(group.props.children).filter(
        isCommandItemElement,
      );
      const rankedItems = rankCommandPaletteEntries(items, query, (item) => ({
        value: item.props.value ?? "",
        keywords: item.props.keywords,
      }));
      if (rankedItems.length === 0) return null;
      return {
        index,
        score: rankedItems[0].score,
        group: cloneElement(
          group,
          undefined,
          rankedItems.map(({ entry }) => entry),
        ),
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  return (
    <Fragment>
      {showEmpty && rankedGroups.length === 0 ? (
        <div role="presentation" className="py-6 text-center text-sm">
          {emptyLabel}
        </div>
      ) : null}
      {rankedGroups.map(({ group }) => group)}
    </Fragment>
  );
}

async function fetchSavedConfigs(): Promise<SavedConfig[]> {
  const rows = await callAction("list-explorer-configs", {}, { method: "GET" });
  return uniqueCommandItems((Array.isArray(rows) ? rows : []) as SavedConfig[]);
}

async function fetchExplorerDashboards(): Promise<ExplorerDashboard[]> {
  const result = await callAction(
    "list-explorer-dashboards",
    {
      hidden: "all",
    },
    { method: "GET" },
  );
  const dashboards =
    result && typeof result === "object" && "dashboards" in result
      ? (result as { dashboards: unknown[] }).dashboards
      : [];
  return uniqueCommandItems(
    (Array.isArray(dashboards) ? dashboards : [])
      .filter((d: any) => d && d.name)
      .map((d: any) => ({
        id: d.id,
        name: d.name,
        hiddenAt: typeof d.hiddenAt === "string" ? d.hiddenAt : null,
      })),
  );
}

async function fetchSqlDashboards(
  t: (key: string) => string,
): Promise<{ id: string; name: string; hiddenAt: string | null }[]> {
  const rows = await callAction(
    "list-sql-dashboards",
    { hidden: "all" },
    { method: "GET" },
  );
  return uniqueCommandItems(
    (Array.isArray(rows) ? rows : [])
      .filter((d: any) => d && typeof d.id === "string" && d.id.length > 0)
      .map((d: any) => ({
        id: d.id,
        name:
          typeof d.name === "string" && d.name.trim().length > 0
            ? d.name
            : t("commandPalette.untitledDashboard"),
        hiddenAt: typeof d.hiddenAt === "string" ? d.hiddenAt : null,
      })),
  );
}

async function fetchExtensions(): Promise<ExtensionSearchItem[]> {
  const res = await fetch(agentNativePath("/_agent-native/extensions"));
  if (!res.ok) throw new Error(`Failed to load extensions (${res.status})`);
  const data = await res.json();
  return uniqueCommandItems(
    (Array.isArray(data) ? data : [])
      .filter((extension: any) => {
        return (
          extension &&
          typeof extension.id === "string" &&
          extension.id.length > 0 &&
          typeof extension.name === "string" &&
          extension.name.trim().length > 0
        );
      })
      .map((extension: any) => ({
        id: extension.id,
        name: extension.name,
        description:
          typeof extension.description === "string"
            ? extension.description
            : undefined,
      })),
  );
}

function persistThemePreference(theme: "light" | "dark") {
  fetch(appApiPath("/api/theme"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme }),
  }).catch(() => {});
}

export function CommandPalette() {
  const t = useT();
  const { canManageOrg } = useOrgRole();
  const [open, setOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCommand, setSelectedCommand] = useState("");
  const commandListRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const replayStorageStatus = useReplayStorageStatus({ enabled: open });
  const settingsCommands = useMemo(() => {
    const generalEntries = buildAnalyticsGeneralSettingsSearchEntries(
      t,
      !!replayStorageStatus.data?.configured,
    );
    return buildAnalyticsSettingsCommandItems(t, generalEntries);
  }, [replayStorageStatus.data?.configured, t]);

  const savedChartsQuery = useQuery({
    queryKey: ["explorer-configs-palette"],
    queryFn: fetchSavedConfigs,
    staleTime: 30_000,
    enabled: open,
  });

  const dashboardsSync = useChangeVersions(["dashboards", "action"]);

  const explorerDashboardsQuery = useQuery({
    queryKey: ["explorer-dashboards-palette", dashboardsSync],
    queryFn: fetchExplorerDashboards,
    staleTime: 30_000,
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const sqlDashboardsQuery = useQuery({
    queryKey: ["sql-dashboards-palette", dashboardsSync],
    queryFn: () => fetchSqlDashboards(t),
    staleTime: 30_000,
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const extensionsQuery = useQuery<ExtensionSearchItem[]>({
    queryKey: ["extensions"],
    queryFn: fetchExtensions,
    staleTime: 30_000,
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const savedCharts = savedChartsQuery.data ?? [];
  const explorerDashboards = explorerDashboardsQuery.data ?? [];
  const sqlDashboards = sqlDashboardsQuery.data ?? [];
  const extensions = extensionsQuery.data ?? [];
  const savedChartsLoading = savedChartsQuery.isLoading;
  const explorerDashboardsLoading = explorerDashboardsQuery.isLoading;
  const sqlDashboardsLoading = sqlDashboardsQuery.isLoading;
  const extensionsLoading = extensionsQuery.isLoading;
  const asyncGroupsErrored =
    savedChartsQuery.isError ||
    explorerDashboardsQuery.isError ||
    sqlDashboardsQuery.isError ||
    extensionsQuery.isError;
  const retryAsyncGroups = () => {
    void Promise.all([
      savedChartsQuery.refetch(),
      explorerDashboardsQuery.refetch(),
      sqlDashboardsQuery.refetch(),
      extensionsQuery.refetch(),
    ]);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const openHandler = () => setOpen(true);
    document.addEventListener("keydown", handler);
    window.addEventListener("analytics:open-command-palette", openHandler);
    return () => {
      document.removeEventListener("keydown", handler);
      window.removeEventListener("analytics:open-command-palette", openHandler);
    };
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (commandListRef.current) commandListRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [searchQuery]);

  const go = useCallback(
    (href: string) => {
      navigate(href);
      setOpen(false);
    },
    [navigate],
  );

  const asyncGroupsLoading =
    (explorerDashboardsLoading && explorerDashboards.length === 0) ||
    (sqlDashboardsLoading && sqlDashboards.length === 0) ||
    (extensionsLoading && extensions.length === 0) ||
    (savedChartsLoading && savedCharts.length === 0);
  const showHiddenResults = searchQuery.trim().length > 0;
  const visibleExplorerDashboards = showHiddenResults
    ? explorerDashboards
    : explorerDashboards.filter((dashboard) => !dashboard.hiddenAt);
  const visibleSqlDashboards = showHiddenResults
    ? sqlDashboards
    : sqlDashboards.filter((dashboard) => !dashboard.hiddenAt);

  return (
    <>
      <CommandDialog
        open={open}
        motion="instant"
        commandProps={{
          shouldFilter: false,
          value: selectedCommand,
          onValueChange: setSelectedCommand,
        }}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setSearchQuery("");
            setSelectedCommand("");
          }
        }}
      >
        <CommandInput
          placeholder={t("commandPalette.searchPlaceholder")}
          value={searchQuery}
          onValueChange={(nextQuery) => {
            setSelectedCommand("");
            setSearchQuery(nextQuery);
          }}
        />
        <CommandList ref={commandListRef}>
          {asyncGroupsErrored && (
            <CommandGroup
              key="load-error"
              heading={t("commandPalette.loadFailed")}
              forceMount
            >
              <CommandItem
                forceMount
                value="action:retry-command-palette-data"
                onSelect={retryAsyncGroups}
              >
                <IconRefresh className="me-2 h-4 w-4 text-muted-foreground" />
                {t("sidebar.retry")}
              </CommandItem>
            </CommandGroup>
          )}

          <RankedCommandGroups
            search={searchQuery}
            emptyLabel={t("commandPalette.noResults")}
            showEmpty={!asyncGroupsLoading && !asyncGroupsErrored}
          >
            {visibleExplorerDashboards.length > 0 && (
              <CommandGroup
                key="explorer-dashboards"
                heading={t("commandPalette.groupExplorerDashboards")}
              >
                {visibleExplorerDashboards.map((d) => (
                  <CommandItem
                    key={`ed-${d.id}`}
                    value={`explorer-dashboard:${d.id}:${d.name}`}
                    onSelect={() =>
                      go(`/dashboards/explorer-dashboard?id=${d.id}`)
                    }
                    keywords={commandPaletteKeywords(
                      d.name,
                      "explorer dashboard",
                      "dashboard",
                    )}
                  >
                    <IconLayoutDashboard className="me-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{d.name}</span>
                    {d.hiddenAt ? (
                      <span className="ms-2 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("commandPalette.hidden")}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {visibleSqlDashboards.length > 0 && (
              <CommandGroup
                key="sql-dashboards"
                heading={t("commandPalette.groupSqlDashboards")}
              >
                {visibleSqlDashboards.map((d) => (
                  <CommandItem
                    key={`sql-${d.id}`}
                    value={`sql-dashboard:${d.id}:${d.name}`}
                    onSelect={() => go(`/dashboards/${d.id}`)}
                    keywords={commandPaletteKeywords(
                      d.name,
                      "sql dashboard",
                      "dashboard",
                    )}
                  >
                    <IconLayoutDashboard className="me-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{d.name}</span>
                    {d.hiddenAt ? (
                      <span className="ms-2 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("commandPalette.hidden")}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {extensions.length > 0 && (
              <CommandGroup
                key="extensions"
                heading={t("commandPalette.groupExtensions")}
              >
                {extensions.map((extension) => (
                  <CommandItem
                    key={`extension-${extension.id}`}
                    value={`extension:${extension.id}:${extension.name}`}
                    onSelect={() =>
                      go(extensionPath(extension.id, extension.name))
                    }
                    keywords={commandPaletteKeywords(
                      extension.name,
                      extension.description,
                      "extension",
                      "tool",
                    )}
                  >
                    <IconTool className="me-2 h-4 w-4 text-muted-foreground" />
                    {extension.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup
              key="dashboards"
              heading={t("commandPalette.groupDashboards")}
            >
              {dashboards.map((d) => (
                <CommandItem
                  key={`dash-${d.id}`}
                  value={`dashboard:${d.id}:${d.name}`}
                  onSelect={() => go(`/dashboards/${d.id}`)}
                  keywords={commandPaletteKeywords(d.name, "dashboard")}
                >
                  <IconFlask className="me-2 h-4 w-4 text-muted-foreground" />
                  {d.name}
                </CommandItem>
              ))}
            </CommandGroup>

            <CommandGroup key="tools" heading={t("commandPalette.groupTools")}>
              {defaultTools
                .filter((tool) => tool.id !== "agents" || canManageOrg)
                .map((tool) => (
                  <CommandItem
                    key={`tool-${tool.id}`}
                    value={`tool:${tool.id}:${t(tool.nameKey)}`}
                    onSelect={() => go(tool.href)}
                    keywords={commandPaletteKeywords(
                      t(tool.nameKey),
                      "tool",
                      ...tool.keywords,
                    )}
                  >
                    <IconTool className="me-2 h-4 w-4 text-muted-foreground" />
                    {t(tool.nameKey)}
                  </CommandItem>
                ))}
            </CommandGroup>

            {showHiddenResults && (
              <CommandGroup key="settings" heading={t("navigation.settings")}>
                <CommandItem
                  value={`setting:agent-page:${t("settings.agentTitle")}`}
                  onSelect={() => go("/agent")}
                  keywords={commandPaletteKeywords(
                    t("settings.agentTitle"),
                    "agent",
                    "context",
                    "files",
                    "connections",
                    "jobs",
                    "access",
                  )}
                >
                  <IconBrain className="me-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{t("settings.agentTitle")}</span>
                </CommandItem>
                {settingsCommands.map((setting) => (
                  <CommandItem
                    key={`setting-${setting.id}`}
                    value={`setting:${setting.id}:${setting.label}`}
                    onSelect={() => go(setting.href)}
                    keywords={commandPaletteKeywords(
                      setting.label,
                      setting.keywords,
                      "settings",
                    )}
                  >
                    <IconSettings className="me-2 h-4 w-4 text-muted-foreground" />
                    <span className="truncate">{setting.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            <CommandGroup
              key="appearance"
              heading={t("commandPalette.groupAppearance")}
            >
              <CommandItem
                value={`appearance:language:${t("settings.languageTitle")}`}
                onSelect={() => {
                  setOpen(false);
                  setLanguageOpen(true);
                }}
                keywords={commandPaletteKeywords(
                  t("settings.languageTitle"),
                  t("settings.languageLabel"),
                  "language",
                  "locale",
                  "translation",
                  "internationalization",
                  "i18n",
                )}
              >
                <IconLanguage className="me-2 h-4 w-4 text-muted-foreground" />
                {t("settings.languageTitle")}
              </CommandItem>
              <CommandItem
                value={`appearance:theme:${
                  isDark
                    ? t("commandPalette.toggleLightMode")
                    : t("commandPalette.toggleDarkMode")
                }`}
                onSelect={() => {
                  const nextTheme = isDark ? "light" : "dark";
                  setTheme(nextTheme);
                  persistThemePreference(nextTheme);
                }}
                keywords={commandPaletteKeywords(
                  isDark
                    ? t("commandPalette.toggleLightMode")
                    : t("commandPalette.toggleDarkMode"),
                  "theme",
                  "dark",
                  "light",
                  "mode",
                )}
              >
                {isDark ? (
                  <IconSun className="me-2 h-4 w-4 text-muted-foreground" />
                ) : (
                  <IconMoon className="me-2 h-4 w-4 text-muted-foreground" />
                )}
                {isDark
                  ? t("commandPalette.toggleLightMode")
                  : t("commandPalette.toggleDarkMode")}
              </CommandItem>
            </CommandGroup>

            <CommandGroup key="help" heading={t("commandPalette.groupHelp")}>
              <CommandItem
                value={`help:changelog:${t("commandPalette.whatsNew")}`}
                onSelect={() => {
                  setOpen(false);
                  setChangelogOpen(true);
                }}
                keywords={commandPaletteKeywords(
                  t("commandPalette.whatsNew"),
                  "changelog",
                  "updates",
                  "release notes",
                  "changes",
                )}
              >
                <IconHistory className="me-2 h-4 w-4 text-muted-foreground" />
                {t("commandPalette.whatsNew")}
              </CommandItem>
            </CommandGroup>

            {savedCharts.length > 0 && (
              <CommandGroup
                key="saved-charts"
                heading={t("commandPalette.groupSavedCharts")}
              >
                {savedCharts.map((c) => (
                  <CommandItem
                    key={`chart-${c.id}`}
                    value={`saved-chart:${c.id}:${c.name}`}
                    onSelect={() => go(`/dashboards/explorer?config=${c.id}`)}
                    keywords={commandPaletteKeywords(
                      c.name,
                      "saved chart",
                      "chart",
                    )}
                  >
                    <IconChartBar className="me-2 h-4 w-4 text-muted-foreground" />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </RankedCommandGroups>

          {explorerDashboardsLoading && explorerDashboards.length === 0 && (
            <CommandLoadingGroup
              key="explorer-dashboards-loading"
              heading={t("commandPalette.groupExplorerDashboards")}
              rows={2}
            />
          )}

          {sqlDashboardsLoading && sqlDashboards.length === 0 && (
            <CommandLoadingGroup
              key="sql-dashboards-loading"
              heading={t("commandPalette.groupSqlDashboards")}
              rows={3}
            />
          )}

          {extensionsLoading && extensions.length === 0 && (
            <CommandLoadingGroup
              key="extensions-loading"
              heading={t("commandPalette.groupExtensions")}
              rows={3}
            />
          )}

          {savedChartsLoading && savedCharts.length === 0 && (
            <CommandLoadingGroup
              key="saved-charts-loading"
              heading={t("commandPalette.groupSavedCharts")}
              rows={2}
            />
          )}
        </CommandList>
      </CommandDialog>
      <ChangelogDialog
        open={changelogOpen}
        onOpenChange={setChangelogOpen}
        markdown={changelog}
      />
      <Dialog open={languageOpen} onOpenChange={setLanguageOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("settings.languageTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>{t("settings.languageLabel")}</Label>
            <LanguagePicker label={t("settings.languageLabel")} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
