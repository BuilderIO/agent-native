import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconArrowUpRight,
  IconApps,
  IconCheck,
  IconPlus,
  IconSettings,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { DispatchShell } from "@/components/dispatch-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface WorkspaceAppSummary {
  id: string;
  name: string;
  description?: string;
  path: string;
  isDispatch: boolean;
}

interface AppCreationSettings {
  builderProjectId: string | null;
  builderProjectIdSource: "env" | "dispatch" | "unset";
  envBuilderProjectId: string | null;
  savedBuilderProjectId: string | null;
  builderBranchingEnabled: boolean;
}

export function meta() {
  return [{ title: "Apps — Dispatch" }];
}

function BuilderProjectSettings({
  settings,
}: {
  settings?: AppCreationSettings;
}) {
  const [projectId, setProjectId] = useState("");
  const fromEnv = settings?.builderProjectIdSource === "env";

  useEffect(() => {
    setProjectId(settings?.savedBuilderProjectId || "");
  }, [settings?.savedBuilderProjectId]);

  const save = useActionMutation("set-app-creation-settings", {
    onSuccess: () => toast.success("Builder project saved"),
    onError: (err) => toast.error(String(err)),
  });

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconSettings size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Builder app creation
          </h2>
        </div>
        <Badge variant={settings?.builderProjectId ? "default" : "secondary"}>
          {settings?.builderProjectId ? "Configured" : "Coming soon"}
        </Badge>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label>Default Builder project ID</Label>
          <Input
            value={fromEnv ? settings?.envBuilderProjectId || "" : projectId}
            onChange={(event) => setProjectId(event.target.value)}
            disabled={fromEnv}
            placeholder="274d28fec94b48f2b2d68f2274d390eb"
            className="font-mono text-sm"
          />
        </div>
        <div className="flex items-end">
          <Button
            onClick={() =>
              save.mutate({ builderProjectId: projectId.trim() || null })
            }
            disabled={fromEnv || save.isPending}
          >
            {save.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {fromEnv
          ? "This project is provided by env, so Dispatch will not write over it."
          : "Production app requests create Builder branches when this project is set. Local dev requests go to the local code agent."}
      </p>
    </section>
  );
}

export default function AppsRoute() {
  const { data: apps = [] } = useActionQuery("list-workspace-apps", {});
  const { data: settings } = useActionQuery("get-app-creation-settings", {});
  const typedApps = apps as WorkspaceAppSummary[];

  return (
    <DispatchShell
      title="Apps"
      description="Open workspace apps and start new app creation from Dispatch."
    >
      <div className="space-y-5">
        <BuilderProjectSettings settings={settings as AppCreationSettings} />

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <IconApps size={16} className="text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">
                Workspace apps
              </h2>
            </div>
            <Button asChild size="sm">
              <Link to="/new-app">
                <IconPlus size={15} className="mr-1.5" />
                App
              </Link>
            </Button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {typedApps.map((app) => (
              <a
                key={app.id}
                href={app.path}
                className="group rounded-lg border bg-card p-4 transition hover:border-foreground/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {app.name}
                      </h3>
                      {app.isDispatch ? (
                        <Badge variant="secondary">Control plane</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {app.path}
                    </p>
                    {app.description ? (
                      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {app.description}
                      </p>
                    ) : null}
                  </div>
                  <IconArrowUpRight
                    size={16}
                    className="shrink-0 text-muted-foreground transition group-hover:text-foreground"
                  />
                </div>
              </a>
            ))}

            <Link
              to="/new-app"
              className="flex min-h-32 items-center justify-center rounded-lg border border-dashed bg-card p-4 text-sm font-medium text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
            >
              <span className="inline-flex items-center gap-2">
                <IconPlus size={16} />
                App
              </span>
            </Link>
          </div>

          {settings?.builderProjectId ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <IconCheck size={14} className="text-foreground" />
              Production app requests will use Builder project{" "}
              <span className="font-mono text-foreground">
                {settings.builderProjectId}
              </span>
              .
            </div>
          ) : null}
        </section>
      </div>
    </DispatchShell>
  );
}
