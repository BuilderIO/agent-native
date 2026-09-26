import { Alert, AlertDescription } from "@agent-native/toolkit/ui/alert";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agent-native/toolkit/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { Label } from "@agent-native/toolkit/ui/label";
import { Spinner } from "@agent-native/toolkit/ui/spinner";
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconAlertCircle,
  IconApps,
  IconFilePlus,
  IconMessage,
  IconPlus,
  IconUpload,
} from "@tabler/icons-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { toast } from "sonner";

import { PromptComposer } from "../../../composer/index.js";
import { useT } from "../../../i18n.js";
import { useOrg } from "../../../org/hooks.js";
import type { ResourceView } from "../../../resources/resource-views.js";
import type { ResourceSettingsGroupConfig } from "../../../resources/ResourceSettingsGroups.js";
import {
  canEditOrganizationResources,
  normalizeResourceFileName,
  requestSkillFromAgent,
  ResourcesPanel,
  slugifyName,
} from "../../../resources/ResourcesPanel.js";
import {
  useCreateResource,
  useResourceTree,
  type ResourceMeta,
} from "../../../resources/use-resources.js";
import { useUploadResource } from "../../../uploads/use-upload-resource.js";

/** Filled by the panel with a function that opens a resource in its editor. */
export type OpenResourceRef = { current: ((id: string) => void) | null };

/** Personal/organization target of an add action. */
export type EditableResourceScope = "personal" | "shared";

export function useOpenResourceRef() {
  const ref = useRef<((id: string) => void) | null>(null);
  const open = useCallback((resource: Pick<ResourceMeta, "id">) => {
    ref.current?.(resource.id);
  }, []);
  return { ref, open };
}

/** Whether the viewer can add to the organization group, and its name. */
export function useOrganizationResourceAccess() {
  const { data: org } = useOrg();
  return {
    canEditOrg: canEditOrganizationResources(org),
    orgName: org?.orgName ?? null,
  };
}

/**
 * One Agent-group Settings page: the Resources panel with a fixed view,
 * listed in Personal, {Org}, and From Dispatch groups.
 */
export function ResourceSettingsPage({
  view,
  groups,
  openResourceRef,
  onEditingChange,
}: {
  view: ResourceView;
  groups: readonly ResourceSettingsGroupConfig[];
  openResourceRef: OpenResourceRef;
  onEditingChange?: (editing: boolean) => void;
}) {
  return (
    <ResourcesPanel
      showMcpServers={false}
      resourceFilter={view}
      resourceTreeVariant="collection"
      scope="personal"
      settingsGroups={groups}
      openResourceRef={openResourceRef}
      onEditingChange={onEditingChange}
    />
  );
}

export function useDispatchGroup(
  view: ResourceView,
): ResourceSettingsGroupConfig {
  const t = useT();
  return useMemo(
    () => ({
      id: "from-dispatch",
      view,
      sources: ["workspace"],
      emptyIcon: IconApps,
      emptyTitle: t("agentChat.settingsResources.dispatchEmpty"),
    }),
    [t, view],
  );
}

/**
 * Where an "Add" action sits: the page header or a group's empty state
 * (primary), or beside a group heading (secondary, extra small).
 */
export type AddActionPlacement = "header" | "empty" | "group";

/** An "Add" action button, sized for where it sits. */
function AddButton({
  label,
  placement,
  pending = false,
  ...props
}: {
  label: string;
  placement: AddActionPlacement;
  pending?: boolean;
} & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant={placement === "group" ? "secondary" : "default"}
      size={placement === "group" ? "xs" : "sm"}
      {...props}
    >
      {pending ? <Spinner /> : <IconPlus />}
      {label}
    </Button>
  );
}

/** The action in a group's empty state, e.g. "Add memory". */
export function EmptyActionButton({
  label,
  onClick,
  pending,
}: {
  label: string;
  onClick: () => void;
  pending?: boolean;
}) {
  return (
    <AddButton
      label={label}
      placement="empty"
      pending={pending}
      disabled={pending}
      onClick={onClick}
    />
  );
}

/** Creates a resource from fixed seed content and opens it in the editor. */
export function useSeedResource(onCreated: (resource: ResourceMeta) => void) {
  const t = useT();
  const create = useCreateResource();
  const seed = useCallback(
    (path: string, content: string, scope: EditableResourceScope) => {
      create.mutate(
        {
          path,
          content,
          mimeType: "text/markdown",
          shared: scope === "shared",
        },
        {
          onSuccess: onCreated,
          onError: () => {
            toast.error(
              t("agentChat.settingsResources.saveFailed", { name: path }),
            );
          },
        },
      );
    },
    [create, onCreated, t],
  );
  return { seed, isPending: create.isPending };
}

function uniqueSkillPath(slug: string, taken: ReadonlySet<string>): string {
  let path = `skills/${slug}/SKILL.md`;
  for (let n = 2; taken.has(path.toLowerCase()); n += 1) {
    path = `skills/${slug}-${n}/SKILL.md`;
  }
  return path;
}

function collectPaths(
  nodes: readonly { path: string; children?: unknown[] }[],
  into: Set<string>,
): Set<string> {
  for (const node of nodes) {
    into.add(node.path.toLowerCase());
    if (Array.isArray(node.children)) {
      collectPaths(node.children as { path: string }[], into);
    }
  }
  return into;
}

/** Skills "Add skill": describe it to the agent, or upload a SKILL.md. */
export function AddSkillMenu({
  scope,
  placement,
  onCreated,
}: {
  scope: EditableResourceScope;
  placement: AddActionPlacement;
  onCreated: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const [describing, setDescribing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const create = useCreateResource();
  const tree = useResourceTree(scope);

  const uploadSkill = async (file: File) => {
    let content: string;
    try {
      content = await file.text();
    } catch {
      toast.error(
        t("agentChat.settingsResources.uploadFailed", { name: file.name }),
      );
      return;
    }
    const baseName = file.name.replace(/\.[^./]+$/, "");
    const slug = slugifyName(
      baseName.toLowerCase() === "skill" ? "uploaded-skill" : baseName,
    );
    const path = uniqueSkillPath(
      slug,
      collectPaths(tree.data ?? [], new Set<string>()),
    );
    create.mutate(
      { path, content, mimeType: "text/markdown", shared: scope === "shared" },
      {
        onSuccess: onCreated,
        onError: () => {
          toast.error(
            t("agentChat.settingsResources.uploadFailed", { name: file.name }),
          );
        },
      },
    );
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadSkill(file);
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <AddButton
            label={t("agentChat.settingsResources.skills.add")}
            placement={placement}
            pending={create.isPending}
            disabled={create.isPending}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setDescribing(true)}>
            <IconMessage className="size-4" />
            {t("agentChat.settingsResources.skills.describe")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
            <IconUpload className="size-4" />
            {t("agentChat.settingsResources.skills.upload")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={describing} onOpenChange={setDescribing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("agentChat.settingsResources.skills.describe")}
            </DialogTitle>
          </DialogHeader>
          <PromptComposer
            autoFocus
            placeholder={t(
              "agentChat.settingsResources.skills.describePlaceholder",
            )}
            draftScope="settings:create-skill"
            onSubmit={(text) => {
              requestSkillFromAgent(text, scope);
              setDescribing(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Files "Add file": upload files, or create an empty one by name. */
export function AddFileMenu({
  scope,
  placement,
  onCreated,
}: {
  scope: EditableResourceScope;
  placement: AddActionPlacement;
  onCreated: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const upload = useUploadResource();

  const uploadFiles = (files: FileList) => {
    for (const file of Array.from(files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("shared", scope === "shared" ? "true" : "false");
      upload.mutate(formData, {
        onError: () => {
          toast.error(
            t("agentChat.settingsResources.uploadFailed", { name: file.name }),
          );
        },
      });
    }
  };

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = event.target.files;
          if (files && files.length > 0) uploadFiles(files);
          event.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <AddButton
            label={t("agentChat.settingsResources.files.add")}
            placement={placement}
            pending={upload.isPending}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
            <IconUpload className="size-4" />
            {t("agentChat.settingsResources.files.upload")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <IconFilePlus className="size-4" />
            {t("agentChat.settingsResources.files.create")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateFileDialog
        open={creating}
        onOpenChange={setCreating}
        scope={scope}
        onCreated={onCreated}
      />
    </>
  );
}

function CreateFileDialog({
  open,
  onOpenChange,
  scope,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: EditableResourceScope;
  onCreated: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const inputId = useId();
  const [name, setName] = useState("");
  const [failed, setFailed] = useState(false);
  const create = useCreateResource();
  const path = normalizeResourceFileName(name);

  useEffect(() => {
    if (!open) return;
    setName("");
    setFailed(false);
  }, [open]);

  const submit = async () => {
    if (!path || create.isPending) return;
    setFailed(false);
    try {
      const resource = await create.mutateAsync({
        path,
        content: "",
        shared: scope === "shared",
      });
      onOpenChange(false);
      onCreated(resource);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t("agentChat.settingsResources.files.create")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={inputId}>
              {t("agentResources.createFile.nameLabel")}
            </Label>
            <Input
              id={inputId}
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("agentResources.createFile.namePlaceholder")}
            />
          </div>
          {failed ? (
            <SaveFailedAlert
              message={t("agentChat.settingsResources.saveFailed", {
                name: path,
              })}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t("agentChat.settingsResources.cancel")}
            </Button>
            <Button type="submit" disabled={!path || create.isPending}>
              {create.isPending ? <Spinner /> : null}
              {create.isPending
                ? t("agentChat.settingsResources.creating")
                : t("agentChat.settingsResources.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SaveFailedAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <IconAlertCircle />
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** "Add instructions": writes the viewer's personal AGENTS.md. */
export function InstructionsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const fieldId = useId();
  const hintId = useId();
  const [text, setText] = useState("");
  const [failed, setFailed] = useState(false);
  const create = useCreateResource();

  useEffect(() => {
    if (open) setFailed(false);
  }, [open]);

  const save = async () => {
    const body = text.trim();
    if (!body || create.isPending) return;
    setFailed(false);
    try {
      await create.mutateAsync({
        path: "AGENTS.md",
        content: `# Agent Instructions\n\n${body}\n`,
        mimeType: "text/markdown",
        shared: false,
      });
      setText("");
      onOpenChange(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t("agentChat.settingsShell.page.instructions")}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor={fieldId}>
              {t("agentChat.settingsResources.instructions.fieldLabel")}
            </Label>
            <Textarea
              id={fieldId}
              autoFocus
              rows={6}
              value={text}
              aria-describedby={hintId}
              onChange={(event) => setText(event.target.value)}
              placeholder={t(
                "agentChat.settingsResources.instructions.placeholder",
              )}
            />
            <p id={hintId} className="text-xs text-muted-foreground">
              {t("agentChat.settingsResources.instructions.savedAs")}
            </p>
          </div>
          {failed ? (
            <SaveFailedAlert
              message={t("agentChat.settingsResources.saveFailed", {
                name: "AGENTS.md",
              })}
            />
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              {t("agentChat.settingsResources.cancel")}
            </Button>
            <Button type="submit" disabled={!text.trim() || create.isPending}>
              {create.isPending ? <Spinner /> : null}
              {create.isPending
                ? t("agentChat.settingsResources.saving")
                : t("agentChat.settingsResources.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
