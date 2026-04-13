import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  IconPlus,
  IconUpload,
  IconArrowLeft,
  IconSparkles,
  IconTrash,
  IconEye,
  IconCode,
  IconClock,
  IconMessageChatbot,
  IconBuildingSkyscraper,
  IconBrowser,
  IconExternalLink,
  IconLoader2,
  IconHelp,
} from "@tabler/icons-react";
import { cn } from "../utils.js";
import { sendToAgentChat } from "../agent-chat.js";
import { ResourceTree } from "./ResourceTree.js";
import { ResourceEditor } from "./ResourceEditor.js";
import { serializeFrontmatter } from "../../resources/metadata.js";
import {
  useResourceTree,
  useResource,
  useCreateResource,
  useUpdateResource,
  useDeleteResource,
  useUploadResource,
  type ResourceScope,
  type ResourceMeta,
} from "./use-resources.js";

// ─── Create Menu (unified + button) ────────────────────────────────────────

type CreateMenuView =
  | "menu"
  | "file"
  | "skill"
  | "job"
  | "agent-mode"
  | "agent-prompt"
  | "agent-form";

const AGENT_MODEL_OPTIONS = [
  { value: "inherit", label: "Default model" },
  { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
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
  onCreateFile,
  onCreateResource,
  onCreated,
}: {
  scope: ResourceScope;
  onCreateFile: (name: string) => void;
  onCreateResource: (path: string, content: string, mimeType?: string) => void;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<CreateMenuView>("menu");
  const [value, setValue] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentModel, setAgentModel] = useState<string>("inherit");
  const [agentInstructions, setAgentInstructions] = useState(
    `# Role\n\nDefine how this agent should work.\n\n## Focus\n\n- What kinds of tasks it should handle\n- What tone or approach it should use\n- Important constraints or preferences\n`,
  );
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setView("menu");
      setValue("");
      setAgentName("");
      setAgentDescription("");
      setAgentModel("inherit");
      setAgentInstructions(
        `# Role\n\nDefine how this agent should work.\n\n## Focus\n\n- What kinds of tasks it should handle\n- What tone or approach it should use\n- Important constraints or preferences\n`,
      );
    }
  }, [open]);

  useEffect(() => {
    if (view !== "menu" && view !== "agent-form") {
      setValue("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [view]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (view !== "menu") {
          setView("menu");
        } else {
          setOpen(false);
        }
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, view]);

  const submitFile = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onCreateFile(trimmed);
      setOpen(false);
    }
  };

  const submitSkill = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a skill: ${trimmed}`,
      context: `The user wants to create an agent skill. Their description: "${trimmed}"

Follow the create-skill pattern to build this. Before writing:

1. **Determine the skill name** — derive a hyphen-case name from the description (e.g. "code review" → "code-review")
2. **Determine the skill type** — Pattern (architectural rule), Workflow (step-by-step), or Generator (scaffolding)
3. **Write the skill** as a ${scope} resource at path "skills/<name>.md" using resource-write

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

  const submitJob = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a recurring job: ${trimmed}`,
      context: `The user wants to create a recurring job. Their description: "${trimmed}"

Use the create-job tool to create this. You need to:
1. Derive a hyphen-case name from the description
2. Convert the schedule to a cron expression (e.g., "every weekday at 9am" → "0 9 * * 1-5")
3. Write clear, self-contained instructions for what the agent should do each time the job runs
4. Create it in ${scope} scope

The job will run automatically on the schedule. Make the instructions specific — include which actions to call and what to do with results.`,
      submit: true,
    });

    setOpen(false);
  };

  const submitAgentPrompt = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a custom agent: ${trimmed}`,
      context: `The user wants a reusable custom sub-agent profile for the workspace. Their description: "${trimmed}"

Create it as a ${scope} resource under "agents/<name>.md" using resource-write.

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
  }[] = [
    {
      icon: <IconPlus className="h-3.5 w-3.5" />,
      label: "Create File",
      desc: "Add a new file at a path",
      action: () => setView("file"),
    },
    {
      icon: <IconSparkles className="h-3.5 w-3.5" />,
      label: "Create Skill",
      desc: "Teach the agent a new ability",
      action: () => setView("skill"),
    },
    {
      icon: <IconClock className="h-3.5 w-3.5" />,
      label: "Scheduled Task",
      desc: "Run something on a schedule",
      action: () => setView("job"),
    },
    {
      icon: <IconMessageChatbot className="h-3.5 w-3.5" />,
      label: "Create Agent",
      desc: "Add a reusable sub-agent profile",
      action: () => setView("agent-mode"),
    },
  ];

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
          open && "bg-accent/50 text-foreground",
        )}
        title="Create new..."
      >
        <IconPlus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 z-[220] rounded-lg border border-border bg-popover shadow-lg"
          style={{ width: 260, fontSize: 13, lineHeight: "normal" }}
        >
          {view === "menu" && (
            <div className="py-1">
              {menuItems.map((item) => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent/50"
                >
                  <span className="text-muted-foreground">{item.icon}</span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-foreground">
                      {item.label}
                    </div>
                    <div className="text-[10px] text-muted-foreground/60">
                      {item.desc}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {view === "file" && (
            <div className="p-3">
              <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
                File path
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
                placeholder="notes/ideas.md"
              />
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={submitFile}
                  disabled={!value.trim()}
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
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitSkill();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setView("menu");
                  }
                }}
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="e.g. A skill that reviews PRs for security issues and OWASP top 10 vulnerabilities"
              />
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={submitSkill}
                  disabled={!value.trim()}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {view === "job" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Scheduled Task
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Describe what should happen and when.
              </p>
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitJob();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setView("menu");
                  }
                }}
                rows={3}
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="e.g. Every weekday at 9am, check for overdue scorecards and send a Slack update"
              />
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={submitJob}
                  disabled={!value.trim()}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Create
                </button>
              </div>
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
                  <IconSparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
                  <IconMessageChatbot className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submitAgentPrompt();
                  }
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setView("agent-mode");
                  }
                }}
                rows={4}
                className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                placeholder="e.g. A design agent that critiques layouts, suggests UI direction, and prefers concise product reasoning"
              />
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={submitAgentPrompt}
                  disabled={!value.trim()}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  Create
                </button>
              </div>
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
        </div>
      )}
    </div>
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

Create skill files under \`skills/\` to give the agent specialized knowledge. Reference them here:

| Skill | Path | Description |
|-------|------|-------------|
| *(use the skill button to create one)* | | |
`;

// BuilderBrowserCard moved to settings/BrowserSection.tsx

export function ResourcesPanel() {
  const [activeScope, setActiveScope] = useState<ResourceScope>("shared");
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const [editorView, setEditorView] = useState<"visual" | "code">(() => {
    try {
      const v = localStorage.getItem("resource-editor-view");
      if (v === "code") return "code";
    } catch {}
    return "visual";
  });
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">(
    "idle",
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sharedTreeQuery = useResourceTree("shared");
  const personalTreeQuery = useResourceTree("personal");
  const resourceQuery = useResource(selectedResourceId);
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const uploadResource = useUploadResource();

  // Ensure AGENTS.md exists in shared scope when panel opens.
  // Uses the server's /_agent-native/resources endpoint which handles dedup via INSERT OR IGNORE.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    fetch("/_agent-native/resources", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "AGENTS.md",
        content: DEFAULT_AGENTS_MD_CLIENT,
        shared: true,
        ifNotExists: true,
      }),
    }).catch(() => {});
  }, []);

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
      const path = parentPath ? `${parentPath}/${name}` : name;
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
    (name: string) => {
      createResource.mutate(
        { path: name, content: "", shared: activeScope === "shared" },
        {
          onSuccess: (data) => {
            setSelectedResourceId(data.id);
          },
        },
      );
    },
    [createResource, activeScope],
  );

  const handleCreateResourceFromToolbar = useCallback(
    (path: string, content: string, mimeType?: string) => {
      createResource.mutate(
        { path, content, mimeType, shared: activeScope === "shared" },
        {
          onSuccess: (data) => {
            setSelectedResourceId(data.id);
          },
        },
      );
    },
    [activeScope, createResource],
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteResource.mutate(id);
      if (selectedResourceId === id) {
        setSelectedResourceId(null);
      }
    },
    [deleteResource, selectedResourceId],
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
      updateResource.mutate({ id: selectedResourceId, content });
    },
    [updateResource, selectedResourceId],
  );

  const handleUploadFiles = useCallback(
    (files: FileList) => {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);
        formData.append("shared", activeScope === "shared" ? "true" : "false");
        uploadResource.mutate(formData);
      }
    },
    [uploadResource, activeScope],
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
        handleUploadFiles(e.dataTransfer.files);
      }
    },
    [handleUploadFiles],
  );

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
            <button
              onClick={handleBack}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
              title="Back to workspace"
            >
              <IconArrowLeft className="h-3.5 w-3.5" />
            </button>
            {resourceQuery.data && (
              <PathBreadcrumb path={resourceQuery.data.path} />
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {resourceQuery.data &&
              (resourceQuery.data.mimeType === "text/markdown" ||
                resourceQuery.data.path.endsWith(".md")) && (
                <div className="flex items-center gap-0.5 mr-1">
                  <button
                    onClick={() => setEditorView("visual")}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md",
                      editorView === "visual"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    )}
                    title="Visual editor"
                  >
                    <IconEye className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => setEditorView("code")}
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-md",
                      editorView === "code"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                    )}
                    title="Code editor"
                  >
                    <IconCode className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            <span className="text-[11px] text-muted-foreground/60 mr-1">
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved"
                  : ""}
            </span>
            <button
              onClick={() => {
                if (selectedResourceId) handleDelete(selectedResourceId);
              }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent/50"
              title="Delete resource"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        /* Floating action buttons — absolute top-right over tree view */
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
          <CreateMenu
            scope={activeScope}
            onCreateFile={handleCreateFromToolbar}
            onCreateResource={handleCreateResourceFromToolbar}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
            title="Upload file"
          >
            <IconUpload className="h-3.5 w-3.5" />
          </button>
          <a
            href="https://www.builder.io/c/docs/agent-native-resources"
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
            title="What is the Workspace? — open docs"
          >
            <IconHelp className="h-3.5 w-3.5" />
          </a>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                handleUploadFiles(e.target.files);
                e.target.value = "";
              }
            }}
          />
        </div>
      )}

      {/* Content: either tree OR editor (single view) */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {isEditing ? (
          /* Editor view */
          selectedResourceId && resourceQuery.data ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <ResourceEditor
                resource={resourceQuery.data}
                onSave={handleSave}
                view={editorView}
                onViewChange={setEditorView}
                onSaveStatusChange={setSaveStatus}
                hideToolbar
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
        ) : /* Tree view — both sections */
        sharedTreeQuery.isLoading && personalTreeQuery.isLoading ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5">
                <div
                  className="h-3.5 w-3.5 rounded bg-muted-foreground/10 animate-pulse"
                  style={{ animationDelay: `${i * 75}ms` }}
                />
                <div
                  className="h-3 rounded bg-muted-foreground/10 animate-pulse"
                  style={{
                    width: `${50 + ((i * 37) % 40)}%`,
                    animationDelay: `${i * 75}ms`,
                  }}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {(personalTreeQuery.data ?? []).length === 0 &&
              (sharedTreeQuery.data ?? []).length === 0 && (
                <div className="mx-2 mt-2 rounded-md border border-border bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground">
                    This is your Workspace
                  </p>
                  <p className="mb-1.5 leading-snug">
                    Files the agent reads and writes — notes, instructions,
                    skills, custom agents, scheduled jobs. They live in the
                    database, so they persist across sessions and deploys.
                  </p>
                  <p className="mb-2 leading-snug">
                    <span className="text-foreground">Personal</span> is just
                    for you. <span className="text-foreground">Shared</span> is
                    visible across your team.
                  </p>
                  <a
                    href="https://www.builder.io/c/docs/agent-native-resources"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-foreground hover:underline"
                  >
                    Learn more
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            <ResourceTree
              tree={personalTreeQuery.data ?? []}
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
              onDrop={handleUploadFiles}
              title="Personal"
              titleTooltip="Files visible only to you"
            />
            <ResourceTree
              tree={sharedTreeQuery.data ?? []}
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
              onDrop={handleUploadFiles}
              title="Shared"
              titleTooltip="Files shared across the organization"
            />
          </div>
        )}
      </div>
    </div>
  );
}
