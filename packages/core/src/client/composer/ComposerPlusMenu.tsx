import React, { useState, useRef, useEffect } from "react";
import {
  IconPlus,
  IconUpload,
  IconBulb,
  IconClock,
  IconBolt,
  IconTool,
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
import { useOrg } from "../org/hooks.js";
import {
  useCreateMcpServer,
  testMcpServerUrl,
  type McpServerScope,
} from "../resources/use-mcp-servers.js";
import type { ComposerMode } from "./types.js";

interface ComposerPlusMenuProps {
  onSelectMode?: (mode: ComposerMode) => void;
  /**
   * "full" (default): full + menu with Upload File, Create Skill, Scheduled Task,
   * Automation, Tool, MCP Server. "upload-only": clicking + opens the file
   * picker directly — no popover, no other modes. Use for prompt popovers
   * (create tool, create deck, create dashboard, etc.) where the only thing
   * to attach is a file.
   */
  mode?: "full" | "upload-only";
}

type View = "menu" | "mcp-server";

function UploadOnlyAttachButton() {
  return (
    <ComposerPrimitive.AddAttachment asChild>
      <button
        type="button"
        className="shrink-0 flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Upload file"
        aria-label="Upload file"
      >
        <IconPlus className="h-4 w-4" />
      </button>
    </ComposerPrimitive.AddAttachment>
  );
}

export function ComposerPlusMenu({
  onSelectMode,
  mode = "full",
}: ComposerPlusMenuProps) {
  if (mode === "upload-only") {
    return <UploadOnlyAttachButton />;
  }
  return <ComposerPlusMenuFull onSelectMode={onSelectMode} />;
}

function ComposerPlusMenuFull({
  onSelectMode,
}: Pick<ComposerPlusMenuProps, "onSelectMode">) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("menu");

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

  const inputRef = useRef<HTMLInputElement>(null);
  const fileUploadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      setView("menu");
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
    if (view === "mcp-server") {
      const t = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [view]);

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
      action: () => {
        onSelectMode?.("skill");
        setOpen(false);
      },
    },
    {
      icon: <IconClock className="h-3.5 w-3.5" />,
      label: "Scheduled Task",
      desc: "Run something on a schedule",
      action: () => {
        onSelectMode?.("job");
        setOpen(false);
      },
    },
    {
      icon: <IconBolt className="h-3.5 w-3.5" />,
      label: "Create Automation",
      desc: "Set up a when-X-do-Y rule",
      action: () => {
        onSelectMode?.("automation");
        setOpen(false);
      },
    },
    {
      icon: <IconTool className="h-3.5 w-3.5" />,
      label: "Create Tool",
      desc: "Build an interactive mini app",
      action: () => {
        onSelectMode?.("tool");
        setOpen(false);
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
                  ref={inputRef}
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
