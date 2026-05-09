import { useState } from "react";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconApps,
  IconBrush,
  IconCalendarMonth,
  IconChartBar,
  IconClipboardList,
  IconEyeOff,
  IconFileText,
  IconLoader2,
  IconMail,
  IconPlus,
  IconPresentation,
  IconScreenShare,
  IconSparkles,
  IconStack3,
  IconVideo,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { CreateAppPopover } from "@/components/create-app-popover";
import { DispatchShell } from "@/components/dispatch-shell";
import { WorkspaceAppCard } from "@/components/workspace-app-card";
import { Button } from "@/components/ui/button";
import type { WorkspaceAppSummary } from "@/lib/workspace-apps";

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
  ChartBar: IconChartBar,
  ClipboardList: IconClipboardList,
  Brush: IconBrush,
  Video: IconVideo,
};

export default function AppsRoute() {
  const [showHidden, setShowHidden] = useState(false);
  const { data: apps = [] } = useActionQuery(
    "list-workspace-apps",
    { includeAgentCards: false, includeArchived: true },
    {
      refetchInterval: 2_000,
    },
  );
  const { data: workspace } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  const { data: templates = [] } = useActionQuery(
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

  return (
    <DispatchShell
      title="Apps"
      description={
        workspaceLabel
          ? `Apps in the "${workspaceLabel}" workspace. Each app gets its own route under this workspace and shares its database, auth, and agent chat.`
          : "Open workspace apps and start new app creation from Dispatch."
      }
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconApps size={16} className="text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                {workspaceLabel
                  ? `Apps in ${workspaceLabel}`
                  : "Workspace apps"}
              </h2>
            </div>
            <CreateAppPopover
              align="end"
              trigger={
                <Button size="sm" variant="outline">
                  <IconPlus size={15} className="mr-1.5" />
                  App
                </Button>
              }
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleApps.map((app) => (
              <WorkspaceAppCard key={app.id} app={app} />
            ))}

            <CreateAppPopover />
          </div>
        </section>

        {typedTemplates.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <IconStack3 size={16} className="text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Add a template
              </h2>
              <span className="text-xs text-muted-foreground">
                Scaffold a first-party app into{" "}
                <code className="font-mono text-[11px]">apps/</code>.
              </span>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {typedTemplates.map((template) => (
                <AddTemplateCard key={template.name} template={template} />
              ))}
            </div>
          </section>
        ) : null}

        {archivedApps.length > 0 ? (
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => setShowHidden((cur) => !cur)}
              className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <IconEyeOff size={14} />
              {showHidden ? "Hide" : "Show"} {archivedApps.length} hidden{" "}
              {archivedApps.length === 1 ? "app" : "apps"}
            </button>
            {showHidden ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {archivedApps.map((app) => (
                  <WorkspaceAppCard key={app.id} app={app} />
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </DispatchShell>
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
    <div className="group relative flex items-start gap-3 rounded-lg border bg-card p-4 transition hover:border-foreground/30">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
        style={{
          backgroundColor: `rgb(${template.colorRgb} / 0.12)`,
          color: template.color,
        }}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">
            {template.label}
          </h3>
        </div>
        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {template.hint}
        </p>
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            disabled={scaffold.isPending}
            onClick={() => scaffold.mutate({ template: template.name })}
          >
            {scaffold.isPending ? (
              <>
                <IconLoader2
                  size={14}
                  className="mr-1.5 animate-spin"
                />
                Adding…
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
