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
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";

import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
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
import { dashboards } from "@/pages/adhoc/registry";

import changelog from "../../../CHANGELOG.md?raw";
import { commandPaletteKeywords } from "./command-palette-search";

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
        <CommandItem
          key={`${heading}-loading-${index}`}
          disabled
          forceMount
          value={`${heading} loading ${index + 1}`}
        >
          <Skeleton className="me-2 h-4 w-4 shrink-0 rounded-sm" />
          <Skeleton
            className={`h-4 rounded ${
              loadingRowWidths[index % loadingRowWidths.length]
            }`}
          />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

async function fetchSavedConfigs(): Promise<SavedConfig[]> {
  const rows = await callAction("list-explorer-configs", {}, { method: "GET" });
  return (Array.isArray(rows) ? rows : []) as SavedConfig[];
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
  return (Array.isArray(dashboards) ? dashboards : [])
    .filter((d: any) => d && d.name)
    .map((d: any) => ({
      id: d.id,
      name: d.name,
      hiddenAt: typeof d.hiddenAt === "string" ? d.hiddenAt : null,
    }));
}

async function fetchSqlDashboards(
  t: (key: string) => string,
): Promise<{ id: string; name: string; hiddenAt: string | null }[]> {
  const rows = await callAction(
    "list-sql-dashboards",
    { hidden: "all" },
    { method: "GET" },
  );
  return (Array.isArray(rows) ? rows : [])
    .filter((d: any) => d && typeof d.id === "string" && d.id.length > 0)
    .map((d: any) => ({
      id: d.id,
      name:
        typeof d.name === "string" && d.name.trim().length > 0
          ? d.name
          : t("commandPalette.untitledDashboard"),
      hiddenAt: typeof d.hiddenAt === "string" ? d.hiddenAt : null,
    }));
}

async function fetchExtensions(): Promise<ExtensionSearchItem[]> {
  const res = await fetch(agentNativePath("/_agent-native/extensions"));
  if (!res.ok) throw new Error(`Failed to load extensions (${res.status})`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
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
    }));
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
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

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
  const savedChartsFetching = savedChartsQuery.isFetching;
  const explorerDashboardsFetching = explorerDashboardsQuery.isFetching;
  const sqlDashboardsFetching = sqlDashboardsQuery.isFetching;
  const extensionsFetching = extensionsQuery.isFetching;
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

  const go = useCallback(
    (href: string) => {
      navigate(href);
      setOpen(false);
    },
    [navigate],
  );

  const asyncGroupsLoading =
    (explorerDashboardsFetching && explorerDashboards.length === 0) ||
    (sqlDashboardsFetching && sqlDashboards.length === 0) ||
    (extensionsFetching && extensions.length === 0) ||
    (savedChartsFetching && savedCharts.length === 0);
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
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearchQuery("");
        }}
      >
        <CommandInput
          placeholder={t("commandPalette.searchPlaceholder")}
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          {!asyncGroupsLoading && !asyncGroupsErrored && (
            <CommandEmpty>{t("commandPalette.noResults")}</CommandEmpty>
          )}

          {asyncGroupsErrored && (
            <CommandGroup heading={t("commandPalette.loadFailed")} forceMount>
              <CommandItem
                forceMount
                value="retry failed command palette data"
                onSelect={retryAsyncGroups}
              >
                <IconRefresh className="me-2 h-4 w-4 text-muted-foreground" />
                {t("sidebar.retry")}
              </CommandItem>
            </CommandGroup>
          )}

          {explorerDashboardsFetching && explorerDashboards.length === 0 && (
            <CommandLoadingGroup
              heading={t("commandPalette.groupExplorerDashboards")}
              rows={2}
            />
          )}

          {visibleExplorerDashboards.length > 0 && (
            <CommandGroup heading={t("commandPalette.groupExplorerDashboards")}>
              {visibleExplorerDashboards.map((d) => (
                <CommandItem
                  key={`ed-${d.id}`}
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

          {sqlDashboardsFetching && sqlDashboards.length === 0 && (
            <CommandLoadingGroup
              heading={t("commandPalette.groupSqlDashboards")}
              rows={3}
            />
          )}

          {visibleSqlDashboards.length > 0 && (
            <CommandGroup heading={t("commandPalette.groupSqlDashboards")}>
              {visibleSqlDashboards.map((d) => (
                <CommandItem
                  key={`sql-${d.id}`}
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

          {extensionsFetching && extensions.length === 0 && (
            <CommandLoadingGroup
              heading={t("commandPalette.groupExtensions")}
              rows={3}
            />
          )}

          {extensions.length > 0 && (
            <CommandGroup heading={t("commandPalette.groupExtensions")}>
              {extensions.map((extension) => (
                <CommandItem
                  key={`extension-${extension.id}`}
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

          <CommandGroup heading={t("commandPalette.groupDashboards")}>
            {dashboards.map((d) => (
              <CommandItem
                key={`dash-${d.id}`}
                onSelect={() => go(`/dashboards/${d.id}`)}
                keywords={commandPaletteKeywords(d.name, "dashboard")}
              >
                <IconFlask className="me-2 h-4 w-4 text-muted-foreground" />
                {d.name}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={t("commandPalette.groupTools")}>
            {defaultTools
              .filter((tool) => tool.id !== "agents" || canManageOrg)
              .map((tool) => (
                <CommandItem
                  key={`tool-${tool.id}`}
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

          <CommandGroup heading={t("commandPalette.groupAppearance")}>
            <CommandItem
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
              onSelect={() => {
                const nextTheme = isDark ? "light" : "dark";
                setTheme(nextTheme);
                persistThemePreference(nextTheme);
              }}
              keywords={["theme", "dark", "light", "mode"]}
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

          <CommandGroup heading={t("commandPalette.groupHelp")}>
            <CommandItem
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

          {savedChartsFetching && savedCharts.length === 0 && (
            <CommandLoadingGroup
              heading={t("commandPalette.groupSavedCharts")}
              rows={2}
            />
          )}

          {savedCharts.length > 0 && (
            <CommandGroup heading={t("commandPalette.groupSavedCharts")}>
              {savedCharts.map((c) => (
                <CommandItem
                  key={`chart-${c.id}`}
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
