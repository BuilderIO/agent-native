import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  IconFlask,
  IconTool,
  IconChartBar,
  IconLayoutDashboard,
  IconSun,
  IconMoon,
  IconHistory,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { dashboards } from "@/pages/adhoc/registry";
import { Skeleton } from "@/components/ui/skeleton";
import {
  agentNativePath,
  appApiPath,
  callAction,
  useChangeVersions,
  ChangelogDialog,
} from "@agent-native/core/client";
import { extensionPath } from "@agent-native/core/client/extensions";
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
  { id: "explorer", name: "Explorer", href: "/dashboards/explorer" },
  {
    id: "customer-health",
    name: "Customer Health",
    href: "/dashboards/customer-health",
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
  try {
    const rows = await callAction(
      "list-explorer-configs",
      {},
      { method: "GET" },
    );
    return (Array.isArray(rows) ? rows : []) as SavedConfig[];
  } catch {
    return [];
  }
}

async function fetchExplorerDashboards(): Promise<ExplorerDashboard[]> {
  try {
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
  } catch {
    return [];
  }
}

async function fetchSqlDashboards(): Promise<
  { id: string; name: string; hiddenAt: string | null }[]
> {
  try {
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
            : "Untitled dashboard",
        hiddenAt: typeof d.hiddenAt === "string" ? d.hiddenAt : null,
      }));
  } catch {
    return [];
  }
}

async function fetchExtensions(): Promise<ExtensionSearchItem[]> {
  const res = await fetch(agentNativePath("/_agent-native/extensions"));
  if (!res.ok) return [];
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
  const [open, setOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { data: savedCharts = [], isFetching: savedChartsFetching } = useQuery({
    queryKey: ["explorer-configs-palette"],
    queryFn: fetchSavedConfigs,
    staleTime: 30_000,
    enabled: open,
  });

  const dashboardsSync = useChangeVersions(["dashboards", "action"]);

  const {
    data: explorerDashboards = [],
    isFetching: explorerDashboardsFetching,
  } = useQuery({
    queryKey: ["explorer-dashboards-palette", dashboardsSync],
    queryFn: fetchExplorerDashboards,
    staleTime: 30_000,
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const { data: sqlDashboards = [], isFetching: sqlDashboardsFetching } =
    useQuery({
      queryKey: ["sql-dashboards-palette", dashboardsSync],
      queryFn: fetchSqlDashboards,
      staleTime: 30_000,
      enabled: open,
      placeholderData: (prev) => prev,
    });

  const { data: extensions = [], isFetching: extensionsFetching } = useQuery<
    ExtensionSearchItem[]
  >({
    queryKey: ["extensions"],
    queryFn: fetchExtensions,
    staleTime: 30_000,
    enabled: open,
    placeholderData: (prev) => prev,
  });

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
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearchQuery("");
        }}
      >
        <CommandInput
          placeholder="Search dashboards, extensions, charts..."
          value={searchQuery}
          onValueChange={setSearchQuery}
        />
        <CommandList>
          {!asyncGroupsLoading && (
            <CommandEmpty>No results found.</CommandEmpty>
          )}

          {explorerDashboardsFetching && explorerDashboards.length === 0 && (
            <CommandLoadingGroup heading="Explorer Dashboards" rows={2} />
          )}

          {visibleExplorerDashboards.length > 0 && (
            <CommandGroup heading="Explorer Dashboards">
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
                      Hidden
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {sqlDashboardsFetching && sqlDashboards.length === 0 && (
            <CommandLoadingGroup heading="SQL Dashboards" rows={3} />
          )}

          {visibleSqlDashboards.length > 0 && (
            <CommandGroup heading="SQL Dashboards">
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
                      Hidden
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {extensionsFetching && extensions.length === 0 && (
            <CommandLoadingGroup heading="Extensions" rows={3} />
          )}

          {extensions.length > 0 && (
            <CommandGroup heading="Extensions">
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

          <CommandGroup heading="Dashboards">
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

          <CommandGroup heading="Tools">
            {defaultTools.map((t) => (
              <CommandItem
                key={`tool-${t.id}`}
                onSelect={() => go(t.href)}
                keywords={commandPaletteKeywords(t.name, "tool")}
              >
                <IconTool className="me-2 h-4 w-4 text-muted-foreground" />
                {t.name}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading="Appearance">
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
              Toggle {isDark ? "light" : "dark"} mode
            </CommandItem>
          </CommandGroup>

          <CommandGroup heading="Help">
            <CommandItem
              onSelect={() => {
                setOpen(false);
                setChangelogOpen(true);
              }}
              keywords={commandPaletteKeywords(
                "What's new",
                "changelog",
                "updates",
                "release notes",
                "changes",
              )}
            >
              <IconHistory className="me-2 h-4 w-4 text-muted-foreground" />
              What's new
            </CommandItem>
          </CommandGroup>

          {savedChartsFetching && savedCharts.length === 0 && (
            <CommandLoadingGroup heading="Saved Charts" rows={2} />
          )}

          {savedCharts.length > 0 && (
            <CommandGroup heading="Saved Charts">
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
    </>
  );
}
