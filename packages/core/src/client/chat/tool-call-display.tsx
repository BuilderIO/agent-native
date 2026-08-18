// Owns: tool-payload formatting helpers, ToolCallDisplay, ToolCallFallback,
// and ReconnectStreamMessage used by AssistantChat.

import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  IconLoader2,
  IconAlertTriangle,
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

import type {
  A2AAgentActivitySnapshot,
  A2AAgentActivityToolCall,
} from "../../a2a/activity.js";
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
import { FileStorageSetupCard } from "../FileStorageSetupCard.js";
import { useOptionalLocale, useT } from "../i18n.js";
import { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
import { findMcpIntegrationForToolName } from "../resources/mcp-integration-catalog.js";
import { McpIntegrationLogo } from "../resources/McpIntegrationLogo.js";
import type { AgentCallProgress, ContentPart } from "../sse-event-processor.js";
import {
  BashCell,
  EditCell,
  WriteCell,
  FilesChangedSummary,
} from "../tool-cells/index.js";
import {
  humanizeToolName,
  isCallAgentToolCallShadowed,
  isToolCallActive,
} from "../tool-display.js";
import { cn } from "../utils.js";
import { ActionChatUiSurface } from "./action-chat-ui-surface.js";
import {
  SmoothMarkdownText,
  HighlightedCodeBlock,
} from "./markdown-renderer.js";
import { resolveToolRenderer } from "./tool-render-registry.js";
import {
  isBuiltinDataWidgetActionRenderer,
  isBuiltinWorkspaceFileResult,
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "./widgets/builtin-tool-renderers.js";

// Exported so AssistantChatInner can provide a context value.
export const ChatRunningContext = React.createContext(false);
export const ChatRunningRunIdContext = React.createContext<string | null>(null);
export const ChatRunningTurnIdContext = React.createContext<string | null>(
  null,
);
export const ChatRunDurationContext = React.createContext<number | null>(null);
export const SuppressInlineOpenAppContext = React.createContext(false);
export const ASSISTANT_VISIBLE_TOOL_CALL_LIMIT = 3;
/**
 * Keeps the tool-call stack layout-transparent. Tool-entry motion is disabled
 * until it can stay stable while streaming calls are added and summarized.
 */
export function ToolCallStackMotion({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("agent-tool-call-stack", className)}>{children}</div>
  );
}

/**
 * Human-in-the-loop approval bridge. `AssistantChatInner` provides a value that
 * re-issues the turn approving a specific paused tool call (opt-in
 * `needsApproval` actions). When null, the Approve button is not rendered.
 * Deny defaults to local-only (the action stays un-run) unless `onDeny` is
 * provided, and "Always allow" only renders when `onAlwaysAllow` is provided
 * — both are additive so existing action-approval consumers are unaffected.
 */
export type ApprovalResolution = "approved" | "denied";

export type ApprovalContextValue = {
  /** Re-issue the turn so the server runs the approved call. */
  onApprove: (approvalKey: string) => void;
  /**
   * Keep the visible resolution stable while the chat repository refreshes or
   * remounts the message containing this approval card.
   */
  onApprovalResolved?: (
    approvalKey: string,
    resolution: ApprovalResolution,
    toolCallId?: string,
    /**
     * Identifies the specific `approval_required` ask being resolved. A
     * remount that replays the SAME ask (e.g. a chat repository refresh)
     * omits nothing new here, so the retained resolution still matches; a
     * fresh ask after a failed resume carries a different `askId` and so
     * looks up as unresolved. See `ApprovalAffordance` below.
     */
    askId?: string,
  ) => void;
  /** Read a resolution retained by the owning chat surface. */
  getApprovalResolution?: (
    approvalKey: string,
    toolCallId?: string,
    askId?: string,
  ) => ApprovalResolution | null;
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

/** Pending human-in-the-loop gate still waiting for Approve/Deny. */
export function toolCallHasPendingApproval(part: {
  approval?: { approvalKey?: string; dismissed?: boolean } | null;
}): boolean {
  const approval = part.approval;
  return (
    typeof approval?.approvalKey === "string" &&
    approval.approvalKey.length > 0 &&
    approval.dismissed !== true
  );
}

export const TOOL_LONG_RUNNING_HINT_DELAY_MS = 45_000;

export function ToolActivityPresentation({
  toolName,
  isRunning,
  toolCallId,
  suppressLongRunningHint = false,
  children,
}: {
  toolName: string;
  isRunning: boolean;
  toolCallId?: string;
  suppressLongRunningHint?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const [showLongRunningHint, setShowLongRunningHint] = useState(false);
  useEffect(() => {
    if (!isRunning || suppressLongRunningHint) {
      setShowLongRunningHint(false);
      return;
    }
    setShowLongRunningHint(false);
    const timeout = window.setTimeout(() => {
      setShowLongRunningHint(true);
    }, TOOL_LONG_RUNNING_HINT_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [isRunning, suppressLongRunningHint, toolName]);

  return (
    <div
      className="agent-tool-call"
      data-agent-tool-call-id={toolCallId}
      data-running={isRunning ? "true" : undefined}
    >
      <div className="agent-tool-call__content">
        {children}
        {isRunning && showLongRunningHint && (
          <div className="mt-0.5 px-2.5 pb-2 text-[11px] leading-snug text-muted-foreground/80">
            {t("agentChat.tool.longRunning")}
          </div>
        )}
      </div>
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
  labels: { input: string; inputWithLabel: (label: string) => string } = {
    input: "Input",
    inputWithLabel: (label) => `Input - ${label}`,
  },
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
      title: labels.inputWithLabel(keyLabel),
      text: formatted.text,
      copyText:
        typeof value === "string" ? value : stringifyToolValue(value, true),
      lang: formatted.lang,
    };
  }
  return {
    section: "input",
    title: labels.input,
    text: JSON.stringify(args, null, 2),
    copyText: JSON.stringify(args, null, 2),
    lang: "json",
  };
}

export function toolResultPayload(
  result: string | undefined,
  title = "Result",
): ToolDetailPayload | null {
  if (result === undefined) return null;
  const formatted = formatToolTextValue(result);
  return {
    section: "result",
    title,
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

const brandIcons = new Map<string, ToolIconComponent>();

function brandToolIcon(
  logoUrl: string,
  name: string,
  integrationId?: string,
): ToolIconComponent {
  const cacheKey = integrationId ? `${integrationId}:${logoUrl}` : logoUrl;
  const cached = brandIcons.get(cacheKey);
  if (cached) return cached;
  const Icon: ToolIconComponent = ({ className, size }) => (
    <McpIntegrationLogo
      name={name}
      logoUrl={logoUrl}
      integrationId={integrationId}
      className={cn("size-4 rounded-[3px] border-0", className)}
      imageClassName="size-full"
      style={size === undefined ? undefined : { width: size, height: size }}
      title={name}
    />
  );
  brandIcons.set(cacheKey, Icon);
  return Icon;
}

function resolveToolIcon(toolName: string): ToolIconComponent {
  const integration = findMcpIntegrationForToolName(toolName);
  if (integration) {
    return brandToolIcon(integration.logoUrl, integration.name, integration.id);
  }
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
  const t = useT();
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
            {copied ? t("agentChat.common.copied") : t("agentChat.common.copy")}
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
  toolCallId,
  approval,
}: {
  toolName: string;
  toolCallId?: string;
  approval: { approvalKey: string; dismissed?: boolean; askId?: string };
}) {
  const t = useT();
  const ctx = React.useContext(ApprovalContext);
  const [localResolution, setLocalResolution] =
    useState<ApprovalResolution | null>(null);
  const retainedResolution =
    ctx?.getApprovalResolution?.(
      approval.approvalKey,
      toolCallId,
      approval.askId,
    ) ?? null;
  const resolution =
    retainedResolution ??
    localResolution ??
    (approval.dismissed === true ? "denied" : null);

  // Once resolved, collapse to a quiet note so a repository refresh cannot
  // restore the action buttons while the continuation is running.
  if (resolution === "approved") {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        {t("agentChat.approval.approved", { tool: toolName })}
      </div>
    );
  }
  // Deny defaults to local-only (the action simply stays un-run). When the
  // host also provided `onDeny` (e.g. a Code session resolving its own
  // pending approval), it fires alongside the local state.
  if (resolution === "denied") {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        {t("agentChat.approval.denied", { tool: toolName })}
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5">
      <IconShieldCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">
        {t("agentChat.approval.question", { tool: toolName })}
      </span>
      {ctx && (
        <button
          type="button"
          onClick={() => {
            setLocalResolution("approved");
            ctx.onApprovalResolved?.(
              approval.approvalKey,
              "approved",
              toolCallId,
              approval.askId,
            );
            ctx.onApprove(approval.approvalKey);
          }}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            "bg-foreground text-background hover:bg-foreground/90",
          )}
        >
          <IconCheck className="h-3.5 w-3.5" />
          {t("agentChat.approval.approve")}
        </button>
      )}
      {ctx?.onAlwaysAllow && (
        <button
          type="button"
          onClick={() => {
            setLocalResolution("approved");
            ctx.onApprovalResolved?.(
              approval.approvalKey,
              "approved",
              toolCallId,
              approval.askId,
            );
            ctx.onAlwaysAllow?.(approval.approvalKey);
          }}
          title={t("agentChat.approval.alwaysAllowHint")}
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors",
            "text-foreground hover:bg-muted",
          )}
        >
          <IconShieldCheck className="h-3.5 w-3.5" />
          {t("agentChat.approval.alwaysAllow")}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setLocalResolution("denied");
          ctx?.onApprovalResolved?.(
            approval.approvalKey,
            "denied",
            toolCallId,
            approval.askId,
          );
          ctx?.onDeny?.(approval.approvalKey);
        }}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium transition-colors",
          "text-foreground hover:bg-muted",
        )}
      >
        <IconX className="h-3.5 w-3.5" />
        {t("agentChat.approval.deny")}
      </button>
    </div>
  );
}

// ─── ToolCallDisplay ──────────────────────────────────────────────────────────

export function ToolCallDisplay({
  toolName,
  toolCallId,
  argsText,
  args,
  result,
  mcpApp,
  chatUI,
  isRunning,
  outcome,
  structuredMeta,
  activity,
  approval,
  repeatCount,
  isLatestRunning = isRunning,
  isActiveTail,
}: {
  toolName: string;
  toolCallId?: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  /** "unknown": the stream ended mid-flight, so the side effect may have landed. */
  outcome?: "unknown";
  structuredMeta?: Record<string, unknown>;
  activity?: boolean;
  approval?: { approvalKey: string; dismissed?: boolean };
  repeatCount?: number;
  /** The latest tool shown while the overall chat turn is still active. */
  isActiveTail?: boolean;
  /** @deprecated Use isActiveTail. */
  isLatestRunning?: boolean;
}) {
  const isDelegatedAgentCall =
    toolName === "call-agent" || toolName.startsWith("agent:");
  const effectiveIsRunning =
    isRunning ||
    (isDelegatedAgentCall &&
      isToolCallActive({
        type: "tool-call",
        toolName,
        result,
        outcome,
        activity,
        structuredMeta,
      }));
  const showActiveTail = isActiveTail ?? isLatestRunning;
  // Delegate to bespoke cells when structured metadata is present.
  // These must be separate components so hook order in ToolCallDisplayGeneric
  // is always stable (no conditional hook calls).
  const toolKind = structuredMeta?.toolKind as string | undefined;
  const wrapToolDisplay = (children: React.ReactNode) => (
    <ToolActivityPresentation
      toolName={toolName}
      isRunning={effectiveIsRunning}
      toolCallId={toolCallId}
      suppressLongRunningHint={
        toolName === "call-agent" || toolName.startsWith("agent:")
      }
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
        isRunning={effectiveIsRunning}
      />,
    );
  }
  if (toolKind === "edit") {
    return wrapToolDisplay(
      <EditCell
        meta={
          structuredMeta as unknown as Parameters<typeof EditCell>[0]["meta"]
        }
        isRunning={effectiveIsRunning}
      />,
    );
  }
  if (toolKind === "write") {
    return wrapToolDisplay(
      <WriteCell
        meta={
          structuredMeta as unknown as Parameters<typeof WriteCell>[0]["meta"]
        }
        isRunning={effectiveIsRunning}
      />,
    );
  }
  return wrapToolDisplay(
    <ToolCallDisplayGeneric
      toolName={toolName}
      toolCallId={toolCallId}
      argsText={argsText}
      args={args}
      result={result}
      mcpApp={mcpApp}
      chatUI={chatUI}
      isRunning={effectiveIsRunning}
      outcome={outcome}
      isActiveTail={showActiveTail}
      structuredMeta={structuredMeta}
      approval={approval}
      repeatCount={repeatCount}
    />,
  );
}

function ToolCallDisplayGeneric({
  toolName,
  toolCallId,
  argsText,
  args,
  result,
  mcpApp,
  chatUI,
  isRunning,
  outcome,
  isActiveTail,
  structuredMeta,
  approval,
  repeatCount,
}: {
  toolName: string;
  toolCallId?: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  outcome?: "unknown";
  isActiveTail: boolean;
  structuredMeta?: Record<string, unknown>;
  approval?: { approvalKey: string; dismissed?: boolean };
  repeatCount?: number;
}) {
  const t = useT();
  const suppressInlineOpenApp = React.useContext(SuppressInlineOpenAppContext);
  const isRawCallAgent = toolName === "call-agent";
  const isAgentCall = toolName.startsWith("agent:") || isRawCallAgent;
  const [expanded, setExpanded] = useState(isAgentCall);
  const [outputOpen, setOutputOpen] = useState(false);
  const agentName = toolName.startsWith("agent:")
    ? toolName.slice(6)
    : typeof args.agent === "string"
      ? args.agent
      : null;
  const isAgentError = isAgentCall && result === "Error calling agent";
  const isUnknownOutcome = !isRunning && outcome === "unknown";
  const agentStreamText = isRawCallAgent
    ? (result ?? "")
    : isAgentCall
      ? (argsText ?? "")
      : "";
  const agentActivity = structuredMeta?.agentActivity as
    | A2AAgentActivitySnapshot
    | undefined;
  const agentProgress = structuredMeta?.agentProgress as
    | AgentCallProgress
    | undefined;
  const hasStreamText = agentStreamText.length > 0;
  const hasArgs = !isAgentCall && Object.keys(args).length > 0;

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
      // coercion-ok: malformed tool output should fall through to the default tool pill
      // fall through to default pill rendering
    }
  }

  if (toolName === "connect-file-storage" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.kind === "connect-file-storage-card") {
        return <FileStorageSetupCard />;
      }
    } catch {
      // coercion-ok: malformed storage tool output should fall through to the default tool pill
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
              t("agentChat.tool.subAgentTask")
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
    return (
      <ActionChatUiSurface
        context={nativeToolContext}
        isBuiltinDataWidget={
          isBuiltinDataWidgetActionRenderer(nativeToolContext) ||
          isBuiltinWorkspaceFileResult(nativeToolContext)
        }
      >
        <NativeToolRenderer context={nativeToolContext} />
      </ActionChatUiSurface>
    );
  }

  const inputPayload = hasArgs
    ? toolInputPayload(toolName, args, {
        input: t("agentChat.tool.input"),
        inputWithLabel: (label) =>
          t("agentChat.tool.inputWithLabel", { label }),
      })
    : null;
  const resultPayload = toolResultPayload(result, t("agentChat.tool.result"));

  const displayName = isAgentCall
    ? isRunning
      ? t("agentChat.tool.askingAgent", { agent: agentName })
      : isAgentError
        ? t("agentChat.tool.askingAgentFailed", { agent: agentName })
        : t("agentChat.tool.askedAgent", { agent: agentName })
    : humanizeToolName(toolName);

  const canExpand = isAgentCall
    ? hasStreamText
    : hasArgs || result !== undefined;
  const isExpanded = isAgentCall ? hasStreamText && expanded : expanded;
  const ToolIcon = resolveToolIcon(toolName);
  const outputTitle = t("agentChat.tool.rawOutput", { tool: toolName });

  if (isAgentCall) {
    return (
      <AgentCallCell
        agentName={agentName ?? t("agentChat.common.agent")}
        activity={agentActivity}
        progress={agentProgress}
        responseText={agentStreamText}
        isRunning={isRunning}
        isError={isAgentError}
        durationMs={
          typeof structuredMeta?.agentDurationMs === "number"
            ? structuredMeta.agentDurationMs
            : agentActivity?.durationMs
        }
      />
    );
  }

  return (
    <div className="group/tool my-0.5 w-full overflow-hidden">
      {mcpApp && !(suppressInlineOpenApp && toolName === "open_app") && (
        <McpAppRenderer app={mcpApp} className="mb-1.5" />
      )}
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
          ) : isUnknownOutcome ? (
            <IconAlertTriangle className="size-3.5 text-muted-foreground" />
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
            title={t("agentChat.tool.repeated", { count: repeatCount })}
          >
            {repeatCount}x
          </span>
        )}
      </button>
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
                aria-label={t("agentChat.tool.viewOutput", {
                  tool: toolName,
                })}
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
              >
                <IconCode className="size-3.5" />
              </button>
            </ToolOutputPopover>
          )}
        </div>
      </AnimatedCollapse>
      {isUnknownOutcome && (
        <p role="status" className="ps-5 text-xs text-muted-foreground">
          {t("agentChat.tool.interrupted")}
        </p>
      )}
      {approval && (
        <ApprovalAffordance
          toolName={toolName}
          toolCallId={toolCallId}
          approval={approval}
        />
      )}
    </div>
  );
}

function AgentCallCell({
  agentName,
  activity,
  progress,
  responseText,
  isRunning,
  isError,
  durationMs,
}: {
  agentName: string;
  activity?: A2AAgentActivitySnapshot;
  progress?: AgentCallProgress;
  responseText: string;
  isRunning: boolean;
  isError: boolean;
  durationMs?: number;
}) {
  const t = useT();
  const formatDuration = useLocalizedWorkedDuration();
  const [open, setOpen] = useState(true);
  const toolCount = activity?.toolCalls?.length ?? 0;
  // Response segments are ordered against the tool calls that preceded them, so
  // they render in the timeline where the remote agent actually said them.
  // Once the authoritative result text arrives, its segment moves to the
  // bottom block instead of being rendered twice.
  const segments = activity?.response ?? [];
  const inlineSegments =
    responseText && !isRunning ? segments.slice(0, toolCount) : segments;
  const finalText =
    responseText || (inlineSegments.length ? "" : activity?.responseText);
  const work =
    activity?.reasoning?.length || toolCount || inlineSegments.length;
  const workItemCount = Math.max(
    activity?.reasoning?.length ?? 0,
    toolCount,
    inlineSegments.length,
  );
  const label = isRunning
    ? t("agentChat.tool.askingAgent", { agent: agentName })
    : isError
      ? t("agentChat.tool.askingAgentFailed", { agent: agentName })
      : t("agentChat.tool.askedAgent", { agent: agentName });
  const workContent = work ? (
    <div className="space-y-1 ps-5">
      {Array.from({ length: workItemCount }, (_, index) => {
        const reasoningText = activity?.reasoning?.[index];
        const segment = inlineSegments[index];
        const tool = activity?.toolCalls?.[index];
        return (
          <React.Fragment key={`activity-${index}`}>
            {reasoningText && (
              <ReasoningCell
                text={reasoningText}
                isStreaming={
                  isRunning &&
                  activity.activePhase === "reasoning" &&
                  index === activity.reasoning.length - 1
                }
                defaultOpen={index === activity.reasoning.length - 1}
                collapseWhenReplaced={index < activity.toolCalls.length}
              />
            )}
            {segment && (
              <div className="pb-1">
                <SmoothMarkdownText
                  text={segment}
                  streaming={
                    isRunning &&
                    activity?.activePhase === "responding" &&
                    index === inlineSegments.length - 1
                  }
                  resetKey={`agent-response-${agentName}-${index}`}
                  statusType={isRunning ? "running" : "complete"}
                />
              </div>
            )}
            {tool && (
              <AgentActivityToolCallRow
                tool={tool}
                isActiveTail={
                  isRunning && index === activity.toolCalls.length - 1
                }
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  ) : null;
  const progressState = progress?.state.replaceAll(/[-_]+/g, " ");
  const progressText =
    isRunning && !activity && progress && progressState
      ? [
          progressState.charAt(0).toUpperCase() + progressState.slice(1),
          t("agentChat.tool.elapsed", {
            duration: formatDuration(progress.elapsedSeconds * 1000),
          }),
          progress.detail,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;
  return (
    <div className="group/tool my-0.5 w-full">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        {isRunning ? (
          <IconLoader2 className="size-3.5 animate-spin" />
        ) : isError ? (
          <IconCircleX className="size-3.5 text-destructive" />
        ) : (
          <IconChevronRight
            className={cn("size-3.5 transition-transform", open && "rotate-90")}
          />
        )}
        <span
          className={cn(
            "min-w-0 truncate font-normal",
            isRunning && "agent-running-shimmer",
          )}
        >
          {label}
        </span>
      </button>
      <AnimatedCollapse open={open}>
        <div className="ms-1 border-s border-border/50 ps-2 pt-1">
          {workContent &&
            (isRunning ? (
              workContent
            ) : (
              <WorkedForSummary durationMs={durationMs}>
                {workContent}
              </WorkedForSummary>
            ))}
          {progressText && (
            <p
              className="ps-5 pb-1 text-xs text-muted-foreground"
              data-testid="agent-call-progress"
              aria-live="polite"
            >
              {progressText}
            </p>
          )}
          {finalText && (
            <div className="ps-5 pb-1">
              <SmoothMarkdownText
                text={finalText}
                streaming={isRunning}
                resetKey={`agent-response-${agentName}`}
                statusType={isRunning ? "running" : "complete"}
              />
            </div>
          )}
        </div>
      </AnimatedCollapse>
    </div>
  );
}

function AgentActivityToolCallRow({
  tool,
  isActiveTail,
}: {
  tool: A2AAgentActivityToolCall;
  isActiveTail: boolean;
}) {
  const isRunning = tool.status === "running";
  const ToolIcon = resolveToolIcon(tool.name);

  return (
    <ToolActivityPresentation
      toolName={tool.name}
      isRunning={isRunning}
      toolCallId={tool.id}
      suppressLongRunningHint
    >
      <div className="my-0.5 flex w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[13px] text-muted-foreground">
        <span className="flex size-4 shrink-0 items-center justify-center">
          {isRunning ? (
            <IconLoader2 className="size-3.5 animate-spin" />
          ) : (
            <ToolIcon className="size-3.5" />
          )}
        </span>
        <span
          className={cn(
            "min-w-0 truncate font-normal",
            isActiveTail && "agent-running-shimmer",
          )}
        >
          {humanizeToolName(tool.name)}
        </span>
      </div>
    </ToolActivityPresentation>
  );
}

// ─── ToolCallFallback ──────────────────────────────────────────────────────────

export function ToolCallFallback({
  toolName,
  toolCallId,
  args,
  argsText,
  result,
  ...rest
}: ToolCallMessagePartProps & {
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  structuredMeta?: Record<string, unknown>;
  activity?: boolean;
  outcome?: "unknown";
  approval?: { approvalKey: string; dismissed?: boolean };
  repeatCount?: number;
  isLatestRunning?: boolean;
  isActiveTail?: boolean;
}) {
  const chatRunning = React.useContext(ChatRunningContext);
  // `chatRunning` covers ordinary live activity. An unresolved tool or a
  // delegated-agent row is also explicit work evidence, while a generic
  // activity placeholder alone must stay frozen when history is rehydrated.
  const isRunning =
    rest.outcome !== "unknown" &&
    ((result === undefined && chatRunning) ||
      isToolCallActive({
        type: "tool-call",
        toolName,
        result,
        outcome: rest.outcome,
        activity: rest.activity,
        structuredMeta: rest.structuredMeta,
      }));
  return (
    <ToolCallDisplay
      toolName={toolName}
      toolCallId={toolCallId}
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
      activity={rest.activity}
      isRunning={isRunning}
      outcome={rest.outcome}
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
  allowActivitySpinner = true,
}: {
  content: ContentPart[];
  /** Activity-only cards are live during reconnect, but static once frozen. */
  allowActivitySpinner?: boolean;
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
      part.type === "tool-call" &&
      !isCallAgentToolCallShadowed(content, index) &&
      (chatRunning || (allowActivitySpinner && part.activity === true))
        ? index
        : latestIndex,
    -1,
  );

  const renderPart = (part: ContentPart, i: number) => {
    if (isCallAgentToolCallShadowed(content, i)) return null;
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
        toolCallId={part.toolCallId}
        argsText={part.argsText}
        args={part.args}
        result={part.result}
        mcpApp={part.mcpApp}
        chatUI={part.chatUI}
        structuredMeta={part.structuredMeta}
        activity={part.activity}
        outcome={part.outcome}
        isRunning={
          part.result === undefined &&
          (chatRunning || (allowActivitySpinner && part.activity === true))
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
        motionKey={`reconnect-${summaryStartIndex}`}
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
    if (isCallAgentToolCallShadowed(content, i)) continue;
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
      <div className="w-full max-w-[95%] text-sm leading-relaxed text-foreground">
        <ToolCallStackMotion className="space-y-1">
          {renderedParts}
        </ToolCallStackMotion>
      </div>
    </div>
  );
}

function getReconnectToolSummaryInfo(content: readonly ContentPart[]) {
  const toolCallIndices = content.reduce<number[]>((indices, part, index) => {
    if (
      part.type === "tool-call" &&
      !isCallAgentToolCallShadowed(content, index) &&
      isReconnectSummarizablePart(part)
    ) {
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
      part.mcpApp === undefined &&
      !toolCallHasPendingApproval(part))
  );
}

function isReconnectToolSummaryPart(
  content: readonly ContentPart[],
  index: number,
  startIndex: number,
): boolean {
  if (startIndex < 0 || index >= startIndex) return false;
  if (
    isCallAgentToolCallShadowed(content, index) ||
    !isReconnectSummarizablePart(content[index]!)
  ) {
    return false;
  }

  let segmentStart = index;
  while (
    segmentStart > 0 &&
    !isCallAgentToolCallShadowed(content, segmentStart - 1) &&
    isReconnectSummarizablePart(content[segmentStart - 1]!)
  ) {
    segmentStart--;
  }

  let segmentEnd = index + 1;
  while (
    segmentEnd < startIndex &&
    !isCallAgentToolCallShadowed(content, segmentEnd) &&
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
  defaultOpen,
  autoCollapse = false,
  collapseWhenReplaced = false,
  durationMs,
}: {
  text: string;
  isStreaming?: boolean;
  /** Stable identity retained for callers; reasoning renders chunk-natively. */
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
  const t = useT();
  const formatDuration = useLocalizedWorkedDuration();
  const embeddedInWorkSummary = React.useContext(WorkSummaryContentContext);
  const [open, setOpen] = useState(defaultOpen ?? true);
  const wasStreamingRef = useRef(isStreaming);
  const wasReplacedRef = useRef(collapseWhenReplaced);
  const trimmed = text.trim();
  // Reasoning is already a compact live status surface. Rendering the latest
  // chunk directly avoids a second character-level queue that can lag behind
  // the model and make the surrounding chat look like it is jumping.
  const visibleText = trimmed;

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
    ? t("agentChat.status.thinking")
    : durationMs != null
      ? t("agentChat.tool.thoughtFor", {
          duration: formatDuration(durationMs),
        })
      : t("agentChat.tool.thought");
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

export function formatWorkedDuration(
  ms: number,
  options: {
    locale?: string;
    hour?: string;
    minute?: string;
    second?: string;
  } = {},
): string {
  const number = new Intl.NumberFormat(options.locale ?? "en-US");
  const hour = options.hour ?? "h";
  const minute = options.minute ?? "m";
  const second = options.second ?? "s";
  const part = (value: number, unit: string) =>
    `${number.format(value)}${unit}`;
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) {
    return part(Math.max(1, totalSeconds), second);
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    if (seconds === 0) return part(minutes, minute);
    return `${part(minutes, minute)} ${part(seconds, second)}`;
  }
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (remMinutes === 0) return part(hours, hour);
  return `${part(hours, hour)} ${part(remMinutes, minute)}`;
}

export function useLocalizedWorkedDuration() {
  const t = useT();
  const locale = useOptionalLocale()?.locale ?? "en-US";
  return useCallback(
    (ms: number) =>
      formatWorkedDuration(ms, {
        locale,
        hour: t("agentChat.duration.hourShort"),
        minute: t("agentChat.duration.minuteShort"),
        second: t("agentChat.duration.secondShort"),
      }),
    [locale, t],
  );
}

export function WorkedForSummary({
  durationMs,
  defaultOpen = false,
  autoCollapse = false,
  children,
}: {
  durationMs?: number | null;
  /** Keep completed work visible when the turn contains interactive UI. */
  defaultOpen?: boolean;
  /** When true, close the summary after a run has completed. */
  autoCollapse?: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  const formatDuration = useLocalizedWorkedDuration();
  // Ordinary completed work starts closed so a remount never flashes details
  // while auto-collapse settles. Interactive UI opts into an open summary.
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
    } else if (autoCollapse) {
      setOpen(false);
    }
  }, [autoCollapse, defaultOpen]);

  const label =
    durationMs != null && durationMs >= 1000
      ? t("agentChat.tool.workedFor", {
          duration: formatDuration(durationMs),
        })
      : t("agentChat.tool.worked");

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
  motionKey = "summary",
  children,
}: {
  toolCount: number;
  motionKey?: string;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const label = t("agentChat.tool.ranTools", { count: toolCount });

  return (
    <div
      className="agent-tool-summary my-1 w-full"
      data-agent-tool-summary={motionKey}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <span className="agent-tool-summary__label">{label}</span>
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
