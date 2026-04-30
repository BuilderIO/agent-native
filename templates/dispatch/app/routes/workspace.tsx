import { useState } from "react";
import { useActionMutation, useActionQuery } from "@agent-native/core/client";
import { toast } from "sonner";
import {
  IconBook,
  IconChevronDown,
  IconChevronRight,
  IconCode,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { DispatchShell } from "@/components/dispatch-shell";
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

export function meta() {
  return [{ title: "Workspace Resources — Dispatch" }];
}

const KIND_CONFIG = {
  skill: {
    label: "Skill",
    icon: IconCode,
    pathPrefix: "skills/",
    description: "Agent skills — detailed guidance for patterns and workflows",
  },
  instruction: {
    label: "Instruction",
    icon: IconBook,
    pathPrefix: "",
    description:
      "Agent instructions — operational rules and behavioral guidance",
  },
  agent: {
    label: "Agent",
    icon: IconUser,
    pathPrefix: "agents/",
    description:
      "Reusable agent profiles — specialist agents shared across apps",
  },
} as const;

function AddResourceDialog() {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string>("skill");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [path, setPath] = useState("");
  const [content, setContent] = useState("");
  const [scope, setScope] = useState<string>("all");

  const create = useActionMutation("create-workspace-resource", {
    onSuccess: () => {
      toast.success("Resource created");
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

  const kindInfo = KIND_CONFIG[kind as keyof typeof KIND_CONFIG];

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
            Create a skill, instruction, or agent profile that can be shared
            across workspace apps.
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
                    : "Code Style Guide"
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Path</Label>
            <Input
              placeholder={`${kindInfo?.pathPrefix || ""}${name.toLowerCase().replace(/\s+/g, "-") || "example"}.md`}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className="font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Resource path in target apps. Skills go in skills/, agents in
              agents/.
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
                    : "# Instructions\n\nBehavioral rules and guidance for agents across apps..."
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              className="font-mono text-sm"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              create.mutate({
                kind: kind as "skill" | "instruction" | "agent",
                name,
                description: description || undefined,
                path:
                  path ||
                  `${kindInfo?.pathPrefix || ""}${name.toLowerCase().replace(/\s+/g, "-")}.md`,
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

function ResourceRow({ resource, grants }: { resource: any; grants: any[] }) {
  const [expanded, setExpanded] = useState(false);

  const deleteResource = useActionMutation("delete-workspace-resource", {
    onSuccess: () => toast.success("Resource deleted"),
    onError: (err) => toast.error(String(err)),
  });
  const revokeGrant = useActionMutation("revoke-workspace-resource-grant", {
    onSuccess: () => toast.success("Grant revoked"),
    onError: (err) => toast.error(String(err)),
  });
  const syncToApp = useActionMutation("sync-workspace-resources-to-app", {
    onSuccess: (data: any) =>
      toast.success(`Synced ${data.synced} resource(s) to ${data.appId}`),
    onError: (err) => toast.error(String(err)),
  });

  const kindInfo = KIND_CONFIG[resource.kind as keyof typeof KIND_CONFIG];
  const KindIcon = kindInfo?.icon || IconCode;
  const activeGrants = grants.filter((g) => g.status === "active");

  return (
    <div className="rounded-xl border bg-card">
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
                          {grant.syncedAt
                            ? `synced ${new Date(grant.syncedAt).toLocaleString()}`
                            : "not synced"}
                        </span>
                      </div>
                      <div className="flex gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            syncToApp.mutate({ appId: grant.appId })
                          }
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
            <Button
              variant="destructive"
              size="sm"
              onClick={() => deleteResource.mutate({ id: resource.id })}
              disabled={deleteResource.isPending}
            >
              <IconTrash size={14} className="mr-1" />
              Delete
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkspaceRoute() {
  const { data: resources, isLoading } = useActionQuery(
    "list-workspace-resources",
    {},
  );
  const { data: grants } = useActionQuery("list-workspace-resource-grants", {});

  const syncAll = useActionMutation("sync-workspace-resources-to-all", {
    onSuccess: (data: any) => {
      const total = (data || []).reduce(
        (sum: number, r: any) => sum + r.synced,
        0,
      );
      toast.success(
        `Synced resources to ${data?.length || 0} apps (${total} total pushes)`,
      );
    },
    onError: (err) => toast.error(String(err)),
  });

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

  function ResourceList({
    items,
    emptyText,
  }: {
    items: any[];
    emptyText: string;
  }) {
    if (items.length === 0) {
      return (
        <div className="rounded-2xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
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
      description="Share skills, instructions, and agent profiles across workspace apps. Scope to all apps or grant per-app."
    >
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {isLoading
            ? "Loading..."
            : `${resources?.length || 0} resource${(resources?.length || 0) !== 1 ? "s" : ""}`}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => syncAll.mutate({})}
            disabled={syncAll.isPending || (resources?.length || 0) === 0}
          >
            <IconRefresh
              size={16}
              className={syncAll.isPending ? "mr-1.5 animate-spin" : "mr-1.5"}
            />
            Sync all
          </Button>
          <AddResourceDialog />
        </div>
      </div>

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
      </Tabs>
    </DispatchShell>
  );
}
