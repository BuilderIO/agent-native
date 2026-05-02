import { agentNativePath } from "../api-path.js";
import React, { useState, useRef, useCallback, useEffect } from "react";
import {
  IconPlus,
  IconUpload,
  IconArrowLeft,
  IconWand,
  IconBulb,
  IconBolt,
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
  IconPlugConnected,
  IconCheck,
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
  withMcpServersFolder,
  withAgentScratchFolder,
  type ResourceScope,
  type ResourceMeta,
} from "./use-resources.js";
import {
  useMcpServers,
  useCreateMcpServer,
  useDeleteMcpServer,
  testMcpServerUrl,
  parseMcpVirtualId,
  type McpServerScope,
} from "./use-mcp-servers.js";
import { McpServerDetail } from "./McpServerDetail.js";
import { useOrg } from "../org/hooks.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../components/ui/tooltip.js";

const WORKSPACE_DOCS_URL = "https://agent-native.com/docs/workspace";

// ─── Create Menu (unified + button) ────────────────────────────────────────

type CreateMenuView =
  | "menu"
  | "file"
  | "skill"
  | "job"
  | "agent-mode"
  | "agent-prompt"
  | "agent-form"
  | "mcp-server";

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
  onCreateMcpServer,
  canCreateOrgMcp,
  hasOrg,
  onCreated,
}: {
  scope: ResourceScope;
  onCreateFile: (name: string) => void;
  onCreateResource: (path: string, content: string, mimeType?: string) => void;
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
  const defaultMcpScope: McpServerScope =
    scope === "shared" && canCreateOrgMcp ? "org" : "user";
  const [mcpScope, setMcpScope] = useState<McpServerScope>(defaultMcpScope);
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpDescription, setMcpDescription] = useState("");
  const [mcpHeadersText, setMcpHeadersText] = useState("");
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpError, setMcpError] = useState<string | null>(null);
  const [mcpTestResult, setMcpTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
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
      setMcpScope(defaultMcpScope);
      setMcpName("");
      setMcpUrl("");
      setMcpDescription("");
      setMcpHeadersText("");
      setMcpError(null);
      setMcpTestResult(null);
      setMcpBusy(false);
    }
  }, [open, defaultMcpScope]);

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
      newTab: true,
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

  const submitAgentPrompt = () => {
    const trimmed = value.trim();
    if (!trimmed) return;

    sendToAgentChat({
      message: `Create a custom agent: ${trimmed}`,
      newTab: true,
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

  const parseHeaderLines = (
    text: string,
  ): Record<string, string> | undefined => {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!key || !value) continue;
      out[key] = value;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };

  const submitMcpServer = async () => {
    const name = mcpName.trim();
    const url = mcpUrl.trim();
    if (!name || !url || mcpBusy) return;
    setMcpError(null);
    setMcpBusy(true);
    try {
      await onCreateMcpServer({
        scope: mcpScope,
        name,
        url,
        headers: parseHeaderLines(mcpHeadersText),
        description: mcpDescription.trim() || undefined,
      });
      setOpen(false);
      onCreated?.();
    } catch (err: any) {
      setMcpError(err?.message ?? String(err));
    } finally {
      setMcpBusy(false);
    }
  };

  const runMcpTest = async () => {
    const url = mcpUrl.trim();
    if (!url || mcpBusy) return;
    setMcpTestResult(null);
    setMcpError(null);
    setMcpBusy(true);
    try {
      const res = await testMcpServerUrl(url, parseHeaderLines(mcpHeadersText));
      if (res.ok) {
        setMcpTestResult({
          ok: true,
          message: `${res.toolCount ?? 0} tool${res.toolCount === 1 ? "" : "s"} available`,
        });
      } else {
        setMcpTestResult({ ok: false, message: res.error ?? "Failed" });
      }
    } catch (err: any) {
      setMcpTestResult({ ok: false, message: err?.message ?? String(err) });
    } finally {
      setMcpBusy(false);
    }
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
      icon: <IconBulb className="h-3.5 w-3.5" />,
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
    {
      icon: <IconPlugConnected className="h-3.5 w-3.5" />,
      label: "Connect MCP Server",
      desc: "Expose external tools to the agent",
      action: () => setView("mcp-server"),
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
                    <div className="mt-0.5 text-[10px] text-muted-foreground/60">
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
                  <IconWand className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
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

          {view === "mcp-server" && (
            <div className="p-3">
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Connect MCP Server
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Point at any Streamable HTTP MCP server (Zapier, Cloudflare,
                internal tools). Its tools become available to the agent.{" "}
                <a
                  href="https://agent-native.com/docs/mcp-clients#remote-via-ui"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-muted-foreground/80 underline hover:text-foreground"
                >
                  Learn more
                  <IconExternalLink className="inline h-2.5 w-2.5" />
                </a>
              </p>
              <div className="space-y-2">
                <div className="flex gap-1 rounded-md border border-border p-0.5">
                  <button
                    type="button"
                    onClick={() => setMcpScope("user")}
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-[11px] font-medium",
                      mcpScope === "user"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Personal
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      hasOrg && canCreateOrgMcp && setMcpScope("org")
                    }
                    disabled={!hasOrg || !canCreateOrgMcp}
                    title={
                      !hasOrg
                        ? "Join an organization to share MCP servers"
                        : !canCreateOrgMcp
                          ? "Only owners and admins can add org-scope servers"
                          : undefined
                    }
                    className={cn(
                      "flex-1 rounded px-2 py-1 text-[11px] font-medium",
                      mcpScope === "org"
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                      (!hasOrg || !canCreateOrgMcp) &&
                        "cursor-not-allowed opacity-40 hover:text-muted-foreground",
                    )}
                  >
                    Organization
                  </button>
                </div>
                <input
                  value={mcpName}
                  onChange={(e) => setMcpName(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  placeholder="Server name (e.g. zapier)"
                />
                <input
                  value={mcpUrl}
                  onChange={(e) => setMcpUrl(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  placeholder="https://mcp.example.com/"
                />
                <input
                  value={mcpDescription}
                  onChange={(e) => setMcpDescription(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  placeholder="Description (optional)"
                />
                <label className="block text-[10px] font-medium text-muted-foreground/70">
                  Headers (one per line, e.g. Authorization: Bearer …)
                </label>
                <textarea
                  value={mcpHeadersText}
                  onChange={(e) => setMcpHeadersText(e.target.value)}
                  rows={2}
                  className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-accent"
                  style={{
                    fontFamily:
                      'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                  }}
                  placeholder="Authorization: Bearer sk-..."
                />
                {mcpTestResult && (
                  <div
                    className={cn(
                      "flex items-center gap-1 text-[11px]",
                      mcpTestResult.ok
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400",
                    )}
                  >
                    {mcpTestResult.ok && <IconCheck className="h-3 w-3" />}
                    {mcpTestResult.message}
                  </div>
                )}
                {mcpError && (
                  <div className="text-[11px] text-red-600 dark:text-red-400">
                    {mcpError}
                  </div>
                )}
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={runMcpTest}
                  disabled={!mcpUrl.trim() || mcpBusy}
                  className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent disabled:opacity-40 disabled:pointer-events-none"
                >
                  Test
                </button>
                <button
                  type="button"
                  onClick={submitMcpServer}
                  disabled={!mcpName.trim() || !mcpUrl.trim() || mcpBusy}
                  className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-foreground hover:bg-accent/80 disabled:opacity-40 disabled:pointer-events-none"
                >
                  {mcpBusy ? (
                    <IconLoader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Connect"
                  )}
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
  const { data: org } = useOrg();
  // Non-admin org members get read-only access to organization resources.
  // Solo deployments (no orgId) behave as owner — users can edit their own.
  const canEditOrg =
    !org?.orgId || org.role === "owner" || org.role === "admin";

  const [activeScope, setActiveScope] = useState<ResourceScope>(
    canEditOrg ? "shared" : "personal",
  );
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
  const mcpServersQuery = useMcpServers();
  const createMcpServer = useCreateMcpServer();
  const deleteMcpServer = useDeleteMcpServer();

  // Merge MCP servers into each scope's tree as a virtual `mcp-servers/`
  // folder. The servers live in the settings store, not the resources
  // table — the virtual ids carry the `mcp:<scope>:<id>` prefix that
  // `handleSelect` and `handleDelete` below recognize to route back to
  // the MCP endpoints.
  const personalTree = withAgentScratchFolder(
    withMcpServersFolder(
      personalTreeQuery.data ?? [],
      mcpServersQuery.data?.user ?? [],
    ),
  );
  const sharedTree = withMcpServersFolder(
    sharedTreeQuery.data ?? [],
    mcpServersQuery.data?.org ?? [],
  );

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

  // Sync activeScope once the org role arrives (canEditOrg is resolved async).
  useEffect(() => {
    if (!canEditOrg && activeScope === "shared") {
      setActiveScope("personal");
    }
  }, [canEditOrg, activeScope]);
  // Virtual MCP ids aren't in the resources store — skip the fetch so
  // useResource doesn't 404-flash.
  const resourceQuery = useResource(
    selectedResourceId && !parseMcpVirtualId(selectedResourceId)
      ? selectedResourceId
      : null,
  );
  const createResource = useCreateResource();
  const updateResource = useUpdateResource();
  const deleteResource = useDeleteResource();
  const uploadResource = useUploadResource();

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
  const isMcpSelected = !!selectedMcpServer;

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
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleBack}
                    aria-label="Back to workspace"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  >
                    <IconArrowLeft className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Back to workspace</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            {selectedMcpServer ? (
              <PathBreadcrumb
                path={`mcp-servers/${selectedMcpServer.name}.json`}
              />
            ) : resourceQuery.data ? (
              <PathBreadcrumb path={resourceQuery.data.path} />
            ) : null}
          </div>
          <div className="flex items-center gap-1 shrink-0">
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
            <span className="text-[11px] text-muted-foreground/60 mr-1">
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved"
                  : ""}
            </span>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => {
                      if (selectedResourceId) handleDelete(selectedResourceId);
                    }}
                    aria-label="Delete resource"
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-accent/50"
                  >
                    <IconTrash className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Delete resource</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      ) : (
        /* Floating action buttons — absolute top-right over tree view */
        <div className="absolute top-1 right-1 z-10 flex items-center gap-1">
          <CreateMenu
            scope={activeScope}
            onCreateFile={handleCreateFromToolbar}
            onCreateResource={handleCreateResourceFromToolbar}
            onCreateMcpServer={handleCreateMcpServer}
            canCreateOrgMcp={canCreateOrgMcp}
            hasOrg={hasOrgForMcp}
          />
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
                <a
                  href={WORKSPACE_DOCS_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="What is the Workspace? — open docs"
                  className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
                >
                  <IconHelp className="h-3.5 w-3.5" />
                </a>
              </TooltipTrigger>
              <TooltipContent>
                What is the Workspace? — open docs
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
          selectedMcpServer ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <McpServerDetail server={selectedMcpServer} />
            </div>
          ) : selectedResourceId && resourceQuery.data ? (
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
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {!personalTreeQuery.isLoading &&
              !sharedTreeQuery.isLoading &&
              (personalTreeQuery.data ?? []).length === 0 &&
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
                    for you.{" "}
                    <span className="text-foreground">Organization</span> is
                    visible to everyone in your organization
                    {org?.orgId ? " — only admins can edit." : "."}
                  </p>
                  <a
                    href={WORKSPACE_DOCS_URL}
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
              tree={personalTree}
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
              onDrop={handleUploadFiles}
              title="Personal"
              titleTooltip="Files visible only to you"
            />
            <ResourceTree
              tree={sharedTree}
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
              onDrop={handleUploadFiles}
              title="Organization"
              titleTooltip={
                canEditOrg
                  ? "Files visible to everyone in your organization"
                  : "Files visible to everyone in your organization. Read-only — only admins can edit."
              }
              readOnly={!canEditOrg}
              headingHint={!canEditOrg ? "Read only" : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
