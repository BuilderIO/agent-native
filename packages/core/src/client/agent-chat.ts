/**
 * Agent Chat Bridge (browser)
 *
 * Sends structured messages to the agent chat from UI interactions.
 * Messages are sent via postMessage to the parent window (or self if top-level).
 * Builder frames are special: code requests go to Builder, but content prompts
 * stay inside the embedded app so its own AgentSidebar can receive them.
 */

import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import { agentNativePath } from "./api-path.js";
import {
  isInBuilderFrame,
  isTrustedBuilderMessage,
  sendToBuilderChat,
} from "./builder-frame.js";
import {
  isEmbedAuthActive,
  isEmbedMcpChatBridgeActive,
  markEmbedMcpChatBridgeActive,
  readEmbedMcpChatBridgeFlagFromUrl,
} from "./embed-auth.js";
import {
  getFramePostMessageTargetOrigin,
  isTrustedFrameMessage,
} from "./frame.js";
import { sendMcpAppHostMessage } from "./mcp-app-host.js";

export type AgentChatRequestMode = "act" | "plan";

export interface AgentChatMessage {
  /** The visible prompt message sent to the chat */
  message: string;
  /** Hidden context appended to the message (not shown in chat UI) */
  context?: string;
  /** true = auto-submit, false = prefill only, omit = use project setting */
  submit?: boolean;
  /** Optional project slug for structured context */
  projectSlug?: string;
  /** Optional preset name for downstream consumers */
  preset?: string;
  /** Optional reference image paths */
  referenceImagePaths?: string[];
  /** Optional uploaded reference images */
  uploadedReferenceImages?: string[];
  /** Optional image data URLs to include in the submitted chat message */
  images?: string[];
  /** Stable tab identifier — auto-generated if omitted */
  tabId?: string;
  /**
   * Message routing type:
   * - "content" (default): stays in the embedded app agent for content/data operations
   * - "code": routes to the code editing frame (Agent Native Desktop or Builder.io)
   *
   * When type is "code" and no frame is connected, a dialog is shown.
   * `requiresCode: true` is treated as `type: "code"` for backward compatibility.
   */
  type?: "content" | "code";
  /** @deprecated Use `type: "code"` instead. If true, treated as `type: "code"`. */
  requiresCode?: boolean;
  /** Model preference for this sub-agent (e.g. "claude-haiku-4-5"). Uses default if omitted */
  model?: string;
  /** Engine preference paired with model for cross-provider switches. */
  engine?: string;
  /** Reasoning effort preference paired with model. */
  effort?: ReasoningEffort;
  /**
   * Execution mode for this submitted turn. When omitted, sendToAgentChat
   * snapshots the current AgentPanel mode from localStorage when available.
   */
  mode?: AgentChatRequestMode;
  /** @deprecated Use `mode` instead. */
  requestMode?: AgentChatRequestMode;
  /** Scoped system prompt additions for this sub-agent */
  instructions?: string;
  /**
   * Whether to open the agent sidebar if it's currently hidden.
   * Defaults to true — submitting a chat should make the response visible.
   * Pass `false` for background/silent sends that shouldn't pop the UI open.
   */
  openSidebar?: boolean;
  /**
   * When true, opens a new chat tab before sending the message.
   * Use for creation requests (create tool, dashboard, etc.) that deserve
   * their own isolated thread rather than cluttering an existing conversation.
   */
  newTab?: boolean;
  /**
   * When true with newTab, creates the tab in the background without
   * focusing it or opening the sidebar. The message runs silently.
   */
  background?: boolean;
}

export interface AgentChatContextItem {
  /** Stable key used to replace an existing context nugget. */
  key: string;
  /** Short label shown in the composer context chip. */
  title: string;
  /** Hidden context included with the next submitted prompt. */
  context: string;
}

export interface AgentChatContextSetOptions extends AgentChatContextItem {
  /**
   * Whether to open the agent sidebar if it's currently hidden.
   * Defaults to true so the user can see the staged context.
   */
  openSidebar?: boolean;
}

/** @deprecated Use `AgentChatContextSetOptions` instead. */
export type AgentChatContextMessage = AgentChatContextSetOptions;

export interface AgentChatContextState {
  items: AgentChatContextItem[];
  updatedAt: number;
}

export interface AgentChatContextMutationOptions {
  /**
   * Whether to open the agent sidebar if it's currently hidden.
   * Defaults to true for set/add and false for remove/clear.
   */
  openSidebar?: boolean;
}

export interface AgentChatContextRemoveOptions extends AgentChatContextMutationOptions {
  /** Stable key of the staged context nugget to remove. */
  key: string;
}

const AGENT_CHAT_MESSAGE_TYPE = "agentNative.submitChat";
const AGENT_CHAT_CONTEXT_STATE_KEY = "agent-chat-context";
const AGENT_CHAT_EXEC_MODE_KEY = "agent-native-exec-mode";
export const AGENT_CHAT_CONTEXT_CHANGED_EVENT =
  "agentNative.chatContextChanged";
export const AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE = "agentNative.setChatContext";
export const AGENT_CHAT_REMOVE_CONTEXT_MESSAGE_TYPE =
  "agentNative.removeChatContext";
export const AGENT_CHAT_CLEAR_CONTEXT_MESSAGE_TYPE =
  "agentNative.clearChatContext";
const AGENT_PANEL_PREPARE_EVENT = "agent-panel:prepare";

let agentChatContextState: AgentChatContextState = {
  items: [],
  updatedAt: 0,
};
const agentChatContextListeners = new Set<() => void>();

/**
 * Listen for chatRunning messages from the frame (postMessage)
 * and re-dispatch as a CustomEvent so hooks like useAgentChatGenerating() work.
 */
if (typeof window !== "undefined") {
  window.addEventListener("message", (event) => {
    if (!isTrustedFrameMessage(event) && !isTrustedBuilderMessage(event)) {
      return;
    }
    if (
      event.data?.type === "agentNative.chatRunning" ||
      event.data?.type === "builder.chatRunning"
    ) {
      window.dispatchEvent(
        new CustomEvent("agentNative.chatRunning", {
          detail: event.data.detail ?? event.data.data,
        }),
      );
    }
  });
}

/** Generate a unique tab ID */
export function generateTabId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Unique id for one submitted message, used to dedup live + replayed sends. */
function generateSubmitMessageId(): string {
  return `submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Self-submit buffer: same-window sends post to `window` itself, but the
// receiver is lazy-loaded and may not be listening yet. Buffer each submit so
// the panel can replay it on mount; claimAgentChatSubmit dedups by id so a
// submit received both live and replayed is delivered exactly once.
interface BufferedSelfSubmit {
  id: string;
  data: Record<string, unknown>;
  at: number;
}

const SELF_SUBMIT_BUFFER_TTL_MS = 8000;
const bufferedSelfSubmits: BufferedSelfSubmit[] = [];
const claimedSubmitIds = new Set<string>();

function pruneSelfSubmitBuffer(now: number): void {
  for (let i = bufferedSelfSubmits.length - 1; i >= 0; i -= 1) {
    if (now - bufferedSelfSubmits[i].at > SELF_SUBMIT_BUFFER_TTL_MS) {
      const [removed] = bufferedSelfSubmits.splice(i, 1);
      if (removed) claimedSubmitIds.delete(removed.id);
    }
  }
}

function bufferSelfSubmit(data: Record<string, unknown>): void {
  const id =
    typeof data.submitMessageId === "string" ? data.submitMessageId : undefined;
  if (!id) return;
  const now = Date.now();
  pruneSelfSubmitBuffer(now);
  bufferedSelfSubmits.push({ id, data, at: now });
}

/** Unclaimed self-submit payloads, for the panel to replay once it mounts. */
export function drainBufferedAgentChatSubmits(): Array<
  Record<string, unknown>
> {
  pruneSelfSubmitBuffer(Date.now());
  return bufferedSelfSubmits
    .filter((entry) => !claimedSubmitIds.has(entry.id))
    .map((entry) => entry.data);
}

/** Claim a submit; false if already handled. Idless submits always pass. */
export function claimAgentChatSubmit(id: string | undefined): boolean {
  if (!id) return true;
  if (claimedSubmitIds.has(id)) return false;
  claimedSubmitIds.add(id);
  return true;
}

/** Test-only: reset the self-submit buffer and claim set. */
export function _resetAgentChatSubmitBufferForTests(): void {
  bufferedSelfSubmits.length = 0;
  claimedSubmitIds.clear();
}

export function normalizeAgentChatContextItem(
  item: unknown,
): AgentChatContextItem | null {
  if (typeof item !== "object" || item === null) return null;
  const candidate = item as Partial<AgentChatContextItem>;
  if (
    typeof candidate.key !== "string" ||
    typeof candidate.context !== "string" ||
    typeof candidate.title !== "string"
  ) {
    return null;
  }
  const key = candidate.key.trim();
  const context = candidate.context.trim();
  if (!key || !context) return null;
  return {
    key,
    title: candidate.title.trim() || key,
    context,
  };
}

export function normalizeAgentChatContextItems(
  items: unknown,
): AgentChatContextItem[] {
  if (!Array.isArray(items)) return [];
  const deduped = new Map<string, AgentChatContextItem>();
  for (const rawItem of items) {
    const item = normalizeAgentChatContextItem(rawItem);
    if (!item) continue;
    deduped.set(item.key, item);
  }
  return [...deduped.values()];
}

function normalizeAgentChatContextState(
  value: unknown,
): AgentChatContextState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    value?: unknown;
    items?: unknown;
    updatedAt?: unknown;
  };
  const candidate =
    raw.value && typeof raw.value === "object"
      ? (raw.value as { items?: unknown; updatedAt?: unknown })
      : raw;
  const items = normalizeAgentChatContextItems(candidate.items);
  return {
    items,
    updatedAt:
      typeof candidate.updatedAt === "number" ? candidate.updatedAt : 0,
  };
}

function withReplacedAgentChatContextItem(
  items: readonly AgentChatContextItem[],
  item: AgentChatContextItem,
): AgentChatContextItem[] {
  const index = items.findIndex((current) => current.key === item.key);
  if (index === -1) return [...items, item];
  return items.map((current, currentIndex) =>
    currentIndex === index ? item : current,
  );
}

function notifyAgentChatContextListeners(): void {
  for (const listener of agentChatContextListeners) listener();
}

function persistAgentChatContextState(state: AgentChatContextState): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  fetch(
    agentNativePath(
      `/_agent-native/application-state/${AGENT_CHAT_CONTEXT_STATE_KEY}`,
    ),
    {
      method: "PUT",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    },
  ).catch(() => {});
}

export function publishAgentChatContextItems(
  items: readonly AgentChatContextItem[],
  options?: { persist?: boolean; updatedAt?: number },
): AgentChatContextState {
  const next: AgentChatContextState = {
    items: normalizeAgentChatContextItems([...items]),
    updatedAt: options?.updatedAt ?? Date.now(),
  };
  if (next.updatedAt < agentChatContextState.updatedAt) {
    return agentChatContextState;
  }
  agentChatContextState = next;
  notifyAgentChatContextListeners();
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AGENT_CHAT_CONTEXT_CHANGED_EVENT, {
        detail: next,
      }),
    );
  }
  if (options?.persist !== false) {
    persistAgentChatContextState(next);
  }
  return next;
}

export function getAgentChatContextState(): AgentChatContextState {
  return agentChatContextState;
}

export function listAgentChatContext(): AgentChatContextItem[] {
  return [...agentChatContextState.items];
}

export function subscribeAgentChatContext(listener: () => void): () => void {
  agentChatContextListeners.add(listener);
  return () => {
    agentChatContextListeners.delete(listener);
  };
}

export async function refreshAgentChatContext(): Promise<AgentChatContextState> {
  if (typeof window === "undefined" || typeof fetch !== "function") {
    return agentChatContextState;
  }
  try {
    const res = await fetch(
      agentNativePath(
        `/_agent-native/application-state/${AGENT_CHAT_CONTEXT_STATE_KEY}`,
      ),
    );
    if (!res.ok || res.status === 204) return agentChatContextState;
    const text = await res.text();
    if (!text) return agentChatContextState;
    const state = normalizeAgentChatContextState(JSON.parse(text));
    if (!state) return agentChatContextState;
    return publishAgentChatContextItems(state.items, {
      persist: false,
      updatedAt: state.updatedAt,
    });
  } catch {
    return agentChatContextState;
  }
}

export function formatAgentChatContextItemsForPrompt(
  items: readonly AgentChatContextItem[],
): string {
  return items
    .map(normalizeAgentChatContextItem)
    .filter((item): item is AgentChatContextItem => item !== null)
    .map((item) => [`## ${item.title}`, item.context].join("\n"))
    .join("\n\n");
}

export function appendAgentChatContextToMessage(
  message: string,
  context: string,
): string {
  const trimmedContext = context.trim();
  if (!trimmedContext) return message;
  return `${message.trim()}\n\n<context>\n${trimmedContext}\n</context>`;
}

function postAgentChatContextMessage(
  type:
    | typeof AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE
    | typeof AGENT_CHAT_REMOVE_CONTEXT_MESSAGE_TYPE
    | typeof AGENT_CHAT_CLEAR_CONTEXT_MESSAGE_TYPE,
  data: unknown,
  options: { openSidebar: boolean },
): void {
  if (typeof window === "undefined") return;

  const payload = { type, data };
  const targetSelf = isInBuilderFrame() || isDirectMcpAppEmbedSession();
  const target = targetSelf
    ? window
    : window.parent !== window
      ? window.parent
      : window;
  const targetOrigin = targetSelf
    ? window.location.origin
    : getFramePostMessageTargetOrigin() || window.location.origin;

  if (options.openSidebar) {
    window.dispatchEvent(
      new CustomEvent("agent-panel:set-mode", {
        detail: { mode: "chat" },
      }),
    );
    window.dispatchEvent(new CustomEvent("agent-panel:open"));
  } else {
    window.dispatchEvent(new CustomEvent(AGENT_PANEL_PREPARE_EVENT));
  }

  const postToTarget = () => target.postMessage(payload, targetOrigin);
  if (target === window) {
    setTimeout(postToTarget, 0);
  } else {
    postToTarget();
  }
}

function isMcpAppChatBridgeEnabled(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  if (readEmbedMcpChatBridgeFlagFromUrl()) markEmbedMcpChatBridgeActive();
  return isEmbedMcpChatBridgeActive() && isEmbedAuthActive();
}

function isDirectMcpAppEmbedSession(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  if (readEmbedMcpChatBridgeFlagFromUrl()) markEmbedMcpChatBridgeActive();
  return isEmbedAuthActive() && !isEmbedMcpChatBridgeActive();
}

function dispatchAgentChatRunning(isRunning: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agentNative.chatRunning", {
      detail: { isRunning },
    }),
  );
}

function normalizeAgentChatRequestMode(
  value: unknown,
): AgentChatRequestMode | undefined {
  return value === "act" || value === "plan" ? value : undefined;
}

/** A normalized `agentNative.submitChat` payload — decode via {@link parseSubmitChatMessage}. */
export interface ParsedSubmitChat {
  /** Visible prompt text (non-empty). */
  message: string;
  context?: string;
  /** Submit (true) or prefill only (false); defaults to true. */
  submit: boolean;
  openSidebar?: boolean;
  model?: string;
  /** Raw effort hint; the receiver validates it against the model. */
  effort?: unknown;
  newTab?: boolean;
  background?: boolean;
  tabId?: string;
  images?: string[];
  /** Mode as sent; the receiver falls back to its exec mode when undefined. */
  requestMode?: AgentChatRequestMode;
  /** Id used to dedup the live post against a cold-start replay. */
  submitMessageId?: string;
}

/** Decode a `message` event into a submit payload, or null if it isn't one / has no text. */
export function parseSubmitChatMessage(
  event: MessageEvent,
): ParsedSubmitChat | null {
  const envelope =
    event.data && typeof event.data === "object"
      ? (event.data as { type?: unknown; data?: unknown })
      : null;
  if (!envelope || envelope.type !== AGENT_CHAT_MESSAGE_TYPE) return null;
  const raw =
    envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null;
  if (!raw) return null;
  const message = typeof raw.message === "string" ? raw.message : "";
  if (!message) return null;
  const images = Array.isArray(raw.images)
    ? raw.images.filter(
        (image): image is string =>
          typeof image === "string" && image.length > 0,
      )
    : undefined;
  return {
    message,
    context: typeof raw.context === "string" ? raw.context : undefined,
    submit: raw.submit !== false,
    openSidebar:
      typeof raw.openSidebar === "boolean" ? raw.openSidebar : undefined,
    model: typeof raw.model === "string" ? raw.model : undefined,
    effort: raw.effort,
    newTab: typeof raw.newTab === "boolean" ? raw.newTab : undefined,
    background:
      typeof raw.background === "boolean" ? raw.background : undefined,
    tabId: typeof raw.tabId === "string" ? raw.tabId : undefined,
    images,
    requestMode: normalizeAgentChatRequestMode(raw.requestMode ?? raw.mode),
    submitMessageId:
      typeof raw.submitMessageId === "string" ? raw.submitMessageId : undefined,
  };
}

function normalizeStoredAgentChatExecMode(
  value: string | null,
): AgentChatRequestMode | undefined {
  if (value === "plan") return "plan";
  if (value === "build" || value === "act") return "act";
  return undefined;
}

function readStoredAgentChatRequestMode(): AgentChatRequestMode | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const storage = window.localStorage;
    const saved = normalizeStoredAgentChatExecMode(
      storage.getItem(AGENT_CHAT_EXEC_MODE_KEY),
    );
    if (saved) return saved;
    const scopedModes: AgentChatRequestMode[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(`${AGENT_CHAT_EXEC_MODE_KEY}:`)) continue;
      const scopedSaved = normalizeStoredAgentChatExecMode(
        storage.getItem(key),
      );
      if (scopedSaved) scopedModes.push(scopedSaved);
    }
    if (scopedModes.length === 1) return scopedModes[0];
  } catch {}
  return undefined;
}

/**
 * Send a message to the agent chat via postMessage.
 * Returns the stable tabId for tracking this chat run.
 */
export function sendToAgentChat(opts: AgentChatMessage): string {
  const tabId = opts.tabId ?? generateTabId();
  const isCodeRequest = opts.type === "code" || opts.requiresCode === true;
  const requestMode =
    normalizeAgentChatRequestMode(opts.requestMode ?? opts.mode) ??
    readStoredAgentChatRequestMode();
  if (isCodeRequest && isInBuilderFrame()) {
    sendToBuilderChat({
      message: opts.message,
      context: opts.context,
      submit: opts.submit,
      ...(requestMode ? { mode: requestMode, requestMode } : {}),
    });
    return tabId;
  }

  const submitMessageId = generateSubmitMessageId();
  const payload = {
    type: AGENT_CHAT_MESSAGE_TYPE,
    data: {
      ...opts,
      tabId,
      submitMessageId,
      ...(requestMode ? { mode: requestMode, requestMode } : {}),
    },
  };

  if (opts.submit !== false && isMcpAppChatBridgeEnabled()) {
    const directHostMessage = sendMcpAppHostMessage({
      message: opts.message,
      context: opts.context,
      ...(requestMode ? { mode: requestMode, requestMode } : {}),
    });
    if (directHostMessage) {
      void Promise.resolve(directHostMessage)
        .then((ok) => {
          if (!ok) {
            window.parent.postMessage(
              payload,
              getFramePostMessageTargetOrigin() || "*",
            );
          }
        })
        .finally(() => {
          dispatchAgentChatRunning(false);
        });
      return tabId;
    }
    window.parent.postMessage(
      payload,
      getFramePostMessageTargetOrigin() || "*",
    );
    return tabId;
  }

  const shouldOpenSidebar = opts.openSidebar !== false && !opts.background;

  const targetSelf =
    !isCodeRequest && (isInBuilderFrame() || isDirectMcpAppEmbedSession());
  const target = targetSelf
    ? window
    : window.parent !== window
      ? window.parent
      : window;
  const targetOrigin = targetSelf
    ? window.location.origin
    : getFramePostMessageTargetOrigin() || window.location.origin;
  if (shouldOpenSidebar) {
    window.dispatchEvent(
      new CustomEvent("agent-panel:set-mode", {
        detail: { mode: "chat" },
      }),
    );
    window.dispatchEvent(new CustomEvent("agent-panel:open"));
  } else if (!isCodeRequest) {
    window.dispatchEvent(new CustomEvent(AGENT_PANEL_PREPARE_EVENT));
  }

  const postToTarget = () => target.postMessage(payload, targetOrigin);

  // Same-window: defer one tick so a sidebar mounting now can attach its
  // listener, and buffer the submit so the lazy panel can replay it if it
  // mounts later. The live post and the replay dedup by submitMessageId.
  if (!isCodeRequest && target === window) {
    bufferSelfSubmit(payload.data);
    setTimeout(postToTarget, 0);
  } else {
    postToTarget();
  }
  return tabId;
}

/**
 * Add or replace a keyed context nugget in the active agent chat composer.
 * The context is not submitted until the user sends the prompt.
 */
export function setAgentChatContextItem(
  opts: AgentChatContextSetOptions,
): void {
  const item = normalizeAgentChatContextItem(opts);
  if (!item || typeof window === "undefined") return;

  publishAgentChatContextItems(
    withReplacedAgentChatContextItem(agentChatContextState.items, item),
  );
  postAgentChatContextMessage(AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE, item, {
    openSidebar: opts.openSidebar !== false,
  });
}

/** @deprecated Use `setAgentChatContextItem` instead. */
export const setContextToAgentChat = setAgentChatContextItem;

/** @deprecated Use `setAgentChatContextItem` instead. */
export const addContextToAgentChat = setAgentChatContextItem;

export function removeAgentChatContextItem(
  keyOrOpts: string | AgentChatContextRemoveOptions,
): void {
  const key =
    typeof keyOrOpts === "string" ? keyOrOpts.trim() : keyOrOpts.key.trim();
  if (!key || typeof window === "undefined") return;
  const openSidebar =
    typeof keyOrOpts === "string" ? false : keyOrOpts.openSidebar === true;

  publishAgentChatContextItems(
    agentChatContextState.items.filter((item) => item.key !== key),
  );
  postAgentChatContextMessage(
    AGENT_CHAT_REMOVE_CONTEXT_MESSAGE_TYPE,
    { key },
    { openSidebar },
  );
}

export function clearAgentChatContext(
  opts: AgentChatContextMutationOptions = {},
): void {
  if (typeof window === "undefined") return;
  publishAgentChatContextItems([]);
  postAgentChatContextMessage(
    AGENT_CHAT_CLEAR_CONTEXT_MESSAGE_TYPE,
    {},
    { openSidebar: opts.openSidebar === true },
  );
}

export function _resetAgentChatContextForTests(): void {
  agentChatContextState = { items: [], updatedAt: 0 };
  notifyAgentChatContextListeners();
}
