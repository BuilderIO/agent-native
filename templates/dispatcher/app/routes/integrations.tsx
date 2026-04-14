import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconCheck,
  IconCircleDashed,
  IconKey,
  IconRefresh,
  IconShieldCheck,
  IconWifi,
  IconWifiOff,
} from "@tabler/icons-react";
import { DispatcherShell } from "@/components/dispatcher-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export function meta() {
  return [{ title: "Integrations — Dispatcher" }];
}

function StatusBadge({
  configured,
  vaultGranted,
}: {
  configured: boolean;
  vaultGranted: boolean;
}) {
  if (configured && vaultGranted) {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/10 text-green-700 dark:text-green-400"
      >
        <IconShieldCheck size={12} className="mr-1" />
        Vault
      </Badge>
    );
  }
  if (configured) {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/10 text-green-700 dark:text-green-400"
      >
        <IconCheck size={12} className="mr-1" />
        Configured
      </Badge>
    );
  }
  if (vaultGranted) {
    return (
      <Badge
        variant="secondary"
        className="bg-blue-500/10 text-blue-700 dark:text-blue-400"
      >
        <IconKey size={12} className="mr-1" />
        Granted (not synced)
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-amber-500/10 text-amber-700 dark:text-amber-400"
    >
      <IconCircleDashed size={12} className="mr-1" />
      Missing
    </Badge>
  );
}

function AppCard({ app }: { app: any }) {
  const syncToApp = useActionMutation("sync-vault-to-app", {
    onSuccess: (data: any) =>
      toast.success(`Synced ${data.synced} key(s) to ${data.appId}`),
    onError: (err) => toast.error(String(err)),
  });

  const integrations = app.integrations || [];
  const configuredCount = integrations.filter((i: any) => i.configured).length;
  const total = integrations.length;
  const coverage = total > 0 ? Math.round((configuredCount / total) * 100) : 0;

  return (
    <div className="rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-xl text-white text-xs font-bold"
            style={{ backgroundColor: app.color }}
          >
            {app.appName.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {app.appName}
              </h3>
              {app.reachable ? (
                <IconWifi size={14} className="text-green-500" />
              ) : (
                <IconWifiOff size={14} className="text-muted-foreground/50" />
              )}
            </div>
            <div className="text-xs text-muted-foreground">{app.appId}</div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => syncToApp.mutate({ appId: app.appId })}
          disabled={syncToApp.isPending || !app.reachable}
        >
          <IconRefresh
            size={14}
            className={syncToApp.isPending ? "animate-spin" : ""}
          />
          <span className="ml-1.5">Sync</span>
        </Button>
      </div>

      <div className="px-5 py-4">
        {total > 0 ? (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {configuredCount}/{total} configured
              </span>
              <span>{coverage}%</span>
            </div>
            <Progress value={coverage} className="mt-2 h-1.5" />

            <div className="mt-4 space-y-2">
              {integrations.map((integration: any) => (
                <div
                  key={integration.key}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-foreground">
                        {integration.label}
                      </span>
                      {integration.required && (
                        <span className="text-xs text-red-500">required</span>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {integration.key}
                    </div>
                  </div>
                  <StatusBadge
                    configured={integration.configured}
                    vaultGranted={integration.vaultGranted}
                  />
                </div>
              ))}
            </div>
          </>
        ) : app.reachable ? (
          <div className="py-4 text-center text-sm text-muted-foreground">
            No declared integrations.
          </div>
        ) : (
          <div className="py-4 text-center text-sm text-muted-foreground">
            App is not reachable. Start the app to see its integrations.
          </div>
        )}
      </div>
    </div>
  );
}

export default function IntegrationsRoute() {
  const { data: catalog, isLoading } = useActionQuery(
    "list-integrations-catalog",
    {},
  );

  const apps = catalog || [];
  const reachableApps = apps.filter((a: any) => a.reachable);
  const unreachableApps = apps.filter((a: any) => !a.reachable);

  const totalIntegrations = apps.reduce(
    (sum: number, a: any) => sum + (a.integrations?.length || 0),
    0,
  );
  const configuredIntegrations = apps.reduce(
    (sum: number, a: any) =>
      sum + (a.integrations?.filter((i: any) => i.configured)?.length || 0),
    0,
  );

  return (
    <DispatcherShell
      title="Integrations"
      description="See what credentials each app needs and their configuration status across the workspace."
    >
      {!isLoading && apps.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border bg-card p-5">
            <div className="text-sm font-medium text-muted-foreground">
              Apps discovered
            </div>
            <div className="mt-2 text-3xl font-semibold text-foreground">
              {apps.length}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {reachableApps.length} reachable
            </div>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <div className="text-sm font-medium text-muted-foreground">
              Total integrations
            </div>
            <div className="mt-2 text-3xl font-semibold text-foreground">
              {totalIntegrations}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              across all apps
            </div>
          </div>
          <div className="rounded-2xl border bg-card p-5">
            <div className="text-sm font-medium text-muted-foreground">
              Configured
            </div>
            <div className="mt-2 text-3xl font-semibold text-foreground">
              {configuredIntegrations}/{totalIntegrations}
            </div>
            <Progress
              value={
                totalIntegrations > 0
                  ? Math.round(
                      (configuredIntegrations / totalIntegrations) * 100,
                    )
                  : 0
              }
              className="mt-2 h-1.5"
            />
          </div>
        </div>
      )}

      {isLoading && (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          Discovering apps and fetching integration status...
        </div>
      )}

      {reachableApps.length > 0 && (
        <div className="grid gap-4 xl:grid-cols-2">
          {reachableApps.map((app: any) => (
            <AppCard key={app.appId} app={app} />
          ))}
        </div>
      )}

      {unreachableApps.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Offline apps
          </h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {unreachableApps.map((app: any) => (
              <AppCard key={app.appId} app={app} />
            ))}
          </div>
        </div>
      )}

      {!isLoading && apps.length === 0 && (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No workspace apps found.
        </div>
      )}
    </DispatcherShell>
  );
}
