import { SimpleAgentsPanel } from "@agent-native/dispatch/components";
import { ActionQueryError } from "@agent-native/dispatch/components";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconEdit,
  IconExternalLink,
  IconLayoutGrid,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@agent-native/dispatch/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface WorkspaceAppSummary {
  id: string;
  name: string;
  description: string;
  path: string;
  url: string | null;
  isDispatch: boolean;
  status?: "ready" | "pending";
  statusLabel?: string;
}

function EditAppDialog({
  app,
  onSaved,
  t,
}: {
  app: WorkspaceAppSummary;
  onSaved: () => void;
  t: ReturnType<typeof useT>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description);
  const update = useActionMutation("update-workspace-app-metadata", {
    onSuccess: () => {
      toast.success("App details updated");
      setOpen(false);
      onSaved();
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!open) return;
    setName(app.name);
    setDescription(app.description);
  }, [app, open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Edit ${app.name}`}>
          <IconEdit size={16} />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("factoryRoute.editAppDetails")}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("factoryRoute.editAppDetailsDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor={`factory-app-name-${app.id}`}>
              {t("factoryRoute.appName")}
            </Label>
            <Input
              id={`factory-app-name-${app.id}`}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`factory-app-description-${app.id}`}>
              {t("factoryRoute.appDescription")}
            </Label>
            <Textarea
              id={`factory-app-description-${app.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              update.mutate({
                appId: app.id,
                name: name.trim(),
                description: description.trim(),
              })
            }
            disabled={!name.trim() || update.isPending}
          >
            {update.isPending
              ? t("factoryRoute.savingChanges")
              : t("factoryRoute.saveChanges")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AgenticAppsSection({ t }: { t: ReturnType<typeof useT> }) {
  const query = useActionQuery<WorkspaceAppSummary[]>("list-workspace-apps", {
    includeAgentCards: false,
  });
  const apps = (query.data ?? []).filter((app) => !app.isDispatch);

  if (query.isError) {
    return (
      <ActionQueryError
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconLayoutGrid className="size-4 text-muted-foreground" />
          {t("factoryRoute.agenticAppsTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading && apps.length === 0 ? (
          <div className="space-y-3">
            {[0, 1].map((item) => (
              <div key={item} className="h-16 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : apps.length > 0 ? (
          <div className="space-y-2">
            {apps.map((app) => (
              <div
                key={app.id}
                className="flex items-start gap-3 rounded-xl border px-4 py-3"
              >
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <IconLayoutGrid size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{app.name}</span>
                    {app.status ? (
                      <Badge variant="outline">
                        {app.statusLabel || app.status}
                      </Badge>
                    ) : null}
                  </div>
                  {app.description ? (
                    <div className="mt-1 text-sm text-muted-foreground">
                      {app.description}
                    </div>
                  ) : null}
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
                    {app.path}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {app.url ? (
                    <Button variant="ghost" size="icon" asChild>
                      <a
                        href={app.url}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={t("factoryRoute.openApp")}
                      >
                        <IconExternalLink size={16} />
                      </a>
                    </Button>
                  ) : null}
                  <EditAppDialog
                    app={app}
                    t={t}
                    onSaved={() => void query.refetch()}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
            {t("factoryRoute.agenticAppsEmpty")}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function FactoryAgentsView() {
  const t = useT();

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <AgenticAppsSection t={t} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("factoryRoute.agentsTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <SimpleAgentsPanel />
        </CardContent>
      </Card>
    </div>
  );
}
