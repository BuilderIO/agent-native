import { useActionQuery } from "@agent-native/core/client";
import { IconApps, IconPlus } from "@tabler/icons-react";
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

export default function AppsRoute() {
  const { data: apps = [] } = useActionQuery(
    "list-workspace-apps",
    { includeAgentCards: false },
    {
      refetchInterval: 2_000,
    },
  );
  const { data: workspace } = useActionQuery(
    "get-workspace-info",
    {},
    { staleTime: 60_000 },
  );
  const ws = workspace as WorkspaceInfo | undefined;
  const workspaceLabel = ws?.displayName ?? ws?.name ?? null;
  const typedApps = (apps as WorkspaceAppSummary[]).filter(
    (app) => !app.isDispatch,
  );

  return (
    <DispatchShell
      title="Apps"
      description={
        workspaceLabel
          ? `Apps in the "${workspaceLabel}" workspace. Each app gets its own route under this workspace and shares its database, auth, and agent chat.`
          : "Open workspace apps and start new app creation from Dispatch."
      }
    >
      <div className="space-y-4">
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
            {typedApps.map((app) => (
              <WorkspaceAppCard key={app.id} app={app} />
            ))}

            <CreateAppPopover />
          </div>
        </section>
      </div>
    </DispatchShell>
  );
}
