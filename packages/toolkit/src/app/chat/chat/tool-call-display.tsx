import type {
  A2AAgentActivitySnapshot,
  A2AAgentActivityToolCall,
} from "@agent-native/core/a2a";
import type { ActionChatUIConfig } from "@agent-native/core/action-ui";
import { formatAgentChatContextItemsForPrompt } from "@agent-native/core/client/agent-chat";
import type {
  AgentCallProgress,
  ContentPart,
} from "@agent-native/core/client/agent-chat";
import { useAgentChatContext } from "@agent-native/core/client/agent-chat";
import { useOptionalLocale, useT } from "@agent-native/core/client/i18n";
import {
  isCallAgentToolCallShadowed,
  isToolCallActive,
  resolveToolCallRowContext,
  toolLabel,
} from "@agent-native/core/client/tool-display";
import { useFileUploadStatus } from "@agent-native/core/client/uploads";
import type { AgentMcpAppPayload } from "@agent-native/core/mcp-client";
import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { Button } from "@agent-native/toolkit/ui/button";
import { CubeLoader } from "@agent-native/toolkit/ui/cube-loader";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { cn } from "@agent-native/toolkit/utils";
import type { ToolCallMessagePartProps } from "@assistant-ui/react";
import {
  IconAlertTriangle,
  IconArrowFork,
  IconBrain,
  IconCheck,
  IconClock,
  IconCopy,
  IconCode,
  IconTerminal2,
  IconDatabase,
  IconSearch,
  IconFileCode,
  IconTool,
} from "@tabler/icons-react";
import React, {
  useState,
  useEffect,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
} from "react";

import { AgentKitDisclosureSummary } from "../../agentkit/react/components.js";
import type { AgentChatDataChartLayout } from "../../agentkit/react/data-chart-layout.js";
import {
  workedForRowChevronStyle,
  workedForRowSummaryStyle,
  type AgentChatWorkedForRowLayout,
} from "../../agentkit/react/transcript-layout.js";
import { AgentTaskCard } from "../AgentTaskCard.js";
import { ConnectBuilderCard } from "../ConnectBuilderCard.js";
import { FileStorageSetupPopover } from "../FileStorageSetupPopover.js";
import { McpAppRenderer } from "../mcp-apps/McpAppRenderer.js";
import {
  SESSION_REPLAY_BLOCK_PROPS,
  SESSION_REPLAY_MASK_PROPS,
} from "../session-replay-privacy.js";
import { useThinkingDisplay } from "../thinking-display.js";
import {
  BashCell,
  EditCell,
  WriteCell,
  FilesChangedSummary,
} from "../tool-cells/index.js";
import { ActionChatUiSurface } from "./action-chat-ui-surface.js";
import { AgentActivityObject } from "./agent-activity-object.js";
import { AgentApprovalCard } from "./agent-approval-card.js";
import {
  SmoothMarkdownText,
  HighlightedCodeBlock,
} from "./markdown-renderer.js";
import {
  IntegrationToolBadge,
  resolveToolIntegration,
} from "./tool-integration.js";
import {
  resolveToolRenderer,
  type ToolRendererContext,
} from "./tool-render-registry.js";
import {
  isBuiltinDataWidgetActionRenderer,
  isBuiltinWorkspaceFileResult,
  isBuiltinConnectRequiredResult,
  resolveBuiltinActionChatRenderer,
  resolveBuiltinFallbackToolRenderer,
} from "./widgets/builtin-tool-renderers.js";

export const ChatRunningContext = React.createContext(false);
export const ChatRunningRunIdContext = React.createContext<string | null>(null);
export const ChatRunningTurnIdContext = React.createContext<string | null>(
  null,
);
export const ChatRunDurationContext = React.createContext<number | null>(null);
export const SuppressInlineOpenAppContext = React.createContext(false);
export const ASSISTANT_VISIBLE_TOOL_CALL_LIMIT = 3;
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

function FileStorageSetupToolCall() {
  const t = useT();
  const fileUploadStatus = useFileUploadStatus();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t("onboarding.fileStorage.title")}
      </Button>
      <FileStorageSetupPopover
        open={open}
        onOpenChange={setOpen}
        {...(!fileUploadStatus.isSuccess || fileUploadStatus.isError
          ? {
              status: "unavailable" as const,
              onRetry: () => void fileUploadStatus.refetch(),
            }
          : { status: "missing" as const })}
      />
    </>
  );
}

export type ApprovalResolution = "approved" | "denied";

export type ApprovalContextValue = {
  onApprove: (approvalKey: string) => void;
  onApprovalResolved?: (
    approvalKey: string,
    resolution: ApprovalResolution,
    toolCallId?: string,
    askId?: string,
  ) => void;
  getApprovalResolution?: (
    approvalKey: string,
    toolCallId?: string,
    askId?: string,
  ) => ApprovalResolution | null;
  onDeny?: (approvalKey: string) => void;
  onAlwaysAllow?: (
    approvalKey: string,
    toolName: string,
  ) => void | Promise<void>;
};
export const ApprovalContext = React.createContext<ApprovalContextValue | null>(
  null,
);

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

export const TOOL_LONG_RUNNING_HINT_DELAY_MS = 30_000;

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
          <div className="agent-kit-caption-copy mt-0.5 px-2.5 pb-2 leading-snug text-muted-foreground/80">
            {t("agentChat.tool.longRunning")}
          </div>
        )}
      </div>
    </div>
  );
}

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

function parseJsonText(text: string): unknown {
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

type ToolIconComponent = React.ComponentType<{
  className?: string;
  size?: number | string;
}>;

function resolveToolIcon(toolName: string): ToolIconComponent {
  const name = toolName.toLowerCase();
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
        "agent-tool-code agent-kit-caption-copy overflow-auto rounded-md bg-muted/70 font-mono leading-relaxed text-foreground",
        maxHeightClass,
        className,
      )}
    >
      {lang !== "text" && (
        <div className="sticky top-0 z-[1] flex items-center justify-between border-b border-border/40 bg-muted/90 px-2.5 py-1">
          <span className="agent-kit-micro-copy font-mono uppercase tracking-wide text-muted-foreground/80">
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

export function AnimatedCollapse({
  id,
  open,
  children,
}: {
  id?: string;
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
      id={id}
      className="agent-chat-collapse"
      data-state={open ? "open" : "closed"}
      aria-hidden={!open}
      onTransitionEnd={onTransitionEnd}
    >
      <div className="agent-chat-collapse__content">{children}</div>
    </div>
  );
}

function ApprovalAffordance({
  toolName,
  toolCallId,
  approval,
}: {
  toolName: string;
  toolCallId?: string;
  approval: {
    approvalKey: string;
    dismissed?: boolean;
    askId?: string;
    allowPersistentApproval?: false;
  };
}) {
  const t = useT();
  const ctx = React.useContext(ApprovalContext);
  const [localResolution, setLocalResolution] =
    useState<ApprovalResolution | null>(null);
  const [isAlwaysAllowing, setIsAlwaysAllowing] = useState(false);
  const [alwaysAllowFailed, setAlwaysAllowFailed] = useState(false);
  const onAlwaysAllow =
    approval.allowPersistentApproval === false ? undefined : ctx?.onAlwaysAllow;
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

  if (resolution === "approved") {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        {t("agentChat.approval.approved", { tool: toolName })}
      </div>
    );
  }
  if (resolution === "denied") {
    return (
      <div className="mt-1.5 text-xs text-muted-foreground">
        {t("agentChat.approval.denied", { tool: toolName })}
      </div>
    );
  }
  const handleAlwaysAllow = async () => {
    if (!onAlwaysAllow || isAlwaysAllowing) return;
    setIsAlwaysAllowing(true);
    setAlwaysAllowFailed(false);
    try {
      await onAlwaysAllow(approval.approvalKey, toolName);
      setLocalResolution("approved");
      ctx?.onApprovalResolved?.(
        approval.approvalKey,
        "approved",
        toolCallId,
        approval.askId,
      );
    } catch {
      setAlwaysAllowFailed(true);
    } finally {
      setIsAlwaysAllowing(false);
    }
  };
  return (
    <AgentApprovalCard
      toolName={toolName}
      question={t("agentChat.approval.question", { tool: toolName })}
      approveLabel={t("agentChat.approval.approve")}
      denyLabel={t("agentChat.approval.deny")}
      moreOptionsLabel={t("agentChat.approval.moreOptions")}
      alwaysAllowLabel={t("agentChat.approval.alwaysAllowAction")}
      alwaysAllowHint={t("agentChat.approval.alwaysAllowActionHint")}
      saveFailedLabel={
        alwaysAllowFailed ? t("agentChat.common.saveFailed") : undefined
      }
      isAlwaysAllowing={isAlwaysAllowing}
      onApprove={
        ctx
          ? () => {
              setLocalResolution("approved");
              ctx.onApprovalResolved?.(
                approval.approvalKey,
                "approved",
                toolCallId,
                approval.askId,
              );
              ctx.onApprove(approval.approvalKey);
            }
          : undefined
      }
      onDeny={() => {
        setLocalResolution("denied");
        ctx?.onApprovalResolved?.(
          approval.approvalKey,
          "denied",
          toolCallId,
          approval.askId,
        );
        ctx?.onDeny?.(approval.approvalKey);
      }}
      onAlwaysAllow={onAlwaysAllow ? handleAlwaysAllow : undefined}
    />
  );
}

export function ToolCallDisplay({
  toolName,
  toolCallId,
  argsText,
  args,
  result,
  status,
  mcpApp,
  chatUI,
  isRunning,
  isError,
  outcome,
  structuredMeta,
  activity,
  approval,
  repeatCount,
  isLatestRunning = isRunning,
  isActiveTail,
  workedForRowLayout,
  dataChartLayout,
  formatWorkedForDuration,
}: {
  toolName: string;
  toolCallId?: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  status?: ToolRendererContext["status"];
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  isError?: boolean;
  outcome?: "unknown";
  structuredMeta?: Record<string, unknown>;
  activity?: boolean;
  approval?: {
    approvalKey: string;
    dismissed?: boolean;
    askId?: string;
    allowPersistentApproval?: false;
  };
  repeatCount?: number;
  isActiveTail?: boolean;
  workedForRowLayout?: AgentChatWorkedForRowLayout;
  dataChartLayout?: AgentChatDataChartLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
  /** @deprecated Use isActiveTail. */
  isLatestRunning?: boolean;
}) {
  const { items: agentChatContextItems } = useAgentChatContext(
    toolName === "connect-builder",
  );
  const builderContext =
    toolName === "connect-builder"
      ? formatAgentChatContextItemsForPrompt(agentChatContextItems)
      : "";
  const isDelegatedAgentCall =
    toolName === "call-agent" || toolName.startsWith("agent:");
  const effectiveIsRunning =
    !isError &&
    (isRunning ||
      (isDelegatedAgentCall &&
        isToolCallActive({
          type: "tool-call",
          toolName,
          result,
          outcome,
          activity,
          structuredMeta,
        })));
  const showActiveTail = isActiveTail ?? isLatestRunning;
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
  if (!isError && toolKind === "bash") {
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
  if (!isError && toolKind === "edit") {
    return wrapToolDisplay(
      <EditCell
        meta={
          structuredMeta as unknown as Parameters<typeof EditCell>[0]["meta"]
        }
        isRunning={effectiveIsRunning}
      />,
    );
  }
  if (!isError && toolKind === "write") {
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
      status={status}
      mcpApp={mcpApp}
      chatUI={chatUI}
      isRunning={effectiveIsRunning}
      isError={isError}
      outcome={outcome}
      isActiveTail={showActiveTail}
      structuredMeta={structuredMeta}
      approval={approval}
      repeatCount={repeatCount}
      context={builderContext}
      workedForRowLayout={workedForRowLayout}
      dataChartLayout={dataChartLayout}
      formatWorkedForDuration={formatWorkedForDuration}
    />,
  );
}

const WorkSummaryContentContext = React.createContext(false);

function ToolCallDisplayGeneric({
  toolName,
  toolCallId,
  argsText,
  args,
  result,
  status,
  mcpApp,
  chatUI,
  isRunning,
  isError = false,
  outcome,
  isActiveTail,
  structuredMeta,
  approval,
  repeatCount,
  context,
  workedForRowLayout,
  dataChartLayout,
  formatWorkedForDuration,
}: {
  toolName: string;
  toolCallId?: string;
  argsText?: string;
  args: Record<string, unknown>;
  result?: string;
  status?: ToolRendererContext["status"];
  mcpApp?: AgentMcpAppPayload;
  chatUI?: ActionChatUIConfig;
  isRunning: boolean;
  isError?: boolean;
  outcome?: "unknown";
  isActiveTail: boolean;
  structuredMeta?: Record<string, unknown>;
  approval?: {
    approvalKey: string;
    dismissed?: boolean;
    askId?: string;
    allowPersistentApproval?: false;
  };
  repeatCount?: number;
  context?: string;
  workedForRowLayout?: AgentChatWorkedForRowLayout;
  dataChartLayout?: AgentChatDataChartLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
}) {
  const t = useT();
  const embeddedInWorkSummary = React.useContext(WorkSummaryContentContext);
  const suppressInlineOpenApp = React.useContext(SuppressInlineOpenAppContext);
  const isRawCallAgent = toolName === "call-agent";
  const isAgentCall = toolName.startsWith("agent:") || isRawCallAgent;
  const [expanded, setExpanded] = useState(false);
  const [outputOpen, setOutputOpen] = useState(false);
  const contentId = useId();
  const agentName = toolName.startsWith("agent:")
    ? toolName.slice(6)
    : typeof args.agent === "string"
      ? args.agent
      : null;
  const isAgentError =
    isAgentCall && (isError || result === "Error calling agent");
  const isUnknownOutcome = !isRunning && outcome === "unknown";
  const agentStreamText = isAgentError
    ? ""
    : isRawCallAgent
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

  if (!isError && toolName === "connect-builder" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.kind === "connect-builder-card") {
        return (
          <ConnectBuilderCard
            configured={!!parsed.configured}
            builderEnabled={parsed.builderEnabled !== false}
            connectUrl={parsed.connectUrl || ""}
            orgName={parsed.orgName ?? null}
            prompt={typeof parsed.prompt === "string" ? parsed.prompt : ""}
            context={context}
          />
        );
      }
    } catch {
      // coercion-ok: malformed tool output should fall through to the default tool pill
      // fall through to default pill rendering
    }
  }

  if (!isError && toolName === "connect-file-storage" && result) {
    try {
      const parsed = JSON.parse(result);
      if (parsed?.kind === "connect-file-storage-card") {
        return <FileStorageSetupToolCall />;
      }
    } catch {
      // coercion-ok: malformed storage tool output should fall through to the default tool pill
      // fall through to default pill rendering
    }
  }

  if (
    !isError &&
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
    status,
    isRunning,
    isActiveTail,
    dataChartLayout,
    ...(typeof toolCallId === "string"
      ? { widgetId: `${toolCallId}:chat-ui` }
      : {}),
    chatUI,
  };
  const skipRegistryRenderer =
    !isAgentCall && isBuiltinDataWidgetActionRenderer(nativeToolContext);
  const NativeToolRenderer =
    isError || isAgentCall
      ? null
      : (resolveBuiltinActionChatRenderer(nativeToolContext) ??
        (skipRegistryRenderer
          ? null
          : resolveToolRenderer(nativeToolContext)) ??
        resolveBuiltinFallbackToolRenderer(nativeToolContext));
  if (NativeToolRenderer) {
    return (
      <ActionChatUiSurface
        context={nativeToolContext}
        isBuiltinDataWidget={
          isBuiltinDataWidgetActionRenderer(nativeToolContext) ||
          isBuiltinWorkspaceFileResult(nativeToolContext) ||
          isBuiltinConnectRequiredResult(nativeToolContext)
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

  const displayName = toolLabel(t, toolName);
  const rowContext = isAgentCall ? null : resolveToolCallRowContext(args);

  const canExpand = isAgentCall
    ? hasStreamText
    : hasArgs || result !== undefined || isError;
  const isExpanded = isAgentCall ? hasStreamText && expanded : expanded;
  const integration = resolveToolIntegration(toolName, args);
  const ToolIcon = resolveToolIcon(toolName);
  const outputTitle = t("agentChat.tool.rawOutput", { tool: toolName });

  if (isAgentCall) {
    return (
      <AgentCallCell
        agentName={agentName ?? t("agentChat.common.agent")}
        toolCallId={toolCallId}
        activity={agentActivity}
        progress={agentProgress}
        responseText={agentStreamText}
        isRunning={isRunning}
        isError={isAgentError}
        errorText={
          isAgentError
            ? result || t("agentChat.tool.failedWithoutDetails")
            : undefined
        }
        durationMs={
          typeof structuredMeta?.agentDurationMs === "number"
            ? structuredMeta.agentDurationMs
            : agentActivity?.durationMs
        }
        workedForRowLayout={workedForRowLayout}
        formatWorkedForDuration={formatWorkedForDuration}
      />
    );
  }

  return (
    <div className="group/tool my-0.5 w-full overflow-hidden">
      {mcpApp &&
        !(suppressInlineOpenApp && toolName === "open_app") && (
          // The recorder keeps iframe attributes, and a snapshot's srcdoc can show the failure.
          <div {...(isError ? SESSION_REPLAY_BLOCK_PROPS : {})}>
            <McpAppRenderer app={mcpApp} className="mb-1.5" />
          </div>
        )}
      <AgentKitDisclosureSummary
        rowClassName="agentkit-activity-row agent-kit-density text-muted-foreground"
        open={isExpanded}
        onToggle={() => setExpanded(!isExpanded)}
        expandable={canExpand}
        as={canExpand ? "button" : "static"}
        controls={isExpanded ? contentId : undefined}
        icon={
          integration ? (
            <IntegrationToolBadge integration={integration} />
          ) : isRunning ? (
            <CubeLoader aria-hidden="true" className="size-4" />
          ) : isUnknownOutcome || isError ? (
            <IconAlertTriangle
              aria-hidden="true"
              className="agentkit-icon text-[hsl(var(--agent-kit-warning))]"
            />
          ) : (
            <ToolIcon aria-hidden="true" className="agentkit-icon" />
          )
        }
        label={
          <span
            className={cn(
              "min-w-0 truncate font-normal",
              (isActiveTail || (integration && isRunning)) &&
                "agent-running-shimmer",
            )}
          >
            {displayName}
          </span>
        }
        meta={
          <>
            {rowContext ? (
              <AgentActivityObject
                object={{
                  kind: rowContext.kind,
                  label: rowContext.text,
                  mono: rowContext.mono,
                }}
                className="agent-kit-activity-object-boundary ms-auto shrink"
              />
            ) : null}
            {repeatCount && repeatCount > 1 ? (
              <span
                className="agent-kit-micro-copy shrink-0 rounded border border-border/60 px-1.5 py-0.5 leading-none text-muted-foreground"
                title={t("agentChat.tool.repeated", { count: repeatCount })}
              >
                {repeatCount}x
              </span>
            ) : null}
            {integration && isUnknownOutcome ? (
              <IconAlertTriangle
                aria-hidden="true"
                className="agentkit-icon text-[hsl(var(--agent-kit-warning))]"
              />
            ) : null}
          </>
        }
      />
      <AnimatedCollapse
        id={contentId}
        open={
          isExpanded &&
          !isAgentCall &&
          (hasArgs || result !== undefined || isError)
        }
      >
        <div className={cn("mt-1 space-y-2", !embeddedInWorkSummary && "ps-6")}>
          {inputPayload && (
            <SimpleCodeViewer
              text={inputPayload.text}
              lang={inputPayload.lang}
            />
          )}
          {isError ? (
            <div
              {...SESSION_REPLAY_MASK_PROPS}
              className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/70 px-2.5 py-1 text-xs text-muted-foreground"
            >
              {result || t("agentChat.tool.failedWithoutDetails")}
            </div>
          ) : resultPayload ? (
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
          ) : null}
        </div>
      </AnimatedCollapse>
      {isUnknownOutcome && (
        <p
          role="status"
          className={cn(
            "text-xs text-muted-foreground",
            !embeddedInWorkSummary && "ps-6",
          )}
        >
          {t("agentChat.tool.interrupted")}
        </p>
      )}
      {approval && (
        <ApprovalAffordance
          key={approval.askId ?? approval.approvalKey}
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
  toolCallId,
  activity,
  progress,
  responseText,
  isRunning,
  isError,
  errorText,
  durationMs,
  workedForRowLayout,
  formatWorkedForDuration,
}: {
  agentName: string;
  toolCallId?: string;
  activity?: A2AAgentActivitySnapshot;
  progress?: AgentCallProgress;
  responseText: string;
  isRunning: boolean;
  isError: boolean;
  errorText?: string;
  durationMs?: number;
  workedForRowLayout?: AgentChatWorkedForRowLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
}) {
  const t = useT();
  const formatDuration = useLocalizedWorkedDuration();
  const [open, setOpen] = useState(!isError);
  const contentId = useId();
  useLayoutEffect(() => {
    if (isError) setOpen(false);
  }, [isError]);
  const responseKey = toolCallId ?? agentName;
  const activeReasoning = isRunning ? (activity?.reasoning ?? []) : [];
  const toolCount = activity?.toolCalls?.length ?? 0;
  const segments = activity?.response ?? [];
  const inlineSegments = isError
    ? []
    : responseText && !isRunning
      ? segments.slice(0, toolCount)
      : segments;
  const finalText = isError
    ? ""
    : responseText || (inlineSegments.length ? "" : activity?.responseText);
  const workItemCount = Math.max(
    activeReasoning.length,
    toolCount,
    inlineSegments.length,
  );
  const label = isError
    ? t("agentChat.tool.askingAgentFailed", { agent: agentName })
    : isRunning
      ? t("agentChat.tool.askingAgent", { agent: agentName })
      : t("agentChat.tool.askedAgent", { agent: agentName });
  const workItems: ToolActivityListItem[] = [];
  for (let index = 0; index < workItemCount; index++) {
    const reasoningText = activeReasoning[index];
    const segment = inlineSegments[index];
    const tool = activity?.toolCalls.at(index);
    if (reasoningText) {
      workItems.push({
        key: `reasoning-${index}`,
        node: (
          <ReasoningCell
            text={reasoningText}
            isStreaming={
              isRunning &&
              activity?.activePhase === "reasoning" &&
              index === activeReasoning.length - 1
            }
            defaultOpen={index === activeReasoning.length - 1}
            collapseWhenReplaced={index < toolCount}
          />
        ),
      });
    }
    if (segment) {
      workItems.push({
        key: `segment-${index}`,
        node: (
          <div className="pb-1">
            <SmoothMarkdownText
              text={segment}
              streaming={
                isRunning &&
                activity?.activePhase === "responding" &&
                index === inlineSegments.length - 1
              }
              resetKey={`agent-response-${responseKey}-${index}`}
              statusType={isRunning ? "running" : "complete"}
            />
          </div>
        ),
      });
    }
    if (tool) {
      workItems.push({
        key: `tool-${index}`,
        node: (
          <AgentActivityToolCallRow
            tool={tool}
            isActiveTail={
              isRunning && tool.status === "running" && index === toolCount - 1
            }
          />
        ),
      });
    }
  }
  // A running call keeps every row so the live tail stays in view.
  const workContent = workItems.length ? (
    <ToolActivityList items={workItems} collapse={!isRunning} />
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
      <AgentKitDisclosureSummary
        className="agent-kit-density text-muted-foreground"
        open={open}
        onToggle={() => setOpen((value) => !value)}
        controls={open ? contentId : undefined}
        icon={
          isRunning ? (
            <CubeLoader aria-hidden="true" className="size-4" />
          ) : isError ? (
            <IconAlertTriangle
              aria-hidden="true"
              className="agentkit-icon text-[hsl(var(--agent-kit-warning))]"
            />
          ) : (
            <IconArrowFork aria-hidden="true" className="agentkit-icon" />
          )
        }
        label={
          <span
            className={cn(
              "min-w-0 truncate font-normal",
              isRunning && "agent-running-shimmer",
            )}
          >
            {label}
          </span>
        }
      />
      <AnimatedCollapse id={contentId} open={open}>
        <div className="pt-1">
          {workContent &&
            (isRunning ? (
              workContent
            ) : (
              <WorkedForSummary
                durationMs={durationMs}
                layout={workedForRowLayout}
                formatWorkedForDuration={formatWorkedForDuration}
              >
                {workContent}
              </WorkedForSummary>
            ))}
          {progressText && (
            <p
              className="pb-1 text-xs text-muted-foreground"
              data-testid="agent-call-progress"
              aria-live="polite"
            >
              {progressText}
            </p>
          )}
          {finalText && (
            <div className="pb-1">
              <SmoothMarkdownText
                text={finalText}
                streaming={isRunning}
                resetKey={`agent-response-${responseKey}`}
                statusType={isRunning ? "running" : "complete"}
              />
            </div>
          )}
          {isError && errorText ? (
            <div
              {...SESSION_REPLAY_MASK_PROPS}
              className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/70 px-2.5 py-1 text-xs text-muted-foreground"
            >
              {errorText}
            </div>
          ) : null}
        </div>
      </AnimatedCollapse>
    </div>
  );
}

const TOOL_ACTIVITY_LIST_PREVIEW_COUNT = 8;

type ToolActivityListItem = { key: string; node: React.ReactNode };

function ToolActivityList({
  items,
  collapse,
}: {
  items: ToolActivityListItem[];
  collapse: boolean;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const revealFocusRef = useRef(false);
  const hiddenCount =
    collapse && !expanded
      ? Math.max(0, items.length - TOOL_ACTIVITY_LIST_PREVIEW_COUNT)
      : 0;
  const visible = hiddenCount
    ? items.slice(0, TOOL_ACTIVITY_LIST_PREVIEW_COUNT)
    : items;
  useEffect(() => {
    if (!expanded || !revealFocusRef.current) return;
    revealFocusRef.current = false;
    // The Show more row unmounts on click, so focus moves to the first row
    // it revealed instead of dropping to the document.
    const row = listRef.current?.children[TOOL_ACTIVITY_LIST_PREVIEW_COUNT];
    if (!(row instanceof HTMLElement)) return;
    const target = row.querySelector<HTMLElement>(
      "button:not([tabindex='-1']), a[href], [tabindex]:not([tabindex='-1'])",
    );
    if (target) {
      target.focus();
      return;
    }
    row.tabIndex = -1;
    row.focus();
  }, [expanded]);
  return (
    <ol ref={listRef} role="list" className="m-0 list-none space-y-1 p-0">
      {visible.map((item) => (
        <li key={item.key}>{item.node}</li>
      ))}
      {hiddenCount ? (
        <li>
          <button
            type="button"
            className="agentkit-disclosure-summary agent-kit-density text-muted-foreground"
            onClick={() => {
              revealFocusRef.current = true;
              setExpanded(true);
            }}
          >
            <span
              className="agentkit-disclosure-icon-slot"
              aria-hidden="true"
            />
            <span className="agentkit-disclosure-label">
              {t("agentChat.activity.showMore", { count: hiddenCount })}
            </span>
          </button>
        </li>
      ) : null}
    </ol>
  );
}

function AgentActivityToolCallRow({
  tool,
  isActiveTail,
}: {
  tool: A2AAgentActivityToolCall;
  isActiveTail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const isRunning = tool.status === "running";
  const failureDetails =
    tool.status === "failed"
      ? tool.result?.trim()
        ? tool.result
        : t("agentChat.tool.failedWithoutDetails")
      : undefined;
  const integration = resolveToolIntegration(
    tool.name,
    tool.input ? parseJsonText(tool.input) : undefined,
  );
  const ToolIcon = resolveToolIcon(tool.name);
  const failed = tool.status === "failed";
  const contentId = useId();

  return (
    <ToolActivityPresentation
      toolName={tool.name}
      isRunning={isRunning}
      toolCallId={tool.id}
      suppressLongRunningHint
    >
      <div className="my-0.5">
        <AgentKitDisclosureSummary
          className="agent-kit-density text-muted-foreground"
          open={open}
          onToggle={() => setOpen((value) => !value)}
          expandable={failed}
          as={failed ? "button" : "static"}
          controls={open ? contentId : undefined}
          icon={
            integration ? (
              <IntegrationToolBadge integration={integration} />
            ) : isRunning ? (
              <CubeLoader aria-hidden="true" className="size-4" />
            ) : failed ? (
              <IconAlertTriangle
                aria-hidden="true"
                className="agentkit-icon text-[hsl(var(--agent-kit-warning))]"
              />
            ) : (
              <ToolIcon aria-hidden="true" className="agentkit-icon" />
            )
          }
          label={
            <span
              className={cn(
                "min-w-0 truncate font-normal",
                isActiveTail && "agent-running-shimmer",
              )}
            >
              {toolLabel(t, tool.name)}
            </span>
          }
        />
        {failed ? (
          <AnimatedCollapse id={contentId} open={open}>
            <div
              {...SESSION_REPLAY_MASK_PROPS}
              className="ms-6 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/70 px-2.5 py-1 text-xs text-muted-foreground"
            >
              {failureDetails}
            </div>
          </AnimatedCollapse>
        ) : null}
      </div>
    </ToolActivityPresentation>
  );
}

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
  approval?: {
    approvalKey: string;
    dismissed?: boolean;
    askId?: string;
    allowPersistentApproval?: false;
  };
  repeatCount?: number;
  isLatestRunning?: boolean;
  isActiveTail?: boolean;
}) {
  const chatRunning = React.useContext(ChatRunningContext);
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
      isError={rest.isError}
      outcome={rest.outcome}
      isActiveTail={rest.isActiveTail}
      isLatestRunning={rest.isLatestRunning}
      approval={rest.approval}
      repeatCount={rest.repeatCount}
    />
  );
}

export function ReconnectStreamMessage({
  content,
  allowActivitySpinner = true,
}: {
  content: ContentPart[];
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
      !part.isError &&
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
        isError={part.isError}
        mcpApp={part.mcpApp}
        chatUI={part.chatUI}
        structuredMeta={part.structuredMeta}
        activity={part.activity}
        outcome={part.outcome}
        isRunning={
          !part.isError &&
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
      <div className="agent-kit-tool-content-boundary w-full text-sm leading-relaxed text-foreground">
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

export function ReasoningCell({
  text,
  isStreaming = false,
  defaultOpen,
  autoCollapse = false,
  collapseWhenReplaced = false,
  durationMs,
  inline = false,
}: {
  text: string;
  isStreaming?: boolean;
  resetKey?: string;
  defaultOpen?: boolean;
  autoCollapse?: boolean;
  collapseWhenReplaced?: boolean;
  durationMs?: number | null;
  /** Inside a work step, whose title is already the disclosure. */
  inline?: boolean;
}) {
  const t = useT();
  const formatDuration = useLocalizedWorkedDuration();
  const display = useThinkingDisplay();
  const embeddedInWorkSummary = React.useContext(WorkSummaryContentContext);
  const startOpen = display === "expanded" ? (defaultOpen ?? true) : false;
  const [open, setOpen] = useState(startOpen);
  const contentId = useId();
  const wasStreamingRef = useRef(isStreaming);
  const wasReplacedRef = useRef(collapseWhenReplaced);
  const previousDisplayRef = useRef(display);
  const trimmed = text.trim();

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

  useEffect(() => {
    if (previousDisplayRef.current === display) return;
    previousDisplayRef.current = display;
    setOpen(startOpen);
  }, [display, startOpen]);

  if (display === "hidden") return null;
  if (!trimmed && !isStreaming) return null;
  if (inline) {
    return trimmed ? (
      <div className="agent-reasoning-markdown agent-kit-density leading-relaxed text-muted-foreground">
        <SmoothMarkdownText
          text={trimmed}
          streaming={isStreaming}
          animateStreaming={false}
          resetKey="reasoning"
          statusType={isStreaming ? "running" : "complete"}
        />
      </div>
    ) : null;
  }

  const label = isStreaming
    ? t("agentChat.status.thinking")
    : durationMs != null
      ? t("agentChat.tool.thoughtFor", {
          duration: formatDuration(durationMs),
        })
      : t("agentChat.tool.thought");
  const showTail = isStreaming && open;

  return (
    <div className={cn("w-full", embeddedInWorkSummary ? "my-0" : "my-0.5")}>
      <AgentKitDisclosureSummary
        className="agent-kit-density text-muted-foreground"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        controls={open ? contentId : undefined}
        icon={<IconBrain aria-hidden="true" className="agentkit-icon" />}
        label={
          isStreaming ? (
            <span className="agent-thinking-indicator__text">{label}</span>
          ) : (
            <span>{label}</span>
          )
        }
      />
      <AnimatedCollapse id={contentId} open={open}>
        <div
          className={cn(
            "pb-1",
            !embeddedInWorkSummary && "ps-6",
            showTail && "reasoning-cell-tail",
          )}
        >
          {trimmed ? (
            <div className="agent-reasoning-markdown agent-kit-density leading-relaxed text-muted-foreground">
              <SmoothMarkdownText
                text={trimmed}
                streaming={isStreaming}
                animateStreaming={false}
                resetKey="reasoning"
                statusType={isStreaming ? "running" : "complete"}
              />
            </div>
          ) : (
            <div className="agent-kit-density leading-relaxed text-muted-foreground">
              {isStreaming ? "…" : ""}
            </div>
          )}
        </div>
      </AnimatedCollapse>
    </div>
  );
}

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
  isRunning = false,
  defaultOpen = false,
  autoCollapse = false,
  children,
  layout,
  formatWorkedForDuration,
}: {
  durationMs?: number | null;
  isRunning?: boolean;
  defaultOpen?: boolean;
  autoCollapse?: boolean;
  children: React.ReactNode;
  layout?: AgentChatWorkedForRowLayout;
  formatWorkedForDuration?: (durationMs: number) => string;
}) {
  const t = useT();
  const formatDuration = useLocalizedWorkedDuration();
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();

  useEffect(() => {
    if (defaultOpen) {
      setOpen(true);
    } else if (autoCollapse) {
      setOpen(false);
    }
  }, [autoCollapse, defaultOpen]);

  const label = isRunning
    ? t("agentChat.status.working")
    : durationMs != null && durationMs >= 1000
      ? t("agentChat.tool.workedFor", {
          duration: (formatWorkedForDuration ?? formatDuration)(durationMs),
        })
      : t("agentChat.tool.worked");

  return (
    <div className="my-1 w-full">
      <AgentKitDisclosureSummary
        className="agent-kit-density text-muted-foreground"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        controls={open ? contentId : undefined}
        style={workedForRowSummaryStyle(layout)}
        chevronStyle={workedForRowChevronStyle(layout)}
        icon={
          isRunning ? (
            <CubeLoader aria-hidden="true" className="size-4" />
          ) : (
            <IconClock aria-hidden="true" className="agentkit-icon" />
          )
        }
        label={
          <span className={cn(isRunning && "agent-running-shimmer")}>
            {label}
          </span>
        }
      />
      <AnimatedCollapse id={contentId} open={open}>
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
  const contentId = useId();
  const label = t("agentChat.tool.ranTools", { count: toolCount });

  return (
    <div
      className="agent-tool-summary my-1 w-full"
      data-agent-tool-summary={motionKey}
    >
      <AgentKitDisclosureSummary
        className="agent-kit-density text-muted-foreground"
        open={open}
        onToggle={() => setOpen((v) => !v)}
        controls={open ? contentId : undefined}
        icon={<IconTool aria-hidden="true" className="agentkit-icon" />}
        label={<span className="agent-tool-summary__label">{label}</span>}
      />
      <AnimatedCollapse id={contentId} open={open}>
        <div className="pt-1">{children}</div>
      </AnimatedCollapse>
    </div>
  );
}

export { FilesChangedSummary };
