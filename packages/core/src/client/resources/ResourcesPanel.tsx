import React, { useState, useRef, useCallback, useEffect } from "react";
import { cn } from "../utils.js";
import { sendToAgentChat } from "../agent-chat.js";
import { ResourceTree } from "./ResourceTree.js";
import { ResourceEditor } from "./ResourceEditor.js";
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

// ─── Icons ──────────────────────────────────────────────────────────────────

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function UploadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FileIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function ArrowLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

function SkillIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}

// ─── New Skill Popover ──────────────────────────────────────────────────────

function NewSkillPopover({
  scope,
  onCreated,
}: {
  scope: ResourceScope;
  onCreated?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

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
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const submit = () => {
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

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
          open && "bg-accent/50 text-foreground",
        )}
        title="Create a skill"
      >
        <SkillIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 z-[220] rounded-lg border border-border bg-popover p-3 shadow-lg"
          style={{
            width: 280,
            fontSize: 13,
            lineHeight: "normal",
          }}
        >
          <label className="mb-1 block text-[11px] font-semibold text-foreground">
            Skill Creator
          </label>
          <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
            Describe what kind of skill you want and the agent will create it.
          </p>
          <textarea
            ref={inputRef as any}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
              if (e.key === "Escape") setOpen(false);
            }}
            rows={3}
            className="w-full resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="e.g. A skill that reviews PRs for security issues and OWASP top 10 vulnerabilities"
          />
          <div className="mt-2.5 flex justify-end">
            <button
              onClick={submit}
              disabled={!value.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── New File Popover ───────────────────────────────────────────────────────

function NewFilePopover({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Close on outside click
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

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(!open)}
        className={cn(
          "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50",
          open && "bg-accent/50 text-foreground",
        )}
        title="New resource"
      >
        <PlusIcon className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="absolute right-0 top-full mt-1.5 z-[220] rounded-lg border border-border bg-popover p-3 shadow-lg"
          style={{
            width: 240,
            fontSize: 13,
            lineHeight: "normal",
          }}
        >
          <label className="mb-1.5 block text-[11px] font-medium text-muted-foreground">
            File path
          </label>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setOpen(false);
            }}
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
            placeholder="notes/ideas.md"
          />
          <div className="mt-2.5 flex justify-end">
            <button
              onClick={submit}
              disabled={!value.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
            >
              Create
            </button>
          </div>
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

const CONTROL_STYLE = { fontSize: 12, lineHeight: 1 } as const;

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

export function ResourcesPanel() {
  const [scope, setScope] = useState<ResourceScope>(
    () =>
      (localStorage.getItem("an:resources-scope") as ResourceScope) || "shared",
  );
  const handleSetScope = (s: ResourceScope) => {
    setScope(s);
    localStorage.setItem("an:resources-scope", s);
  };
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const treeQuery = useResourceTree(scope);
  const resourceQuery = useResource(selectedResourceId);
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const uploadResource = useUploadResource();

  // Ensure AGENTS.md exists in shared scope when panel opens.
  // Uses the server's /api/resources endpoint which handles dedup via INSERT OR IGNORE.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    fetch("/api/resources", {
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
    (parentPath: string, name: string) => {
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
    [createResource, scope],
  );

  const handleCreateFolder = useCallback(
    (parentPath: string, name: string) => {
      const path = parentPath ? `${parentPath}/${name}/.keep` : `${name}/.keep`;
      createResource.mutate({ path, content: "", shared: scope === "shared" });
    },
    [createResource, scope],
  );

  const handleCreateFromToolbar = useCallback(
    (name: string) => {
      createResource.mutate(
        { path: name, content: "", shared: scope === "shared" },
        {
          onSuccess: (data) => {
            setSelectedResourceId(data.id);
          },
        },
      );
    },
    [createResource, scope],
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
        formData.append("shared", scope === "shared" ? "true" : "false");
        uploadResource.mutate(formData);
      }
    },
    [uploadResource, scope],
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
        "flex h-full flex-col min-h-0",
        dragOver && "ring-2 ring-inset ring-accent",
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1.5">
        {isEditing ? (
          /* Editor toolbar: back button + path */
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              <button
                onClick={handleBack}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
                title="Back to files"
              >
                <ArrowLeftIcon className="h-3.5 w-3.5" />
              </button>
              {resourceQuery.data && (
                <PathBreadcrumb path={resourceQuery.data.path} />
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => {
                  if (selectedResourceId) handleDelete(selectedResourceId);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent/50"
                title="Delete resource"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          </>
        ) : (
          /* Tree toolbar: scope toggle + new/upload */
          <>
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleSetScope("personal")}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] leading-none",
                  scope === "personal"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={CONTROL_STYLE}
              >
                Personal
              </button>
              <button
                onClick={() => handleSetScope("shared")}
                className={cn(
                  "rounded-md px-2 py-1 text-[12px] leading-none",
                  scope === "shared"
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                style={CONTROL_STYLE}
              >
                Shared
              </button>
            </div>
            <div className="flex items-center gap-1">
              <NewSkillPopover scope={scope} />
              <NewFilePopover onSubmit={handleCreateFromToolbar} />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
                title="Upload file"
              >
                <UploadIcon className="h-3.5 w-3.5" />
              </button>
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
          </>
        )}
      </div>

      {/* Content: either tree OR editor (single view) */}
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {isEditing ? (
          /* Editor view */
          selectedResourceId && resourceQuery.data ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <ResourceEditor
                resource={resourceQuery.data}
                onSave={handleSave}
              />
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/50">
              Loading...
            </div>
          )
        ) : /* Tree view */
        treeQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-muted-foreground/50">
            Loading...
          </div>
        ) : treeQuery.error ? (
          <div className="flex flex-1 items-center justify-center text-[12px] text-destructive/70">
            Failed to load
          </div>
        ) : (
          <ResourceTree
            tree={treeQuery.data ?? []}
            selectedId={selectedResourceId}
            onSelect={handleSelect}
            onCreateFile={handleCreateFile}
            onCreateFolder={handleCreateFolder}
            onDelete={handleDelete}
            onRename={handleRename}
            onDrop={handleUploadFiles}
          />
        )}
      </div>
    </div>
  );
}

// Re-used from ResourceTree but needed here for delete button
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}
