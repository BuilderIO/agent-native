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
import { Textarea } from "@agent-native/toolkit/ui/textarea";
import {
  IconApps,
  IconFilePlus,
  IconMessage,
  IconPlus,
  IconUpload,
} from "@tabler/icons-react";
import {
  useCallback,
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
      emptyText: t("agentChat.settingsResources.dispatchEmpty"),
    }),
    [t, view],
  );
}

/** A header- or group-sized "Add" button. */
function AddButton({
  label,
  placement,
  ...props
}: {
  label: string;
  placement: "header" | "group";
} & ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant={placement === "header" ? "default" : "ghost"}
      size="sm"
      className="h-7 gap-1.5 px-2.5 text-xs"
      {...props}
    >
      <IconPlus className="size-3.5" />
      {label}
    </Button>
  );
}

export function EmptyRowButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-2.5 text-xs"
      disabled={disabled}
      onClick={onClick}
    >
      {label}
    </Button>
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
  placement: "header" | "group";
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
        <DialogContent className="sm:max-w-lg">
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
  placement: "header" | "group";
  onCreated: (resource: ResourceMeta) => void;
}) {
  const t = useT();
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const create = useCreateResource();
  const upload = useUploadResource();
  const path = normalizeResourceFileName(name);

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

  const submit = () => {
    if (!path) return;
    create.mutate(
      { path, content: "", shared: scope === "shared" },
      {
        onSuccess: (resource) => {
          setCreating(false);
          onCreated(resource);
        },
        onError: () => {
          toast.error(
            t("agentChat.settingsResources.saveFailed", { name: path }),
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
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
            <IconUpload className="size-4" />
            {t("agentChat.settingsResources.files.upload")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setName("");
              setCreating(true);
            }}
          >
            <IconFilePlus className="size-4" />
            {t("agentChat.settingsResources.files.create")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("agentChat.settingsResources.files.create")}
            </DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
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
            <DialogFooter className="mt-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                {t("agentChat.settingsResources.cancel")}
              </Button>
              <Button type="submit" disabled={!path || create.isPending}>
                {t("agentChat.settingsResources.create")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
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
  const [text, setText] = useState("");
  const create = useCreateResource();

  const save = () => {
    const body = text.trim();
    if (!body) return;
    create.mutate(
      {
        path: "AGENTS.md",
        content: `# Agent Instructions\n\n${body}\n`,
        mimeType: "text/markdown",
        shared: false,
      },
      {
        onSuccess: () => {
          setText("");
          onOpenChange(false);
        },
        onError: () => {
          toast.error(
            t("agentChat.settingsResources.saveFailed", { name: "AGENTS.md" }),
          );
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("agentChat.settingsShell.page.instructions")}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor={fieldId}>
            {t("agentChat.settingsResources.instructions.fieldLabel")}
          </Label>
          <Textarea
            id={fieldId}
            autoFocus
            rows={6}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={t(
              "agentChat.settingsResources.instructions.placeholder",
            )}
          />
          <p className="text-xs text-muted-foreground">
            {t("agentChat.settingsResources.instructions.savedAs")}
          </p>
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("agentChat.settingsResources.cancel")}
          </Button>
          <Button
            type="button"
            disabled={!text.trim() || create.isPending}
            onClick={save}
          >
            {t("agentChat.settingsResources.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
