// Owns: tool-payload formatting helpers, ToolCallDisplay, ToolCallFallback,
// and ReconnectStreamMessage used by AssistantChat.

import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  IconLoader2,
  IconCircleX,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconCode,
  IconBrandSlack,
  IconTerminal2,
  IconDatabase,
  IconSearch,
  IconFileCode,
  IconShieldCheck,
  IconX,
} from "@tabler/icons-react";
import React, {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";

import type { ActionChatUIConfig } from "../../action-ui.js";
import type { AgentMcpAppPayload } from "../../mcp-client/app-result.js";
import { AgentTaskCard } from "../AgentTaskCard.js";
import { writeClipboardText } from "../clipboard.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover.js";
import { ConnectBuilderCard } from "../ConnectBuilderCard.js";
import { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
import type { ContentPart } from "../sse-event-processor.js";
import {
  BashCell,
  EditCell,
  WriteCell,
  FilesChangedSummary,
} from "../tool-cells/index.js";
import { humanizeToolName } from "../tool-display.js";
import { cn } from "../utils.js";
import {
  SmoothMarkdownText,
  HighlightedCodeBlock,
  markdownComponents,
  markdownModule,
  remarkGfmFn,
  markdownUrlTransform,
  useSmoothStreamingText,
} from "./markdown-renderer.js";
import { resolveToolRenderer } from "./tool-render-registry.js";
import {
  isBuiltinDataWidgetActionRenderer,
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "./widgets/builtin-tool-renderers.js";

// Exported so AssistantChatInner can provide a context value.
export const ChatRunningContext = React.createContext(false);
export const ChatRunDurationContext = React.createContext<number | null>(null);
export const ASSISTANT_VISIBLE_TOOL_CALL_LIMIT = 3;

/**
 * Human-in-the-loop approval bridge. `AssistantChatInner` provides a value that
 * re-issues the turn approving a specific paused tool call (opt-in
 * `needsApproval` actions). When null, the Approve button is not rendered.
 * Deny defaults to local-only (the action stays un-run) unless `onDeny` is
 * provided, and "Always allow" only renders when `onAlwaysAllow` is provided
 * — both are additive so existing action-approval consumers are unaffected.
 */
export type ApprovalContextValue = {
  /** Re-issue the turn so the server runs the approved call. */
  onApprove: (approvalKey: string) => void;
  /**
   * Optional host hook invoked in addition to the local "denied" state, e.g.
   * so a Code session can also resolve its own pending approval as denied.
   */
  onDeny?: (approvalKey: string) => void;
  /**
   * Optional host hook that persists this exact call so future occurrences
   * skip the approval gate. When absent, no "Always allow" button renders.
   */
  onAlwaysAllow?: (approvalKey: string) => void;
};
export const ApprovalContext = React.createContext<ApprovalContextValue | null>(
  null,
);

export const TOOL_LONG_RUNNING_HINT_DELAY_MS = 45_000;

export function ToolActivityPresentation({
  toolName,
  isRunning,
  isActiveTail,
  children,
}: {
  toolName: string;
  isRunning: boolean;
  isActiveTail: boolean;
  children: React.ReactNode;
}) {
  const [showLongRunningHint, setShowLongRunningHint] = useState(false);
  // A batched update can first reveal a tool with its result already attached.
  // Presentation follows the active chat tail rather than execution state so
  // that newly revealed completed tools still get their entrance motion.
  const [animateEntry] = useState(isActiveTail);

  useEffect(() => {
    if (!isRunning) {
      setShowLongRunningHint(false);
      return;
    }
    setShowLongRunningHint(false);
    const timeout = window.setTimeout(() => {
      setShowLongRunningHint(true);
    }, TOOL_LONG_RUNNING_HINT_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [isRunning, toolName]);

  return (
    <div
      className={cn(
        "agent-tool-call",
        animateEntry && "agent-tool-call--entering",
      )}
      data-running={isRunning ? "true" : undefined}
      data-active-tail={isActiveTail ? "true" : undefined}
    >
      {children}
      {isRunning && showLongRunningHint && (
        <div className="mt-0.5 px-2.5 text-[11px] leading-snug text-muted-foreground/80">
          Still working. Large updates can take a minute or two.
        </div>
      )}
    </div>
  );
}

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
    keyName === "code" &&
    (tool.includes("run-code") || tool.includes("run_code"))
  ) {
    return "javascript";
  }
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

// ─── Tool icon helpers ────────────────────────────────────────────────────────

type ToolIconComponent = React.ComponentType<{
  className?: string;
  size?: number | string;
}>;

function resolveToolIcon(toolName: string): ToolIconComponent {
  const name = toolName.toLowerCase();
  if (name.includes("slack")) return IconBrandSlack;
  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("terminal") ||
    name.includes("run-code") ||
    name.includes("exec")
  ) {
    return IconTerminal2;
  }
  if (
    name.includes("sql") ||
    name.includes("bigquery") ||
    name.includes("db-query") ||
    name.includes("query")
  ) {
    return IconDatabase;
  }
  if (
    name.includes("search") ||
    name.includes("find") ||
    name.includes("grep")
  ) {
    return IconSearch;
  }
  if (
    name.includes("file") ||
    name.includes("read") ||
    name.includes("write") ||
    name.includes("edit")
  ) {
    return IconFileCode;
  }
  return IconCode;
}

// ─── Simple code viewer (Codex-style gray box) ────────────────────────────────

function SimpleCodeViewer({
  text,
  lang,
  className,
  maxHeightClass = "max-h-56",
}: {
  text: string;
  lang: string;
  className?: string;
  maxHeightClass?: string;
}) {
  return (
    <div
      className={cn(
        "agent-tool-code overflow-auto rounded-md bg-muted/70 font-mono text-[11px] leading-relaxed text-foreground",
        maxHeightClass,
        className,
      )}
    >
      {lang !== "text" && (
        <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-border/40 bg-muted/90 px-2.5 py-1">
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
            {lang}
          </span>
        </div>
      )}
      <HighlightedCodeBlock code={text} lang={lang} />
    </div>
  );
}

function ToolOutputPopover({
  open,
  onOpenChange,
  title,
  payload,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  payload: ToolDetailPayload;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        collisionPadding={12}
        className="flex max-h-[min(calc(100vh-2rem),var(--radix-popover-content-available-height,75vh))] w-[min(calc(100vw-2rem),var(--radix-popover-content-available-width,760px),760px)] flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="truncate text-sm font-medium">{title}</div>
          <button
            type="button"
            onClick={copyValue}
            className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {copied ? <IconCheck size={13} /> : <IconCopy size={13} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3">
          <SimpleCodeViewer
            text={payload.text}
            lang={payload.lang}
            maxHeightClass="max-h-[min(70vh,calc(var(--radix-popover-content-available-height,75vh)-4.5rem))]"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Collapsible height animation ─────────────────────────────────────────────

export function AnimatedCollapse({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(open);

  useLayoutEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  const onTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.propertyName !== "grid-template-rows" || open) return;
      setMounted(false);
    },
    [open],
  );

  if (!mounted) return null;

  return (
    <div
      className="agent-chat-collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      onTransitionEnd={onTransitionEnd}
    >
      <div className="agent-chat-collapse__content">{children}</div>
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
  // Deny defaults to local-only (the action simply stays un-run). When the
  // host also provided `onDeny` (e.g. a Code session resolving its own
  // pending approval), it fires alongside the local state.
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
      {ctx?.onAlwaysAllow && (
        <button
          type="button"
          onClick={() => {
            setApproved(true);
            ctx.onAlwaysAllow?.(approval.approvalKey);
          }}
          title="Approve and always allow this exact command"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors",
            "text-foreground hover:bg-muted",
          )}
        >
          <IconShieldCheck className="h-3.5 w-3.5" />
          Always allow
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setDenied(true);
          ctx?.onDeny?.(approval.approvalKey);
        }}
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
  repeatCount,
  isLatestRunning = isRunning,
  isActiveTail,
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
  repeatCount?: number;
  /** The latest tool shown while the overall chat turn is still active. */
  isActiveTail?: boolean;
  /** @deprecated Use isActiveTail. */
  isLatestRunning?: boolean;
}) {
  const showActiveTail = isActiveTail ?? isLatestRunning;
  // Delegate to bespoke cells when structured metadata is present.
  // These must be separate components so hook order in ToolCallDisplayGeneric
  // is always stable (no conditional hook calls).
  const toolKind = structuredMeta?.toolKind as string | undefined;
  const wrapToolDisplay = (children: React.ReactNode) => (
    <ToolActivityPresentation
      toolName={toolName}
      isRunning={isRunning}
      isActiveTail={showActiveTail}
    >
      {children}
    </ToolActivityPresentation>
  );
  if (toolKind === "bash") {
    return wrapToolDisplay(
      <BashCell
        meta={
          structuredMeta as unknown as Parameters<typeof BashCell>[0]["meta"]
        }
        output={result}
        isRunning={isRunning}
      />,
    );
  }
  if (toolKind === "edit") {
    return wrapToolDisplay(
      <EditCell
        meta={
          structuredMeta as unknown as Parameters<typeof EditCell>[0]["meta"]
        }
        isRunning={isRunning}
      />,
    );
  }
  if (toolKind === "write") {
    return wrapToolDisplay(
      <WriteCell
        meta={
          structuredMeta as unknown as Parameters<typeof WriteCell>[0]["meta"]
        }
        isRunning={isRunning}
      />,
    );
  }
  return wrapToolDisplay(
    <ToolCallDisplayGeneric
      toolName={toolName}
      argsText={argsText}
      args={args}
      result={result}
      mcpApp={mcpApp}
      chatUI={chatUI}
      isRunning={isRunning}
      isActiveTail={showActiveTail}
      approval={approval}
      repeatCount={repeatCount}
    />,
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
  isActiveTail,
  approval,
  repeatCount,
}: {
  toolName: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  isActiveTail: boolean;
  approval?: { approvalKey: string; dismissed?: boolean };
  repeatCount?: number;
}) {
  const streamRef = useRef<HTMLDivElement>(null);

  const isAgentCall = toolName.startsWith("agent:");
  const [expanded, setExpanded] = useState(isAgentCall);
  const [outputOpen, setOutputOpen] = useState(false);
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
    isActiveTail,
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
  const ToolIcon = resolveToolIcon(toolName);
  const outputTitle = `Raw ${toolName} tool call output`;

  return (
    <div className="group/tool my-0.5 w-full overflow-hidden">
      {mcpApp && <McpAppRenderer app={mcpApp} className="mb-1.5" />}
      <button
        type="button"
        onClick={() => canExpand && setExpanded(!isExpanded)}
        aria-expanded={canExpand ? isExpanded : undefined}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] text-muted-foreground transition-colors",
          canExpand && "hover:text-foreground",
          isRunning && "text-muted-foreground",
        )}
      >
        <span className="relative flex size-4 shrink-0 items-center justify-center">
          {isRunning ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : isAgentError ? (
            <IconCircleX className="size-3.5 text-destructive" />
          ) : (
            <>
              <ToolIcon
                className={cn(
                  "size-3.5 transition-opacity",
                  canExpand && "group-hover/tool:opacity-0",
                )}
              />
              {canExpand && (
                <IconChevronRight
                  className={cn(
                    "absolute size-3.5 opacity-0 transition-[opacity,transform] group-hover/tool:opacity-100",
                    isExpanded && "rotate-90",
                  )}
                />
              )}
            </>
          )}
        </span>
        <span
          className={cn(
            "min-w-0 truncate font-normal",
            isActiveTail && "agent-running-shimmer",
          )}
        >
          {displayName}
        </span>
        {repeatCount && repeatCount > 1 && (
          <span
            className="shrink-0 rounded border border-border/60 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground"
            title={`Repeated ${repeatCount} times`}
          >
            {repeatCount}x
          </span>
        )}
      </button>
      <AnimatedCollapse open={isExpanded && isAgentCall && hasStreamText}>
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
      </AnimatedCollapse>
      <AnimatedCollapse
        open={isExpanded && !isAgentCall && (hasArgs || result !== undefined)}
      >
        <div className="mt-1 space-y-2 pl-5">
          {inputPayload && (
            <SimpleCodeViewer
              text={inputPayload.text}
              lang={inputPayload.lang}
            />
          )}
          {resultPayload && (
            <ToolOutputPopover
              open={outputOpen}
              onOpenChange={setOutputOpen}
              title={outputTitle}
              payload={resultPayload}
            >
              <button
                type="button"
                aria-label={`View ${toolName} output`}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <IconCode className="size-3.5" />
              </button>
            </ToolOutputPopover>
          )}
        </div>
      </AnimatedCollapse>
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
  activity?: boolean;
  approval?: { approvalKey: string; dismissed?: boolean };
  repeatCount?: number;
  isLatestRunning?: boolean;
  isActiveTail?: boolean;
}) {
  const chatRunning = React.useContext(ChatRunningContext);
  const isRunning =
    result === undefined && (chatRunning || rest.activity === true);
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
      isActiveTail={rest.isActiveTail}
      isLatestRunning={rest.isLatestRunning}
      approval={rest.approval}
      repeatCount={rest.repeatCount}
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
  const toolSummary = getReconnectToolSummaryInfo(content);
  const latestReasoningPartIndex = content.reduce(
    (latestIndex, part, index) =>
      part.type === "reasoning" ? index : latestIndex,
    -1,
  );
  const streamingTextPartIndex =
    content.at(-1)?.type === "text" ? content.length - 1 : -1;
  const streamingReasoningPartIndex =
    content.at(-1)?.type === "reasoning" ? content.length - 1 : -1;
  const latestActiveToolIndex = content.reduce(
    (latestIndex, part, index) =>
      part.type === "tool-call" && (chatRunning || part.activity === true)
        ? index
        : latestIndex,
    -1,
  );

  const renderPart = (part: ContentPart, i: number) => {
    if (part.type === "text") {
      const partStreaming = chatRunning && i === streamingTextPartIndex;
      return (
        <SmoothMarkdownText
          key={`reconnect-text-${i}`}
          text={part.text}
          streaming={partStreaming}
          resetKey={`reconnect-text-${i}`}
          statusType={partStreaming ? "running" : "complete"}
        />
      );
    }
    if (part.type === "reasoning") {
      return (
        <ReasoningCell
          key={`reconnect-reasoning-${i}`}
          text={part.text}
          isStreaming={chatRunning && i === streamingReasoningPartIndex}
          resetKey={`reconnect-reasoning-${i}`}
          defaultOpen={i === latestReasoningPartIndex}
          collapseWhenReplaced={i < latestReasoningPartIndex}
        />
      );
    }
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
        isRunning={
          part.result === undefined && (chatRunning || part.activity === true)
        }
        isActiveTail={i === latestActiveToolIndex}
        approval={part.approval}
        repeatCount={part.repeatCount}
      />
    );
  };

  const renderedParts: React.ReactNode[] = [];
  let summaryStartIndex = -1;
  let summaryToolCount = 0;
  const flushSummary = (endIndex: number) => {
    if (summaryStartIndex < 0) return;
    renderedParts.push(
      <RanToolsSummary
        key={`reconnect-tool-summary-${summaryStartIndex}`}
        toolCount={summaryToolCount}
      >
        {content
          .slice(summaryStartIndex, endIndex)
          .map((part, offset) => renderPart(part, summaryStartIndex + offset))}
      </RanToolsSummary>,
    );
    summaryStartIndex = -1;
    summaryToolCount = 0;
  };

  for (let i = 0; i < content.length; i++) {
    const part = content[i]!;
    const isOlderToolWork =
      toolSummary.startIndex >= 0 &&
      i < toolSummary.startIndex &&
      isReconnectToolSummaryPart(content, i, toolSummary.startIndex);
    if (isOlderToolWork) {
      summaryStartIndex = summaryStartIndex < 0 ? i : summaryStartIndex;
      if (part.type === "tool-call") summaryToolCount++;
      continue;
    }
    flushSummary(i);
    renderedParts.push(renderPart(part, i));
  }
  flushSummary(content.length);

  return (
    <div className="flex justify-start">
      <div className="w-full max-w-[95%] text-sm leading-relaxed text-foreground space-y-1">
        {renderedParts}
      </div>
    </div>
  );
}

function getReconnectToolSummaryInfo(content: readonly ContentPart[]) {
  const toolCallIndices = content.reduce<number[]>((indices, part, index) => {
    if (part.type === "tool-call" && isReconnectSummarizablePart(part)) {
      indices.push(index);
    }
    return indices;
  }, []);
  if (toolCallIndices.length <= ASSISTANT_VISIBLE_TOOL_CALL_LIMIT) {
    return { startIndex: -1 };
  }
  return {
    startIndex:
      toolCallIndices[
        toolCallIndices.length - ASSISTANT_VISIBLE_TOOL_CALL_LIMIT
      ]!,
  };
}

function isReconnectSummarizablePart(part: ContentPart): boolean {
  return (
    part.type === "reasoning" ||
    (part.type === "tool-call" &&
      part.toolName !== "connect-builder" &&
      part.chatUI === undefined &&
      part.mcpApp === undefined)
  );
}

function isReconnectToolSummaryPart(
  content: readonly ContentPart[],
  index: number,
  startIndex: number,
): boolean {
  if (startIndex < 0 || index >= startIndex) return false;
  if (!isReconnectSummarizablePart(content[index]!)) return false;

  let segmentStart = index;
  while (
    segmentStart > 0 &&
    isReconnectSummarizablePart(content[segmentStart - 1]!)
  ) {
    segmentStart--;
  }

  let segmentEnd = index + 1;
  while (
    segmentEnd < startIndex &&
    isReconnectSummarizablePart(content[segmentEnd]!)
  ) {
    segmentEnd++;
  }

  return content
    .slice(segmentStart, segmentEnd)
    .some((candidate) => candidate.type === "tool-call");
}

// ─── Reasoning / Thinking cell ────────────────────────────────────────────────

/**
 * Completed reasoning and tool calls share one outer "Worked for…"
 * disclosure. Reasoning cells inside it render their prose directly so
 * opening that summary never reveals a redundant second disclosure.
 */
const WorkSummaryContentContext = React.createContext(false);

export function ReasoningCell({
  text,
  isStreaming = false,
  resetKey,
  defaultOpen,
  autoCollapse = false,
  collapseWhenReplaced = false,
  durationMs,
}: {
  text: string;
  isStreaming?: boolean;
  /** Stable identity used to restart the reveal when a new reasoning part mounts. */
  resetKey?: string;
  defaultOpen?: boolean;
  /** Animate closed when a live reasoning segment finishes during a run. */
  autoCollapse?: boolean;
  /** Animate closed when a newer reasoning segment replaces this one. */
  collapseWhenReplaced?: boolean;
  /**
   * Elapsed thinking time in ms, once known. Only meaningful once streaming
   * has finished — callers that track live timing (see ReasoningMessagePart)
   * pass this so the label can read "Thought for Xs" instead of "Thought".
   * Historical messages with no live timing simply omit it.
   */
  durationMs?: number | null;
}) {
  const embeddedInWorkSummary = React.useContext(WorkSummaryContentContext);
  const [open, setOpen] = useState(defaultOpen ?? true);
  const wasStreamingRef = useRef(isStreaming);
  const wasReplacedRef = useRef(collapseWhenReplaced);
  const trimmed = text.trim();
  const visibleText = useSmoothStreamingText(
    trimmed,
    isStreaming,
    resetKey ?? "reasoning",
  );

  useEffect(() => {
    if (autoCollapse && wasStreamingRef.current && !isStreaming) {
      setOpen(false);
    }
    wasStreamingRef.current = isStreaming;
  }, [autoCollapse, isStreaming]);

  useEffect(() => {
    if (collapseWhenReplaced && !wasReplacedRef.current) {
      setOpen(false);
    }
    wasReplacedRef.current = collapseWhenReplaced;
  }, [collapseWhenReplaced]);

  if (!trimmed && !isStreaming) return null;

  if (embeddedInWorkSummary) {
    return (
      <div className="pb-1 pl-5 text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {visibleText || (isStreaming ? "…" : "")}
      </div>
    );
  }

  const label = isStreaming
    ? "Thinking"
    : durationMs != null
      ? `Thought for ${formatWorkedDuration(durationMs)}`
      : "Thought";
  // Only clamp to a scroll-free "tail" view while actively streaming and
  // expanded — once the run finishes the full text is shown, unclamped.
  const showTail = isStreaming && open;

  return (
    <div className="my-0.5 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <IconChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        {isStreaming ? (
          <span className="agent-thinking-indicator__text">{label}</span>
        ) : (
          <span>{label}</span>
        )}
      </button>
      <AnimatedCollapse open={open}>
        <div className={cn("pl-5 pb-1", showTail && "reasoning-cell-tail")}>
          <div className="text-[13px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
            {visibleText || (isStreaming ? "…" : "")}
          </div>
        </div>
      </AnimatedCollapse>
    </div>
  );
}

// ─── Worked-for duration helpers ──────────────────────────────────────────────

export function formatWorkedDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return totalSeconds <= 1 ? "1s" : `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    if (seconds === 0) return `${minutes}m`;
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return `${hours}h`;
  return `${hours}h ${remMinutes}m`;
}

export function WorkedForSummary({
  durationMs,
  autoCollapse = false,
  children,
}: {
  durationMs?: number | null;
  /** When true, close the summary after a run has completed. */
  autoCollapse?: boolean;
  children: React.ReactNode;
}) {
  // Start closed so a remounted completed message never flashes its work
  // details open while auto-collapse settles. If the summary was already
  // open when autoCollapse changes, AnimatedCollapse still animates it shut.
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (autoCollapse) setOpen(false);
  }, [autoCollapse]);

  const label =
    durationMs != null && durationMs >= 1000
      ? `Worked for ${formatWorkedDuration(durationMs)}`
      : "Worked";

  return (
    <div className="my-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        <IconChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      <AnimatedCollapse open={open}>
        <WorkSummaryContentContext.Provider value>
          <div className="pt-1">{children}</div>
        </WorkSummaryContentContext.Provider>
      </AnimatedCollapse>
    </div>
  );
}

export function RanToolsSummary({
  toolCount,
  children,
}: {
  toolCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const label = `Ran ${toolCount} ${toolCount === 1 ? "tool" : "tools"}`;

  return (
    <div className="my-1 w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        <IconChevronRight
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      <AnimatedCollapse open={open}>
        <div className="pt-1">{children}</div>
      </AnimatedCollapse>
    </div>
  );
}

// ─── Re-export for AssistantMessage ───────────────────────────────────────────
// AssistantMessage in AssistantChat.tsx uses FilesChangedSummary directly, so
// re-export it so AssistantChat.tsx can import from one place.
export { FilesChangedSummary };
