import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
import {
  IconApps,
  IconBrain,
  IconBrush,
  IconCalendarMonth,
  IconChartBar,
  IconChevronDown,
  IconClipboardList,
  IconEyeOff,
  IconFileText,
  IconLoader2,
  IconMail,
  IconPhoto,
  IconPlus,
  IconPresentation,
  IconScreenShare,
  IconSparkles,
  IconStack3,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { CreateAppPopover } from "../../components/create-app-popover";
import { DispatchShell } from "../../components/dispatch-shell";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import { Skeleton } from "../../components/ui/skeleton";
import { WorkspaceAppCard } from "../../components/workspace-app-card";
import { cn } from "../../lib/utils";
import type { WorkspaceAppSummary } from "../../lib/workspace-apps";

export function meta() {
  return [{ title: "Apps — Dispatch" }];
}

interface WorkspaceInfo {
  name: string | null;
  displayName: string | null;
  appCount: number;
}

interface AvailableTemplate {
  name: string;
  label: string;
  hint: string;
  icon: string;
  color: string;
  colorRgb: string;
  core: boolean;
}

const TEMPLATE_ICONS: Record<string, typeof IconMail> = {
  Mail: IconMail,
  CalendarMonth: IconCalendarMonth,
  FileText: IconFileText,
  Presentation: IconPresentation,
  ScreenShare: IconScreenShare,
  Brain: IconBrain,
  Photo: IconPhoto,
  ChartBar: IconChartBar,
  ClipboardList: IconClipboardList,
  Brush: IconBrush,
};

export default function AppsRoute() {
  const t = useT();
  const [showHidden, setShowHidden] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const { data: apps = [], isLoading: appsLoading } = useActionQuery(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
  );
  const { data: workspace } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  const { data: templates = [], isLoading: templatesLoading } = useActionQuery(
    "list-available-workspace-templates",
    {},
    { refetchInterval: 5_000 },
  );

  const ws = workspace as WorkspaceInfo | undefined;
  const workspaceLabel = ws?.displayName ?? ws?.name ?? null;
  const allApps = (apps as WorkspaceAppSummary[]).filter(
    (app) => !app.isDispatch,
  );
  const visibleApps = allApps.filter((app) => !app.archived);
  const archivedApps = allApps.filter((app) => app.archived);
  const typedTemplates = templates as AvailableTemplate[];
  const showAppSkeletons = appsLoading && allApps.length === 0;

  return (
    <DispatchShell
      title={t("dispatch.nav.apps")}
      description={
        workspaceLabel
          ? t("dispatch.pages.appsDescriptionWithWorkspace", {
              workspace: workspaceLabel,
            })
          : t("dispatch.pages.appsDescription")
      }
    >
      <div className="space-y-8">
        <section className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2">
              <IconApps
                size={16}
                className="mt-0.5 shrink-0 text-muted-foreground"
              />
              <div className="min-w-0">
                <h2 className="truncate text-sm font-semibold text-foreground">
                  {workspaceLabel
                    ? t("dispatch.pages.appsInWorkspace", {
                        workspace: workspaceLabel,
                      })
                    : t("dispatch.pages.workspaceApps")}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("dispatch.pages.activeCount", {
                    count: visibleApps.length,
                  })}
                  {archivedApps.length > 0
                    ? ` · ${t("dispatch.pages.hiddenCount", {
                        count: archivedApps.length,
                      })}`
                    : ""}
                </p>
              </div>
            </div>
            {visibleApps.length > 0 ? (
              <CreateAppPopover
                align="end"
                trigger={
                  <Button size="sm">
                    <IconPlus size={15} className="mr-1.5" />
                    {t("dispatch.pages.createApp")}
                  </Button>
                }
              />
            ) : null}
          </div>

          {showAppSkeletons ? (
            <AppsSkeletonGrid />
          ) : visibleApps.length > 0 ? (
            <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleApps.map((app) => (
                <WorkspaceAppCard key={app.id} app={app} className="h-full" />
              ))}
            </div>
          ) : (
            <EmptyAppsState />
          )}
        </section>

        {typedTemplates.length > 0 || templatesLoading ? (
          <Collapsible open={templatesOpen} onOpenChange={setTemplatesOpen}>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  <IconStack3
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      {t("dispatch.pages.templates")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {templatesLoading
                        ? t("dispatch.pages.checkingTemplates")
                        : t("dispatch.pages.templatesAvailable", {
                            count: typedTemplates.length,
                          })}
                    </p>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    {templatesOpen
                      ? t("dispatch.pages.hide")
                      : t("dispatch.pages.show")}
                    <IconChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        templatesOpen && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                {templatesLoading && typedTemplates.length === 0 ? (
                  <AppsSkeletonGrid />
                ) : (
                  <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {typedTemplates.map((template) => (
                      <AddTemplateCard
                        key={template.name}
                        template={template}
                      />
                    ))}
                  </div>
                )}
              </CollapsibleContent>
            </section>
          </Collapsible>
        ) : null}

        {archivedApps.length > 0 ? (
          <Collapsible open={showHidden} onOpenChange={setShowHidden}>
            <section className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
                <div className="flex min-w-0 items-center gap-2">
                  <IconEyeOff
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">
                      {t("dispatch.pages.hiddenApps")}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {t("dispatch.pages.hiddenAppCount", {
                        count: archivedApps.length,
                      })}
                    </p>
                  </div>
                </div>
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                  >
                    {showHidden
                      ? t("dispatch.pages.hide")
                      : t("dispatch.pages.show")}
                    <IconChevronDown
                      size={14}
                      className={cn(
                        "transition-transform",
                        showHidden && "rotate-180",
                      )}
                    />
                  </Button>
                </CollapsibleTrigger>
              </div>
              <CollapsibleContent>
                <div className="grid auto-rows-fr gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {archivedApps.map((app) => (
                    <WorkspaceAppCard
                      key={app.id}
                      app={app}
                      className="h-full"
                    />
                  ))}
                </div>
              </CollapsibleContent>
            </section>
          </Collapsible>
        ) : null}
      </div>
    </DispatchShell>
  );
}

function AppsSkeletonGrid() {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
              <div className="space-y-2 pt-1">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyAppsState() {
  const t = useT();
  return (
    <div className="rounded-lg border border-dashed bg-card px-4 py-10 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <IconApps size={18} />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-foreground">
        {t("dispatch.pages.noWorkspaceApps")}
      </h3>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {t("dispatch.pages.noWorkspaceAppsDescription")}
      </p>
      <div className="mt-4">
        <CreateAppPopover
          trigger={
            <Button size="sm">
              <IconPlus size={15} className="mr-1.5" />
              {t("dispatch.pages.createApp")}
            </Button>
          }
        />
      </div>
    </div>
  );
}

function AddTemplateCard({ template }: { template: AvailableTemplate }) {
  const Icon = TEMPLATE_ICONS[template.icon] ?? IconSparkles;
  const scaffold = useActionMutation("scaffold-workspace-app", {
    onSuccess: (result: any) => {
      toast.success(
        `Scaffolded apps/${result?.appId || template.name}. The gateway will pick it up shortly.`,
      );
    },
    onError: (err) => {
      toast.error(
        `Could not scaffold ${template.label}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    },
  });

  return (
    <div className="group relative flex h-full min-h-36 items-stretch gap-3 rounded-lg border bg-card p-4 transition hover:border-foreground/30">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center self-start rounded-md"
        style={{
          backgroundColor: `rgb(${template.colorRgb} / 0.12)`,
          color: template.color,
        }}
      >
        <Icon size={18} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {template.label}
          </h3>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {template.hint}
        </p>
        <div className="mt-auto pt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={scaffold.isPending}
            onClick={() => scaffold.mutate({ template: template.name })}
          >
            {scaffold.isPending ? (
              <>
                <IconLoader2 size={14} className="mr-1.5 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <IconPlus size={14} className="mr-1.5" />
                Add to workspace
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
