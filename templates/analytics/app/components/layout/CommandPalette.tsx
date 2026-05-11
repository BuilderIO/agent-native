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
} from "@tabler/icons-react";
import { useTheme } from "next-themes";
import { dashboards } from "@/pages/adhoc/registry";
import { getIdToken } from "@/lib/auth";
import { appApiPath, useChangeVersion } from "@agent-native/core/client";

interface SavedConfig {
  id: string;
  name: string;
}

interface ExplorerDashboard {
  id: string;
  name: string;
}

const defaultTools = [
  { id: "explorer", name: "Explorer", href: "/adhoc/explorer" },
  {
    id: "customer-health",
    name: "Customer Health",
    href: "/adhoc/customer-health",
  },
];

async function fetchSavedConfigs(): Promise<SavedConfig[]> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/explorer-configs"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.configs ?? [])
    .filter((c: any) => c.id !== "_autosave")
    .map((c: any) => ({ id: c.id, name: c.name }));
}

async function fetchExplorerDashboards(): Promise<ExplorerDashboard[]> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/explorer-dashboards"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dashboards ?? [])
    .filter((d: any) => d.name)
    .map((d: any) => ({ id: d.id, name: d.name }));
}

async function fetchSqlDashboards(): Promise<{ id: string; name: string }[]> {
  const token = await getIdToken();
  const res = await fetch(appApiPath("/api/sql-dashboards"), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dashboards ?? [])
    .filter((d: any) => d.name)
    .map((d: any) => ({ id: d.id, name: d.name }));
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
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { data: savedCharts = [] } = useQuery({
    queryKey: ["explorer-configs-palette"],
    queryFn: fetchSavedConfigs,
    staleTime: 30_000,
    enabled: open,
  });

  const dashboardsSync = useChangeVersion("dashboards");

  const { data: explorerDashboards = [] } = useQuery({
    queryKey: ["explorer-dashboards-palette", dashboardsSync],
    queryFn: fetchExplorerDashboards,
    staleTime: 30_000,
    enabled: open,
    placeholderData: (prev) => prev,
  });

  const { data: sqlDashboards = [] } = useQuery({
    queryKey: ["sql-dashboards-palette", dashboardsSync],
    queryFn: fetchSqlDashboards,
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

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search dashboards, tools, charts..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {explorerDashboards.length > 0 && (
          <CommandGroup heading="Explorer Dashboards">
            {explorerDashboards.map((d) => (
              <CommandItem
                key={`ed-${d.id}`}
                onSelect={() => go(`/adhoc/explorer-dashboard?id=${d.id}`)}
              >
                <IconLayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
                {d.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {sqlDashboards.length > 0 && (
          <CommandGroup heading="SQL Dashboards">
            {sqlDashboards.map((d) => (
              <CommandItem
                key={`sql-${d.id}`}
                onSelect={() => go(`/adhoc/${d.id}`)}
              >
                <IconLayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
                {d.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading="Dashboards">
          {dashboards.map((d) => (
            <CommandItem
              key={`dash-${d.id}`}
              onSelect={() => go(`/adhoc/${d.id}`)}
            >
              <IconFlask className="mr-2 h-4 w-4 text-muted-foreground" />
              {d.name}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Tools">
          {defaultTools.map((t) => (
            <CommandItem key={`tool-${t.id}`} onSelect={() => go(t.href)}>
              <IconTool className="mr-2 h-4 w-4 text-muted-foreground" />
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
              <IconSun className="mr-2 h-4 w-4 text-muted-foreground" />
            ) : (
              <IconMoon className="mr-2 h-4 w-4 text-muted-foreground" />
            )}
            Toggle {isDark ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>

        {savedCharts.length > 0 && (
          <CommandGroup heading="Saved Charts">
            {savedCharts.map((c) => (
              <CommandItem
                key={`chart-${c.id}`}
                onSelect={() => go(`/adhoc/explorer?config=${c.id}`)}
              >
                <IconChartBar className="mr-2 h-4 w-4 text-muted-foreground" />
                {c.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
