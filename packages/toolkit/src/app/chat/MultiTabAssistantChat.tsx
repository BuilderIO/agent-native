import type { AgentChatAttachment } from "@agent-native/core";
import { CHATGPT_SUBSCRIPTION_ENGINE_NAME } from "@agent-native/core/agent/chatgpt-subscription-contract";
import type { ModelEngineConfig } from "@agent-native/core/agent/model-version";
import type { AgentChatMessage } from "@agent-native/core/client/agent-chat";
import {
  DEFAULT_MODEL,
  AGENT_CHAT_CLEAR_CONTEXT_MESSAGE_TYPE,
  AGENT_CHAT_REMOVE_CONTEXT_MESSAGE_TYPE,
  AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE,
  appendAgentChatContextToMessage,
  claimAgentChatOpenRequest,
  claimAgentChatSubmit,
  cancelAgentChatSubmit,
  drainBufferedAgentChatOpenRequests,
  drainBufferedAgentChatSubmits,
  filterAgentChatContextItems,
  getAgentChatContextState,
  isAgentChatSubmitCancelled,
  normalizeAgentChatContextItem,
  parseSubmitChatMessage,
  removeAgentChatContextItem,
  reportAgentChatSubmitResult,
  reportAgentChatSubmitTarget,
  setAgentChatContextItem,
  type AgentChatContextItem,
} from "@agent-native/core/client/agent-chat";
import { type EngineModelGroup } from "@agent-native/core/client/agent-chat";
import {
  CHAT_MODEL_SELECTION_CHANGED_EVENT,
  chatModelSelectionStorageKey,
  loadChatModelCatalog,
  resolveDefaultModelSelection,
} from "@agent-native/core/client/agent-chat";
import {
  useChatThreads,
  type ChatThreadScope,
} from "@agent-native/core/client/agent-chat";
import { agentNativePath, appPath } from "@agent-native/core/client/api-path";
import { getBrowserTabId } from "@agent-native/core/client/hooks";
import { useChangeVersion } from "@agent-native/core/client/hooks";
import { usePollLoop } from "@agent-native/core/client/hooks";
import { isTrustedFrameMessage } from "@agent-native/core/client/host";
import {
  DEFAULT_LOCALE,
  useOptionalLocale,
  useT,
} from "@agent-native/core/client/i18n";
import {
  DEFAULT_REASONING_EFFORT,
  isReasoningEffort,
  resolveReasoningEffortSelection,
  type ReasoningEffort,
} from "@agent-native/core/shared";
import {
  ComposerContextError,
  composerContextFits,
} from "@agent-native/toolkit/composer";
import {
  isClaudeCodeAgentId,
  isLunaModel,
  resolvePreferredAgentModel,
} from "@agent-native/toolkit/composer/model-selection";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@agent-native/toolkit/ui/popover";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { cn } from "@agent-native/toolkit/utils";
import { IconPlus, IconHistory, IconX } from "@tabler/icons-react";
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { toast } from "sonner";

import { AgentKitTranscriptSkeleton } from "../agentkit/react/components.js";
import {
  getAgentChatNavigationKey,
  type AgentChatNavigationKey,
} from "./agent-sidebar-events.js";
import { AgentKitAssistantChat } from "./AgentKitAssistantChat.js";
import {
  AgentPanelTabCloseButton,
  closeAgentPanelTabOnKey,
} from "./AgentPanelThreadTabs.js";
import type {
  AssistantChatProps,
  AssistantChatHandle,
  AssistantChatSnapshotSaveSource,
  AssistantChatSendOptions,
} from "./chat/surface-types.js";
import { fallbackChatTitle } from "./fallback-chat-title.js";
import {
  OwnershipChatHistoryRail,
  ownDraftRows,
  useOwnershipChatHistory,
  type OwnDraftRow,
} from "./ownership-history/index.js";

type AgentActionScope = NonNullable<AgentChatMessage["actionScope"]>;
const PREFILL_CONTEXT_KEY = "agent-chat-prefill-context";
// Every catalog refresh hits the same missing list; the error state already
// shows it in the model picker, so the console only needs it once per page.
let warnedEngineListUnavailable = false;

const useBrowserLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

interface ModelSelection {
  model: string;
  engine?: string;
  effort?: ReasoningEffort;
}

interface PendingSend {
  message: string;
  prefillContext?: AgentChatContextItem;
  images?: string[];
  attachments?: AgentChatAttachment[];
  submit: boolean;
  trackInRunsTray?: boolean;
  requestMode?: "act" | "plan";
  /** Correlates with `AGENT_CHAT_SUBMIT_RESULT_EVENT` — see agent-chat.ts. */
  submitMessageId?: string;
  submissionExpiresAt?: number;
  /** See `AgentChatMessage.usageLabel`. */
  usageLabel?: string;
  actionScope?: AgentActionScope;
  /** See `AgentChatMessage.approvedToolCalls`. */
  approvedToolCalls?: string[];
  /** See `AssistantChatSendOptions.surface`. */
  surface?: string;
}

/**
 * A send queued until its target thread is ready. `threadId: null` targets the
 * first thread to become active (cold start); a concrete id is a thread whose
 * chat ref hasn't mounted yet. Drained by the flush effect.
 */
interface PendingDelivery {
  threadId: string | null;
  send: PendingSend;
  targetReported?: boolean;
  isCurrent?: () => boolean;
  onResult?: (delivered: boolean) => void;
  /** Applied to whichever thread this send lands on; a queued send outlives the handler that parsed it. */
  modelOverride?: ModelSelection;
}

/** The single path that hands a queued send to a mounted chat ref. */
async function deliverPendingPrefill(
  ref: AssistantChatHandle,
  send: PendingSend,
  isCurrent: () => boolean,
  onHandoff: (delivered: boolean) => boolean,
): Promise<void> {
  const reportResult = (delivered: boolean, reason?: string) => {
    if (onHandoff(delivered))
      reportAgentChatSubmitResult(send.submitMessageId, delivered, reason);
  };
  let stagingId: string | undefined;
  if (send.prefillContext) {
    // Checked against what the composer already holds, before the draft changes,
    // so a refused prefill leaves no draft without its context.
    let fits: boolean;
    try {
      fits = ref.canStageComposerContextItem(send.prefillContext);
    } catch (error) {
      // A provider item still loading has no size yet; report a typed failure so the
      // bridge caller does not wait for a timeout. Anything else is a bug and propagates.
      if (error instanceof ComposerContextError && error.code === "not-ready") {
        reportResult(false, "composer-not-ready");
        return;
      }
      throw error;
    }
    if (!fits) {
      reportResult(false, "context-too-large");
      return;
    }
    try {
      const contextWrite = ref.setComposerContextItem(send.prefillContext, {
        focus: false,
        threadScoped: true,
      });
      if (contextWrite && typeof contextWrite.then === "function") {
        stagingId = (await contextWrite)?.stagingId;
      }
    } catch {
      reportResult(false, "context-persistence-failed");
      return;
    }
  }
  if (isAgentChatSubmitCancelled(send.submitMessageId) || !isCurrent()) {
    if (send.prefillContext) {
      // Removes only the item this delivery staged, so a newer prefill with the same
      // key that replaced it while the write was in flight keeps its place.
      if (stagingId === undefined) {
        console.error(
          "Could not identify the staged prefill context; it was not removed after the cancelled send.",
        );
      } else {
        await ref.removeComposerContextItem(send.prefillContext.key, {
          threadScoped: true,
          stagingId,
        });
      }
    }
    return;
  }
  try {
    ref.prefillMessage(send.message);
  } catch (error) {
    console.error("Could not apply the chat prefill.", error);
    reportResult(false, "prefill-failed");
    return;
  }
  reportResult(true);
}

function deliverPendingSend(
  ref: AssistantChatHandle,
  send: PendingSend,
  isCurrent: () => boolean,
  onHandoff: (delivered: boolean) => boolean,
): void | Promise<void> {
  if (isAgentChatSubmitCancelled(send.submitMessageId)) return;
  if (
    send.submissionExpiresAt !== undefined &&
    send.submissionExpiresAt <= Date.now()
  ) {
    if (onHandoff(false))
      reportAgentChatSubmitResult(
        send.submitMessageId,
        false,
        "submission-expired",
      );
    return;
  }
  if (!send.submit) {
    return deliverPendingPrefill(ref, send, isCurrent, onHandoff).catch(
      (error: unknown) => {
        console.error(
          "Could not finish a cancelled chat prefill cleanup.",
          error,
        );
        if (onHandoff(false))
          reportAgentChatSubmitResult(
            send.submitMessageId,
            false,
            "prefill-failed",
          );
      },
    );
  }
  // Every field is decided once, here; a separate "has options" condition
  // listing them again is how a new field ends up silently dropped.
  const options: AssistantChatSendOptions = {
    ...(send.trackInRunsTray ? { trackInRunsTray: true } : {}),
    ...(send.requestMode ? { requestMode: send.requestMode } : {}),
    ...(send.attachments ? { attachments: send.attachments } : {}),
    ...(send.submitMessageId ? { submitMessageId: send.submitMessageId } : {}),
    ...(send.submissionExpiresAt !== undefined
      ? { submissionExpiresAt: send.submissionExpiresAt }
      : {}),
    ...(send.usageLabel ? { usageLabel: send.usageLabel } : {}),
    ...(send.actionScope ? { actionScope: send.actionScope } : {}),
    ...(send.surface ? { surface: send.surface } : {}),
    // An approval resume is a protocol continuation, not a visible prompt.
    ...(send.approvedToolCalls
      ? { approvedToolCalls: send.approvedToolCalls, hideUserMessage: true }
      : {}),
  };
  const submission =
    Object.keys(options).length > 0
      ? ref.sendMessage(send.message, send.images, options)
      : ref.sendMessage(send.message, send.images);
  void submission.then(
    (result) => {
      if (result.status === "rejected") {
        reportAgentChatSubmitResult(send.submitMessageId, false, result.reason);
      }
    },
    () =>
      reportAgentChatSubmitResult(
        send.submitMessageId,
        false,
        "submission-failed",
      ),
  );
}

function readStoredModelSelection(key: string): ModelSelection | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<ModelSelection>;
    if (typeof parsed.model !== "string" || !parsed.model.trim()) {
      return undefined;
    }
    const selection: ModelSelection = {
      model: parsed.model,
      effort: resolveReasoningEffortSelection(
        parsed.model,
        isReasoningEffort(parsed.effort) ? parsed.effort : undefined,
      ),
    };
    if (typeof parsed.engine === "string") selection.engine = parsed.engine;
    return selection;
  } catch {
    return undefined;
  }
}

function writeStoredModelSelection(key: string, selection: ModelSelection) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(selection));
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent(CHAT_MODEL_SELECTION_CHANGED_EVENT, {
          detail: { key },
        }),
      );
    });
  } catch {}
}

export function resolveModelSelection(
  selection: ModelSelection | undefined,
  groups: EngineModelGroup[],
  /** The app's configured default, once the server's catalog names it. */
  appDefault?: { model: string; engine?: string },
): ModelSelection | undefined {
  if (!selection?.model) {
    const start = resolveDefaultModelSelection(
      groups,
      appDefault?.model,
      appDefault?.engine,
    );
    return start
      ? {
          ...start,
          effort: resolveReasoningEffortSelection(start.model, undefined),
        }
      : undefined;
  }
  // Engine precedence turns on whether the catalog OFFERS the supplied engine,
  // not on whether that engine advertises this model:
  //   offered      → honor it. A gateway's advertised list is its built-in
  //                  catalog, not what the endpoint serves, and one model id
  //                  sits under several groups (claude-sonnet-5 under both
  //                  anthropic and builder) — so a model-only match would
  //                  reroute the turn to a different provider and bill it there.
  //   not offered  → heal to a group that serves the model. A selection left
  //                  on `builder` after disconnecting it must still run on the
  //                  user's own key; the same model through another configured
  //                  provider is the point of bring-your-own-key.
  // `builder` is in the catalog exactly when Builder is connected, so this is a
  // real availability signal rather than a guess.
  const suppliedEngine = selection.engine?.trim()
    ? selection.engine
    : undefined;
  const suppliedEngineGroup = suppliedEngine
    ? groups.find((group) => group.engine === suppliedEngine)
    : undefined;
  const matchingConfiguredGroup = groups.find(
    (group) => group.configured && group.models.includes(selection.model),
  );
  const fallbackConfiguredGroup = groups.find((group) => group.configured);
  const fallbackGroup = matchingConfiguredGroup ?? fallbackConfiguredGroup;
  const engine = suppliedEngineGroup?.engine ?? fallbackGroup?.engine;
  const model = suppliedEngineGroup
    ? suppliedEngineGroup.engine === CHATGPT_SUBSCRIPTION_ENGINE_NAME &&
      !suppliedEngineGroup.models.includes(selection.model)
      ? suppliedEngineGroup.models[0]
      : selection.model
    : matchingConfiguredGroup?.models.includes(selection.model)
      ? selection.model
      : fallbackGroup?.models[0];
  // A non-empty catalog is an availability boundary: do not keep routing a
  // stale selection through a provider group hidden for missing credentials.
  if (!engine || !model) {
    if (groups.length > 0) return undefined;
    return {
      model: selection.model,
      ...(suppliedEngine ? { engine: suppliedEngine } : {}),
      effort: resolveReasoningEffortSelection(
        selection.model,
        selection.effort,
      ),
    };
  }

  const effort = resolveReasoningEffortSelection(model, selection.effort);
  const resolved: ModelSelection = { model, effort };
  if (engine) resolved.engine = engine;
  return resolved;
}

// ─── Skeleton Loader ─────────────────────────────────────────────────────────

function ChatSkeleton({
  header,
  headerOnly = false,
}: {
  header?: React.ReactNode;
  headerOnly?: boolean;
}) {
  const t = useT();
  return (
    <div
      className={cn(
        "flex flex-col min-h-0",
        headerOnly ? "shrink-0" : "flex-1 h-full",
      )}
      aria-busy="true"
    >
      <span role="status" className="sr-only">
        {t("agentChat.empty.loadingChat")}
      </span>
      {header ?? (
        <div
          className="flex items-center px-1 py-1 border-b border-border shrink-0 gap-0.5"
          aria-hidden="true"
        >
          <Skeleton className="h-6 w-24" />
          <div className="ms-auto flex gap-px">
            <Skeleton className="size-6" />
            <Skeleton className="size-6" />
          </div>
        </div>
      )}
      {!headerOnly && (
        <div className="flex min-h-0 flex-1 flex-col" aria-hidden="true">
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgentKitTranscriptSkeleton />
          </div>
          <div className="shrink-0 px-3 pb-3">
            <Skeleton className="mx-auto h-24 w-full max-w-[47rem] rounded-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Resource context ────────────────────────────────────────────────────────

function formatScopeType(type: string) {
  return type.replace(/[-_]+/g, " ");
}

function buildResourceContextItem(
  scope: ChatThreadScope,
  contextNamespace?: string,
): AgentChatContextItem {
  const type = formatScopeType(scope.type);
  const label = scope.label?.trim();
  const marker = `Resource context: ${scope.type}:${scope.id}`;
  return {
    key: scope.contextKey?.trim() || "agent-current-resource-context",
    title: label || type.replace(/^./, (character) => character.toUpperCase()),
    ...(contextNamespace ? { contextNamespace } : {}),
    context: [
      marker,
      `The user is currently viewing this ${type}.`,
      label ? `Resource name: ${label}` : "",
      `Resource id: ${scope.id}`,
      scope.context?.trim() || "",
      typeof window !== "undefined"
        ? `Current URL: ${window.location.pathname}${window.location.search}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// ─── History Popover ─────────────────────────────────────────────────────────

function formatThreadTime(
  ts: number,
  locale: string,
  yesterdayLabel: string,
): string {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0)
    return d.toLocaleTimeString(locale, {
      hour: "numeric",
      minute: "2-digit",
    });
  if (diffDays === 1) return yesterdayLabel;
  if (diffDays < 7) return d.toLocaleDateString(locale, { weekday: "short" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

function HistoryPopover({
  apiUrl,
  scope,
  localMineRows,
  openTabIds,
  activeThreadId,
  onSelect,
  onNewChat,
  onClose,
  onTogglePin,
  onRename,
  getThreadUrl,
  popoverAlign = "end",
}: {
  apiUrl?: string;
  scope?: ChatThreadScope;
  localMineRows: OwnDraftRow[];
  openTabIds: Set<string>;
  activeThreadId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onClose: () => void;
  onTogglePin: (id: string, pinned: boolean) => Promise<boolean>;
  onRename: (id: string, nextTitle: string) => Promise<boolean>;
  getThreadUrl: (id: string) => string;
  popoverAlign?: "start" | "end";
}) {
  const t = useT();
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  // This component is mounted only while the popover is open.
  const history = useOwnershipChatHistory({
    apiUrl,
    scope,
    enabled: true,
    query,
    activeId: activeThreadId,
    pinned: true,
    localMineRows,
    mutations: { pin: onTogglePin, rename: onRename },
    getThreadUrl,
    onMutationFailed: () => toast.error(t("agentChat.common.saveFailed")),
    decorateItem: (item, row) => ({
      ...item,
      title: row.title || t("agentChat.history.untitledChat"),
      titleText: row.title || t("agentChat.history.untitledChat"),
      subtitle:
        row.title && row.preview && row.title !== row.preview
          ? row.preview
          : undefined,
      timestamp:
        row.id === activeThreadId
          ? t("agentChat.history.active")
          : openTabIds.has(row.id)
            ? t("agentChat.history.open")
            : formatThreadTime(
                row.updatedAt,
                locale,
                t("agentChat.history.yesterday"),
              ),
    }),
  });

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className={`absolute h-px w-px ${popoverAlign === "start" ? "top-12 start-2" : "top-0 end-2"}`}
        />
      </PopoverAnchor>
      <PopoverContent
        align={popoverAlign}
        side="bottom"
        sideOffset={0}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus();
        }}
        className="w-72 rounded-lg p-0"
      >
        <OwnershipChatHistoryRail
          {...history}
          activeId={activeThreadId}
          onNewChat={onNewChat}
          showNewChat={false}
          onSelect={(id) => {
            onSelect(id);
            onClose();
          }}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t("agentChat.history.search")}
          searchInputRef={inputRef}
          loadingLabel={t("agentChat.history.searching")}
          emptyLabel={t("agentChat.history.empty")}
          emptySearchLabel={t("agentChat.history.noMatches")}
          className="an-chat-history--capped"
        />
      </PopoverContent>
    </Popover>
  );
}

/** Roving focus across a tablist's tabs; Enter or Space activates the focused tab. */
function moveTabFocus(event: React.KeyboardEvent<HTMLElement>) {
  if (
    event.key !== "ArrowLeft" &&
    event.key !== "ArrowRight" &&
    event.key !== "Home" &&
    event.key !== "End"
  ) {
    return;
  }
  const tabs = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
  );
  const index = tabs.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
  const step = (event.key === "ArrowRight") !== rtl ? 1 : -1;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + step + tabs.length) % tabs.length;
  tabs[next]?.focus();
}

// ─── Help Popover ────────────────────────────────────────────────────────────

function HelpPopover({ onClose }: { onClose: () => void }) {
  const t = useT();
  const commands = [
    {
      name: "/clear",
      description: t("agentChat.commands.clear"),
    },
    { name: "/new", description: t("agentChat.commands.new") },
    { name: "/history", description: t("agentChat.commands.history") },
    { name: "/plan", description: t("agentChat.commands.planNext") },
    { name: "/help", description: t("agentChat.commands.help") },
    { name: "@", description: t("agentChat.commands.mention") },
  ];

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span aria-hidden className="absolute top-0 end-2 h-px w-px" />
      </PopoverAnchor>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={0}
        aria-label={t("agentChat.commands.available")}
        className="w-72 rounded-lg p-0"
      >
        <div className="flex items-center justify-between gap-2 ps-3 pe-1 pt-1">
          <span className="text-xs font-medium text-foreground">
            {t("agentChat.commands.available")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onClose}
            aria-label={t("agentChat.commands.closeHelp")}
            className="text-muted-foreground [&_svg]:size-4"
          >
            <IconX aria-hidden="true" />
          </Button>
        </div>
        <div className="pb-1">
          {commands.map((cmd) => (
            <div key={cmd.name} className="px-3 py-1.5">
              <div className="text-xs font-medium text-foreground">
                {cmd.name}
              </div>
              <div className="text-xs text-muted-foreground">
                {cmd.description}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatTab {
  id: string;
  label: string;
  status: "idle" | "running" | "completed";
  /** If this tab is a sub-agent, the parent thread ID */
  parentThreadId?: string;
  /** Short name for sub-agent tabs (e.g. "Research", "Draft email") */
  subAgentName?: string;
}

type AgentTeamRunStatus =
  | "queued"
  | "running"
  | "paused"
  | "needs-approval"
  | "completed"
  | "errored"
  | "unknown";

interface AgentTeamRunSummary {
  title?: string;
  status?: AgentTeamRunStatus;
  sourceRecord?: {
    type?: string;
    threadId?: unknown;
    parentThreadId?: unknown;
    name?: unknown;
  };
  metadata?: Record<string, unknown>;
}

interface AgentTeamTabInfo {
  threadId: string;
  parentThreadId: string;
  name: string;
  status: AgentTeamRunStatus;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isActiveAgentTeamStatus(status?: AgentTeamRunStatus): boolean {
  return (
    status === "queued" ||
    status === "running" ||
    status === "paused" ||
    status === "needs-approval"
  );
}

function chatTabStatusFromAgentTeamStatus(
  status?: AgentTeamRunStatus,
): ChatTab["status"] | undefined {
  if (!status) return undefined;
  return isActiveAgentTeamStatus(status) ? "running" : "completed";
}

const STALE_THREAD_THRESHOLD_MS = 12 * 60 * 60 * 1000;
const DEFAULT_AGENT_TEAM_POLL_MS = 3000;
const DEFAULT_THREAD_URL_PARAM = "thread";
const THREAD_URL_CHANGED_EVENT = "agent-chat:url-thread-changed";

// A duplicated id in `openTabIds` makes two tab-bar entries share one
// underlying thread: closing either one filters that id out of the array
// entirely, so both disappear at once. De-duplicate at every boundary the
// array crosses (localStorage read and write) so a corrupted persisted list
// self-heals instead of reproducing the phantom tab on every reload.
function dedupeIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

// The history patch is installed once and shared via a ref count so that
// multiple synced chats (or a remount) don't restore a stale `pushState`
// reference and silently drop a wrapper installed by another instance.
let historyPatchRefCount = 0;
let restoreHistoryPatch: (() => void) | null = null;

function installHistoryThreadUrlPatch(): () => void {
  if (typeof window === "undefined") return () => {};
  historyPatchRefCount += 1;
  if (historyPatchRefCount === 1) {
    const originalPushState = window.history.pushState.bind(window.history);
    const originalReplaceState = window.history.replaceState.bind(
      window.history,
    );
    const dispatchUrlChange = () => {
      window.dispatchEvent(new Event(THREAD_URL_CHANGED_EVENT));
    };
    window.history.pushState = function pushState(...args) {
      const result = originalPushState.apply(this, args);
      dispatchUrlChange();
      return result;
    };
    window.history.replaceState = function replaceState(...args) {
      const result = originalReplaceState.apply(this, args);
      dispatchUrlChange();
      return result;
    };
    restoreHistoryPatch = () => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    };
  }
  return () => {
    historyPatchRefCount = Math.max(0, historyPatchRefCount - 1);
    if (historyPatchRefCount === 0) {
      restoreHistoryPatch?.();
      restoreHistoryPatch = null;
    }
  };
}

export interface ChatThreadUrlSyncOptions {
  /** Query-string parameter used by the generic URL adapter. Default: `thread`. */
  paramName?: string;
  /**
   * Route-owned thread id. Pass `null` for the create route and a string for
   * thread routes like `/chat/:threadId`.
   */
  routeThreadId?: string | null;
  /** Build the URL path for a thread id, or for create mode when id is null. */
  getPath?: (threadId: string | null) => string;
  /** Optional router navigation callback used with `getPath`. */
  navigate?: (path: string, options?: { replace?: boolean }) => void;
}

function normalizeUrlThreadId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function resolveThreadUrlSync(
  value: MultiTabAssistantChatProps["threadUrlSync"],
): {
  enabled: boolean;
  paramName: string;
  routeThreadId?: string | null;
  getPath?: (threadId: string | null) => string;
  navigate?: (path: string, options?: { replace?: boolean }) => void;
} {
  if (!value) return { enabled: false, paramName: DEFAULT_THREAD_URL_PARAM };
  if (value === true) {
    return { enabled: true, paramName: DEFAULT_THREAD_URL_PARAM };
  }
  return {
    enabled: true,
    paramName: value.paramName?.trim() || DEFAULT_THREAD_URL_PARAM,
    ...(Object.hasOwn(value, "routeThreadId")
      ? { routeThreadId: normalizeUrlThreadId(value.routeThreadId) }
      : {}),
    ...(value.getPath ? { getPath: value.getPath } : {}),
    ...(value.navigate ? { navigate: value.navigate } : {}),
  };
}

function readUrlThreadId(paramName: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const params = new URLSearchParams(window.location.search);
    return normalizeUrlThreadId(
      params.get(paramName) ??
        (paramName === DEFAULT_THREAD_URL_PARAM
          ? params.get("threadId")
          : null),
    );
  } catch {
    return null;
  }
}

function runToAgentTeamTabInfo(
  run: AgentTeamRunSummary,
): AgentTeamTabInfo | null {
  if (run.sourceRecord?.type && run.sourceRecord.type !== "agent-team-task") {
    return null;
  }
  const metadata = run.metadata ?? {};
  const threadId =
    readString(run.sourceRecord?.threadId) || readString(metadata.threadId);
  const parentThreadId =
    readString(run.sourceRecord?.parentThreadId) ||
    readString(metadata.parentThreadId);
  if (!threadId || !parentThreadId || threadId === parentThreadId) return null;
  const name =
    readString(run.sourceRecord?.name) ||
    readString(metadata.name) ||
    readString(run.title) ||
    "Sub-agent";
  return {
    threadId,
    parentThreadId,
    name,
    status: run.status ?? "unknown",
  };
}

export interface MultiTabAssistantChatHeaderProps {
  tabs: ChatTab[];
  activeTabId: string;
  activeTabMessageCount: number;
  activeTabIsPersisted?: boolean;
  setActiveTabId: (tabId: string) => void;
  addTab: () => void;
  closeTab: (tabId: string) => void;
  closeOtherTabs: (tabId: string) => void;
  closeAllTabs: () => void;
  clearActiveTab: () => void;
  /** Open the history popover */
  showHistory?: boolean;
  toggleHistory?: () => void;
  /** Number of open tabs (useful for triggering scroll on tab count change) */
  tabCount: number;
}

export type MultiTabAssistantChatHeaderCallbackProps = Omit<
  MultiTabAssistantChatHeaderProps,
  "activeTabIsPersisted"
> & {
  activeTabIsPersisted: boolean;
};

// ─── Component ──────────────────────────────────────────────────────────────

export type MultiTabAssistantChatProps = Omit<
  AssistantChatProps,
  "tabId" | "threadId"
> & {
  /** Show the tab bar. Default: true */
  showTabBar?: boolean;
  /** Optional custom single-row header renderer */
  renderHeader?: (
    props: MultiTabAssistantChatHeaderCallbackProps,
  ) => React.ReactNode;
  /** Optional page-level top-bar actions renderer for the active tab. */
  renderOverlay?: (
    props: MultiTabAssistantChatHeaderCallbackProps,
  ) => React.ReactNode;
  /** Hide the chat content while keeping the header visible. Used when CLI/resources mode is active. */
  contentHidden?: boolean;
  /** Namespace for localStorage keys — used to isolate chat state per app in the frame. */
  storageKey?: string;
  /** Restore the previously active thread and open tabs from localStorage. */
  restoreActiveThread?: boolean;
  /** Stable browser tab id used for tab-scoped app-state context. */
  browserTabId?: string;
  /**
   * Keep the active thread in URL state. `true` uses the generic `?thread=id`
   * adapter; passing `routeThreadId` + `getPath` lets an app bind chats to
   * route params such as `/chat/:threadId`.
   */
  threadUrlSync?: boolean | ChatThreadUrlSyncOptions;
  /** Ambient resource context to show as a composer chip. */
  scope?: ChatThreadScope | null;
  /** Keep app-owned chat history isolated to the supplied scope. */
  isolateHistoryByScope?: boolean;
  /** @deprecated Scope context is now rendered in the composer. */
  showScopeBadge?: boolean;
  /** Cadence for hydrating agent-team sub-agent tab status. Default: 3000. */
  agentTeamPollMs?: number;
  /** Reports the exact model engine selected for the active thread. */
  onActiveModelEngineChange?: (engine: ModelEngineConfig | null) => void;
  onCommandListenersReadyChange?: (ready: boolean) => void;
  onReferenceTargetChange?: (
    targetId: string | null,
    navigations: Event[],
  ) => void;
  onNavigationChange?: (event: Event, outcome: ChatNavigationOutcome) => void;
  onTabsClosed?: (tabIds: string[], outcome: "closed" | "missing") => void;
  onTabsClosing?: (
    tabIds: string[],
    outcome: "closed" | "missing",
  ) => (() => void) | void;
};

export type ChatNavigationOutcome =
  | "started"
  | "selected"
  | "skipped"
  | "missing"
  | "unavailable"
  | "superseded"
  | "closed"
  | "failed";

type ChatHeaderTypeCheck<T extends true> = T;
type ChatHeaderTypeMatch<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : false
  : false;
// eslint-disable-next-line no-unused-vars -- Enforced by the toolkit package typecheck.
type ChatHeaderCallbackStatusIsBoolean = ChatHeaderTypeCheck<
  ChatHeaderTypeMatch<
    Parameters<
      NonNullable<MultiTabAssistantChatProps["renderHeader"]>
    >[0]["activeTabIsPersisted"],
    boolean
  >
>;
// eslint-disable-next-line no-unused-vars -- Enforced by the toolkit package typecheck.
type LegacyChatHeaderStatusRemainsOptional = ChatHeaderTypeCheck<
  {} extends Pick<MultiTabAssistantChatHeaderProps, "activeTabIsPersisted">
    ? true
    : false
>;

export function MultiTabAssistantChat({
  showTabBar = true,
  renderHeader,
  renderOverlay,
  contentHidden = false,
  apiUrl = agentNativePath("/_agent-native/agent-chat"),
  storageKey,
  restoreActiveThread = true,
  browserTabId: browserTabIdProp,
  threadUrlSync = false,
  scope = null,
  isolateHistoryByScope = false,
  agentTeamPollMs = DEFAULT_AGENT_TEAM_POLL_MS,
  availableModels: hostAvailableModels,
  modelListLoading: hostModelListLoading,
  modelListError: hostModelListError,
  onRetryModelList: hostOnRetryModelList,
  onModelChange: hostOnModelChange,
  onActiveModelEngineChange,
  onCommandListenersReadyChange,
  onReferenceTargetChange,
  onNavigationChange,
  onTabsClosed,
  onTabsClosing,
  ...props
}: MultiTabAssistantChatProps) {
  const translate = useT();
  const browserTabId =
    browserTabIdProp ??
    (typeof window === "undefined" ? undefined : getBrowserTabId());
  const tabStoragePart = browserTabId ? `:tab:${browserTabId}` : "";
  const localStorageNamespace = storageKey
    ? `${storageKey}${tabStoragePart}`
    : browserTabId
      ? `tab:${browserTabId}`
      : undefined;
  const keyPrefix = localStorageNamespace ? `:${localStorageNamespace}` : "";
  const legacyKeyPrefix = storageKey ? `:${storageKey}` : "";
  const modelSelectionKey = chatModelSelectionStorageKey(storageKey);
  const contextNamespace = scope
    ? scope.contextKey?.trim() || `scope:${scope.type}:${scope.id}`
    : undefined;
  const lastResourceContextVersionRef = useRef(scope?.contextVersion);
  const {
    enabled: threadUrlSyncEnabled,
    paramName: threadUrlParamName,
    routeThreadId,
    getPath: getThreadPath,
    navigate: navigateThreadUrl,
  } = resolveThreadUrlSync(threadUrlSync);
  const threadRouteControlsActiveThread =
    threadUrlSyncEnabled &&
    threadUrlSync !== true &&
    typeof threadUrlSync === "object" &&
    Object.hasOwn(threadUrlSync, "routeThreadId");
  const [urlThreadId, setUrlThreadId] = useState<string | null>(() =>
    threadUrlSyncEnabled
      ? threadRouteControlsActiveThread
        ? (routeThreadId ?? readUrlThreadId(threadUrlParamName))
        : readUrlThreadId(threadUrlParamName)
      : null,
  );
  const [deepLinkedThreadId] = useState<string | null>(() =>
    threadUrlSyncEnabled ? null : readUrlThreadId(DEFAULT_THREAD_URL_PARAM),
  );
  const [activeDeepLinkedThreadId, setActiveDeepLinkedThreadId] =
    useState(deepLinkedThreadId);
  const urlThreadIdRef = useRef(urlThreadId);
  urlThreadIdRef.current = urlThreadId;

  useEffect(() => {
    if (!threadUrlSyncEnabled || threadRouteControlsActiveThread) return;
    const update = () => setUrlThreadId(readUrlThreadId(threadUrlParamName));
    const uninstallHistoryPatch = installHistoryThreadUrlPatch();
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(THREAD_URL_CHANGED_EVENT, update);
    return () => {
      uninstallHistoryPatch();
      window.removeEventListener("popstate", update);
      window.removeEventListener(THREAD_URL_CHANGED_EVENT, update);
    };
  }, [
    threadRouteControlsActiveThread,
    threadUrlParamName,
    threadUrlSyncEnabled,
  ]);

  useEffect(() => {
    if (!threadUrlSyncEnabled || !threadRouteControlsActiveThread) return;
    setUrlThreadId(routeThreadId ?? readUrlThreadId(threadUrlParamName));
  }, [
    routeThreadId,
    threadRouteControlsActiveThread,
    threadUrlParamName,
    threadUrlSyncEnabled,
  ]);

  useEffect(() => {
    if (threadUrlSyncEnabled) return;
    const update = () =>
      setActiveDeepLinkedThreadId(readUrlThreadId(DEFAULT_THREAD_URL_PARAM));
    const uninstallHistoryPatch = installHistoryThreadUrlPatch();
    update();
    window.addEventListener("popstate", update);
    window.addEventListener(THREAD_URL_CHANGED_EVENT, update);
    return () => {
      uninstallHistoryPatch();
      window.removeEventListener("popstate", update);
      window.removeEventListener(THREAD_URL_CHANGED_EVENT, update);
    };
  }, [threadUrlSyncEnabled]);

  const writeThreadUrl = useCallback(
    (threadId: string | null, options: { replace?: boolean } = {}): void => {
      if (typeof window === "undefined") return;
      const normalizedThreadId = normalizeUrlThreadId(threadId);
      if (!threadUrlSyncEnabled) {
        if (
          !activeDeepLinkedThreadId ||
          normalizedThreadId === activeDeepLinkedThreadId
        ) {
          return;
        }
        setActiveDeepLinkedThreadId(null);
        try {
          const url = new URL(window.location.href);
          url.searchParams.delete(DEFAULT_THREAD_URL_PARAM);
          url.searchParams.delete("threadId");
          window.history.replaceState(
            window.history.state,
            "",
            `${url.pathname}${url.search}${url.hash}`,
          );
        } catch (error) {
          console.error("Could not clear the stale thread URL:", error);
        }
        window.dispatchEvent(new Event(THREAD_URL_CHANGED_EVENT));
        return;
      }
      try {
        let next: string;
        if (getThreadPath) {
          next = getThreadPath(normalizedThreadId);
        } else {
          const url = new URL(window.location.href);
          if (normalizedThreadId) {
            url.searchParams.set(threadUrlParamName, normalizedThreadId);
          } else {
            url.searchParams.delete(threadUrlParamName);
          }
          if (threadUrlParamName !== "threadId") {
            url.searchParams.delete("threadId");
          }
          next = `${url.pathname}${url.search}${url.hash}`;
        }
        const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (next === current) {
          setUrlThreadId(normalizedThreadId);
          return;
        }
        if (getThreadPath && navigateThreadUrl) {
          navigateThreadUrl(next, { replace: options.replace === true });
          setUrlThreadId(normalizedThreadId);
          return;
        }
        const method = options.replace ? "replaceState" : "pushState";
        // `getThreadPath` returns a router-local path (no app basename). When we
        // fall back to the raw History API instead of a router navigate, resolve
        // the basename so deep-link reloads work in mounted apps.
        const historyTarget = getThreadPath ? appPath(next) : next;
        window.history[method](window.history.state, "", historyTarget);
        setUrlThreadId(normalizedThreadId);
        window.dispatchEvent(new Event(THREAD_URL_CHANGED_EVENT));
        const popstate =
          typeof PopStateEvent === "function"
            ? new PopStateEvent("popstate", { state: window.history.state })
            : new Event("popstate");
        window.dispatchEvent(popstate);
      } catch {}
    },
    [
      getThreadPath,
      navigateThreadUrl,
      activeDeepLinkedThreadId,
      threadUrlParamName,
      threadUrlSyncEnabled,
    ],
  );

  // A shared `?thread=` link opens its thread once, then moves to the
  // route-owned thread path, so the blank create route keeps no stale query.
  useEffect(() => {
    if (!threadUrlSyncEnabled || !threadRouteControlsActiveThread) return;
    if (routeThreadId) return;
    const sharedThreadId = readUrlThreadId(threadUrlParamName);
    if (sharedThreadId) writeThreadUrl(sharedThreadId, { replace: true });
  }, [
    routeThreadId,
    threadRouteControlsActiveThread,
    threadUrlParamName,
    threadUrlSyncEnabled,
    writeThreadUrl,
  ]);

  const {
    threads,
    activeThreadId,
    isLoading,
    createThread,
    openThread,
    switchThread: switchThreadState,
    forkThread,
    saveThreadData,
    generateTitle,
    refreshThreads,
    restoredThreadIdOnListFailure,
    evictedThreadIds,
    isNewThread,
    isThreadPersisted,
    confirmThreadSnapshotPersisted,
    pinThread,
    renameThread,
  } = useChatThreads(apiUrl, storageKey, scope, {
    restoreActiveThread,
    browserTabId,
    routeThreadId: threadUrlSyncEnabled
      ? urlThreadId
      : (activeDeepLinkedThreadId ?? undefined),
    isolateHistoryByScope,
  });

  const switchThread = useCallback(
    (threadId: string, options: { replace?: boolean } = {}) => {
      switchThreadState(threadId);
      writeThreadUrl(threadId, options);
    },
    [switchThreadState, writeThreadUrl],
  );

  // Track which tabs have been focused at least once (lazy mount for sub-agent tabs)
  const mountedTabsRef = useRef<Set<string>>(new Set());
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  // Mark the active tab as mounted so it persists when switched away
  if (activeThreadId) mountedTabsRef.current.add(activeThreadId);
  // Tabs that rendered once after the thread list loaded. Only that first load
  // gates a tab's restore: a later reload (a history-scope change) refetches
  // every row, and gating on it releases and reopens each mounted thread and
  // defers its sends.
  const threadListLoadedTabsRef = useRef<Set<string>>(new Set());
  // Hidden tabs are display:none, which drops their scroll position, so each
  // transcript's last visible position is kept here and put back on show.
  const tabContainersRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const transcriptScrollRef = useRef<
    Map<string, { top: number; atBottom: boolean }>
  >(new Map());
  const visibleTabId = contentHidden ? null : activeThreadId;
  useBrowserLayoutEffect(() => {
    if (!visibleTabId) return;
    const saved = transcriptScrollRef.current.get(visibleTabId);
    const scroller = tabContainersRef.current
      .get(visibleTabId)
      ?.querySelector<HTMLElement>(".agentkit-transcript");
    if (!saved || !scroller) return;
    scroller.scrollTop = saved.atBottom ? scroller.scrollHeight : saved.top;
  }, [visibleTabId]);
  const rememberTranscriptScroll = useCallback(
    (tabId: string, event: React.UIEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !target.classList.contains("agentkit-transcript") ||
        target.clientHeight === 0
      ) {
        return;
      }
      transcriptScrollRef.current.set(tabId, {
        top: target.scrollTop,
        atBottom:
          target.scrollHeight - target.scrollTop - target.clientHeight <= 2,
      });
    },
    [],
  );
  const chatRefs = useRef<Map<string, AssistantChatHandle>>(new Map());
  // Sends queued until their target thread is ready (see PendingDelivery).
  const pendingDeliveries = useRef<PendingDelivery[]>([]);
  const deliveryLanes = useRef(
    new Map<string, { delivery: PendingDelivery; handedOff: boolean }>(),
  );
  const pendingContextItems = useRef<Map<string, AgentChatContextItem[]>>(
    new Map(),
  );
  const [runningThreads, setRunningThreads] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [pageOverlayScrolled, setPageOverlayScrolled] = useState(false);
  const newThreadIds = useRef<Set<string>>(new Set());
  const observedThreadStarts = useRef(new Map<string, number>());
  const [, setThreadPersistenceVersion] = useState(0);
  const handleThreadSnapshotPersisted = useCallback(
    (threadId: string, messageCount: number) => {
      confirmThreadSnapshotPersisted(threadId);
      if (newThreadIds.current.delete(threadId)) {
        setThreadPersistenceVersion((version) => version + 1);
      }
      if (
        messageCount > 0 &&
        threadId === activeThreadIdRef.current &&
        urlThreadIdRef.current !== threadId
      ) {
        writeThreadUrl(threadId);
      }
    },
    [confirmThreadSnapshotPersisted, writeThreadUrl],
  );
  const latestNavigationRequestRef = useRef(0);

  useEffect(() => {
    setPageOverlayScrolled(false);
  }, [activeThreadId]);

  const handlePageOverlayScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const target = event.target;
      if (
        !renderOverlay ||
        !(target instanceof HTMLElement) ||
        !target.closest(".agentkit-transcript")
      ) {
        return;
      }
      setPageOverlayScrolled(target.scrollTop > 1);
    },
    [renderOverlay],
  );

  // ─── Model state ─────────────────────────────────────────────────────────
  // A host that supplies its own catalog owns the whole picker: the server
  // catalog must not be discovered or merged, or a host with no engine of its
  // own silently gets this app's models instead.
  const hostManagedModels = hostAvailableModels !== undefined;
  const [discoveredModels, setDiscoveredModels] = useState<EngineModelGroup[]>(
    [],
  );
  const [discoveredModelEngines, setDiscoveredModelEngines] = useState<
    Readonly<Record<string, ModelEngineConfig>>
  >({});
  const availableModels = hostAvailableModels ?? discoveredModels;
  const [discoveredModelsLoading, setModelListLoading] = useState(true);
  const [discoveredModelsError, setDiscoveredModelsError] = useState(false);
  const modelListLoading = hostManagedModels
    ? (hostModelListLoading ?? false)
    : discoveredModelsLoading;
  const modelListError = hostManagedModels
    ? (hostModelListError ?? false)
    : discoveredModelsError;
  const [defaultModel, setDefaultModel] = useState<string>(DEFAULT_MODEL);
  // Unset for host-managed models: the host's catalog names no app default.
  const [catalogDefault, setCatalogDefault] = useState<
    { model: string; engine?: string } | undefined
  >(undefined);
  const engineCatalogRequestRef = useRef(0);
  const threadModelRef = useRef<
    Map<string, { model: string; engine?: string; effort?: ReasoningEffort }>
  >(new Map());
  const [persistedModelSelection, setPersistedModelSelection] = useState<
    ModelSelection | undefined
  >(() => readStoredModelSelection(modelSelectionKey));
  const [modelSelectionVersion, setModelSelectionVersion] = useState(0);

  useEffect(() => {
    setPersistedModelSelection(readStoredModelSelection(modelSelectionKey));
  }, [modelSelectionKey]);

  const bumpModelSelectionVersion = useCallback(() => {
    setModelSelectionVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const syncPersistedSelection = (event?: Event) => {
      const detail = (event as CustomEvent<{ key?: string }> | undefined)
        ?.detail;
      if (detail?.key && detail.key !== modelSelectionKey) return;

      const next = readStoredModelSelection(modelSelectionKey);
      if (!next) return;

      const activeThreadId = activeThreadIdRef.current;
      if (activeThreadId) {
        threadModelRef.current.set(activeThreadId, next);
      }
      setPersistedModelSelection(next);
      bumpModelSelectionVersion();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === modelSelectionKey) syncPersistedSelection();
    };

    window.addEventListener(
      CHAT_MODEL_SELECTION_CHANGED_EVENT,
      syncPersistedSelection,
    );
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(
        CHAT_MODEL_SELECTION_CHANGED_EVENT,
        syncPersistedSelection,
      );
      window.removeEventListener("storage", handleStorage);
    };
  }, [bumpModelSelectionVersion, modelSelectionKey]);

  const postMessageSubmissionsDisabled = props.composerDisabled === true;

  const setContextInTab = useCallback(
    (
      threadId: string,
      item: AgentChatContextItem,
      options?: { focus?: boolean },
    ) => {
      if (
        filterAgentChatContextItems([item], contextNamespace, threadId)
          .length === 0
      ) {
        return;
      }
      const ref = chatRefs.current.get(threadId);
      if (ref) {
        ref.setComposerContextItem(item, options);
        return;
      }
      const existing = pendingContextItems.current.get(threadId) ?? [];
      const index = existing.findIndex((current) => current.key === item.key);
      const next =
        index === -1
          ? [...existing, item]
          : existing.map((current, currentIndex) =>
              currentIndex === index ? item : current,
            );
      pendingContextItems.current.set(threadId, next);
    },
    [contextNamespace],
  );

  const removeContextInTab = useCallback((threadId: string, key: string) => {
    const ref = chatRefs.current.get(threadId);
    if (ref) {
      ref.removeComposerContextItem(key);
      return;
    }
    const existing = pendingContextItems.current.get(threadId);
    if (!existing) return;
    const next = existing.filter((item) => item.key !== key);
    if (next.length === 0) {
      pendingContextItems.current.delete(threadId);
    } else {
      pendingContextItems.current.set(threadId, next);
    }
  }, []);

  const clearContextInTab = useCallback((threadId: string) => {
    const ref = chatRefs.current.get(threadId);
    if (ref) {
      ref.clearComposerContextItems();
      return;
    }
    pendingContextItems.current.delete(threadId);
  }, []);

  const resolveThreadModelSelection = useCallback(
    (threadId: string) =>
      resolveModelSelection(
        threadModelRef.current.get(threadId) ?? persistedModelSelection,
        availableModels,
        catalogDefault,
      ),
    [
      availableModels,
      catalogDefault,
      persistedModelSelection,
      modelSelectionVersion,
    ],
  );

  useEffect(() => {
    if (!onActiveModelEngineChange) return;
    const selection = activeThreadId
      ? resolveThreadModelSelection(activeThreadId)
      : undefined;
    const selectedModel = selection?.model ?? defaultModel;
    const engineName =
      selection?.engine ??
      availableModels.find((group) => group.models.includes(selectedModel))
        ?.engine;
    const hostEngineGroups = hostManagedModels
      ? availableModels.filter((group) => group.engine === engineName)
      : [];
    const hostSelectableModels = [
      ...new Set(hostEngineGroups.flatMap((group) => group.models)),
    ];
    const hostModelEngine =
      engineName && hostSelectableModels.length > 0
        ? {
            name: engineName,
            label: hostEngineGroups[0]?.label ?? engineName,
            defaultModel: hostSelectableModels.includes(selectedModel)
              ? selectedModel
              : hostSelectableModels[0]!,
            supportedModels: hostSelectableModels,
            selectableModels: hostSelectableModels,
          }
        : null;
    onActiveModelEngineChange(
      hostManagedModels
        ? hostModelEngine
        : engineName
          ? (discoveredModelEngines[engineName] ?? null)
          : null,
    );
  }, [
    activeThreadId,
    availableModels,
    defaultModel,
    discoveredModelEngines,
    hostManagedModels,
    onActiveModelEngineChange,
    resolveThreadModelSelection,
  ]);

  const persistModelSelection = useCallback(
    (selection: ModelSelection) => {
      setPersistedModelSelection(selection);
      writeStoredModelSelection(modelSelectionKey, selection);
    },
    [modelSelectionKey],
  );

  const handleModelChange = useCallback(
    (model: string, engine: string) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;
      const preferredAgentModel =
        isClaudeCodeAgentId(props.selectedAgent) && isLunaModel(model)
          ? resolvePreferredAgentModel(props.selectedAgent, availableModels)
          : undefined;
      const nextModel = preferredAgentModel?.model ?? model;
      const nextEngine = preferredAgentModel?.engine ?? engine;
      const existing = threadModelRef.current.get(threadId);
      const effort = resolveReasoningEffortSelection(
        nextModel,
        existing?.effort,
      );
      const selection = { model: nextModel, engine: nextEngine, effort };
      threadModelRef.current.set(threadId, selection);
      persistModelSelection(selection);
      bumpModelSelectionVersion();
    },
    [
      availableModels,
      bumpModelSelectionVersion,
      persistModelSelection,
      props.selectedAgent,
    ],
  );

  // A host that owns the model list still needs the internal selection updated:
  // `selectedModel`/`selectedEngine` render from it and submitted turns read it,
  // so routing a pick only to the host snaps the picker back to the previous
  // model and sends that one.
  const handleModelChangeWithHost = useCallback(
    (model: string, engine: string) => {
      handleModelChange(model, engine);
      hostOnModelChange?.(model, engine);
    },
    [handleModelChange, hostOnModelChange],
  );

  const handleEffortChange = useCallback(
    (effort: ReasoningEffort) => {
      const threadId = activeThreadIdRef.current;
      if (!threadId) return;
      const existing = resolveThreadModelSelection(threadId);
      const model = existing?.model ?? defaultModel;
      const engine =
        existing?.engine ??
        availableModels.find((group) => group.models.includes(model))?.engine ??
        availableModels[0]?.engine;
      const selection: ModelSelection = { model, effort };
      if (engine) selection.engine = engine;
      threadModelRef.current.set(threadId, selection);
      persistModelSelection(selection);
      bumpModelSelectionVersion();
    },
    [
      availableModels,
      bumpModelSelectionVersion,
      defaultModel,
      persistModelSelection,
      resolveThreadModelSelection,
    ],
  );

  useEffect(() => {
    const threadId = activeThreadIdRef.current;
    const current = threadId
      ? resolveThreadModelSelection(threadId)
      : persistedModelSelection;
    // Only correct a selection the agent cannot run. This effect re-runs on
    // every selection change, so an unconditional rewrite pins the picker and
    // each later user pick snaps straight back.
    const preferredAgentModel =
      isClaudeCodeAgentId(props.selectedAgent) &&
      isLunaModel(current?.model ?? "")
        ? resolvePreferredAgentModel(props.selectedAgent, availableModels)
        : undefined;
    if (!preferredAgentModel) return;

    if (
      current?.model === preferredAgentModel.model &&
      current.engine === preferredAgentModel.engine
    ) {
      return;
    }

    const selection = {
      model: preferredAgentModel.model,
      engine: preferredAgentModel.engine,
      effort: resolveReasoningEffortSelection(
        preferredAgentModel.model,
        current?.effort,
      ),
    };
    if (threadId) {
      threadModelRef.current.set(threadId, selection);
      bumpModelSelectionVersion();
    }
    persistModelSelection(selection);
  }, [
    availableModels,
    bumpModelSelectionVersion,
    persistedModelSelection,
    props.selectedAgent,
    persistModelSelection,
    resolveThreadModelSelection,
  ]);

  const refreshEngines = useCallback(() => {
    if (hostManagedModels) return;
    const requestId = ++engineCatalogRequestRef.current;
    const isCurrentRequest = () =>
      requestId === engineCatalogRequestRef.current;
    setDiscoveredModels((groups) =>
      groups.filter(
        (group) => group.engine !== CHATGPT_SUBSCRIPTION_ENGINE_NAME,
      ),
    );
    setModelListLoading(true);
    setDiscoveredModelsError(false);
    loadChatModelCatalog()
      .then((catalog) => {
        if (!isCurrentRequest()) return;
        if (catalog.state !== "available") {
          setDiscoveredModelsError(true);
          if (catalog.enginesUnavailable && !warnedEngineListUnavailable) {
            // Leaves `availableModels` empty for the session, so an override
            // with no engine of its own has nothing to resolve against.
            warnedEngineListUnavailable = true;
            console.warn(
              "[agent-chat] no engine list; model overrides cannot be catalog-resolved",
            );
          }
          return;
        }
        setDiscoveredModelsError(false);
        setDiscoveredModels(catalog.groups);
        setDiscoveredModelEngines(catalog.modelEngines);
        setDefaultModel(catalog.defaultModel);
        setCatalogDefault((current) =>
          current?.model === catalog.defaultModel &&
          current.engine === catalog.defaultEngine
            ? current
            : {
                model: catalog.defaultModel,
                ...(catalog.defaultEngine === undefined
                  ? {}
                  : { engine: catalog.defaultEngine }),
              },
        );
        void catalog.loadLiveGroups().then((liveGroups) => {
          if (isCurrentRequest() && liveGroups) {
            setDiscoveredModels(liveGroups);
            setDiscoveredModelEngines((current) => {
              const next = { ...current };
              for (const group of liveGroups) {
                const engine = next[group.engine];
                if (engine) {
                  next[group.engine] = {
                    ...engine,
                    supportedModels: group.models,
                    selectableModels: group.models,
                  };
                }
              }
              return next;
            });
          }
        });
      })
      .catch(() => {
        if (isCurrentRequest()) setDiscoveredModelsError(true);
      })
      .finally(() => {
        if (isCurrentRequest()) setModelListLoading(false);
      });
  }, [hostManagedModels]);

  useEffect(() => {
    refreshEngines();
    window.addEventListener("agent-engine:configured-changed", refreshEngines);
    return () => {
      window.removeEventListener(
        "agent-engine:configured-changed",
        refreshEngines,
      );
      engineCatalogRequestRef.current += 1;
    };
  }, [refreshEngines]);

  // Parent-child thread mapping — persisted to localStorage.
  // Maps childThreadId → parentThreadId for sub-agent tabs.
  const PARENT_MAP_KEY = `agent-chat-parent-map${keyPrefix}`;
  const LEGACY_PARENT_MAP_KEY = `agent-chat-parent-map${legacyKeyPrefix}`;
  const [parentMap, setParentMap] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(PARENT_MAP_KEY);
      const legacySaved =
        saved === null && PARENT_MAP_KEY !== LEGACY_PARENT_MAP_KEY
          ? localStorage.getItem(LEGACY_PARENT_MAP_KEY)
          : null;
      const raw = saved ?? legacySaved;
      if (raw) return JSON.parse(raw);
    } catch {
      // coercion-ok: unavailable or malformed localStorage is absent metadata.
    }
    return {};
  });
  const parentMapRef = useRef(parentMap);
  parentMapRef.current = parentMap;
  const dismissedSubAgentTabsRef = useRef<Set<string>>(new Set());

  // Persist parent map to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(PARENT_MAP_KEY, JSON.stringify(parentMap));
    } catch {}
  }, [parentMap, PARENT_MAP_KEY]);

  // AgentKit message forks are distinct from Agent Team child tabs. Keep their
  // lineage separate so fork navigation never changes sub-agent semantics.
  const FORK_PARENT_MAP_KEY = `agent-chat-fork-parent-map${keyPrefix}`;
  const [forkParentMap, setForkParentMap] = useState<Record<string, string>>(
    () => {
      try {
        const raw = localStorage.getItem(FORK_PARENT_MAP_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return {};
        }
        const next: Record<string, string> = {};
        for (const [child, parent] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (
            child &&
            typeof parent === "string" &&
            parent &&
            child !== parent
          ) {
            next[child] = parent;
          }
        }
        return next;
      } catch (error) {
        console.warn("Could not read stored AgentKit fork lineage.", error);
        return {};
      }
    },
  );

  useEffect(() => {
    try {
      localStorage.setItem(FORK_PARENT_MAP_KEY, JSON.stringify(forkParentMap));
    } catch (error) {
      console.warn("Could not persist AgentKit fork lineage.", error);
    }
  }, [forkParentMap, FORK_PARENT_MAP_KEY]);

  // Sub-agent display names — persisted to localStorage.
  // Maps childThreadId → short name (e.g. "Research", "Draft email").
  const SUB_AGENT_NAMES_KEY = `agent-chat-sub-agent-names${keyPrefix}`;
  const LEGACY_SUB_AGENT_NAMES_KEY = `agent-chat-sub-agent-names${legacyKeyPrefix}`;
  const [subAgentNames, setSubAgentNames] = useState<Record<string, string>>(
    () => {
      try {
        const saved = localStorage.getItem(SUB_AGENT_NAMES_KEY);
        const legacySaved =
          saved === null && SUB_AGENT_NAMES_KEY !== LEGACY_SUB_AGENT_NAMES_KEY
            ? localStorage.getItem(LEGACY_SUB_AGENT_NAMES_KEY)
            : null;
        const raw = saved ?? legacySaved;
        if (raw) return JSON.parse(raw);
      } catch {}
      return {};
    },
  );
  const subAgentNamesRef = useRef(subAgentNames);
  subAgentNamesRef.current = subAgentNames;
  const [subAgentStatuses, setSubAgentStatuses] = useState<
    Record<string, AgentTeamRunStatus>
  >({});

  useEffect(() => {
    try {
      localStorage.setItem(SUB_AGENT_NAMES_KEY, JSON.stringify(subAgentNames));
    } catch {}
  }, [subAgentNames, SUB_AGENT_NAMES_KEY]);

  // Open tabs — persisted to localStorage so they survive refresh.
  // Per-scope, for the same reason the active thread is: the tab list must
  // follow the resource in view, so one resource's tabs never stay mounted
  // (and rebroadcasting their run state) while another resource is open.
  const scopeKeyPart = scope ? `:scope:${scope.type}:${scope.id}` : "";
  const OPEN_TABS_KEY = `agent-chat-open-tabs${keyPrefix}${scopeKeyPart}`;
  const LEGACY_OPEN_TABS_KEY = `agent-chat-open-tabs${legacyKeyPrefix}${scopeKeyPart}`;
  const readStoredOpenTabs = useCallback((): string[] | undefined => {
    try {
      const saved = localStorage.getItem(OPEN_TABS_KEY);
      const legacySaved =
        saved === null && OPEN_TABS_KEY !== LEGACY_OPEN_TABS_KEY
          ? localStorage.getItem(LEGACY_OPEN_TABS_KEY)
          : null;
      const raw = saved ?? legacySaved;
      if (raw === null) return undefined;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return undefined;
      const deduped = dedupeIds(parsed);
      for (const id of deduped) mountedTabsRef.current.add(id);
      return deduped;
    } catch {
      // coercion-ok: unavailable or malformed localStorage is an absent tab list.
    }
    return undefined;
  }, [LEGACY_OPEN_TABS_KEY, OPEN_TABS_KEY]);
  const [openTabIds, setOpenTabIdsRaw] = useState<string[]>(() => {
    if (!restoreActiveThread && activeThreadId) {
      for (const id of [activeThreadId]) mountedTabsRef.current.add(id);
      return [activeThreadId];
    }
    const restored = readStoredOpenTabs();
    if (restored && restored.length > 0) return restored;
    return [];
  });

  // Every writer routes through here so a duplicate id can never reach state.
  // A `.includes()` guard evaluated outside the updater cannot prevent one: a
  // synchronous burst of writes (the mount-time replay of buffered open
  // requests dispatches its whole backlog in one loop) has every handler read
  // the same pre-render list, so each one appends. Two tab-bar entries then
  // share a single thread id and `closeTab`'s filter removes both at once.
  // Returning `prev` unchanged is load-bearing, not an optimization — callers
  // rely on identity bail-outs to keep effects that depend on `openTabIds`
  // from re-running forever.
  const setOpenTabIds = useCallback((value: React.SetStateAction<string[]>) => {
    setOpenTabIdsRaw((prev) => {
      const next = dedupeIds(typeof value === "function" ? value(prev) : value);
      return next.length === prev.length &&
        next.every((id, i) => id === prev[i])
        ? prev
        : next;
    });
  }, []);
  const openTabIdsRef = useRef(openTabIds);
  openTabIdsRef.current = openTabIds;
  const initializedRef = useRef(false);

  // Rehydrate open tabs when the scope flips. Read the new key before the
  // persistence effect can write the current (now-wrong) tab list under it.
  const openTabsKeyRef = useRef(OPEN_TABS_KEY);
  useEffect(() => {
    if (openTabsKeyRef.current === OPEN_TABS_KEY) return;
    openTabsKeyRef.current = OPEN_TABS_KEY;
    initializedRef.current = false;
    if (!restoreActiveThread) {
      setOpenTabIds(activeThreadId ? [activeThreadId] : []);
      return;
    }
    const restored = readStoredOpenTabs();
    if (restored) {
      setOpenTabIds(restored);
      return;
    }
    setOpenTabIds([]);
  }, [OPEN_TABS_KEY, activeThreadId, readStoredOpenTabs, restoreActiveThread]);

  useBrowserLayoutEffect(() => {
    const nextScope = scope;
    if (!nextScope) return;
    const item = buildResourceContextItem(nextScope, contextNamespace);
    const marker = `Resource context: ${nextScope.type}:${nextScope.id}`;
    const existing = getAgentChatContextState().items.find(
      (current) => current.key === item.key,
    );
    const ownsContextItem =
      !existing || existing.context.startsWith("Resource context:");
    if (ownsContextItem)
      setAgentChatContextItem({ ...item, openSidebar: false, focus: false });
    return () => {
      const current = getAgentChatContextState().items.find(
        (candidate) => candidate.key === item.key,
      );
      if (ownsContextItem && current?.context.startsWith(marker)) {
        removeAgentChatContextItem(item.key);
      }
    };
  }, [contextNamespace, scope?.contextKey, scope?.id, scope?.type]);

  useBrowserLayoutEffect(() => {
    const nextScope = scope;
    if (!nextScope) return;
    const item = buildResourceContextItem(nextScope, contextNamespace);
    const marker = `Resource context: ${nextScope.type}:${nextScope.id}`;
    const targetChanged =
      nextScope.contextVersion !== undefined &&
      lastResourceContextVersionRef.current !== nextScope.contextVersion;
    if (nextScope.contextVersion !== undefined) {
      lastResourceContextVersionRef.current = nextScope.contextVersion;
    }
    const existing = getAgentChatContextState().items.find(
      (current) => current.key === item.key,
    );
    if (!existing) {
      if (!targetChanged) return;
    } else if (!existing.context.startsWith(marker)) {
      return;
    }
    if (
      existing &&
      existing.title === item.title &&
      existing.context === item.context &&
      existing.contextNamespace === item.contextNamespace
    ) {
      return;
    }
    setAgentChatContextItem({ ...item, openSidebar: false, focus: false });
  }, [
    contextNamespace,
    scope?.contextKey,
    scope?.contextVersion,
    scope?.id,
    scope?.label,
    scope?.type,
  ]);

  // Persist open tab IDs to localStorage (exclude sub-agent tabs — they're session-only)
  useEffect(() => {
    if (openTabsKeyRef.current !== OPEN_TABS_KEY) return;
    const mainTabs = openTabIds.filter((id) => !parentMap[id]);
    if (mainTabs.length > 0) {
      try {
        localStorage.setItem(OPEN_TABS_KEY, JSON.stringify(mainTabs));
      } catch {}
    }
  }, [openTabIds, parentMap, OPEN_TABS_KEY]);

  // Initialize open tabs once threads load — validate saved tabs still exist
  useEffect(() => {
    if (initializedRef.current || !activeThreadId || threads.length === 0)
      return;
    initializedRef.current = true;
    const threadIds = new Set(threads.map((t) => t.id));
    const threadMap = new Map(threads.map((t) => [t.id, t]));

    // Hide tabs that have had no activity for more than 12 hours. Stale tabs
    // are removed from the sidebar on load but remain accessible via history.
    const now = Date.now();
    const isStale = (id: string) => {
      const thread = threadMap.get(id);
      return thread
        ? now - thread.updatedAt > STALE_THREAD_THRESHOLD_MS
        : false;
    };

    // If the active thread is a sub-agent, switch to its parent or the most recent main thread
    if (parentMap[activeThreadId]) {
      const parent = parentMap[activeThreadId];
      if (parent && threadIds.has(parent)) {
        switchThread(parent);
      } else {
        // Fall back to most recent main thread
        const mainThread = threads.find((t) => !parentMap[t.id]);
        if (mainThread) switchThread(mainThread.id);
      }
    }

    setOpenTabIds((prev) => {
      // Filter out tabs that no longer exist, sub-agent tabs, or stale tabs (>12h inactive)
      const valid = prev.filter(
        (id) => threadIds.has(id) && !parentMap[id] && !isStale(id),
      );
      // Ensure active thread is included (only if it's not a sub-agent and not stale)
      if (
        !parentMap[activeThreadId] &&
        !valid.includes(activeThreadId) &&
        !isStale(activeThreadId)
      ) {
        valid.push(activeThreadId);
      }
      return valid;
    });

    // If active thread is stale, start fresh
    if (!parentMap[activeThreadId] && isStale(activeThreadId)) {
      void createThread().then((id) => {
        if (id) writeThreadUrl(null);
      });
    }
  }, [
    activeThreadId,
    threads,
    parentMap,
    switchThread,
    createThread,
    writeThreadUrl,
  ]);

  // Ensure active thread is always in open tabs.
  // Use functional update to check inside the setter — avoids race with the
  // initialization effect that may have already added the ID in the same batch.
  //
  // Re-check after tab-list resets so the sidebar cannot end up with a live
  // active thread but no mounted chat.
  useEffect(() => {
    if (!activeThreadId || openTabIds.includes(activeThreadId)) return;
    if (parentMap[activeThreadId]) return;

    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    if (
      activeThread &&
      Date.now() - activeThread.updatedAt > STALE_THREAD_THRESHOLD_MS
    ) {
      return;
    }

    setOpenTabIds((prev) =>
      prev.includes(activeThreadId) ? prev : [...prev, activeThreadId],
    );
  }, [activeThreadId, openTabIds, parentMap, threads]);

  // Ensure at least one tab is always open — auto-create if sidebar is empty.
  // Skipped when an active thread already exists (e.g. the hook generated an
  // optimistic id for a brand-new session); the activeThreadId effect above
  // adds it to openTabIds without spinning up a duplicate thread.
  const autoCreatingRef = useRef(false);
  const restoreFailureReplacementInFlightRef = useRef<string | null>(null);
  const lastTabReplacementInFlightRef = useRef(false);
  useEffect(() => {
    if (
      isLoading ||
      !restoredThreadIdOnListFailure ||
      activeThreadId !== restoredThreadIdOnListFailure ||
      restoreFailureReplacementInFlightRef.current ===
        restoredThreadIdOnListFailure
    ) {
      return;
    }

    restoreFailureReplacementInFlightRef.current =
      restoredThreadIdOnListFailure;
    void createThread().then((id) => {
      if (!id) {
        restoreFailureReplacementInFlightRef.current = null;
        return;
      }
      newThreadIds.current.add(id);
      setOpenTabIds([id]);
      writeThreadUrl(null, { replace: true });
    });
  }, [
    activeThreadId,
    createThread,
    isLoading,
    restoredThreadIdOnListFailure,
    writeThreadUrl,
  ]);

  useEffect(() => {
    if (isLoading || autoCreatingRef.current) return;
    if (openTabIds.length === 0 && !activeThreadId) {
      autoCreatingRef.current = true;
      void createThread().then((id) => {
        autoCreatingRef.current = false;
        if (id) {
          newThreadIds.current.add(id);
          setOpenTabIds([id]);
          writeThreadUrl(null, { replace: true });
        }
      });
    }
  }, [isLoading, openTabIds, activeThreadId, createThread, writeThreadUrl]);

  usePollLoop(
    async (signal) => {
      const runsUrl = `${apiUrl.replace(/\/$/, "")}/runs/list?goalId=agent-team`;
      try {
        const res = await fetch(runsUrl, { signal });
        if (res.ok) {
          const data = (await res.json()) as { runs?: AgentTeamRunSummary[] };
          const infos = Array.isArray(data.runs)
            ? data.runs
                .map(runToAgentTeamTabInfo)
                .filter((info): info is AgentTeamTabInfo => Boolean(info))
            : [];

          setSubAgentStatuses((prev) => {
            let changed = false;
            const next: Record<string, AgentTeamRunStatus> = {};
            for (const info of infos) {
              next[info.threadId] = info.status;
              if (prev[info.threadId] !== info.status) changed = true;
            }
            if (Object.keys(prev).length !== Object.keys(next).length) {
              changed = true;
            }
            return changed ? next : prev;
          });

          const openSet = new Set(openTabIdsRef.current);
          const candidates = infos.filter(
            (info) =>
              !dismissedSubAgentTabsRef.current.has(info.threadId) &&
              (openSet.has(info.parentThreadId) || openSet.has(info.threadId)),
          );

          if (candidates.length > 0) {
            const shouldRefreshThreads = candidates.some(
              (info) =>
                !openSet.has(info.threadId) && openSet.has(info.parentThreadId),
            );
            const candidateParents = new Map(
              candidates.map((info) => [info.threadId, info.parentThreadId]),
            );
            setParentMap((prev) => {
              let next = prev;
              for (const info of candidates) {
                if (next[info.threadId] === info.parentThreadId) continue;
                next =
                  next === prev
                    ? { ...prev, [info.threadId]: info.parentThreadId }
                    : { ...next, [info.threadId]: info.parentThreadId };
              }
              return next;
            });
            setSubAgentNames((prev) => {
              let next = prev;
              for (const info of candidates) {
                if (!info.name || next[info.threadId] === info.name) continue;
                next =
                  next === prev
                    ? { ...prev, [info.threadId]: info.name }
                    : { ...next, [info.threadId]: info.name };
              }
              return next;
            });

            setOpenTabIds((prev) => {
              let next = prev;
              for (const info of candidates) {
                if (next.includes(info.threadId)) continue;
                const parentIdx = next.indexOf(info.parentThreadId);
                if (parentIdx === -1) continue;
                if (next === prev) next = [...prev];
                let insertIdx = parentIdx + 1;
                while (insertIdx < next.length) {
                  const siblingParent =
                    parentMapRef.current[next[insertIdx]] ||
                    candidateParents.get(next[insertIdx]);
                  if (siblingParent !== info.parentThreadId) break;
                  insertIdx++;
                }
                next.splice(insertIdx, 0, info.threadId);
              }
              return next;
            });
            if (shouldRefreshThreads) {
              refreshThreads();
            }
          }
        }
      } catch {
        // Best effort: task cards and manual history still work if this poll fails.
      }
    },
    { intervalMs: agentTeamPollMs, pauseWhenHidden: true },
  );

  // Focus the composer when switching tabs
  useEffect(() => {
    if (!activeThreadId) return;
    // Small delay to ensure the tab is visible before focusing
    const t = setTimeout(() => {
      chatRefs.current.get(activeThreadId)?.focusComposer();
    }, 50);
    return () => clearTimeout(t);
  }, [activeThreadId]);

  // Ref callback: scroll the active tab into view in the overflow container.
  // Uses getBoundingClientRect for reliable positioning regardless of offsetParent.
  // A margin keeps the active tab from sitting flush against either container
  // edge — at the right edge it was landing directly under the +/history/menu
  // buttons, which visually clipped the tab label.
  const activeTabRefCb = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const container = el.parentElement;
    if (!container) return;
    const MARGIN = 24;
    requestAnimationFrame(() => {
      const containerRect = container.getBoundingClientRect();
      const tabRect = el.getBoundingClientRect();
      if (tabRect.left < containerRect.left + MARGIN) {
        container.scrollLeft += tabRect.left - containerRect.left - MARGIN;
      } else if (tabRect.right > containerRect.right - MARGIN) {
        container.scrollLeft += tabRect.right - containerRect.right + MARGIN;
      }
    });
  }, []);

  const [messageCounts, setMessageCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(threads.map((t) => [t.id, t.messageCount ?? 0])),
  );

  // Sync message counts from threads when they load
  useEffect(() => {
    if (threads.length > 0) {
      setMessageCounts((prev) => {
        const next = { ...prev };
        for (const t of threads) {
          if (!(t.id in next)) {
            next[t.id] = t.messageCount ?? 0;
          }
        }
        return next;
      });
    }
  }, [threads]);

  const flushPendingDeliveries = useCallback<
    (onlyThreadId?: string, immediate?: boolean) => void
  >(
    (onlyThreadId, immediate = false) => {
      for (const delivery of [...pendingDeliveries.current]) {
        if (
          delivery.send.submissionExpiresAt === undefined ||
          delivery.send.submissionExpiresAt > Date.now()
        ) {
          continue;
        }
        pendingDeliveries.current = pendingDeliveries.current.filter(
          (pending) => pending !== delivery,
        );
        reportAgentChatSubmitResult(
          delivery.send.submitMessageId,
          false,
          "submission-expired",
        );
        cancelAgentChatSubmit(delivery.send.submitMessageId);
      }
      const active = activeThreadIdRef.current;
      for (const delivery of pendingDeliveries.current) {
        if (delivery.threadId === null && active) delivery.threadId = active;
      }
      for (const delivery of [...pendingDeliveries.current]) {
        if (!pendingDeliveries.current.includes(delivery)) continue;
        const threadId = delivery.threadId;
        if (!threadId || (onlyThreadId && threadId !== onlyThreadId)) continue;
        const owner = deliveryLanes.current.get(threadId);
        if (
          owner &&
          !owner.handedOff &&
          !pendingDeliveries.current.includes(owner.delivery)
        )
          deliveryLanes.current.delete(threadId);
        if (deliveryLanes.current.has(threadId)) continue;
        if (
          isAgentChatSubmitCancelled(delivery.send.submitMessageId) ||
          delivery.isCurrent?.() === false
        ) {
          pendingDeliveries.current = pendingDeliveries.current.filter(
            (pending) => pending !== delivery,
          );
          continue;
        }
        if (!chatRefs.current.has(threadId)) continue;
        if (delivery.modelOverride) {
          threadModelRef.current.set(threadId, delivery.modelOverride);
          delete delivery.modelOverride;
          bumpModelSelectionVersion();
          // The tab's handle still holds the previous selection and send gate
          // until it re-renders; the version bump re-runs this flush after that.
          continue;
        }
        if (
          delivery.send.submit &&
          !hostManagedModels &&
          modelListLoading &&
          !resolveThreadModelSelection(threadId)
        )
          continue;
        const lane = { delivery, handedOff: false };
        deliveryLanes.current.set(threadId, lane);
        if (!delivery.targetReported) {
          delivery.targetReported = true;
          reportAgentChatSubmitTarget(delivery.send.submitMessageId, threadId);
        }
        if (
          deliveryLanes.current.get(threadId) !== lane ||
          !pendingDeliveries.current.includes(delivery)
        ) {
          if (deliveryLanes.current.get(threadId) === lane)
            deliveryLanes.current.delete(threadId);
          continue;
        }
        const deliver = () => {
          if (deliveryLanes.current.get(threadId) !== lane) return;
          const index = pendingDeliveries.current.indexOf(delivery);
          const ref = chatRefs.current.get(threadId);
          if (index < 0 || !ref) {
            deliveryLanes.current.delete(threadId);
            return;
          }
          const waitForPrefill =
            !delivery.send.submit && !!delivery.send.prefillContext;
          let awaitingPrefill = waitForPrefill;
          let delivered = false;
          if (!waitForPrefill) pendingDeliveries.current.splice(index, 1);
          lane.handedOff = true;
          const onHandoff = (result: boolean) => {
            if (
              !isCurrent() ||
              isAgentChatSubmitCancelled(delivery.send.submitMessageId)
            )
              return false;
            awaitingPrefill = false;
            delivered = result;
            pendingDeliveries.current = pendingDeliveries.current.filter(
              (pending) => pending !== delivery,
            );
            return true;
          };
          const isCurrent = () =>
            mountedRef.current &&
            deliveryLanes.current.get(threadId) === lane &&
            (!awaitingPrefill ||
              pendingDeliveries.current.includes(delivery)) &&
            delivery.isCurrent?.() !== false;
          let finished = false;
          const finish = (notify = true) => {
            if (finished) return;
            finished = true;
            const current = isCurrent();
            pendingDeliveries.current = pendingDeliveries.current.filter(
              (pending) => pending !== delivery,
            );
            try {
              if (current && notify) delivery.onResult?.(delivered);
            } finally {
              if (deliveryLanes.current.get(threadId) === lane)
                deliveryLanes.current.delete(threadId);
              if (mountedRef.current) flushPendingDeliveries(threadId);
            }
          };
          try {
            if (!isCurrent()) {
              finish(false);
              return;
            }
            const completion = deliverPendingSend(
              ref,
              delivery.send,
              isCurrent,
              onHandoff,
            );
            if (waitForPrefill && completion)
              void completion.then(() => finish());
            else finish();
          } catch (error) {
            finish(false);
            throw error;
          }
        };
        if (immediate) deliver();
        else setTimeout(deliver, 50);
      }
    },
    [
      bumpModelSelectionVersion,
      hostManagedModels,
      modelListLoading,
      resolveThreadModelSelection,
    ],
  );

  // Listen for builder.submitChat postMessages
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!isTrustedFrameMessage(event)) return;
      if (event.data?.type === AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE) {
        const item = normalizeAgentChatContextItem(event.data.data);
        if (!item) return;
        const openSidebar = event.data.data?.openSidebar as boolean | undefined;
        if (openSidebar !== false) {
          window.dispatchEvent(new CustomEvent("agent-panel:open"));
        }
        if (postMessageSubmissionsDisabled) return;
        const currentTabId = activeThreadIdRef.current;
        if (!currentTabId) return;
        // Focus defaults to true; a caller opts out with `focus: false` for
        // passive context (e.g. a canvas selection) so staging never steals
        // focus from an in-progress inline editor.
        const focus = (event.data.data?.focus as boolean | undefined) !== false;
        setContextInTab(currentTabId, item, { focus });
        return;
      }
      if (event.data?.type === AGENT_CHAT_REMOVE_CONTEXT_MESSAGE_TYPE) {
        const key =
          typeof event.data.data?.key === "string"
            ? event.data.data.key.trim()
            : "";
        if (!key) return;
        const openSidebar = event.data.data?.openSidebar as boolean | undefined;
        if (openSidebar === true) {
          window.dispatchEvent(new CustomEvent("agent-panel:open"));
        }
        if (postMessageSubmissionsDisabled) return;
        const currentTabId = activeThreadIdRef.current;
        if (!currentTabId) return;
        removeContextInTab(currentTabId, key);
        return;
      }
      if (event.data?.type === AGENT_CHAT_CLEAR_CONTEXT_MESSAGE_TYPE) {
        const openSidebar = event.data.data?.openSidebar as boolean | undefined;
        if (openSidebar === true) {
          window.dispatchEvent(new CustomEvent("agent-panel:open"));
        }
        if (postMessageSubmissionsDisabled) return;
        const currentTabId = activeThreadIdRef.current;
        if (!currentTabId) return;
        clearContextInTab(currentTabId);
        return;
      }
      const parsed = parseSubmitChatMessage(event);
      if (!parsed) return;
      // Dedup the live post against the cold-start replay; first one wins.
      if (!claimAgentChatSubmit(parsed.submitMessageId)) return;
      const {
        message,
        context,
        contextLabel,
        openSidebar,
        model,
        engine,
        effort,
        newTab,
        targetTabId,
        reuseEmptyTab,
        background,
        submit,
        images,
        attachments,
        submitMessageId,
        usageLabel,
        actionScope,
        approvedToolCalls,
        surface,
      } = parsed;
      const requestedTabId = parsed.tabId;
      const { requestMode } = parsed;

      // Make sure the sidebar is visible to show the response, unless the
      // caller explicitly opted out or it's a background send.
      if (openSidebar !== false && !background) {
        window.dispatchEvent(new CustomEvent("agent-panel:open"));
      }
      if (postMessageSubmissionsDisabled) {
        reportAgentChatSubmitResult(
          submitMessageId,
          false,
          "composer-disabled",
        );
        return;
      }

      // Plan mode is sent as request metadata by the chat adapter. Keep the
      // user-visible message clean so mode instructions never enter history.
      const prefillContext =
        context && !submit
          ? {
              key: PREFILL_CONTEXT_KEY,
              title: contextLabel ?? translate("composer.activeAppContext"),
              context,
              ...(contextNamespace ? { contextNamespace } : {}),
            }
          : undefined;
      // Checked the way a submit serializes it, so an accepted prefill cannot make
      // every later submit fail. Refused as a whole, before the draft changes.
      if (prefillContext && !composerContextFits([prefillContext])) {
        reportAgentChatSubmitResult(
          submitMessageId,
          false,
          "context-too-large",
        );
        return;
      }
      const fullMessage =
        context && submit
          ? appendAgentChatContextToMessage(message, context)
          : message;

      const send: PendingSend = {
        message: fullMessage,
        ...(prefillContext ? { prefillContext } : {}),
        images,
        attachments,
        submit,
        ...(background ? { trackInRunsTray: true } : {}),
        ...(requestMode ? { requestMode } : {}),
        ...(submitMessageId ? { submitMessageId } : {}),
        ...(usageLabel ? { usageLabel } : {}),
        ...(actionScope ? { actionScope } : {}),
        ...(typeof parsed.submissionExpiresAt === "number"
          ? { submissionExpiresAt: parsed.submissionExpiresAt }
          : {}),
        ...(approvedToolCalls ? { approvedToolCalls } : {}),
        ...(surface ? { surface } : {}),
      };
      // Resolved once, up front, and carried with the send until a thread
      // exists to key it by. Applying it only when `model` matched
      // `availableModels` dropped every override that arrived before the
      // engines fetch resolved — and the cold-start replay below runs at mount,
      // when that list is always still empty.
      let modelOverride: ModelSelection | undefined;
      if (model) {
        const catalogEngine = availableModels.find((g) =>
          g.models.includes(model),
        )?.engine;
        const overrideEngine = engine ?? catalogEngine;
        if (!overrideEngine && availableModels.length > 0) {
          console.warn(
            `[agent-chat] model override "${model}" is in no engine group and carries no engine; the server will substitute its default`,
          );
        }
        modelOverride = {
          model,
          ...(overrideEngine ? { engine: overrideEngine } : {}),
          effort: resolveReasoningEffortSelection(
            model,
            isReasoningEffort(effort) ? effort : undefined,
          ),
        };
      }

      const sendToTab = (threadId: string) => {
        if (isAgentChatSubmitCancelled(submitMessageId)) return;
        pendingDeliveries.current.push({
          threadId,
          send,
          modelOverride,
          targetReported: true,
        });
        reportAgentChatSubmitTarget(submitMessageId, threadId);
        flushPendingDeliveries(threadId, true);
      };

      if (targetTabId) {
        if (!openTabIds.includes(targetTabId)) {
          mountedTabsRef.current.add(targetTabId);
          setOpenTabIds((prev) =>
            prev.includes(targetTabId) ? prev : [...prev, targetTabId],
          );
        }
        if (!chatRefs.current.has(targetTabId)) {
          switchThread(targetTabId);
        }
        sendToTab(targetTabId);
      } else if (newTab) {
        const previousTabId = activeThreadIdRef.current;
        const previousChat = previousTabId
          ? chatRefs.current.get(previousTabId)
          : undefined;
        // A blank active chat is already an isolated destination. Reuse it for
        // foreground creation requests so the action does not leave a ghost tab.
        if (
          reuseEmptyTab &&
          !background &&
          previousTabId &&
          previousChat &&
          (newThreadIds.current.has(previousTabId) ||
            isNewThread(previousTabId)) &&
          previousChat.exportThreadSnapshot() === null
        ) {
          sendToTab(previousTabId);
          return;
        }
        createThread(requestedTabId)
          .then((newId) => {
            if (isAgentChatSubmitCancelled(submitMessageId)) return;
            if (!newId) {
              reportAgentChatSubmitResult(
                submitMessageId,
                false,
                "thread-create-failed",
              );
              return;
            }
            newThreadIds.current.add(newId);
            if (background) {
              mountedTabsRef.current.add(newId);
            }
            setOpenTabIds((prev) =>
              prev.includes(newId) ? prev : [...prev, newId],
            );
            if (!background) {
              writeThreadUrl(newId);
            }
            sendToTab(newId);
            if (background && previousTabId) {
              switchThreadState(previousTabId);
            }
          })
          .catch(() => {
            reportAgentChatSubmitResult(
              submitMessageId,
              false,
              "thread-create-failed",
            );
          });
      } else {
        const currentTabId = activeThreadIdRef.current;
        if (currentTabId) {
          sendToTab(currentTabId);
        } else {
          // Cold start: no thread yet. Queue for the first active thread (the
          // bootstrap effect creates it) rather than racing a second create.
          pendingDeliveries.current.push({
            threadId: null,
            send,
            modelOverride,
          });
        }
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [
    availableModels,
    bumpModelSelectionVersion,
    clearContextInTab,
    contextNamespace,
    createThread,
    flushPendingDeliveries,
    isNewThread,
    openTabIds,
    postMessageSubmissionsDisabled,
    removeContextInTab,
    setContextInTab,
    switchThread,
    switchThreadState,
    writeThreadUrl,
  ]);

  // Replay submits posted before this lazy panel's listener attached. Dedup in
  // the handler keeps a live + replayed message single.
  useEffect(() => {
    const buffered = drainBufferedAgentChatSubmits();
    for (const data of buffered) {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "agentNative.submitChat", data },
          origin: window.location.origin,
        }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush queued context items and sends once their thread's ref is mounted.
  useEffect(() => {
    for (const [tabId, items] of pendingContextItems.current) {
      const ref = chatRefs.current.get(tabId);
      if (!ref) continue;
      for (const item of items) ref.setComposerContextItem(item);
      pendingContextItems.current.delete(tabId);
    }

    flushPendingDeliveries();
  }, [openTabIds, activeThreadId, flushPendingDeliveries]);

  // Listen for chatRunning completion events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const { isRunning, tabId } = detail;
      if (!tabId) return;
      if (isRunning) observedThreadStarts.current.set(tabId, Date.now());

      setRunningThreads((prev) => {
        if (prev.has(tabId) === Boolean(isRunning)) return prev;
        const next = new Set(prev);
        if (isRunning) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    };
    window.addEventListener("agentNative.chatRunning", handler);
    return () => window.removeEventListener("agentNative.chatRunning", handler);
  }, []);

  const addTab = useCallback(async () => {
    const id = await createThread();
    if (id) {
      newThreadIds.current.add(id);
      // `createThread` advances the active thread before its promise resolves.
      // Add the same id in this transaction so a new chat is mounted even if
      // the active-thread reconciliation effect has not run yet.
      setOpenTabIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      writeThreadUrl(null);
    }
    return id;
  }, [createThread, setOpenTabIds, writeThreadUrl]);

  const awaitingNavigationHandles = useRef(new Set<string>());
  const pendingNavigations = useRef(
    new Map<
      AgentChatNavigationKey,
      { event: Event; targetId: string; generation: number }
    >(),
  );
  const navigationChangeRef = useRef(onNavigationChange);
  navigationChangeRef.current = onNavigationChange;
  const [navigationSettlements, setNavigationSettlements] = useState<
    {
      event: Event;
      outcome: Exclude<ChatNavigationOutcome, "started">;
      targetId?: string;
      prefill?: string;
    }[]
  >([]);
  const [navigationHandleVersion, setNavigationHandleVersion] = useState(0);
  const queuedPrefills = useRef(new WeakSet<object>());
  const settleNavigation = useCallback(
    (
      event: Event,
      outcome: Exclude<ChatNavigationOutcome, "started">,
      targetId?: string,
      prefill?: string,
    ) => {
      if (!pendingNavigations.current.has(getAgentChatNavigationKey(event)))
        return;
      setNavigationSettlements((prev) => [
        ...prev,
        { event, outcome, targetId, prefill },
      ]);
    },
    [],
  );
  const startNavigation = useCallback(
    (event: Event, targetId: string) => {
      const previous = [...pendingNavigations.current.values()];
      const navigation = {
        event,
        targetId,
        generation: ++latestNavigationRequestRef.current,
      };
      pendingNavigations.current.set(
        getAgentChatNavigationKey(event),
        navigation,
      );
      for (const retired of previous)
        settleNavigation(retired.event, "superseded");
      navigationChangeRef.current?.(event, "started");
      return navigation;
    },
    [settleNavigation],
  );
  const mountedRef = useRef(true);
  const pendingTabClosures = useRef(
    new Set<{
      tabIds: string[];
      cancelled: { event: Event; targetId: string; generation: number }[];
      deliveries: PendingDelivery[];
      outcome: "closed" | "missing";
      publications: (() => void)[];
      ready: boolean;
    }>(),
  );
  const tabsClosingRef = useRef(onTabsClosing);
  tabsClosingRef.current = onTabsClosing;
  const tabsClosedRef = useRef(onTabsClosed);
  tabsClosedRef.current = onTabsClosed;
  const cancelTabNavigations = useCallback(
    (tabIds: string[], outcome: "closed" | "missing" = "closed") => {
      const closed = new Set(tabIds);
      for (const tabId of closed)
        awaitingNavigationHandles.current.delete(tabId);
      const cancelled = [...pendingNavigations.current].filter(
        ([, navigation]) => closed.has(navigation.targetId),
      );
      for (const [key] of cancelled) pendingNavigations.current.delete(key);
      const deliveries = pendingDeliveries.current.filter((delivery) =>
        closed.has(delivery.threadId ?? activeThreadIdRef.current ?? ""),
      );
      const removed = new Set(deliveries);
      pendingDeliveries.current = pendingDeliveries.current.filter(
        (delivery) => !removed.has(delivery),
      );
      const publication = tabsClosingRef.current?.(tabIds, outcome);
      const closure = {
        tabIds,
        cancelled: cancelled.map(([, navigation]) => navigation),
        deliveries,
        outcome,
        publications: publication ? [publication] : [],
        ready: false,
      };
      pendingTabClosures.current.add(closure);
      return closure;
    },
    [],
  );
  const publishTabClosure = useCallback(
    (closed: ReturnType<typeof cancelTabNavigations>) => {
      if (!pendingTabClosures.current.delete(closed)) return;
      for (const delivery of closed.deliveries) {
        reportAgentChatSubmitResult(
          delivery.send.submitMessageId,
          false,
          `target-tab-${closed.outcome}`,
        );
        cancelAgentChatSubmit(delivery.send.submitMessageId);
      }
      for (const publish of closed.publications) publish();
      tabsClosedRef.current?.(closed.tabIds, closed.outcome);
      for (const navigation of closed.cancelled)
        navigationChangeRef.current?.(navigation.event, closed.outcome);
    },
    [],
  );
  const [tabClosureVersion, setTabClosureVersion] = useState(0);
  const notifyTabsClosed = useCallback(
    (closed: ReturnType<typeof cancelTabNavigations>) => {
      closed.ready = true;
      if (!mountedRef.current) {
        publishTabClosure(closed);
        return;
      }
      setTabClosureVersion((version) => version + 1);
    },
    [publishTabClosure],
  );
  useEffect(() => {
    const closures = [...pendingTabClosures.current].filter(
      ({ ready }) => ready,
    );
    if (closures.length === 0) return;
    queueMicrotask(() => {
      for (const closed of closures) publishTabClosure(closed);
    });
  }, [tabClosureVersion, publishTabClosure]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const pending = [...pendingNavigations.current.values()];
      const deliveries = pendingDeliveries.current;
      pendingNavigations.current.clear();
      awaitingNavigationHandles.current.clear();
      pendingDeliveries.current = [];
      deliveryLanes.current.clear();
      for (const closed of [...pendingTabClosures.current])
        publishTabClosure(closed);
      for (const delivery of deliveries) {
        reportAgentChatSubmitResult(
          delivery.send.submitMessageId,
          false,
          "panel-unmounted",
        );
        cancelAgentChatSubmit(delivery.send.submitMessageId);
      }
      for (const navigation of pending)
        navigationChangeRef.current?.(navigation.event, "unavailable");
    };
  }, [publishTabClosure]);
  const continueNavigation = useCallback(
    (navigation: ReturnType<typeof startNavigation>) => {
      if (
        pendingNavigations.current.get(
          getAgentChatNavigationKey(navigation.event),
        ) !== navigation
      )
        return false;
      if (navigation.generation !== latestNavigationRequestRef.current) {
        settleNavigation(navigation.event, "superseded");
        return false;
      }
      return true;
    },
    [settleNavigation],
  );
  useEffect(() => {
    if (navigationSettlements.length === 0) return;
    const consumed = new Set<(typeof navigationSettlements)[number]>();
    for (const settlement of navigationSettlements) {
      const key = getAgentChatNavigationKey(settlement.event);
      if (!pendingNavigations.current.has(key)) {
        consumed.add(settlement);
        continue;
      }
      const outcome =
        pendingNavigations.current.get(key)?.generation !==
          latestNavigationRequestRef.current ||
        (settlement.outcome === "selected" &&
          settlement.targetId !== activeThreadId)
          ? "superseded"
          : settlement.outcome;
      if (outcome === "selected" && settlement.prefill && settlement.targetId) {
        if (queuedPrefills.current.has(settlement)) continue;
        const handle = chatRefs.current.get(settlement.targetId);
        if (!handle) {
          awaitingNavigationHandles.current.add(settlement.targetId);
          continue;
        }
        const navigation = pendingNavigations.current.get(key);
        queuedPrefills.current.add(settlement);
        pendingDeliveries.current.push({
          threadId: settlement.targetId,
          send: { message: settlement.prefill, submit: false },
          targetReported: true,
          isCurrent: () =>
            pendingNavigations.current.get(key) === navigation &&
            navigation?.generation === latestNavigationRequestRef.current,
          onResult: (delivered) =>
            setNavigationSettlements((current) =>
              current.map((pending) =>
                pending === settlement
                  ? {
                      ...pending,
                      outcome: delivered ? "selected" : "failed",
                      prefill: delivered ? undefined : pending.prefill,
                    }
                  : pending,
              ),
            ),
        });
        flushPendingDeliveries(settlement.targetId, true);
        continue;
      }
      pendingNavigations.current.delete(key);
      if (settlement.targetId)
        awaitingNavigationHandles.current.delete(settlement.targetId);
      consumed.add(settlement);
      // Receiver effects must finish reattaching before a callback dispatches new work.
      queueMicrotask(() =>
        navigationChangeRef.current?.(settlement.event, outcome),
      );
    }
    if (consumed.size > 0)
      setNavigationSettlements((current) =>
        current.filter((settlement) => !consumed.has(settlement)),
      );
    // Prefill updates must commit before later retained drafts are released.
  }, [
    navigationSettlements,
    activeThreadId,
    navigationHandleVersion,
    flushPendingDeliveries,
  ]);

  const cleanupTabs = useCallback((tabIds: string[]) => {
    for (const tabId of tabIds) {
      if (parentMapRef.current[tabId]) {
        dismissedSubAgentTabsRef.current.add(tabId);
      }
      chatRefs.current.delete(tabId);
      pendingContextItems.current.delete(tabId);
      newThreadIds.current.delete(tabId);
      mountedTabsRef.current.delete(tabId);
      threadListLoadedTabsRef.current.delete(tabId);
      transcriptScrollRef.current.delete(tabId);
      threadModelRef.current.delete(tabId);
      // Clean up parent map and sub-agent names
      setParentMap((prev) => {
        if (!(tabId in prev)) return prev;
        const { [tabId]: _, ...rest } = prev;
        return rest;
      });
      setSubAgentNames((prev) => {
        if (!(tabId in prev)) return prev;
        const { [tabId]: _, ...rest } = prev;
        return rest;
      });
      setSubAgentStatuses((prev) => {
        if (!(tabId in prev)) return prev;
        const { [tabId]: _, ...rest } = prev;
        return rest;
      });
    }
  }, []);
  const cleanupClosedTabs = useCallback(
    (tabIds: string[], outcome: "closed" | "missing" = "closed") => {
      const closed = cancelTabNavigations(tabIds, outcome);
      cleanupTabs(tabIds);
      return () => notifyTabsClosed(closed);
    },
    [cancelTabNavigations, cleanupTabs, notifyTabsClosed],
  );

  useEffect(() => {
    if (evictedThreadIds.length === 0) return;
    const notifyClosed = cleanupClosedTabs(evictedThreadIds);
    setOpenTabIds((prev) =>
      prev.filter((threadId) => !evictedThreadIds.includes(threadId)),
    );
    notifyClosed();
  }, [cleanupClosedTabs, evictedThreadIds, setOpenTabIds]);

  const getClosingTabIds = useCallback((retainedTabId?: string) => {
    const tabIds = new Set([
      ...openTabIdsRef.current,
      ...[...pendingNavigations.current.values()].map(
        ({ targetId }) => targetId,
      ),
    ]);
    if (retainedTabId) tabIds.delete(retainedTabId);
    return [...tabIds];
  }, []);

  const closeOtherTabs = useCallback(
    (tabId: string) => {
      for (const id of openTabIdsRef.current) {
        if (id !== tabId && parentMapRef.current[id]) {
          dismissedSubAgentTabsRef.current.add(id);
        }
      }
      const notifyClosed = cleanupClosedTabs(getClosingTabIds(tabId));
      setOpenTabIds([tabId]);
      if (activeThreadIdRef.current !== tabId) {
        switchThread(tabId);
      }
      // Clean up parent map and sub-agent names — only keep entries for the surviving tab
      setParentMap((prev) => {
        if (tabId in prev) return { [tabId]: prev[tabId] };
        return {};
      });
      setSubAgentNames((prev) => {
        if (tabId in prev) return { [tabId]: prev[tabId] };
        return {};
      });
      setSubAgentStatuses((prev) => {
        if (tabId in prev) return { [tabId]: prev[tabId] };
        return {};
      });
      notifyClosed();
    },
    [switchThread, cleanupClosedTabs, getClosingTabIds],
  );

  const closeAllInFlightRef = useRef<Promise<void> | null>(null);
  const closeAllTabs = useCallback(() => {
    if (closeAllInFlightRef.current) return closeAllInFlightRef.current;
    // The local creator advances selection synchronously; retain the old recipients.
    const closingIds = getClosingTabIds();
    // Reserve the operation before the creator or host callbacks can reenter it.
    const closing = Promise.resolve()
      .then(async () => {
        if (!mountedRef.current) return;
        const id = await createThread();
        if (!id || !mountedRef.current) return;
        const closed = cancelTabNavigations(
          [...new Set([...closingIds, ...getClosingTabIds(id)])].filter(
            (target) => target !== id,
          ),
        );
        try {
          newThreadIds.current.add(id);
          setOpenTabIds([id]);
          switchThreadState(id);
          writeThreadUrl(null);
          dismissedSubAgentTabsRef.current.clear();
          // Clean up all old refs
          chatRefs.current.clear();
          pendingContextItems.current.clear();
          threadModelRef.current.clear();
          setParentMap({});
          setSubAgentNames({});
          setSubAgentStatuses({});
        } finally {
          notifyTabsClosed(closed);
        }
      })
      .finally(() => {
        closeAllInFlightRef.current = null;
      });
    closeAllInFlightRef.current = closing;
    return closing;
  }, [
    createThread,
    switchThreadState,
    writeThreadUrl,
    cancelTabNavigations,
    getClosingTabIds,
    notifyTabsClosed,
  ]);

  const closeTab = useCallback(
    (tabId: string) => {
      // Read the current list from the ref rather than a `setOpenTabIds`
      // updater callback — `createThread()`/`switchThread()` below set
      // `activeThreadId` synchronously as a side effect, and calling them
      // from inside an updater left `openTabIds` and `activeThreadId`
      // inconsistent for a render: the "ensure active thread is in open
      // tabs" effect would then re-add the just-closed id, so the tab
      // appeared to reopen itself right after closing.
      const prev = openTabIdsRef.current;
      if (prev.length <= 1) {
        if (lastTabReplacementInFlightRef.current) return;
        lastTabReplacementInFlightRef.current = true;
        // Last tab — create a new one and replace the old tab once ready;
        // the old tab stays visible in the meantime so the bar is never empty.
        void closeAllTabs()
          .catch((error) => {
            console.error(
              "[agent-chat] failed to replace the closed final tab",
              error,
            );
            toast.error(translate("agentChat.message.closeTabFailed"));
          })
          .finally(() => {
            lastTabReplacementInFlightRef.current = false;
          });
        return;
      }
      const next = prev.filter((id) => id !== tabId);
      if (tabId === activeThreadIdRef.current && next.length > 0) {
        const idx = prev.indexOf(tabId);
        switchThread(next[Math.min(idx, next.length - 1)]);
      }
      setOpenTabIds(next);
      cleanupClosedTabs([tabId])();
    },
    [switchThread, closeAllTabs, cleanupClosedTabs, translate],
  );

  // Keyboard shortcuts dispatched from AgentPanel based on the active mode
  useEffect(() => {
    const handleCloseCurrent = () => {
      const id = activeThreadIdRef.current;
      if (id) closeTab(id);
    };
    const handleCloseAll = () => {
      void closeAllTabs();
    };
    const handleNewChat = () => {
      void addTab();
    };
    window.addEventListener("agent-chat:close-current-tab", handleCloseCurrent);
    window.addEventListener("agent-chat:close-all-tabs", handleCloseAll);
    window.addEventListener("agent-chat:new-chat", handleNewChat);
    return () => {
      window.removeEventListener(
        "agent-chat:close-current-tab",
        handleCloseCurrent,
      );
      window.removeEventListener("agent-chat:close-all-tabs", handleCloseAll);
      window.removeEventListener("agent-chat:new-chat", handleNewChat);
    };
  }, [closeTab, closeAllTabs, addTab]);

  useEffect(() => {
    const handleOpenThread = async (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            threadId?: unknown;
            newThread?: unknown;
            onlyIfActiveThreadId?: unknown;
            openRequestId?: unknown;
            prefill?: unknown;
          }
        | undefined;
      const threadId =
        typeof detail?.threadId === "string" ? detail.threadId : "";
      if (!detail || !threadId) return;
      if (!claimAgentChatOpenRequest(detail.openRequestId)) return;
      const navigation = startNavigation(event, threadId);
      if (!continueNavigation(navigation)) return;

      const onlyIfActiveThreadId =
        typeof detail.onlyIfActiveThreadId === "string"
          ? detail.onlyIfActiveThreadId.trim()
          : "";
      const activeThreadId = activeThreadIdRef.current;
      if (
        onlyIfActiveThreadId &&
        activeThreadId &&
        activeThreadId !== onlyIfActiveThreadId
      ) {
        settleNavigation(event, "skipped");
        return;
      }

      try {
        if (detail?.newThread === true) {
          newThreadIds.current.add(threadId);
          const createdId = await createThread(threadId);
          if (!continueNavigation(navigation)) return;
          if (!createdId) {
            settleNavigation(event, "unavailable");
            return;
          }
          setOpenTabIds((prev) =>
            prev.includes(createdId) ? prev : [...prev, createdId],
          );
          writeThreadUrl(null);
          settleNavigation(event, "selected", createdId);
          return;
        }
        const activeThreadBeforeLookup = activeThreadIdRef.current;
        const openResult = await openThread(threadId);
        if (!continueNavigation(navigation)) return;
        if (openResult === "missing") {
          cleanupClosedTabs([threadId], "missing")();
          return;
        }
        if (openResult === "unavailable") {
          settleNavigation(event, "unavailable");
          return;
        }
        if (
          activeThreadIdRef.current !== activeThreadBeforeLookup ||
          (onlyIfActiveThreadId &&
            activeThreadIdRef.current &&
            activeThreadIdRef.current !== onlyIfActiveThreadId)
        ) {
          settleNavigation(event, "superseded");
          return;
        }
        const prefill =
          typeof detail.prefill === "string" ? detail.prefill.trim() : "";
        mountedTabsRef.current.add(threadId);
        setOpenTabIds((prev) =>
          prev.includes(threadId) ? prev : [...prev, threadId],
        );
        switchThread(threadId);
        settleNavigation(event, "selected", threadId, prefill);
      } catch (error) {
        console.error("[agent-chat] failed to open requested thread", error);
        settleNavigation(event, "failed");
      }
    };

    window.addEventListener("agent-chat:open-thread", handleOpenThread);
    return () =>
      window.removeEventListener("agent-chat:open-thread", handleOpenThread);
  }, [
    cleanupClosedTabs,
    createThread,
    openThread,
    switchThread,
    writeThreadUrl,
    startNavigation,
    continueNavigation,
    settleNavigation,
  ]);

  const clearActiveTab = useCallback(() => {
    const tabIdToClear = activeThreadIdRef.current;
    void addTab().then((newTabId) => {
      if (!tabIdToClear || !newTabId || tabIdToClear === newTabId) return;
      setOpenTabIds((prev) => {
        const next = prev.filter((id) => id !== tabIdToClear);
        return next.includes(newTabId) ? next : [...next, newTabId];
      });
      cleanupClosedTabs([tabIdToClear])();
    });
  }, [addTab, cleanupClosedTabs]);

  const openFromHistory = useCallback(
    (threadId: string) => {
      if (!openTabIds.includes(threadId)) {
        setOpenTabIds((prev) => [...prev, threadId]);
      }
      switchThread(threadId);
    },
    [openTabIds, switchThread],
  );

  // Listen for agent-task-open events (from AgentTaskCard "Open" button)
  useEffect(() => {
    function handleOpenTask(e: Event) {
      const detail = (e as CustomEvent).detail;
      const threadId = detail?.threadId;
      if (!threadId) return;
      if (!claimAgentChatOpenRequest(detail.openRequestId)) return;
      const navigation = startNavigation(e, threadId);
      if (!continueNavigation(navigation)) return;
      dismissedSubAgentTabsRef.current.delete(threadId);
      // Prefer an explicit parent (RunsTray/background hydration knows it);
      // inline task cards fall back to the active orchestrator thread.
      const explicitParentId =
        typeof detail?.parentThreadId === "string"
          ? detail.parentThreadId.trim()
          : "";
      const parentId = explicitParentId || activeThreadIdRef.current;
      if (parentId && parentId !== threadId) {
        setParentMap((prev) =>
          prev[threadId] === parentId
            ? prev
            : { ...prev, [threadId]: parentId },
        );
      }
      // Store the sub-agent name/description for the tab label
      const name = detail.name || detail.description || "";
      if (name) {
        setSubAgentNames((prev) =>
          prev[threadId] === name ? prev : { ...prev, [threadId]: name },
        );
      }
      // Refresh thread list so the new sub-agent thread appears with its title
      refreshThreads();
      // Open the sub-agent thread as a tab — insert after parent for visual grouping
      if (!openTabIds.includes(threadId)) {
        setOpenTabIds((prev) => {
          if (parentId) {
            const parentIdx = prev.indexOf(parentId);
            if (parentIdx !== -1) {
              // Insert after the parent (and any existing children of that parent)
              const next = [...prev];
              let insertIdx = parentIdx + 1;
              // Skip past any existing children of the same parent
              while (
                insertIdx < next.length &&
                parentMap[next[insertIdx]] === parentId
              ) {
                insertIdx++;
              }
              next.splice(insertIdx, 0, threadId);
              return next;
            }
          }
          return [...prev, threadId];
        });
      }
      switchThread(threadId);
      settleNavigation(e, "selected", threadId);
    }
    window.addEventListener("agent-task-open", handleOpenTask);
    return () => window.removeEventListener("agent-task-open", handleOpenTask);
  }, [
    openTabIds,
    switchThread,
    refreshThreads,
    parentMap,
    startNavigation,
    continueNavigation,
    settleNavigation,
  ]);

  // Replay thread/task opens requested before this lazy panel's listeners
  // attached. Live events claim their id; replay drains only unclaimed requests.
  useEffect(() => {
    const buffered = drainBufferedAgentChatOpenRequests();
    for (const request of buffered) {
      window.dispatchEvent(
        new CustomEvent(request.eventType, { detail: request.detail }),
      );
    }
  }, []);

  useEffect(() => {
    onCommandListenersReadyChange?.(true);
    return () => onCommandListenersReadyChange?.(false);
  }, [onCommandListenersReadyChange]);

  useBrowserLayoutEffect(() => {
    const committed = navigationSettlements.filter(
      (settlement) =>
        settlement.outcome === "selected" &&
        settlement.targetId === activeThreadId &&
        pendingNavigations.current.get(
          getAgentChatNavigationKey(settlement.event),
        )?.generation === latestNavigationRequestRef.current,
    );
    onReferenceTargetChange?.(
      activeThreadId,
      committed.map(({ event }) => event),
    );
  }, [activeThreadId, navigationSettlements, onReferenceTargetChange]);

  // Watch for agent-issued chat-command in application-state. The shared
  // DB-sync transport advances this key-specific version, so the command gets
  // one initial read and one read per actual write instead of a 2s loop.
  const lastChatCommandRef = useRef(0);
  const chatCommandVersion = useChangeVersion("app-state:chat-command");
  useEffect(() => {
    let stopped = false;

    async function readChatCommand() {
      if (stopped) return;
      try {
        const res = await fetch(
          agentNativePath("/_agent-native/application-state/chat-command"),
        );
        if (res.ok) {
          const data = await res.json();
          if (
            data?.value?.command === "open-thread" &&
            data.value.threadId &&
            data.value.timestamp > lastChatCommandRef.current
          ) {
            lastChatCommandRef.current = data.value.timestamp;
            const threadId = data.value.threadId as string;
            // Open the thread as a tab and focus it
            setOpenTabIds((prev) =>
              prev.includes(threadId) ? prev : [...prev, threadId],
            );
            switchThread(threadId);
            // Clear the command
            fetch(
              agentNativePath("/_agent-native/application-state/chat-command"),
              {
                method: "DELETE",
                headers: { "X-Agent-Native-CSRF": "1" },
              },
            ).catch(() => {});
          }
        }
      } catch {}
    }

    void readChatCommand();
    return () => {
      stopped = true;
    };
  }, [chatCommandVersion, switchThread]);

  const saveThreadDataForTab = useCallback(
    async (
      threadId: string,
      data: Parameters<typeof saveThreadData>[1],
      context?: { signal?: AbortSignal },
    ) => {
      const saved = context
        ? await saveThreadData(threadId, data, context)
        : await saveThreadData(threadId, data);
      if (saved && data.threadData !== "")
        newThreadIds.current.delete(threadId);
      return saved;
    },
    [saveThreadData],
  );

  const handleGenerateTitle = useCallback(
    (
      threadId: string,
      message: string,
      selection: { engine?: string; model?: string },
    ) => {
      void generateTitle(threadId, message, selection).then((title) => {
        const resolvedTitle = title ?? fallbackChatTitle(message);
        if (!resolvedTitle) return;
        void saveThreadDataForTab(threadId, {
          threadData: "",
          title: resolvedTitle,
          preview: message.slice(0, 120),
          titleSource: title ? "generated" : "fallback",
        });
      });
    },
    [generateTitle, saveThreadDataForTab],
  );

  const handleSaveThread = useCallback(
    (
      threadId: string,
      data: {
        threadData: string;
        title: string;
        preview: string;
        messageCount: number;
        titleSource?: "fallback";
      },
      context?: { signal?: AbortSignal },
      source: AssistantChatSnapshotSaveSource = "transport",
    ): Promise<boolean> => {
      return saveThreadDataForTab(
        threadId,
        {
          ...data,
          threadData: source === "host-fallback" ? data.threadData : "",
        },
        context,
      );
    },
    [saveThreadDataForTab],
  );

  // ─── Slash command handler ──────────────────────────────────────────
  const [helpVisible, setHelpVisible] = useState(false);

  const handleSlashCommand = useCallback(
    (command: string) => {
      switch (command) {
        case "clear":
        case "new":
          void addTab();
          break;
        case "history":
          setShowHistory(true);
          break;
        case "help":
          setHelpVisible(true);
          break;
      }
    },
    [addTab],
  );

  const activateForkedThread = useCallback(
    (sourceThreadId: string, forkedId: string) => {
      if (sourceThreadId && forkedId && sourceThreadId !== forkedId) {
        setForkParentMap((prev) =>
          prev[forkedId] === sourceThreadId
            ? prev
            : { ...prev, [forkedId]: sourceThreadId },
        );
      }
      setOpenTabIds((prev) => {
        if (prev.includes(forkedId)) return prev;
        const idx = prev.indexOf(sourceThreadId);
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx + 1, 0, forkedId);
          return next;
        }
        return [...prev, forkedId];
      });
      switchThread(forkedId);
    },
    [switchThread],
  );

  const activateForkSibling = useCallback(
    (threadId: string) => {
      setOpenTabIds((prev) =>
        prev.includes(threadId) ? prev : [...prev, threadId],
      );
      switchThread(threadId);
    },
    [switchThread],
  );

  const getBranchNavigation = useCallback(
    (threadId: string) => {
      const parentThreadId = forkParentMap[threadId] ?? threadId;
      const knownThreadIds = new Set([
        activeThreadId,
        ...openTabIds,
        ...threads.map((thread) => thread.id),
      ]);
      const siblings = [
        parentThreadId,
        ...Object.entries(forkParentMap)
          .filter(
            ([childThreadId, parentId]) =>
              parentId === parentThreadId && childThreadId !== parentThreadId,
          )
          .map(([childThreadId]) => childThreadId),
      ].filter(
        (id, index, all) => knownThreadIds.has(id) && all.indexOf(id) === index,
      );
      const index = siblings.indexOf(threadId);
      if (siblings.length < 2 || index < 0) return undefined;

      return {
        index: index + 1,
        count: siblings.length,
        onPrevious: () => {
          const previous = siblings[index - 1];
          if (previous) activateForkSibling(previous);
        },
        onNext: () => {
          const next = siblings[index + 1];
          if (next) activateForkSibling(next);
        },
      };
    },
    [activeThreadId, activateForkSibling, forkParentMap, openTabIds, threads],
  );

  const handleForkChat = useCallback(
    async (sourceThreadId: string) => {
      const sourceSnapshot =
        chatRefs.current.get(sourceThreadId)?.exportThreadSnapshot() ?? null;
      const forkedId = await forkThread(sourceThreadId, sourceSnapshot);
      if (!forkedId) return false;
      activateForkedThread(sourceThreadId, forkedId);
      return true;
    },
    [activateForkedThread, forkThread],
  );

  // Build tabs from open thread IDs. During the first thread-list fetch,
  // `activeThreadId` is seeded synchronously so the chat can mount before
  // persisted open tabs have been reconciled.
  const visibleOpenTabIds =
    activeThreadId && !openTabIds.includes(activeThreadId)
      ? [...openTabIds, activeThreadId]
      : openTabIds;
  const threadMap = new Map(threads.map((t) => [t.id, t]));
  const tabs: ChatTab[] = visibleOpenTabIds
    .filter((id) => threadMap.has(id) || id === activeThreadId)
    .map((id) => {
      const t = threadMap.get(id);
      const agentTeamStatus = chatTabStatusFromAgentTeamStatus(
        subAgentStatuses[id],
      );
      return {
        id,
        label: t?.title || translate("agentChat.tabs.newChat"),
        status:
          agentTeamStatus ??
          (runningThreads.has(id)
            ? ("running" as const)
            : (messageCounts[id] ?? t?.messageCount ?? 0) > 0
              ? ("completed" as const)
              : ("idle" as const)),
        parentThreadId: parentMap[id],
        subAgentName: subAgentNames[id],
      };
    });

  // Include sub-agent tabs that aren't in threadMap yet (just created, not refreshed)
  for (const id of visibleOpenTabIds) {
    if (!tabs.some((t) => t.id === id)) {
      tabs.push({
        id,
        label:
          subAgentNames[id] ||
          (parentMap[id]
            ? translate("agentChat.tabs.subAgent")
            : translate("agentChat.tabs.newChat")),
        status:
          chatTabStatusFromAgentTeamStatus(subAgentStatuses[id]) ??
          ("running" as const),
        parentThreadId: parentMap[id],
        subAgentName: subAgentNames[id],
      });
    }
  }

  const headerProps: MultiTabAssistantChatHeaderCallbackProps = {
    tabs,
    activeTabId: activeThreadId ?? "",
    activeTabMessageCount: activeThreadId
      ? (messageCounts[activeThreadId] ?? 0)
      : 0,
    activeTabIsPersisted: Boolean(
      activeThreadId &&
      !newThreadIds.current.has(activeThreadId) &&
      !isNewThread(activeThreadId) &&
      isThreadPersisted(activeThreadId),
    ),
    setActiveTabId: switchThread,
    addTab,
    closeTab,
    closeOtherTabs,
    closeAllTabs,
    clearActiveTab,
    showHistory,
    toggleHistory: () => setShowHistory((v) => !v),
    tabCount: visibleOpenTabIds.length,
  };

  // Wait for the first thread-list pass only when there is no synchronously
  // seeded active thread. Suggestion loading and thread-list reconciliation
  // should not block the chat shell from mounting.
  if (isLoading && !activeThreadId) {
    return (
      <ChatSkeleton
        header={renderHeader?.(headerProps)}
        headerOnly={contentHidden}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col h-full min-h-0 overflow-x-hidden">
      {renderHeader
        ? renderHeader(headerProps)
        : showTabBar
          ? (() => {
              const activeTab = tabs.find((t) => t.id === activeThreadId);
              const focusParentId = activeTab?.parentThreadId || activeThreadId;
              const childTabs = tabs.filter(
                (t) => t.parentThreadId === focusParentId,
              );
              const hasSubTabs = childTabs.length > 0;
              const mainTabs = tabs.filter((t) => !t.parentThreadId);
              const closeButton = (tab: ChatTab) => (
                <AgentPanelTabCloseButton
                  label={translate("agentChat.tabs.closeTab")}
                  onClose={() => closeTab(tab.id)}
                  className="agent-tab-close me-0.5 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                />
              );

              return (
                <>
                  <div className="flex items-center px-1 py-1 border-b border-border shrink-0 gap-0.5">
                    <div
                      role="tablist"
                      aria-label={translate("agentChat.agentPanel.chatTabs")}
                      onKeyDown={moveTabFocus}
                      className="agent-tabs-scroll flex items-center gap-0.5 min-w-0 overflow-x-auto flex-1"
                    >
                      {mainTabs.map((tab) => {
                        const isActive =
                          tab.id === activeThreadId ||
                          (tab.id === focusParentId &&
                            activeTab?.parentThreadId === tab.id);
                        return (
                          <div
                            key={tab.id}
                            ref={isActive ? activeTabRefCb : undefined}
                            data-active={isActive ? "" : undefined}
                            className={cn(
                              "agent-tab agent-tab-group relative flex h-6 items-center rounded-md text-xs font-medium shrink min-w-[56px] max-w-[136px]",
                              isActive
                                ? "bg-accent text-foreground ring-1 ring-inset ring-border/60 shadow-sm"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
                            )}
                          >
                            <button
                              type="button"
                              role="tab"
                              aria-selected={isActive}
                              tabIndex={isActive ? 0 : -1}
                              aria-keyshortcuts="Delete Backspace"
                              onClick={() => switchThread(tab.id)}
                              onKeyDown={(event) =>
                                closeAgentPanelTabOnKey(event, () =>
                                  closeTab(tab.id),
                                )
                              }
                              className="flex h-full items-center gap-1 ps-2.5 pe-1 min-w-0 flex-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            >
                              <span className="truncate">{tab.label}</span>
                              {tab.status === "running" && (
                                <span className="size-1.5 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse motion-reduce:animate-none" />
                              )}
                            </button>
                            {closeButton(tab)}
                          </div>
                        );
                      })}
                    </div>
                    <TooltipProvider delayDuration={200}>
                      <div className="flex items-center gap-px shrink-0 ms-auto">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={addTab}
                              aria-label={translate("agentChat.tabs.newChat")}
                              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            >
                              <IconPlus size={16} aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {translate("agentChat.tabs.newChat")}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setShowHistory(!showHistory)}
                              aria-label={translate("agentChat.tabs.allChats")}
                              aria-expanded={showHistory}
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent/50",
                                showHistory && "bg-accent text-foreground",
                              )}
                            >
                              <IconHistory size={16} aria-hidden="true" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {translate("agentChat.tabs.allChats")}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                  </div>
                  {hasSubTabs && (
                    <div className="flex items-center px-1 py-0.5 border-b border-border shrink-0 gap-0.5 bg-muted/30">
                      <div
                        role="tablist"
                        aria-label={translate("agentChat.activity.agents")}
                        onKeyDown={moveTabFocus}
                        className="agent-tabs-scroll flex items-center gap-0.5 min-w-0 overflow-x-auto flex-1"
                      >
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeThreadId === focusParentId}
                          tabIndex={activeThreadId === focusParentId ? 0 : -1}
                          onClick={() => switchThread(focusParentId!)}
                          className={cn(
                            "flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            activeThreadId === focusParentId
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          {translate("agentChat.tabs.main")}
                        </button>
                        {childTabs.map((tab) => {
                          const isActive = tab.id === activeThreadId;
                          return (
                            <div
                              key={tab.id}
                              ref={isActive ? activeTabRefCb : undefined}
                              data-active={isActive ? "" : undefined}
                              className={cn(
                                "agent-tab agent-tab-group relative flex h-6 shrink items-center rounded-md text-xs font-medium min-w-[48px] max-w-[136px]",
                                isActive
                                  ? "bg-accent text-foreground"
                                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
                              )}
                            >
                              <button
                                type="button"
                                role="tab"
                                aria-selected={isActive}
                                tabIndex={isActive ? 0 : -1}
                                aria-keyshortcuts="Delete Backspace"
                                onClick={() => switchThread(tab.id)}
                                onKeyDown={(event) =>
                                  closeAgentPanelTabOnKey(event, () =>
                                    closeTab(tab.id),
                                  )
                                }
                                className="flex h-full items-center gap-1 ps-2 pe-1 min-w-0 flex-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              >
                                <span className="truncate">
                                  {tab.subAgentName || tab.label}
                                </span>
                                {tab.status === "running" && (
                                  <span className="size-1 rounded-full bg-muted-foreground/50 shrink-0 animate-pulse motion-reduce:animate-none" />
                                )}
                              </button>
                              {closeButton(tab)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              );
            })()
          : null}

      {/* Chat content with optional overlay */}
      <div
        className={cn(
          "relative flex-1 flex flex-col min-h-0",
          renderOverlay && "pt-12",
        )}
        data-agent-page-chat-topbar={renderOverlay ? "" : undefined}
        data-agent-page-chat-scrolled={
          renderOverlay && pageOverlayScrolled ? "" : undefined
        }
        onScrollCapture={renderOverlay ? handlePageOverlayScroll : undefined}
      >
        {renderOverlay ? renderOverlay(headerProps) : null}

        {/* History popover — rendered inside relative container so positioning works */}
        {showHistory && (
          <HistoryPopover
            apiUrl={apiUrl}
            scope={isolateHistoryByScope ? (scope ?? undefined) : undefined}
            localMineRows={ownDraftRows({
              threads: threads.map((thread) => ({
                ...thread,
                messageCount: messageCounts[thread.id] ?? thread.messageCount,
              })),
              isNewThread,
              activeId: activeThreadId,
              observedThreadStarts: observedThreadStarts.current,
            })}
            openTabIds={new Set(openTabIds)}
            activeThreadId={activeThreadId}
            onSelect={openFromHistory}
            onNewChat={addTab}
            onClose={() => setShowHistory(false)}
            onTogglePin={pinThread}
            onRename={renameThread}
            getThreadUrl={(threadId) => {
              if (getThreadPath) return appPath(getThreadPath(threadId));
              const url = new URL(window.location.href);
              url.searchParams.set(threadUrlParamName, threadId);
              return url.toString();
            }}
            popoverAlign={renderOverlay ? "start" : "end"}
          />
        )}

        {/* Help popover — shown by /help slash command */}
        {helpVisible && <HelpPopover onClose={() => setHelpVisible(false)} />}

        {/* Render tabs that have been activated at least once, hide inactive ones to preserve state.
            Sub-agent tabs are only mounted when first focused — prevents stale restore from running
            while the component is display:none before the user switches to it. */}
        {[...new Set(visibleOpenTabIds)]
          .filter(
            (tabId) =>
              tabId === activeThreadId || mountedTabsRef.current.has(tabId),
          )
          .map((tabId) => {
            const isKnownNewThread =
              newThreadIds.current.has(tabId) || isNewThread(tabId);
            if (!isLoading) threadListLoadedTabsRef.current.add(tabId);
            const isThreadStateLoading =
              isLoading &&
              !isKnownNewThread &&
              !threadListLoadedTabsRef.current.has(tabId);
            const modelSelection = resolveThreadModelSelection(tabId);
            const modelSelectionPending =
              !hostManagedModels && modelListLoading && !modelSelection;
            const tabDynamicSuggestions =
              tabId === activeThreadId && !contentHidden
                ? props.dynamicSuggestions
                : false;
            return (
              <div
                key={tabId}
                ref={(element) => {
                  if (element) tabContainersRef.current.set(tabId, element);
                  else tabContainersRef.current.delete(tabId);
                }}
                onScrollCapture={(event) =>
                  rememberTranscriptScroll(tabId, event)
                }
                className="flex-1 min-h-0 flex-col"
                data-agent-chat-reference-target={
                  tabId === activeThreadId ? tabId : undefined
                }
                style={{
                  display:
                    contentHidden || tabId !== activeThreadId ? "none" : "flex",
                }}
              >
                <AgentKitAssistantChat
                  {...props}
                  dynamicSuggestions={tabDynamicSuggestions}
                  ref={(handle) => {
                    if (handle) {
                      chatRefs.current.set(tabId, handle);
                      if (awaitingNavigationHandles.current.delete(tabId))
                        setNavigationHandleVersion((version) => version + 1);
                      flushPendingDeliveries(tabId);
                    } else {
                      chatRefs.current.delete(tabId);
                    }
                  }}
                  threadId={tabId}
                  tabId={tabId}
                  browserTabId={browserTabId}
                  contextScope={scope}
                  contextNamespace={contextNamespace}
                  isolateHistoryByScope={isolateHistoryByScope}
                  isActiveComposer={!contentHidden && tabId === activeThreadId}
                  isReferenceTarget={tabId === activeThreadId}
                  apiUrl={apiUrl}
                  isNewThread={isKnownNewThread}
                  onThreadRestoreNotFound={
                    tabId === activeThreadId &&
                    (props.agentChatSurface !== "desktop" ||
                      props.desktopIdentityAuthenticated === true)
                      ? clearActiveTab
                      : undefined
                  }
                  isThreadStateLoading={isThreadStateLoading}
                  onMessageCountChange={(count) => {
                    setMessageCounts((prev) =>
                      prev[tabId] === count
                        ? prev
                        : { ...prev, [tabId]: count },
                    );
                    // This sits after `{...props}`, so forwarding is not
                    // optional: taking the callback for the tab counter alone
                    // silently drops the host's.
                    props.onMessageCountChange?.(count);
                  }}
                  onSaveThread={handleSaveThread}
                  onThreadSnapshotPersisted={handleThreadSnapshotPersisted}
                  onGenerateTitle={handleGenerateTitle}
                  onSlashCommand={handleSlashCommand}
                  onForkedThread={(forkedId) =>
                    activateForkedThread(tabId, forkedId)
                  }
                  branchNavigation={getBranchNavigation(tabId)}
                  selectedModel={modelSelection?.model}
                  selectedEngine={modelSelection?.engine}
                  selectedEffort={
                    modelSelection?.effort ?? DEFAULT_REASONING_EFFORT
                  }
                  composerSlot={props.composerSlot}
                  defaultModel={defaultModel}
                  availableModels={availableModels}
                  modelListLoading={modelListLoading}
                  modelListError={modelListError}
                  onRetryModelList={
                    hostManagedModels ? hostOnRetryModelList : refreshEngines
                  }
                  onModelChange={handleModelChangeWithHost}
                  onEffortChange={handleEffortChange}
                  onForkChat={() => handleForkChat(tabId)}
                  // Sub-agent tabs are read-only: sending a new message from the
                  // sub-agent tab would start a fresh run on that thread and kill
                  // the in-flight team chunk. Disable the composer and show a
                  // hint so users know to send via the orchestrator chat instead.
                  composerDisabled={
                    props.composerDisabled || Boolean(parentMap[tabId])
                  }
                  composerSubmissionDisabled={
                    props.composerSubmissionDisabled || modelSelectionPending
                  }
                  composerDisabledPlaceholder={
                    props.composerDisabled
                      ? props.composerDisabledPlaceholder
                      : parentMap[tabId]
                        ? translate("agentChat.composer.subAgentReadOnly")
                        : props.composerDisabledPlaceholder
                  }
                />
              </div>
            );
          })}
      </div>
    </div>
  );
}
