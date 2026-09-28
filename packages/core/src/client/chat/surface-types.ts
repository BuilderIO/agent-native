import type { AgentTransport } from "@agent-native/agentkit/protocol";
import type {
  ComposerAgentOption,
  ComposerImageModelMenu,
} from "@agent-native/toolkit/composer/TiptapComposer";
import type { ExportedMessageRepository } from "@assistant-ui/react";
import type * as React from "react";

import type {
  AgentActionScope,
  AgentChatAttachment,
} from "../../agent/types.js";
import type { ReasoningEffort } from "../../shared/reasoning-effort.js";
import type { ThinkingDisplay } from "../../shared/thinking-display.js";
import type { AgentChatContextItem } from "../agent-chat.js";
import type {
  AgentComposerLayoutVariant,
  AgentSuggestionInput,
} from "../composer/index.js";
import type { AgentDynamicSuggestionsOption } from "../dynamic-suggestions.js";
import type {
  ChatThreadScope,
  ChatThreadSnapshot,
} from "../use-chat-threads.js";
import type { AssistantChatHistoryConfig } from "./history-types.js";
import type { BuilderSetupCardLayout } from "./run-recovery.js";
import type { AgentChatRuntime } from "./runtime.js";

export type AgentRequestMode = "act" | "plan";
export type AgentRecoveryAction = "continue" | "retry";

export type AgentChatSurfaceKind = "app" | "dev-frame" | "desktop";

export interface AssistantChatSendOptions {
  trackInRunsTray?: boolean;
  requestMode?: AgentRequestMode;
  attachments?: AgentChatAttachment[];
  /** Correlates with `AGENT_CHAT_SUBMIT_RESULT_EVENT` — see agent-chat.ts. */
  submitMessageId?: string;
  /** See `AgentChatMessage.usageLabel`. */
  usageLabel?: string;
  actionScope?: AgentActionScope;
  /** See `AgentChatMessage.approvedToolCalls`. */
  approvedToolCalls?: string[];
  /** Send as a protocol continuation that stays out of visible history. */
  hideUserMessage?: boolean;
}

export type AssistantChatSubmitResult =
  | { status: "submitted" }
  | {
      status: "rejected";
      reason: "engine-not-configured" | "submission-unavailable";
    };

export interface AssistantChatHandle {
  /** Programmatically submit a message and learn whether the chat accepted it. */
  sendMessage(
    text: string,
    images?: string[],
    options?: AssistantChatSendOptions,
  ): Promise<AssistantChatSubmitResult>;
  /** Implement the latest plan when the plan-mode callout is available. */
  implementPlan(): boolean;
  /** Programmatically prefill the composer without submitting. */
  prefillMessage(text: string): void;
  /**
   * Add or replace keyed context for the next composer submission.
   * Focuses the composer by default; pass `{ focus: false }` for passive
   * context mirroring (e.g. canvas selection) that must not steal focus.
   */
  setComposerContextItem(
    item: AgentChatContextItem,
    options?: { focus?: boolean },
  ): void;
  /** Remove a keyed context item from the composer. */
  removeComposerContextItem(key: string): void;
  /** Clear all staged context items from the composer. */
  clearComposerContextItems(): void;
  /** Programmatically send a recovery prompt without replacing the original request. */
  sendRecoveryMessage(
    text: string,
    recoveryAction: AgentRecoveryAction,
    images?: string[],
  ): Promise<AssistantChatSubmitResult>;
  /** Queue a message to send after the current run finishes */
  queueMessage(
    text: string,
    images?: string[],
  ): Promise<AssistantChatSubmitResult>;
  /** Whether the chat is currently running */
  isRunning(): boolean;
  /**
   * Whether the current run has a tool call or sub-agent (A2A) call that
   * hasn't returned a result yet. Mirrors the server's in-flight-work
   * tracking client-side so callers (e.g. `RunStuckBanner`) can tell a
   * genuinely stalled run apart from one still waiting on a long-running
   * tool/A2A call before treating "no progress" as safe to abort.
   */
  hasInFlightWork(): boolean;
  /** Focus the composer input */
  focusComposer(): void;
  /** Export the currently visible client-side thread for operations like fork. */
  exportThreadSnapshot(): ChatThreadSnapshot | null;
}

export type AssistantChatThreadFooterSlot =
  | React.ReactNode
  | ((context: {
      threadId: string | null;
      tabId: string | null;
    }) => React.ReactNode);

export type AssistantChatSuggestionVisibility =
  | "always"
  | "after-agent-response";

export function shouldShowAssistantChatSuggestions(
  visibility: AssistantChatSuggestionVisibility,
  hasAssistantMessage: boolean,
): boolean {
  return visibility === "always" || hasAssistantMessage;
}

export interface AssistantChatAdapterContext {
  apiUrl: string;
  streamingUrl?: string;
  tabId?: string;
  threadId?: string;
  modelRef: { current: string | undefined };
  engineRef: { current: string | undefined };
  effortRef: { current: ReasoningEffort | undefined };
  harnessRef?: { current: string | undefined };
  hostedHarnessRef?: { current: boolean };
  execModeRef: { current: "build" | "plan" | undefined };
  browserTabId?: string;
  scopeRef: { current: ChatThreadScope | null | undefined };
  surface: AgentChatSurfaceKind;
}

export interface AssistantChatProps {
  /** API endpoint URL. Default: "/_agent-native/agent-chat" */
  apiUrl?: string;
  /** Optional Nitro response-streaming endpoint, usually supplied by VITE_AGENT_NATIVE_AGENT_CHAT_STREAM_URL. */
  streamingUrl?: string;
  /** Stable tab identifier passed to the adapter for event correlation */
  tabId?: string;
  /** Stable browser tab id used for tab-scoped app-state context. */
  browserTabId?: string;
  /** Thread ID for SQL-backed persistence. When set, messages are loaded from and saved to the server. */
  threadId?: string;
  /** Resource scope to include with chat requests for server-side context. */
  contextScope?: ChatThreadScope | null;
  /** Optional host-owned resource history used for chat-side reverts. */
  chatHistory?: AssistantChatHistoryConfig<any, any, any>;
  /** Restrict server-side thread restores to the supplied app scope. */
  isolateHistoryByScope?: boolean;
  /** Namespace used to hide ambient composer context from other host surfaces. */
  contextNamespace?: string;
  /** Whether this chat owns the active visible composer context snapshot. */
  isActiveComposer?: boolean;
  /**
   * Identifies which surface hosts this chat. Defaults to "app", which keeps
   * dev filesystem/bash code-editing tools out of in-product sidebars.
   */
  agentChatSurface?: AgentChatSurfaceKind;
  /** Whether the desktop host is currently showing its unauthenticated identity gate. */
  desktopIdentityUnauthenticated?: boolean;
  /** Whether the desktop host has just established its authenticated identity session. */
  desktopIdentityAuthenticated?: boolean;
  /** Route completed first-party open_app calls through the host app pane. */
  suppressInlineOpenApp?: boolean;
  /** Placeholder text for empty state */
  emptyStateText?: string;
  /** Static or agent-authored next actions shown at the base of the chat. */
  suggestions?: AgentSuggestionInput[];
  /** Context-aware suggestions merged with `suggestions`. Enabled by default. */
  dynamicSuggestions?: AgentDynamicSuggestionsOption;
  /** Where suggestions appear. Context chips use a next-action bar at the thread base. */
  suggestionPlacement?:
    | "empty-state"
    | "context-chips"
    | "after-composer"
    | "hidden";
  /** When suggestions become visible. Full-page chat can defer them until the agent has replied. */
  suggestionVisibility?: AssistantChatSuggestionVisibility;
  /** Optional content rendered as part of the conversation before persisted messages. */
  threadContentSlot?: AssistantChatThreadFooterSlot;
  /** Optional content rendered at the bottom of the scrollable thread, after messages. */
  threadFooterSlot?: AssistantChatThreadFooterSlot;
  /** Optional content rendered in the empty state, above the suggestion buttons. */
  emptyStateAddon?: React.ReactNode;
  /** Optional content rendered in the empty state, below the suggestion
   *  buttons. Unlike `threadFooterSlot` this never survives the first message. */
  emptyStateFooter?: React.ReactNode;
  /** Whether to show the header bar. Default: true */
  showHeader?: boolean;
  /** CSS class for the outer container */
  className?: string;
  /** Callback when user clicks "Use CLI" button */
  onSwitchToCli?: () => void;
  /** Callback when message count changes */
  onMessageCountChange?: (count: number) => void;
  /** Callback to save thread data to the server (provided by useChatThreads) */
  onSaveThread?: (
    threadId: string,
    data: {
      threadData: string;
      title: string;
      preview: string;
      messageCount: number;
    },
  ) => void;
  /** Callback to generate a title from the first user message */
  onGenerateTitle?: (threadId: string, message: string) => void;
  /** Optional content rendered just above the composer input */
  composerSlot?: React.ReactNode;
  /** Optional home content rendered above the composer on an empty chat. */
  homeIntroSlot?: React.ReactNode;
  /** Optional content rendered below the composer on an empty chat. */
  afterComposerSlot?: React.ReactNode;
  /**
   * Called with the active composer's current plain text when it initializes
   * and as it changes.
   * Host apps can use this to render contextual, non-destructive affordances
   * beside the shared composer without replacing the composer stack.
   */
  onComposerTextChange?: (text: string) => void;
  /** Class applied to the shared composer area for host-specific sizing/skin. */
  composerAreaClassName?: string;
  /** Placeholder for the shared composer in its normal idle state. */
  composerPlaceholder?: string;
  /** Controls the compactness of the provider setup panel attached above the composer. */
  missingApiKeySetupLayout?: BuilderSetupCardLayout;
  /** Visual density for the shared composer shell. */
  composerLayoutVariant?: AgentComposerLayoutVariant;
  /** Center the composer on a fresh empty chat instead of pinning it low. */
  centerComposerWhenEmpty?: boolean;
  /** Hide the default empty-state icon/text/suggestions for custom start screens. */
  emptyStateDisplay?: "default" | "hidden";
  /** Optional content rendered inside the composer toolbar after the attach button. */
  composerToolbarSlot?: React.ReactNode;
  /** Optional action rendered beside the voice/send controls. */
  composerExtraActionButton?: React.ReactNode;
  /** Show the framework model picker in the shared composer. Defaults to true. */
  showModelSelector?: boolean;
  /** Disable the composer for capability-gated surfaces while still showing history. */
  composerDisabled?: boolean;
  /** Placeholder to show while the composer is disabled by the host surface. */
  composerDisabledPlaceholder?: string;
  /** When true, skip the restore skeleton (used for freshly created threads with no messages) */
  isNewThread?: boolean;
  /** Replace an active tab when its saved thread no longer exists. */
  onThreadRestoreNotFound?: () => void;
  /** Defer restore until the owning thread list has reconciled the active id. */
  isThreadStateLoading?: boolean;
  /** Called when a slash command (e.g. /clear, /help) is executed */
  onSlashCommand?: (command: string) => void;
  /** Current execution mode (build/plan) */
  execMode?: "build" | "plan";
  /** Callback to change execution mode */
  onExecModeChange?: (mode: "build" | "plan") => void;
  /** Disable Plan mode while leaving Act mode available. */
  planModeDisabled?: boolean;
  /** Explanation shown next to the disabled Plan option. */
  planModeDisabledReason?: string;
  /** Selected model override for this conversation (undefined = use server default) */
  selectedModel?: string;
  /** Default model from server config (shown in picker when no override is set) */
  defaultModel?: string;
  /** Selected engine override for this conversation */
  selectedEngine?: string;
  /** Selected effort override for this conversation */
  selectedEffort?: ReasoningEffort;
  /** Available engine/model list for the model picker */
  availableModels?: Array<{
    engine: string;
    label: string;
    models: string[];
    configured: boolean;
  }>;
  /** Whether the model list is still being resolved. */
  modelListLoading?: boolean;
  /** Callback when user picks a model from the picker */
  onModelChange?: (model: string, engine: string) => void;
  /** Callback when user picks an effort from the picker */
  onEffortChange?: (effort: ReasoningEffort) => void;
  /** Local or hosted agent runtimes shown above the model list. */
  availableAgents?: ComposerAgentOption[];
  /** Selected agent runtime identifier. */
  selectedAgent?: string;
  /** Mark the selected runtime as the hosted tools-only harness mode. */
  hostedHarness?: boolean;
  /** Callback when the user picks an agent runtime. */
  onAgentChange?: (agent: string) => void;
  /**
   * Optional secondary model menu (e.g. an image-generation model) shown inside
   * the composer's model picker. Opt-in; chat-only apps omit it.
   */
  imageModelMenu?: ComposerImageModelMenu;
  /** Callback when user clicks "Fork Chat" in the message actions menu */
  onForkChat?: () => void | boolean | Promise<void | boolean>;
  /** Override Builder/provider connect routing for embedded hosts. */
  onConnectProvider?: () => void;
  /** Route local runtime setup through the host's native bridge. */
  onConnectLocalRuntime?: (engine: string) => void;
  /**
   * Controls the shared composer + menu. Sidebar keeps the full menu by default;
   * hosts without the sidebar provider stack can use upload-only.
   */
  plusMenuMode?: "full" | "upload-only" | "hidden";
  /**
   * Enable framework provider/env status checks. Embedded hosts that provide
   * model/provider state through another transport can disable these probes.
   */
  providerStatusChecksEnabled?: boolean;
  /** Replace the built-in transport with an AgentKit-native BYO transport. */
  createTransport?: (context: AssistantChatAdapterContext) => AgentTransport;
  /**
   * Bring-your-own agent runtime. When supplied, AssistantChat keeps the
   * standard composer/transcript/tool rendering shell but sends turns through
   * this runtime instead of the built-in Agent-Native SSE endpoint.
   */
  runtime?: AgentChatRuntime;
  /**
   * Explicitly recreate an injected adapter or runtime when its identity
   * changes. Omit for the production sidebar so parent rerenders do not reset
   * active chats.
   */
  adapterReloadKey?: unknown;
  /**
   * Advanced host override for thread replay. Defaults to SQL thread fetch when
   * `threadId` is set, or sessionStorage for legacy tab chats.
   */
  loadHistoryRepository?: () => Promise<ExportedMessageRepository | null>;
  /** Re-run `loadHistoryRepository` when the host's external transcript changes. */
  historyReloadKey?: string | number | null;
  /** Smooth the last assistant message while an external transcript is updating. */
  externalStreaming?: boolean;
  /** Keep stopped-response actions visible for an embedded host's stop action. */
  externalUserStopped?: boolean;
  /** Notify an embedded host when the shared composer stop control is used. */
  onStop?: () => void | Promise<unknown>;
  /**
   * Optional host hooks for the inline `needsApproval` affordance beyond the
   * built-in Approve and action-type policy. Code sessions pass their
   * exact-command callback through for the standalone banner, but suppress the
   * shared action-type menu (see CodeAgentsApp).
   */
  approvalActions?: {
    onDeny?: (approvalKey: string) => void;
    onAlwaysAllow?: (
      approvalKey: string,
      toolName: string,
    ) => void | Promise<void>;
    alwaysAllowScope?: "action" | "exact-command";
  };
  /**
   * Pin how much model reasoning this chat shows: "expanded" opens the live
   * cell, "collapsed" keeps it one click away, "hidden" renders none. Omit to
   * let the reader's own preference apply, which is what surfaces the in-chat
   * control — a pinned mode hides it rather than leaving a dead menu item.
   */
  thinkingDisplay?: ThinkingDisplay;
}
