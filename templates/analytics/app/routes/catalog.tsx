import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import { IconLayoutDashboard } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

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
import { demoNodeExporterDashboardPath } from "@/lib/demo-dashboard-path";

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
  defaultDashboardId: string;
  dataSources: string[];
  panelCount: number;
  installedDashboards: InstalledDashboard[];
};

function isDemoTemplate(template: DashboardTemplate): boolean {
  return template.dataSources.includes("demo");
}

function dashboardPathForTemplate(
  template: DashboardTemplate,
  dashboardId: string,
  options: { intro?: boolean } = {},
): string {
  if (template.id === "demo-node-exporter") {
    return demoNodeExporterDashboardPath(dashboardId, options);
  }
  return `/dashboards/${dashboardId}`;
}

function sourceLabel(source: string): string {
  if (source === "first-party") return "First-party";
  if (source === "demo") return "Demo Prometheus";
  if (source === "ga4") return "GA4";
  if (source === "prometheus") return "Prometheus";
  return source;
}

function TemplateSkeleton() {
  return (
    <Card className="flex min-h-[250px] flex-col">
      <CardHeader>
        <div className="space-y-3">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </CardHeader>
      <CardContent className="mt-auto space-y-4">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
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
  const t = useT();
  const installedDashboard = template.installedDashboards.find(
    (dashboard) => !dashboard.archivedAt,
  );
  const isInstalled = Boolean(installedDashboard);
  const metadata = [
    t("catalog.panels", { count: String(template.panelCount) }),
    ...template.dataSources.map(sourceLabel),
  ].join(" · ");

  return (
    <Card className="flex min-h-[250px] flex-col">
      <CardHeader className="gap-2 pb-4">
        <CardTitle className="text-base leading-6">{template.name}</CardTitle>
        <CardDescription className="text-sm leading-6">
          {template.description}
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <p className="text-sm text-muted-foreground">{metadata}</p>
      </CardContent>
      <CardFooter className="gap-2">
        {isInstalled && installedDashboard ? (
          <Button
            variant="secondary"
            className="min-w-0 flex-1"
            onClick={() => onOpen(installedDashboard.id)}
          >
            {t("catalog.open")}
          </Button>
        ) : (
          <Button
            variant="secondary"
            className="min-w-0 flex-1"
            onClick={onInstall}
            disabled={installing}
          >
            {installing ? t("catalog.installing") : t("catalog.install")}
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

export default function TemplateCatalogRoute() {
  const t = useT();
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

  async function installTemplate(template: DashboardTemplate) {
    setInstallingIds((prev) => new Set(prev).add(template.id));
    try {
      const result = (await install.mutateAsync({
        templateId: template.id,
      })) as {
        dashboardId?: string;
        name?: string;
        message?: string;
        alreadyInstalled?: boolean;
      };
      if (result.dashboardId) {
        toast.success(
          result.message ??
            t("catalog.installSuccess", { name: template.name }),
        );
        navigate(
          dashboardPathForTemplate(template, result.dashboardId, {
            intro: isDemoTemplate(template) && !result.alreadyInstalled,
          }),
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? t("catalog.installFailedWithMessage", {
              name: template.name,
              message: err.message,
            })
          : t("catalog.installFailed", { name: template.name }),
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
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <div className="max-w-2xl">
        <p className="text-sm leading-6 text-muted-foreground">
          {t("catalog.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <TemplateSkeleton key={index} />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <IconLayoutDashboard className="h-8 w-8 text-muted-foreground" />
            <div>
              <h2 className="text-base font-semibold">
                {t("catalog.noTemplatesFound")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("catalog.tryDifferentCategory")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              installing={installingIds.has(template.id)}
              onInstall={() => void installTemplate(template)}
              onOpen={(dashboardId) =>
                navigate(dashboardPathForTemplate(template, dashboardId))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
