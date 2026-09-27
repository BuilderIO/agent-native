import {
  normalizeAgentActionScope,
  tryNormalizeAgentActionScope,
  type AgentActionScope,
  type AgentChatAttachment,
  type MentionItemMedia,
} from "../agent/types.js";
import type { ReasoningEffort } from "../shared/reasoning-effort.js";
import { trackEvent } from "./analytics.js";
import { agentNativePath } from "./api-path.js";
import { readClientAppState } from "./application-state.js";
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

export { appendAgentChatContextToMessage } from "../shared/agent-chat-context.js";

export type AgentChatRequestMode = "act" | "plan";

export interface AgentChatMessage {
  message: string;
  context?: string;
  actionScope?: AgentActionScope;
  submit?: boolean;
  projectSlug?: string;
  preset?: string;
  referenceImagePaths?: string[];
  uploadedReferenceImages?: string[];
  images?: string[];
  attachments?: AgentChatAttachment[];
  /** Stable tab identifier — auto-generated if omitted */
  tabId?: string;
  targetTabId?: string;
  type?: "content" | "code";
  /** @deprecated Use `type: "code"` instead. If true, treated as `type: "code"`. */
  requiresCode?: boolean;
  model?: string;
  engine?: string;
  effort?: ReasoningEffort;
  mode?: AgentChatRequestMode;
  /** @deprecated Use `mode` instead. */
  requestMode?: AgentChatRequestMode;
  instructions?: string;
  chatTarget?: "auto" | "local";
  openSidebar?: boolean;
  newTab?: boolean;
  reuseEmptyTab?: boolean;
  background?: boolean;
  /**
   * Stable id used to deduplicate a submit and correlate it with
   * {@link AGENT_CHAT_SUBMIT_RESULT_EVENT}. Auto-generated if omitted.
   */
  submitMessageId?: string;
  usageLabel?: string;
  approvedToolCalls?: string[];
}

export interface AgentChatContextItem {
  key: string;
  title: string;
  context: string;
  contextNamespace?: string;
}

export interface AgentChatContextSetOptions extends AgentChatContextItem {
  openSidebar?: boolean;
  focus?: boolean;
}

/** @deprecated Use `AgentChatContextSetOptions` instead. */
export type AgentChatContextMessage = AgentChatContextSetOptions;

export interface AgentChatContextState {
  items: AgentChatContextItem[];
  updatedAt: number;
}

export interface AgentChatOpenThreadRequest {
  threadId: string;
  newThread?: boolean;
  prefill?: string;
  onlyIfActiveThreadId?: string;
  openRequestId?: string;
}

export interface AgentChatOpenTaskRequest {
  threadId: string;
  parentThreadId?: string;
  description?: string;
  name?: string;
  openRequestId?: string;
}

export type BufferedAgentChatOpenRequest = {
  id: string;
  eventType: "agent-chat:open-thread" | "agent-task-open";
  detail: AgentChatOpenThreadRequest | AgentChatOpenTaskRequest;
};

export interface AgentComposerReference {
  label: string;
  icon?: string;
  media?: MentionItemMedia;
  source?: string;
  refType: string;
  refId?: string | null;
  refPath?: string | null;
  slotKey?: string;
  slotLabel?: string;
  metadata?: Record<string, unknown>;
  clearsSlots?: string[];
  relatedReferences?: AgentComposerReference[];
}

export interface AgentComposerReferenceInsertOptions {
  openSidebar?: boolean;
}

export interface AgentComposerReferenceInsertPayload extends AgentComposerReference {
  insertMessageId: string;
}

export interface AgentChatContextMutationOptions {
  openSidebar?: boolean;
}

export interface AgentChatContextRemoveOptions extends AgentChatContextMutationOptions {
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
export const AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE =
  "agentNative.insertComposerReference";
export const AGENT_CHAT_INSERT_REFERENCE_EVENT =
  "agentNative:insert-composer-reference";
const AGENT_PANEL_PREPARE_EVENT = "agent-panel:prepare";

export const AGENT_CHAT_SUBMIT_RESULT_EVENT = "agentNative.chatSubmitResult";
export const AGENT_CHAT_SUBMIT_TARGET_EVENT = "agentNative.chatSubmitTarget";

export interface AgentChatSubmitResult {
  submitMessageId: string;
  delivered: boolean;
  reason?: string;
}

export interface AgentChatSubmitTarget {
  submitMessageId: string;
  tabId: string;
}

export function reportAgentChatSubmitTarget(
  submitMessageId: string | undefined,
  tabId: string,
): void {
  if (!submitMessageId || !tabId || typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<AgentChatSubmitTarget>(AGENT_CHAT_SUBMIT_TARGET_EVENT, {
      detail: { submitMessageId, tabId },
    }),
  );
}

export function reportAgentChatSubmitResult(
  submitMessageId: string | undefined,
  delivered: boolean,
  reason?: string,
): void {
  if (
    !submitMessageId ||
    cancelledSubmitIds.has(submitMessageId) ||
    typeof window === "undefined"
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<AgentChatSubmitResult>(AGENT_CHAT_SUBMIT_RESULT_EVENT, {
      detail: { submitMessageId, delivered, reason },
    }),
  );
}

let agentChatContextState: AgentChatContextState = {
  items: [],
  updatedAt: 0,
};
const agentChatContextListeners = new Set<() => void>();
let agentChatContextNotifyQueued = false;

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

export function generateTabId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function generateAgentChatSubmitMessageId(): string {
  return `submit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface BufferedSelfSubmit {
  id: string;
  data: Record<string, unknown>;
  at: number;
}

const SELF_SUBMIT_BUFFER_TTL_MS = 8000;
const bufferedSelfSubmits: BufferedSelfSubmit[] = [];
const claimedSubmitIds = new Set<string>();
const cancelledSubmitIds = new Set<string>();

interface BufferedOpenRequest extends BufferedAgentChatOpenRequest {
  at: number;
}

const OPEN_REQUEST_BUFFER_TTL_MS = 8000;
const bufferedOpenRequests: BufferedOpenRequest[] = [];
const claimedOpenRequestIds = new Set<string>();

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

export function cancelAgentChatSubmit(id: string | undefined): void {
  if (!id) return;
  cancelledSubmitIds.add(id);
  claimedSubmitIds.add(id);
  for (let index = bufferedSelfSubmits.length - 1; index >= 0; index -= 1) {
    if (bufferedSelfSubmits[index]?.id === id) {
      bufferedSelfSubmits.splice(index, 1);
    }
  }
}

export function isAgentChatSubmitCancelled(id: string | undefined): boolean {
  return Boolean(id && cancelledSubmitIds.has(id));
}

function pruneOpenRequestBuffer(now: number): void {
  for (let i = bufferedOpenRequests.length - 1; i >= 0; i -= 1) {
    if (now - bufferedOpenRequests[i].at > OPEN_REQUEST_BUFFER_TTL_MS) {
      const [removed] = bufferedOpenRequests.splice(i, 1);
      if (removed) claimedOpenRequestIds.delete(removed.id);
    }
  }
}

function bufferOpenRequest(
  eventType: BufferedAgentChatOpenRequest["eventType"],
  detail: AgentChatOpenThreadRequest | AgentChatOpenTaskRequest,
): BufferedOpenRequest {
  const now = Date.now();
  pruneOpenRequestBuffer(now);
  const id = `open-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: BufferedOpenRequest = {
    id,
    eventType,
    detail: { ...detail, openRequestId: id },
    at: now,
  };
  bufferedOpenRequests.push(entry);
  return entry;
}

export function drainBufferedAgentChatSubmits(): Array<
  Record<string, unknown>
> {
  pruneSelfSubmitBuffer(Date.now());
  return bufferedSelfSubmits
    .filter((entry) => !claimedSubmitIds.has(entry.id))
    .map((entry) => entry.data);
}

export function claimAgentChatSubmit(id: string | undefined): boolean {
  if (!id) return true;
  if (cancelledSubmitIds.has(id)) return false;
  if (claimedSubmitIds.has(id)) return false;
  claimedSubmitIds.add(id);
  return true;
}

export function drainBufferedAgentChatOpenRequests(): BufferedAgentChatOpenRequest[] {
  pruneOpenRequestBuffer(Date.now());
  return bufferedOpenRequests
    .filter((entry) => !claimedOpenRequestIds.has(entry.id))
    .map(({ id, eventType, detail }) => ({ id, eventType, detail }));
}

export function claimAgentChatOpenRequest(id: unknown): boolean {
  if (typeof id !== "string" || !id) return true;
  if (claimedOpenRequestIds.has(id)) return false;
  claimedOpenRequestIds.add(id);
  return true;
}

export function _resetAgentChatSubmitBufferForTests(): void {
  bufferedSelfSubmits.length = 0;
  claimedSubmitIds.clear();
  cancelledSubmitIds.clear();
  bufferedOpenRequests.length = 0;
  claimedOpenRequestIds.clear();
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
  const contextNamespace =
    typeof candidate.contextNamespace === "string"
      ? candidate.contextNamespace.trim()
      : "";
  return {
    key,
    title: candidate.title.trim() || key,
    context,
    ...(contextNamespace ? { contextNamespace } : {}),
  };
}

export function filterAgentChatContextItems(
  items: readonly AgentChatContextItem[],
  contextNamespace?: string | null,
): AgentChatContextItem[] {
  const namespace = contextNamespace?.trim();
  if (!namespace) return [...items];
  return items.filter(
    (item) =>
      !item.contextNamespace || item.contextNamespace.trim() === namespace,
  );
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
  if (agentChatContextNotifyQueued) return;
  agentChatContextNotifyQueued = true;
  const notify = () => {
    agentChatContextNotifyQueued = false;
    for (const listener of Array.from(agentChatContextListeners)) listener();
  };
  if (typeof queueMicrotask === "function") {
    queueMicrotask(notify);
  } else {
    setTimeout(notify, 0);
  }
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
    const raw = await readClientAppState(AGENT_CHAT_CONTEXT_STATE_KEY);
    if (raw === null) return agentChatContextState;
    const state = normalizeAgentChatContextState(raw);
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

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeMetadata(
  value: unknown,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function normalizeMentionItemMedia(
  value: unknown,
): AgentComposerReference["media"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.type === "none") return { type: "none" };
  const backgroundColor =
    typeof candidate.backgroundColor === "string"
      ? candidate.backgroundColor.trim()
      : "";
  if (candidate.type === "text") {
    const text =
      typeof candidate.text === "string" ? candidate.text.trim() : "";
    if (!text) return undefined;
    return {
      type: "text",
      text,
      ...(backgroundColor ? { backgroundColor } : {}),
    };
  }
  if (candidate.type === "image") {
    const src = typeof candidate.src === "string" ? candidate.src.trim() : "";
    if (!src) return undefined;
    const fit = candidate.fit === "cover" ? "cover" : "contain";
    return {
      type: "image",
      src,
      fit,
      ...(backgroundColor ? { backgroundColor } : {}),
    };
  }
  return undefined;
}

function normalizeAgentComposerReferenceInternal(
  value: unknown,
  depth: number,
): AgentComposerReference | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Partial<AgentComposerReference>;
  const label =
    typeof candidate.label === "string" ? candidate.label.trim() : "";
  const refType =
    typeof candidate.refType === "string" ? candidate.refType.trim() : "";
  if (!label || !refType) return null;
  const normalized: AgentComposerReference = {
    label,
    icon:
      typeof candidate.icon === "string" && candidate.icon.trim()
        ? candidate.icon.trim()
        : undefined,
    source:
      typeof candidate.source === "string" && candidate.source.trim()
        ? candidate.source.trim()
        : undefined,
    refType,
    refId:
      typeof candidate.refId === "string" && candidate.refId.trim()
        ? candidate.refId.trim()
        : null,
    refPath:
      typeof candidate.refPath === "string" && candidate.refPath.trim()
        ? candidate.refPath.trim()
        : null,
  };
  const slotKey =
    typeof candidate.slotKey === "string" ? candidate.slotKey.trim() : "";
  if (slotKey) normalized.slotKey = slotKey;
  const slotLabel =
    typeof candidate.slotLabel === "string" ? candidate.slotLabel.trim() : "";
  if (slotLabel) normalized.slotLabel = slotLabel;
  const media = normalizeMentionItemMedia(candidate.media);
  if (media) normalized.media = media;
  const metadata = normalizeMetadata(candidate.metadata);
  if (metadata) normalized.metadata = metadata;
  const clearsSlots = normalizeStringArray(candidate.clearsSlots);
  if (clearsSlots) normalized.clearsSlots = clearsSlots;
  if (depth < 3 && Array.isArray(candidate.relatedReferences)) {
    const relatedReferences = candidate.relatedReferences
      .map((item) => normalizeAgentComposerReferenceInternal(item, depth + 1))
      .filter((item): item is AgentComposerReference => item !== null);
    if (relatedReferences.length > 0) {
      normalized.relatedReferences = relatedReferences;
    }
  }
  return normalized;
}

export function normalizeAgentComposerReference(
  value: unknown,
): AgentComposerReference | null {
  return normalizeAgentComposerReferenceInternal(value, 0);
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

  const shouldForwardOpenSidebar =
    (type === AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE &&
      options.openSidebar === false) ||
    (type !== AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE &&
      options.openSidebar === true);
  const payloadData =
    shouldForwardOpenSidebar && typeof data === "object" && data !== null
      ? {
          ...(data as Record<string, unknown>),
          openSidebar: options.openSidebar,
        }
      : data;
  const payload = { type, data: payloadData };
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

function postAgentChatReferenceMessage(
  payload: AgentComposerReferenceInsertPayload,
  options: { openSidebar: boolean },
): void {
  if (typeof window === "undefined") return;

  const message = {
    type: AGENT_CHAT_INSERT_REFERENCE_MESSAGE_TYPE,
    data: payload,
  };
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

  window.dispatchEvent(
    new CustomEvent(AGENT_CHAT_INSERT_REFERENCE_EVENT, {
      detail: payload,
    }),
  );

  const postToTarget = () => target.postMessage(message, targetOrigin);
  if (target === window) {
    setTimeout(postToTarget, 0);
  } else {
    postToTarget();
  }
}

function openAgentPanelForChat(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agent-panel:set-mode", {
      detail: { mode: "chat" },
    }),
  );
  window.dispatchEvent(new CustomEvent("agent-panel:open"));
}

function dispatchBufferedOpenRequest(entry: BufferedOpenRequest): void {
  if (typeof window === "undefined") return;
  const dispatch = () => {
    window.dispatchEvent(
      new CustomEvent(entry.eventType, { detail: entry.detail }),
    );
  };
  setTimeout(dispatch, 0);
}

export function requestAgentChatThreadOpen(
  detail: AgentChatOpenThreadRequest,
): void {
  if (typeof window === "undefined" || !detail.threadId.trim()) return;
  openAgentPanelForChat();
  dispatchBufferedOpenRequest(
    bufferOpenRequest("agent-chat:open-thread", {
      ...detail,
      threadId: detail.threadId.trim(),
      ...(detail.prefill?.trim() ? { prefill: detail.prefill } : {}),
    }),
  );
}

export function requestAgentTaskOpen(detail: AgentChatOpenTaskRequest): void {
  if (typeof window === "undefined" || !detail.threadId.trim()) return;
  openAgentPanelForChat();
  const parentThreadId = detail.parentThreadId?.trim();
  dispatchBufferedOpenRequest(
    bufferOpenRequest("agent-task-open", {
      ...detail,
      threadId: detail.threadId.trim(),
      ...(parentThreadId ? { parentThreadId } : {}),
    }),
  );
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

function dispatchAgentChatRunning(isRunning: boolean, tabId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("agentNative.chatRunning", {
      detail: { isRunning, ...(tabId ? { tabId } : {}) },
    }),
  );
}

function normalizeAgentChatRequestMode(
  value: unknown,
): AgentChatRequestMode | undefined {
  return value === "act" || value === "plan" ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export interface ParsedSubmitChat {
  message: string;
  context?: string;
  actionScope?: AgentActionScope;
  submit: boolean;
  openSidebar?: boolean;
  model?: string;
  engine?: string;
  effort?: unknown;
  newTab?: boolean;
  reuseEmptyTab?: boolean;
  background?: boolean;
  tabId?: string;
  targetTabId?: string;
  images?: string[];
  attachments?: AgentChatAttachment[];
  requestMode?: AgentChatRequestMode;
  submitMessageId?: string;
  usageLabel?: string;
  approvedToolCalls?: string[];
}

const MAX_SUBMIT_APPROVED_TOOL_CALLS = 200;

function parseSubmitChatApprovedToolCalls(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const keys = value
    .filter(
      (key): key is string => typeof key === "string" && key.trim().length > 0,
    )
    .slice(0, MAX_SUBMIT_APPROVED_TOOL_CALLS);
  return keys.length > 0 ? keys : undefined;
}

function parseSubmitChatAttachments(
  value: unknown,
): AgentChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const attachments = value
    .filter((item): item is Record<string, unknown> => {
      return Boolean(item) && typeof item === "object";
    })
    .map((item) => {
      const type = typeof item.type === "string" ? item.type : "file";
      const name = typeof item.name === "string" ? item.name : "attachment";
      const attachment: AgentChatAttachment = { type, name };
      for (const key of [
        "data",
        "url",
        "uploadProvider",
        "securityNote",
        "contentType",
        "text",
      ] as const) {
        if (typeof item[key] === "string") attachment[key] = item[key];
      }
      for (const key of [
        "displayOnly",
        "referenceOnly",
        "storageRequired",
        "storageUploadFailed",
      ] as const) {
        if (typeof item[key] === "boolean") attachment[key] = item[key];
      }
      return attachment;
    });
  return attachments.length > 0 ? attachments : undefined;
}

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
  const imageSources = [
    ...(Array.isArray(raw.images) ? raw.images : []),
    ...(Array.isArray(raw.referenceImagePaths) ? raw.referenceImagePaths : []),
    ...(Array.isArray(raw.uploadedReferenceImages)
      ? raw.uploadedReferenceImages
      : []),
  ].filter(
    (image): image is string =>
      typeof image === "string" && image.trim().length > 0,
  );
  const images =
    imageSources.length > 0 ? [...new Set(imageSources)] : undefined;
  const hasActionScope = Object.prototype.hasOwnProperty.call(
    raw,
    "actionScope",
  );
  const actionScope = hasActionScope
    ? tryNormalizeAgentActionScope(raw.actionScope)
    : undefined;
  if (hasActionScope && !actionScope) return null;
  return {
    message,
    context: typeof raw.context === "string" ? raw.context : undefined,
    ...(actionScope ? { actionScope } : {}),
    submit: raw.submit !== false,
    openSidebar:
      typeof raw.openSidebar === "boolean" ? raw.openSidebar : undefined,
    model: nonEmptyString(raw.model),
    engine: nonEmptyString(raw.engine),
    effort: raw.effort,
    newTab: typeof raw.newTab === "boolean" ? raw.newTab : undefined,
    reuseEmptyTab:
      typeof raw.reuseEmptyTab === "boolean" ? raw.reuseEmptyTab : undefined,
    background:
      typeof raw.background === "boolean" ? raw.background : undefined,
    tabId: typeof raw.tabId === "string" ? raw.tabId : undefined,
    targetTabId: nonEmptyString(raw.targetTabId),
    images,
    attachments: parseSubmitChatAttachments(raw.attachments),
    requestMode: normalizeAgentChatRequestMode(raw.requestMode ?? raw.mode),
    submitMessageId:
      typeof raw.submitMessageId === "string" ? raw.submitMessageId : undefined,
    usageLabel: nonEmptyString(raw.usageLabel),
    approvedToolCalls: parseSubmitChatApprovedToolCalls(raw.approvedToolCalls),
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

function keepsApprovalInAppChat(
  opts: Pick<AgentChatMessage, "approvedToolCalls">,
): boolean {
  if (!opts.approvedToolCalls?.length) return false;
  return (
    isInBuilderFrame() ||
    isMcpAppChatBridgeEnabled() ||
    isDirectMcpAppEmbedSession()
  );
}

export function routesToCodeFrame(
  opts: Pick<AgentChatMessage, "type" | "requiresCode" | "approvedToolCalls">,
): boolean {
  if (opts.type !== "code" && opts.requiresCode !== true) return false;
  return !keepsApprovalInAppChat(opts);
}

export function sendToAgentChat(opts: AgentChatMessage): string {
  const tabId = opts.tabId ?? generateTabId();
  const actionScope =
    opts.actionScope === undefined
      ? undefined
      : normalizeAgentActionScope(opts.actionScope);
  const mcpBridgeEnabled = isMcpAppChatBridgeEnabled();
  const hasMcpAppLocalPayload =
    mcpBridgeEnabled &&
    Boolean(
      opts.attachments?.length ||
      opts.images?.length ||
      opts.referenceImagePaths?.length ||
      opts.uploadedReferenceImages?.length ||
      opts.usageLabel ||
      actionScope,
    );
  const isCodeRequest = routesToCodeFrame(opts) && !hasMcpAppLocalPayload;
  const localChatTarget =
    opts.chatTarget === "local" ||
    keepsApprovalInAppChat(opts) ||
    hasMcpAppLocalPayload;
  const requestMode =
    normalizeAgentChatRequestMode(opts.requestMode ?? opts.mode) ??
    readStoredAgentChatRequestMode();
  if (opts.submit !== false && opts.message.trim()) {
    trackEvent("app.first_action", {
      action: "chat_submit",
      surface: opts.preset ?? "chat",
      request_mode: requestMode ?? "default",
      chat_target: opts.chatTarget ?? "auto",
      background: opts.background === true,
    });
  }
  if (isCodeRequest && isInBuilderFrame()) {
    sendToBuilderChat({
      message: opts.message,
      context: opts.context,
      submit: opts.submit,
      ...(requestMode ? { mode: requestMode, requestMode } : {}),
    });
    return tabId;
  }

  const submitMessageId =
    opts.submitMessageId ?? generateAgentChatSubmitMessageId();
  const payload = {
    type: AGENT_CHAT_MESSAGE_TYPE,
    data: {
      ...opts,
      ...(actionScope ? { actionScope } : {}),
      tabId,
      submitMessageId,
      ...(requestMode ? { mode: requestMode, requestMode } : {}),
    },
  };

  if (opts.submit !== false && !localChatTarget && mcpBridgeEnabled) {
    if (opts.targetTabId) {
      window.parent.postMessage(
        payload,
        getFramePostMessageTargetOrigin() || "*",
      );
      return tabId;
    }
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
          dispatchAgentChatRunning(false, tabId);
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
    !isCodeRequest &&
    (localChatTarget || isInBuilderFrame() || isDirectMcpAppEmbedSession());
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

  if (!isCodeRequest && target === window) {
    bufferSelfSubmit(payload.data);
    setTimeout(postToTarget, 0);
  } else {
    postToTarget();
  }
  return tabId;
}

const DEFAULT_SUBMIT_CONFIRM_TIMEOUT_MS = SELF_SUBMIT_BUFFER_TTL_MS + 2000;

export interface SendToAgentChatAndConfirmResult {
  tabId: string;
  delivered: boolean;
  reason?: string;
}

export function sendToAgentChatAndConfirm(
  opts: Omit<AgentChatMessage, "submitMessageId">,
  options?: { submitMessageId?: string; timeoutMs?: number },
): Promise<SendToAgentChatAndConfirmResult> {
  const tabId = opts.tabId ?? generateTabId();
  if (typeof window === "undefined") {
    return Promise.resolve({ tabId, delivered: false, reason: "no-window" });
  }
  if (
    opts.chatTarget !== "local" ||
    routesToCodeFrame(opts) ||
    opts.submit === false
  ) {
    return Promise.resolve({
      tabId,
      delivered: false,
      reason: "unsupported-target",
    });
  }

  const submitMessageId =
    options?.submitMessageId ?? generateAgentChatSubmitMessageId();
  const timeoutMs = Math.max(
    0,
    options?.timeoutMs ?? DEFAULT_SUBMIT_CONFIRM_TIMEOUT_MS,
  );

  return new Promise<SendToAgentChatAndConfirmResult>((resolve) => {
    let settled = false;
    let timer: number | undefined;
    const cleanup = () => {
      window.removeEventListener(
        AGENT_CHAT_SUBMIT_RESULT_EVENT,
        onResult as EventListener,
      );
      if (timer !== undefined) window.clearTimeout(timer);
    };
    const finish = (delivered: boolean, reason?: string, cancel = false) => {
      if (settled) return;
      settled = true;
      if (cancel) cancelAgentChatSubmit(submitMessageId);
      cleanup();
      resolve({ tabId, delivered, reason });
    };
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<AgentChatSubmitResult>).detail;
      if (!detail || detail.submitMessageId !== submitMessageId) return;
      finish(detail.delivered, detail.reason);
    };

    window.addEventListener(
      AGENT_CHAT_SUBMIT_RESULT_EVENT,
      onResult as EventListener,
    );
    timer = window.setTimeout(() => finish(false, "timeout", true), timeoutMs);
    try {
      sendToAgentChat({ ...opts, tabId, submitMessageId });
    } catch {
      finish(false, "send-failed", true);
    }
  });
}

export function setAgentChatContextItem(
  opts: AgentChatContextSetOptions,
): void {
  const item = normalizeAgentChatContextItem(opts);
  if (!item || typeof window === "undefined") return;

  publishAgentChatContextItems(
    withReplacedAgentChatContextItem(agentChatContextState.items, item),
  );
  const messageData = opts.focus === false ? { ...item, focus: false } : item;
  postAgentChatContextMessage(
    AGENT_CHAT_SET_CONTEXT_MESSAGE_TYPE,
    messageData,
    {
      openSidebar: opts.openSidebar !== false,
    },
  );
}

/** @deprecated Use `setAgentChatContextItem` instead. */
export const setContextToAgentChat = setAgentChatContextItem;

/** @deprecated Use `setAgentChatContextItem` instead. */
export const addContextToAgentChat = setAgentChatContextItem;

export function insertAgentComposerReference(
  ref: AgentComposerReference,
  options: AgentComposerReferenceInsertOptions = {},
): void {
  const normalized = normalizeAgentComposerReference(ref);
  if (!normalized || typeof window === "undefined") return;
  postAgentChatReferenceMessage(
    {
      ...normalized,
      insertMessageId: `reference-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
    },
    { openSidebar: options.openSidebar === true },
  );
}

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
