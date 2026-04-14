import { useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconChevronDown,
  IconChevronRight,
  IconEye,
  IconEyeOff,
  IconKey,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { DispatcherShell } from "@/components/dispatcher-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

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

export function meta() {
  return [{ title: "Vault — Dispatcher" }];
}

function AddSecretDialog() {
  const [open, setOpen] = useState(false);
  const [credentialKey, setCredentialKey] = useState("");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [provider, setProvider] = useState("");
  const [description, setDescription] = useState("");

  const create = useActionMutation("create-vault-secret", {
    onSuccess: () => {
      toast.success("Secret created");
      setOpen(false);
      setCredentialKey("");
      setName("");
      setValue("");
      setProvider("");
      setDescription("");
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <IconPlus size={16} className="mr-1.5" />
          Add secret
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add vault secret</DialogTitle>
          <DialogDescription>
            Store a credential that can be granted to workspace apps.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder="Google OAuth Client ID"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Credential key (env var name)</Label>
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
              placeholder="The secret value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
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
              placeholder="What is this secret used for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              create.mutate({
                credentialKey,
                name,
                value,
                provider: provider || undefined,
                description: description || undefined,
              })
            }
            disabled={!credentialKey || !name || !value || create.isPending}
          >
            {create.isPending ? "Creating..." : "Create secret"}
          </Button>
        </DialogFooter>
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
            Choose which app should receive this secret.
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

function SecretRow({ secret, grants }: { secret: any; grants: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const [showValue, setShowValue] = useState(false);

  const deleteSecret = useActionMutation("delete-vault-secret", {
    onSuccess: () => toast.success("Secret deleted"),
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

  return (
    <div className="rounded-xl border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
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
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {secret.credentialKey}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {activeGrants.length} grant{activeGrants.length !== 1 ? "s" : ""}
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
              {showValue ? secret.value : "••••••••••••"}
            </code>
            <button
              type="button"
              onClick={() => setShowValue(!showValue)}
              className="text-muted-foreground hover:text-foreground"
            >
              {showValue ? <IconEyeOff size={14} /> : <IconEye size={14} />}
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground">
                Grants
              </span>
              <GrantDialog secretId={secret.id} secretName={secret.name} />
            </div>
            {activeGrants.length > 0 ? (
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
                No grants yet. Grant this secret to an app to share it.
              </div>
            )}
          </div>

          <div className="flex justify-end border-t pt-3">
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteSecret.mutate({ id: secret.id })}
              disabled={deleteSecret.isPending}
            >
              <IconTrash size={14} className="mr-1" />
              Delete secret
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({ request }: { request: any }) {
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
      {request.status === "pending" && (
        <div className="mt-3 flex items-end gap-2 border-t pt-3">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Secret value to provision</Label>
            <Input
              type="password"
              placeholder="Enter the secret value"
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
      )}
    </div>
  );
}

export default function VaultRoute() {
  const { data: secrets, isLoading: secretsLoading } = useActionQuery(
    "list-vault-secrets",
    {},
  );
  const { data: grants } = useActionQuery("list-vault-grants", {});
  const { data: requests } = useActionQuery("list-vault-requests", {});
  const { data: audit } = useActionQuery("list-vault-audit", { limit: 20 });

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
    <DispatcherShell
      title="Vault"
      description="Centralized secret management for your workspace. Store credentials once, grant them to apps."
    >
      <Tabs defaultValue="secrets">
        <TabsList>
          <TabsTrigger value="secrets">
            Secrets {(secrets?.length || 0) > 0 && `(${secrets?.length})`}
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
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="secrets" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <IconKey size={16} />
              <span>
                {secretsLoading
                  ? "Loading..."
                  : `${secrets?.length || 0} secret${(secrets?.length || 0) !== 1 ? "s" : ""}`}
              </span>
            </div>
            <AddSecretDialog />
          </div>

          {(secrets || []).map((secret: any) => (
            <SecretRow
              key={secret.id}
              secret={secret}
              grants={grantsBySecret[secret.id] || []}
            />
          ))}

          {!secretsLoading && (secrets?.length || 0) === 0 && (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
              <IconKey size={32} className="mx-auto text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-medium text-foreground">
                No secrets yet
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your first secret to start sharing credentials across
                workspace apps.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="requests" className="mt-4 space-y-3">
          {(requests || []).map((request: any) => (
            <RequestRow key={request.id} request={request} />
          ))}
          {(requests?.length || 0) === 0 && (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
              No secret requests yet.
            </div>
          )}
        </TabsContent>

        <TabsContent value="audit" className="mt-4 space-y-2">
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
          {(audit?.length || 0) === 0 && (
            <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
              No vault activity yet.
            </div>
          )}
        </TabsContent>
      </Tabs>
    </DispatcherShell>
  );
}
