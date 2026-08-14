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
  IconFolder,
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
  DialogDescription,
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

interface AgentPackFileResource extends WorkspaceAgentResource {
  kind: "agent-file" | "skill";
}

interface AgentPackResponse {
  profile: WorkspaceAgentResource;
  root: string;
  files: AgentPackFileResource[];
}

interface AgentPackFileInput {
  path: string;
  content: string;
}

export function isPendingWorkspaceResourceApproval(result: unknown) {
  if (!result || typeof result !== "object") return false;
  const mutation = result as { status?: unknown; changeType?: unknown };
  return (
    mutation.status === "pending" &&
    typeof mutation.changeType === "string" &&
    mutation.changeType.startsWith("workspace-resource.")
  );
}

export function handleAgentPackMutationSuccess(
  result: unknown,
  options: {
    appliedMessage: string;
    approvalMessage: string;
    onApplied: () => void;
    notify?: (message: string) => void;
  },
) {
  const notify = options.notify || ((message) => toast.success(message));
  if (isPendingWorkspaceResourceApproval(result)) {
    notify(options.approvalMessage);
    return;
  }
  notify(options.appliedMessage);
  options.onApplied();
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
          <DialogDescription className="sr-only">
            {isEditing
              ? "Update this reusable agent profile."
              : "Create a reusable agent profile."}
          </DialogDescription>
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

function AgentPackDialog({
  resource,
  onChanged,
  trigger,
}: {
  resource: WorkspaceAgentResource;
  onChanged?: () => void;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(resource.id);
  const [content, setContent] = useState(resource.content);
  const [addOpen, setAddOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [newKind, setNewKind] = useState<"agent-file" | "skill">("agent-file");
  const [newContent, setNewContent] = useState("");
  const query = useActionQuery<AgentPackResponse>(
    "list-agent-pack",
    { agentId: resource.id },
    { enabled: open },
  );
  const update = useActionMutation("update-workspace-resource", {
    onSuccess: (result) => {
      handleAgentPackMutationSuccess(result, {
        appliedMessage: "Pack file updated",
        approvalMessage: "Pack file update queued for approval",
        onApplied: () => {
          void query.refetch();
          onChanged?.();
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const create = useActionMutation("create-workspace-resource", {
    onSuccess: (result) => {
      handleAgentPackMutationSuccess(result, {
        appliedMessage: "Pack file added",
        approvalMessage: "Pack file addition queued for approval",
        onApplied: () => {
          setAddOpen(false);
          setNewPath("");
          setNewContent("");
          void query.refetch();
          onChanged?.();
        },
      });
    },
    onError: (error) => toast.error(error.message),
  });
  const remove = useActionMutation("delete-workspace-resource", {
    onSuccess: () => {
      toast.success("Pack file removed");
      setSelectedId(resource.id);
      void query.refetch();
      onChanged?.();
    },
    onError: (error) => toast.error(error.message),
  });

  const files = query.data
    ? [{ ...query.data.profile, kind: "agent" as const }, ...query.data.files]
    : [];
  const selected = files.find((file) => file.id === selectedId) ?? files[0];

  useEffect(() => {
    if (!open) return;
    setSelectedId(resource.id);
  }, [open, resource.id]);

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setContent(selected.content);
  }, [selected?.id, selected?.content]);

  function addFile() {
    const relativePath = newPath.trim().replaceAll("\\", "/");
    if (
      !relativePath ||
      relativePath.startsWith("/") ||
      relativePath.includes("..") ||
      relativePath.split("/").some((part) => !part || part === ".")
    ) {
      toast.error("Use a relative pack path without ..");
      return;
    }
    const packPath =
      newKind === "skill" && !relativePath.startsWith("skills/")
        ? `skills/${relativePath}`
        : relativePath;
    const name = packPath.split("/").pop() || packPath;
    create.mutate({
      kind: newKind,
      name,
      path: `${query.data?.root || `agents/${slugifyAgentName(resource.name)}`}/${packPath}`,
      content: newContent,
      scope: resource.scope,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setAddOpen(false);
      }}
    >
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="ghost" size="sm">
            <IconFolder size={15} />
            Pack
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Agent pack</DialogTitle>
          <DialogDescription className="sr-only">
            Edit the profile, reference files, context, and skills that belong
            to this agent.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Files
              </span>
              <Dialog open={addOpen} onOpenChange={setAddOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <IconPlus size={14} />
                    Add
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add pack file</DialogTitle>
                    <DialogDescription className="sr-only">
                      Add a text reference or agent-owned skill to this pack.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="agent-pack-file-path">Path</Label>
                      <Input
                        id="agent-pack-file-path"
                        value={newPath}
                        onChange={(event) => setNewPath(event.target.value)}
                        placeholder="context/brief.md"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="agent-pack-file-kind">Type</Label>
                      <Select
                        value={newKind}
                        onValueChange={(value: "agent-file" | "skill") =>
                          setNewKind(value)
                        }
                      >
                        <SelectTrigger id="agent-pack-file-kind">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="agent-file">
                            Reference file
                          </SelectItem>
                          <SelectItem value="skill">Skill</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="agent-pack-file-content">Content</Label>
                      <Textarea
                        id="agent-pack-file-content"
                        value={newContent}
                        onChange={(event) => setNewContent(event.target.value)}
                        rows={8}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={addFile}
                      disabled={!newPath.trim() || create.isPending}
                    >
                      {create.isPending ? "Adding..." : "Add file"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            {query.isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-1">
                {files.map((file) => (
                  <Button
                    key={file.id}
                    type="button"
                    variant={selected?.id === file.id ? "secondary" : "ghost"}
                    className="h-auto w-full justify-start px-2 py-2 text-left"
                    onClick={() => setSelectedId(file.id)}
                  >
                    <span className="min-w-0 truncate text-xs">
                      {file.path.replace(`${query.data?.root || ""}/`, "")}
                    </span>
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {selected?.path || "Select a file"}
                </div>
                {selected && selected.kind !== "agent" ? (
                  <Badge variant="outline">
                    {selected.kind === "skill" ? "Skill" : "Reference"}
                  </Badge>
                ) : null}
              </div>
              <div className="flex items-center gap-1">
                {selected && selected.kind !== "agent" ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <IconTrash size={15} />
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Remove this pack file?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          The file will no longer be available to this agent.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => remove.mutate({ id: selected.id })}
                          disabled={remove.isPending}
                        >
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : null}
                <Button
                  size="sm"
                  onClick={() =>
                    selected && update.mutate({ id: selected.id, content })
                  }
                  disabled={
                    !selected ||
                    update.isPending ||
                    content === selected.content
                  }
                >
                  {update.isPending ? "Saving..." : "Save file"}
                </Button>
              </div>
            </div>
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={!selected}
              rows={18}
              className="min-h-[360px] font-mono text-sm"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImportAgentDialog({ onImported }: { onImported?: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"file" | "folder" | "endpoint">("file");
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [url, setUrl] = useState("");
  const [endpointName, setEndpointName] = useState("");
  const [endpointDescription, setEndpointDescription] = useState("");
  const [packFiles, setPackFiles] = useState<AgentPackFileInput[]>([]);
  const [packName, setPackName] = useState("");
  const [packWarnings, setPackWarnings] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

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
  const importPack = useActionMutation("import-agent-pack", {
    onSuccess: (result: { status: string; warnings?: string[] }) => {
      toast.success(
        result.status === "pending-approval"
          ? "Pack sent for approval"
          : result.status === "unchanged"
            ? "Agent pack already imported"
            : "Agent pack imported",
      );
      if (result.warnings?.length) toast.info(result.warnings.join(" "));
      setOpen(false);
      onImported?.();
    },
    onError: (error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!folderRef.current) return;
    folderRef.current.setAttribute("webkitdirectory", "");
    folderRef.current.setAttribute("directory", "");
  }, [mode, open]);

  function reset() {
    setMode("file");
    setSource("");
    setFileName("");
    setScope("all");
    setUrl("");
    setEndpointName("");
    setEndpointDescription("");
    setPackFiles([]);
    setPackName("");
    setPackWarnings([]);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSource(await file.text());
  }

  async function handleFolder(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length === 0) return;
    const warnings: string[] = [];
    const textExtensions =
      /\.(md|markdown|txt|json|yaml|yml|csv|html|xml|toml|ts|tsx|js|mjs|py|sh)$/i;
    const pack = await Promise.all(
      selectedFiles.map(async (file) => {
        const path =
          (file as File & { webkitRelativePath?: string }).webkitRelativePath ||
          file.name;
        if (!textExtensions.test(path)) {
          warnings.push(`Skipped non-text file: ${path}`);
          return null;
        }
        return { path, content: await file.text() };
      }),
    );
    const files = pack.filter((file): file is AgentPackFileInput =>
      Boolean(file),
    );
    setPackFiles(files);
    setPackName(files[0]?.path.split("/")[0] || "Selected folder");
    setPackWarnings(warnings);
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
          <DialogDescription className="sr-only">
            Import a Claude or JSON agent definition, or connect an external
            agent endpoint.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={mode}
          onValueChange={(value) =>
            setMode(value as "file" | "folder" | "endpoint")
          }
        >
          <TabsList className="w-full justify-start">
            <TabsTrigger value="file">Agent file</TabsTrigger>
            <TabsTrigger value="folder">Agent folder</TabsTrigger>
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
          <TabsContent value="folder" className="space-y-4 py-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => folderRef.current?.click()}
              >
                <IconFolder size={16} />
                Choose folder
              </Button>
              <input
                ref={folderRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => void handleFolder(event)}
              />
              <span className="text-xs text-muted-foreground">
                {packName
                  ? `${packName} · ${packFiles.length} files`
                  : "Claude Project or Cowork-style folder"}
              </span>
            </div>
            {packWarnings.length > 0 ? (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                {packWarnings.join(" ")}
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="import-agent-pack-scope">Availability</Label>
              <Select
                value={scope}
                onValueChange={(value: "all" | "selected") => setScope(value)}
              >
                <SelectTrigger id="import-agent-pack-scope">
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
                onClick={() => importPack.mutate({ files: packFiles, scope })}
                disabled={packFiles.length === 0 || importPack.isPending}
              >
                {importPack.isPending ? "Importing..." : "Import agent pack"}
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
  const packQuery = useActionQuery<AgentPackResponse>(
    "list-agent-pack",
    { agentId: resource.id },
    { enabled: false },
  );
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

  async function buildApp() {
    const pack = await packQuery.refetch();
    if (pack.error || !pack.data) {
      toast.error(pack.error?.message || "Could not load the agent pack");
      return;
    }
    promote.mutate({
      appId: slugifyAgentName(resource.name),
      description: resource.description || undefined,
      prompt: `Turn the "${resource.name}" workspace agent into a focused workspace app. Preserve its role and instructions, make the app its usable face, and keep the original reusable agent profile available.`,
      resourceIds: [resource.id, ...pack.data.files.map((file) => file.id)],
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
          onClick={() => void buildApp()}
          disabled={promote.isPending}
          aria-label={`Build an app for ${resource.name}`}
        >
          <IconLayoutGrid size={15} />
          {promote.isPending ? "Starting..." : "Build app"}
        </Button>
        <AgentPackDialog
          resource={resource}
          onChanged={onSaved}
          trigger={
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Manage files for ${resource.name}`}
            >
              <IconFolder size={16} />
            </Button>
          }
        />
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
