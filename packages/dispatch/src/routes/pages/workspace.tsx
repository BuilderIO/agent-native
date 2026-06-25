import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import {
  IconAlertCircle,
  IconBook,
  IconChevronDown,
  IconChevronRight,
  IconCircleCheck,
  IconCode,
  IconEdit,
  IconFileText,
  IconPlus,
  IconPlugConnected,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { DispatchShell } from "@/components/dispatch-shell";
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
} from "@/components/ui/alert-dialog";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ImpactPreview,
  workspaceResourceMutationMessage,
} from "@/components/workspace-resource-impact-preview";

export function meta() {
  return [{ title: "Workspace Resources — Dispatch" }];
}

const KIND_CONFIG = {
  skill: {
    label: "Skill",
    icon: IconCode,
    pathPrefix: "skills/",
    description:
      "Agent skills - on-demand guidance available across workspace apps",
  },
  instruction: {
    label: "Instruction",
    icon: IconBook,
    pathPrefix: "instructions/",
    description: "Global instructions - guardrails loaded by every app agent",
  },
  agent: {
    label: "Agent",
    icon: IconUser,
    pathPrefix: "agents/",
    description:
      "Reusable agent profiles - specialist agents shared across apps",
  },
  knowledge: {
    label: "Knowledge",
    icon: IconFileText,
    pathPrefix: "context/",
    description:
      "Reference resources - brand, positioning, persona, and domain context",
  },
  "mcp-server": {
    label: "MCP Server",
    icon: IconPlugConnected,
    pathPrefix: "mcp-servers/",
    description:
      "HTTP MCP servers - external tools centrally granted to app agents",
  },
} as const;

const STARTER_GLOBAL_CONTEXT = [
  {
    path: "context/company.md",
    label: "Company",
    kind: "knowledge",
    description: "Company facts, ICP, products, and canonical links",
  },
  {
    path: "context/brand.md",
    label: "Brand",
    kind: "knowledge",
    description: "Voice, visual identity, naming, and style rules",
  },
  {
    path: "context/messaging.md",
    label: "Messaging",
    kind: "knowledge",
    description: "Positioning, value props, proof points, and objections",
  },
  {
    path: "instructions/guardrails.md",
    label: "Guardrails",
    kind: "instruction",
    description: "Always-on rules loaded by every app agent",
  },
  {
    path: "skills/company-voice/SKILL.md",
    label: "Company Voice",
    kind: "skill",
    description: "On-demand guidance for customer-facing writing",
  },
] as const;

function resourceSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function defaultResourcePath(kind: string, name: string): string {
  const slug = resourceSlug(name) || "example";
  if (kind === "skill") return `skills/${slug}/SKILL.md`;
  if (kind === "instruction") return `instructions/${slug}.md`;
  if (kind === "agent") return `agents/${slug}.md`;
  if (kind === "knowledge") return `context/${slug}.md`;
  if (kind === "mcp-server") return `mcp-servers/${slug}.json`;
  return `${slug}.md`;
}

function isAutoLoadedInstruction(resource: any): boolean {
  return (
    resource.kind === "instruction" &&
    (resource.path === "AGENTS.md" ||
      String(resource.path).startsWith("instructions/"))
  );
}

function formatTimestamp(value?: number | null): string {
  if (!value) return "Not present";
  return new Date(value).toLocaleString();
}

function availabilityLabel(value?: string): string {
  switch (value) {
    case "all-apps":
      return "Inherited by all apps";
    case "selected-granted":
      return "Granted to selected app";
    case "selected-not-granted":
      return "Not granted to this app";
    case "selected-no-app":
      return "Select an app to check grant";
    case "path-not-managed":
      return "Path is not a Dispatch resource";
    default:
      return "Checking availability";
  }
}

function layerState(layer: any): {
  label: string;
  className: string;
} {
  if (layer.effective) {
    return {
      label: "Active",
      className: "border-green-500/30 bg-green-500/10 text-green-700",
    };
  }
  if (layer.overridden) {
    return {
      label: "Overridden",
      className: "border-amber-500/30 bg-amber-500/10 text-amber-700",
    };
  }
  return {
    label: "Missing",
    className: "text-muted-foreground",
  };
}

function EditResourceDialog({
  resource,
  trigger,
}: {
  resource: any;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(resource.name || "");
  const [description, setDescription] = useState(resource.description || "");
  const [content, setContent] = useState(resource.content || "");
  const [scope, setScope] = useState(resource.scope || "all");

  useEffect(() => {
    if (!open) return;
    setName(resource.name || "");
    setDescription(resource.description || "");
    setContent(resource.content || "");
    setScope(resource.scope || "all");
  }, [open, resource]);

  const update = useActionMutation("update-workspace-resource", {
    onSuccess: (result: any) => {
      toast.success(
        workspaceResourceMutationMessage(result, "Resource updated"),
      );
      setOpen(false);
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <IconEdit size={14} className="mr-1.5" />
            Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit workspace resource</DialogTitle>
          <DialogDescription>
            Updates apply immediately anywhere this workspace resource is
            inherited. App shared or personal resources can override it locally.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All apps</SelectItem>
                  <SelectItem value="selected">Selected apps only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Path</Label>
            <Input
              value={resource.path}
              disabled
              className="font-mono text-sm"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={14}
              className="font-mono text-sm"
            />
          </div>
          <ImpactPreview
            operation="update"
            resourceId={resource.id}
            scope={scope as "all" | "selected"}
            enabled={open}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              update.mutate({
                id: resource.id,
                name,
                description,
                content,
                scope: scope as "all" | "selected",
              })
            }
            disabled={!name.trim() || update.isPending}
          >
            {update.isPending ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddResourceDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("skill");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<string>("all");

  const create = useActionMutation("create-workspace-resource", {
    onSuccess: (result: any) => {
      toast.success(
        workspaceResourceMutationMessage(result, "Resource created"),
      );
      setOpen(false);
      setKind("skill");
      setName("");
      setDescription("");
      setPath("");
      setContent("");
      setScope("all");
    },
    onError: (err) => toast.error(String(err)),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <IconPlus size={16} className="mr-1.5" />
          Add resource
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add workspace resource</DialogTitle>
          <DialogDescription>
            Create a skill, instruction, agent profile, reference resource, or
            MCP server that can be shared across workspace apps.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Kind</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skill">Skill</SelectItem>
                  <SelectItem value="instruction">Instruction</SelectItem>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="knowledge">Knowledge pack</SelectItem>
                  <SelectItem value="mcp-server">MCP server</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Scope</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All apps</SelectItem>
                  <SelectItem value="selected">Selected apps only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              placeholder={
                kind === "skill"
                  ? "Frontend Designer"
                  : kind === "agent"
                    ? "Research Specialist"
                    : kind === "knowledge"
                      ? "Core GTM Messaging"
                      : kind === "mcp-server"
                        ? "Zapier MCP"
                        : "Code Style Guide"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Path</Label>
            <Input
              placeholder={defaultResourcePath(kind, name)}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Skills use skills/name/SKILL.md. Guardrails in AGENTS.md or
              instructions/ auto-load in app chat. Reference resources in
              context/ are indexed so agents can read them when relevant. MCP
              server resources use mcp-servers/name.json and are loaded as HTTP
              MCP tools.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Input
              placeholder="Short description of what this resource does"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Content</Label>
            <Textarea
              placeholder={
                kind === "skill"
                  ? "---\nname: my-skill\ndescription: What this skill teaches\n---\n\n# My Skill\n\n..."
                  : kind === "agent"
                    ? "---\nname: Research Specialist\ndescription: Handles research tasks\n---\n\n# Instructions\n\n..."
                    : kind === "knowledge"
                      ? "# Core GTM Messaging\n\n## Positioning\n\n## ICP\n\n## Proof points\n\n## Source\n\n"
                      : kind === "mcp-server"
                        ? '{\n  "type": "http",\n  "url": "https://example.com/mcp",\n  "headers": {\n    "Authorization": "Bearer ${keys.MCP_SERVER_TOKEN}"\n  },\n  "description": "Shared MCP tools for workspace apps"\n}\n'
                        : "# Instructions\n\nAlways-on guardrails for agents across apps..."
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>
          <ImpactPreview
            operation="create"
            path={path || defaultResourcePath(kind, name)}
            scope={scope as "all" | "selected"}
            enabled={open && Boolean(name.trim())}
          />
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              create.mutate({
                kind: kind as
                  | "skill"
                  | "instruction"
                  | "agent"
                  | "knowledge"
                  | "mcp-server",
                name,
                description: description || undefined,
                path: path || defaultResourcePath(kind, name),
                content,
                scope: scope as "all" | "selected",
              })
            }
            disabled={!name || !content || create.isPending}
          >
            {create.isPending ? "Creating..." : "Create resource"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantDialog({
  resourceId,
  resourceName,
}: {
  resourceId: string;
  resourceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState("");
  const { data: catalog } = useActionQuery("list-integrations-catalog", {});

  const grant = useActionMutation("create-workspace-resource-grant", {
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
          <DialogTitle>Grant "{resourceName}" to an app</DialogTitle>
          <DialogDescription>
            Choose which app should receive this resource.
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
            onClick={() => grant.mutate({ resourceId, appId })}
            disabled={!appId || grant.isPending}
          >
            {grant.isPending ? "Granting..." : "Grant access"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EffectiveContextPreview({ resource }: { resource: any }) {
  const [appId, setAppId] = useState("__any__");
  const [userEmail, setUserEmail] = useState("");
  const selectedAppId = appId === "__any__" ? undefined : appId;
  const normalizedUserEmail = userEmail.trim() || undefined;
  const { data: apps } = useActionQuery("list-workspace-apps", {
    includeAgentCards: false,
  });
  const { data: context, isLoading } = useActionQuery(
    "get-workspace-resource-effective-context",
    {
      resourceId: resource.id,
      appId: selectedAppId,
      userEmail: normalizedUserEmail,
    },
  );

  const visibleApps = ((apps || []) as any[]).filter(
    (app) => !app.isDispatch && app.status !== "pending",
  );
  const layers = ((context as any)?.layers || []) as any[];
  const active = (context as any)?.effectiveResource;
  const availability = (context as any)?.availability;

  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-xs font-semibold uppercase text-muted-foreground">
            Effective in app
          </h4>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Preview the runtime stack for this path: workspace default,
            organization/app override, then personal override.
          </p>
        </div>
        <Badge variant="outline">{availabilityLabel(availability)}</Badge>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`resource-app-${resource.id}`}>App</Label>
          <Select value={appId} onValueChange={setAppId}>
            <SelectTrigger id={`resource-app-${resource.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__any__">Any app</SelectItem>
              {visibleApps.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`resource-user-${resource.id}`}>User email</Label>
          <Input
            id={`resource-user-${resource.id}`}
            value={userEmail}
            onChange={(event) => setUserEmail(event.target.value)}
            placeholder="Current Dispatch user"
          />
        </div>
      </div>

      {resource.scope === "selected" ? (
        <div className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
          Selected resources are app-specific exceptions. Use All apps for
          company-wide context that should be inherited everywhere without copy
          or sync.
        </div>
      ) : null}

      {isLoading ? (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {layers.map((layer) => {
            const state = layerState(layer);
            return (
              <div key={layer.scope} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {layer.label}
                  </span>
                  <Badge variant="outline" className={state.className}>
                    {state.label}
                  </Badge>
                </div>
                <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                  {layer.owner}
                </div>
                {layer.resource ? (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div className="truncate font-mono">
                      {layer.resource.path}
                    </div>
                    <div>{formatTimestamp(layer.resource.updatedAt)}</div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    No resource exists at this layer.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        {active ? (
          <>
            Active file:{" "}
            <span className="font-mono text-foreground">
              {active.owner}/{active.path}
            </span>
          </>
        ) : (
          "No active resource exists for this path yet."
        )}
      </div>
    </div>
  );
}

function ResourceRow({ resource, grants }: { resource: any; grants: any[] }) {
  const [expanded, setExpanded] = useState(false);

  const deleteResource = useActionMutation("delete-workspace-resource", {
    onSuccess: (result: any) =>
      toast.success(
        workspaceResourceMutationMessage(result, "Resource deleted"),
      ),
    onError: (err) => toast.error(String(err)),
  });
  const revokeGrant = useActionMutation("revoke-workspace-resource-grant", {
    onSuccess: () => toast.success("Grant revoked"),
    onError: (err) => toast.error(String(err)),
  });

  const kindInfo = KIND_CONFIG[resource.kind as keyof typeof KIND_CONFIG];
  const KindIcon = kindInfo?.icon || IconCode;
  const activeGrants = grants.filter((g) => g.status === "active");

  return (
    <div className="rounded-lg border bg-card">
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
        <KindIcon size={16} className="text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">
              {resource.name}
            </span>
            <Badge variant="secondary" className="text-xs">
              {kindInfo?.label || resource.kind}
            </Badge>
            <Badge
              variant="outline"
              className={
                resource.scope === "all"
                  ? "text-xs bg-green-500/10 text-green-700 dark:text-green-400"
                  : "text-xs"
              }
            >
              {resource.scope === "all" ? "All apps" : "Selected"}
            </Badge>
            {isAutoLoadedInstruction(resource) && (
              <Badge variant="outline" className="text-xs">
                Auto-loaded
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-xs text-muted-foreground">
            {resource.path}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {resource.scope === "selected" && (
            <Badge variant="outline" className="text-xs">
              {activeGrants.length} grant
              {activeGrants.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {resource.description && (
            <p className="text-sm text-muted-foreground">
              {resource.description}
            </p>
          )}

          <div className="rounded-lg border bg-muted/30 p-3">
            <pre className="whitespace-pre-wrap text-xs font-mono text-foreground max-h-64 overflow-y-auto">
              {resource.content}
            </pre>
          </div>

          <EffectiveContextPreview resource={resource} />

          {resource.scope === "selected" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  Grants
                </span>
                <GrantDialog
                  resourceId={resource.id}
                  resourceName={resource.name}
                />
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
                          selected grant
                        </span>
                      </div>
                      <div className="flex gap-1.5">
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
                  No grants yet. Grant this resource to specific apps.
                </div>
              )}
            </div>
          )}

          <div className="flex justify-between border-t pt-3">
            <div className="text-xs text-muted-foreground">
              Created by {resource.createdBy} ·{" "}
              {new Date(resource.createdAt).toLocaleString()}
            </div>
            <div className="flex gap-2">
              <EditResourceDialog resource={resource} />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleteResource.isPending}
                  >
                    <IconTrash size={14} className="mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this resource?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Removing "{resource.name}" revokes all of its grants and
                      removes inherited workspace access immediately. This
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <ImpactPreview
                    operation="delete"
                    resourceId={resource.id}
                    enabled
                  />
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => deleteResource.mutate({ id: resource.id })}
                    >
                      Delete resource
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GlobalContextSection({ resources }: { resources: any[] }) {
  const byPath = new Map(
    resources.map((resource) => [resource.path, resource]),
  );
  const missingPaths = STARTER_GLOBAL_CONTEXT.filter(
    (item) => !byPath.has(item.path),
  ).map((item) => item.path);
  const presentCount = STARTER_GLOBAL_CONTEXT.length - missingPaths.length;
  const restoreStarter = useActionMutation(
    "restore-starter-workspace-resources",
    {
      onSuccess: (result: any) => {
        const restored = result?.restored?.length ?? 0;
        const existing = result?.existing?.length ?? 0;
        toast.success(
          restored > 0
            ? `Restored ${restored} starter resource${restored === 1 ? "" : "s"}`
            : `Starter resources already present (${existing})`,
        );
      },
      onError: (err) => toast.error(String(err)),
    },
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Global context
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Starter resources every workspace can use for company facts, brand,
            messaging, guardrails, and voice.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            All-app resources live once at workspace scope and are inherited by
            every app agent at runtime.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {missingPaths.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => restoreStarter.mutate({ paths: missingPaths })}
              disabled={restoreStarter.isPending}
            >
              <IconPlus size={14} className="mr-1.5" />
              {restoreStarter.isPending ? "Restoring..." : "Restore missing"}
            </Button>
          ) : null}
          <Badge variant="outline">
            {presentCount}/{STARTER_GLOBAL_CONTEXT.length} ready
          </Badge>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {STARTER_GLOBAL_CONTEXT.map((item) => {
          const resource = byPath.get(item.path);
          const exists = !!resource;
          const global = resource?.scope === "all";
          return (
            <div key={item.path} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {exists ? (
                      <IconCircleCheck
                        size={15}
                        className="shrink-0 text-green-600 dark:text-green-400"
                      />
                    ) : (
                      <IconAlertCircle
                        size={15}
                        className="shrink-0 text-amber-600 dark:text-amber-400"
                      />
                    )}
                    <h3 className="truncate text-sm font-medium text-foreground">
                      {item.label}
                    </h3>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {item.description}
                  </p>
                </div>
                {resource ? (
                  <EditResourceDialog
                    resource={resource}
                    trigger={
                      <Button variant="ghost" size="sm" className="h-7 px-2">
                        <span className="sr-only">Edit {item.label}</span>
                        <IconEdit size={14} />
                      </Button>
                    }
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2"
                    onClick={() =>
                      restoreStarter.mutate({ paths: [item.path] })
                    }
                    disabled={restoreStarter.isPending}
                    aria-label={`Restore ${item.label}`}
                  >
                    <IconPlus size={14} />
                  </Button>
                )}
              </div>
              <div className="mt-3 space-y-2">
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {item.path}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={exists ? "secondary" : "outline"}>
                    {exists ? "Present" : "Missing"}
                  </Badge>
                  {exists ? (
                    <Badge variant="outline">
                      {global ? "All apps" : "Selected"}
                    </Badge>
                  ) : null}
                  {resource && isAutoLoadedInstruction(resource) ? (
                    <Badge variant="outline">Auto-loaded</Badge>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function WorkspaceRoute() {
  const { data: resources, isLoading } = useActionQuery(
    "list-workspace-resources",
    {},
  );
  const { data: grants } = useActionQuery("list-workspace-resource-grants", {});

  const grantsByResource = (grants || []).reduce(
    (acc: Record<string, any[]>, g: any) => {
      if (!acc[g.resourceId]) acc[g.resourceId] = [];
      acc[g.resourceId].push(g);
      return acc;
    },
    {} as Record<string, any[]>,
  );

  const skills = (resources || []).filter((r: any) => r.kind === "skill");
  const instructions = (resources || []).filter(
    (r: any) => r.kind === "instruction",
  );
  const agents = (resources || []).filter((r: any) => r.kind === "agent");
  const knowledge = (resources || []).filter(
    (r: any) => r.kind === "knowledge",
  );
  const mcpServers = (resources || []).filter(
    (r: any) => r.kind === "mcp-server",
  );

  function ResourceList({
    items,
    emptyText,
  }: {
    items: any[];
    emptyText: string;
  }) {
    if (isLoading && (resources ?? []).length === 0) {
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="rounded-lg border bg-card px-5 py-4 space-y-2"
            >
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          ))}
        </div>
      );
    }
    if (items.length === 0) {
      return (
        <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
          {emptyText}
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {items.map((resource: any) => (
          <ResourceRow
            key={resource.id}
            resource={resource}
            grants={grantsByResource[resource.id] || []}
          />
        ))}
      </div>
    );
  }

  return (
    <DispatchShell
      title="Workspace Resources"
      description="Manage inherited workspace skills, guardrail instructions, agent profiles, reference resources, and MCP servers. All-app resources are available to every app without syncing."
    >
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {isLoading ? (
            <Skeleton className="h-4 w-24" />
          ) : (
            `${resources?.length || 0} resource${(resources?.length || 0) !== 1 ? "s" : ""}`
          )}
        </div>
        <div className="flex gap-2">
          <AddResourceDialog />
        </div>
      </div>

      <GlobalContextSection resources={resources || []} />

      <Tabs defaultValue="skills">
        <TabsList>
          <TabsTrigger value="skills">
            Skills {skills.length > 0 && `(${skills.length})`}
          </TabsTrigger>
          <TabsTrigger value="instructions">
            Instructions {instructions.length > 0 && `(${instructions.length})`}
          </TabsTrigger>
          <TabsTrigger value="agents">
            Agents {agents.length > 0 && `(${agents.length})`}
          </TabsTrigger>
          <TabsTrigger value="knowledge">
            Knowledge {knowledge.length > 0 && `(${knowledge.length})`}
          </TabsTrigger>
          <TabsTrigger value="mcp">
            MCP {mcpServers.length > 0 && `(${mcpServers.length})`}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="skills" className="mt-4">
          <ResourceList
            items={skills}
            emptyText="No workspace skills yet. Add a skill to share agent guidance across apps."
          />
        </TabsContent>

        <TabsContent value="instructions" className="mt-4">
          <ResourceList
            items={instructions}
            emptyText="No workspace instructions yet. Add instructions to set behavioral rules across apps."
          />
        </TabsContent>

        <TabsContent value="agents" className="mt-4">
          <ResourceList
            items={agents}
            emptyText="No workspace agents yet. Add a reusable agent profile to share specialist agents across apps."
          />
        </TabsContent>

        <TabsContent value="knowledge" className="mt-4">
          <ResourceList
            items={knowledge}
            emptyText="No knowledge packs yet. Add GTM, product, or domain context that apps can reuse."
          />
        </TabsContent>

        <TabsContent value="mcp" className="mt-4">
          <ResourceList
            items={mcpServers}
            emptyText="No workspace MCP servers yet. Add an HTTP MCP server to share external tools across apps."
          />
        </TabsContent>
      </Tabs>
    </DispatchShell>
  );
}
