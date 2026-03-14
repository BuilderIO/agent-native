import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { FlaskConical, Wrench, BarChart3, LayoutDashboard } from "lucide-react";
import { dashboards } from "@/pages/adhoc/registry";
import { getIdToken } from "@/lib/auth";

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
  {
    id: "slack-feedback",
    name: "Slack Feedback",
    href: "/adhoc/slack-feedback",
  },
  { id: "query-explorer", name: "Query Explorer", href: "/query" },
];

async function fetchSavedConfigs(): Promise<SavedConfig[]> {
  const token = await getIdToken();
  const res = await fetch("/api/explorer-configs", {
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
  const res = await fetch("/api/explorer-dashboards", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.dashboards ?? []).map((d: any) => ({ id: d.id, name: d.name }));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: savedCharts = [] } = useQuery({
    queryKey: ["explorer-configs-palette"],
    queryFn: fetchSavedConfigs,
    staleTime: 30_000,
    enabled: open,
  });

  const { data: explorerDashboards = [] } = useQuery({
    queryKey: ["explorer-dashboards-palette"],
    queryFn: fetchExplorerDashboards,
    staleTime: 30_000,
    enabled: open,
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
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
                <LayoutDashboard className="mr-2 h-4 w-4 text-muted-foreground" />
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
              <FlaskConical className="mr-2 h-4 w-4 text-muted-foreground" />
              {d.name}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Tools">
          {defaultTools.map((t) => (
            <CommandItem key={`tool-${t.id}`} onSelect={() => go(t.href)}>
              <Wrench className="mr-2 h-4 w-4 text-muted-foreground" />
              {t.name}
            </CommandItem>
          ))}
        </CommandGroup>

        {savedCharts.length > 0 && (
          <CommandGroup heading="Saved Charts">
            {savedCharts.map((c) => (
              <CommandItem
                key={`chart-${c.id}`}
                onSelect={() => go(`/adhoc/explorer?config=${c.id}`)}
              >
                <BarChart3 className="mr-2 h-4 w-4 text-muted-foreground" />
                {c.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
