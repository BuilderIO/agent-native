import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCheck,
  IconChevronRight,
  IconCircleDashed,
  IconKey,
  IconLink,
  IconPlugConnected,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { DispatchShell } from "@/components/dispatch-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

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
            Used by{" "}
            {service.apps.length === 1
              ? service.apps[0].appName
              : `${service.apps.length} apps`}
            . Saved to the workspace vault and synced to every app that needs
            it.
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
  const isConnected = service.apps.some((a) => a.configured);
  const appCount = service.apps.length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group flex flex-col items-start gap-2 rounded-2xl border bg-card p-5 text-left transition hover:border-foreground/20 hover:bg-card/80 cursor-pointer"
      >
        <div className="flex w-full items-start justify-between gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted">
            <IconKey size={16} className="text-muted-foreground" />
          </div>
          {isConnected ? (
            <Badge
              variant="secondary"
              className="bg-green-500/10 text-green-700 dark:text-green-400 gap-1"
            >
              <IconCheck size={12} />
              Connected
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="bg-amber-500/10 text-amber-700 dark:text-amber-400 gap-1"
            >
              <IconCircleDashed size={12} />
              Connect
            </Badge>
          )}
        </div>
        <div className="w-full min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="text-sm font-semibold text-foreground truncate">
                {service.label}
              </div>
            </TooltipTrigger>
            <TooltipContent>{service.label}</TooltipContent>
          </Tooltip>
          <div className="font-mono text-xs text-muted-foreground/80 truncate">
            {service.key}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Used by {appCount} {appCount === 1 ? "app" : "apps"}
        </div>
      </button>
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
  const { data: catalog, isLoading } = useActionQuery(
    "list-integrations-catalog",
    {},
  );
  const { data: accessSettings } = useActionQuery(
    "get-vault-access-settings",
    {},
  );
  const apps = (catalog as CatalogApp[]) || [];
  const accessMode =
    (accessSettings as any)?.mode === "manual" ? "manual" : "all-apps";

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

  const available = services.filter((s) => !s.apps.some((a) => a.configured));
  const connected = services.filter((s) => s.apps.some((a) => a.configured));

  return (
    <DispatchShell
      title="Connections"
      description="Connect services once. Apps that need them pick up the key automatically."
    >
      {isLoading && services.length === 0 && (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          Discovering apps and credentials…
        </div>
      )}

      {!isLoading && services.length === 0 && (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          No apps with declared integrations are reachable yet.
        </div>
      )}

      {available.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-foreground">
              Available to connect
            </h2>
            <span className="text-xs text-muted-foreground">
              {available.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
            <h2 className="text-sm font-medium text-foreground">Connected</h2>
            <span className="text-xs text-muted-foreground">
              {connected.length}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
        <Collapsible className="mt-6 rounded-2xl border bg-card">
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
              <a href="/vault" className="hover:underline">
                Open vault for advanced sharing
              </a>
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </DispatchShell>
  );
}
