import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCheck,
  IconExternalLink,
  IconLayoutDashboard,
  IconLoader2,
  IconPackageImport,
  IconPlugConnected,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type TemplateCategory =
  | "Acquisition"
  | "Product"
  | "Observability"
  | "Operations";

type InstalledDashboard = {
  id: string;
  name: string;
  visibility: "private" | "org" | "public";
  updatedAt: string;
  archivedAt: string | null;
};

type DashboardTemplate = {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  defaultDashboardId: string;
  dataSources: string[];
  tags: string[];
  panelCount: number;
  version: string;
  recommended?: boolean;
  installed: boolean;
  installedDashboards: InstalledDashboard[];
};

const CATEGORY_TABS = [
  "All",
  "Product",
  "Acquisition",
  "Observability",
  "Operations",
] as const;

function sourceLabel(source: string): string {
  if (source === "first-party") return "First-party";
  if (source === "ga4") return "GA4";
  if (source === "prometheus") return "Prometheus";
  return source;
}

function TemplateSkeleton() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="h-10 w-full" />
      </CardContent>
    </Card>
  );
}

function TemplateCard({
  template,
  installing,
  onInstall,
  onOpen,
}: {
  template: DashboardTemplate;
  installing: boolean;
  onInstall: () => void;
  onOpen: (dashboardId: string) => void;
}) {
  const installedDashboard = template.installedDashboards.find(
    (dashboard) => !dashboard.archivedAt,
  );
  const isInstalled = Boolean(installedDashboard);

  return (
    <Card className="flex min-h-[270px] flex-col overflow-hidden">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base leading-6">
              {template.name}
            </CardTitle>
            <CardDescription className="line-clamp-2">
              {template.description}
            </CardDescription>
          </div>
          {template.recommended && (
            <Badge variant="secondary" className="shrink-0">
              Recommended
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            <IconLayoutDashboard className="h-3 w-3" />
            {template.panelCount} panels
          </Badge>
          {template.dataSources.map((source) => (
            <Badge key={source} variant="outline" className="gap-1.5">
              <IconPlugConnected className="h-3 w-3" />
              {sourceLabel(source)}
            </Badge>
          ))}
        </div>

        <div className="flex min-h-8 flex-wrap gap-1.5">
          {template.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>

        <div
          className={cn(
            "mt-auto flex items-center gap-2 rounded-md border px-3 py-2 text-xs",
            isInstalled
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {isInstalled ? (
            <IconCheck className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <IconPackageImport className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="truncate">
            {isInstalled
              ? `Installed as ${installedDashboard?.name}`
              : `Installs as a private SQL dashboard`}
          </span>
        </div>
      </CardContent>
      <CardFooter className="gap-2">
        {isInstalled && installedDashboard ? (
          <Button
            className="min-w-0 flex-1"
            onClick={() => onOpen(installedDashboard.id)}
          >
            <IconExternalLink className="h-4 w-4" />
            Open
          </Button>
        ) : (
          <Button
            className="min-w-0 flex-1"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              <IconPackageImport className="h-4 w-4" />
            )}
            {installing ? "Installing" : "Install"}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export default function TemplateCatalogRoute() {
  const [category, setCategory] =
    useState<(typeof CATEGORY_TABS)[number]>("All");
  const [installingIds, setInstallingIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const install = useActionMutation("install-dashboard-template");
  const { data, isLoading } = useActionQuery(
    "list-dashboard-templates",
    undefined,
    { staleTime: 30_000 },
  );

  const templates = useMemo(
    () => (data as DashboardTemplate[] | undefined) ?? [],
    [data],
  );
  const filtered = useMemo(() => {
    if (category === "All") return templates;
    return templates.filter((template) => template.category === category);
  }, [category, templates]);
  const installedCount = templates.filter(
    (template) => template.installed,
  ).length;

  async function installTemplate(template: DashboardTemplate) {
    setInstallingIds((prev) => new Set(prev).add(template.id));
    try {
      const result = (await install.mutateAsync({
        templateId: template.id,
      })) as { dashboardId?: string; name?: string; message?: string };
      if (result.dashboardId) {
        toast.success(result.message ?? `Installed ${template.name}`);
        navigate(`/adhoc/${result.dashboardId}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Couldn't install ${template.name}: ${err.message}`
          : `Couldn't install ${template.name}`,
      );
    } finally {
      setInstallingIds((prev) => {
        const next = new Set(prev);
        next.delete(template.id);
        return next;
      });
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm text-muted-foreground">
            Source-controlled dashboards ready to install into your workspace.
          </p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{templates.length} templates</Badge>
            <Badge variant="outline">{installedCount} installed</Badge>
          </div>
        </div>
        <Tabs
          value={category}
          onValueChange={(next) =>
            setCategory(next as (typeof CATEGORY_TABS)[number])
          }
        >
          <TabsList className="grid w-full grid-cols-5 md:w-auto">
            {CATEGORY_TABS.map((item) => (
              <TabsTrigger key={item} value={item} className="text-xs">
                {item}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <TemplateSkeleton key={index} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <IconLayoutDashboard className="h-8 w-8 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">No templates found</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Try a different catalog category.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              installing={installingIds.has(template.id)}
              onInstall={() => void installTemplate(template)}
              onOpen={(dashboardId) => navigate(`/adhoc/${dashboardId}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
