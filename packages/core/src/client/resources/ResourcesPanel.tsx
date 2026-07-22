import { Button } from "@agent-native/toolkit/ui/button";
import {
  IconPlus,
  IconUpload,
  IconArrowLeft,
  IconPencil,
  IconBulb,
  IconBolt,
  IconTrash,
  IconEye,
  IconCode,
  IconClock,
  IconHierarchy2,
  IconPlugConnected,
} from "@tabler/icons-react";
import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";

import {
  CLAUDE_SONNET_MODEL_ID,
  CLAUDE_SONNET_MODEL_LABEL,
} from "../../agent/model-config.js";
import { serializeFrontmatter } from "../../resources/metadata.js";
import { sendToAgentChat } from "../agent-chat.js";
import { agentNativePath } from "../api-path.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { PromptComposer } from "../composer/index.js";
import { useT } from "../i18n.js";
import { useOrg } from "../org/hooks.js";
import { useUploadResource } from "../uploads/use-upload-resource.js";
import { cn } from "../utils.js";
import { BuiltinCapabilityDetail } from "./BuiltinCapabilityDetail.js";
import {
  isMcpIntegrationCatalogAvailable,
  type DefaultMcpIntegration,
} from "./mcp-integration-catalog.js";
import { McpIntegrationDialog } from "./McpIntegrationDialog.js";
import { McpServerDetail } from "./McpServerDetail.js";
import { ResourceEditor } from "./ResourceEditor.js";
import { ResourceTree } from "./ResourceTree.js";
import {
  parseMcpBuiltinVirtualId,
  useBuiltinCapabilities,
} from "./use-builtin-capabilities.js";
import {
  useMcpServers,
  useCreateMcpServer,
  useDeleteMcpServer,
  parseMcpVirtualId,
  type McpServerScope,
} from "./use-mcp-servers.js";
import {
  useResourceTree,
  useResource,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  withMcpServersFolder,
  withAgentScratchFolder,
  type ResourceScope,
  type ResourceMeta,
  type Resource,
  type TreeNode,
} from "./use-resources.js";

const LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE = "local-workspace-resource";

export function normalizeResourceFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.endsWith("/")) return "";
  const finalSegment = trimmed.split("/").pop() ?? "";
  return /\.[^/]+$/.test(finalSegment) ? trimmed : `${trimmed}.md`;
}

const EMPTY_RESOURCE_ACTION_LABELS: Record<ResourceView, string> = {
  files: "Add file",
  instructions: "Add instructions",
  agents: "Add agent",
  memory: "Add memory",
  skills: "Add skill",
  learnings: "Add learning",
  "remote-agents": "Add remote agent",
};

const EMPTY_RESOURCE_SEEDS: Partial<
  Record<ResourceView, { path: string; content: string; mimeType?: string }>
> = {
  instructions: {
    path: "AGENTS.md",
    content: "# Agent Instructions\n\n",
    mimeType: "text/markdown",
  },
  memory: {
    path: "memory/MEMORY.md",
    content: "# Memory\n\n",
    mimeType: "text/markdown",
  },
  learnings: {
    path: "LEARNINGS.md",
    content: "# Learnings\n\n",
    mimeType: "text/markdown",
  },
  "remote-agents": {
    path: "remote-agents/new-agent.json",
    content:
      '{\n  "id": "new-agent",\n  "name": "New agent",\n  "description": "",\n  "url": "",\n  "color": "#6B7280"\n}\n',
    mimeType: "application/json",
  },
};

export type ResourceView =
  | "files"
  | "instructions"
  | "agents"
  | "memory"
  | "skills"
  | "learnings"
  | "remote-agents";

export type ResourceTreeVariant = "tree" | "collection";

const SPECIAL_RESOURCE_ROOTS = new Set([
  "agents",
  "agent-scratch",
  "jobs",
  "memory",
  "remote-agents",
  "skills",
]);
const SPECIAL_RESOURCE_FILES = new Set(["agents.md", "learnings.md"]);

function normalizedResourcePath(path: string): string {
  return path.replace(/^\/+/, "").toLowerCase();
}

function resourceMatchesView(node: TreeNode, view: ResourceView): boolean {
  const path = normalizedResourcePath(node.path);
  switch (view) {
    case "files":
      return (
        !SPECIAL_RESOURCE_ROOTS.has(path.split("/", 1)[0]) &&
        !SPECIAL_RESOURCE_FILES.has(path.split("/").pop() ?? "")
      );
    case "instructions":
      return path.split("/").pop() === "agents.md";
    case "agents":
      return node.kind === "agent";
    case "memory":
      return path === "memory" || path.startsWith("memory/");
    case "skills":
      return node.kind === "skill";
    case "learnings":
      return path.split("/").pop() === "learnings.md";
    case "remote-agents":
      return node.kind === "remote-agent";
  }
}

export function filterResourceTree(
  tree: TreeNode[],
  view: ResourceView | undefined,
): TreeNode[] {
  if (!view) return tree;
  return tree.flatMap((node) => {
    if (node.type === "folder") {
      if (
        view === "files" &&
        (SPECIAL_RESOURCE_ROOTS.has(
          normalizedResourcePath(node.path).split("/", 1)[0],
        ) ||
          SPECIAL_RESOURCE_FILES.has(
            normalizedResourcePath(node.path).split("/").pop() ?? "",
          ))
      ) {
        return [];
      }
      const children = filterResourceTree(node.children ?? [], view);
      return children.length > 0 ? [{ ...node, children }] : [];
    }
    return resourceMatchesView(node, view) ? [node] : [];
  });
}

// ─── Create Menu (unified + button) ────────────────────────────────────────

type CreateMenuView =
  | "menu"
  | "file"
  | "skill"
  | "skill-upload"
  | "job"
  | "agent-mode"
  | "agent-prompt"
  | "agent-form";

const AGENT_MODEL_OPTIONS = [
  { value: "inherit", label: "Default model" },
  { value: "claude-fable-5", label: "Claude Fable 5" },
  { value: "claude-opus-4-8", label: "Claude Opus 4.8" },
  { value: CLAUDE_SONNET_MODEL_ID, label: CLAUDE_SONNET_MODEL_LABEL },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
] as const;

function slugifyName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

function isLocalWorkspaceResource(resource: Resource | null | undefined) {
  if (!resource?.metadata) return false;
  try {
    const metadata = JSON.parse(resource.metadata) as { source?: unknown };
    return metadata.source === LOCAL_WORKSPACE_RESOURCE_METADATA_SOURCE;
  } catch {
    return false;
  }
}

function buildAgentResourceContent({
  name,
  description,
  model,
  tools,
  body,
}: {
  name: string;
  description: string;
  model: string;
  tools: string;
  body: string;
}): string {
  const fields = [
    { key: "name", value: name },
    { key: "description", value: description },
    { key: "model", value: model },
    { key: "tools", value: tools },
    { key: "delegate-default", value: "false" },
  ];
  return serializeFrontmatter(fields) + body.trim() + "\n";
}

function CreateMenu({
  scope,
  resourceFilter,
  onCreateFile,
  onCreateResource,
  onCreateMcpServer,
  canCreateOrgMcp,
  hasOrg,
  onCreated,
  showToast,
  mcpIntegrations,
  triggerVariant = "icon",
  triggerLabel,
  initialView = "menu",
}: {
  scope: ResourceScope;
  resourceFilter?: ResourceView;
  onCreateFile: (name: string) => void;
  onCreateResource: (
    path: string,
    content: string,
    mimeType?: string,
    opts?: {
      onSuccess?: (resource: ResourceMeta) => void;
      onError?: (err: unknown) => void;
    },
  ) => void;
  onCreateMcpServer: (args: {
    scope: McpServerScope;
    name: string;
    url: string;
    headers?: Record<string, string>;
    description?: string;
  }) => Promise<void>;
  canCreateOrgMcp: boolean;
  hasOrg: boolean;
  onCreated?: () => void;
  mcpIntegrations?: DefaultMcpIntegration[];
  showToast?: (
    kind: "ok" | "err",
    message: string,
    opts?: { resourceId?: string; durationMs?: number },
  ) => void;
  triggerVariant?: "icon" | "outline";
  triggerLabel?: string;
  initialView?: CreateMenuView;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [view, setView] = useState<CreateMenuView>("menu");
  const showMcpIntegrations = useMemo(
    () =>
      mcpIntegrations
        ? mcpIntegrations.length > 0
        : isMcpIntegrationCatalogAvailable(),
    [mcpIntegrations],
  );
  const [value, setValue] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentModel, setAgentModel] = useState<string>("inherit");
  const [agentInstructions, setAgentInstructions] = useState(
    `# Role\n\nDefine how this agent should work.\n\n## Focus\n\n- What kinds of tasks it should handle\n- What tone or approach it should use\n- Important constraints or preferences\n`,
  );
  const defaultMcpScope: McpServerScope =
    scope === "shared" && canCreateOrgMcp ? "org" : "user";
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const skillFileInputRef = useRef<HTMLInputElement>(null);
  const skillHoverTimerRef = useRef<number | null>(null);
  const [skillFlyoutOpen, setSkillFlyoutOpen] = useState(false);
  const [skillFlyoutSide, setSkillFlyoutSide] = useState<"right" | "left">(
    "right",
  );
  const skillFlyoutCloseTimerRef = useRef<number | null>(null);
  const openSkillFlyout = (rowEl?: HTMLElement | null) => {
    if (skillFlyoutCloseTimerRef.current) {
      window.clearTimeout(skillFlyoutCloseTimerRef.current);
      skillFlyoutCloseTimerRef.current = null;
    }
    if (rowEl && typeof window !== "undefined") {
      const rect = rowEl.getBoundingClientRect();
      const FLYOUT_WIDTH = 248;
      setSkillFlyoutSide(
        window.innerWidth - rect.right < FLYOUT_WIDTH ? "left" : "right",
      );
    }
    setSkillFlyoutOpen(true);
  };
  const scheduleSkillFlyoutClose = () => {
    if (skillFlyoutCloseTimerRef.current)
      window.clearTimeout(skillFlyoutCloseTimerRef.current);
    skillFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setSkillFlyoutOpen(false);
    }, 160);
  };
  const [skillUploadSlug, setSkillUploadSlug] = useState("");
  const [skillUploadContent, setSkillUploadContent] = useState("");
  const [skillUploadFileName, setSkillUploadFileName] = useState("");

  useEffect(() => {
    if (open) {
      setView(initialView);
      setValue("");
      setAgentName("");
      setAgentDescription("");
      setAgentModel("inherit");
      setAgentInstructions(
        `# Role\n\nDefine how this agent should work.\n\n## Focus\n\n- What kinds of tasks it should handle\n- What tone or approach it should use\n- Important constraints or preferences\n`,
      );
      setSkillUploadSlug("");
      setSkillUploadContent("");
      setSkillUploadFileName("");
      setSkillFlyoutOpen(false);
    }
  }, [initialView, open]);

  useEffect(() => {
    if (view !== "menu" && view !== "agent-form") {
      setValue("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [view]);

  const submitFile = () => {
    const normalizedName = normalizeResourceFileName(value);
    if (normalizedName) {
      onCreateFile(normalizedName);
      setOpen(false);
    }
  };

  const submitSkill = (text: string = value) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a skill: ${trimmed}`,
      newTab: true,
      context: `The user wants to create an agent skill. Their description: "${trimmed}"

Follow the create-skill pattern to build this. Before writing:

1. **Determine the skill name** — derive a hyphen-case name from the description (e.g. "code review" → "code-review")
2. **Determine the skill type** — Pattern (architectural rule), Workflow (step-by-step), or Generator (scaffolding)
3. **Write the skill** as a ${scope} resource at path "skills/<name>/SKILL.md" using the \`resources\` tool with \`action: "write"\`

The skill file MUST have YAML frontmatter with name and description (under 40 words), then markdown with:
- Clear rule/purpose statement
- Why this skill exists
- How to follow it (with code examples where helpful)
- Common violations to avoid
- Related skills

Template for a Pattern skill:
\`\`\`markdown
---
name: <hyphen-case-name>
description: >-
  <Under 40 words. When should this trigger?>
---

# <Skill Name>

## Rule
<One sentence: what must be true>

## Why
<Why this rule exists>

## How
<How to follow it, with code examples>

## Don't
<Common violations>
\`\`\`

Template for a Workflow skill:
\`\`\`markdown
---
name: <hyphen-case-name>
description: >-
  <Under 40 words. When should this trigger?>
---

# <Workflow Name>

## Prerequisites
<What must be in place>

## Steps
<Numbered steps with code examples>

## Verification
<How to confirm it worked>
\`\`\`

After creating, update the shared AGENTS.md resource to reference the new skill in its skills table.

Keep the skill concise (under 500 lines) and actionable.`,
      submit: true,
    });

    setOpen(false);
    onCreated?.();
  };

  const handleUploadSkillFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    const text = await file.text();
    const baseName = file.name.replace(/\.[^./]+$/, "");
    const slug = slugifyName(
      baseName.toLowerCase() === "skill" ? "uploaded-skill" : baseName,
    );
    setSkillUploadSlug(slug);
    setSkillUploadContent(text);
    setSkillUploadFileName(file.name);
    setView("skill-upload");
  };

  const saveUploadedSkill = () => {
    const slug = slugifyName(skillUploadSlug || "uploaded-skill");
    const path = `skills/${slug}/SKILL.md`;
    const fileLabel = skillUploadFileName || `${slug}/SKILL.md`;
    onCreateResource(path, skillUploadContent, "text/markdown", {
      onSuccess: (resource) => {
        showToast?.("ok", `Skill "${fileLabel}" added`, {
          resourceId: resource.id,
        });
      },
      onError: (err) => {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : "Failed to save skill file";
        showToast?.("err", msg);
      },
    });
    setOpen(false);
    onCreated?.();
  };

  const submitJob = (text: string = value) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a recurring job: ${trimmed}`,
      newTab: true,
      context: `The user wants to create a recurring job. Their description: "${trimmed}"

Use the manage-jobs tool with action "create" to create this. You need to:
1. Derive a hyphen-case name from the description
2. Convert the schedule to a cron expression (e.g., "every weekday at 9am" → "0 9 * * 1-5")
3. Write clear, self-contained instructions for what the agent should do each time the job runs
4. Create it in ${scope} scope

The job will run automatically on the schedule. Make the instructions specific — include which actions to call and what to do with results.`,
      submit: true,
    });

    setOpen(false);
  };

  const submitAgentPrompt = (text: string = value) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a custom agent: ${trimmed}`,
      newTab: true,
      context: `The user wants a reusable custom sub-agent profile for the workspace. Their description: "${trimmed}"

Create it as a ${scope} resource under "agents/<name>.md" using the \`resources\` tool with \`action: "write"\`.

Requirements:
1. Derive a hyphen-case file name from the intent
2. Use YAML frontmatter with:
   - name
   - description
   - model (use "inherit" unless the request clearly needs a different model)
   - tools (set to "inherit")
   - delegate-default (set to false)
3. Put the main operating instructions in the markdown body
4. Keep it concise and directive, similar to a Claude Code-style custom agent

Template:
\`\`\`markdown
---
name: Design
description: >-
  Helps with product and interface design decisions.
model: inherit
tools: inherit
delegate-default: false
---

# Role

You are a focused design agent.

## Responsibilities

- ...

## Approach

- ...
\`\`\`

The result should be a reusable agent profile, not a one-off task response.`,
      submit: true,
    });

    setOpen(false);
    onCreated?.();
  };

  const submitAgentManual = () => {
    const trimmedName = agentName.trim();
    const trimmedDescription = agentDescription.trim();
    const trimmedInstructions = agentInstructions.trim();
    if (!trimmedName || !trimmedDescription || !trimmedInstructions) return;

    const slug = slugifyName(trimmedName);
    onCreateResource(
      `agents/${slug}.md`,
      buildAgentResourceContent({
        name: trimmedName,
        description: trimmedDescription,
        model: agentModel,
        tools: "inherit",
        body: trimmedInstructions,
      }),
      "text/markdown",
    );
    setOpen(false);
    onCreated?.();
  };

  const menuItems: {
    icon: React.ReactNode;
    label: string;
    desc: string;
    action: () => void;
    hoverAction?: () => void;
  }[] = [
    {
      icon: <IconPlus className="h-3.5 w-3.5" />,
      label: "Create File",
      desc: t("agentResources.createFile.menuDescription"),
      action: () => setView("file"),
    },
    {
      icon: <IconBulb className="h-3.5 w-3.5" />,
      label: "Create Skill",
      desc: "Teach the agent a new ability",
      action: () => openSkillFlyout(),
      hoverAction: openSkillFlyout,
    },
    {
      icon: <IconClock className="h-3.5 w-3.5" />,
      label: "Schedule Task",
      desc: "Run something on a schedule",
      action: () => setView("job"),
    },
    {
      icon: <IconHierarchy2 className="h-3.5 w-3.5" />,
      label: "Create Custom Agent",
      desc: "Add a reusable sub-agent profile",
      action: () => setView("agent-mode"),
    },
    {
      icon: <IconBolt className="h-3.5 w-3.5" />,
      label: "Create Automation",
      desc: "Set up a when-X-do-Y rule",
      action: () => {
        setOpen(false);
        window.dispatchEvent(
          new CustomEvent("agent-panel:set-mode", {
            detail: { mode: "chat" },
          }),
        );
        sendToAgentChat({
          message:
            "Help me create a new automation. Ask me what I want to automate.",
          context: `The user wants to create a new automation. Scope: personal. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.`,
          submit: true,
          newTab: true,
        });
        onCreated?.();
      },
    },
    ...(showMcpIntegrations
      ? [
          {
            icon: <IconPlugConnected className="h-3.5 w-3.5" />,
            label: t("mcpIntegrations.menuLabel"),
            desc: t("mcpIntegrations.menuDescription"),
            action: () => {
              setOpen(false);
              setMcpDialogOpen(true);
            },
          },
        ]
      : []),
  ];
  const visibleMenuItems = menuItems.filter((item) => {
    if (!resourceFilter || resourceFilter === "files") return true;
    if (resourceFilter === "agents")
      return item.label === "Create Custom Agent";
    if (resourceFilter === "skills") return item.label === "Create Skill";
    return false;
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <input
          ref={skillFileInputRef}
          type="file"
          accept=".md,text/markdown"
          multiple
          className="hidden"
          onChange={(e) => {
            handleUploadSkillFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {triggerVariant === "outline" ? (
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-xs"
            >
              <IconPlus className="size-3.5" />
              {triggerLabel ?? "Add resource"}
            </Button>
          </PopoverTrigger>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    open && "bg-accent/50 text-foreground",
                  )}
                >
                  <IconPlus className="h-3.5 w-3.5" />
                </button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Create new...</TooltipContent>
          </Tooltip>
        )}
        <PopoverContent
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-[260] p-0 text-[13px] leading-normal",
            view === "menu" || view === "file"
              ? "w-[260px]"
              : "max-h-[70vh] w-[calc(100vw-24px)] max-w-[380px] overflow-y-auto",
          )}
        >
          {view === "menu" && (
            <div className="py-1">
              {visibleMenuItems.map((item) => {
                const isSkill = item.label === "Create Skill";
                return (
                  <div
                    key={item.label}
                    className="relative"
                    onMouseEnter={(e) => {
                      if (isSkill) {
                        openSkillFlyout(e.currentTarget);
                        return;
                      }
                      if (!item.hoverAction) return;
                      if (skillHoverTimerRef.current)
                        window.clearTimeout(skillHoverTimerRef.current);
                      skillHoverTimerRef.current = window.setTimeout(() => {
                        item.hoverAction?.();
                      }, 180);
                    }}
                    onMouseLeave={() => {
                      if (isSkill) {
                        scheduleSkillFlyoutClose();
                        return;
                      }
                      if (skillHoverTimerRef.current) {
                        window.clearTimeout(skillHoverTimerRef.current);
                        skillHoverTimerRef.current = null;
                      }
                    }}
                  >
                    <button
                      type="button"
                      onClick={item.action}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/50",
                        isSkill && skillFlyoutOpen && "bg-accent/50",
                      )}
                    >
                      <span className="text-muted-foreground">{item.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-foreground">
                          {item.label}
                        </div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                          {item.desc}
                        </div>
                      </div>
                      {isSkill && (
                        <span className="ml-auto text-muted-foreground/60">
                          ›
                        </span>
                      )}
                    </button>
                    {isSkill && skillFlyoutOpen && (
                      <div
                        role="menu"
                        onMouseEnter={() => openSkillFlyout()}
                        onMouseLeave={scheduleSkillFlyoutClose}
                        className={cn(
                          "absolute top-0 z-20 w-[240px] rounded-lg border border-border bg-popover py-1 shadow-md",
                          skillFlyoutSide === "right"
                            ? "left-full ml-1"
                            : "right-full mr-1",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setSkillFlyoutOpen(false);
                            setView("skill");
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/50"
                        >
                          <span className="text-muted-foreground">
                            <IconBulb className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-foreground">
                              Create new skill
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                              Describe a skill and let the agent draft it
                            </div>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSkillFlyoutOpen(false);
                            skillFileInputRef.current?.click();
                          }}
                          className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/50"
                        >
                          <span className="text-muted-foreground">
                            <IconUpload className="h-3.5 w-3.5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-foreground">
                              Upload skill file
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground/60">
                              Import an existing SKILL.md file
                            </div>
                          </div>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {view === "file" && (
            <div className="p-3">
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                {t("agentResources.createFile.nameLabel")}
              </label>
              <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitFile();
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setView("menu");
                  }
                }}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder={t("agentResources.createFile.namePlaceholder")}
              />
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={submitFile}
                  disabled={!normalizeResourceFileName(value)}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {view === "skill" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Create Skill
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Describe what kind of skill you want and the agent will create
                it.
              </p>
              <PromptComposer
                autoFocus
                placeholder="e.g. A skill that reviews PRs for security issues and OWASP top 10 vulnerabilities"
                draftScope="resources:create-skill"
                onSubmit={(text) => submitSkill(text)}
              />
            </div>
          )}

          {view === "skill-upload" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Upload skill file
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Review the content from{" "}
                <span className="font-mono">
                  {skillUploadFileName || "the selected file"}
                </span>{" "}
                before saving.
              </p>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                Skill name
              </label>
              <input
                value={skillUploadSlug}
                onChange={(e) => setSkillUploadSlug(e.target.value)}
                className="mb-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="my-skill"
              />
              <p className="mb-2 text-[10px] text-muted-foreground/60">
                Will be saved at{" "}
                <span className="font-mono">
                  skills/{slugifyName(skillUploadSlug || "uploaded-skill")}
                  /SKILL.md
                </span>
              </p>
              <label className="mb-1 block text-[10px] font-medium text-muted-foreground">
                Content
              </label>
              <textarea
                value={skillUploadContent}
                onChange={(e) => setSkillUploadContent(e.target.value)}
                rows={14}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="mt-2.5 flex justify-end gap-2">
                <button
                  onClick={() => setView("menu")}
                  className="rounded-md px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-accent/40"
                >
                  Back
                </button>
                <button
                  onClick={saveUploadedSkill}
                  disabled={
                    !skillUploadContent.trim() || !skillUploadSlug.trim()
                  }
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Save
                </button>
              </div>
            </div>
          )}

          {view === "job" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Schedule Task
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Describe what should happen and when.
              </p>
              <PromptComposer
                autoFocus
                placeholder="e.g. Every weekday at 9am, check for overdue scorecards and send a Slack update"
                draftScope="resources:create-job"
                onSubmit={(text) => submitJob(text)}
              />
            </div>
          )}

          {view === "agent-mode" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Create Agent
              </label>
              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground/60">
                Build a reusable sub-agent profile for this workspace.
              </p>
              <div className="space-y-2">
                <button
                  onClick={() => setView("agent-prompt")}
                  className="flex w-full items-start gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent/40"
                >
                  <IconPencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-[12px] font-medium text-foreground">
                      Describe It
                    </div>
                    <div className="text-[10px] text-muted-foreground/60">
                      Let the agent draft the profile from a prompt.
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setView("agent-form")}
                  className="flex w-full items-start gap-2 rounded-md border border-border px-3 py-2 text-left hover:bg-accent/40"
                >
                  <IconHierarchy2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div>
                    <div className="text-[12px] font-medium text-foreground">
                      Fill Form
                    </div>
                    <div className="text-[10px] text-muted-foreground/60">
                      Set the fields manually and start with a markdown
                      template.
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}

          {view === "agent-prompt" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Create Agent From Prompt
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Describe the agent you want. It will be saved under{" "}
                <code>agents/</code>.
              </p>
              <PromptComposer
                autoFocus
                placeholder="e.g. A design agent that critiques layouts, suggests UI direction, and prefers concise product reasoning"
                draftScope="resources:create-agent"
                onSubmit={(text) => submitAgentPrompt(text)}
              />
            </div>
          )}

          {view === "agent-form" && (
            <div className="p-3">
              <label className="mb-2 block text-[11px] font-semibold text-foreground">
                Create Agent Manually
              </label>
              <div className="space-y-2">
                <input
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  placeholder="Agent name"
                />
                <input
                  value={agentDescription}
                  onChange={(e) => setAgentDescription(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  placeholder="Short description"
                />
                <label className="block text-[11px] font-medium text-muted-foreground">
                  Model
                </label>
                <select
                  value={agentModel}
                  onChange={(e) => setAgentModel(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none focus:ring-1 focus:ring-accent"
                >
                  {AGENT_MODEL_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <label className="block text-[11px] font-medium text-muted-foreground">
                  Instructions
                </label>
                <textarea
                  value={agentInstructions}
                  onChange={(e) => setAgentInstructions(e.target.value)}
                  rows={8}
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                    lineHeight: 1.5,
                  }}
                />
              </div>
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={submitAgentManual}
                  disabled={
                    !agentName.trim() ||
                    !agentDescription.trim() ||
                    !agentInstructions.trim()
                  }
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
      <McpIntegrationDialog
        open={mcpDialogOpen}
        onOpenChange={setMcpDialogOpen}
        defaultScope={defaultMcpScope}
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={hasOrg}
        onCreateMcpServer={onCreateMcpServer}
        onCreated={onCreated}
        integrations={mcpIntegrations}
      />
    </>
  );
}

// ─── PathBreadcrumb ─────────────────────────────────────────────────────────

function PathBreadcrumb({ path }: { path: string }) {
  const parts = path.split("/").filter(Boolean);
  return (
    <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground/60 overflow-hidden">
      {parts.map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="shrink-0">/</span>}
          <span
            className={cn(
              "truncate",
              i === parts.length - 1 && "text-muted-foreground",
            )}
          >
            {part}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── ResourcesPanel ─────────────────────────────────────────────────────────

const DEFAULT_AGENTS_MD_CLIENT = `# Agent Instructions

This file customizes how the AI agent behaves in this app. Edit it to add your own instructions, preferences, and context.

## What to put here

- **Preferences** — Tone, style, verbosity, response format
- **Context** — Domain knowledge, terminology, team conventions
- **Rules** — Things the agent should always/never do
- **Skills** — Reference skill files for specialized tasks (create them in the \`skills/\` folder)

## Skills

Create skill files under \`skills/<name>/SKILL.md\` to give the agent specialized knowledge. Reference them here:

| Skill | Path | Description |
|-------|------|-------------|
| *(use the skill button to create one)* | \`skills/example/SKILL.md\` | |

## Agent resource files

Agent resources are files users intentionally add, edit, or manage. Agents may create hidden \`agent_scratch\` resources for temporary working notes, scripts, or intermediate results; only promote those files into the visible agent resources list when a user explicitly asks to keep them.
`;

const WORKSPACE_RESOURCE_OWNER = "__workspace__";
const SHARED_RESOURCE_OWNER = "__shared__";

export interface ResourcesPanelProps {
  /** Hide the virtual MCP folder when Files is hosted by the Agent page. */
  showMcpServers?: boolean;
  /** Optional page-level scope to mirror in the resource toolbar. */
  scope?: ResourceScope;
  /** When set, show only the requested scope instead of both scope sections. */
  showOnlyRequestedScope?: boolean;
  /** Limit the tree to one agent-native resource collection. */
  resourceFilter?: ResourceView;
  /** Render special collections as cards instead of a nested file tree. */
  resourceTreeVariant?: ResourceTreeVariant;
  /** Optional app-owned remote MCP catalog. */
  mcpIntegrations?: DefaultMcpIntegration[];
}

export function resolveInitialResourceScope(
  requestedScope: ResourceScope | undefined,
  canEditOrg: boolean,
): ResourceScope {
  if (requestedScope === "shared") return "shared";
  if (requestedScope === "personal") return "personal";
  return canEditOrg ? "shared" : "personal";
}

export function ResourcesPanel({
  showMcpServers = true,
  scope: requestedScope,
  showOnlyRequestedScope = false,
  resourceFilter,
  resourceTreeVariant = "tree",
  mcpIntegrations,
}: ResourcesPanelProps = {}) {
  const t = useT();
  const { data: org } = useOrg();
  // Non-admin org members get read-only access to organization resources.
  // Solo deployments (no orgId) behave as owner — users can edit their own.
  const canEditOrg =
    !org?.orgId || org.role === "owner" || org.role === "admin";

  const [activeScope, setActiveScope] = useState<ResourceScope>(() =>
    resolveInitialResourceScope(requestedScope, canEditOrg),
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );
  const [toolbarDeleteConfirmId, setToolbarDeleteConfirmId] = useState<
    string | null
  >(null);
  const [dragOver, setDragOver] = useState(false);
  const [toast, setToast] = useState<{
    kind: "ok" | "err";
    message: string;
    resourceId?: string;
  } | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const showToast = useCallback(
    (
      kind: "ok" | "err",
      message: string,
      opts?: { resourceId?: string; durationMs?: number },
    ) => {
      setToast({ kind, message, resourceId: opts?.resourceId });
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = window.setTimeout(
        () => setToast(null),
        opts?.durationMs ?? 5000,
      );
    },
    [],
  );
  const [editorView, setEditorView] = useState<"visual" | "code">(() => {
    try {
      const v = localStorage.getItem("resource-editor-view");
      if (v === "code") return "code";
    } catch {}
    return "visual";
  });
  const [showAgentScratch, setShowAgentScratch] = useState(false);

  useEffect(() => {
    setToolbarDeleteConfirmId(null);
  }, [selectedResourceId]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sharedTreeQuery = useResourceTree("shared", {
    includeAgentScratch: showAgentScratch,
  });
  const personalTreeQuery = useResourceTree("personal", {
    includeAgentScratch: showAgentScratch,
  });
  const workspaceTreeQuery = useResourceTree("workspace");
  const mcpServersQuery = useMcpServers();
  const builtinCapabilitiesQuery = useBuiltinCapabilities();
  const createMcpServer = useCreateMcpServer();
  const deleteMcpServer = useDeleteMcpServer();

  // Merge MCP servers into each scope's tree as a virtual `mcp-servers/`
  // folder. The servers live in the settings store, not the resources
  // table — the virtual ids carry the `mcp:<scope>:<id>` prefix that
  // `handleSelect` and `handleDelete` below recognize to route back to
  // the MCP endpoints.
  const personalTree = withAgentScratchFolder(
    showMcpServers
      ? withMcpServersFolder(
          personalTreeQuery.data ?? [],
          mcpServersQuery.data?.user ?? [],
          {
            builtins: (builtinCapabilitiesQuery.data?.capabilities ?? []).map(
              (capability) => ({ capability, scope: "user" as const }),
            ),
          },
        )
      : (personalTreeQuery.data ?? []),
    { show: showAgentScratch },
  );
  const sharedTree = withAgentScratchFolder(
    showMcpServers
      ? withMcpServersFolder(
          sharedTreeQuery.data ?? [],
          mcpServersQuery.data?.org ?? [],
          {
            builtins: (builtinCapabilitiesQuery.data?.capabilities ?? []).map(
              (capability) => ({ capability, scope: "org" as const }),
            ),
          },
        )
      : (sharedTreeQuery.data ?? []),
    { show: showAgentScratch },
  );
  const workspaceTree = workspaceTreeQuery.data ?? [];
  const visiblePersonalTree = useMemo(
    () => filterResourceTree(personalTree, resourceFilter),
    [personalTree, resourceFilter],
  );
  const visibleSharedTree = useMemo(
    () => filterResourceTree(sharedTree, resourceFilter),
    [resourceFilter, sharedTree],
  );
  const visibleWorkspaceTree = useMemo(
    () => filterResourceTree(workspaceTree, resourceFilter),
    [resourceFilter, workspaceTree],
  );
  const displayedPersonalTree =
    showOnlyRequestedScope && activeScope !== "personal"
      ? []
      : visiblePersonalTree;
  const displayedSharedTree =
    showOnlyRequestedScope && activeScope !== "shared" ? [] : visibleSharedTree;
  const showSharedTree = !showOnlyRequestedScope || activeScope === "shared";
  const showPersonalTree =
    !showOnlyRequestedScope || activeScope === "personal";

  const orgRole = mcpServersQuery.data?.role ?? org?.role ?? null;
  const hasOrgForMcp = !!(mcpServersQuery.data?.orgId ?? org?.orgId);
  const canCreateOrgMcp =
    hasOrgForMcp && (orgRole === "owner" || orgRole === "admin");

  // Virtual MCP server currently selected in the tree (or null for a real
  // resource / nothing). Resolved by scanning both trees' mcp folders for
  // a matching virtual id.
  const selectedMcpServer = React.useMemo(() => {
    const parsed = selectedResourceId
      ? parseMcpVirtualId(selectedResourceId)
      : null;
    if (!parsed) return null;
    const list =
      parsed.scope === "user"
        ? (mcpServersQuery.data?.user ?? [])
        : (mcpServersQuery.data?.org ?? []);
    return list.find((s) => s.id === parsed.serverId) ?? null;
  }, [selectedResourceId, mcpServersQuery.data]);

  const selectedBuiltinCapability = React.useMemo(() => {
    const parsed = selectedResourceId
      ? parseMcpBuiltinVirtualId(selectedResourceId)
      : null;
    if (!parsed) return null;
    const capability = (builtinCapabilitiesQuery.data?.capabilities ?? []).find(
      (item) => item.id === parsed.capabilityId,
    );
    return capability ? { capability, scope: parsed.scope } : null;
  }, [selectedResourceId, builtinCapabilitiesQuery.data]);

  // Sync activeScope once the org role arrives (canEditOrg is resolved async).
  useEffect(() => {
    if (!requestedScope && !canEditOrg && activeScope === "shared") {
      setActiveScope("personal");
    }
  }, [canEditOrg, activeScope, requestedScope]);

  useEffect(() => {
    if (!requestedScope) return;
    setActiveScope(requestedScope);
  }, [requestedScope]);
  // Virtual MCP ids aren't in the resources store — skip the fetch so
  // useResource doesn't 404-flash.
  const resourceQuery = useResource(
    selectedResourceId &&
      !parseMcpVirtualId(selectedResourceId) &&
      !parseMcpBuiltinVirtualId(selectedResourceId)
      ? selectedResourceId
      : null,
  );
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const uploadResource = useUploadResource();
  const selectedResourceReadOnly =
    !!resourceQuery.data &&
    ((resourceQuery.data.owner === WORKSPACE_RESOURCE_OWNER &&
      !isLocalWorkspaceResource(resourceQuery.data)) ||
      (resourceQuery.data.owner === SHARED_RESOURCE_OWNER && !canEditOrg));

  // Ensure AGENTS.md exists in the organization scope when the panel opens.
  // The server also seeds it on table init; this is a safety net. Only attempt
  // for users who can write to organization resources — non-admins would just
  // get a 403.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !canEditOrg) return;
    seededRef.current = true;
    fetch(agentNativePath("/_agent-native/resources"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "AGENTS.md",
        content: DEFAULT_AGENTS_MD_CLIENT,
        shared: true,
        ifNotExists: true,
      }),
    }).catch(() => {});
  }, [canEditOrg]);

  // Are we viewing a file (editor) or the tree?
  const isEditing = selectedResourceId !== null;

  const handleSelect = useCallback((resource: ResourceMeta) => {
    setSelectedResourceId(resource.id);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedResourceId(null);
  }, []);

  const handleCreateFile = useCallback(
    (parentPath: string, name: string, scope: ResourceScope) => {
      const normalizedName = normalizeResourceFileName(name);
      if (!normalizedName) return;
      const path = parentPath
        ? `${parentPath}/${normalizedName}`
        : normalizedName;
      createResource.mutate(
        { path, content: "", shared: scope === "shared" },
        {
          onSuccess: (data) => {
            setSelectedResourceId(data.id);
          },
        },
      );
    },
    [createResource],
  );

  const handleCreateFolder = useCallback(
    (parentPath: string, name: string, scope: ResourceScope) => {
      const path = parentPath ? `${parentPath}/${name}/.keep` : `${name}/.keep`;
      createResource.mutate({ path, content: "", shared: scope === "shared" });
    },
    [createResource],
  );

  const handleCreateFromToolbar = useCallback(
    (targetScope: ResourceScope, name: string) => {
      const normalizedName = normalizeResourceFileName(name);
      if (!normalizedName) return;
      createResource.mutate(
        {
          path: normalizedName,
          content: "",
          shared: targetScope === "shared",
        },
        {
          onSuccess: (data) => {
            setSelectedResourceId(data.id);
          },
        },
      );
    },
    [createResource],
  );

  const handleCreateResourceFromToolbar = useCallback(
    (
      targetScope: ResourceScope,
      path: string,
      content: string,
      mimeType?: string,
      opts?: {
        onSuccess?: (resource: ResourceMeta) => void;
        onError?: (err: unknown) => void;
      },
    ) => {
      createResource.mutate(
        { path, content, mimeType, shared: targetScope === "shared" },
        {
          onSuccess: (data) => {
            setSelectedResourceId(data.id);
            opts?.onSuccess?.(data);
          },
          onError: (err) => {
            opts?.onError?.(err);
          },
        },
      );
    },
    [createResource],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const mcp = parseMcpVirtualId(id);
      if (mcp) {
        deleteMcpServer.mutate(
          { id: mcp.serverId, scope: mcp.scope },
          {
            onSuccess: () => {
              if (selectedResourceId === id) setSelectedResourceId(null);
            },
          },
        );
        return;
      }
      if (parseMcpBuiltinVirtualId(id)) return;
      deleteResource.mutate(id);
      if (selectedResourceId === id) {
        setSelectedResourceId(null);
      }
    },
    [deleteResource, deleteMcpServer, selectedResourceId],
  );

  const handleCreateMcpServer = useCallback(
    async (args: {
      scope: McpServerScope;
      name: string;
      url: string;
      headers?: Record<string, string>;
      description?: string;
    }) => {
      const server = await createMcpServer.mutateAsync(args);
      // Select the newly-created virtual entry so the detail view opens.
      setSelectedResourceId(`mcp:${args.scope}:${server.id}`);
    },
    [createMcpServer],
  );

  const handleRename = useCallback(
    (id: string, newPath: string) => {
      updateResource.mutate({ id, path: newPath });
    },
    [updateResource],
  );

  const handleSave = useCallback(
    (content: string) => {
      if (!selectedResourceId) return;
      if (selectedResourceReadOnly) return;
      updateResource.mutate({ id: selectedResourceId, content });
    },
    [updateResource, selectedResourceId, selectedResourceReadOnly],
  );

  const handleUploadFiles = useCallback(
    (files: FileList, targetScope: ResourceScope) => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("shared", targetScope === "shared" ? "true" : "false");
        uploadResource.mutate(formData);
      }
    },
    [uploadResource],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        handleUploadFiles(e.dataTransfer.files, activeScope);
      }
    },
    [activeScope, handleUploadFiles],
  );

  const renderScopeCreateMenu = (targetScope: ResourceScope) => {
    if (resourceFilter !== "agents" && resourceFilter !== "skills") {
      return null;
    }
    if (targetScope === "shared" && !canEditOrg) return null;
    return (
      <CreateMenu
        scope={targetScope}
        resourceFilter={resourceFilter}
        onCreateFile={(name) => handleCreateFromToolbar(targetScope, name)}
        onCreateResource={(path, content, mimeType, opts) =>
          handleCreateResourceFromToolbar(
            targetScope,
            path,
            content,
            mimeType,
            opts,
          )
        }
        onCreateMcpServer={handleCreateMcpServer}
        canCreateOrgMcp={canCreateOrgMcp}
        hasOrg={hasOrgForMcp}
        showToast={showToast}
        mcpIntegrations={mcpIntegrations}
      />
    );
  };

  const renderEmptyStateAction = (targetScope: ResourceScope) => {
    if (targetScope === "shared" && !canEditOrg) return null;

    const label = resourceFilter
      ? EMPTY_RESOURCE_ACTION_LABELS[resourceFilter]
      : "Add resource";

    if (
      !resourceFilter ||
      resourceFilter === "files" ||
      resourceFilter === "agents" ||
      resourceFilter === "skills"
    ) {
      return (
        <CreateMenu
          scope={targetScope}
          resourceFilter={resourceFilter}
          onCreateFile={(name) => handleCreateFromToolbar(targetScope, name)}
          onCreateResource={(path, content, mimeType, opts) =>
            handleCreateResourceFromToolbar(
              targetScope,
              path,
              content,
              mimeType,
              opts,
            )
          }
          onCreateMcpServer={handleCreateMcpServer}
          canCreateOrgMcp={canCreateOrgMcp}
          hasOrg={hasOrgForMcp}
          showToast={showToast}
          mcpIntegrations={mcpIntegrations}
          triggerVariant="outline"
          triggerLabel={label}
          initialView={resourceFilter === "files" ? "file" : "menu"}
        />
      );
    }

    const seed = EMPTY_RESOURCE_SEEDS[resourceFilter];
    if (!seed) return null;

    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 px-2.5 text-xs"
        disabled={createResource.isPending}
        onClick={() =>
          handleCreateResourceFromToolbar(
            targetScope,
            seed.path,
            seed.content,
            seed.mimeType,
          )
        }
      >
        <IconPlus className="size-3.5" />
        {label}
      </Button>
    );
  };

  return (
    <div
      className={cn(
        "relative flex h-full flex-col min-h-0",
        dragOver && "ring-2 ring-inset ring-accent",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      {isEditing ? (
        <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleBack}
                    aria-label={t("agentResources.backToResources")}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  >
                    <IconArrowLeft className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("agentResources.backToResources")}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {selectedMcpServer ? (
              <PathBreadcrumb
                path={`mcp-servers/${selectedMcpServer.name}.json`}
              />
            ) : selectedBuiltinCapability ? (
              <PathBreadcrumb
                path={`mcp-servers/${selectedBuiltinCapability.capability.name}.json`}
              />
            ) : resourceQuery.data ? (
              <PathBreadcrumb path={resourceQuery.data.path} />
            ) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!selectedMcpServer &&
              resourceQuery.data &&
              selectedResourceReadOnly && (
                <span
                  aria-live="polite"
                  className="mr-1 w-16 text-right text-[11px] text-muted-foreground/60"
                >
                  Read only
                </span>
              )}
            {!selectedMcpServer &&
              resourceQuery.data &&
              (resourceQuery.data.mimeType === "text/markdown" ||
                resourceQuery.data.path.endsWith(".md")) && (
                <div className="flex items-center gap-0.5 mr-1">
                  <TooltipProvider delayDuration={200}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setEditorView("visual")}
                          aria-label="Visual editor"
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md",
                            editorView === "visual"
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                          )}
                        >
                          <IconEye className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Visual editor</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setEditorView("code")}
                          aria-label="Code editor"
                          className={cn(
                            "flex h-6 w-6 items-center justify-center rounded-md",
                            editorView === "code"
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                          )}
                        >
                          <IconCode className="h-3.5 w-3.5" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>Code editor</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              )}
            {!selectedBuiltinCapability && !selectedResourceReadOnly && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (!selectedResourceId) return;
                        if (toolbarDeleteConfirmId === selectedResourceId) {
                          handleDelete(selectedResourceId);
                          setToolbarDeleteConfirmId(null);
                        } else {
                          setToolbarDeleteConfirmId(selectedResourceId);
                        }
                      }}
                      aria-label={
                        toolbarDeleteConfirmId === selectedResourceId
                          ? "Confirm delete resource"
                          : "Delete resource"
                      }
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent/50",
                        toolbarDeleteConfirmId === selectedResourceId &&
                          "bg-destructive/10 text-destructive",
                      )}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {toolbarDeleteConfirmId === selectedResourceId
                      ? "Click again to delete"
                      : "Delete resource"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        </div>
      ) : (
        /* Floating action buttons — absolute top-right over tree view */
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
          {(!resourceFilter || resourceFilter === "files") && (
            <CreateMenu
              scope={activeScope}
              resourceFilter={resourceFilter}
              onCreateFile={(name) =>
                handleCreateFromToolbar(activeScope, name)
              }
              onCreateResource={(path, content, mimeType, opts) =>
                handleCreateResourceFromToolbar(
                  activeScope,
                  path,
                  content,
                  mimeType,
                  opts,
                )
              }
              onCreateMcpServer={handleCreateMcpServer}
              canCreateOrgMcp={canCreateOrgMcp}
              hasOrg={hasOrgForMcp}
              showToast={showToast}
              mcpIntegrations={mcpIntegrations}
            />
          )}
          {(!resourceFilter || resourceFilter === "files") && (
            <>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      aria-label="Upload file"
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
                    >
                      <IconUpload className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Upload file</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setShowAgentScratch((value) => !value)}
                      aria-label={
                        showAgentScratch
                          ? "Hide agent scratch files"
                          : "Show agent scratch files"
                      }
                      className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
                        showAgentScratch && "bg-accent/50 text-foreground",
                      )}
                    >
                      <IconEye className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {showAgentScratch
                      ? "Hide agent scratch files"
                      : "Show agent scratch files"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleUploadFiles(e.target.files, activeScope);
                e.target.value = "";
              }
            }}
          />
        </div>
      )}

      {/* Content: either tree OR editor (single view) */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {isEditing ? (
          selectedMcpServer ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <McpServerDetail server={selectedMcpServer} />
            </div>
          ) : selectedBuiltinCapability ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <BuiltinCapabilityDetail
                capability={selectedBuiltinCapability.capability}
                scope={selectedBuiltinCapability.scope}
                canEditOrg={canEditOrg}
              />
            </div>
          ) : selectedResourceId && resourceQuery.data ? (
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              <ResourceEditor
                resource={resourceQuery.data}
                onSave={handleSave}
                view={editorView}
                onViewChange={setEditorView}
                hideToolbar
                readOnly={selectedResourceReadOnly}
              />
            </div>
          ) : resourceQuery.isError ? (
            <div className="flex flex-1 items-center justify-center text-[12px] text-destructive/70">
              Failed to load resource
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/50">
              Loading...
            </div>
          )
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {visibleWorkspaceTree.length > 0 && (
              <ResourceTree
                tree={visibleWorkspaceTree}
                variant={resourceTreeVariant}
                isLoading={workspaceTreeQuery.isLoading}
                deletingId={
                  deleteResource.isPending
                    ? (deleteResource.variables as string)
                    : deleteMcpServer.isPending
                      ? `mcp:${(deleteMcpServer.variables as { scope: string }).scope}:${(deleteMcpServer.variables as { id: string }).id}`
                      : null
                }
                selectedId={selectedResourceId}
                onSelect={handleSelect}
                onCreateFile={() => {}}
                onCreateFolder={() => {}}
                onDelete={() => {}}
                onRename={() => {}}
                onDrop={() => {}}
                title="Workspace"
                titleTooltip="Global resources inherited by every app. Dispatch resources are read-only; local file mode resources can be edited here."
                readOnly
                headingHint="Inherited"
              />
            )}
            {showPersonalTree && (
              <ResourceTree
                tree={displayedPersonalTree}
                variant={resourceTreeVariant}
                isLoading={personalTreeQuery.isLoading}
                deletingId={
                  deleteResource.isPending
                    ? (deleteResource.variables as string)
                    : deleteMcpServer.isPending
                      ? `mcp:${(deleteMcpServer.variables as { scope: string }).scope}:${(deleteMcpServer.variables as { id: string }).id}`
                      : null
                }
                selectedId={selectedResourceId}
                onSelect={handleSelect}
                onCreateFile={(parentPath, name) =>
                  handleCreateFile(parentPath, name, "personal")
                }
                onCreateFolder={(parentPath, name) =>
                  handleCreateFolder(parentPath, name, "personal")
                }
                onDelete={handleDelete}
                onRename={handleRename}
                onDrop={(files) => handleUploadFiles(files, "personal")}
                title="Personal"
                titleTooltip="Files visible only to you"
                sectionAction={renderScopeCreateMenu("personal")}
                emptyStateAction={renderEmptyStateAction("personal")}
              />
            )}
            {showSharedTree && (
              <ResourceTree
                tree={displayedSharedTree}
                variant={resourceTreeVariant}
                isLoading={sharedTreeQuery.isLoading}
                deletingId={
                  deleteResource.isPending
                    ? (deleteResource.variables as string)
                    : deleteMcpServer.isPending
                      ? `mcp:${(deleteMcpServer.variables as { scope: string }).scope}:${(deleteMcpServer.variables as { id: string }).id}`
                      : null
                }
                selectedId={selectedResourceId}
                onSelect={handleSelect}
                onCreateFile={(parentPath, name) =>
                  handleCreateFile(parentPath, name, "shared")
                }
                onCreateFolder={(parentPath, name) =>
                  handleCreateFolder(parentPath, name, "shared")
                }
                onDelete={handleDelete}
                onRename={handleRename}
                onDrop={(files) => handleUploadFiles(files, "shared")}
                title="Organization"
                titleTooltip={
                  canEditOrg
                    ? "Files visible to everyone in your organization"
                    : "Files visible to everyone in your organization. Read-only — only admins can edit."
                }
                readOnly={!canEditOrg}
                headingHint={!canEditOrg ? "Read only" : undefined}
                sectionAction={renderScopeCreateMenu("shared")}
                emptyStateAction={renderEmptyStateAction("shared")}
              />
            )}
          </div>
        )}
      </div>
      {toast && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-[300] -translate-x-1/2">
          <div
            role="status"
            className={cn(
              "pointer-events-auto flex max-w-[320px] items-center gap-3 rounded-md border px-3 py-2 text-[12px] shadow-md",
              toast.kind === "ok"
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                : "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-300",
            )}
          >
            <span className="min-w-0 flex-1 truncate">{toast.message}</span>
            {toast.kind === "ok" && toast.resourceId && (
              <button
                type="button"
                onClick={() => {
                  setSelectedResourceId(toast.resourceId!);
                  setToast(null);
                }}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium underline-offset-2 hover:underline"
              >
                View
              </button>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setToast(null)}
              className="shrink-0 text-current/60 hover:text-current"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
