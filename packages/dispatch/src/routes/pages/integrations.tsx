import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import {
  getDefaultMcpIntegrations,
  McpIntegrationLogo,
} from "@agent-native/core/client/resources";
import {
  IconChevronRight,
  IconLink,
  IconPlugConnected,
  IconSearch,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import { Button } from "../../components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Skeleton } from "../../components/ui/skeleton";

export function meta() {
  return [{ title: "Connections — Dispatch" }];
}

interface AppRef {
  appId: string;
  appName: string;
  color: string;
  configured: boolean;
  vaultGranted: boolean;
  vaultSecretId?: string;
}

interface Service {
  /** Credential key shared across apps (e.g. `OPENAI_API_KEY`). */
  key: string;
  /** Human label from the first app that declares it (`"OpenAI"`, `"Stripe"`). */
  label: string;
  /** Apps in the workspace that declare this credential. */
  apps: AppRef[];
}

interface CatalogApp {
  appId: string;
  appName: string;
  color: string;
  url: string;
  reachable: boolean;
  integrations?: Array<{
    key: string;
    label: string;
    required: boolean;
    configured: boolean;
    vaultGranted: boolean;
    vaultSecretId?: string;
  }>;
}

function inferProviderFromKey(key: string, label: string): string {
  const haystack = `${key} ${label}`.toLowerCase();
  for (const provider of [
    "google",
    "slack",
    "sendgrid",
    "github",
    "stripe",
    "hubspot",
    "jira",
    "bigquery",
    "anthropic",
    "openai",
  ]) {
    if (haystack.includes(provider)) return provider;
  }
  return "other";
}

const MCP_INTEGRATIONS_BY_ID = new Map(
  getDefaultMcpIntegrations().map((integration) => [
    integration.id,
    integration,
  ]),
);

const CREDENTIAL_PROVIDER_LOGO_IDS: Record<string, string> = {
  google: "google-workspace",
  bigquery: "google-workspace",
  jira: "atlassian",
};

function credentialLogo(service: Service) {
  const providerId = inferProviderFromKey(service.key, service.label);
  const integration = MCP_INTEGRATIONS_BY_ID.get(
    CREDENTIAL_PROVIDER_LOGO_IDS[providerId] ?? providerId,
  );
  if (!integration?.logoUrl) {
    return <IconPlugConnected className="size-4 text-muted-foreground" />;
  }
  return (
    <McpIntegrationLogo
      name={service.label}
      logoUrl={integration.logoUrl}
      integrationId={integration.id}
      className="size-full rounded-md border-0 bg-transparent"
      imageClassName="size-full p-1"
    />
  );
}

function ConnectDialog({
  service,
  open,
  onOpenChange,
  accessMode,
}: {
  service: Service;
  open: boolean;
  onOpenChange: (next: boolean) => void;
  accessMode: "all-apps" | "manual";
}) {
  const [value, setValue] = useState("");
  const qc = useQueryClient();
  const configuredApps = service.apps.filter((app) => app.configured);
  const configuredAppNames = configuredApps
    .map((app) => app.appName)
    .join(", ");

  const createSecret = useActionMutation("create-vault-secret", {});
  const createGrant = useActionMutation("create-vault-grant", {});
  const syncToApp = useActionMutation("sync-vault-to-app", {});

  function reset() {
    setValue("");
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      toast.error("Enter a value to save");
      return;
    }
    try {
      // 1. Create the secret (or get the existing one — server treats key as
      // the unique identifier). The server returns { secret: { id, ... } }.
      const created = await createSecret.mutateAsync({
        credentialKey: service.key,
        name: service.label,
        value: trimmed,
        provider: inferProviderFromKey(service.key, service.label),
      });
      const secretId =
        (created as { secret?: { id?: string } })?.secret?.id ??
        (created as { id?: string })?.id;
      if (!secretId) {
        throw new Error("Secret created but id missing");
      }

      // 2. Manual mode needs grants; all-apps mode only needs sync.
      if (accessMode === "manual") {
        const targets = service.apps.filter((a) => !a.vaultGranted);
        for (const app of targets) {
          try {
            await createGrant.mutateAsync({
              secretId,
              appId: app.appId,
            });
          } catch (err) {
            console.warn(`grant to ${app.appId} failed`, err);
          }
        }
      }
      for (const app of service.apps) {
        try {
          await syncToApp.mutateAsync({ appId: app.appId });
        } catch (err) {
          console.warn(`sync to ${app.appId} failed`, err);
        }
      }

      qc.invalidateQueries({
        queryKey: ["action", "list-integrations-catalog"],
      });
      toast.success(`Connected ${service.label}`);
      onOpenChange(false);
      reset();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to save credential");
    }
  }

  const pending =
    createSecret.isPending || createGrant.isPending || syncToApp.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect {service.label}</DialogTitle>
          <DialogDescription>
            {configuredApps.length > 0
              ? `Configured in ${configuredAppNames}. `
              : "No app currently reports this key as configured. "}
            Saving it creates a workspace vault entry using this exact key name.
            Apps need the same key name to use it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">Key</Label>
            <div className="font-mono text-sm">{service.key}</div>
          </div>
          <div>
            <Label htmlFor="connector-value">Value</Label>
            <Input
              id="connector-value"
              type="password"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={`Paste your ${service.label} key…`}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={pending || !value.trim()}>
            {pending ? "Saving…" : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConnectorCard({
  service,
  accessMode,
}: {
  service: Service;
  accessMode: "all-apps" | "manual";
}) {
  const [open, setOpen] = useState(false);
  const configuredApps = service.apps.filter((app) => app.configured);
  const vaultApps = service.apps.filter((app) => app.vaultGranted);
  const isAvailable = configuredApps.length > 0 || vaultApps.length > 0;
  const configuredAppNames = configuredApps
    .map((app) => app.appName)
    .join(", ");
  const vaultAppNames = vaultApps.map((app) => app.appName).join(", ");

  return (
    <>
      <article className="flex min-w-0 items-center gap-3 border-b border-border/60 py-3.5 last:border-b-0">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
          {credentialLogo(service)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-foreground">
              {service.label}
            </span>
            <span
              className={
                isAvailable
                  ? "shrink-0 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
                  : "shrink-0 text-[11px] font-medium text-muted-foreground"
              }
            >
              {vaultApps.length > 0 ? "Connected" : "App key"}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[11px] leading-5 text-muted-foreground/80">
            {service.key}
          </p>
          <p className="mt-0.5 truncate text-xs leading-5 text-muted-foreground">
            Declared by {service.apps.length}{" "}
            {service.apps.length === 1 ? "app" : "apps"}
            {configuredApps.length > 0 ? ` · ${configuredAppNames}` : ""}
            {vaultApps.length > 0 ? ` · Vault: ${vaultAppNames}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {isAvailable ? "Manage" : "Connect"}
          <IconChevronRight className="size-3.5 rtl:-scale-x-100" />
        </button>
      </article>
      <ConnectDialog
        service={service}
        open={open}
        onOpenChange={setOpen}
        accessMode={accessMode}
      />
    </>
  );
}

function PerAppDetailRow({ app }: { app: CatalogApp }) {
  const total = (app.integrations ?? []).length;
  const ok = (app.integrations ?? []).filter((i) => i.configured).length;
  return (
    <div className="flex items-center justify-between border-t px-4 py-2.5 first:border-t-0">
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="h-5 w-5 rounded text-[10px] font-bold text-white flex items-center justify-center shrink-0"
          style={{ backgroundColor: app.color }}
        >
          {app.appName.charAt(0).toUpperCase()}
        </div>
        <span className="text-sm truncate">{app.appName}</span>
        {!app.reachable && (
          <span className="text-xs text-muted-foreground">offline</span>
        )}
      </div>
      <span className="text-xs text-muted-foreground">
        {total === 0 ? "no integrations" : `${ok}/${total}`}
      </span>
    </div>
  );
}

export default function ConnectionsRoute() {
  const catalogQuery = useActionQuery("list-integrations-catalog", {});
  const accessQuery = useActionQuery("get-vault-access-settings", {});
  const { data: catalog } = catalogQuery;
  const { data: accessSettings } = accessQuery;
  const isLoading = catalogQuery.isLoading || accessQuery.isLoading;
  const apps = (catalog as CatalogApp[]) || [];
  const accessMode =
    (accessSettings as any)?.mode === "manual" ? "manual" : "all-apps";
  const [query, setQuery] = useState("");

  const services = useMemo<Service[]>(() => {
    const map = new Map<string, Service>();
    for (const app of apps) {
      for (const intg of app.integrations ?? []) {
        if (!map.has(intg.key)) {
          map.set(intg.key, {
            key: intg.key,
            label: intg.label,
            apps: [],
          });
        }
        map.get(intg.key)!.apps.push({
          appId: app.appId,
          appName: app.appName,
          color: app.color,
          configured: intg.configured,
          vaultGranted: intg.vaultGranted,
          vaultSecretId: intg.vaultSecretId,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [apps]);

  const filteredServices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return services;
    return services.filter(
      (service) =>
        service.label.toLowerCase().includes(normalized) ||
        service.key.toLowerCase().includes(normalized),
    );
  }, [query, services]);
  const available = filteredServices.filter(
    (s) => !s.apps.some((a) => a.configured),
  );
  const connected = filteredServices.filter((s) =>
    s.apps.some((a) => a.configured),
  );

  return (
    <DispatchShell
      title="Connections"
      description="Connect workspace credentials declared by apps and manage how they are shared."
    >
      {catalogQuery.isError || accessQuery.isError ? (
        <ActionQueryError
          error={catalogQuery.error ?? accessQuery.error}
          onRetry={() => {
            void catalogQuery.refetch();
            void accessQuery.refetch();
          }}
        />
      ) : null}

      {!catalogQuery.isError && !isLoading ? (
        <div className="mb-5 flex items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <IconSearch className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search credentials"
              aria-label="Search credentials"
              className="h-9 ps-9"
            />
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {filteredServices.length} credential
            {filteredServices.length === 1 ? "" : "s"}
          </span>
        </div>
      ) : null}

      {!catalogQuery.isError && isLoading && services.length === 0 && (
        <div className="overflow-hidden rounded-lg bg-card">
          {Array.from({ length: 7 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0"
            >
              <Skeleton className="size-8 rounded-md" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="mt-1.5 h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
      )}

      {!catalogQuery.isError && !isLoading && services.length === 0 && (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No apps with declared integrations are reachable yet.
        </div>
      )}

      {available.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Not configured in apps
            </h2>
            <span className="text-xs text-muted-foreground">
              {available.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg bg-card">
            {available.map((service) => (
              <ConnectorCard
                key={service.key}
                service={service}
                accessMode={accessMode}
              />
            ))}
          </div>
        </section>
      )}

      {connected.length > 0 && (
        <section>
          <div className="mb-3 mt-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Configured in apps
            </h2>
            <span className="text-xs text-muted-foreground">
              {connected.length}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg bg-card">
            {connected.map((service) => (
              <ConnectorCard
                key={service.key}
                service={service}
                accessMode={accessMode}
              />
            ))}
          </div>
        </section>
      )}

      {apps.length > 0 && (
        <Collapsible className="mt-6 rounded-2xl bg-card">
          <CollapsibleTrigger className="group flex w-full items-center justify-between px-4 py-3 text-sm">
            <span className="flex items-center gap-2 text-muted-foreground">
              <IconPlugConnected size={14} />
              Per-app status
            </span>
            <IconChevronRight
              size={14}
              className="text-muted-foreground transition group-data-[state=open]:rotate-90"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="border-t">
              {apps.map((app) => (
                <PerAppDetailRow key={app.appId} app={app} />
              ))}
            </div>
            <div className="flex items-center justify-end gap-1.5 border-t px-4 py-2.5 text-xs text-muted-foreground">
              <IconLink size={12} />
              <Link to="/admin/vault" className="hover:underline">
                Open vault for advanced sharing
              </Link>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </DispatchShell>
  );
}
