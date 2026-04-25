import React, { useState, useRef, useEffect } from "react";
import {
  IconPlus,
  IconUpload,
  IconBulb,
  IconClock,
  IconBolt,
  IconPlugConnected,
  IconLoader2,
  IconCheck,
  IconArrowLeft,
} from "@tabler/icons-react";
import { ComposerPrimitive } from "@assistant-ui/react";
import { cn } from "../utils.js";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "../components/ui/popover.js";
import { sendToAgentChat } from "../agent-chat.js";
import { useOrg } from "../org/hooks.js";
import {
  useCreateMcpServer,
  testMcpServerUrl,
  type McpServerScope,
} from "../resources/use-mcp-servers.js";

type View = "menu" | "skill" | "job" | "mcp-server";

export function ComposerPlusMenu() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");
  const [value, setValue] = useState("");

  // MCP state
  const { data: org } = useOrg();
  const canCreateOrgMcp =
    !org?.orgId || org.role === "owner" || org.role === "admin";
  const hasOrg = !!org?.orgId;
  const defaultMcpScope: McpServerScope =
    hasOrg && canCreateOrgMcp ? "org" : "user";
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
  const createMcp = useCreateMcpServer();

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const fileUploadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setView("menu");
      setValue("");
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
    if (view !== "menu") {
      setValue("");
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [view]);

  const submitSkill = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: `Create a skill: ${trimmed}`,
      context: `The user wants to create an agent skill. Their description: "${trimmed}"

Follow the create-skill pattern to build this. Before writing:

1. **Determine the skill name** — derive a hyphen-case name from the description (e.g. "code review" → "code-review")
2. **Determine the skill type** — Pattern (architectural rule), Workflow (step-by-step), or Generator (scaffolding)
3. **Write the skill** as a personal resource at path "skills/<name>.md" using resource-write

The skill file MUST have YAML frontmatter with name and description (under 40 words), then markdown with:
- Clear rule/purpose statement
- Why this skill exists
- How to follow it (with code examples where helpful)
- Common violations to avoid
- Related skills

After creating, update the shared AGENTS.md resource to reference the new skill in its skills table.

Keep the skill concise (under 500 lines) and actionable.`,
      submit: true,
    });
    setOpen(false);
  };

  const submitJob = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    sendToAgentChat({
      message: `Create a recurring job: ${trimmed}`,
      context: `The user wants to create a recurring job. Their description: "${trimmed}"

Use the manage-jobs tool with action "create" to create this. You need to:
1. Derive a hyphen-case name from the description
2. Convert the schedule to a cron expression (e.g., "every weekday at 9am" → "0 9 * * 1-5")
3. Write clear, self-contained instructions for what the agent should do each time the job runs
4. Create it in personal scope

The job will run automatically on the schedule. Make the instructions specific — include which actions to call and what to do with results.`,
      submit: true,
    });
    setOpen(false);
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
      const val = trimmed.slice(idx + 1).trim();
      if (!key || !val) continue;
      out[key] = val;
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
      await createMcp.mutateAsync({
        scope: mcpScope,
        name,
        url,
        headers: parseHeaderLines(mcpHeadersText),
        description: mcpDescription.trim() || undefined,
      });
      setOpen(false);
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
      icon: <IconUpload className="h-3.5 w-3.5" />,
      label: "Upload File",
      desc: "Attach a file to this message",
      action: () => {
        setOpen(false);
        setTimeout(() => fileUploadRef.current?.click(), 0);
      },
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
          context:
            "The user wants to create a new automation. Scope: personal. Use manage-automations with action=define to create it. Ask clarifying questions if needed about what event to trigger on, conditions, and what actions to take.",
          submit: true,
        });
      },
    },
    {
      icon: <IconPlugConnected className="h-3.5 w-3.5" />,
      label: "Connect MCP Server",
      desc: "Expose external tools to the agent",
      action: () => setView("mcp-server"),
    },
  ];

  const backButton = (
    <button
      type="button"
      onClick={() => setView("menu")}
      className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mb-1.5"
    >
      <IconArrowLeft className="h-3 w-3" />
      Back
    </button>
  );

  return (
    <>
      {/* Hidden button to trigger the native file upload */}
      <ComposerPrimitive.AddAttachment asChild>
        <button
          ref={fileUploadRef}
          type="button"
          className="hidden"
          tabIndex={-1}
          aria-hidden
        />
      </ComposerPrimitive.AddAttachment>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="shrink-0 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
            title="Add..."
          >
            <IconPlus className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-[260px] p-0 rounded-lg"
          style={{ fontSize: 13, lineHeight: "normal" }}
          onOpenAutoFocus={(e) => e.preventDefault()}
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

          {view === "skill" && (
            <div className="p-3">
              {backButton}
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
                placeholder="e.g. A skill that reviews PRs for security issues"
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
              {backButton}
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
                placeholder="e.g. Every weekday at 9am, check for overdue tasks and send a Slack update"
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

          {view === "mcp-server" && (
            <div className="p-3">
              {backButton}
              <label className="mb-1 block text-[11px] font-semibold text-foreground">
                Connect MCP Server
              </label>
              <p className="mb-2 text-[10px] text-muted-foreground/60 leading-relaxed">
                Point at any Streamable HTTP MCP server. Its tools become
                available to the agent.
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
                  ref={inputRef as React.RefObject<HTMLInputElement>}
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
                  Headers (one per line, e.g. Authorization: Bearer ...)
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
        </PopoverContent>
      </Popover>
    </>
  );
}
