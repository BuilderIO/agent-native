// Owns: tool-payload formatting helpers, ToolCallDisplay, ToolCallFallback,
// and ReconnectStreamMessage used by AssistantChat.

import React, {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import type { ActionChatUIConfig } from "../../action-ui.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import type { ContentPart } from "../sse-event-processor.js";
import { humanizeToolName } from "../tool-display.js";
import {
  BashCell,
  EditCell,
  WriteCell,
  FilesChangedSummary,
} from "../tool-cells/index.js";
import { AgentTaskCard } from "../AgentTaskCard.js";
import { ConnectBuilderCard } from "../ConnectBuilderCard.js";
import { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
import { writeClipboardText } from "../clipboard.js";
import { cn } from "../utils.js";
import { resolveToolRenderer } from "./tool-render-registry.js";
import {
  isBuiltinDataWidgetActionRenderer,
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "./widgets/builtin-tool-renderers.js";
import {
  SmoothMarkdownText,
  HighlightedCodeBlock,
  markdownComponents,
  markdownModule,
  remarkGfmFn,
  markdownUrlTransform,
} from "./markdown-renderer.js";
import {
  IconLoader2,
  IconCircleX,
  IconCheck,
  IconSquareFilled,
  IconChevronDown,
  IconCopy,
  IconSearch,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";

// Exported so AssistantChatInner can provide a context value.
export const ChatRunningContext = React.createContext(false);

/**
 * Human-in-the-loop approval bridge. `AssistantChatInner` provides a value that
 * re-issues the turn approving a specific paused tool call (opt-in
 * `needsApproval` actions). When null, the Approve button is not rendered.
 * Deny is handled locally in the affordance, so it needs no bridge.
 */
export type ApprovalContextValue = {
  /** Re-issue the turn so the server runs the approved call. */
  onApprove: (approvalKey: string) => void;
};
export const ApprovalContext = React.createContext<ApprovalContextValue | null>(
  null,
);

// ─── Tool-payload formatting ──────────────────────────────────────────────────

type ToolDetailSection = "input" | "result";
export type ToolDetailPayload = {
  section: ToolDetailSection;
  title: string;
  text: string;
  copyText: string;
  lang: string;
};

function stringifyToolValue(value: unknown, pretty = false): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, pretty ? 2 : 0);
  } catch {
    return String(value ?? "");
  }
}

function looksLikeSql(text: string): boolean {
  return /^\s*(select|with|insert|update|delete|merge|create|alter|drop|explain|declare|begin)\b/i.test(
    text,
  );
}

function parseJsonText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function inferToolTextLanguage(
  text: string,
  key?: string,
  toolName?: string,
): string {
  const keyName = (key ?? "").toLowerCase();
  const tool = (toolName ?? "").toLowerCase();
  if (
    keyName === "sql" ||
    keyName.endsWith("sql") ||
    keyName === "query" ||
    tool.includes("bigquery") ||
    tool.includes("db-query") ||
    looksLikeSql(text)
  ) {
    return "sql";
  }
  return parseJsonText(text) ? "json" : "text";
}

function formatToolTextValue(
  value: unknown,
  key?: string,
  toolName?: string,
): { text: string; lang: string } {
  if (typeof value === "string") {
    const parsed = parseJsonText(value);
    if (parsed) {
      return { text: JSON.stringify(parsed, null, 2), lang: "json" };
    }
    return {
      text: value,
      lang: inferToolTextLanguage(value, key, toolName),
    };
  }
  return { text: stringifyToolValue(value, true), lang: "json" };
}

export function toolInputPayload(
  toolName: string,
  args: Record<string, unknown>,
): ToolDetailPayload | null {
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  if (entries.length === 1) {
    const [key, value] = entries[0]!;
    const formatted = formatToolTextValue(value, key, toolName);
    const normalizedKey = key.toLowerCase();
    const keyLabel =
      normalizedKey === "sql" || normalizedKey.endsWith("sql") ? "SQL" : key;
    return {
      section: "input",
      title: `Input - ${keyLabel}`,
      text: formatted.text,
      copyText:
        typeof value === "string" ? value : stringifyToolValue(value, true),
      lang: formatted.lang,
    };
  }
  return {
    section: "input",
    title: "Input",
    text: JSON.stringify(args, null, 2),
    copyText: JSON.stringify(args, null, 2),
    lang: "json",
  };
}

export function toolResultPayload(
  result: string | undefined,
): ToolDetailPayload | null {
  if (result === undefined) return null;
  const formatted = formatToolTextValue(result);
  return {
    section: "result",
    title: "Result",
    text: formatted.text,
    copyText: result,
    lang: formatted.lang,
  };
}

// ─── Search highlight helpers ─────────────────────────────────────────────────

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countTextMatches(text: string, query: string): number {
  const needle = query.trim();
  if (!needle) return 0;
  return Array.from(text.matchAll(new RegExp(escapeRegExp(needle), "gi")))
    .length;
}

function renderHighlightedSearchText(
  text: string,
  query: string,
): React.ReactNode {
  const needle = query.trim();
  if (!needle) return text;
  const regex = new RegExp(escapeRegExp(needle), "gi");
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(<mark key={`${match.index}-${match[0]}`}>{match[0]}</mark>);
    lastIndex = match.index + match[0].length;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

// ─── ToolDetailViewer ──────────────────────────────────────────────────────────

function ToolDetailViewer({ payload }: { payload: ToolDetailPayload }) {
  const [expanded, setExpanded] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const matchCount = useMemo(
    () => countTextMatches(payload.text, search),
    [payload.text, search],
  );

  useEffect(() => {
    return () => {
      if (copyResetRef.current) clearTimeout(copyResetRef.current);
    };
  }, []);

  const copyValue = useCallback(async () => {
    try {
      if (await writeClipboardText(payload.copyText)) {
        setCopied(true);
        if (copyResetRef.current) clearTimeout(copyResetRef.current);
        copyResetRef.current = setTimeout(() => setCopied(false), 1200);
      }
    } catch {
      // Clipboard failures should not interrupt chat rendering.
    }
  }, [payload.copyText]);

  return (
    <div className="rounded-md border border-border/50 bg-background/60">
      <div className="flex min-h-9 flex-wrap items-center gap-2 border-b border-border/50 px-2.5 py-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[11px] font-medium text-foreground/85">
              {payload.title}
            </span>
            {payload.lang !== "text" && (
              <span className="shrink-0 rounded border border-border/60 px-1 py-0.5 font-mono text-[9px] uppercase leading-none text-muted-foreground">
                {payload.lang}
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSearchOpen((v) => !v)}
          aria-label={`Search ${payload.title.toLowerCase()}`}
          aria-pressed={searchOpen}
          className={cn(
            "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            searchOpen && "bg-accent text-foreground",
          )}
        >
          <IconSearch size={12} />
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? "Shrink code viewer" : "Expand code viewer"}
          aria-pressed={expanded}
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {expanded ? (
            <IconArrowsMinimize size={12} />
          ) : (
            <IconArrowsMaximize size={12} />
          )}
        </button>
        <button
          type="button"
          onClick={copyValue}
          className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 font-sans text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      {searchOpen && (
        <div className="flex items-center gap-2 border-b border-border/50 px-2.5 py-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find"
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
          />
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {search.trim() ? matchCount : ""}
          </span>
        </div>
      )}
      <div
        className={cn(
          "agent-tool-code overflow-auto font-mono text-[11px] leading-relaxed text-foreground",
          expanded ? "max-h-[70vh]" : "max-h-72",
        )}
      >
        {search.trim() ? (
          <pre>
            <code>{renderHighlightedSearchText(payload.text, search)}</code>
          </pre>
        ) : (
          <HighlightedCodeBlock code={payload.text} lang={payload.lang} />
        )}
      </div>
    </div>
  );
}

// ─── Human-in-the-loop approval affordance ────────────────────────────────────

/**
 * Inline Approve/Deny prompt rendered when a `needsApproval` action paused the
 * turn. Approve re-issues the turn with the call's `approvalKey`; Deny dismisses
 * the prompt locally (the action stays un-run).
 */
function ApprovalAffordance({
  toolName,
  approval,
}: {
  toolName: string;
  approval: { approvalKey: string; dismissed?: boolean };
}) {
  const ctx = React.useContext(ApprovalContext);
  const [approved, setApproved] = useState(false);
  const [denied, setDenied] = useState(false);

  // Once approved, the turn is re-issued; collapse to a quiet note so the user
  // can't double-fire the approval.
  if (approved) {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        Approved. Re-running {toolName}...
      </div>
    );
  }
  // Deny is local-only: the action simply stays un-run.
  if (denied) {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        Denied. {toolName} did not run.
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
      <IconShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="mr-auto text-xs text-muted-foreground">
        Approve to run {toolName}?
      </span>
      {ctx && (
        <button
          type="button"
          onClick={() => {
            setApproved(true);
            ctx.onApprove(approval.approvalKey);
          }}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          <IconCheck className="h-3.5 w-3.5" />
          Approve
        </button>
      )}
      <button
        type="button"
        onClick={() => setDenied(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors",
          "text-foreground hover:bg-muted",
        )}
      >
        <IconX className="h-3.5 w-3.5" />
        Deny
      </button>
    </div>
  );
}

// ─── ToolCallDisplay ──────────────────────────────────────────────────────────

export function ToolCallDisplay({
  toolName,
  argsText,
  args,
  result,
  mcpApp,
  chatUI,
  isRunning,
  structuredMeta,
  approval,
}: {
  toolName: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  structuredMeta?: Record<string, unknown>;
  approval?: { approvalKey: string; dismissed?: boolean };
}) {
  // Delegate to bespoke cells when structured metadata is present.
  // These must be separate components so hook order in ToolCallDisplayGeneric
  // is always stable (no conditional hook calls).
  const toolKind = structuredMeta?.toolKind as string | undefined;
  if (toolKind === "bash") {
    return (
      <BashCell
        meta={
          structuredMeta as unknown as Parameters<typeof BashCell>[0]["meta"]
        }
        output={result}
        isRunning={isRunning}
      />
    );
  }
  if (toolKind === "edit") {
    return (
      <EditCell
        meta={
          structuredMeta as unknown as Parameters<typeof EditCell>[0]["meta"]
        }
        isRunning={isRunning}
      />
    );
  }
  if (toolKind === "write") {
    return (
      <WriteCell
        meta={
          structuredMeta as unknown as Parameters<typeof WriteCell>[0]["meta"]
        }
        isRunning={isRunning}
      />
    );
  }
  return (
    <ToolCallDisplayGeneric
      toolName={toolName}
      argsText={argsText}
      args={args}
      result={result}
      mcpApp={mcpApp}
      chatUI={chatUI}
      isRunning={isRunning}
      approval={approval}
    />
  );
}

function ToolCallDisplayGeneric({
  toolName,
  argsText,
  args,
  result,
  mcpApp,
  chatUI,
  isRunning,
  approval,
}: {
  toolName: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  approval?: { approvalKey: string; dismissed?: boolean };
}) {
  const streamRef = useRef<HTMLDivElement>(null);

  const isAgentCall = toolName.startsWith("agent:");
  const [expanded, setExpanded] = useState(isAgentCall);
  const agentName = isAgentCall ? toolName.slice(6) : null;
  const isAgentError = isAgentCall && result === "Error calling agent";
  const agentStreamText = isAgentCall ? (argsText ?? "") : "";
  const hasStreamText = agentStreamText.length > 0;
  const hasArgs = !isAgentCall && Object.keys(args).length > 0;

  // NOTE: All hooks must be above any conditional returns
  useEffect(() => {
    if (isAgentCall && isRunning && streamRef.current) {
      streamRef.current.scrollTop = streamRef.current.scrollHeight;
    }
  }, [agentStreamText, isAgentCall, isRunning]);

  // Render connect-builder as ConnectBuilderCard once the result is available
  if (toolName === "connect-builder" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.kind === "connect-builder-card") {
        return (
          <ConnectBuilderCard
            configured={!!parsed.configured}
            builderEnabled={parsed.builderEnabled !== false}
            // Ignore saved cliAuthUrl values from older tool results. They
            // contain signed callback state and can expire while a chat sits
            // open; the card's hook fetches a fresh signed URL on mount/click.
            connectUrl={parsed.connectUrl || ""}
            orgName={parsed.orgName ?? null}
            prompt={typeof parsed.prompt === "string" ? parsed.prompt : ""}
          />
        );
      }
    } catch {
      // fall through to default pill rendering
    }
  }

  // Render agent-teams spawn as AgentTaskCard once the result is available
  if (
    toolName === "agent-teams" &&
    (args as Record<string, string>)?.action === "spawn" &&
    result
  ) {
    try {
      const parsed = JSON.parse(result);
      if (parsed.taskId && parsed.threadId) {
        return (
          <AgentTaskCard
            taskId={parsed.taskId}
            threadId={parsed.threadId}
            description={
              parsed.description ||
              (args as Record<string, string>)?.task ||
              "Sub-agent task"
            }
            onOpen={(tid) => {
              window.dispatchEvent(
                new CustomEvent("agent-task-open", {
                  detail: {
                    threadId: tid,
                    description:
                      parsed.description ||
                      (args as Record<string, string>)?.task ||
                      "",
                    name: parsed.name || "",
                  },
                }),
              );
            }}
          />
        );
      }
    } catch {
      // Fall through to default pill rendering
    }
  }

  const parsedResult = result ? parseJsonText(result) : null;
  const nativeToolContext = {
    toolName,
    args,
    resultText: result,
    resultJson: parsedResult,
    isRunning,
    chatUI,
  };
  const skipRegistryRenderer =
    !isAgentCall && isBuiltinDataWidgetActionRenderer(nativeToolContext);
  const NativeToolRenderer = isAgentCall
    ? null
    : (resolveBuiltinActionChatRenderer(nativeToolContext) ??
      (skipRegistryRenderer ? null : resolveToolRenderer(nativeToolContext)) ??
      resolveBuiltinFallbackToolRenderer(nativeToolContext));
  if (NativeToolRenderer) {
    return <NativeToolRenderer context={nativeToolContext} />;
  }

  const inputPayload = hasArgs ? toolInputPayload(toolName, args) : null;
  const resultPayload = toolResultPayload(result);

  const displayName = isAgentCall
    ? isRunning
      ? `Asking ${agentName}...`
      : isAgentError
        ? `Error asking ${agentName}`
        : `Asked ${agentName}`
    : humanizeToolName(toolName);

  const canExpand = isAgentCall
    ? hasStreamText
    : hasArgs || result !== undefined;
  const isExpanded = isAgentCall ? hasStreamText && expanded : expanded;

  return (
    <div className="my-1 overflow-hidden">
      {mcpApp && <McpAppRenderer app={mcpApp} className="mb-1.5" />}
      <button
        onClick={() => canExpand && setExpanded(!isExpanded)}
        aria-expanded={canExpand ? isExpanded : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-xs font-mono w-full text-left overflow-hidden",
          isRunning
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
        )}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : isAgentError ? (
            <IconCircleX className="h-3 w-3 text-destructive" />
          ) : result !== undefined ? (
            <IconCheck className="h-3 w-3 text-emerald-500" />
          ) : (
            <IconSquareFilled className="h-3 w-3 text-muted-foreground" />
          )}
        </span>
        <span className="truncate min-w-0">
          <span className="font-medium">{displayName}</span>
        </span>
        {canExpand && (
          <IconChevronDown
            className={cn(
              "ml-auto h-3 w-3 shrink-0 opacity-40",
              isExpanded && "rotate-180",
            )}
          />
        )}
      </button>
      {isExpanded && isAgentCall && hasStreamText && (
        <div
          ref={streamRef}
          className="mt-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground break-words max-h-48 overflow-y-auto agent-markdown prose prose-sm prose-invert max-w-none"
        >
          {markdownModule?.default && remarkGfmFn ? (
            <markdownModule.default
              remarkPlugins={[remarkGfmFn]}
              components={markdownComponents}
              urlTransform={markdownUrlTransform}
            >
              {agentStreamText}
            </markdownModule.default>
          ) : (
            <span style={{ whiteSpace: "pre-wrap" }}>{agentStreamText}</span>
          )}
        </div>
      )}
      {isExpanded && !isAgentCall && (hasArgs || result !== undefined) && (
        <div className="mt-1 space-y-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          {inputPayload && <ToolDetailViewer payload={inputPayload} />}
          {resultPayload && <ToolDetailViewer payload={resultPayload} />}
        </div>
      )}
      {approval && (
        <ApprovalAffordance toolName={toolName} approval={approval} />
      )}
    </div>
  );
}

// ─── ToolCallFallback ──────────────────────────────────────────────────────────

export function ToolCallFallback({
  toolName,
  args,
  argsText,
  result,
  ...rest
}: ToolCallMessagePartProps & {
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  structuredMeta?: Record<string, unknown>;
  approval?: { approvalKey: string; dismissed?: boolean };
}) {
  const chatRunning = React.useContext(ChatRunningContext);
  const isRunning = result === undefined && chatRunning;
  return (
    <ToolCallDisplay
      toolName={toolName}
      args={args as Record<string, unknown>}
      argsText={argsText}
      result={
        typeof result === "string"
          ? result
          : result !== undefined
            ? JSON.stringify(result)
            : undefined
      }
      mcpApp={rest.mcpApp}
      chatUI={rest.chatUI}
      structuredMeta={rest.structuredMeta}
      isRunning={isRunning}
      approval={rest.approval}
    />
  );
}

// ─── ReconnectStreamMessage ────────────────────────────────────────────────────
// Renders the agent's in-progress response during reconnection (outside
// assistant-ui's runtime). Uses the same visual styling as normal messages.

export function ReconnectStreamMessage({
  content,
}: {
  content: ContentPart[];
}) {
  const chatRunning = React.useContext(ChatRunningContext);

  return (
    <div className="flex justify-start">
      <div className="max-w-[95%] text-sm leading-relaxed text-foreground space-y-1">
        {content.map((part, i) => {
          if (part.type === "text") {
            return (
              <SmoothMarkdownText
                key={`reconnect-text-${i}`}
                text={part.text}
                streaming={chatRunning}
                resetKey={`reconnect-text-${i}`}
                statusType={chatRunning ? "running" : "complete"}
              />
            );
          }
          if (part.type === "tool-call") {
            return (
              <ToolCallDisplay
                key={`reconnect-tool-${i}`}
                toolName={part.toolName}
                argsText={part.argsText}
                args={part.args}
                result={part.result}
                mcpApp={part.mcpApp}
                chatUI={part.chatUI}
                structuredMeta={part.structuredMeta}
                isRunning={part.result === undefined && chatRunning}
                approval={part.approval}
              />
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

// ─── Re-export for AssistantMessage ───────────────────────────────────────────
// AssistantMessage in AssistantChat.tsx uses FilesChangedSummary directly, so
// re-export it so AssistantChat.tsx can import from one place.
export { FilesChangedSummary };
