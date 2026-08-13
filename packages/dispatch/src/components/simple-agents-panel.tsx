import {
  navigateWithAgentChatViewTransition,
  sendToAgentChat,
} from "@agent-native/core/client/agent-chat";
import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { parseCustomAgentProfile } from "@agent-native/core/resources/metadata";
import {
  IconAdjustmentsHorizontal,
  IconChevronDown,
  IconEdit,
  IconFileImport,
  IconLayoutGrid,
  IconMessageCircle,
  IconPlugConnected,
  IconPlus,
  IconTrash,
  IconUpload,
  IconUser,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  buildSimpleAgentContent,
  slugifyAgentName,
} from "../lib/simple-agent-profile.js";
import { ActionQueryError } from "./action-query-error";
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
} from "./ui/alert-dialog";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Textarea } from "./ui/textarea";

interface WorkspaceAgentResource {
  id: string;
  name: string;
  description: string | null;
  path: string;
  content: string;
  scope: "all" | "selected";
  updatedAt: number;
}

interface AgentEditorProps {
  resource?: WorkspaceAgentResource;
  trigger?: ReactNode;
  onSaved?: () => void;
}

function profileFields(resource?: WorkspaceAgentResource) {
  if (!resource) {
    return {
      name: "",
      description: "",
      instructions: "# Role\n\nDescribe how this agent should work.\n",
      model: "inherit",
      tools: "inherit",
      scope: "all" as const,
    };
  }

  const profile = parseCustomAgentProfile(resource.content, resource.path);
  return {
    name: profile?.name || resource.name,
    description: profile?.description || resource.description || "",
    instructions: profile?.instructions || resource.content,
    model: profile?.model || "inherit",
    tools: profile?.tools || "inherit",
    scope: resource.scope,
  };
}

function AgentEditorDialog({ resource, trigger, onSaved }: AgentEditorProps) {
  const isEditing = Boolean(resource);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [model, setModel] = useState("inherit");
  const [tools, setTools] = useState("inherit");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fields = profileFields(resource);
    setName(fields.name);
    setDescription(fields.description);
    setInstructions(fields.instructions);
    setModel(fields.model);
    setTools(fields.tools);
    setScope(fields.scope);
    setAdvancedOpen(fields.model !== "inherit" || fields.tools !== "inherit");
  }, [open, resource]);

  const create = useActionMutation("create-workspace-resource", {
    onSuccess: () => {
      toast.success("Agent created");
      setOpen(false);
      onSaved?.();
    },
    onError: (error) => toast.error(error.message),
  });
  const update = useActionMutation("update-workspace-resource", {
    onSuccess: () => {
      toast.success("Agent updated");
      setOpen(false);
      onSaved?.();
    },
    onError: (error) => toast.error(error.message),
  });

  const pending = create.isPending || update.isPending;
  const canSave = Boolean(name.trim() && instructions.trim() && !pending);

  function save() {
    const content = buildSimpleAgentContent({
      name,
      description,
      model,
      tools,
      instructions,
    });
    if (resource) {
      update.mutate({
        id: resource.id,
        name: name.trim(),
        description: description.trim(),
        content,
        scope,
      });
      return;
    }
    create.mutate({
      kind: "agent",
      name: name.trim(),
      description: description.trim() || undefined,
      path: `agents/${slugifyAgentName(name)}.md`,
      content,
      scope,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <IconPlus size={16} />
            Create agent
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Manage agent" : "Create agent"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="simple-agent-name">Name</Label>
              <Input
                id="simple-agent-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="User Research"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="simple-agent-scope">Availability</Label>
              <Select
                value={scope}
                onValueChange={(value: "all" | "selected") => setScope(value)}
              >
                <SelectTrigger id="simple-agent-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All apps</SelectItem>
                  <SelectItem value="selected">Selected apps</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="simple-agent-description">Description</Label>
            <Input
              id="simple-agent-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Synthesizes user research into clear insights"
            />
          </div>
          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="group -ml-2 gap-1.5 text-muted-foreground"
              >
                <IconAdjustmentsHorizontal size={15} />
                Advanced
                <IconChevronDown
                  className="transition-transform group-data-[state=open]:rotate-180"
                  size={15}
                />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="simple-agent-model">Model</Label>
                  <Input
                    id="simple-agent-model"
                    value={model}
                    onChange={(event) => setModel(event.target.value)}
                    placeholder="inherit"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="simple-agent-tools">Tools</Label>
                  <Input
                    id="simple-agent-tools"
                    value={tools}
                    onChange={(event) => setTools(event.target.value)}
                    placeholder="inherit"
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-2">
            <Label htmlFor="simple-agent-instructions">Instructions</Label>
            <Textarea
              id="simple-agent-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              rows={12}
              className="font-mono text-sm"
              placeholder="# Role\n\nDescribe how this agent should work."
            />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={!canSave}>
            {pending
              ? "Saving..."
              : isEditing
                ? "Save changes"
                : "Create agent"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ImportAgentDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "endpoint">("file");
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [url, setUrl] = useState("");
  const [endpointName, setEndpointName] = useState("");
  const [endpointDescription, setEndpointDescription] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const importAgent = useActionMutation("import-agent", {
    onSuccess: (result: { status: string; warnings?: string[] }) => {
      toast.success(
        result.status === "unchanged"
          ? "Agent already imported"
          : "Agent imported",
      );
      if (result.warnings?.length) {
        toast.info(result.warnings.join(" "));
      }
      setOpen(false);
      onImported?.();
    },
    onError: (error) => toast.error(error.message),
  });
  const connect = useActionMutation("connect-external-agent", {
    onSuccess: () => {
      toast.success("Agent connected");
      setOpen(false);
      onImported?.();
    },
    onError: (error) => toast.error(error.message),
  });

  function reset() {
    setMode("file");
    setSource("");
    setFileName("");
    setScope("all");
    setUrl("");
    setEndpointName("");
    setEndpointDescription("");
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSource(await file.text());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <IconFileImport size={16} />
          Import or connect
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import an agent</DialogTitle>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as "file" | "endpoint")}
        >
          <TabsList className="w-full justify-start">
            <TabsTrigger value="file">Agent file</TabsTrigger>
            <TabsTrigger value="endpoint">Connect endpoint</TabsTrigger>
          </TabsList>
          <TabsContent value="file" className="space-y-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => fileRef.current?.click()}
              >
                <IconUpload size={16} />
                Choose file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.json,.txt"
                className="hidden"
                onChange={(event) => void handleFile(event)}
              />
              <span className="text-xs text-muted-foreground">
                {fileName || "Claude .md or JSON agent definition"}
              </span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-agent-source">Definition</Label>
              <Textarea
                id="import-agent-source"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                rows={12}
                className="font-mono text-sm"
                placeholder="Paste a Claude-style agent file or a JSON definition"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-agent-scope">Availability</Label>
              <Select
                value={scope}
                onValueChange={(value: "all" | "selected") => setScope(value)}
              >
                <SelectTrigger id="import-agent-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All apps</SelectItem>
                  <SelectItem value="selected">Selected apps</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button
                onClick={() =>
                  importAgent.mutate({
                    source,
                    fileName: fileName || undefined,
                    scope,
                  })
                }
                disabled={!source.trim() || importAgent.isPending}
              >
                {importAgent.isPending ? "Importing..." : "Import agent"}
              </Button>
            </DialogFooter>
          </TabsContent>
          <TabsContent value="endpoint" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="external-agent-url">Endpoint URL</Label>
              <Input
                id="external-agent-url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://agent.example.com"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="external-agent-name">Name</Label>
                <Input
                  id="external-agent-name"
                  value={endpointName}
                  onChange={(event) => setEndpointName(event.target.value)}
                  placeholder="Research partner"
                />
              </div>
              <div className="space-y-2">
                <Label>Availability</Label>
                <div className="flex h-10 items-center">
                  <Badge variant="secondary">Workspace</Badge>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="external-agent-description">Description</Label>
              <Input
                id="external-agent-description"
                value={endpointDescription}
                onChange={(event) => setEndpointDescription(event.target.value)}
                placeholder="Optional"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Dispatch stores the public endpoint only. Authenticate it after
              connecting.
            </p>
            <DialogFooter>
              <Button
                onClick={() =>
                  connect.mutate({
                    url,
                    name: endpointName || undefined,
                    description: endpointDescription || undefined,
                    scope: "shared",
                  })
                }
                disabled={!url.trim() || connect.isPending}
              >
                <IconPlugConnected size={16} />
                {connect.isPending ? "Connecting..." : "Connect agent"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DeleteAgentButton({
  resource,
  onDeleted,
}: {
  resource: WorkspaceAgentResource;
  onDeleted?: () => void;
}) {
  const remove = useActionMutation("delete-workspace-resource", {
    onSuccess: () => {
      toast.success("Agent removed");
      onDeleted?.();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Remove ${resource.name}`}
        >
          <IconTrash size={16} />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {resource.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the reusable profile from the workspace apps.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => remove.mutate({ id: resource.id })}
            disabled={remove.isPending}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function AgentRow({
  resource,
  onDeleted,
  onSaved,
}: {
  resource: WorkspaceAgentResource;
  onDeleted?: () => void;
  onSaved?: () => void;
}) {
  const navigate = useNavigate();
  const promote = useActionMutation<
    AgentAppCreationResult,
    AgentAppCreationInput
  >("start-workspace-app-creation", {
    onSuccess: (result) => {
      if (result.mode === "local-agent") {
        sendToAgentChat({
          message: result.prompt ?? result.message,
          submit: true,
          type: "code",
          newTab: true,
          reuseEmptyTab: true,
        });
        toast.success("Sent to the local agent");
        return;
      }
      if (result.mode === "builder") {
        toast.success("App build started", {
          description: result.message,
          action: result.url
            ? {
                label: "Open in Builder",
                onClick: () =>
                  window.open(result.url, "_blank", "noopener,noreferrer"),
              }
            : undefined,
        });
        return;
      }
      toast.error(result.message);
    },
    onError: (error) => toast.error(error.message),
  });

  function chat() {
    navigateWithAgentChatViewTransition(
      navigate,
      `/chat?agent=${encodeURIComponent(resource.path)}`,
    );
  }

  function buildApp() {
    promote.mutate({
      appId: slugifyAgentName(resource.name),
      description: resource.description || undefined,
      prompt: `Turn the "${resource.name}" workspace agent into a focused workspace app. Preserve its role and instructions, make the app its usable face, and keep the original reusable agent profile available.`,
      resourceIds: [resource.id],
    });
  }

  return (
    <div className="flex items-start gap-3 rounded-xl border bg-card px-4 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <IconUser size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {resource.name}
          </span>
          <Badge variant="outline">
            {resource.scope === "all" ? "All apps" : "Selected apps"}
          </Badge>
        </div>
        {resource.description ? (
          <div className="mt-1 text-sm text-muted-foreground">
            {resource.description}
          </div>
        ) : null}
        <div className="mt-1 font-mono text-[11px] text-muted-foreground/70">
          {resource.path}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        <Button
          variant="outline"
          size="sm"
          onClick={chat}
          aria-label={`Chat with ${resource.name}`}
        >
          <IconMessageCircle size={15} />
          Chat
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={buildApp}
          disabled={promote.isPending}
          aria-label={`Build an app for ${resource.name}`}
        >
          <IconLayoutGrid size={15} />
          {promote.isPending ? "Starting..." : "Build app"}
        </Button>
        <AgentEditorDialog
          resource={resource}
          onSaved={onSaved}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${resource.name}`}
            >
              <IconEdit size={16} />
            </Button>
          }
        />
        <DeleteAgentButton resource={resource} onDeleted={onDeleted} />
      </div>
    </div>
  );
}

interface AgentAppCreationInput {
  appId: string;
  description?: string;
  prompt: string;
  resourceIds: string[];
}

interface AgentAppCreationResult {
  mode: "builder" | "local-agent" | "builder-unavailable" | "coming-soon";
  message: string;
  prompt?: string;
  url?: string;
}

export function SimpleAgentsPanel() {
  const query = useActionQuery<WorkspaceAgentResource[]>(
    "list-workspace-resources",
    { kind: "agent" },
  );
  const agents = query.data ?? [];

  if (query.isError) {
    return (
      <ActionQueryError
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ImportAgentDialog onImported={() => void query.refetch()} />
        <AgentEditorDialog onSaved={() => void query.refetch()} />
      </div>
      {query.isLoading && agents.length === 0 ? (
        <div className="space-y-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="rounded-xl border bg-card px-4 py-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="mt-2 h-3 w-2/3" />
            </div>
          ))}
        </div>
      ) : agents.length > 0 ? (
        <div className="space-y-2">
          {agents.map((agent) => (
            <AgentRow
              key={agent.id}
              resource={agent}
              onDeleted={() => void query.refetch()}
              onSaved={() => void query.refetch()}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed px-6 py-14 text-center">
          <div className="text-sm font-medium text-foreground">
            No agents yet
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <AgentEditorDialog
              onSaved={() => void query.refetch()}
              trigger={
                <Button>
                  <IconPlus size={16} />
                  Create an agent
                </Button>
              }
            />
            <ImportAgentDialog onImported={() => void query.refetch()} />
          </div>
        </div>
      )}
    </section>
  );
}
