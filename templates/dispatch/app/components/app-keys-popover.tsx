import { useMemo, useState, type ReactNode } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconCheck,
  IconLoader2,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react";
import { toast } from "sonner";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

interface VaultSecret {
  id: string;
  name?: string | null;
  credentialKey: string;
  provider?: string | null;
  description?: string | null;
}

interface VaultGrant {
  id: string;
  secretId: string;
  appId: string;
  status?: string | null;
}

interface AppKeysPopoverProps {
  appId: string;
  appName: string;
  trigger?: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

export function AppKeysPopover({
  appId,
  appName,
  trigger,
  align = "end",
  side = "bottom",
}: AppKeysPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            aria-label={`Manage keys for ${appName}`}
            onClick={(event) => {
              // Card itself is an <a>; stop the link from navigating when the
              // user clicks the cog inside it.
              event.preventDefault();
              event.stopPropagation();
            }}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-transparent text-muted-foreground/70 hover:border-border hover:bg-accent/40 hover:text-foreground"
          >
            <IconSettings size={14} />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        sideOffset={6}
        className="w-80 p-3"
        onClick={(event) => event.stopPropagation()}
      >
        {open ? <AppKeysPanel appId={appId} appName={appName} /> : null}
      </PopoverContent>
    </Popover>
  );
}

function AppKeysPanel({ appId, appName }: { appId: string; appName: string }) {
  const { data: secrets = [], isLoading: secretsLoading } = useActionQuery(
    "list-vault-secret-options",
    {},
  );
  const {
    data: grants = [],
    isLoading: grantsLoading,
    refetch: refetchGrants,
  } = useActionQuery("list-vault-grants", { appId });

  const grantBySecretId = useMemo(() => {
    const map = new Map<string, VaultGrant>();
    for (const grant of grants as VaultGrant[]) {
      if (grant.status && grant.status !== "active") continue;
      map.set(grant.secretId, grant);
    }
    return map;
  }, [grants]);

  // Track per-secret pending state so a fast double-click on the same row
  // can't queue two `create-vault-grant` requests (which would silently
  // create duplicate active grants — a later revoke only clears one).
  const [pendingSecretIds, setPendingSecretIds] = useState<Set<string>>(
    () => new Set(),
  );
  const markPending = (secretId: string, pending: boolean) =>
    setPendingSecretIds((prev) => {
      const next = new Set(prev);
      if (pending) next.add(secretId);
      else next.delete(secretId);
      return next;
    });

  const grantMutation = useActionMutation("create-vault-grant", {
    onSuccess: () => refetchGrants(),
    onError: (err) => toast.error(`Could not grant: ${String(err)}`),
  });

  const revokeMutation = useActionMutation("revoke-vault-grant", {
    onSuccess: () => refetchGrants(),
    onError: (err) => toast.error(`Could not revoke: ${String(err)}`),
  });

  const syncMutation = useActionMutation("sync-vault-to-app", {
    onSuccess: (result: any) => {
      const synced = result?.synced ?? 0;
      toast.success(
        synced > 0
          ? `Synced ${synced} key${synced === 1 ? "" : "s"} to ${appName}`
          : `${appName} is up to date`,
      );
    },
    onError: (err) => toast.error(`Sync failed: ${String(err)}`),
  });

  const isLoading = secretsLoading || grantsLoading;
  const grantedCount = grantBySecretId.size;
  const typedSecrets = secrets as VaultSecret[];

  const toggleSecret = (secret: VaultSecret) => {
    if (pendingSecretIds.has(secret.id)) return;
    const existing = grantBySecretId.get(secret.id);
    markPending(secret.id, true);
    const onSettled = () => markPending(secret.id, false);
    if (existing) {
      revokeMutation.mutate({ grantId: existing.id }, { onSettled });
    } else {
      grantMutation.mutate({ secretId: secret.id, appId }, { onSettled });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            Keys for {appName}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {grantedCount} of {typedSecrets.length} granted
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={syncMutation.isPending || grantedCount === 0}
          onClick={() => syncMutation.mutate({ appId })}
          className="h-7 px-2"
        >
          {syncMutation.isPending ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : (
            <IconRefresh className="h-3 w-3" />
          )}
          <span className="ml-1 text-xs">Sync</span>
        </Button>
      </div>

      <div className="max-h-[320px] space-y-1.5 overflow-y-auto rounded-md border border-border bg-card p-1.5">
        {isLoading ? (
          <p className="px-3 py-3 text-xs text-muted-foreground">Loading…</p>
        ) : typedSecrets.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
            No vault keys yet. Add one from the Vault page.
          </p>
        ) : (
          typedSecrets.map((secret) => {
            const granted = grantBySecretId.has(secret.id);
            const pending = pendingSecretIds.has(secret.id);
            return (
              <button
                key={secret.id}
                type="button"
                aria-pressed={granted}
                disabled={pending}
                onClick={() => toggleSecret(secret)}
                className={`flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-60 ${
                  pending ? "" : "cursor-pointer"
                } ${
                  granted
                    ? "border border-primary/45 bg-primary/5"
                    : "border border-transparent hover:border-muted-foreground/30 hover:bg-accent/35"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    granted
                      ? "border-primary/60 bg-primary/10 text-primary"
                      : "border-muted-foreground/35 text-transparent"
                  }`}
                >
                  {granted ? <IconCheck className="h-3 w-3" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {secret.credentialKey}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground/70">
                    {secret.provider || secret.name || "Vault secret"}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
