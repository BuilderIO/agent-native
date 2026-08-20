import {
  AssistantChat,
  ChatHistoryList,
  buildRepositoryFromCodeAgentTranscript,
  codeAgentTranscriptHasPendingApproval,
  closeChatFirstSessionWatch,
  createCodeAgentChatAdapter,
  emitChatFirstSessionWatch,
  isCodeAgentRunActive,
  isCredentialGapCodeAgentEvent,
  mergeCodeAgentTranscriptEvents,
  useChatFirstSessionWatch,
  type ChatFirstSurfaceKind,
  type ChatHistoryItem,
  type CodeAgentChatController,
} from "@agent-native/core/client/agent-chat";
import {
  ChatFirstChatHistory,
  ChatFirstPrimaryNavigation,
  type ChatFirstOpenAppDetail,
  type ChatFirstPrimaryTab,
} from "@agent-native/core/client/chat-first";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import {
  PromptComposer,
  isClaudeCodeAgentId,
  isLunaModel,
  readAgentPromptAttachment,
  resolvePreferredAgentModel,
  type ComposerTerminalModeControl,
  type PromptComposerFile,
  type SlashCommand,
  type TiptapComposerHandle,
} from "@agent-native/core/client/composer";
import { usePollLoop } from "@agent-native/core/client/hooks";
import { createPollEngine } from "@agent-native/core/shared";
import type { AppConfig } from "@agent-native/shared-app-config";
import {
  IconAlertCircle,
  IconBan,
  IconBrandOpenai,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCode,
  IconBrandChrome,
  IconCloud,
  IconCopy,
  IconDeviceMobile,
  IconDeviceDesktop,
  IconDots,
  IconEye,
  IconFolder,
  IconFolderPlus,
  IconGitBranch,
  IconGitFork,
  IconKey,
  IconLink,
  IconLockAccess,
  IconPlayerPlay,
  IconPlayerStop,
  IconQrcode,
  IconRefresh,
  IconRestore,
  IconRoute,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconScreenShare,
  IconTerminal2,
} from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { toast } from "sonner";

const SCHEDULED_CHAT_PROMPT_EVENT = "agent-native:scheduled-chat-prompt";

import {
  CODE_AGENT_GOALS,
  DEFAULT_CODE_AGENT_PERMISSION_MODE,
  getCodeAgentAppConfig,
  getCodeAgentGoal,
  getCodeAgentPermissionMode,
  getDefaultCodeAgentGoal,
  type CodeAgentGoalDefinition,
  type CodeAgentGoalId,
  type CodeAgentPermissionMode,
} from "./code-agents.js";
import {
  getChatFirstNumericAppShortcut,
  resolveChatFirstKeyboardNavigationTarget,
  type ChatFirstKeyboardNavigation,
  type ChatFirstKeyboardShortcut,
} from "./keyboard-navigation.js";
import { RemoteWaitlistPopover } from "./RemoteWaitlistPopover.js";
import { SessionWatchPanel } from "./SessionWatchPanel.js";
import type {
  CodeAgentCodePack,
  CodeAgentCodePackResult,
  CodeAgentControlCommand,
  CodeAgentControlResult,
  CodeAgentCreateRunRequest,
  CodeAgentCreateRunResult,
  CodeAgentExecutionTarget,
  CodeAgentForkRunRequest,
  CodeAgentForkRunResult,
  CodeAgentWorktreeSelection,
  CodeAgentFollowUpMode,
  CodeAgentFollowUpRequest,
  CodeAgentFollowUpResult,
  CodeAgentMigrationRun,
  CodeAgentModelListResult,
  CodeAgentModelOption,
  CodeAgentModelSelection,
  CodeAgentPortalTransferAllRequest,
  CodeAgentPortalTransferAllResult,
  CodeAgentPortalTransferRequest,
  CodeAgentPortalTransferResult,
  CodeAgentProviderConnectResult,
  CodeAgentPromptAttachment,
  CodeAgentProjectFolder,
  CodeAgentProjectListResult,
  CodeAgentProjectSelectResult,
  CodeAgentReasoningEffort,
  CodeAgentRemoteConnectorControlResult,
  CodeAgentRemoteConnectorPairRequest,
  CodeAgentRemoteConnectorPairResult,
  CodeAgentRemoteConnectorStatus,
  CodeAgentRemoteWaitlistRequest,
  CodeAgentRemoteWaitlistResult,
  CodeAgentRerunRequest,
  CodeAgentRerunResult,
  CodeAgentRetryRunRequest,
  CodeAgentRetryRunResult,
  CodeAgentRun,
  CodeAgentRunDetail,
  CodeAgentRunListResult,
  CodeAgentScheduleListResult,
  CodeAgentScheduleResult,
  CodeAgentRestoreWorktreeRequest,
  CodeAgentRestoreWorktreeResult,
  CodeAgentTerminalRequest,
  CodeAgentTerminalResult,
  CodeAgentTranscriptEvent,
  CodeAgentTranscriptRequest,
  CodeAgentTranscriptResult,
  CodeAgentTranscriptSubscriptionBatch,
  CodeAgentUpdateRunRequest,
  CodeAgentUpdateRunResult,
  CodeAgentWorktreeListResult,
  CodeAgentWorktreeSummary,
  CodeAgentsOpenRequest,
} from "./types.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select.js";

export interface CodeAgentsHost {
  listRuns: (goalId?: string) => Promise<CodeAgentRunListResult>;
  listSchedules?: () => Promise<CodeAgentScheduleListResult>;
  createSchedule?: (input: unknown) => Promise<CodeAgentScheduleResult>;
  updateSchedule?: (input: unknown) => Promise<CodeAgentScheduleResult>;
  deleteSchedule?: (input: unknown) => Promise<CodeAgentScheduleResult>;
  runScheduleNow?: (input: unknown) => Promise<CodeAgentScheduleResult>;
  listModels?: () => Promise<CodeAgentModelListResult>;
  getHostMetadata?: () => Promise<CodeAgentHostMetadata>;
  runComputerSetupAction?: (
    action: CodeAgentComputerSetupAction,
  ) => Promise<CodeAgentComputerSetupResult>;
  listCodePacks?: (cwd?: string) => Promise<CodeAgentCodePackResult>;
  listProjects?: () => Promise<CodeAgentProjectListResult>;
  selectProject?: (cwd: string) => Promise<CodeAgentProjectSelectResult>;
  chooseProject?: () => Promise<CodeAgentProjectSelectResult>;
  createRun: (
    request: CodeAgentCreateRunRequest,
  ) => Promise<CodeAgentCreateRunResult>;
  listWorktrees?: (cwd?: string) => Promise<CodeAgentWorktreeListResult>;
  forkRun?: (
    request: CodeAgentForkRunRequest,
  ) => Promise<CodeAgentForkRunResult>;
  restoreWorktree?: (
    request: CodeAgentRestoreWorktreeRequest,
  ) => Promise<CodeAgentRestoreWorktreeResult>;
  submitRemoteWaitlist?: (
    request: CodeAgentRemoteWaitlistRequest,
  ) => Promise<CodeAgentRemoteWaitlistResult>;
  readTranscript: (
    request: CodeAgentTranscriptRequest,
  ) => Promise<CodeAgentTranscriptResult>;
  subscribeTranscript?: (
    request: CodeAgentTranscriptRequest,
    callback: (batch: CodeAgentTranscriptSubscriptionBatch) => void,
  ) => () => void;
  appendFollowUp: (
    request: CodeAgentFollowUpRequest,
  ) => Promise<CodeAgentFollowUpResult>;
  transferRun?: (
    request: CodeAgentPortalTransferRequest,
  ) => Promise<CodeAgentPortalTransferResult>;
  transferAll?: (
    request?: CodeAgentPortalTransferAllRequest,
  ) => Promise<CodeAgentPortalTransferAllResult>;
  updateRun: (
    request: CodeAgentUpdateRunRequest,
  ) => Promise<CodeAgentUpdateRunResult>;
  retryRun?: (
    request: CodeAgentRetryRunRequest,
  ) => Promise<CodeAgentRetryRunResult>;
  rerunRun?: (request: CodeAgentRerunRequest) => Promise<CodeAgentRerunResult>;
  controlRun: (
    goalId: string,
    runId: string,
    command: CodeAgentControlCommand,
    permissionMode?: CodeAgentPermissionMode,
  ) => Promise<CodeAgentControlResult>;
  openTerminal?: (
    request?: CodeAgentTerminalRequest,
  ) => Promise<CodeAgentTerminalResult>;
  openCodexLogin?: () => Promise<CodeAgentTerminalResult>;
  openClaudeLogin?: () => Promise<CodeAgentTerminalResult>;
  getRemoteConnectorStatus?: () => Promise<CodeAgentRemoteConnectorStatus>;
  setRemoteConnectorEnabled?: (
    enabled: boolean,
  ) => Promise<CodeAgentRemoteConnectorControlResult>;
  pairRemoteConnector?: (
    request?: CodeAgentRemoteConnectorPairRequest,
  ) => Promise<CodeAgentRemoteConnectorPairResult>;
  connectBuilderProvider?: () => Promise<CodeAgentProviderConnectResult>;
}

export type CodeAgentsRenderAppSurface = (input: {
  goal: CodeAgentGoalDefinition;
  app: AppConfig;
  urlParams?: Record<string, string>;
  refreshKey: number;
}) => React.ReactNode;

export interface CodeAgentsNewSessionExtensionSubmitInput {
  prompt: string;
  cwd?: string;
  attachments: CodeAgentPromptAttachment[];
}

export interface CodeAgentsNewSessionExtensionSubmitResult {
  ok: boolean;
  message?: string;
  error?: string;
  detailId?: string;
}

export interface CodeAgentsNewSessionExtensionModeControlInput {
  permissionMode: CodeAgentPermissionMode;
  onPermissionModeChange: (mode: CodeAgentPermissionMode) => void;
}

export interface CodeAgentsNewSessionExtension {
  /** The extension always owns the new-session selector; active routes submits and detail. */
  active: boolean;
  disabled?: boolean;
  /** Rendered in place of the standard Plan/Auto picker. */
  renderModeControl?(
    input: CodeAgentsNewSessionExtensionModeControlInput,
  ): React.ReactNode | undefined;
  /** Opt in only when the extension needs the standard model picker. */
  showModelSelector?: boolean;
  submit(
    input: CodeAgentsNewSessionExtensionSubmitInput,
  ): Promise<CodeAgentsNewSessionExtensionSubmitResult>;
  renderDetail?(input: {
    detailId: string;
    onClose: () => void;
  }): React.ReactNode;
}

export function resolveNewSessionExtensionComposerState(
  extension?: CodeAgentsNewSessionExtension,
): {
  active: boolean;
  useDefaultModeControl: boolean;
  showModelSelector: boolean;
} {
  const active = extension?.active === true;
  return {
    active,
    useDefaultModeControl: !extension,
    showModelSelector: active ? extension.showModelSelector === true : true,
  };
}

export function shouldCloseWatchedChatFirstSession(input: {
  runsLoaded: boolean;
  targetSessionId: string | null;
  targetKind: string | null;
  watchedRunPresent: boolean;
}): boolean {
  if (!input.runsLoaded || !input.targetSessionId) return false;
  if (input.targetKind === "agent-chat" || input.targetKind === "external") {
    return false;
  }
  return !input.watchedRunPresent;
}

export interface CodeAgentsAppProps {
  apps: AppConfig[];
  host: CodeAgentsHost;
  /** Whether the host surface is currently visible to the user. */
  isActive?: boolean;
  openRequest?: CodeAgentsOpenRequest;
  refreshKey?: number;
  brandIconUrl?: string;
  onOpenSettings?: (tab?: string) => void;
  /** Compact actions rendered above the primary surface. */
  mainToolbarSlot?: ReactNode;
  /** App shortcuts rendered between navigation and the chat history. */
  railWorkspaceSlot?: ReactNode;
  /** Optional actions pinned to the bottom of the rail. */
  railFooterSlot?: ReactNode;
  /** Optional window controls mounted in the rail's title-bar area. */
  railWindowControlsSlot?: ReactNode;
  /** Optional content shown below the empty new-chat composer. */
  overviewFooterSlot?: ReactNode;
  renderAppSurface?: CodeAgentsRenderAppSurface;
  newSessionExtension?: CodeAgentsNewSessionExtension;
  openDetailRequest?: { detailId: string; nonce: number };
  /** Active chat-first side surface; watch is rendered only when selected. */
  activeChatFirstSurfaceKind?: ChatFirstSurfaceKind;
  /** Selected primary chat kind in the chat-first shell. */
  chatFirstMainKind?: "agent" | "code";
  /** Keep the chat-first navigation rail in its compact icon-only state. */
  railCollapsed?: boolean;
  /** Hide host transport-unavailable copy while the chat-first shell is booting. */
  suppressChatFirstUnavailableNotice?: boolean;
  /** Select the primary chat kind in the chat-first shell. */
  onChatFirstMainKindChange?: (kind: "agent" | "code") => void;
  /** Host-rendered shared Agent-Native chat surface for the agent chat tab. */
  renderChatFirstMainSurface?: ReactNode;
  /** Host-rendered replacement for the chat stream and composer region. */
  renderChatFirstChatSurface?: ReactNode;
  /** Local terminal mode replaces the new-chat run with a PTY prompt. */
  terminalMode?: {
    agentId: string;
    agentLabel: string;
    onSubmit: (
      prompt: string,
      attachments: CodeAgentPromptAttachment[],
    ) => void | Promise<void>;
  };
  /** Controls terminal mode from the new-chat composer plus menu. */
  terminalModeControl?: ComposerTerminalModeControl;
  /** Navigation callbacks for the shared chat-first rail. */
  chatFirstNavigation?: {
    activeTab?: ChatFirstPrimaryTab;
    onNewChat?: () => void;
    onOpenChats?: () => void;
    onOpenAllApps?: () => void;
    onOpenIntegrations: () => void;
    onOpenScheduled: () => void;
  };
  /** Desktop-native shortcuts for app and chat navigation. */
  keyboardNavigation?: ChatFirstKeyboardNavigation;
  /** Route first-party MCP open_app results through the shared app pane. */
  onChatFirstOpenApp?: (detail: ChatFirstOpenAppDetail) => void;
  /** Lets a host place the shared watch renderer in its side-surface slot. */
  onWatchedRunChange?: (
    run: CodeAgentRun | null,
    sourceRunId?: string | null,
  ) => void;
  /** Exposes the already-loaded run list to a host-owned side surface. */
  onRunsChange?: (runs: CodeAgentRun[]) => void;
  /** Exposes the selected primary chat to a host-owned surface controller. */
  onSelectedRunChange?: (runId: string | null) => void;
}

interface CodeAgentTerminalAgentOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    console.warn("[code-agents] Could not parse transcript metadata as JSON.");
    return null;
  }
}

function stringFromRecord(
  record: Record<string, unknown>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function chatFirstOpenAppDetailFromTranscriptEvent(
  event: CodeAgentTranscriptEvent,
  registeredServerIds: Set<string>,
): ChatFirstOpenAppDetail | null {
  if (event.type !== "status" || event.metadata?.type !== "tool_done") {
    return null;
  }
  const tool = stringFromRecord(event.metadata, "tool");
  if (!tool) return null;
  if (tool !== "open_app") {
    const serverMatch = /^mcp__(.+)__open_app$/.exec(tool);
    if (!serverMatch || !registeredServerIds.has(serverMatch[1]!)) return null;
  }

  let result = recordFromUnknown(event.metadata.result);
  if (result?.__agentNativeMcpToolResult === true) {
    result =
      recordFromUnknown(result.text) ?? recordFromUnknown(result.raw) ?? null;
  }
  if (!result) return null;
  const detail: ChatFirstOpenAppDetail = {
    app: stringFromRecord(result, "app", "appId", "application"),
    path: stringFromRecord(result, "path", "targetPath"),
    url: stringFromRecord(result, "url", "href"),
    view: stringFromRecord(result, "view"),
  };
  return detail.app || detail.path || detail.url || detail.view ? detail : null;
}

type RunListStatus = CodeAgentRunListResult["status"];
type CodeAgentRunMode = "plan" | "auto";

interface CodeAgentSearchResult {
  run: CodeAgentRun;
  match: string;
  matchType: "Recent" | "Chat" | "Transcript";
  rank: number;
}

interface CodeAgentHostMetadata {
  status: "ok" | "unavailable";
  llmProvider?: {
    configured: boolean;
    label?: string;
    configuredProviders?: string[];
    missingEnvVars?: string[];
  };
  computerControl?: {
    available: boolean;
    desktop: { accessibility: boolean; screenRecording: string };
    browser: {
      nativeHostInstalled: boolean;
      extensionBundled: boolean;
      connected: boolean;
    };
  };
  error?: string;
}

export type CodeAgentComputerSetupAction =
  | "request-accessibility"
  | "request-screen-recording"
  | "open-accessibility-settings"
  | "open-screen-recording-settings"
  | "open-chrome-setup"
  | "restart";

export interface CodeAgentComputerSetupResult {
  ok: boolean;
  action: CodeAgentComputerSetupAction;
  message: string;
  restartRecommended?: boolean;
  error?: string;
}

const CODE_AGENT_RUN_MODES: Array<{
  id: CodeAgentRunMode;
  label: string;
  description: string;
}> = [
  {
    id: "plan",
    label: "Plan",
    description:
      "Inspect the workspace and connected apps, then propose a plan without taking actions.",
  },
  {
    id: "auto",
    label: "Auto",
    description:
      "Edit, run checks, and operate connected apps; pause for destructive or sensitive actions.",
  },
];

const CODE_AGENT_REASONING_EFFORTS: Array<{
  id: CodeAgentReasoningEffort;
  label: string;
}> = [
  { id: "auto", label: "Auto" },
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
  { id: "xhigh", label: "Extra High" },
  { id: "max", label: "Max" },
];

const DEFAULT_CODE_AGENT_MODEL_OPTIONS: CodeAgentModelOption[] = [
  {
    engine: "ai-sdk:openai",
    engineLabel: "OpenAI",
    model: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Model list is loading.",
    configured: false,
  },
];

const CODE_AGENT_LOCAL_ENGINES = new Set([
  "codex-cli",
  "claude-cli",
  "pi-cli",
  "opencode-cli",
]);

type LocalRuntimeEngine = "codex-cli" | "claude-cli";

function getLocalRuntimeOptions(
  modelOptions: CodeAgentModelOption[],
): Array<{ engine: LocalRuntimeEngine; label: string }> {
  const availableEngines = new Set(
    modelOptions
      .map((option) => option.engine)
      .filter(
        (engine): engine is LocalRuntimeEngine =>
          engine === "codex-cli" || engine === "claude-cli",
      ),
  );
  return (["codex-cli", "claude-cli"] as const)
    .filter((engine) => availableEngines.has(engine))
    .map((engine) => ({
      engine,
      label:
        engine === "codex-cli" ? "Sign in with ChatGPT" : "Sign in with Claude",
    }));
}

const CODE_AGENT_RUNTIME_OPTIONS = [
  {
    id: "default",
    label: "Default",
    description: "Agent Native hosted chat",
  },
  {
    id: "codex",
    label: "Codex",
    description: "Run locally with Codex CLI",
    engine: "codex-cli",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Run locally with Claude Code",
    engine: "claude-cli",
  },
  {
    id: "pi",
    label: "Pi",
    description: "Run locally with Pi",
    engine: "pi-cli",
  },
  {
    id: "opencode",
    label: "OpenCode",
    description: "Run locally with OpenCode",
    engine: "opencode-cli",
  },
] as const;

const CODE_AGENT_MODEL_SELECTION_KEY = "agent-native-code:model-selection";
const CODE_AGENT_UNREAD_RUN_IDS_KEY = "agent-native-code:unread-run-ids";
const CODE_AGENT_PINNED_AT_METADATA_KEY = "pinnedAt";
const DEFAULT_REMOTE_RELAY_URL = "https://dispatch.agent-native.com";
const HOST_CALL_TIMEOUT_MIN_MS = 10_000;

type RailItemCacheEntry = {
  title: string | null;
  pinned: boolean;
  timestampKey: string;
  item: ChatHistoryItem;
};

function getHostCallTimeoutMs(pollIntervalMs: number): number {
  return Math.max(HOST_CALL_TIMEOUT_MIN_MS, pollIntervalMs * 4);
}

/**
 * Bounds a host RPC call so a hung host process can't pin a poll's in-flight
 * guard forever. The host call itself keeps running in the background if it
 * loses the race, but nothing is listening to it anymore, so a late
 * resolution cannot clobber state set by a newer poll cycle.
 */
function withHostCallTimeout<T>(
  call: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Host call timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
}

function appUrlForRemotePairing(app: AppConfig): string {
  if ((app.mode ?? "prod") === "dev") {
    return app.devUrl || (app.devPort ? `http://localhost:${app.devPort}` : "");
  }
  return app.url || app.devUrl || "";
}

function defaultRemoteRelayUrl(apps: AppConfig[]): string {
  const app =
    apps.find((item) => item.id === "dispatch" && Boolean(item.url)) ??
    apps.find((item) => Boolean(item.url)) ??
    apps.find((item) => Boolean(item.devUrl || item.devPort));
  const relayUrl = app ? appUrlForRemotePairing(app) : "";
  return relayUrl || DEFAULT_REMOTE_RELAY_URL;
}

const codeAgentComposerAreaStyle = {
  alignSelf: "stretch",
  width: "100%",
  inlineSize: "100%",
  maxWidth: "none",
  boxSizing: "border-box",
} satisfies CSSProperties;

const codeAgentComposerRootStyle = {
  width: "100%",
  inlineSize: "100%",
  maxWidth: "none",
  boxSizing: "border-box",
} satisfies CSSProperties;

function CodeAgentsChatHistoryHeaderActions({
  hasUnread,
  onMarkAllRead,
  onTransferAll,
}: {
  hasUnread: boolean;
  onMarkAllRead: () => void;
  onTransferAll?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="code-agents-chat-history__menu-trigger"
          aria-label="Chat list options"
          title="Chat list options"
        >
          <IconDots size={15} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={4}
        className="code-agents-chat-history__menu-content"
      >
        <DropdownMenuItem disabled={!hasUnread} onSelect={onMarkAllRead}>
          <IconCheck size={14} strokeWidth={1.8} aria-hidden="true" />
          <span>Mark all as read</span>
        </DropdownMenuItem>
        {onTransferAll ? (
          <DropdownMenuItem onSelect={onTransferAll}>
            <IconRoute size={14} strokeWidth={1.8} aria-hidden="true" />
            <span>Move local chats to Portal</span>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isPortalCodeAgentRun(run: CodeAgentRun): boolean {
  const metadata = run.metadata;
  return Boolean(
    metadata &&
    (metadata.executionTarget === "portal" ||
      (typeof metadata.portal === "object" && metadata.portal !== null)),
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function firstRecordString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function getCodeAgentWorktreeRecoveryState(
  worktree: Record<string, unknown> | undefined,
): {
  wasPreserved: boolean;
  needsRecovery: boolean;
  needsNotice: boolean;
} {
  const worktreePath = firstRecordString(worktree?.path);
  const worktreeState = firstRecordString(worktree?.state);
  const cleanupError = firstRecordString(worktree?.lastCleanupError);
  // Older run records do not have pathAvailable. Preserve their existing
  // behavior while making current records explicit when cleanup removed the
  // checkout but kept its branch for recovery.
  const pathAvailable = worktree?.pathAvailable !== false;
  const wasPreserved =
    worktreeState === "recoverable" && Boolean(cleanupError) && pathAvailable;
  const needsRecovery = Boolean(
    worktree &&
    worktreePath &&
    (worktreeState === "recoverable" ||
      worktreeState === "removed" ||
      worktreeState === "error") &&
    !wasPreserved,
  );
  return {
    wasPreserved,
    needsRecovery,
    needsNotice: needsRecovery || wasPreserved,
  };
}

export default function CodeAgentsApp({
  apps,
  host,
  isActive = true,
  openRequest,
  refreshKey = 0,
  brandIconUrl,
  onOpenSettings,
  mainToolbarSlot,
  railWorkspaceSlot,
  railFooterSlot,
  railWindowControlsSlot,
  overviewFooterSlot,
  renderAppSurface,
  newSessionExtension,
  openDetailRequest,
  activeChatFirstSurfaceKind,
  chatFirstMainKind = "code",
  railCollapsed = false,
  suppressChatFirstUnavailableNotice = false,
  onChatFirstMainKindChange,
  renderChatFirstMainSurface,
  renderChatFirstChatSurface,
  terminalMode,
  terminalModeControl,
  chatFirstNavigation,
  keyboardNavigation,
  onChatFirstOpenApp,
  onWatchedRunChange,
  onRunsChange,
  onSelectedRunChange,
}: CodeAgentsAppProps) {
  const [selectedGoalId, setSelectedGoalId] = useState<CodeAgentGoalId>("task");
  const selectedGoal =
    getCodeAgentGoal(selectedGoalId) ?? getDefaultCodeAgentGoal();
  const [runs, setRuns] = useState<CodeAgentRun[]>([]);
  const [runsLoaded, setRunsLoaded] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runsRef = useRef(runs);
  runsRef.current = runs;
  const watchedSession = useChatFirstSessionWatch();
  const watchedSessionTarget = watchedSession.target;
  const watchedSessionTargetRef = useRef(watchedSessionTarget);
  watchedSessionTargetRef.current = watchedSessionTarget;
  const watchedSessionTargetSessionId = watchedSessionTarget?.sessionId ?? null;
  const watchedSessionTargetKind = watchedSessionTarget?.kind ?? null;
  const watchedSessionTargetGoalId = watchedSessionTarget?.goalId ?? null;
  const selectedRunIdRef = useRef(selectedRunId);
  selectedRunIdRef.current = selectedRunId;
  const onChatFirstMainKindChangeRef = useRef(onChatFirstMainKindChange);
  onChatFirstMainKindChangeRef.current = onChatFirstMainKindChange;
  const toggleRunPinnedRef = useRef<(run: CodeAgentRun) => Promise<void>>(
    async () => undefined,
  );
  const renameRunRef = useRef<
    (run: CodeAgentRun, newTitle: string) => Promise<void>
  >(async () => undefined);
  const [selectedExtensionDetailId, setSelectedExtensionDetailId] = useState<
    string | null
  >(null);
  const [transcriptEvents, setTranscriptEvents] = useState<
    CodeAgentTranscriptEvent[]
  >([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const transcriptRequestRef = useRef(0);
  const selectRun = useCallback((runId: string | null) => {
    // Do not mount a newly selected chat with the previous run's repository.
    // The transcript fetch completes after this render, and the shared chat
    // runtime correctly rejects a shorter same-length repository as stale.
    setTranscriptEvents([]);
    setTranscriptError(null);
    setSelectedRunId(runId);
  }, []);
  const activeNewSessionExtension =
    !terminalMode && newSessionExtension?.active ? newSessionExtension : null;
  const newSessionExtensionComposerState = terminalMode
    ? { active: false, useDefaultModeControl: false, showModelSelector: true }
    : resolveNewSessionExtensionComposerState(newSessionExtension);
  const terminalAgentOption: CodeAgentTerminalAgentOption | undefined =
    terminalMode
      ? {
          id: terminalMode.agentId,
          label: terminalMode.agentLabel,
          icon: (
            <IconTerminal2 size={14} strokeWidth={1.8} aria-hidden="true" />
          ),
        }
      : undefined;
  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  );
  const watchedRun = useMemo(
    () => runs.find((run) => run.id === watchedSessionTargetSessionId) ?? null,
    [runs, watchedSessionTargetSessionId],
  );

  useEffect(() => {
    if (activeNewSessionExtension) return;
    setSelectedExtensionDetailId(null);
  }, [activeNewSessionExtension]);

  useEffect(() => {
    if (
      !shouldCloseWatchedChatFirstSession({
        runsLoaded,
        targetSessionId: watchedSessionTargetSessionId,
        targetKind: watchedSessionTargetKind,
        watchedRunPresent: watchedRun !== null,
      })
    ) {
      return;
    }
    closeChatFirstSessionWatch();
  }, [
    runsLoaded,
    watchedRun,
    watchedSessionTargetKind,
    watchedSessionTargetSessionId,
  ]);

  useEffect(() => {
    const goal = getCodeAgentGoal(watchedSessionTargetGoalId);
    if (watchedSessionTargetKind !== "code-agent" || !goal) return;
    if (goal.id !== selectedGoalId) setSelectedGoalId(goal.id);
  }, [selectedGoalId, watchedSessionTargetGoalId, watchedSessionTargetKind]);

  useEffect(() => {
    onWatchedRunChange?.(
      watchedRun,
      watchedSessionTarget?.sourceSessionId ?? selectedRunId,
    );
  }, [
    onWatchedRunChange,
    selectedRunId,
    watchedRun,
    watchedSessionTarget?.sourceSessionId,
  ]);

  useEffect(() => {
    onRunsChange?.(runs);
  }, [onRunsChange, runs]);

  useEffect(() => {
    onSelectedRunChange?.(selectedRunId);
  }, [onSelectedRunChange, selectedRunId]);

  useEffect(() => {
    if (!openDetailRequest || !activeNewSessionExtension?.renderDetail) return;
    selectRun(null);
    setSelectedExtensionDetailId(openDetailRequest.detailId);
  }, [activeNewSessionExtension, openDetailRequest, selectRun]);
  const selectedRunUsesAppSurface = selectedRun
    ? isMigrationRun(selectedRun)
    : false;
  const selectedGoalApp = useMemo(
    () =>
      selectedGoal.surfaceKind === "app" && selectedRunUsesAppSurface
        ? getCodeAgentAppConfig(selectedGoal, apps)
        : null,
    [apps, selectedGoal, selectedRunUsesAppSurface],
  );
  const [status, setStatus] = useState<RunListStatus>("unavailable");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workbenchOpen, setWorkbenchOpen] = useState(false);
  const [newPrompt, setNewPrompt] = useState("");
  const [newPromptSeed, setNewPromptSeed] = useState(0);
  const [creatingRun, setCreatingRun] = useState(false);
  const seenChatFirstOpenAppEvents = useRef(new Set<string>());
  const registeredChatFirstMcpServerIds = useMemo(
    () =>
      new Set(
        apps
          .filter((app) => app.enabled !== false)
          .map((app) => `desktop_app_${app.id.replace(/[^A-Za-z0-9_]/g, "_")}`),
      ),
    [apps],
  );
  const [newRunPermissionMode, setNewRunPermissionMode] =
    useState<CodeAgentPermissionMode>(DEFAULT_CODE_AGENT_PERMISSION_MODE);
  const [selectedPermissionMode, setSelectedPermissionMode] =
    useState<CodeAgentPermissionMode>(DEFAULT_CODE_AGENT_PERMISSION_MODE);
  const [modelOptions, setModelOptions] = useState<CodeAgentModelOption[]>(
    DEFAULT_CODE_AGENT_MODEL_OPTIONS,
  );
  const [projects, setProjects] = useState<CodeAgentProjectFolder[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string>("");
  const [newRunExecutionTarget, setNewRunExecutionTarget] =
    useState<CodeAgentExecutionTarget>("local");
  const [newRunWorktreeSelection, setNewRunWorktreeSelection] =
    useState<CodeAgentWorktreeSelection>({ mode: "new" });
  const [namedWorktrees, setNamedWorktrees] = useState<
    CodeAgentWorktreeSummary[]
  >([]);
  const [namedWorktreesLoading, setNamedWorktreesLoading] = useState(false);
  const namedWorktreeRequestRef = useRef(0);
  const [namedWorktreeDialogOpen, setNamedWorktreeDialogOpen] = useState(false);
  const [namedWorktreeName, setNamedWorktreeName] = useState("");
  const [forkSourceRun, setForkSourceRun] = useState<CodeAgentRun | null>(null);
  const [forkBusy, setForkBusy] = useState(false);
  const [restoringWorktreeId, setRestoringWorktreeId] = useState<string | null>(
    null,
  );
  const [loadingProjects, setLoadingProjects] = useState(false);
  const [codePack, setCodePack] = useState<CodeAgentCodePack | null>(null);
  const [modelSelection, setModelSelection] = useState<CodeAgentModelSelection>(
    () => readCodeAgentModelSelection(),
  );
  const [remoteConnectorStatus, setRemoteConnectorStatus] =
    useState<CodeAgentRemoteConnectorStatus | null>(null);
  const [remoteConnectorError, setRemoteConnectorError] = useState<
    string | null
  >(null);
  const [remoteConnectorMessage, setRemoteConnectorMessage] = useState<
    string | null
  >(null);
  const [remoteConnectorPairing, setRemoteConnectorPairing] = useState(false);
  const [remoteConnectorUpdating, setRemoteConnectorUpdating] = useState(false);
  const [portalTransferRequest, setPortalTransferRequest] = useState<
    { kind: "run"; runId: string; title: string } | { kind: "all" } | null
  >(null);
  const [portalTransferBusy, setPortalTransferBusy] = useState(false);
  const [cloudWaitlistOpen, setCloudWaitlistOpen] = useState(false);
  const cloudWaitlistOpeningRef = useRef(false);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRuns, setSearchRuns] = useState<CodeAgentRun[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTranscriptLoading, setSearchTranscriptLoading] = useState(false);
  const [searchTranscriptVersion, setSearchTranscriptVersion] = useState(0);
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [hostMetadata, setHostMetadata] =
    useState<CodeAgentHostMetadata | null>(null);
  const [computerSetupOpen, setComputerSetupOpen] = useState(false);
  const [computerSetupAction, setComputerSetupAction] =
    useState<CodeAgentComputerSetupAction | null>(null);
  const [computerSetupRestartRecommended, setComputerSetupRestartRecommended] =
    useState(false);
  const [accessibilityPrompted, setAccessibilityPrompted] = useState(false);
  const [screenRecordingPrompted, setScreenRecordingPrompted] = useState(false);
  const [builderConnecting, setBuilderConnecting] = useState(false);
  const [builderConnectMessage, setBuilderConnectMessage] = useState<
    string | null
  >(null);
  const selectedModelSelection = useMemo(
    () => normalizeModelSelection(modelSelection, modelOptions),
    [modelOptions, modelSelection],
  );
  const remoteRelayUrl = useMemo(
    () => remoteConnectorStatus?.relayUrl ?? defaultRemoteRelayUrl(apps),
    [apps, remoteConnectorStatus?.relayUrl],
  );
  const newPromptRef = useRef<TiptapComposerHandle | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchTranscriptCacheRef = useRef(
    new Map<string, CodeAgentTranscriptEvent[]>(),
  );
  const [unreadRunIds, setUnreadRunIds] = useState<Set<string>>(() =>
    readStoredUnreadRunIds(),
  );
  const observedRunsByGoalRef = useRef(
    new Map<string, Map<string, CodeAgentRun>>(),
  );
  const railItemCacheRef = useRef(new Map<string, RailItemCacheEntry>());
  const railItems = useMemo<ChatHistoryItem[]>(() => {
    const nextCache = new Map<string, RailItemCacheEntry>();
    const nextItems = sortRunsForRail(runs).map((run) => {
      const title = getRunTitle(run);
      const pinned = isRunPinned(run);
      const active = isRunActive(run);
      const unread = !active && unreadRunIds.has(run.id);
      const scheduled = run.metadata?.hasSchedule === true;
      const timestampKey = active
        ? "active"
        : unread
          ? "unread"
          : scheduled
            ? "scheduled"
            : formatRelativeTime(run.updatedAt);
      const previous = railItemCacheRef.current.get(run.id);
      if (
        previous &&
        previous.title === title &&
        previous.pinned === pinned &&
        previous.timestampKey === timestampKey
      ) {
        nextCache.set(run.id, previous);
        return previous.item;
      }

      const item: ChatHistoryItem = {
        id: run.id,
        title,
        titleText: title ?? undefined,
        pinned,
        timestamp: active ? (
          <span
            className="code-agents-run-status-spinner"
            aria-label="Running"
            title="Running"
          />
        ) : unread ? (
          <span
            className="code-agents-run-status-dot"
            aria-label="Unread chat"
            title="Unread"
          />
        ) : (
          timestampKey
        ),
      };
      const entry = { title, pinned, timestampKey, item };
      nextCache.set(run.id, entry);
      return item;
    });
    railItemCacheRef.current = nextCache;
    return nextItems;
  }, [runs, unreadRunIds]);

  const markRunsUnread = useCallback((runIds: string[]) => {
    const ids = runIds.filter(Boolean);
    if (ids.length === 0) return;
    setUnreadRunIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.add(id);
      if (next.size === current.size) return current;
      writeStoredUnreadRunIds(next);
      return next;
    });
  }, []);

  const markRunsRead = useCallback((runIds: string[]) => {
    const ids = runIds.filter(Boolean);
    if (ids.length === 0) return;
    setUnreadRunIds((current) => {
      const next = new Set(current);
      for (const id of ids) next.delete(id);
      if (next.size === current.size) return current;
      writeStoredUnreadRunIds(next);
      return next;
    });
  }, []);

  const markAllRunsRead = useCallback(() => {
    markRunsRead(runsRef.current.map((run) => run.id));
  }, [markRunsRead]);

  const seedNewPrompt = useCallback((value: string) => {
    setNewPrompt(value);
    setNewPromptSeed((seed) => seed + 1);
    window.requestAnimationFrame(() => {
      newPromptRef.current?.focus();
    });
  }, []);

  const loadRuns = useCallback(
    async (_busy = false) => {
      if (_busy) setRunsLoaded(false);
      try {
        const result = await withHostCallTimeout(
          host.listRuns(selectedGoal.id),
          getHostCallTimeoutMs(2_000),
        );
        setStatus(result.status);
        setError(result.error ?? null);
        if (result.status === "ok") {
          const previousRuns = observedRunsByGoalRef.current.get(
            selectedGoal.id,
          );
          const newlyUnreadRunIds = findRunsThatBecameUnread(
            previousRuns ? [...previousRuns.values()] : undefined,
            result.runs,
            selectedRunIdRef.current,
          );
          markRunsUnread(newlyUnreadRunIds);
          observedRunsByGoalRef.current.set(
            selectedGoal.id,
            new Map(result.runs.map((run) => [run.id, run])),
          );
        }
        setRuns((current) =>
          areCodeAgentRunListsEqual(current, result.runs)
            ? current
            : result.runs,
        );
        if (result.status === "ok") setRunsLoaded(true);
      } catch (err) {
        setStatus("unavailable");
        setError(err instanceof Error ? err.message : String(err));
        setRuns((current) => (current.length === 0 ? current : []));
      } finally {
        setLoading(false);
      }
    },
    [host, markRunsUnread, selectedGoal.id],
  );

  const loadSearchRuns = useCallback(async () => {
    setSearchLoading(true);
    setSearchError(null);
    searchTranscriptCacheRef.current.clear();
    setSearchTranscriptVersion((version) => version + 1);
    try {
      const results = await Promise.all(
        CODE_AGENT_GOALS.map(async (goal): Promise<CodeAgentRunListResult> => {
          try {
            return await host.listRuns(goal.id);
          } catch (err) {
            return {
              status: "unavailable",
              goalId: goal.id,
              runs: [],
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }),
      );
      const runsById = new Map<string, CodeAgentRun>();
      for (const result of results) {
        for (const run of result.runs) runsById.set(run.id, run);
      }
      setSearchRuns(sortRunsForRail([...runsById.values()]));
      const firstError = results.find((result) => result.status !== "ok");
      setSearchError(firstError?.error ?? null);
    } finally {
      setSearchLoading(false);
    }
  }, [host]);

  const routeChatFirstOpenAppEvents = useCallback(
    (events: CodeAgentTranscriptEvent[]) => {
      if (!onChatFirstOpenApp) return;
      for (const event of events) {
        if (seenChatFirstOpenAppEvents.current.has(event.id)) continue;
        seenChatFirstOpenAppEvents.current.add(event.id);
        const detail = chatFirstOpenAppDetailFromTranscriptEvent(
          event,
          registeredChatFirstMcpServerIds,
        );
        if (detail) onChatFirstOpenApp(detail);
      }
    },
    [onChatFirstOpenApp, registeredChatFirstMcpServerIds],
  );

  const loadTranscript = useCallback(
    async (runId: string | null = selectedRunId, busy = false) => {
      const transcriptRequestId = ++transcriptRequestRef.current;
      if (!runId) {
        setTranscriptEvents([]);
        setTranscriptError(null);
        setTranscriptLoading(false);
        return;
      }
      if (busy) setTranscriptLoading(true);
      try {
        const result = await withHostCallTimeout(
          host.readTranscript({
            goalId: selectedGoal.id,
            runId,
          }),
          getHostCallTimeoutMs(1_000),
        );
        if (
          transcriptRequestId !== transcriptRequestRef.current ||
          runId !== selectedRunIdRef.current
        ) {
          return;
        }
        routeChatFirstOpenAppEvents(result.events);
        setTranscriptEvents(result.events);
        setTranscriptError(result.error ?? null);
      } catch (err) {
        if (
          transcriptRequestId !== transcriptRequestRef.current ||
          runId !== selectedRunIdRef.current
        ) {
          return;
        }
        setTranscriptEvents([]);
        setTranscriptError(err instanceof Error ? err.message : String(err));
      } finally {
        if (
          transcriptRequestId === transcriptRequestRef.current &&
          runId === selectedRunIdRef.current
        ) {
          setTranscriptLoading(false);
        }
      }
    },
    [host, routeChatFirstOpenAppEvents, selectedGoal.id, selectedRunId],
  );

  const loadProjects = useCallback(async () => {
    setLoadingProjects(true);
    try {
      const result = await host.listProjects?.();
      if (!result || result.status !== "ok") {
        setProjects([]);
        return;
      }
      setProjects(result.projects);
      setSelectedProjectPath(
        (current) => current || result.selectedPath || result.defaultPath || "",
      );
    } catch {
      setProjects([]);
    } finally {
      setLoadingProjects(false);
    }
  }, [host]);

  const loadNamedWorktrees = useCallback(async () => {
    const requestId = namedWorktreeRequestRef.current + 1;
    namedWorktreeRequestRef.current = requestId;
    const requestedProjectPath = selectedProjectPath;
    if (newRunExecutionTarget !== "worktree" || !selectedProjectPath) {
      setNamedWorktrees([]);
      setNamedWorktreesLoading(false);
      return;
    }
    if (!host.listWorktrees) {
      setNamedWorktrees([]);
      setNamedWorktreesLoading(false);
      return;
    }
    setNamedWorktreesLoading(true);
    try {
      const result = await host.listWorktrees(selectedProjectPath);
      if (
        requestId !== namedWorktreeRequestRef.current ||
        requestedProjectPath !== selectedProjectPath
      ) {
        return;
      }
      setNamedWorktrees(result.status === "ok" ? result.worktrees : []);
    } catch {
      if (
        requestId !== namedWorktreeRequestRef.current ||
        requestedProjectPath !== selectedProjectPath
      ) {
        return;
      }
      setNamedWorktrees([]);
    } finally {
      if (requestId === namedWorktreeRequestRef.current) {
        setNamedWorktreesLoading(false);
      }
    }
  }, [host, newRunExecutionTarget, selectedProjectPath]);

  useEffect(() => {
    void loadNamedWorktrees();
  }, [loadNamedWorktrees]);

  const loadRemoteConnectorStatus = useCallback(async () => {
    if (!isActive || !host.getRemoteConnectorStatus) return;
    try {
      const result = await withHostCallTimeout(
        host.getRemoteConnectorStatus(),
        getHostCallTimeoutMs(5_000),
      );
      setRemoteConnectorStatus(result);
      setRemoteConnectorError(null);
    } catch (err) {
      setRemoteConnectorError(err instanceof Error ? err.message : String(err));
    }
  }, [host, isActive]);

  const loadHostMetadata = useCallback(async () => {
    if (!isActive || !host.getHostMetadata) return;
    try {
      const result = await host.getHostMetadata();
      setHostMetadata(result);
    } catch (err) {
      setHostMetadata({
        status: "unavailable",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [host, isActive]);

  const runComputerSetupAction = useCallback(
    async (action: CodeAgentComputerSetupAction) => {
      if (!host.runComputerSetupAction) {
        toast("Computer access setup is not available here");
        return;
      }
      setComputerSetupAction(action);
      try {
        const result = await host.runComputerSetupAction(action);
        if (action === "request-accessibility") {
          setAccessibilityPrompted(true);
        }
        if (action === "request-screen-recording") {
          setScreenRecordingPrompted(true);
        }
        if (result.restartRecommended) {
          setComputerSetupRestartRecommended(true);
        }
        toast(result.ok ? result.message : "Could not update computer access", {
          description: result.ok ? undefined : (result.error ?? result.message),
          duration: 3200,
        });
        if (action !== "restart") await loadHostMetadata();
      } catch (err) {
        toast("Could not update computer access", {
          description: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setComputerSetupAction(null);
      }
    },
    [host, loadHostMetadata],
  );

  const { pollNow: pollHostMetadataNow } = usePollLoop(loadHostMetadata, {
    intervalMs: 5000,
    enabled: isActive && !!host.getHostMetadata,
  });
  // Refresh outside the regular cadence when something else in this app
  // bumps refreshKey (e.g. after a setup action completes) — the leading
  // poll from usePollLoop above already covers the isActive-becomes-true
  // case, so pollNow() here is a no-op on mount (an attempt is already
  // in flight) and only does real work on a later refreshKey change.
  useEffect(() => {
    if (isActive) pollHostMetadataNow();
  }, [isActive, pollHostMetadataNow, refreshKey]);

  const connectBuilderProvider = useCallback(async () => {
    setBuilderConnectMessage(null);
    if (!host.connectBuilderProvider) {
      onOpenSettings?.();
      return;
    }

    setBuilderConnecting(true);
    try {
      const result = await host.connectBuilderProvider();
      const message = result.error ?? result.message;
      setBuilderConnectMessage(result.ok ? null : message);
      if (result.ok) {
        toast("Builder.io connected", {
          description: "Agent can now use Builder credits.",
        });
      } else {
        toast("Builder.io connect did not finish", {
          description: message,
        });
      }
      await loadHostMetadata();
      const modelResult = await host.listModels?.();
      let retrySelection = selectedModelSelection;
      if (modelResult?.status === "ok" && modelResult.models.length > 0) {
        setModelOptions(modelResult.models);
        if (
          modelResult.selected &&
          (!modelSelection.model || modelSelection.model === "auto")
        ) {
          setModelSelection(modelResult.selected);
          retrySelection = {
            ...modelResult.selected,
            effort: selectedModelSelection.effort,
          };
        }
      }
      if (
        result.ok &&
        selectedRun &&
        hasMissingCredentialSignal(selectedRun, transcriptEvents) &&
        host.retryRun
      ) {
        const retryResult = await host.retryRun({
          goalId: selectedGoal.id,
          runId: selectedRun.id,
          permissionMode: selectedPermissionMode,
          engine: retrySelection.engine,
          model: retrySelection.model,
          effort: retrySelection.effort,
        });
        if (retryResult.run) {
          setRuns((current) => [
            retryResult.run!,
            ...current.filter((run) => run.id !== retryResult.run!.id),
          ]);
          setSelectedExtensionDetailId(null);
          selectRun(retryResult.run.id);
          await loadTranscript(retryResult.run.id, true);
        }
      }
      await loadRuns(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setBuilderConnectMessage(message);
      toast("Builder.io connect did not finish", { description: message });
    } finally {
      setBuilderConnecting(false);
    }
  }, [
    host,
    loadHostMetadata,
    loadRuns,
    loadTranscript,
    modelSelection.model,
    selectRun,
    onOpenSettings,
    selectedGoal.id,
    selectedModelSelection,
    selectedPermissionMode,
    selectedRun,
    transcriptEvents,
  ]);

  const connectLocalRuntime = useCallback(
    async (engine: string) => {
      const runtimeEngine = getCodeAgentEngine(engine) ?? engine;
      const openLogin =
        runtimeEngine === "claude-cli"
          ? host.openClaudeLogin
          : runtimeEngine === "codex-cli"
            ? host.openCodexLogin
            : undefined;
      if (!openLogin) {
        if (host.openTerminal) {
          const result = await host.openTerminal();
          toast(
            result.ok ? "Terminal opened" : "Terminal did not open",
            result.ok
              ? {
                  description:
                    "Install the selected local runtime, then refresh the picker.",
                }
              : { description: result.error },
          );
          return;
        }
        toast("Local sign-in is only available in Agent Native Desktop", {
          description: "Open Settings to manage hosted providers instead.",
        });
        onOpenSettings?.();
        return;
      }
      try {
        const result = await openLogin();
        if (!result.ok) {
          toast(
            `${runtimeEngine === "claude-cli" ? "Claude" : "Codex"} sign-in was not opened`,
            {
              description: result.error,
            },
          );
          return;
        }
        toast(
          `${runtimeEngine === "claude-cli" ? "Claude" : "Codex"} sign-in opened`,
          {
            description: `Finish the ${runtimeEngine === "claude-cli" ? "Claude" : "ChatGPT"} sign-in in Terminal. The runtime picker will refresh when it is ready.`,
            duration: 4800,
          },
        );

        let attempts = 0;
        const refresh = async (): Promise<void> => {
          const modelResult = await host.listModels?.();
          if (modelResult?.status === "ok" && modelResult.models.length > 0) {
            setModelOptions(modelResult.models);
            if (modelResult.selected) {
              setModelSelection((current) =>
                current.model && current.model !== "auto"
                  ? current
                  : { ...modelResult.selected!, effort: current.effort },
              );
            }
            if (
              modelResult.models.some(
                (option) =>
                  option.engine === runtimeEngine && option.configured === true,
              )
            ) {
              toast(
                `${runtimeEngine === "claude-cli" ? "Claude" : "ChatGPT"} connected`,
                {
                  description: "This computer is ready for local Agent tasks.",
                },
              );
              return;
            }
          }
          attempts += 1;
          if (attempts < 30) window.setTimeout(() => void refresh(), 2_000);
        };
        void refresh();
      } catch (err) {
        toast(
          `${runtimeEngine === "claude-cli" ? "Claude" : "Codex"} sign-in was not opened`,
          {
            description: err instanceof Error ? err.message : String(err),
          },
        );
      }
    },
    [host, onOpenSettings],
  );

  usePollLoop(loadRemoteConnectorStatus, {
    intervalMs: 5000,
    enabled: isActive && !!host.getRemoteConnectorStatus,
  });

  useEffect(() => {
    if (!isActive || refreshKey <= 0) return;
    void loadRuns(true);
  }, [isActive, loadRuns, refreshKey]);

  useEffect(() => {
    if (!openRequest) return;
    onChatFirstMainKindChange?.("code");
    const nextGoal = getCodeAgentGoal(openRequest.goalId);
    if (nextGoal) setSelectedGoalId(nextGoal.id);
    setSelectedExtensionDetailId(null);
    selectRun(openRequest.runId ?? null);
    setWorkbenchOpen(false);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    void loadRuns(true);
  }, [loadRuns, onChatFirstMainKindChange, openRequest, selectRun]);

  useEffect(() => {
    const pendingFrames = new Set<number>();
    const handleScheduledPrompt = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt?: unknown }>).detail
        ?.prompt;
      if (typeof prompt !== "string" || !prompt.trim()) return;

      let attempts = 0;
      let frame: number | undefined;
      const insertPrompt = () => {
        const editor = document.querySelector<HTMLElement>(
          '[contenteditable="true"]',
        );
        const newChatSurface = editor?.closest(".code-agents-start");
        if (
          !editor ||
          !editor.isConnected ||
          !newChatSurface ||
          document.querySelector(".desktop-code-agent-schedules")
        ) {
          attempts += 1;
          if (attempts < 30) {
            frame = window.requestAnimationFrame(insertPrompt);
            pendingFrames.add(frame);
          }
          return;
        }

        if (frame !== undefined) pendingFrames.delete(frame);
        editor.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.execCommand("insertText", false, prompt.trim());
      };

      frame = window.requestAnimationFrame(insertPrompt);
      pendingFrames.add(frame);
    };

    window.addEventListener(SCHEDULED_CHAT_PROMPT_EVENT, handleScheduledPrompt);
    return () => {
      window.removeEventListener(
        SCHEDULED_CHAT_PROMPT_EVENT,
        handleScheduledPrompt,
      );
      pendingFrames.forEach((pendingFrame) =>
        window.cancelAnimationFrame(pendingFrame),
      );
    };
  }, []);

  const hasActiveRuns = useMemo(() => runs.some(isRunActive), [runs]);
  const selectedRunIsActive = selectedRun ? isRunActive(selectedRun) : false;
  const workbenchUrlParams = selectedRunId ? { run: selectedRunId } : undefined;
  const selectedRunStoredPermissionMode = selectedRun
    ? getRunPermissionMode(selectedRun)
    : DEFAULT_CODE_AGENT_PERMISSION_MODE;
  const slashCommands = useMemo(
    () => buildCodeAgentSlashCommands(codePack),
    [codePack],
  );
  const canOpenTerminal = false;
  const canChooseProjectFolder = Boolean(host.chooseProject);
  const providerGate = useMemo(
    () => getProviderGate(hostMetadata),
    [hostMetadata],
  );

  const [providerGateBouncePulse, setProviderGateBouncePulse] = useState(0);
  const bounceProviderGate = useCallback(() => {
    setProviderGateBouncePulse((pulse) => pulse + 1);
  }, []);
  // `listModels` only includes local runtimes when their CLI is installed.
  // Keep sign-in hidden until the host has confirmed the capability.
  const localRuntimeOptions = useMemo(
    () => getLocalRuntimeOptions(modelOptions),
    [modelOptions],
  );
  const supportsExecutionTarget =
    CODE_AGENT_LOCAL_ENGINES.has(selectedModelSelection.engine ?? "") ||
    Boolean(host.createRun);
  const portalSelected = newRunExecutionTarget === "portal";
  const normalizedSearchQuery = searchQuery.trim();
  const searchResults = useMemo(
    () =>
      buildSearchRunResults(
        searchRuns,
        searchQuery,
        searchTranscriptCacheRef.current,
      ),
    [searchRuns, searchQuery, searchTranscriptVersion],
  );

  useEffect(() => {
    setSelectedPermissionMode(selectedRunStoredPermissionMode);
  }, [selectedRunId, selectedRunStoredPermissionMode]);

  useEffect(() => {
    if (selectedRunId) markRunsRead([selectedRunId]);
  }, [markRunsRead, selectedRunId]);

  useEffect(() => {
    if (!searchPanelOpen) return;
    void loadSearchRuns();
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
  }, [loadSearchRuns, refreshKey, searchPanelOpen]);

  useEffect(() => {
    if (
      !searchPanelOpen ||
      normalizedSearchQuery.length < 2 ||
      searchRuns.length === 0
    ) {
      setSearchTranscriptLoading(false);
      return;
    }

    const missingRuns = searchRuns.filter(
      (run) => !searchTranscriptCacheRef.current.has(run.id),
    );
    if (missingRuns.length === 0) {
      setSearchTranscriptLoading(false);
      return;
    }

    let cancelled = false;
    setSearchTranscriptLoading(true);
    void Promise.all(
      missingRuns.map(async (run) => {
        try {
          const result = await host.readTranscript({
            goalId: run.goalId,
            runId: run.id,
          });
          if (!cancelled) {
            searchTranscriptCacheRef.current.set(
              run.id,
              result.status === "ok" ? result.events : [],
            );
          }
        } catch {
          if (!cancelled) searchTranscriptCacheRef.current.set(run.id, []);
        }
      }),
    ).finally(() => {
      if (cancelled) return;
      setSearchTranscriptLoading(false);
      setSearchTranscriptVersion((version) => version + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [host, normalizedSearchQuery, searchPanelOpen, searchRuns]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void host
      .listModels?.()
      .then((result) => {
        if (cancelled || result.status !== "ok" || result.models.length === 0) {
          return;
        }
        setModelOptions(result.models);
        if (
          (!modelSelection.model || modelSelection.model === "auto") &&
          result.selected
        ) {
          setModelSelection(result.selected);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [host, isActive, modelSelection.model, refreshKey]);

  useEffect(() => {
    if (!isActive) return;
    void loadProjects();
  }, [isActive, loadProjects]);

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    void host
      .listCodePacks?.(selectedProjectPath || undefined)
      .then((result) => {
        if (cancelled || result.status !== "ok") return;
        setCodePack(result.pack ?? null);
        if (!selectedProjectPath && result.pack?.root) {
          setSelectedProjectPath(result.pack.root);
        }
      })
      .catch(() => {
        if (!cancelled) setCodePack(null);
      });
    return () => {
      cancelled = true;
    };
  }, [host, isActive, selectedProjectPath]);

  useEffect(() => {
    writeCodeAgentModelSelection(selectedModelSelection);
  }, [selectedModelSelection]);

  useEffect(() => {
    if (!supportsExecutionTarget && newRunExecutionTarget !== "local") {
      setNewRunExecutionTarget("local");
    }
  }, [newRunExecutionTarget, supportsExecutionTarget]);

  usePollLoop(() => loadRuns(), {
    intervalMs: hasActiveRuns ? 2_000 : 10_000,
    enabled: isActive,
  });

  useEffect(() => {
    if (!isActive) return;
    void loadTranscript(selectedRunId, true);
    if (!selectedRunId) return;
    const unsubscribe = host.subscribeTranscript?.(
      { goalId: selectedGoal.id, runId: selectedRunId },
      (batch) => {
        if (batch.runId && batch.runId !== selectedRunId) return;
        if (batch.error) setTranscriptError(batch.error);
        if (batch.status === "ok" && batch.events.length > 0) {
          setTranscriptError(null);
          routeChatFirstOpenAppEvents(batch.events);
          setTranscriptEvents((current) =>
            mergeTranscriptEvents(current, batch.events),
          );
        }
      },
    );
    // When the push subscription is active it delivers events as they arrive.
    // Keep a long-interval fallback poll so we reconcile any gaps (e.g. if the
    // file watch fires before the write is fully flushed, or on first load).
    const pollMs = unsubscribe
      ? selectedRunIsActive
        ? 10_000
        : 30_000
      : selectedRunIsActive
        ? 1_000
        : 5_000;
    const engine = createPollEngine(() => loadTranscript(selectedRunId), {
      intervalMs: pollMs,
      leading: false,
    });
    engine.start();
    return () => {
      unsubscribe?.();
      engine.stop();
    };
  }, [
    host,
    isActive,
    loadTranscript,
    routeChatFirstOpenAppEvents,
    selectedGoal.id,
    selectedRunId,
    selectedRunIsActive,
  ]);

  // Cmd+N / Ctrl+N — start a new chat from anywhere in the workbench.
  // Use a ref so the effect is stable and doesn't re-register on every render.
  const openSelectedGoalRef = useRef(openSelectedGoal);
  openSelectedGoalRef.current = openSelectedGoal;
  useEffect(() => {
    if (!isActive) return;
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key?.toLowerCase() !== "n") return;
      if (e.altKey || e.shiftKey) return;
      e.preventDefault();
      openSelectedGoalRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isActive]);

  async function selectProjectFolder(pathValue: string) {
    if (!pathValue) return;
    setSelectedProjectPath(pathValue);
    try {
      const result = await host.selectProject?.(pathValue);
      if (result?.ok) {
        setProjects(result.projects);
        setSelectedProjectPath(result.selectedPath ?? pathValue);
      }
    } catch {
      // Local selection still works; host persistence is best-effort.
    }
  }

  async function chooseProjectFolder() {
    if (!host.chooseProject) {
      toast("Folder picker is not available here", {
        description:
          "Open Agent-Native Desktop to choose folders from the native picker.",
        duration: 3200,
      });
      return;
    }
    try {
      const result = await host.chooseProject();
      if (!result.ok || !result.selectedPath) {
        if (result.error && result.error !== "No folder selected.") {
          toast("Could not choose folder", {
            description: result.error,
            duration: 3200,
          });
        }
        return;
      }
      setProjects(result.projects);
      setSelectedProjectPath(result.selectedPath);
    } catch (err) {
      toast("Could not choose folder", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  function handleSlashCommand(commandName: string) {
    const normalized = commandName.replace(/^\/+/, "").toLowerCase();
    const matchingGoal = CODE_AGENT_GOALS.find(
      (goal) => goal.slashCommand?.replace(/^\/+/, "") === normalized,
    );
    if (matchingGoal) {
      setSelectedGoalId(matchingGoal.id);
      setSelectedExtensionDetailId(null);
      selectRun(null);
      setWorkbenchOpen(false);
      setSearchPanelOpen(false);
      setMobilePanelOpen(false);
      seedNewPrompt(
        matchingGoal.id === "task" ? "" : `${matchingGoal.slashCommand} `,
      );
      return;
    }
    const matchingSkill = codePack?.skills.find(
      (skill) => skill.name.toLowerCase() === normalized,
    );
    setSelectedGoalId("task");
    setSelectedExtensionDetailId(null);
    selectRun(null);
    setWorkbenchOpen(false);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    seedNewPrompt(
      matchingSkill
        ? `Use the ${matchingSkill.name} skill to `
        : `/${normalized} `,
    );
  }

  async function openTerminal() {
    if (!host.openTerminal) {
      toast("Terminal is not available here", {
        description: "Open Agent-Native Desktop to launch a native terminal.",
        duration: 3200,
      });
      return;
    }
    const terminalRequest = selectedRun
      ? getRunTerminalRequest(selectedRun)
      : selectedProjectPath
        ? { cwd: selectedProjectPath }
        : undefined;
    let result: CodeAgentTerminalResult | undefined;
    try {
      result = await host.openTerminal?.(terminalRequest);
    } catch (err) {
      toast("Terminal was not opened", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
      return;
    }
    if (result?.ok) {
      toast("Terminal opened", { duration: 1600 });
      return;
    }
    toast("Terminal was not opened", {
      description: result?.error ?? "This platform has no terminal launcher.",
      duration: 3200,
    });
  }

  function openSearchPanel() {
    onChatFirstMainKindChange?.("code");
    setSearchPanelOpen(true);
    setMobilePanelOpen(false);
    setWorkbenchOpen(false);
  }

  function openSearchResult(run: CodeAgentRun) {
    onChatFirstMainKindChange?.("code");
    const goal = getCodeAgentGoal(run.goalId) ?? getDefaultCodeAgentGoal();
    setSelectedGoalId(goal.id);
    setRuns((current) =>
      current.some((item) => item.id === run.id) ? current : [run, ...current],
    );
    setSelectedExtensionDetailId(null);
    selectRun(run.id);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    setWorkbenchOpen(false);
  }

  async function pairRemoteConnector(relayUrl: string) {
    if (!host.pairRemoteConnector) {
      toast("Mobile pairing is not available here", {
        description: "Open Agent-Native Desktop to pair this Mac.",
        duration: 3200,
      });
      return;
    }
    const trimmedRelayUrl = relayUrl.trim();
    if (!trimmedRelayUrl) {
      toast("Choose a relay first", {
        description: "A Dispatch relay URL is needed before pairing.",
        duration: 3200,
      });
      return;
    }
    setRemoteConnectorPairing(true);
    setRemoteConnectorMessage(null);
    try {
      const result = await host.pairRemoteConnector({
        relayUrl: trimmedRelayUrl,
        label: "Agent Native Desktop",
      });
      setRemoteConnectorStatus(result.status);
      setRemoteConnectorMessage(result.error ?? result.message ?? null);
      toast(result.ok ? "Mobile pairing ready" : "Mobile pairing failed", {
        description: result.error ?? result.message,
        duration: result.ok ? 2200 : 3600,
      });
      if (result.ok) void loadRemoteConnectorStatus();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRemoteConnectorMessage(message);
      toast("Mobile pairing failed", {
        description: message,
        duration: 3600,
      });
    } finally {
      setRemoteConnectorPairing(false);
    }
  }

  async function setRemoteConnectorEnabled(enabled: boolean) {
    if (!host.setRemoteConnectorEnabled) {
      toast("Mobile pairing controls are not available here", {
        description: "Open Agent-Native Desktop to manage mobile pairing.",
        duration: 3200,
      });
      return;
    }
    setRemoteConnectorUpdating(true);
    setRemoteConnectorMessage(null);
    try {
      const result = await host.setRemoteConnectorEnabled(enabled);
      setRemoteConnectorStatus(result.status);
      setRemoteConnectorMessage(result.error ?? null);
      toast(enabled ? "Mobile pairing resumed" : "Mobile pairing paused", {
        description: result.error,
        duration: result.ok ? 1800 : 3600,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setRemoteConnectorMessage(message);
      toast("Could not update mobile pairing", {
        description: message,
        duration: 3600,
      });
    } finally {
      setRemoteConnectorUpdating(false);
    }
  }

  async function copyMobileLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      toast("Mobile link copied", { duration: 1600 });
    } catch (err) {
      toast("Could not copy mobile link", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  function openSelectedGoal() {
    onChatFirstMainKindChange?.("code");
    setSelectedGoalId("task");
    setSelectedExtensionDetailId(null);
    selectRun(null);
    setWorkbenchOpen(false);
    setSearchPanelOpen(false);
    setMobilePanelOpen(false);
    seedNewPrompt("");
  }

  async function controlRun(command: CodeAgentControlCommand) {
    if (!selectedRunId) {
      toast("Select a chat first", { duration: 1800 });
      return;
    }
    if (command === "resume" && selectedRunUsesAppSurface) {
      setWorkbenchOpen(true);
    }

    let result: CodeAgentControlResult;
    try {
      result = await host.controlRun(
        selectedGoal.id,
        selectedRunId,
        command,
        selectedPermissionMode,
      );
    } catch (err) {
      toast("Could not control the response", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
      return;
    }
    if (result.action === "open-ui") setWorkbenchOpen(true);
    if (result.action === "refresh") await loadRuns(true);
    toast(result.message, {
      duration: result.ok ? 2200 : 3600,
      description: result.error,
    });
  }

  async function forkSelectedChat(executionTarget: "local" | "worktree") {
    if (!forkSourceRun || !host.forkRun) return;
    setForkBusy(true);
    try {
      const result = await host.forkRun({
        goalId: selectedGoal.id,
        sourceRunId: forkSourceRun.id,
        executionTarget,
      });
      if (!result.ok || !result.run) {
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      setRuns((current) => [
        result.run!,
        ...current.filter((run) => run.id !== result.run!.id),
      ]);
      setForkSourceRun(null);
      selectRun(result.run.id);
      await loadTranscript(result.run.id, true);
      toast(result.message, { duration: 2200 });
    } catch (error) {
      toast("Could not fork the chat", {
        description: error instanceof Error ? error.message : String(error),
        duration: 3600,
      });
    } finally {
      setForkBusy(false);
    }
  }

  async function restoreSelectedWorktree(worktreeId: string, runId: string) {
    if (!host.restoreWorktree) return;
    setRestoringWorktreeId(worktreeId);
    try {
      const result = await host.restoreWorktree({ worktreeId, runId });
      if (!result.ok) {
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      await loadRuns(true);
      await loadTranscript(runId, true);
      toast(result.message, { duration: 2200 });
    } catch (error) {
      toast("Could not restore the worktree", {
        description: error instanceof Error ? error.message : String(error),
        duration: 3600,
      });
    } finally {
      setRestoringWorktreeId(null);
    }
  }

  async function createRunFromPrompt(
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) {
    if (terminalMode) {
      const prompt = preparedPrompt.trim();
      if (!prompt) {
        toast("Describe an outcome first", { duration: 1800 });
        return;
      }
      setCreatingRun(true);
      try {
        await terminalMode.onSubmit(prompt, attachments);
        setNewPrompt("");
        setNewPromptSeed((seed) => seed + 1);
        selectRun(null);
        setSelectedExtensionDetailId(null);
        setWorkbenchOpen(false);
        setSearchPanelOpen(false);
        setMobilePanelOpen(false);
      } catch (err) {
        toast("Could not start the terminal", {
          description: err instanceof Error ? err.message : String(err),
          duration: 3600,
        });
      } finally {
        setCreatingRun(false);
      }
      return;
    }
    if (activeNewSessionExtension) {
      const prompt = preparedPrompt.trim();
      if (!prompt) {
        toast("Describe an outcome first", { duration: 1800 });
        return;
      }
      setCreatingRun(true);
      try {
        const result = await activeNewSessionExtension.submit({
          prompt,
          cwd: selectedProjectPath || undefined,
          attachments,
        });
        if (!result.ok) {
          toast(result.message ?? "Could not start the chat", {
            description: result.error,
            duration: 3600,
          });
          return;
        }
        if (result.detailId && !activeNewSessionExtension.renderDetail) {
          toast("Could not open the collaboration", {
            description: "This session mode does not provide a detail view.",
            duration: 3600,
          });
          return;
        }
        setNewPrompt("");
        setNewPromptSeed((seed) => seed + 1);
        selectRun(null);
        setSelectedExtensionDetailId(result.detailId ?? null);
        setWorkbenchOpen(false);
        setSearchPanelOpen(false);
        setMobilePanelOpen(false);
        if (result.message) toast(result.message, { duration: 2200 });
      } catch (err) {
        toast("Could not start the chat", {
          description: err instanceof Error ? err.message : String(err),
          duration: 3600,
        });
      } finally {
        setCreatingRun(false);
      }
      return;
    }
    if (providerGate.blocked && newRunExecutionTarget !== "portal") {
      toast("Connect a model provider first", {
        description: providerGate.description,
        duration: 3600,
      });
      return;
    }
    const typedGoal =
      CODE_AGENT_GOALS.find(
        (goal) =>
          goal.id !== "task" &&
          preparedPrompt.trim().startsWith(goal.slashCommand),
      ) ?? selectedGoal;
    const prompt = normalizePromptForSelectedGoal(typedGoal, preparedPrompt);
    if (!prompt) {
      toast("Describe an outcome first", { duration: 1800 });
      return;
    }
    setCreatingRun(true);
    try {
      const result = await host.createRun({
        goalId: typedGoal.id,
        prompt,
        cwd: selectedProjectPath || undefined,
        executionTarget: supportsExecutionTarget
          ? newRunExecutionTarget
          : "local",
        worktree:
          supportsExecutionTarget && newRunExecutionTarget === "worktree"
            ? newRunWorktreeSelection
            : undefined,
        permissionMode: newRunPermissionMode,
        engine: selectedModelSelection.engine,
        model: selectedModelSelection.model,
        effort: selectedModelSelection.effort,
        attachments,
      });
      if (!result.ok || !result.run) {
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      setNewPrompt("");
      setNewPromptSeed((seed) => seed + 1);
      setRuns((current) => [result.run!, ...current]);
      setSelectedExtensionDetailId(null);
      selectRun(result.run.id);
      if (typedGoal.id !== selectedGoal.id) {
        setSelectedGoalId(typedGoal.id);
      }
      setWorkbenchOpen(false);
      setSearchPanelOpen(false);
      setMobilePanelOpen(false);
      if (result.event) setTranscriptEvents([result.event]);
      if (typedGoal.id === selectedGoal.id) {
        await loadRuns(true);
      } else {
        const refreshed = await host.listRuns(typedGoal.id);
        setStatus(refreshed.status);
        setError(refreshed.error ?? null);
        setRuns(refreshed.runs);
      }
      await loadTranscript(result.run.id, true);
    } catch (err) {
      toast("Could not start the chat", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    } finally {
      setCreatingRun(false);
    }
  }

  async function changeSelectedPermissionMode(
    nextMode: CodeAgentPermissionMode,
  ) {
    if (!selectedRun) {
      setSelectedPermissionMode(nextMode);
      return;
    }
    const previousMode = selectedPermissionMode;
    setSelectedPermissionMode(nextMode);
    setRuns((current) =>
      current.map((run) =>
        run.id === selectedRun.id ? withRunPermissionMode(run, nextMode) : run,
      ),
    );

    try {
      const result = await host.updateRun({
        goalId: selectedGoal.id,
        runId: selectedRun.id,
        permissionMode: nextMode,
      });
      if (!result.ok) {
        setSelectedPermissionMode(previousMode);
        setRuns((current) =>
          current.map((run) =>
            run.id === selectedRun.id
              ? withRunPermissionMode(run, previousMode)
              : run,
          ),
        );
        toast(result.message, {
          description: result.error,
          duration: 3600,
        });
        return;
      }
      if (result.run) {
        setRuns((current) =>
          current.map((run) =>
            run.id === result.run!.id
              ? withRunPermissionMode(result.run!, nextMode)
              : run,
          ),
        );
      }
      toast("Mode updated", { duration: 1600 });
    } catch (err) {
      setSelectedPermissionMode(previousMode);
      setRuns((current) =>
        current.map((run) =>
          run.id === selectedRun.id
            ? withRunPermissionMode(run, previousMode)
            : run,
        ),
      );
      toast("Could not update mode", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3600,
      });
    }
  }

  async function toggleRunPinned(run: CodeAgentRun) {
    const pinned = isRunPinned(run);
    const nextPinnedAt = pinned ? null : new Date().toISOString();
    const optimisticRun = withRunPinnedAt(run, nextPinnedAt);
    setRuns((current) =>
      current.map((item) => (item.id === run.id ? optimisticRun : item)),
    );

    try {
      const result = await host.updateRun({
        goalId: selectedGoal.id,
        runId: run.id,
        metadata: {
          [CODE_AGENT_PINNED_AT_METADATA_KEY]: nextPinnedAt,
        },
      });
      if (!result.ok) {
        setRuns((current) =>
          current.map((item) => (item.id === run.id ? run : item)),
        );
        toast(result.message, {
          description: result.error,
          duration: 3200,
        });
        return;
      }
      if (result.run) {
        setRuns((current) =>
          current.map((item) =>
            item.id === result.run!.id ? result.run! : item,
          ),
        );
      }
      toast(pinned ? "Chat unpinned" : "Chat pinned", {
        duration: 1600,
      });
    } catch (err) {
      setRuns((current) =>
        current.map((item) => (item.id === run.id ? run : item)),
      );
      toast(pinned ? "Could not unpin chat" : "Could not pin chat", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  async function renameRun(run: CodeAgentRun, newTitle: string) {
    const trimmed = newTitle.trim();
    if (!trimmed || trimmed === getRunTitle(run)) return;
    const optimisticRun: CodeAgentRun = { ...run, title: trimmed };
    setRuns((current) =>
      current.map((item) => (item.id === run.id ? optimisticRun : item)),
    );
    try {
      const result = await host.updateRun({
        goalId: selectedGoal.id,
        runId: run.id,
        title: trimmed,
      });
      if (!result.ok) {
        setRuns((current) =>
          current.map((item) => (item.id === run.id ? run : item)),
        );
        toast(result.message, { description: result.error, duration: 3200 });
        return;
      }
      if (result.run) {
        setRuns((current) =>
          current.map((item) =>
            item.id === result.run!.id ? result.run! : item,
          ),
        );
      }
      toast("Chat renamed", { duration: 1600 });
    } catch (err) {
      setRuns((current) =>
        current.map((item) => (item.id === run.id ? run : item)),
      );
      toast("Could not rename chat", {
        description: err instanceof Error ? err.message : String(err),
        duration: 3200,
      });
    }
  }

  toggleRunPinnedRef.current = toggleRunPinned;
  renameRunRef.current = renameRun;

  const handleRailSelect = useCallback(
    (id: string) => {
      onChatFirstMainKindChangeRef.current?.("code");
      markRunsRead([id]);
      setSelectedExtensionDetailId(null);
      selectRun(id);
      setSearchPanelOpen(false);
      setMobilePanelOpen(false);
    },
    [markRunsRead, selectRun],
  );

  useEffect(() => {
    if (!isActive || !keyboardNavigation) return;

    const handleShortcut = (
      shortcut: ChatFirstKeyboardShortcut,
      preventDefault?: () => void,
    ) => {
      const isCommand = Boolean(shortcut.metaKey || shortcut.ctrlKey);
      if (!isCommand || shortcut.altKey) return;

      if (!shortcut.shiftKey) {
        const appId = getChatFirstNumericAppShortcut(
          keyboardNavigation.appIds,
          shortcut.key,
        );
        if (!appId) return;
        preventDefault?.();
        keyboardNavigation.onSelectApp(appId);
        return;
      }

      const isBack =
        shortcut.code === "BracketLeft" ||
        shortcut.key === "[" ||
        shortcut.key === "{";
      const isForward =
        shortcut.code === "BracketRight" ||
        shortcut.key === "]" ||
        shortcut.key === "}";
      if (!isBack && !isForward) return;

      const target = resolveChatFirstKeyboardNavigationTarget({
        appIds: keyboardNavigation.appIds,
        activeAppId: keyboardNavigation.activeAppId,
        chatIds: railItems.map((item) => item.id),
        selectedChatId: selectedRunId,
        direction: isBack ? -1 : 1,
      });
      if (!target) return;
      preventDefault?.();
      if (target.kind === "app") {
        keyboardNavigation.onSelectApp(target.id);
      } else {
        handleRailSelect(target.id);
      }
    };

    const handleDomKeyDown = (event: KeyboardEvent) => {
      handleShortcut(
        {
          key: event.key,
          code: event.code,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
        },
        () => event.preventDefault(),
      );
    };

    window.addEventListener("keydown", handleDomKeyDown);
    const unsubscribe = keyboardNavigation.subscribe?.(handleShortcut);
    return () => {
      window.removeEventListener("keydown", handleDomKeyDown);
      unsubscribe?.();
    };
  }, [
    handleRailSelect,
    isActive,
    keyboardNavigation,
    railItems,
    selectedRunId,
  ]);

  const handleRailOpen = useCallback(
    (id: string) => {
      onChatFirstMainKindChangeRef.current?.("code");
      markRunsRead([id]);
      setSelectedExtensionDetailId(null);
      selectRun(id);
      setWorkbenchOpen(true);
      setSearchPanelOpen(false);
      setMobilePanelOpen(false);
    },
    [markRunsRead, selectRun],
  );

  const handleRailTogglePin = useCallback((id: string) => {
    const run = runsRef.current.find((item) => item.id === id);
    if (run) void toggleRunPinnedRef.current(run);
  }, []);

  const handleRailRename = useCallback((id: string, nextTitle: string) => {
    const run = runsRef.current.find((item) => item.id === id);
    if (run) void renameRunRef.current(run, nextTitle);
  }, []);

  const requestPortalTransfer = useCallback(
    (runId?: string) => {
      if (runId) {
        const run = runsRef.current.find((candidate) => candidate.id === runId);
        if (!run || isPortalCodeAgentRun(run)) return;
        setPortalTransferRequest({
          kind: "run",
          runId,
          title: getRunTitle(run) ?? "this chat",
        });
        return;
      }
      if (host.transferAll) setPortalTransferRequest({ kind: "all" });
    },
    [host.transferAll],
  );

  const confirmPortalTransfer = useCallback(async () => {
    const request = portalTransferRequest;
    if (!request || portalTransferBusy) return;
    setPortalTransferBusy(true);
    try {
      if (request.kind === "run") {
        if (!host.transferRun) {
          toast("Portal transfer is not available on this host.", {
            duration: 2200,
          });
          return;
        }
        const result = await host.transferRun({ runId: request.runId });
        toast(result.ok ? result.message : "Could not move chat to Portal.", {
          description: result.ok ? undefined : (result.error ?? result.message),
          duration: 2600,
        });
      } else {
        if (!host.transferAll) {
          toast("Portal transfer is not available on this host.", {
            duration: 2200,
          });
          return;
        }
        const result = await host.transferAll();
        toast(result.ok ? result.message : "Portal transfer needs attention.", {
          description: result.ok ? undefined : (result.error ?? result.message),
          duration: 3200,
        });
      }
      await loadRuns(true);
    } catch (error) {
      toast("Portal transfer did not finish.", {
        description: error instanceof Error ? error.message : String(error),
        duration: 3200,
      });
    } finally {
      setPortalTransferBusy(false);
      setPortalTransferRequest(null);
    }
  }, [host, loadRuns, portalTransferBusy, portalTransferRequest]);

  const handleRailAdditionalRowActions = useCallback(
    (item: ChatHistoryItem, closeMenu: () => void) => (
      <>
        <button
          type="button"
          role="menuitem"
          className="an-chat-history-row__menu-item"
          onClick={() => {
            closeMenu();
            void writeClipboardText(item.id).then((copied) => {
              toast(
                copied ? "Session ID copied" : "Could not copy session ID",
                { duration: 1800 },
              );
            });
          }}
        >
          <IconCopy size={13} strokeWidth={1.8} />
          <span>Copy session ID</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="an-chat-history-row__menu-item"
          onClick={() => {
            closeMenu();
            const run = runsRef.current.find(
              (candidate) => candidate.id === item.id,
            );
            if (!run) return;
            emitChatFirstSessionWatch({
              sessionId: item.id,
              title: getRunTitle(run) ?? "Untitled session",
              kind: "code-agent",
              goalId: run.goalId,
              sourceSessionId: selectedRunIdRef.current ?? undefined,
            });
          }}
        >
          <IconEye size={13} strokeWidth={1.8} />
          <span>
            {watchedSessionTargetRef.current?.sessionId === item.id
              ? "Keep watching session"
              : "Watch and message session"}
          </span>
        </button>
        {host.transferRun &&
        runsRef.current.some(
          (run) => run.id === item.id && !isPortalCodeAgentRun(run),
        ) ? (
          <button
            type="button"
            role="menuitem"
            className="an-chat-history-row__menu-item"
            onClick={() => {
              closeMenu();
              requestPortalTransfer(item.id);
            }}
          >
            <IconRoute size={13} strokeWidth={1.8} />
            <span>Move to Portal</span>
          </button>
        ) : null}
      </>
    ),
    [host.transferRun, requestPortalTransfer],
  );

  const showingSelectedRunDetail =
    !workbenchOpen &&
    !mobilePanelOpen &&
    !searchPanelOpen &&
    Boolean(selectedRun);

  return (
    <section
      className={`code-agents-surface${
        railCollapsed ? " code-agents-surface--rail-collapsed" : ""
      }`}
      aria-label="Agent workspace"
    >
      <aside
        className={`code-agents-rail${
          railCollapsed ? " code-agents-rail--collapsed" : ""
        }`}
        aria-label="Agent chats and navigation"
      >
        {railWindowControlsSlot}
        <div className="code-agents-window-drag-region" aria-hidden="true" />
        <div className="code-agents-rail-scroll">
          <ChatFirstPrimaryNavigation
            onNewChat={() => {
              chatFirstNavigation?.onNewChat?.();
              openSelectedGoal();
            }}
            onOpenIntegrations={() => chatFirstNavigation?.onOpenIntegrations()}
            onOpenScheduled={() => chatFirstNavigation?.onOpenScheduled()}
            onSearch={openSearchPanel}
            activeTab={chatFirstNavigation?.activeTab}
            collapsed={railCollapsed}
            stickyNewChat
          />
          {railWorkspaceSlot}

          <ChatFirstChatHistory
            items={railItems}
            activeId={selectedRunId}
            label={
              chatFirstNavigation?.onOpenChats ? (
                <button
                  type="button"
                  className="text-start text-[11px] font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={chatFirstNavigation.onOpenChats}
                >
                  Chats
                </button>
              ) : undefined
            }
            headerAction={
              <CodeAgentsChatHistoryHeaderActions
                hasUnread={runs.some((run) => unreadRunIds.has(run.id))}
                onMarkAllRead={markAllRunsRead}
                onTransferAll={
                  host.transferAll ? () => requestPortalTransfer() : undefined
                }
              />
            }
            loading={loading}
            loadingLabel={<RunListSkeleton />}
            emptyLabel="No chats yet."
            onSelect={handleRailSelect}
            onOpen={handleRailOpen}
            onTogglePin={handleRailTogglePin}
            onRename={handleRailRename}
            renderAdditionalRowActions={handleRailAdditionalRowActions}
            className="code-agents-run-list"
          />
        </div>
        {railFooterSlot ? (
          <div className="code-agents-rail-footer">{railFooterSlot}</div>
        ) : null}
      </aside>

      <main className="code-agents-main">
        {mainToolbarSlot ? (
          <div className="code-agents-main-toolbar">{mainToolbarSlot}</div>
        ) : null}
        {chatFirstMainKind === "agent" && renderChatFirstMainSurface ? (
          renderChatFirstMainSurface
        ) : (
          <>
            {!onWatchedRunChange &&
            watchedRun &&
            (!activeChatFirstSurfaceKind ||
              activeChatFirstSurfaceKind === "side-chat") ? (
              <SessionWatchPanel
                host={host}
                run={watchedRun}
                sourceRunId={
                  watchedSession.target?.sourceSessionId ?? selectedRunId
                }
                onClose={closeChatFirstSessionWatch}
              />
            ) : null}
            {workbenchOpen ? (
              <div className="code-agents-workbench">
                <div className="code-agents-workbench__toolbar">
                  <div>
                    <p className="code-agents-kicker">Chat</p>
                    <h2>
                      {getRunTitle(selectedRun) ??
                        (selectedRunId
                          ? `Chat ${selectedRunId}`
                          : selectedGoal.primaryActionLabel)}
                    </h2>
                    <AgentCapabilitySummary
                      metadata={hostMetadata}
                      onOpenComputerSetup={() => setComputerSetupOpen(true)}
                    />
                  </div>
                  <div className="code-agents-toolbar-actions">
                    {canOpenTerminal && (
                      <button
                        type="button"
                        className="code-agents-button"
                        onClick={openTerminal}
                      >
                        <IconTerminal2 size={14} strokeWidth={1.8} />
                        Open Terminal
                      </button>
                    )}
                    <button
                      type="button"
                      className="code-agents-button"
                      onClick={() => setWorkbenchOpen(false)}
                    >
                      Close
                    </button>
                  </div>
                </div>
                <div className="code-agents-workbench-frame">
                  {selectedGoalApp && renderAppSurface ? (
                    renderAppSurface({
                      goal: selectedGoal,
                      app: selectedGoalApp,
                      urlParams: workbenchUrlParams,
                      refreshKey,
                    })
                  ) : (
                    <NativeGoalSurface
                      goal={selectedGoal}
                      onOpenTerminal={
                        canOpenTerminal ? openTerminal : undefined
                      }
                    />
                  )}
                </div>
              </div>
            ) : renderChatFirstChatSurface ? (
              <div className="code-agents-overview code-agents-overview--chat-surface">
                {renderChatFirstChatSurface}
              </div>
            ) : (
              <div
                className={`code-agents-overview${
                  showingSelectedRunDetail ? " code-agents-overview--chat" : ""
                }`}
              >
                {mobilePanelOpen ? (
                  <MobileConnectorPanel
                    status={remoteConnectorStatus}
                    error={remoteConnectorError}
                    message={remoteConnectorMessage}
                    relayUrl={remoteRelayUrl}
                    brandIconUrl={brandIconUrl}
                    pairing={remoteConnectorPairing}
                    updating={remoteConnectorUpdating}
                    canPair={Boolean(host.pairRemoteConnector)}
                    canToggle={Boolean(host.setRemoteConnectorEnabled)}
                    onPair={pairRemoteConnector}
                    onSetEnabled={setRemoteConnectorEnabled}
                    onRefresh={loadRemoteConnectorStatus}
                    onCopyLink={copyMobileLink}
                    onOpenSettings={onOpenSettings}
                  />
                ) : searchPanelOpen ? (
                  <SearchChatsPanel
                    query={searchQuery}
                    results={searchResults}
                    totalRuns={searchRuns.length}
                    loading={searchLoading}
                    transcriptLoading={searchTranscriptLoading}
                    error={searchError}
                    inputRef={searchInputRef}
                    onQueryChange={setSearchQuery}
                    onSelectRun={openSearchResult}
                    onRefresh={loadSearchRuns}
                  />
                ) : (
                  <>
                    {loading ? (
                      <OverviewSkeleton />
                    ) : (
                      <>
                        {status !== "ok" &&
                        !(
                          suppressChatFirstUnavailableNotice &&
                          status === "unavailable"
                        ) ? (
                          <div
                            className={`code-agents-callout code-agents-callout--${status}`}
                          >
                            <IconAlertCircle size={17} strokeWidth={1.8} />
                            <span>
                              {status === "unauthorized"
                                ? `Open ${selectedGoal.surfaceLabel} and sign in to see chats.`
                                : (error ??
                                  `${selectedGoal.surfaceLabel} is not reporting chats yet.`)}
                            </span>
                          </div>
                        ) : null}

                        {activeNewSessionExtension &&
                        selectedExtensionDetailId &&
                        activeNewSessionExtension.renderDetail ? (
                          activeNewSessionExtension.renderDetail({
                            detailId: selectedExtensionDetailId,
                            onClose: openSelectedGoal,
                          })
                        ) : selectedRun ? (
                          <RunDetailCard
                            key={selectedRun.id}
                            host={host}
                            run={selectedRun}
                            selectedRunId={selectedRunId}
                            goal={selectedGoal}
                            transcriptEvents={transcriptEvents}
                            transcriptLoading={transcriptLoading}
                            transcriptError={transcriptError}
                            permissionMode={selectedPermissionMode}
                            modelSelection={selectedModelSelection}
                            modelOptions={modelOptions}
                            onPermissionModeChange={
                              changeSelectedPermissionMode
                            }
                            onModelSelectionChange={setModelSelection}
                            onStop={() => controlRun("stop")}
                            onApprove={() => controlRun("approve")}
                            onApproveAlways={() => controlRun("approve-always")}
                            onDeny={() => controlRun("deny")}
                            providerBlocked={providerGate.blocked}
                            builderConnecting={builderConnecting}
                            builderConnectMessage={builderConnectMessage}
                            onConnectBuilder={connectBuilderProvider}
                            onOpenSettings={onOpenSettings}
                            onConnectProvider={connectBuilderProvider}
                            onConnectLocalRuntime={
                              host.openTerminal
                                ? connectLocalRuntime
                                : undefined
                            }
                            onOpenRun={(runId) => {
                              onChatFirstMainKindChange?.("code");
                              selectRun(runId);
                            }}
                            onForkChat={
                              host.forkRun
                                ? () => setForkSourceRun(selectedRun)
                                : undefined
                            }
                            onRestoreWorktree={restoreSelectedWorktree}
                            restoringWorktreeId={restoringWorktreeId}
                          />
                        ) : (
                          <div className="code-agents-start">
                            <h2>What should we do today?</h2>
                            {!terminalMode &&
                              !activeNewSessionExtension &&
                              providerGate.blocked &&
                              !portalSelected && (
                                <ProviderGateNotice
                                  description={providerGate.description}
                                  connecting={builderConnecting}
                                  message={builderConnectMessage}
                                  bouncePulse={providerGateBouncePulse}
                                  onConnectBuilder={connectBuilderProvider}
                                  onOpenSettings={onOpenSettings}
                                  localRuntimeOptions={localRuntimeOptions}
                                  onConnectLocalRuntime={
                                    host.openTerminal
                                      ? connectLocalRuntime
                                      : undefined
                                  }
                                />
                              )}
                            <NewSessionComposer
                              key={newPromptSeed}
                              prompt={newPrompt}
                              promptSeed={newPromptSeed}
                              inputRef={newPromptRef}
                              creating={creatingRun}
                              terminalAgent={terminalAgentOption}
                              terminalModeControl={terminalModeControl}
                              permissionMode={newRunPermissionMode}
                              modelSelection={selectedModelSelection}
                              modelOptions={modelOptions}
                              slashCommands={
                                terminalMode || activeNewSessionExtension
                                  ? []
                                  : slashCommands
                              }
                              disabled={
                                terminalMode
                                  ? false
                                  : activeNewSessionExtension
                                    ? activeNewSessionExtension.disabled
                                    : providerGate.blocked && !portalSelected
                              }
                              onDisabledClick={
                                !terminalMode &&
                                !activeNewSessionExtension &&
                                providerGate.blocked &&
                                !portalSelected
                                  ? bounceProviderGate
                                  : undefined
                              }
                              modeControl={
                                terminalMode
                                  ? undefined
                                  : newSessionExtension?.renderModeControl?.({
                                      permissionMode: newRunPermissionMode,
                                      onPermissionModeChange:
                                        setNewRunPermissionMode,
                                    })
                              }
                              useDefaultModeControl={
                                terminalMode
                                  ? false
                                  : newSessionExtensionComposerState.useDefaultModeControl
                              }
                              showModelSelector={
                                terminalMode
                                  ? true
                                  : newSessionExtensionComposerState.showModelSelector
                              }
                              onPromptChange={setNewPrompt}
                              onPermissionModeChange={setNewRunPermissionMode}
                              onModelSelectionChange={setModelSelection}
                              onSlashCommand={
                                terminalMode || activeNewSessionExtension
                                  ? undefined
                                  : handleSlashCommand
                              }
                              onSubmit={createRunFromPrompt}
                              onConnectProvider={
                                terminalMode
                                  ? undefined
                                  : connectBuilderProvider
                              }
                              onConnectLocalRuntime={
                                !terminalMode &&
                                !activeNewSessionExtension &&
                                host.openTerminal
                                  ? connectLocalRuntime
                                  : undefined
                              }
                            />
                            {(projects.length > 0 ||
                              canChooseProjectFolder) && (
                              <RemoteWaitlistPopover
                                open={cloudWaitlistOpen}
                                onOpenChange={(open) => {
                                  if (
                                    !open &&
                                    cloudWaitlistOpeningRef.current
                                  ) {
                                    cloudWaitlistOpeningRef.current = false;
                                    return;
                                  }
                                  setCloudWaitlistOpen(open);
                                }}
                                submit={host.submitRemoteWaitlist}
                              >
                                <ProjectFolderPicker
                                  variant="bar"
                                  projects={projects}
                                  selectedPath={selectedProjectPath}
                                  executionTarget={newRunExecutionTarget}
                                  worktreeSelection={newRunWorktreeSelection}
                                  namedWorktrees={namedWorktrees}
                                  namedWorktreesLoading={namedWorktreesLoading}
                                  showExecutionTarget={supportsExecutionTarget}
                                  loading={loadingProjects}
                                  canChoose={canChooseProjectFolder}
                                  onSelect={selectProjectFolder}
                                  onChoose={chooseProjectFolder}
                                  onCloudSelect={() => {
                                    cloudWaitlistOpeningRef.current = true;
                                    globalThis.setTimeout(() => {
                                      setCloudWaitlistOpen(true);
                                      globalThis.setTimeout(() => {
                                        cloudWaitlistOpeningRef.current = false;
                                      }, 0);
                                    }, 0);
                                  }}
                                  onExecutionTargetChange={(target) => {
                                    setNewRunExecutionTarget(target);
                                    if (target !== "worktree") {
                                      setNewRunWorktreeSelection({
                                        mode: "new",
                                      });
                                    }
                                  }}
                                  onWorktreeSelectionChange={
                                    host.listWorktrees
                                      ? setNewRunWorktreeSelection
                                      : undefined
                                  }
                                  onNewNamedWorktree={
                                    host.listWorktrees
                                      ? () => {
                                          setNamedWorktreeName(
                                            newRunWorktreeSelection.mode ===
                                              "named"
                                              ? (newRunWorktreeSelection.name ??
                                                  "")
                                              : "",
                                          );
                                          setNamedWorktreeDialogOpen(true);
                                        }
                                      : undefined
                                  }
                                />
                              </RemoteWaitlistPopover>
                            )}
                            {overviewFooterSlot ? (
                              <div className="code-agents-overview-footer">
                                {overviewFooterSlot}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
      <Dialog
        open={Boolean(portalTransferRequest)}
        onOpenChange={(open) => {
          if (!open && !portalTransferBusy) setPortalTransferRequest(null);
        }}
      >
        <DialogContent aria-describedby="portal-transfer-description">
          <DialogTitle>
            {portalTransferRequest?.kind === "all"
              ? "Move local chats to Portal?"
              : "Move chat to Portal?"}
          </DialogTitle>
          <DialogDescription id="portal-transfer-description">
            {portalTransferRequest?.kind === "all"
              ? "Each local or worktree chat will move its code and full text context to the paired computer."
              : `Move ${portalTransferRequest?.title ?? "this chat"} with its code and full text context to the paired computer.`}
          </DialogDescription>
          <div className="code-agents-dialog-actions">
            <button
              type="button"
              className="code-agents-button"
              onClick={() => setPortalTransferRequest(null)}
              disabled={portalTransferBusy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="code-agents-button--primary"
              onClick={() => void confirmPortalTransfer()}
              disabled={portalTransferBusy}
            >
              {portalTransferBusy
                ? "Moving..."
                : portalTransferRequest?.kind === "all"
                  ? "Move all"
                  : "Move to Portal"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={namedWorktreeDialogOpen}
        onOpenChange={(open) => {
          if (!open) setNamedWorktreeDialogOpen(false);
        }}
      >
        <DialogContent className="code-agents-worktree-dialog">
          <DialogTitle>Name this worktree</DialogTitle>
          <DialogDescription>
            Reuse it from any chat for this folder.
          </DialogDescription>
          <input
            autoFocus
            className="code-agents-worktree-name-input"
            value={namedWorktreeName}
            maxLength={64}
            placeholder="e.g. redesign"
            aria-label="Worktree name"
            onChange={(event) => setNamedWorktreeName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                const name = namedWorktreeName.trim();
                if (!name) return;
                setNewRunWorktreeSelection({ mode: "named", name });
                setNamedWorktreeDialogOpen(false);
              }
            }}
          />
          <div className="code-agents-dialog-actions">
            <button
              type="button"
              className="code-agents-button"
              onClick={() => setNamedWorktreeDialogOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              disabled={!namedWorktreeName.trim()}
              onClick={() => {
                const name = namedWorktreeName.trim();
                if (!name) return;
                setNewRunWorktreeSelection({ mode: "named", name });
                setNamedWorktreeDialogOpen(false);
              }}
            >
              Use worktree
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(forkSourceRun)}
        onOpenChange={(open) => {
          if (!open && !forkBusy) setForkSourceRun(null);
        }}
      >
        <DialogContent className="code-agents-fork-dialog">
          <DialogTitle>Fork chat from here</DialogTitle>
          <DialogDescription>
            Start a new chat with this conversation’s context.
          </DialogDescription>
          <div className="code-agents-fork-options">
            <button
              type="button"
              className="code-agents-fork-option"
              disabled={forkBusy || !host.forkRun}
              onClick={() => void forkSelectedChat("local")}
            >
              <IconGitFork size={18} strokeWidth={1.8} />
              <span>Fork in this workspace</span>
            </button>
            <button
              type="button"
              className="code-agents-fork-option"
              disabled={forkBusy || !host.forkRun}
              onClick={() => void forkSelectedChat("worktree")}
            >
              <IconGitBranch size={18} strokeWidth={1.8} />
              <span>Fork in a new worktree</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <ComputerAccessDialog
        open={computerSetupOpen}
        onOpenChange={setComputerSetupOpen}
        metadata={hostMetadata}
        activeAction={computerSetupAction}
        accessibilityPrompted={accessibilityPrompted}
        screenRecordingPrompted={screenRecordingPrompted}
        restartRecommended={computerSetupRestartRecommended}
        onAction={runComputerSetupAction}
      />
    </section>
  );
}

function AgentCapabilitySummary({
  metadata,
  onOpenComputerSetup,
}: {
  metadata: CodeAgentHostMetadata | null;
  onOpenComputerSetup: () => void;
}) {
  const control = metadata?.computerControl;
  const desktopReady = Boolean(
    control?.available &&
    control.desktop.accessibility &&
    control.desktop.screenRecording === "granted",
  );
  const chromeReady = Boolean(
    control?.available &&
    control.browser.nativeHostInstalled &&
    control.browser.extensionBundled &&
    control.browser.connected,
  );
  return (
    <div
      className="code-agents-capabilities"
      aria-label="Agent capabilities"
      title="Auto can operate connected apps. Stop immediately releases control."
    >
      <span className="code-agents-capability code-agents-capability--ready">
        <IconCode size={13} strokeWidth={1.8} />
        Code ready
      </span>
      <button
        type="button"
        className={`code-agents-capability${chromeReady ? " code-agents-capability--ready" : ""}`}
        title={
          chromeReady
            ? "The Chrome extension is connected and ready."
            : "Load the bundled Chrome extension to enable browser control."
        }
        onClick={onOpenComputerSetup}
      >
        <IconBrandChrome size={13} strokeWidth={1.8} />
        {chromeReady ? "Chrome available" : "Chrome setup"}
      </button>
      <button
        type="button"
        className={`code-agents-capability${desktopReady ? " code-agents-capability--ready" : ""}`}
        title={
          desktopReady
            ? "Desktop Accessibility and Screen Recording permissions are ready."
            : "Enable Accessibility and Screen Recording for Agent Native in System Settings."
        }
        onClick={onOpenComputerSetup}
      >
        <IconDeviceDesktop size={13} strokeWidth={1.8} />
        {desktopReady ? "Desktop ready" : "Desktop setup"}
      </button>
    </div>
  );
}

function computerAccessReadiness(metadata: CodeAgentHostMetadata | null) {
  const control = metadata?.computerControl;
  const accessibilityReady = Boolean(control?.desktop.accessibility);
  const screenRecordingReady = control?.desktop.screenRecording === "granted";
  const chromeReady = Boolean(
    control?.browser.nativeHostInstalled &&
    control.browser.extensionBundled &&
    control.browser.connected,
  );
  return {
    accessibilityReady,
    screenRecordingReady,
    chromeReady,
    allReady: accessibilityReady && screenRecordingReady && chromeReady,
  };
}

function ComputerAccessDialog({
  open,
  onOpenChange,
  metadata,
  activeAction,
  accessibilityPrompted,
  screenRecordingPrompted,
  restartRecommended,
  onAction,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metadata: CodeAgentHostMetadata | null;
  activeAction: CodeAgentComputerSetupAction | null;
  accessibilityPrompted: boolean;
  screenRecordingPrompted: boolean;
  restartRecommended: boolean;
  onAction: (action: CodeAgentComputerSetupAction) => void;
}) {
  const readiness = computerAccessReadiness(metadata);
  const actionButton = (
    action: CodeAgentComputerSetupAction,
    label: string,
  ) => (
    <button
      type="button"
      className="code-agents-button code-agents-computer-step__action"
      disabled={Boolean(activeAction)}
      onClick={() => onAction(action)}
    >
      {activeAction === action && (
        <IconRefresh
          className="code-agents-spinner"
          size={14}
          strokeWidth={1.8}
        />
      )}
      {label}
    </button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby="computer-access-description">
        <div className="code-agents-computer-dialog__hero">
          <span className="code-agents-computer-dialog__hero-icon">
            <IconShieldCheck size={21} strokeWidth={1.7} />
          </span>
          <div>
            <DialogTitle>Computer access</DialogTitle>
            <DialogDescription id="computer-access-description">
              Agent Native only controls Chrome or your desktop while Agent is
              working. Stop releases control immediately.
            </DialogDescription>
          </div>
        </div>

        {readiness.allReady && (
          <div className="code-agents-computer-ready" role="status">
            <IconCheck size={17} strokeWidth={2} />
            <div>
              <strong>Computer access is ready</strong>
              <span>
                Chrome and desktop control are available in Auto mode.
              </span>
            </div>
          </div>
        )}

        <div className="code-agents-computer-steps">
          <ComputerAccessStep
            icon={<IconLockAccess size={18} strokeWidth={1.7} />}
            title="Accessibility"
            description="Lets the agent click, type, and use keyboard shortcuts."
            ready={readiness.accessibilityReady}
            action={
              readiness.accessibilityReady
                ? null
                : accessibilityPrompted
                  ? actionButton("open-accessibility-settings", "Open Settings")
                  : actionButton("request-accessibility", "Enable")
            }
          />
          <ComputerAccessStep
            icon={<IconScreenShare size={18} strokeWidth={1.7} />}
            title="Screen Recording"
            description="Lets the agent see what is on screen while it works."
            ready={readiness.screenRecordingReady}
            action={
              readiness.screenRecordingReady
                ? null
                : screenRecordingPrompted
                  ? actionButton(
                      "open-screen-recording-settings",
                      "Open Settings",
                    )
                  : actionButton("request-screen-recording", "Enable")
            }
          />
          <ComputerAccessStep
            icon={<IconBrandChrome size={18} strokeWidth={1.7} />}
            title="Chrome"
            description={
              readiness.chromeReady
                ? "The Agent Native extension is connected."
                : "Opens Chrome Extensions and reveals the bundled extension folder. Turn on Developer mode, choose Load unpacked, then select that folder."
            }
            ready={readiness.chromeReady}
            action={
              readiness.chromeReady
                ? null
                : actionButton("open-chrome-setup", "Open Chrome setup")
            }
          />
        </div>

        {restartRecommended &&
          (!readiness.accessibilityReady ||
            !readiness.screenRecordingReady) && (
            <div className="code-agents-computer-restart">
              <div>
                <strong>Changed a macOS permission?</strong>
                <span>
                  Restart once after enabling it so the new access takes effect.
                </span>
              </div>
              {actionButton("restart", "Restart Agent Native")}
            </div>
          )}
      </DialogContent>
    </Dialog>
  );
}

function ComputerAccessStep({
  icon,
  title,
  description,
  ready,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  ready: boolean;
  action: React.ReactNode;
}) {
  return (
    <div className="code-agents-computer-step">
      <span className="code-agents-computer-step__icon">{icon}</span>
      <div className="code-agents-computer-step__body">
        <div className="code-agents-computer-step__title-row">
          <strong>{title}</strong>
          <span
            className={`code-agents-computer-step__status${ready ? " code-agents-computer-step__status--ready" : ""}`}
          >
            {ready ? "Ready" : "Needs setup"}
          </span>
        </div>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function isMigrationRun(run: CodeAgentRun): run is CodeAgentMigrationRun {
  return (
    typeof (run as Partial<CodeAgentMigrationRun>).sourceRoot === "string" &&
    typeof (run as Partial<CodeAgentMigrationRun>).outputRoot === "string" &&
    typeof (run as Partial<CodeAgentMigrationRun>).target === "string" &&
    typeof (run as Partial<CodeAgentMigrationRun>).phase === "string"
  );
}

function ProjectFolderPicker({
  variant = "rail",
  projects,
  selectedPath,
  executionTarget = "local",
  worktreeSelection = { mode: "new" },
  namedWorktrees = [],
  namedWorktreesLoading = false,
  showExecutionTarget = false,
  loading,
  canChoose,
  onSelect,
  onChoose,
  onCloudSelect,
  onExecutionTargetChange,
  onWorktreeSelectionChange,
  onNewNamedWorktree,
}: {
  variant?: "rail" | "bar";
  projects: CodeAgentProjectFolder[];
  selectedPath: string;
  executionTarget?: CodeAgentExecutionTarget;
  worktreeSelection?: CodeAgentWorktreeSelection;
  namedWorktrees?: CodeAgentWorktreeSummary[];
  namedWorktreesLoading?: boolean;
  showExecutionTarget?: boolean;
  loading: boolean;
  canChoose: boolean;
  onSelect: (path: string) => void;
  onChoose: () => void;
  onCloudSelect?: () => void;
  onExecutionTargetChange?: (target: CodeAgentExecutionTarget) => void;
  onWorktreeSelectionChange?: (selection: CodeAgentWorktreeSelection) => void;
  onNewNamedWorktree?: () => void;
}) {
  const active = projects.find((project) => project.path === selectedPath);

  return (
    <div
      className={`code-agents-project-picker code-agents-project-picker--${variant}`}
    >
      <p className="code-agents-rail-label">Folder</p>
      <div className="code-agents-project-picker__row">
        <Select
          value={selectedPath || ""}
          disabled={loading || projects.length === 0}
          onValueChange={(value) => {
            if (value === "__choose__") {
              onChoose();
              return;
            }
            onSelect(value);
          }}
        >
          <SelectTrigger
            className="code-agents-project-select"
            aria-label="Select working folder"
          >
            <SelectValue
              placeholder={loading ? "Loading folders..." : "Choose folder"}
            />
          </SelectTrigger>
          <SelectContent className="code-agents-select-content">
            <SelectGroup>
              {projects.map((project) => (
                <SelectItem key={project.path} value={project.path}>
                  <span className="code-agents-project-select__item">
                    <IconFolder size={14} strokeWidth={1.8} />
                    <span>{project.name}</span>
                  </span>
                </SelectItem>
              ))}
              {canChoose && (
                <SelectItem value="__choose__">
                  <span className="code-agents-project-select__item">
                    <IconFolderPlus size={14} strokeWidth={1.8} />
                    <span>Add folder...</span>
                  </span>
                </SelectItem>
              )}
            </SelectGroup>
          </SelectContent>
        </Select>
        {showExecutionTarget && onExecutionTargetChange ? (
          <>
            <Select
              value={executionTarget}
              onValueChange={(value) => {
                if (value === "cloud") {
                  onCloudSelect?.();
                  return;
                }
                onExecutionTargetChange(value as CodeAgentExecutionTarget);
              }}
            >
              <SelectTrigger
                className="code-agents-project-select code-agents-execution-target-select"
                aria-label="Select workspace"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="code-agents-select-content">
                <SelectGroup>
                  <SelectItem
                    value="local"
                    description="Use the selected folder directly"
                  >
                    <span className="code-agents-project-select__item">
                      <IconDeviceDesktop size={14} strokeWidth={1.8} />
                      <span>Local</span>
                    </span>
                  </SelectItem>
                  <SelectItem
                    value="worktree"
                    description="Start an isolated copy from the latest commit"
                  >
                    <span className="code-agents-project-select__item">
                      <IconGitBranch size={14} strokeWidth={1.8} />
                      <span>Worktree</span>
                    </span>
                  </SelectItem>
                  <SelectItem
                    value="portal"
                    description="Continue on a paired computer"
                  >
                    <span className="code-agents-project-select__item">
                      <IconRoute size={14} strokeWidth={1.8} />
                      <span>Portal</span>
                    </span>
                  </SelectItem>
                  <SelectItem
                    value="cloud"
                    description="Run in the cloud - join the waitlist"
                  >
                    <span className="code-agents-project-select__item">
                      <IconCloud size={14} strokeWidth={1.8} />
                      <span>Cloud</span>
                    </span>
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            {executionTarget === "worktree" && onWorktreeSelectionChange ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="code-agents-worktree-options-trigger"
                    aria-label="Worktree options"
                    title="Worktree options"
                  >
                    <IconChevronDown size={13} strokeWidth={1.8} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={4}
                  className="code-agents-worktree-options-menu"
                >
                  <DropdownMenuItem
                    onSelect={() => onWorktreeSelectionChange({ mode: "new" })}
                  >
                    <IconGitBranch size={14} strokeWidth={1.8} />
                    <span>New worktree</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onNewNamedWorktree}>
                    <IconFolderPlus size={14} strokeWidth={1.8} />
                    <span>New named worktree</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <IconFolder size={14} strokeWidth={1.8} />
                      <span>Use named worktree</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      {namedWorktreesLoading ? (
                        <DropdownMenuItem disabled>
                          <span>Loading worktrees...</span>
                        </DropdownMenuItem>
                      ) : namedWorktrees.length === 0 ? (
                        <DropdownMenuItem disabled>
                          <span>No named worktrees yet</span>
                        </DropdownMenuItem>
                      ) : (
                        namedWorktrees.map((worktree) => (
                          <DropdownMenuItem
                            key={worktree.id}
                            onSelect={() =>
                              onWorktreeSelectionChange({
                                mode: "named",
                                name: worktree.name,
                              })
                            }
                            description={
                              worktree.state === "recoverable"
                                ? "Restore when used"
                                : undefined
                            }
                          >
                            <IconGitBranch size={14} strokeWidth={1.8} />
                            <span>{worktree.name}</span>
                          </DropdownMenuItem>
                        ))
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : null}
      </div>
      <p className="code-agents-project-path" title={active?.path}>
        {executionTarget === "portal"
          ? "Code is pushed to a paired computer before the run starts."
          : executionTarget === "worktree" &&
              worktreeSelection.mode === "named" &&
              worktreeSelection.name
            ? `Named worktree: ${worktreeSelection.name}`
            : (active?.path ??
              (executionTarget === "worktree"
                ? "A new isolated worktree will be created for this chat."
                : "Runs use the selected folder as cwd."))}
      </p>
    </div>
  );
}

function NewSessionComposer({
  prompt,
  promptSeed,
  inputRef,
  creating,
  terminalAgent,
  terminalModeControl,
  permissionMode,
  modelSelection,
  modelOptions,
  slashCommands,
  disabled,
  modeControl,
  useDefaultModeControl,
  showModelSelector,
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSlashCommand,
  onSubmit,
  onConnectProvider,
  onConnectLocalRuntime,
  onDisabledClick,
}: {
  prompt: string;
  promptSeed: number;
  inputRef: React.RefObject<TiptapComposerHandle | null>;
  creating: boolean;
  terminalAgent?: CodeAgentTerminalAgentOption;
  terminalModeControl?: ComposerTerminalModeControl;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  slashCommands: SlashCommand[];
  disabled?: boolean;
  modeControl?: React.ReactNode;
  useDefaultModeControl?: boolean;
  showModelSelector?: boolean;
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSlashCommand?: (command: string) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
  ) => void;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  onDisabledClick?: () => void;
}) {
  return (
    <CodeAgentComposer
      prompt={prompt}
      promptSeed={promptSeed}
      inputRef={inputRef}
      submitting={creating}
      terminalAgent={terminalAgent}
      terminalModeControl={terminalModeControl}
      permissionMode={permissionMode}
      modelSelection={modelSelection}
      modelOptions={modelOptions}
      slashCommands={slashCommands}
      placeholder="Describe a task or ask a question"
      variant="hero"
      disabled={disabled}
      modeControl={modeControl}
      useDefaultModeControl={useDefaultModeControl}
      showModelSelector={showModelSelector}
      onPromptChange={onPromptChange}
      onPermissionModeChange={onPermissionModeChange}
      onModelSelectionChange={onModelSelectionChange}
      onSlashCommand={onSlashCommand}
      onSubmit={onSubmit}
      onConnectProvider={onConnectProvider}
      onConnectLocalRuntime={onConnectLocalRuntime}
      onDisabledClick={onDisabledClick}
    />
  );
}

function CodeAgentComposer({
  prompt,
  promptSeed,
  inputRef,
  submitting,
  terminalAgent,
  permissionMode,
  modelSelection,
  modelOptions,
  slashCommands = [],
  placeholder,
  variant = "compact",
  disabled = false,
  stopActive = false,
  onPromptChange,
  onPermissionModeChange,
  onModelSelectionChange,
  onSlashCommand,
  onSubmit,
  onStop,
  onConnectProvider,
  onConnectLocalRuntime,
  onDisabledClick,
  modeControl: modeControlOverride,
  useDefaultModeControl = true,
  showModelSelector = true,
  terminalModeControl,
}: {
  prompt: string;
  promptSeed?: string | number;
  inputRef?: React.RefObject<TiptapComposerHandle | null>;
  submitting: boolean;
  terminalAgent?: CodeAgentTerminalAgentOption;
  terminalModeControl?: ComposerTerminalModeControl;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  slashCommands?: SlashCommand[];
  placeholder: string;
  variant?: "hero" | "compact";
  disabled?: boolean;
  stopActive?: boolean;
  onPromptChange: (value: string) => void;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onSlashCommand?: (command: string) => void;
  onSubmit: (
    preparedPrompt: string,
    attachments: CodeAgentPromptAttachment[],
    followUpMode?: CodeAgentFollowUpMode,
  ) => void;
  onStop?: () => void;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  onDisabledClick?: () => void;
  modeControl?: React.ReactNode;
  useDefaultModeControl?: boolean;
  showModelSelector?: boolean;
}) {
  const normalizedModel = normalizeModelSelection(modelSelection, modelOptions);
  const availableModels = groupCodeAgentModelOptions(modelOptions);
  const availableAgents = terminalAgent
    ? [terminalAgent]
    : showModelSelector
      ? getCodeAgentPickerOptions(modelOptions)
      : undefined;
  const selectedAgent =
    terminalAgent?.id ?? getCodeAgentIdForEngine(normalizedModel.engine);
  const handleAgentChange = useCallback(
    (agent: string) => {
      onModelSelectionChange(
        getCodeAgentSelection(agent, normalizedModel, modelOptions),
      );
    },
    [modelOptions, normalizedModel, onModelSelectionChange],
  );

  const readPromptFiles = useCallback(
    async (files: PromptComposerFile[]) =>
      Promise.all(files.map((file) => readAgentPromptAttachment(file))),
    [],
  );

  const modeControl = useDefaultModeControl ? (
    <RunModeSelect
      value={permissionMode}
      onChange={onPermissionModeChange}
      compact
    />
  ) : (
    modeControlOverride
  );

  const stopButton =
    stopActive && onStop ? (
      <button
        type="button"
        onClick={onStop}
        className="code-agents-composer-stop-button"
        aria-label="Stop response"
        title="Stop response (Esc)"
      >
        <IconPlayerStop size={14} strokeWidth={1.9} />
      </button>
    ) : undefined;

  return (
    <PromptComposer
      className="code-agents-standard-composer code-agents-composer-shell"
      style={codeAgentComposerAreaStyle}
      rootStyle={codeAgentComposerRootStyle}
      layoutVariant={variant}
      composerRef={inputRef}
      disabled={submitting || disabled}
      placeholder={placeholder}
      draftScope={
        variant === "hero"
          ? "agent-native-code:new-session"
          : "agent-native-code:follow-up"
      }
      initialText={
        promptSeed !== undefined && Number(promptSeed) > 0 ? prompt : undefined
      }
      initialTextKey={promptSeed}
      modeControl={modeControl}
      actionButton={stopButton}
      showModelSelector={showModelSelector}
      showAutoModelOption={false}
      availableModels={showModelSelector ? availableModels : undefined}
      availableAgents={availableAgents}
      selectedAgent={showModelSelector ? selectedAgent : undefined}
      agentOnly={Boolean(terminalAgent)}
      selectedModel={
        showModelSelector
          ? (normalizedModel.model ?? DEFAULT_CODE_AGENT_MODEL_OPTIONS[0].model)
          : undefined
      }
      selectedEngine={
        showModelSelector
          ? (normalizedModel.engine ??
            DEFAULT_CODE_AGENT_MODEL_OPTIONS[0].engine)
          : undefined
      }
      selectedEffort={showModelSelector ? normalizedModel.effort : undefined}
      onModelChange={(model, engine) =>
        onModelSelectionChange(
          isClaudeCodeAgentId(selectedAgent) && isLunaModel(model)
            ? getCodeAgentSelection(
                selectedAgent,
                normalizedModel,
                modelOptions,
              )
            : {
                engine,
                model,
                effort: normalizedModel.effort,
              },
        )
      }
      onAgentChange={
        terminalAgent || !showModelSelector ? undefined : handleAgentChange
      }
      onEffortChange={(effort) =>
        onModelSelectionChange({ ...normalizedModel, effort })
      }
      modelStatusChecksEnabled={false}
      onTextChange={onPromptChange}
      slashCommands={slashCommands}
      includeDefaultSlashSkills={false}
      onSlashCommand={onSlashCommand}
      onSubmit={async (text, files, _references, options) => {
        const attachments = await readPromptFiles(files);
        onSubmit(
          text,
          attachments,
          options.intent === "queued" ? "queued" : "immediate",
        );
      }}
      attachmentsEnabled
      plusMenuMode={
        terminalModeControl
          ? terminalModeControl.enabled
            ? "terminal"
            : "full"
          : terminalAgent
            ? "upload-only"
            : undefined
      }
      terminalModeControl={terminalModeControl}
      voiceEnabled
      preserveDraftOnSubmit={false}
      onConnectProvider={onConnectProvider}
      onConnectLocalRuntime={onConnectLocalRuntime}
      onDisabledClick={onDisabledClick}
    />
  );
}

function buildCodeAgentSlashCommands(
  pack: CodeAgentCodePack | null,
): SlashCommand[] {
  const commands: SlashCommand[] = [
    ...CODE_AGENT_GOALS.filter(
      (goal) => goal.id !== "task" && goal.slashCommand,
    ).map((goal) => ({
      name: goal.slashCommand.replace(/^\/+/, ""),
      description: goal.description,
      icon: "terminal",
    })),
  ];
  for (const command of pack?.commands ?? []) {
    if (command.reserved) continue;
    commands.push({
      name: command.name,
      description: command.description ?? "Project command",
      icon: "terminal",
    });
  }
  for (const skill of pack?.skills ?? []) {
    commands.push({
      name: skill.name,
      description: skill.description ?? "Project skill",
      icon: "skill",
    });
  }
  return commands;
}

function getProviderGate(metadata: CodeAgentHostMetadata | null): {
  blocked: boolean;
  description: string;
} {
  if (metadata?.llmProvider?.configured === false) {
    return {
      blocked: true,
      description: "Connect Builder.io or add custom keys to start coding.",
    };
  }
  return {
    blocked: false,
    description: "",
  };
}

function ProviderGateNotice({
  description,
  connecting,
  message,
  bouncePulse,
  onConnectBuilder,
  onOpenSettings,
  localRuntimeOptions,
  onConnectLocalRuntime,
}: {
  description: string;
  connecting: boolean;
  message: string | null;
  bouncePulse?: number;
  onConnectBuilder: () => void;
  onOpenSettings?: () => void;
  localRuntimeOptions?: Array<{
    engine: LocalRuntimeEngine;
    label: string;
  }>;
  onConnectLocalRuntime?: (engine: string) => void;
}) {
  return (
    <CodeProviderNotice
      className="code-agents-provider-gate"
      title="Connect a provider to chat"
      description={message ?? description}
      primaryActionLabel={connecting ? "Waiting..." : "Connect Builder.io"}
      primaryDisabled={connecting}
      onPrimaryAction={onConnectBuilder}
      bouncePulse={bouncePulse}
      localRuntimeOptions={localRuntimeOptions}
      onConnectLocalRuntime={onConnectLocalRuntime}
      secondaryActionLabel="Custom keys"
      onOpenSettings={onOpenSettings}
    />
  );
}

function LocalRuntimeIcon({ engine }: { engine: LocalRuntimeEngine }) {
  return engine === "codex-cli" ? (
    <IconBrandOpenai size={15} strokeWidth={1.7} aria-hidden="true" />
  ) : (
    <ClaudeMark size={15} />
  );
}

function ClaudeMark({ size }: { size: number }) {
  return (
    <svg
      aria-hidden="true"
      fill="currentColor"
      height={size}
      viewBox="0 0 100 100"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="m19.6 66.5 19.7-11 .3-1-.3-.5h-1l-3.3-.2-11.2-.3L14 53l-9.5-.5-2.4-.5L0 49l.2-1.5 2-1.3 2.9.2 6.3.5 9.5.6 6.9.4L38 49.1h1.6l.2-.7-.5-.4-.4-.4L29 41l-10.6-7-5.6-4.1-3-2-1.5-2-.6-4.2 2.7-3 3.7.3.9.2 3.7 2.9 8 6.1L37 36l1.5 1.2.6-.4.1-.3-.7-1.1L33 25l-6-10.4-2.7-4.3-.7-2.6c-.3-1-.4-2-.4-3l3-4.2L28 0l4.2.6L33.8 2l2.6 6 4.1 9.3L47 29.9l2 3.8 1 3.4.3 1h.7v-.5l.5-7.2 1-8.7 1-11.2.3-3.2 1.6-3.8 3-2L61 2.6l2 2.9-.3 1.8-1.1 7.7L59 27.1l-1.5 8.2h.9l1-1.1 4.1-5.4 6.9-8.6 3-3.5L77 13l2.3-1.8h4.3l3.1 4.7-1.4 4.9-4.4 5.6-3.7 4.7-5.3 7.1-3.2 5.7.3.4h.7l12-2.6 6.4-1.1 7.6-1.3 3.5 1.6.4 1.6-1.4 3.4-8.2 2-9.6 2-14.3 3.3-.2.1.2.3 6.4.6 2.8.2h6.8l12.6 1 3.3 2 1.9 2.7-.3 2-5.1 2.6-6.8-1.6-16-3.8-5.4-1.3h-.8v.4l4.6 4.5 8.3 7.5L89 80.1l.5 2.4-1.3 2-1.4-.2-9.2-7-3.6-3-8-6.8h-.5v.7l1.8 2.7 9.8 14.7.5 4.5-.7 1.4-2.6 1-2.7-.6-5.8-8-6-9-4.7-8.2-.5.4-2.9 30.2-1.3 1.5-3 1.2-2.5-2-1.4-3 1.4-6.2 1.6-8 1.3-6.4 1.2-7.9.7-2.6v-.2H49L43 72l-9 12.3-7.2 7.6-1.7.7-3-1.5.3-2.8L24 86l10-12.8 6-7.9 4-4.6-.1-.5h-.3L17.2 77.4l-4.7.6-2-2 .2-3 1-1 8-5.5Z" />
    </svg>
  );
}

function CodeProviderNotice({
  className,
  title,
  description,
  primaryActionLabel,
  primaryDisabled,
  onPrimaryAction,
  localRuntimeOptions = [],
  onConnectLocalRuntime,
  secondaryActionLabel,
  onOpenSettings,
  bouncePulse,
}: {
  className: string;
  title: string;
  description: string;
  primaryActionLabel?: string;
  primaryDisabled?: boolean;
  onPrimaryAction?: () => void;
  localRuntimeOptions?: Array<{
    engine: LocalRuntimeEngine;
    label: string;
  }>;
  onConnectLocalRuntime?: (engine: string) => void;
  secondaryActionLabel?: string;
  onOpenSettings?: () => void;
  bouncePulse?: number;
}) {
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bouncePulse) return;
    const element = noticeRef.current;
    if (!element) return;
    element.classList.remove("code-agents-provider-bounce");
    void element.offsetWidth;
    element.classList.add("code-agents-provider-bounce");
  }, [bouncePulse]);

  const showRuntimeMenu =
    localRuntimeOptions.length > 0 && Boolean(onConnectLocalRuntime);
  const customKeysLabel = secondaryActionLabel ?? "Custom keys";

  return (
    <div ref={noticeRef} className={className}>
      <IconAlertCircle size={16} strokeWidth={1.8} />
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <div className="code-agents-provider-actions">
        {onPrimaryAction && primaryActionLabel && (
          <button
            type="button"
            className="code-agents-button--primary"
            onClick={onPrimaryAction}
            disabled={primaryDisabled}
          >
            {primaryActionLabel}
          </button>
        )}
        {showRuntimeMenu ? (
          <DropdownMenu>
            <div className="code-agents-provider-runtime-split">
              <button
                type="button"
                className="code-agents-button code-agents-provider-runtime-main"
                onClick={() =>
                  onConnectLocalRuntime?.(localRuntimeOptions[0].engine)
                }
              >
                <LocalRuntimeIcon engine={localRuntimeOptions[0].engine} />
                <span>{localRuntimeOptions[0].label}</span>
              </button>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="code-agents-button code-agents-provider-runtime-chevron"
                  aria-label="More sign-in options"
                >
                  <IconChevronDown size={14} strokeWidth={1.8} />
                </button>
              </DropdownMenuTrigger>
            </div>
            <DropdownMenuContent
              align="end"
              className="code-agents-provider-menu"
            >
              {localRuntimeOptions.slice(1).map((option) => (
                <DropdownMenuItem
                  key={option.engine}
                  onSelect={() => onConnectLocalRuntime?.(option.engine)}
                >
                  <LocalRuntimeIcon engine={option.engine} />
                  <span>{option.label}</span>
                </DropdownMenuItem>
              ))}
              {onOpenSettings && (
                <DropdownMenuItem onSelect={onOpenSettings}>
                  <IconKey size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>{customKeysLabel}</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : onOpenSettings && customKeysLabel ? (
          <button
            type="button"
            className="code-agents-button"
            onClick={onOpenSettings}
          >
            {customKeysLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function normalizeModelSelection(
  value: CodeAgentModelSelection,
  models: CodeAgentModelOption[],
): CodeAgentModelSelection {
  const first = models[0] ?? DEFAULT_CODE_AGENT_MODEL_OPTIONS[0];
  const engineCandidates =
    value.engine === "claude-cli"
      ? models.filter(
          (model) => model.engine === value.engine && !isLunaModel(model.model),
        )
      : models;
  const selected =
    engineCandidates.find(
      (model) => model.engine === value.engine && model.model === value.model,
    ) ??
    (value.engine === "claude-cli"
      ? (engineCandidates.find(
          (model) =>
            model.configured !== false &&
            model.model.toLowerCase().includes("sonnet"),
        ) ??
        engineCandidates.find((model) => model.configured !== false) ??
        engineCandidates[0])
      : first) ??
    first;
  return {
    engine: selected.engine,
    model: selected.model,
    effort: normalizeReasoningEffort(value.effort ?? "high"),
  };
}

export function groupCodeAgentModelOptions(models: CodeAgentModelOption[]) {
  const groups = new Map<
    string,
    {
      engine: string;
      label: string;
      models: string[];
      configured: boolean;
      statusLabel?: string;
      isSubscription?: boolean;
    }
  >();
  for (const option of models) {
    const configured = option.configured !== false;
    const key = `${option.engine}:${configured ? "ready" : "setup"}`;
    const group = groups.get(key) ?? {
      engine: option.engine,
      label: option.engineLabel,
      models: [],
      configured,
      ...(option.statusLabel ? { statusLabel: option.statusLabel } : {}),
      ...(option.isSubscription ? { isSubscription: true } : {}),
    };
    if (!group.models.includes(option.model)) group.models.push(option.model);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function getCodeAgentPickerOptions(models: CodeAgentModelOption[]) {
  return CODE_AGENT_RUNTIME_OPTIONS.map((agent) => {
    if (agent.id === "default") {
      return { ...agent, configured: true };
    }

    const model = models.find(
      (option) =>
        option.engine === agent.engine &&
        (!isClaudeCodeAgentId(agent.id) || !isLunaModel(option.model)),
    );
    return {
      ...agent,
      configured: model !== undefined && model.configured !== false,
      statusLabel: model?.statusLabel ?? (model ? "Sign in" : "Not installed"),
    };
  });
}

export function getCodeAgentIdForEngine(engine: string | undefined): string {
  return (
    CODE_AGENT_RUNTIME_OPTIONS.find(
      (agent) => getCodeAgentEngine(agent.id) === engine,
    )?.id ?? "default"
  );
}

function getCodeAgentEngine(agentId: string): string | undefined {
  const agent = CODE_AGENT_RUNTIME_OPTIONS.find(
    (option) => option.id === agentId,
  );
  return agent && "engine" in agent ? agent.engine : undefined;
}

export function getCodeAgentSelection(
  agentId: string,
  current: CodeAgentModelSelection,
  models: CodeAgentModelOption[],
): CodeAgentModelSelection {
  const engine = getCodeAgentEngine(agentId);
  const candidates = models.filter((model) =>
    engine
      ? model.engine === engine
      : !CODE_AGENT_LOCAL_ENGINES.has(model.engine),
  );
  const eligibleCandidates = isClaudeCodeAgentId(agentId)
    ? candidates.filter((model) => !isLunaModel(model.model))
    : candidates;
  const preferredModel = resolvePreferredAgentModel(
    agentId,
    eligibleCandidates.map((model) => ({
      engine: model.engine,
      models: [model.model],
      configured: model.configured,
    })),
  )?.model;
  const option =
    eligibleCandidates.find(
      (model) => model.model === preferredModel && model.configured !== false,
    ) ??
    eligibleCandidates.find((model) => model.model === preferredModel) ??
    eligibleCandidates.find((model) => model.configured !== false) ??
    eligibleCandidates[0];
  if (!option) return current;
  return {
    engine: option.engine,
    model: option.model,
    effort: current.effort,
  };
}

function normalizeReasoningEffort(value: unknown): CodeAgentReasoningEffort {
  if (value === "auto") return "high";
  return CODE_AGENT_REASONING_EFFORTS.some((effort) => effort.id === value)
    ? (value as CodeAgentReasoningEffort)
    : "high";
}

export function readCodeAgentModelSelection(): CodeAgentModelSelection {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(CODE_AGENT_MODEL_SELECTION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      engine: typeof parsed.engine === "string" ? parsed.engine : undefined,
      model: typeof parsed.model === "string" ? parsed.model : undefined,
      effort: normalizeReasoningEffort(parsed.effort),
    };
  } catch {
    return {};
  }
}

export function writeCodeAgentModelSelection(
  value: CodeAgentModelSelection,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_AGENT_MODEL_SELECTION_KEY,
      JSON.stringify(value),
    );
  } catch {
    // Ignore private-mode storage failures.
  }
}

function readStoredUnreadRunIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(CODE_AGENT_UNREAD_RUN_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed
      : parsed &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { ids?: unknown }).ids)
        ? (parsed as { ids: unknown[] }).ids
        : [];
    return new Set(ids.filter((id): id is string => typeof id === "string"));
  } catch {
    // An unread marker is advisory; unreadable local state must not create
    // dozens of false-positive attention indicators.
    return new Set();
  }
}

function writeStoredUnreadRunIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      CODE_AGENT_UNREAD_RUN_IDS_KEY,
      JSON.stringify({ version: 1, ids: [...ids].slice(-1000) }),
    );
  } catch {
    // Ignore private-mode storage failures.
  }
}

function RunModeSelect({
  value,
  onChange,
  disabled = false,
  title = "Mode",
  compact = false,
}: {
  value: CodeAgentPermissionMode;
  onChange: (value: CodeAgentPermissionMode) => void;
  disabled?: boolean;
  title?: string;
  compact?: boolean;
}) {
  const selectedMode = runModeFromPermissionMode(value);
  const selected = getRunModeDefinition(selectedMode);
  return (
    <fieldset
      className={`code-agents-permission${
        compact ? " code-agents-permission--compact" : ""
      }`}
    >
      {!compact && (
        <legend className="code-agents-permission__header">
          <span>{title}</span>
          <em>{selected.description}</em>
        </legend>
      )}
      <Select
        value={selectedMode}
        disabled={disabled}
        onValueChange={(nextMode) =>
          onChange(permissionModeFromRunMode(nextMode))
        }
      >
        <SelectTrigger
          className="code-agents-mode-select"
          aria-label={title}
          title={selected.description}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="code-agents-mode-menu">
          <SelectGroup>
            {CODE_AGENT_RUN_MODES.map((mode) => (
              <SelectItem
                key={mode.id}
                value={mode.id}
                description={mode.description}
              >
                {mode.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </fieldset>
  );
}

function runModeFromPermissionMode(
  permissionMode: CodeAgentPermissionMode,
): CodeAgentRunMode {
  return permissionMode === "read-only" ? "plan" : "auto";
}

function permissionModeFromRunMode(value: string): CodeAgentPermissionMode {
  return value === "plan" ? "read-only" : "full-auto";
}

function getRunModeDefinition(mode: CodeAgentRunMode) {
  return (
    CODE_AGENT_RUN_MODES.find((definition) => definition.id === mode) ??
    CODE_AGENT_RUN_MODES[1]
  );
}

function NativeGoalSurface({
  goal,
  onOpenTerminal,
}: {
  goal: CodeAgentGoalDefinition;
  onOpenTerminal?: () => void;
}) {
  return (
    <div className="code-agents-native-surface">
      <div className="code-agents-detail code-agents-detail--empty">
        <IconCode size={30} strokeWidth={1.5} />
        <h3>{goal.label}</h3>
        <p>{goal.description}</p>
        <div className="code-agents-command-line">
          {exampleCommandForGoal(goal)}
        </div>
        {onOpenTerminal && (
          <button
            type="button"
            className="code-agents-button code-agents-button--primary"
            onClick={onOpenTerminal}
          >
            <IconTerminal2 size={14} strokeWidth={1.8} />
            Open Terminal
          </button>
        )}
      </div>
    </div>
  );
}

function exampleCommandForGoal(goal: CodeAgentGoalDefinition): string {
  if (goal.id === "task") {
    return 'agent-native code "Implement the settings polish"';
  }
  if (goal.id === "migrate") {
    return "agent-native code /migrate ./legacy-app --out ../migrated-app";
  }
  return `agent-native code ${goal.slashCommand} --url https://example.com`;
}

function normalizePromptForSelectedGoal(
  goal: CodeAgentGoalDefinition,
  prompt: string,
): string {
  const trimmed = prompt.trim();
  if (!trimmed || goal.id === "task") return trimmed;
  if (trimmed.startsWith(goal.slashCommand)) return trimmed;
  return `${goal.slashCommand} ${trimmed}`.trim();
}

function isRunActive(run: CodeAgentRun): boolean {
  return isCodeAgentRunActive(run);
}

export function findRunsThatBecameUnread(
  previousRuns: readonly CodeAgentRun[] | undefined,
  nextRuns: readonly CodeAgentRun[],
  selectedRunId?: string | null,
): string[] {
  if (!previousRuns) return [];
  const previousById = new Map(previousRuns.map((run) => [run.id, run]));
  return nextRuns
    .filter((run) => {
      const previous = previousById.get(run.id);
      return (
        previous !== undefined &&
        isRunActive(previous) &&
        !isRunActive(run) &&
        run.id !== selectedRunId
      );
    })
    .map((run) => run.id);
}

function areCodeAgentRunListsEqual(
  current: CodeAgentRun[],
  next: CodeAgentRun[],
): boolean {
  return (
    current.length === next.length &&
    current.every(
      (run, index) => JSON.stringify(run) === JSON.stringify(next[index]),
    )
  );
}

function sortRunsForRail(runs: CodeAgentRun[]): CodeAgentRun[] {
  const pinned = sortPinnedRuns(runs.filter(isRunPinned));
  const unpinned = [...runs]
    .filter((run) => !isRunPinned(run))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...pinned, ...unpinned];
}

function buildSearchRunResults(
  runs: CodeAgentRun[],
  query: string,
  transcriptCache: Map<string, CodeAgentTranscriptEvent[]>,
): CodeAgentSearchResult[] {
  const tokens = getSearchTokens(query);
  const sortedRuns = sortRunsForRail(runs);
  if (tokens.length === 0) {
    return sortedRuns.map((run, index) => ({
      run,
      match: getRunSubtitle(run),
      matchType: "Recent",
      rank: index,
    }));
  }

  return sortedRuns
    .flatMap((run): CodeAgentSearchResult[] => {
      const runText = getRunSearchText(run);
      const sessionMatch = textMatchesSearch(runText, tokens);
      const transcriptMatch = findTranscriptSearchMatch(
        transcriptCache.get(run.id) ?? [],
        tokens,
      );

      if (!sessionMatch && !transcriptMatch) return [];

      const title = getRunTitle(run) ?? "";
      const titleMatch = textMatchesSearch(title, tokens);
      return [
        {
          run,
          match: transcriptMatch ?? getSearchMatchSnippet(runText, tokens),
          matchType: transcriptMatch ? "Transcript" : "Chat",
          rank: titleMatch ? 0 : sessionMatch ? 1 : 2,
        },
      ];
    })
    .sort(
      (a, b) =>
        a.rank - b.rank || b.run.updatedAt.localeCompare(a.run.updatedAt),
    );
}

function getSearchTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function textMatchesSearch(text: string, tokens: string[]): boolean {
  const normalized = normalizeSearchText(text);
  return tokens.every((token) => normalized.includes(token));
}

function getRunSearchText(run: CodeAgentRun): string {
  const details =
    run.details?.map((detail) => `${detail.label} ${detail.value}`).join(" ") ??
    "";
  const metadata = run.metadata
    ? Object.values(run.metadata)
        .filter(
          (value) =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean",
        )
        .join(" ")
    : "";
  const goalLabel = getCodeAgentGoal(run.goalId)?.label ?? run.goalId;
  return [
    run.id,
    run.title,
    run.subtitle,
    run.source,
    run.sourceLabel,
    run.kind,
    run.status,
    run.phase,
    goalLabel,
    details,
    metadata,
  ]
    .filter(Boolean)
    .join(" ");
}

function findTranscriptSearchMatch(
  events: CodeAgentTranscriptEvent[],
  tokens: string[],
): string | null {
  const event = events.find((item) => textMatchesSearch(item.text, tokens));
  return event ? getSearchMatchSnippet(event.text, tokens) : null;
}

function mergeTranscriptEvents(
  current: CodeAgentTranscriptEvent[],
  incoming: CodeAgentTranscriptEvent[],
): CodeAgentTranscriptEvent[] {
  return mergeCodeAgentTranscriptEvents(current, incoming);
}

function getSearchMatchSnippet(text: string, tokens: string[]): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (!compact) return "";
  const lower = compact.toLowerCase();
  const firstMatch = tokens
    .map((token) => lower.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const anchor = firstMatch ?? 0;
  const start = Math.max(0, anchor - 44);
  const end = Math.min(compact.length, anchor + 136);
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${
    end < compact.length ? "..." : ""
  }`;
}

function normalizeSearchText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ");
}

function getSearchResultMeta(run: CodeAgentRun): string {
  return [
    getCodeAgentGoal(run.goalId)?.label,
    getRunSourceLabel(run),
    getRunStatusText(run),
  ]
    .filter(Boolean)
    .join(" · ");
}

function getRunStatusText(run: CodeAgentRun): string {
  if (run.status === "completed" || run.phase === "complete") return "Done";
  if (run.phase === "missing-credentials") return "Needs provider";
  if (hasPendingApproval(run)) return "Approval needed";
  if (run.status === "paused" || run.phase === "paused") return "Paused";
  if (run.phase === "stopped") return "Stopped";
  if (isRunActive(run)) return "Running";
  return run.phase ?? run.status;
}

function SearchChatsPanel({
  query,
  results,
  totalRuns,
  loading,
  transcriptLoading,
  error,
  inputRef,
  onQueryChange,
  onSelectRun,
  onRefresh,
}: {
  query: string;
  results: CodeAgentSearchResult[];
  totalRuns: number;
  loading: boolean;
  transcriptLoading: boolean;
  error: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onSelectRun: (run: CodeAgentRun) => void;
  onRefresh: () => void;
}) {
  const hasQuery = query.trim().length > 0;
  const statusText = loading
    ? "Loading chats..."
    : transcriptLoading && hasQuery
      ? "Searching transcripts..."
      : hasQuery
        ? `${results.length} matches`
        : `${Math.min(results.length, totalRuns)} recent chats`;
  const historyItems = useMemo<ChatHistoryItem[]>(
    () =>
      results.map((result) => ({
        id: result.run.id,
        title: getRunTitle(result.run),
        timestamp: formatRelativeTime(result.run.updatedAt),
        subtitle: (
          <span className="code-agents-search-result__meta">
            <span>{result.matchType}</span>
            <span>{getSearchResultMeta(result.run)}</span>
          </span>
        ),
        detail: result.match,
      })),
    [results],
  );

  return (
    <div className="code-agents-search-panel">
      <div className="code-agents-search-header">
        <div>
          <p className="code-agents-kicker">Search</p>
          <h2>Search chats</h2>
        </div>
        <button
          type="button"
          className="code-agents-button"
          onClick={onRefresh}
          disabled={loading}
        >
          <IconRefresh size={14} strokeWidth={1.8} />
          Refresh
        </button>
      </div>

      <label className="code-agents-search-box">
        <IconSearch size={16} strokeWidth={1.8} />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search chats"
          aria-label="Search chats"
        />
      </label>

      <div className="code-agents-search-meta">
        <span>{statusText}</span>
        {totalRuns > 0 && <span>{totalRuns} total</span>}
      </div>

      {error && (
        <div className="code-agents-transcript__error">
          <IconAlertCircle size={15} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}

      <div className="code-agents-search-results">
        {loading && results.length === 0 ? (
          <>
            <div className="code-agents-run-skeleton" />
            <div className="code-agents-run-skeleton" />
            <div className="code-agents-run-skeleton" />
          </>
        ) : (
          <ChatHistoryList
            items={historyItems}
            searchValue={query}
            onSelect={(id) => {
              const result = results.find((item) => item.run.id === id);
              if (result) onSelectRun(result.run);
            }}
            emptyLabel={
              <div className="code-agents-detail code-agents-detail--empty">
                <IconSearch size={30} strokeWidth={1.5} />
                <h3>No chats yet</h3>
                <p>Start a chat and it will show up here.</p>
              </div>
            }
            emptySearchLabel={
              <div className="code-agents-detail code-agents-detail--empty">
                <IconSearch size={30} strokeWidth={1.5} />
                <h3>No chats found</h3>
                <p>
                  Try a title, folder, command, or phrase from the conversation.
                </p>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function mobileConnectorCopy(
  status: CodeAgentRemoteConnectorStatus | null,
  error: string | null,
): {
  description: string;
  tone: "connected" | "pending" | "idle" | "attention";
} {
  if (error) {
    return { description: "Mobile setup needs attention", tone: "attention" };
  }
  if (!status) {
    return {
      description: "Checking mobile setup",
      tone: "pending",
    };
  }
  if (!status.configured) {
    return {
      description: "Set up mobile pairing",
      tone: "idle",
    };
  }
  if (!status.enabled) {
    return {
      description: "Mobile pairing is paused",
      tone: "idle",
    };
  }
  if (status.state === "error") {
    return {
      description: "Mobile setup needs attention",
      tone: "attention",
    };
  }
  if (status.state === "running") {
    return {
      description: `Mobile connected through ${hostForDisplay(status.relayUrl)}`,
      tone: "connected",
    };
  }
  if (status.state === "starting") {
    return {
      description: "Connecting mobile",
      tone: "pending",
    };
  }
  return {
    description: "Set up mobile pairing",
    tone: "idle",
  };
}

function hostForDisplay(url: string | undefined): string {
  if (!url) return "relay";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function mobileDeepLinkForRelay(
  relayUrl: string,
  platform: "ios" | "android",
): string {
  const url = relayUrl || DEFAULT_REMOTE_RELAY_URL;
  return `agentnative:///sessions?relayUrl=${encodeURIComponent(
    url,
  )}&platform=${platform}`;
}

function connectorStatusTitle(
  status: CodeAgentRemoteConnectorStatus | null,
  error: string | null,
): string {
  if (error || status?.state === "error") return "Needs attention";
  if (!status) return "Checking connector";
  if (!status.configured) return "Pair this Mac";
  if (!status.enabled) return "Pairing paused";
  if (status.state === "running") return "Connected";
  if (status.state === "starting") return "Connecting";
  return "Ready to pair";
}

function MobileConnectorPanel({
  status,
  error,
  message,
  relayUrl,
  brandIconUrl,
  pairing,
  updating,
  canPair,
  canToggle,
  onPair,
  onSetEnabled,
  onRefresh,
  onCopyLink,
  onOpenSettings,
}: {
  status: CodeAgentRemoteConnectorStatus | null;
  error: string | null;
  message: string | null;
  relayUrl: string;
  brandIconUrl?: string;
  pairing: boolean;
  updating: boolean;
  canPair: boolean;
  canToggle: boolean;
  onPair: (relayUrl: string) => Promise<void>;
  onSetEnabled: (enabled: boolean) => Promise<void>;
  onRefresh: () => Promise<void>;
  onCopyLink: (link: string) => Promise<void>;
  onOpenSettings?: () => void;
}) {
  const [platform, setPlatform] = useState<"ios" | "android">("ios");
  const copy = mobileConnectorCopy(status, error);
  const mobileLink = mobileDeepLinkForRelay(relayUrl, platform);
  const needsPairing =
    !status?.configured || Boolean(error) || status?.state === "error";
  const paused = Boolean(status?.configured && !status.enabled);
  const busy = pairing || updating;
  const primaryLabel = needsPairing
    ? pairing
      ? "Pairing..."
      : "Pair this Mac"
    : paused
      ? updating
        ? "Turning on..."
        : "Resume pairing"
      : "Copy mobile link";
  const primaryDisabled =
    busy || !relayUrl || (needsPairing && !canPair) || (paused && !canToggle);
  const statusMessage = error ?? status?.error ?? message;
  const statusTitle = connectorStatusTitle(status, error);

  function handlePrimaryAction() {
    if (needsPairing) {
      void onPair(relayUrl);
      return;
    }
    if (paused) {
      void onSetEnabled(true);
      return;
    }
    void onCopyLink(mobileLink);
  }

  return (
    <section className="code-agents-mobile-panel" aria-label="Mobile pairing">
      <div className="code-agents-mobile-panel__header">
        <p className="code-agents-mobile-panel__eyebrow">
          <IconQrcode size={15} strokeWidth={1.8} />
          Mobile
        </p>
        <h2>Agent Native mobile</h2>
        <p>
          Scan the QR code to open chats on your phone, then pair this Mac to
          start and continue local Agent work from mobile.
        </p>
      </div>

      <div className="code-agents-mobile-panel__layout">
        <div className="code-agents-mobile-qr-card">
          <div
            className="code-agents-mobile-platform-tabs"
            role="tablist"
            aria-label="Mobile platform"
          >
            <button
              type="button"
              role="tab"
              aria-selected={platform === "ios"}
              className={
                platform === "ios"
                  ? "code-agents-mobile-platform-tab code-agents-mobile-platform-tab--active"
                  : "code-agents-mobile-platform-tab"
              }
              onClick={() => setPlatform("ios")}
            >
              iOS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={platform === "android"}
              className={
                platform === "android"
                  ? "code-agents-mobile-platform-tab code-agents-mobile-platform-tab--active"
                  : "code-agents-mobile-platform-tab"
              }
              onClick={() => setPlatform("android")}
            >
              Android
            </button>
          </div>

          <div className="code-agents-mobile-qr-shell">
            <QRCodeSVG
              value={mobileLink}
              size={224}
              level="H"
              marginSize={3}
              title="Open Agent Native mobile chats"
              bgColor="#ffffff"
              fgColor="#111111"
            />
            {brandIconUrl && (
              <span className="code-agents-mobile-qr-badge" aria-hidden="true">
                <img src={brandIconUrl} alt="" />
              </span>
            )}
          </div>

          <div className="code-agents-mobile-link-row">
            <IconLink size={14} strokeWidth={1.8} />
            <span>{hostForDisplay(relayUrl)}</span>
          </div>
        </div>

        <div className="code-agents-mobile-side">
          <div
            className={`code-agents-mobile-status-card code-agents-mobile-status-card--${copy.tone}`}
          >
            <span
              className={`code-agents-mobile-indicator code-agents-mobile-indicator--${copy.tone}`}
              aria-hidden="true"
            />
            <div>
              <strong>{statusTitle}</strong>
              <span>{copy.description}</span>
            </div>
          </div>

          {statusMessage && (
            <div className="code-agents-mobile-message">{statusMessage}</div>
          )}

          <div className="code-agents-mobile-actions">
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              disabled={primaryDisabled}
              onClick={handlePrimaryAction}
            >
              {needsPairing ? (
                <IconDeviceMobile size={14} strokeWidth={1.8} />
              ) : paused ? (
                <IconCheck size={14} strokeWidth={1.8} />
              ) : (
                <IconCopy size={14} strokeWidth={1.8} />
              )}
              {primaryLabel}
            </button>
            <button
              type="button"
              className="code-agents-button"
              onClick={() => void onRefresh()}
            >
              <IconRefresh size={14} strokeWidth={1.8} />
              Refresh
            </button>
            {onOpenSettings && (
              <button
                type="button"
                className="code-agents-button"
                onClick={onOpenSettings}
              >
                <IconSettings size={14} strokeWidth={1.8} />
                Manage
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function RunDetailCard({
  host,
  run,
  selectedRunId,
  goal,
  transcriptEvents,
  transcriptLoading,
  transcriptError,
  permissionMode,
  modelSelection,
  modelOptions,
  onPermissionModeChange,
  onModelSelectionChange,
  onStop,
  onApprove,
  onApproveAlways,
  onDeny,
  providerBlocked,
  builderConnecting,
  builderConnectMessage,
  onConnectBuilder,
  onOpenSettings,
  onConnectProvider,
  onConnectLocalRuntime,
  onOpenRun,
  onForkChat,
  onRestoreWorktree,
  restoringWorktreeId,
}: {
  host: CodeAgentsHost;
  run: CodeAgentRun | null;
  selectedRunId: string | null;
  goal: CodeAgentGoalDefinition;
  transcriptEvents: CodeAgentTranscriptEvent[];
  transcriptLoading: boolean;
  transcriptError: string | null;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onStop: () => void;
  onApprove: () => void;
  onApproveAlways: () => void;
  onDeny: () => void;
  providerBlocked: boolean;
  builderConnecting: boolean;
  builderConnectMessage: string | null;
  onConnectBuilder: () => void;
  onOpenSettings?: () => void;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  onOpenRun?: (runId: string) => void;
  onForkChat?: () => void;
  onRestoreWorktree?: (worktreeId: string, runId: string) => void;
  restoringWorktreeId?: string | null;
}) {
  const runIsActive = run ? isRunActive(run) : false;

  useEffect(() => {
    if (!runIsActive) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onStop();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onStop, runIsActive]);

  if (!run) {
    return (
      <div className="code-agents-detail code-agents-detail--empty">
        <IconRoute size={30} strokeWidth={1.5} />
        <h3>{selectedRunId ? "Chat link ready" : "No chat selected"}</h3>
        <p>
          {selectedRunId
            ? `Open ${goal.surfaceLabel} to load the linked chat.`
            : "Start a new chat or choose one from the rail."}
        </p>
      </div>
    );
  }

  const hasCredentialHistory = hasMissingCredentialSignal(
    run,
    transcriptEvents,
  );
  const hasCredentialGap = providerBlocked && hasCredentialHistory;
  const pendingApproval = hasCredentialGap ? null : getPendingApproval(run);
  // The inline per-tool-call approval affordance (rendered by AssistantChat /
  // ToolCallDisplay via the tool-call's `approval` field) already covers this
  // pending approval when the transcript join succeeds. Keep this standalone
  // banner only as a fallback for transcripts where that join is missing
  // (legacy runs, or a pending approval whose bash result isn't present in
  // the rendered window) so the two affordances don't double up.
  const hasInlineApprovalAffordance = pendingApproval
    ? codeAgentTranscriptHasPendingApproval(transcriptEvents)
    : false;
  const showApprovalBanner =
    Boolean(pendingApproval) && !hasInlineApprovalAffordance;
  const runWorktree = isObjectRecord(run.metadata?.worktree)
    ? run.metadata.worktree
    : undefined;
  const worktreeCleanupError = firstRecordString(runWorktree?.lastCleanupError);
  const {
    wasPreserved: worktreeWasPreserved,
    needsRecovery: worktreeNeedsRecovery,
    needsNotice: worktreeNeedsNotice,
  } = getCodeAgentWorktreeRecoveryState(runWorktree);
  const worktreeId = firstRecordString(runWorktree?.id);

  return (
    <div className="code-agents-detail code-agents-detail--chat">
      {hasCredentialGap && (
        <CodeProviderNotice
          className="code-agents-credential-callout"
          title="Provider needed"
          description={
            builderConnectMessage ??
            "Connect Builder.io or add custom keys to continue coding."
          }
          primaryActionLabel={
            builderConnecting ? "Waiting..." : "Connect Builder.io"
          }
          primaryDisabled={builderConnecting}
          onPrimaryAction={onConnectBuilder}
          localRuntimeOptions={getLocalRuntimeOptions(modelOptions)}
          onConnectLocalRuntime={onConnectLocalRuntime}
          secondaryActionLabel="Custom keys"
          onOpenSettings={onOpenSettings}
        />
      )}

      {showApprovalBanner && pendingApproval && (
        <div className="code-agents-approval-callout">
          <IconAlertCircle size={16} strokeWidth={1.8} />
          <div>
            <strong>Approval pending</strong>
            <span>{pendingApproval.reason}</span>
            {pendingApproval.command && <code>{pendingApproval.command}</code>}
          </div>
          <div className="code-agents-approval-actions">
            <button
              type="button"
              className="code-agents-button code-agents-button--ghost code-agents-button--danger"
              onClick={onDeny}
              title="Deny — model will adapt its plan"
            >
              <IconBan size={14} strokeWidth={1.8} />
              Deny
            </button>
            <button
              type="button"
              className="code-agents-button"
              onClick={onApproveAlways}
              title="Approve and always allow this exact command"
            >
              <IconShieldCheck size={14} strokeWidth={1.8} />
              Always allow
            </button>
            <button
              type="button"
              className="code-agents-button code-agents-button--primary"
              onClick={onApprove}
            >
              <IconPlayerPlay size={14} strokeWidth={1.8} />
              Approve
            </button>
          </div>
        </div>
      )}

      {worktreeNeedsNotice && (
        <div className="code-agents-worktree-recovery" role="status">
          <div className="code-agents-worktree-recovery__copy">
            <IconAlertCircle size={16} strokeWidth={1.8} />
            <span>
              <strong>
                {worktreeWasPreserved
                  ? "Worktree kept for recovery"
                  : "Worktree cleaned up"}
              </strong>
              <small>
                {worktreeWasPreserved
                  ? worktreeCleanupError
                  : "This chat’s files were removed to save disk space."}
              </small>
            </span>
          </div>
          {worktreeNeedsRecovery && worktreeId && onRestoreWorktree ? (
            <button
              type="button"
              className="code-agents-button"
              disabled={restoringWorktreeId === worktreeId}
              onClick={() => onRestoreWorktree(worktreeId, run.id)}
            >
              <IconRestore size={14} strokeWidth={1.8} />
              {restoringWorktreeId === worktreeId
                ? "Restoring..."
                : "Restore worktree"}
            </button>
          ) : null}
        </div>
      )}

      <TranscriptPanel
        host={host}
        goal={goal}
        run={run}
        events={transcriptEvents}
        loading={transcriptLoading}
        error={transcriptError}
        runIsActive={runIsActive}
        permissionMode={permissionMode}
        modelSelection={modelSelection}
        modelOptions={modelOptions}
        hideCredentialMessages={hasCredentialHistory}
        onPermissionModeChange={onPermissionModeChange}
        onModelSelectionChange={onModelSelectionChange}
        onStop={onStop}
        onDeny={onDeny}
        onApproveAlways={onApproveAlways}
        onConnectProvider={onConnectProvider}
        onConnectLocalRuntime={onConnectLocalRuntime}
        onOpenRun={onOpenRun}
        onForkChat={onForkChat}
      />
    </div>
  );
}

function TranscriptPanel({
  host,
  goal,
  run,
  events,
  loading,
  error,
  runIsActive,
  permissionMode,
  modelSelection,
  modelOptions,
  hideCredentialMessages = false,
  onPermissionModeChange,
  onModelSelectionChange,
  onStop,
  onDeny,
  onApproveAlways,
  onConnectProvider,
  onConnectLocalRuntime,
  onOpenRun,
  onForkChat,
}: {
  host: CodeAgentsHost;
  goal: CodeAgentGoalDefinition;
  run: CodeAgentRun;
  events: CodeAgentTranscriptEvent[];
  loading: boolean;
  error: string | null;
  runIsActive: boolean;
  permissionMode: CodeAgentPermissionMode;
  modelSelection: CodeAgentModelSelection;
  modelOptions: CodeAgentModelOption[];
  hideCredentialMessages?: boolean;
  onPermissionModeChange: (value: CodeAgentPermissionMode) => void;
  onModelSelectionChange: (value: CodeAgentModelSelection) => void;
  onStop: () => void;
  /** Resolves the run's pending approval as denied — same command the standalone approval banner uses. */
  onDeny?: () => void;
  /** Resolves the run's pending approval as approved and allowlists the exact command — same command the banner uses. */
  onApproveAlways?: () => void;
  onConnectProvider?: () => void;
  onConnectLocalRuntime?: (engine: string) => void;
  onOpenRun?: (runId: string) => void;
  onForkChat?: () => void;
}) {
  const normalizedModel = normalizeModelSelection(modelSelection, modelOptions);
  const selectedModel =
    normalizedModel.model ?? DEFAULT_CODE_AGENT_MODEL_OPTIONS[0].model;
  const selectedEngine =
    normalizedModel.engine ?? DEFAULT_CODE_AGENT_MODEL_OPTIONS[0].engine;
  const selectedEffort = normalizeReasoningEffort(
    normalizedModel.effort ?? "high",
  );
  const availableModels = groupCodeAgentModelOptions(modelOptions);
  const availableAgents = getCodeAgentPickerOptions(modelOptions);
  const selectedAgent = getCodeAgentIdForEngine(selectedEngine);
  const handleAgentChange = useCallback(
    (agent: string) => {
      onModelSelectionChange(
        getCodeAgentSelection(agent, normalizedModel, modelOptions),
      );
    },
    [modelOptions, normalizedModel, onModelSelectionChange],
  );
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const hideCredentialMessagesRef = useRef(hideCredentialMessages);
  hideCredentialMessagesRef.current = hideCredentialMessages;
  const runIdRef = useRef<string | null>(run.id);
  runIdRef.current = run.id;
  const permissionModeRef = useRef<string | undefined>(permissionMode);
  permissionModeRef.current = permissionMode;
  const modelRef = useRef<string | undefined>(selectedModel);
  modelRef.current = selectedModel;
  const engineRef = useRef<string | undefined>(selectedEngine);
  engineRef.current = selectedEngine;
  const effortRef = useRef<CodeAgentReasoningEffort | undefined>(
    selectedEffort,
  );
  effortRef.current = selectedEffort;
  const followUpModeRef = useRef<CodeAgentFollowUpMode | undefined>(undefined);
  const attachOnlyRef = useRef(false);
  attachOnlyRef.current = false;

  const controller = useMemo(
    () => createHostCodeAgentChatController(host, goal.id, permissionModeRef),
    [goal.id, host],
  );
  const createAdapter = useCallback(
    () =>
      createCodeAgentChatAdapter({
        controller,
        runIdRef,
        permissionModeRef,
        modelRef,
        engineRef,
        effortRef,
        followUpModeRef,
        attachOnlyRef,
        tabId: `code-agent:${run.id}`,
      }),
    [controller, run.id],
  );
  const loadHistoryRepository = useCallback(async () => {
    const eventsToRender = hideCredentialMessagesRef.current
      ? eventsRef.current.filter((event) => !isCredentialTranscriptEvent(event))
      : eventsRef.current;
    return buildRepositoryFromCodeAgentTranscript(eventsToRender, {
      hideCredentialMessages: hideCredentialMessagesRef.current,
    });
  }, []);
  const historyReloadKey = useMemo(() => {
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;
    return [
      run.id,
      events.length,
      lastEvent?.id ?? "",
      lastEvent?.createdAt ?? "",
      hideCredentialMessages ? "hide" : "show",
    ].join(":");
  }, [events, hideCredentialMessages, run.id]);
  return (
    <div className="code-agents-transcript">
      {error && (
        <div className="code-agents-transcript__error">
          <IconAlertCircle size={15} strokeWidth={1.8} />
          <span>{error}</span>
        </div>
      )}
      {loading && events.length === 0 ? (
        <div className="code-agents-transcript__empty">
          Loading transcript...
        </div>
      ) : (
        // Local coding runs keep their own controller and transcript adapter,
        // but they intentionally enter the shared AssistantChat renderer so
        // message parts, tool activity, and integration suggestions stay in
        // parity with server-backed agent chats.
        <>
          <TranscriptSourceBanner events={events} onOpenRun={onOpenRun} />
          <AssistantChat
            key={run.id}
            className="code-agents-transcript__assistant"
            tabId={`code-agent:${run.id}`}
            showHeader={false}
            emptyStateText="No messages yet."
            suggestions={[]}
            dynamicSuggestions={false}
            plusMenuMode="upload-only"
            providerStatusChecksEnabled={false}
            createAdapter={createAdapter}
            adapterReloadKey={controller}
            loadHistoryRepository={loadHistoryRepository}
            historyReloadKey={historyReloadKey}
            externalStreaming={runIsActive}
            approvalActions={
              onDeny || onApproveAlways
                ? { onDeny, onAlwaysAllow: onApproveAlways }
                : undefined
            }
            availableModels={availableModels}
            availableAgents={availableAgents}
            selectedAgent={selectedAgent}
            selectedModel={selectedModel}
            selectedEngine={selectedEngine}
            selectedEffort={selectedEffort}
            onModelChange={(model, engine) =>
              onModelSelectionChange({
                engine,
                model,
                effort: selectedEffort,
              })
            }
            onAgentChange={handleAgentChange}
            onEffortChange={(effort) =>
              onModelSelectionChange({ ...normalizedModel, effort })
            }
            composerAreaClassName="code-agents-standard-composer"
            composerToolbarSlot={
              <div className="code-agents-chat-composer-slot">
                <RunModeSelect
                  value={permissionMode}
                  onChange={onPermissionModeChange}
                  compact
                />
              </div>
            }
            composerExtraActionButton={
              runIsActive ? <CodeAgentStopButton onStop={onStop} /> : undefined
            }
            onConnectProvider={onConnectProvider}
            onConnectLocalRuntime={onConnectLocalRuntime}
            onForkChat={onForkChat}
          />
        </>
      )}
    </div>
  );
}

function TranscriptSourceBanner({
  events,
  onOpenRun,
}: {
  events: CodeAgentTranscriptEvent[];
  onOpenRun?: (runId: string) => void;
}) {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === "user" &&
        (candidate.metadata?.source === "scheduled-task" ||
          candidate.metadata?.source === "agent"),
    );
  if (!event) return null;
  const source = event.metadata?.source;
  if (source === "scheduled-task") {
    const scheduleName =
      typeof event.metadata?.scheduleName === "string"
        ? event.metadata.scheduleName
        : undefined;
    return (
      <div
        className="code-agents-transcript-source"
        data-source="scheduled-task"
      >
        <IconClock size={14} strokeWidth={1.8} />
        <span>Sent by scheduled task</span>
        {scheduleName ? <small>{scheduleName}</small> : null}
      </div>
    );
  }
  const sourceRunId =
    typeof event.metadata?.sourceRunId === "string"
      ? event.metadata.sourceRunId
      : undefined;
  const sourceRunTitle =
    typeof event.metadata?.sourceRunTitle === "string"
      ? event.metadata.sourceRunTitle
      : sourceRunId;
  return (
    <div className="code-agents-transcript-source" data-source="agent">
      <IconLink size={14} strokeWidth={1.8} />
      <span>Sent from another agent</span>
      {sourceRunId && onOpenRun ? (
        <button type="button" onClick={() => onOpenRun(sourceRunId)}>
          {sourceRunTitle}
        </button>
      ) : sourceRunTitle ? (
        <small>{sourceRunTitle}</small>
      ) : null}
    </div>
  );
}

function CodeAgentStopButton({ onStop }: { onStop: () => void }) {
  return (
    <button
      type="button"
      onClick={onStop}
      className="code-agents-composer-stop-button"
      aria-label="Stop response"
      title="Stop response (Esc)"
    >
      <IconPlayerStop size={14} strokeWidth={1.9} />
    </button>
  );
}

function createHostCodeAgentChatController(
  host: CodeAgentsHost,
  goalId: string,
  permissionModeRef?: { current: string | undefined },
): CodeAgentChatController {
  return {
    async get(runId) {
      const result = await host.listRuns(goalId);
      return result.runs.find((run) => run.id === runId) ?? null;
    },
    async transcript(runId) {
      const result = await host.readTranscript({ goalId, runId });
      return result.status === "ok" ? result.events : [];
    },
    async sendFollowUp(input) {
      const result = await host.appendFollowUp({
        goalId,
        runId: input.runId,
        prompt: input.prompt,
        followUpMode: input.mode,
        permissionMode: input.permissionMode as
          | CodeAgentPermissionMode
          | undefined,
        engine: input.engine,
        model: input.model,
        effort: input.reasoningEffort as CodeAgentReasoningEffort | undefined,
        attachments: normalizePromptAttachmentsForHost(input.metadata),
        metadata: input.metadata,
      });
      return {
        ok: result.ok,
        message: result.message,
        error: result.error,
      };
    },
    async control(input) {
      const result = await host.controlRun(
        goalId,
        input.runId,
        input.command,
        permissionModeRef?.current as CodeAgentPermissionMode | undefined,
      );
      return {
        ok: result.ok,
        run: result.run ?? null,
        message: result.message,
        error: result.error,
      };
    },
  };
}

function normalizePromptAttachmentsForHost(
  metadata: Record<string, unknown> | undefined,
): CodeAgentPromptAttachment[] | undefined {
  const raw = metadata?.attachments;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((item): item is CodeAgentPromptAttachment => {
    return Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as CodeAgentPromptAttachment).name === "string",
    );
  });
}

function RunListSkeleton() {
  return (
    <>
      <div className="code-agents-run-skeleton" />
      <div className="code-agents-run-skeleton" />
      <div className="code-agents-run-skeleton" />
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div
      className="code-agents-overview-skeleton"
      role="status"
      aria-label="Loading agent workspace"
    >
      <div className="code-agents-overview-skeleton__title" />
      <div className="code-agents-overview-skeleton__composer" />
    </div>
  );
}

function hasMissingCredentialSignal(
  run: CodeAgentRun,
  transcriptEvents: CodeAgentTranscriptEvent[],
): boolean {
  if (run.phase === "missing-credentials") return true;
  return transcriptEvents.some(isCredentialTranscriptEvent);
}

// Delegates to the shared core helper so this surface and the server-side
// transcript builders (thread-data-builder.ts, code-agent-transcript.ts)
// agree on one definition instead of each keeping its own regex. The helper
// prefers the structured `signal` field and only falls back to matching the
// legacy hint text for transcripts persisted before that field existed.
function isCredentialTranscriptEvent(event: CodeAgentTranscriptEvent): boolean {
  return isCredentialGapCodeAgentEvent(event);
}

function hasPendingApproval(run: CodeAgentRun): boolean {
  return Boolean(run.needsApproval || getPendingApproval(run));
}

function getPendingApproval(
  run: CodeAgentRun,
): { reason: string; command?: string } | null {
  const value = run.metadata?.pendingApproval;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return run.needsApproval ? { reason: "Review the pending action." } : null;
  }

  const record = value as Record<string, unknown>;
  const reason =
    typeof record.reason === "string" && record.reason.trim()
      ? record.reason.trim()
      : "Review the pending action.";
  const command =
    typeof record.command === "string" && record.command.trim()
      ? record.command.trim()
      : undefined;
  return { reason, command };
}

function getRunTitle(run: CodeAgentRun | null): string | null {
  if (!run) return null;
  if (isMigrationRun(run)) return run.name;
  return run.title || run.id;
}

function getRunPinnedAt(run: CodeAgentRun): string | null {
  const value = run.metadata?.[CODE_AGENT_PINNED_AT_METADATA_KEY];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRunPinned(run: CodeAgentRun): boolean {
  return Boolean(getRunPinnedAt(run));
}

function withRunPinnedAt(
  run: CodeAgentRun,
  pinnedAt: string | null,
): CodeAgentRun {
  return {
    ...run,
    metadata: {
      ...(run.metadata ?? {}),
      [CODE_AGENT_PINNED_AT_METADATA_KEY]: pinnedAt,
    },
  };
}

function sortPinnedRuns(runs: CodeAgentRun[]): CodeAgentRun[] {
  return [...runs].sort((a, b) => {
    const aPinnedAt = getRunPinnedAt(a) ?? a.updatedAt;
    const bPinnedAt = getRunPinnedAt(b) ?? b.updatedAt;
    return bPinnedAt.localeCompare(aPinnedAt);
  });
}

function getRunSubtitle(run: CodeAgentRun): string {
  if (run.subtitle) return run.subtitle;
  if (isMigrationRun(run)) return run.sourceRoot;
  return run.goalId && run.goalId !== "task" ? `${run.goalId} chat` : "Chat";
}

function getRunPermissionMode(run: CodeAgentRun): CodeAgentPermissionMode {
  const metadataMode = getCodeAgentPermissionMode(
    getStringMetadata(run, "permissionMode"),
  );
  if (metadataMode) return metadataMode;

  const detailMode = getCodeAgentPermissionMode(
    run.details?.find((detail) => isPermissionDetail(detail.label))?.value,
  );
  return detailMode ?? DEFAULT_CODE_AGENT_PERMISSION_MODE;
}

function withRunPermissionMode(
  run: CodeAgentRun,
  permissionMode: CodeAgentPermissionMode,
): CodeAgentRun {
  return {
    ...run,
    metadata: {
      ...(run.metadata ?? {}),
      permissionMode,
    },
    details: withPermissionDetail(run.details ?? [], permissionMode),
  };
}

function withPermissionDetail(
  details: CodeAgentRunDetail[],
  permissionMode: CodeAgentPermissionMode,
): CodeAgentRunDetail[] {
  const displayValue = formatPermissionMode(permissionMode);
  let found = false;
  const next = details.map((detail) => {
    if (!isPermissionDetail(detail.label)) return detail;
    found = true;
    return { ...detail, label: "Mode", value: displayValue };
  });
  return found ? next : [...next, { label: "Mode", value: displayValue }];
}

function isPermissionDetail(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized.includes("permission") || normalized === "mode";
}

function formatPermissionMode(value: CodeAgentPermissionMode): string {
  return getRunModeDefinition(runModeFromPermissionMode(value)).label;
}

function getRunTerminalRequest(
  run: CodeAgentRun,
): CodeAgentTerminalRequest | undefined {
  if (isMigrationRun(run)) {
    return { sourceRoot: run.sourceRoot, outputRoot: run.outputRoot };
  }
  const sourceRoot = getStringMetadata(run, "sourceRoot");
  const outputRoot = getStringMetadata(run, "outputRoot");
  const cwd = getStringMetadata(run, "cwd");
  return sourceRoot || outputRoot || cwd
    ? { sourceRoot, outputRoot, cwd }
    : undefined;
}

function getRunSourceLabel(run: CodeAgentRun): string | null {
  const direct = cleanRunLabel(run.sourceLabel);
  if (direct) return direct;

  const metadataLabel = cleanRunLabel(getStringMetadata(run, "sourceLabel"));
  if (metadataLabel) return metadataLabel;

  const source = cleanRunLabel(run.source ?? getStringMetadata(run, "source"));
  if (source) return formatRunSourceLabel(source);

  const kind = cleanRunLabel(run.kind ?? getStringMetadata(run, "kind"));
  return kind ? formatRunSourceLabel(kind) : null;
}

function cleanRunLabel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatRunSourceLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "local" || normalized === "code") return "Local Agent";
  if (
    normalized === "agent-team" ||
    normalized === "agent-teams" ||
    normalized === "teams"
  ) {
    return "Agent Teams";
  }
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getStringMetadata(run: CodeAgentRun, key: string): string | undefined {
  const value = run.metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function formatRelativeTime(value: string): string {
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return "now";

  const abs = Math.abs(Date.now() - time);
  if (abs < 60_000) return "now";

  const units: Array<[string, number]> = [
    ["y", 31_536_000_000],
    ["mo", 2_592_000_000],
    ["d", 86_400_000],
    ["h", 3_600_000],
    ["m", 60_000],
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms) {
      return `${Math.max(1, Math.floor(abs / ms))}${unit}`;
    }
  }
  return "now";
}
