import { agentNativePath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useOrgRole } from "@agent-native/core/client/org";
import {
  NewKeyMenu,
  type NewKeyOption,
} from "@agent-native/core/client/settings";
import {
  IconChevronDown,
  IconChevronRight,
  IconEdit,
  IconKey,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ActionQueryError } from "../../components/action-query-error";
import { DispatchShell } from "../../components/dispatch-shell";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../components/ui/alert-dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Skeleton } from "../../components/ui/skeleton";
import { Switch } from "../../components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../components/ui/tabs";
import { Textarea } from "../../components/ui/textarea";

const PROVIDERS = [
  "google",
  "slack",
  "sendgrid",
  "github",
  "stripe",
  "hubspot",
  "jira",
  "bigquery",
  "anthropic",
  "other",
];
const PROVIDER_NONE_VALUE = "__none__";

type VaultAccessMode = "all-apps" | "manual";

export function meta() {
  return [{ title: "Vault — Dispatch" }];
}

function AddSecretDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { credentialKey: string; name?: string };
}) {
  const [credentialKey, setCredentialKey] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCredentialKey(initial?.credentialKey ?? "");
    setName(initial?.name ?? "");
    setValue("");
    setProvider("");
    setDescription("");
    setMoreOpen(false);
  }, [open, initial]);

  const create = useActionMutation("create-vault-secret", {
    onSuccess: () => {
      toast.success("Key added");
      onOpenChange(false);
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add key</DialogTitle>
          <DialogDescription>
            Saved once here, then available to every app in this workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Key</Label>
            <Input
              placeholder="GOOGLE_CLIENT_ID"
              value={credentialKey}
              onChange={(e) => setCredentialKey(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Value</Label>
            <Input
              type="password"
              placeholder="The key value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 h-auto px-2 py-1 text-xs text-muted-foreground"
            onClick={() => setMoreOpen(!moreOpen)}
          >
            {moreOpen ? (
              <IconChevronDown size={14} className="mr-1" />
            ) : (
              <IconChevronRight size={14} className="mr-1" />
            )}
            More options
          </Button>
          {moreOpen && (
            <>
              <div className="space-y-2">
                <Label>Label (optional)</Label>
                <Input
                  placeholder="Google OAuth Client ID"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Description (optional)</Label>
                <Textarea
                  placeholder="What is this key used for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              create.mutate({
                credentialKey,
                name: name.trim() || credentialKey.trim(),
                value,
                provider: provider || undefined,
                description: description || undefined,
              })
            }
            disabled={!credentialKey || !value || create.isPending}
          >
            {create.isPending ? "Adding..." : "Add key"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditSecretDialog({ secret }: { secret: any }) {
  const [open, setOpen] = useState(false);
  const [credentialKey, setCredentialKey] = useState(
    secret.credentialKey || "",
  );
  const [name, setName] = useState(secret.name || "");
  const [value, setValue] = useState("");
  const [provider, setProvider] = useState(secret.provider || "");
  const [description, setDescription] = useState(secret.description || "");
  const [moreOpen, setMoreOpen] = useState(
    !!(secret.provider || secret.description) ||
      (secret.name && secret.name !== secret.credentialKey),
  );

  const update = useActionMutation("update-vault-secret", {
    onSuccess: () => {
      toast.success("Key updated");
      setOpen(false);
    },
    onError: (err) => toast.error(String(err)),
  });

  const resetDraft = () => {
    setCredentialKey(secret.credentialKey || "");
    setName(secret.name || "");
    setValue("");
    setProvider(secret.provider || "");
    setDescription(secret.description || "");
    setMoreOpen(
      !!(secret.provider || secret.description) ||
        (secret.name && secret.name !== secret.credentialKey),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) resetDraft();
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconEdit size={14} className="mr-1" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit key</DialogTitle>
          <DialogDescription>
            Update the stored key and metadata. Changes sync to the shared
            credential store. Leave the value blank to keep the existing key.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate({
              id: secret.id,
              credentialKey,
              name: name.trim() || credentialKey.trim(),
              ...(value ? { value } : {}),
              provider: provider || null,
              description: description || null,
            });
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`vault-secret-key-${secret.id}`}>Key</Label>
            <Input
              id={`vault-secret-key-${secret.id}`}
              value={credentialKey}
              onChange={(e) => setCredentialKey(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`vault-secret-value-${secret.id}`}>
              New value (optional)
            </Label>
            <Input
              id={`vault-secret-value-${secret.id}`}
              type="password"
              placeholder="Enter a new value to rotate it"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2 h-auto px-2 py-1 text-xs text-muted-foreground"
            onClick={() => setMoreOpen(!moreOpen)}
          >
            {moreOpen ? (
              <IconChevronDown size={14} className="mr-1" />
            ) : (
              <IconChevronRight size={14} className="mr-1" />
            )}
            More options
          </Button>
          {moreOpen && (
            <>
              <div className="space-y-2">
                <Label htmlFor={`vault-secret-name-${secret.id}`}>
                  Label (optional)
                </Label>
                <Input
                  id={`vault-secret-name-${secret.id}`}
                  placeholder="Google OAuth Client ID"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Provider</Label>
                <Select
                  value={provider || PROVIDER_NONE_VALUE}
                  onValueChange={(nextProvider) =>
                    setProvider(
                      nextProvider === PROVIDER_NONE_VALUE ? "" : nextProvider,
                    )
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PROVIDER_NONE_VALUE}>
                      No provider
                    </SelectItem>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`vault-secret-description-${secret.id}`}>
                  Description
                </Label>
                <Textarea
                  id={`vault-secret-description-${secret.id}`}
                  placeholder="What is this key used for?"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                />
              </div>
            </>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!credentialKey.trim() || update.isPending}
            >
              {update.isPending ? "Saving..." : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GrantDialog({
  secretId,
  secretName,
}: {
  secretId: string;
  secretName: string;
}) {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const { data: catalog } = useActionQuery("list-integrations-catalog", {});

  const grant = useActionMutation("create-vault-grant", {
    onSuccess: () => {
      toast.success(`Granted to ${appId}`);
      setOpen(false);
      setAppId("");
    },
    onError: (err) => toast.error(String(err)),
  });

  const apps = (catalog || []).map((a: any) => ({
    id: a.appId,
    name: a.appName,
  }));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <IconPlus size={14} className="mr-1" />
          Grant
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant "{secretName}" to an app</DialogTitle>
          <DialogDescription>
            Choose which app should receive this key.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger>
              <SelectValue placeholder="Select an app..." />
            </SelectTrigger>
            <SelectContent>
              {apps.map((app: any) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button
            onClick={() => grant.mutate({ secretId, appId })}
            disabled={!appId || grant.isPending}
          >
            {grant.isPending ? "Granting..." : "Grant access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VaultAccessSettingsCard({ mode }: { mode: VaultAccessMode }) {
  const update = useActionMutation("set-vault-access-settings", {
    onSuccess: (next: any) =>
      toast.success(
        next?.mode === "manual"
          ? "Manual vault access enabled"
          : "All apps can use vault keys",
      ),
    onError: (err) => toast.error(String(err)),
  });
  const allApps = mode !== "manual";

  return (
    <div className="rounded-xl bg-card px-4 py-3">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <Label className="text-sm font-medium">
            All apps can use vault keys
          </Label>
          <p className="mt-1 text-xs text-muted-foreground">
            {allApps
              ? "Every workspace app can receive every saved key."
              : "Only apps with explicit grants can receive saved keys."}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Apps list Vault keys under Settings → API keys. A personal key saved
            there overrides the Vault for that person only.
          </p>
        </div>
        <Switch
          checked={allApps}
          disabled={update.isPending}
          onCheckedChange={(checked) =>
            update.mutate({ mode: checked ? "all-apps" : "manual" })
          }
          aria-label="Allow all workspace apps to use vault keys"
        />
      </div>
    </div>
  );
}

function SecretRow({
  secret,
  grants,
  accessMode,
}: {
  secret: any;
  grants: any[];
  accessMode: VaultAccessMode;
}) {
  const [expanded, setExpanded] = useState(false);

  const deleteSecret = useActionMutation("delete-vault-secret", {
    onSuccess: () => toast.success("Key deleted"),
    onError: (err) => toast.error(String(err)),
  });
  const revokeGrant = useActionMutation("revoke-vault-grant", {
    onSuccess: () => toast.success("Grant revoked"),
    onError: (err) => toast.error(String(err)),
  });
  const syncToApp = useActionMutation("sync-vault-to-app", {
    onSuccess: (data: any) =>
      toast.success(`Synced ${data.synced} key(s) to ${data.appId}`),
    onError: (err) => toast.error(String(err)),
  });

  const activeGrants = grants.filter((g) => g.status === "active");
  const allApps = accessMode !== "manual";

  return (
    <div className="rounded-xl bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? (
          <IconChevronDown size={16} className="text-muted-foreground" />
        ) : (
          <IconChevronRight size={16} className="text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {secret.name}
            </span>
            {secret.provider && (
              <Badge variant="secondary" className="text-xs">
                {secret.provider}
              </Badge>
            )}
          </div>
          {secret.credentialKey !== secret.name && (
            <div className="mt-0.5 font-mono text-xs text-muted-foreground">
              {secret.credentialKey}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {allApps
              ? "All apps"
              : `${activeGrants.length} grant${activeGrants.length !== 1 ? "s" : ""}`}
          </Badge>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {secret.description && (
            <p className="text-sm text-muted-foreground">
              {secret.description}
            </p>
          )}

          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Value:</span>
            <code className="text-xs font-mono text-foreground">
              {secret.last4}
            </code>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                {allApps ? "Access" : "Grants"}
              </span>
              {!allApps && (
                <GrantDialog secretId={secret.id} secretName={secret.name} />
              )}
            </div>
            {allApps ? (
              <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                Available to every workspace app.
              </div>
            ) : activeGrants.length > 0 ? (
              <div className="space-y-1.5">
                {activeGrants.map((grant: any) => (
                  <div
                    key={grant.id}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground">
                        {grant.appId}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {grant.syncedAt
                          ? `synced ${new Date(grant.syncedAt).toLocaleString()}`
                          : "not synced"}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => syncToApp.mutate({ appId: grant.appId })}
                        disabled={syncToApp.isPending}
                      >
                        <IconRefresh size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          revokeGrant.mutate({ grantId: grant.id })
                        }
                        disabled={revokeGrant.isPending}
                      >
                        <IconX size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                No grants yet.
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t pt-3">
            <EditSecretDialog secret={secret} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleteSecret.isPending}
                >
                  <IconTrash size={14} className="mr-1" />
                  Delete key
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this key?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Removing “{secret.name}” revokes all of its grants. Apps
                    that depended on this credential can lose access on the next
                    sync. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteSecret.mutate({ id: secret.id })}
                  >
                    Delete key
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  canManage,
}: {
  request: any;
  canManage: boolean;
}) {
  const [secretValue, setSecretValue] = useState("");

  const approve = useActionMutation("approve-vault-request", {
    onSuccess: () => {
      toast.success("Request approved");
      setSecretValue("");
    },
    onError: (err) => toast.error(String(err)),
  });
  const deny = useActionMutation("deny-vault-request", {
    onSuccess: () => toast.success("Request denied"),
    onError: (err) => toast.error(String(err)),
  });

  return (
    <div className="rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">
            <span className="font-mono">{request.credentialKey}</span> for{" "}
            <span className="font-semibold">{request.appId}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Requested by {request.requestedBy}
            {request.reason && ` — "${request.reason}"`}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {request.status === "pending"
              ? "Pending"
              : request.status === "approved"
                ? `Approved by ${request.reviewedBy}`
                : `Denied by ${request.reviewedBy}`}{" "}
            · {new Date(request.createdAt).toLocaleString()}
          </div>
        </div>
        {request.status === "pending" && (
          <Badge variant="outline" className="whitespace-nowrap">
            Pending
          </Badge>
        )}
        {request.status === "approved" && (
          <Badge
            variant="secondary"
            className="whitespace-nowrap bg-green-500/10 text-green-700 dark:text-green-400"
          >
            Approved
          </Badge>
        )}
        {request.status === "denied" && (
          <Badge
            variant="secondary"
            className="whitespace-nowrap bg-red-500/10 text-red-700 dark:text-red-400"
          >
            Denied
          </Badge>
        )}
      </div>
      {request.status === "pending" && canManage ? (
        <div className="mt-3 flex items-end gap-2 border-t pt-3">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Key value to provision</Label>
            <Input
              type="password"
              placeholder="Enter the key value"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <Button
            size="sm"
            onClick={() => approve.mutate({ id: request.id, secretValue })}
            disabled={!secretValue || approve.isPending}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => deny.mutate({ id: request.id })}
            disabled={deny.isPending}
          >
            Deny
          </Button>
        </div>
      ) : request.status === "pending" ? (
        <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">
          Waiting for a workspace owner or admin to review this request.
        </p>
      ) : null}
    </div>
  );
}

interface RegisteredSecretOption {
  key: string;
  label: string;
  kind: string;
  required?: boolean;
}

interface CatalogIntegration {
  key: string;
  label: string;
  required: boolean;
  secret?: boolean;
}

interface CatalogApp {
  appName: string;
  integrations?: CatalogIntegration[];
}

/**
 * Options offered in the Vault "+ New" picker: Dispatch's own registered
 * API-key secrets plus each workspace app's declared credentials — minus
 * anything already in the vault and minus catalog entries explicitly marked
 * non-credential (`secret === false`), e.g. feature flags or a sender
 * address, which must not be offered as a shared secret to store.
 */
export function buildNewKeyOptions(
  registeredSecrets: RegisteredSecretOption[],
  catalog: CatalogApp[] | undefined,
  vaultKeys: Set<string>,
): NewKeyOption[] {
  const byKey = new Map<string, NewKeyOption>();
  for (const s of registeredSecrets) {
    if (s.kind !== "api-key" || vaultKeys.has(s.key)) continue;
    byKey.set(s.key, { key: s.key, label: s.label, required: s.required });
  }
  for (const app of catalog || []) {
    for (const integration of app.integrations || []) {
      if (
        integration.secret === false ||
        vaultKeys.has(integration.key) ||
        byKey.has(integration.key)
      ) {
        continue;
      }
      byKey.set(integration.key, {
        key: integration.key,
        label: integration.label,
        required: integration.required,
        hint: app.appName,
      });
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export default function VaultRoute() {
  const { org, role, isLoading: orgLoading, error: orgError } = useOrgRole();
  const accessReady = !orgLoading && !orgError && !!org;
  const canManageVault =
    accessReady && (!org.orgId || role === "owner" || role === "admin");
  const secretsQuery = useActionQuery(
    "list-vault-secrets",
    {},
    { enabled: canManageVault },
  );
  const grantsQuery = useActionQuery(
    "list-vault-grants",
    {},
    { enabled: canManageVault },
  );
  const requestsQuery = useActionQuery(
    "list-vault-requests",
    {},
    { enabled: accessReady },
  );
  const auditQuery = useActionQuery(
    "list-vault-audit",
    { limit: 20 },
    { enabled: canManageVault },
  );
  const accessQuery = useActionQuery(
    "get-vault-access-settings",
    {},
    { enabled: accessReady },
  );
  const catalogQuery = useActionQuery(
    "list-integrations-catalog",
    {},
    { enabled: canManageVault },
  );
  const { data: secrets, isLoading: secretsLoading } = secretsQuery;
  const { data: grants } = grantsQuery;
  const { data: requests } = requestsQuery;
  const { data: audit } = auditQuery;
  const { data: accessSettings } = accessQuery;
  const { data: catalog } = catalogQuery;
  const accessMode: VaultAccessMode =
    (accessSettings as any)?.mode === "manual" ? "manual" : "all-apps";

  // Dispatch's own registered API-key secrets, offered in the "+ New" menu
  // alongside keys the workspace apps declare.
  const [registeredSecrets, setRegisteredSecrets] = useState<
    Array<{ key: string; label: string; kind: string; required?: boolean }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    fetch(agentNativePath("/_agent-native/secrets"))
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled) setRegisteredSecrets(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const [addDialogState, setAddDialogState] = useState<{
    open: boolean;
    initial?: { credentialKey: string; name?: string };
  }>({ open: false });

  const vaultKeys = useMemo(
    () => new Set<string>((secrets || []).map((s: any) => s.credentialKey)),
    [secrets],
  );

  const newKeyOptions = useMemo(
    () => buildNewKeyOptions(registeredSecrets, catalog as any[], vaultKeys),
    [registeredSecrets, catalog, vaultKeys],
  );

  const grantsBySecret = (grants || []).reduce(
    (acc: Record<string, any[]>, g: any) => {
      if (!acc[g.secretId]) acc[g.secretId] = [];
      acc[g.secretId].push(g);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  const pendingRequests = (requests || []).filter(
    (r: any) => r.status === "pending",
  );

  return (
    <DispatchShell
      title="Vault"
      description="API keys and credentials saved once for every app in this workspace."
    >
      <Tabs defaultValue="secrets">
        <TabsList>
          <TabsTrigger value="secrets">
            Keys {(secrets?.length || 0) > 0 && `(${secrets?.length})`}
          </TabsTrigger>
          <TabsTrigger value="requests">
            Requests{" "}
            {pendingRequests.length > 0 && (
              <Badge
                variant="secondary"
                className="ml-1.5 h-5 px-1.5 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400"
              >
                {pendingRequests.length}
              </Badge>
            )}
          </TabsTrigger>
          {canManageVault ? (
            <TabsTrigger value="audit">Audit</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="secrets" className="mt-4 space-y-3">
          {!accessReady ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-lg bg-card px-4 py-4">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="mt-2 h-3 w-2/3" />
                </div>
              ))}
            </div>
          ) : !canManageVault ? (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <IconKey size={32} className="mx-auto text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium text-foreground">
                Vault management is restricted
              </h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Workspace owners and admins manage shared key values. Use a
                request from the app that needs a key, and an admin can review
                it from the Requests tab.
              </p>
            </div>
          ) : secretsQuery.isError ||
            grantsQuery.isError ||
            accessQuery.isError ? (
            <ActionQueryError
              error={
                secretsQuery.error ?? grantsQuery.error ?? accessQuery.error
              }
              onRetry={() => {
                void secretsQuery.refetch();
                void grantsQuery.refetch();
                void accessQuery.refetch();
              }}
            />
          ) : null}
          {accessReady && canManageVault ? (
            <>
              <VaultAccessSettingsCard mode={accessMode} />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <IconKey size={16} />
                  {secretsLoading ? (
                    <Skeleton className="h-4 w-20" />
                  ) : (
                    <span>
                      {`${secrets?.length || 0} key${(secrets?.length || 0) !== 1 ? "s" : ""}`}
                    </span>
                  )}
                </div>
                <NewKeyMenu
                  label="New"
                  options={newKeyOptions}
                  onPick={(option) =>
                    setAddDialogState({
                      open: true,
                      initial: {
                        credentialKey: option.key,
                        name: option.label,
                      },
                    })
                  }
                  onCustom={(name) =>
                    setAddDialogState({
                      open: true,
                      initial: { credentialKey: name ?? "" },
                    })
                  }
                  triggerClassName="h-9 px-3 text-sm"
                />
                <AddSecretDialog
                  open={addDialogState.open}
                  onOpenChange={(open) =>
                    setAddDialogState((s) => ({ ...s, open }))
                  }
                  initial={addDialogState.initial}
                />
              </div>

              {!secretsQuery.isError &&
              secretsLoading &&
              (secrets ?? []).length === 0
                ? Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="rounded-2xl bg-card px-5 py-4 space-y-2"
                    >
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))
                : (secrets || []).map((secret: any) => (
                    <SecretRow
                      key={secret.id}
                      secret={secret}
                      grants={grantsBySecret[secret.id] || []}
                      accessMode={accessMode}
                    />
                  ))}

              {!secretsQuery.isError &&
                !secretsLoading &&
                (secrets?.length || 0) === 0 && (
                  <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
                    <IconKey
                      size={32}
                      className="mx-auto text-muted-foreground/50"
                    />
                    <h3 className="mt-3 text-sm font-medium text-foreground">
                      No keys yet
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Use New to add your first key and start sharing
                      credentials across workspace apps.
                    </p>
                  </div>
                )}
            </>
          ) : null}
        </TabsContent>

        <TabsContent value="requests" className="mt-4 space-y-3">
          {requestsQuery.isError ? (
            <ActionQueryError
              error={requestsQuery.error}
              onRetry={() => void requestsQuery.refetch()}
            />
          ) : null}
          {(requests || []).map((request: any) => (
            <RequestRow
              key={request.id}
              request={request}
              canManage={canManageVault}
            />
          ))}
          {!requestsQuery.isError && (requests?.length || 0) === 0 && (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
              No key requests yet.
            </div>
          )}
        </TabsContent>

        {canManageVault ? (
          <TabsContent value="audit" className="mt-4 space-y-2">
            {auditQuery.isError ? (
              <ActionQueryError
                error={auditQuery.error}
                onRetry={() => void auditQuery.refetch()}
              />
            ) : null}
            {(audit || []).map((event: any) => (
              <div
                key={event.id}
                className="rounded-xl border bg-muted/30 px-4 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {event.summary}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {event.actor} · {new Date(event.createdAt).toLocaleString()}
                </div>
              </div>
            ))}
            {!auditQuery.isError && (audit?.length || 0) === 0 && (
              <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                No vault activity yet.
              </div>
            )}
          </TabsContent>
        ) : null}
      </Tabs>
    </DispatchShell>
  );
}
