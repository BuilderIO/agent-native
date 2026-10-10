import type { FilePart } from "@agent-native/agentkit";
import type {
  PromptComposerSubmitOptions,
  Reference,
} from "@agent-native/toolkit/composer";

export const HOME_PATH = "/home";
export const NEW_CHAT_PATH = "/chat";

const FAILED_CHAT_HANDOFF_PREFIX = "agent-native.chat.failed-handoff:";
const MAX_FAILED_HANDOFF_BYTES = 64 * 1024;
const MAX_HANDOFF_TEXT_LENGTH = 24 * 1024;
const MAX_HANDOFF_FIELD_LENGTH = 8 * 1024;
const MAX_HANDOFF_ITEMS = 20;
const INVALID_JSON_VALUE = Symbol("invalid-json-value");

export function chatThreadPath(threadId: string | null | undefined): string {
  return threadId
    ? `${NEW_CHAT_PATH}/${encodeURIComponent(threadId)}`
    : NEW_CHAT_PATH;
}

export function isChatPathname(pathname: string): boolean {
  return pathname === NEW_CHAT_PATH || pathname.startsWith(`${NEW_CHAT_PATH}/`);
}

export function threadIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)/);
  if (!match) return null;
  try {
    const value = decodeURIComponent(match[1]).trim();
    return value || null;
    // coercion-ok: a malformed percent-encoding is not a thread id, so the path has no thread.
  } catch {
    return null;
  }
}

export type ChatInitialComposerOptions = Omit<
  PromptComposerSubmitOptions,
  "onLocalSubmit" | "attachments"
> & {
  mode?: "act" | "plan";
  references?: readonly Reference[];
  uploadedAttachments?: readonly FilePart[];
};

/** Router state that carries a prompt typed elsewhere into the chat it opens. */
export interface ChatRouteState {
  initialMessage: string;
  initialComposerOptions?: ChatInitialComposerOptions;
}

export interface FailedChatHandoffEnvelope {
  text: string;
  options: ChatInitialComposerOptions;
}

export type FailedChatHandoffReadResult =
  | { status: "found"; handoff: FailedChatHandoffEnvelope }
  | { status: "absent" }
  | {
      status: "invalid";
      reason:
        | "invalid-thread-id"
        | "too-large"
        | "invalid-json"
        | "invalid-envelope";
      cause?: unknown;
    }
  | { status: "unavailable"; cause: unknown };

export type FailedChatHandoffWriteResult =
  | { status: "stored" }
  | {
      status: "invalid";
      reason:
        | "invalid-thread-id"
        | "message-too-large"
        | "invalid-options"
        | "payload-too-large";
    }
  | { status: "unavailable"; cause: unknown };

export type FailedChatHandoffClearResult =
  | { status: "cleared" }
  | { status: "absent" }
  | { status: "unavailable"; cause: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeJsonValue(
  value: unknown,
  depth = 0,
): unknown | typeof INVALID_JSON_VALUE {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.length <= MAX_HANDOFF_FIELD_LENGTH
      ? value
      : INVALID_JSON_VALUE;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : INVALID_JSON_VALUE;
  }
  if (depth >= 5) return INVALID_JSON_VALUE;
  if (Array.isArray(value)) {
    if (value.length > MAX_HANDOFF_ITEMS) return INVALID_JSON_VALUE;
    const normalized = value.map((item) => normalizeJsonValue(item, depth + 1));
    return normalized.some((item) => item === INVALID_JSON_VALUE)
      ? INVALID_JSON_VALUE
      : normalized;
  }
  if (!isRecord(value)) return INVALID_JSON_VALUE;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return INVALID_JSON_VALUE;
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_HANDOFF_ITEMS) return INVALID_JSON_VALUE;
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of entries) {
    if (key.length > 128) return INVALID_JSON_VALUE;
    const normalizedEntry = normalizeJsonValue(entry, depth + 1);
    if (normalizedEntry === INVALID_JSON_VALUE) return INVALID_JSON_VALUE;
    normalized[key] = normalizedEntry;
  }
  return normalized;
}

function copyOptionalString(
  source: Record<string, unknown>,
  key: string,
  target: Record<string, unknown>,
  maxLength = MAX_HANDOFF_FIELD_LENGTH,
): boolean {
  if (!(key in source)) return true;
  const value = source[key];
  if (typeof value !== "string" || value.length > maxLength) return false;
  target[key] = value;
  return true;
}

function normalizeReference(value: unknown): Reference | null {
  if (!isRecord(value)) return null;
  const types = ["file", "skill", "mention", "agent", "custom-agent"];
  if (!types.includes(String(value.type))) return null;
  const result: Record<string, unknown> = { type: value.type };
  for (const key of ["path", "name", "source"] as const) {
    if (typeof value[key] !== "string" || value[key].length > 4096) {
      return null;
    }
    result[key] = value[key];
  }
  for (const key of ["refType", "refId", "slotKey", "slotLabel"]) {
    if (!copyOptionalString(value, key, result, 4096)) return null;
  }
  if ("metadata" in value) {
    const metadata = normalizeJsonValue(value.metadata);
    if (!isRecord(metadata)) return null;
    result.metadata = metadata;
  }
  return result as unknown as Reference;
}

function normalizeFilePart(value: unknown): FilePart | null {
  if (!isRecord(value) || value.type !== "file") return null;
  if (typeof value.name !== "string" || value.name.length > 1024) return null;
  const result: Record<string, unknown> = { type: "file", name: value.name };
  if (!copyOptionalString(value, "mediaType", result, 512)) return null;
  if (!copyOptionalString(value, "fileId", result, 1024)) return null;
  if (!copyOptionalString(value, "url", result, 4096)) return null;
  if (typeof result.url === "string" && /^\s*data:/i.test(result.url)) {
    return null;
  }
  if ("omitted" in value) {
    if (value.omitted !== "inline-bytes" && value.omitted !== "unsafe-url") {
      return null;
    }
    result.omitted = value.omitted;
  }
  return result as unknown as FilePart;
}

function normalizeContextItems(
  value: unknown,
): NonNullable<ChatInitialComposerOptions["contextItems"]> | null {
  if (!Array.isArray(value) || value.length > MAX_HANDOFF_ITEMS) return null;
  const result: NonNullable<
    ChatInitialComposerOptions["contextItems"]
  >[number][] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const normalized: Record<string, unknown> = {};
    for (const key of ["key", "title", "context"] as const) {
      if (
        typeof item[key] !== "string" ||
        item[key].length > MAX_HANDOFF_FIELD_LENGTH
      ) {
        return null;
      }
      normalized[key] = item[key];
    }
    for (const key of ["contextNamespace", "targetThreadId"]) {
      if (!copyOptionalString(item, key, normalized, 4096)) return null;
    }
    result.push(
      normalized as NonNullable<
        ChatInitialComposerOptions["contextItems"]
      >[number],
    );
  }
  return result;
}

function normalizeComposerOptions(
  value: unknown,
): ChatInitialComposerOptions | null {
  if (!isRecord(value)) return null;
  const result: Record<string, unknown> = {
    mode: value.mode === "plan" ? "plan" : "act",
  };
  for (const key of ["engine", "model"] as const) {
    if (!copyOptionalString(value, key, result, 512)) return null;
  }
  if ("effort" in value) {
    if (
      ![
        "auto",
        "none",
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ].includes(String(value.effort))
    ) {
      return null;
    }
    result.effort = value.effort;
  }
  if ("intent" in value) {
    if (value.intent !== "immediate" && value.intent !== "queued") return null;
    result.intent = value.intent;
  }
  if ("steer" in value) {
    if (typeof value.steer !== "boolean") return null;
    result.steer = value.steer;
  }
  if ("composerModeContext" in value) {
    if (!copyOptionalString(value, "composerModeContext", result, 16 * 1024)) {
      return null;
    }
  }
  if ("references" in value) {
    if (
      !Array.isArray(value.references) ||
      value.references.length > MAX_HANDOFF_ITEMS
    ) {
      return null;
    }
    const references = value.references.map(normalizeReference);
    if (references.some((reference) => !reference)) return null;
    result.references = references;
  }
  if ("uploadedAttachments" in value) {
    if (
      !Array.isArray(value.uploadedAttachments) ||
      value.uploadedAttachments.length > MAX_HANDOFF_ITEMS
    ) {
      return null;
    }
    const attachments = value.uploadedAttachments.map(normalizeFilePart);
    if (attachments.some((attachment) => !attachment)) return null;
    result.uploadedAttachments = attachments;
  }
  if ("contextItems" in value) {
    const contextItems = normalizeContextItems(value.contextItems);
    if (!contextItems) return null;
    result.contextItems = contextItems;
  }
  return result as ChatInitialComposerOptions;
}

function failedChatHandoffKey(threadId: string): string {
  return `${FAILED_CHAT_HANDOFF_PREFIX}${encodeURIComponent(threadId)}`;
}

/** Persist a bounded, JSON-safe Home-to-Chat submit until retry is accepted. */
export function writeFailedChatHandoff(
  threadId: string,
  text: string,
  options: ChatInitialComposerOptions,
): FailedChatHandoffWriteResult {
  if (typeof window === "undefined") {
    return {
      status: "unavailable",
      cause: new Error("Chat handoff storage is only available in a browser"),
    };
  }
  if (!threadId.trim() || threadId.length > 512) {
    return { status: "invalid", reason: "invalid-thread-id" };
  }
  if (text.length > MAX_HANDOFF_TEXT_LENGTH) {
    return { status: "invalid", reason: "message-too-large" };
  }
  const normalizedOptions = normalizeComposerOptions(options);
  if (!normalizedOptions) {
    return { status: "invalid", reason: "invalid-options" };
  }
  const serialized = JSON.stringify({
    version: 1,
    threadId,
    text,
    options: normalizedOptions,
  });
  if (
    new TextEncoder().encode(serialized).byteLength > MAX_FAILED_HANDOFF_BYTES
  ) {
    return { status: "invalid", reason: "payload-too-large" };
  }
  try {
    window.sessionStorage.setItem(failedChatHandoffKey(threadId), serialized);
    return { status: "stored" };
  } catch (cause) {
    return { status: "unavailable", cause };
  }
}

export function readFailedChatHandoff(
  threadId: string,
): FailedChatHandoffReadResult {
  if (typeof window === "undefined") return { status: "absent" };
  if (!threadId.trim()) {
    return { status: "invalid", reason: "invalid-thread-id" };
  }
  try {
    const serialized = window.sessionStorage.getItem(
      failedChatHandoffKey(threadId),
    );
    if (serialized === null) return { status: "absent" };
    if (
      new TextEncoder().encode(serialized).byteLength > MAX_FAILED_HANDOFF_BYTES
    ) {
      return { status: "invalid", reason: "too-large" };
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(serialized);
    } catch (cause) {
      return { status: "invalid", reason: "invalid-json", cause };
    }
    if (!isRecord(envelope) || envelope.version !== 1) {
      return { status: "invalid", reason: "invalid-envelope" };
    }
    if (envelope.threadId !== threadId || typeof envelope.text !== "string") {
      return { status: "invalid", reason: "invalid-envelope" };
    }
    const options = normalizeComposerOptions(envelope.options);
    if (!options || envelope.text.length > MAX_HANDOFF_TEXT_LENGTH) {
      return { status: "invalid", reason: "invalid-envelope" };
    }
    return { status: "found", handoff: { text: envelope.text, options } };
  } catch (cause) {
    return { status: "unavailable", cause };
  }
}

export function clearFailedChatHandoff(
  threadId: string,
): FailedChatHandoffClearResult {
  if (typeof window === "undefined") {
    return {
      status: "unavailable",
      cause: new Error("Chat handoff storage is only available in a browser"),
    };
  }
  if (!threadId.trim()) return { status: "absent" };
  try {
    if (
      window.sessionStorage.getItem(failedChatHandoffKey(threadId)) === null
    ) {
      return { status: "absent" };
    }
    window.sessionStorage.removeItem(failedChatHandoffKey(threadId));
    return { status: "cleared" };
  } catch (cause) {
    return { status: "unavailable", cause };
  }
}

export function initialMessageFromState(state: unknown): string | null {
  if (!state || typeof state !== "object") return null;
  const message = (state as Partial<ChatRouteState>).initialMessage;
  return typeof message === "string" && message.trim() ? message : null;
}

export function initialComposerOptionsFromState(
  state: unknown,
): ChatRouteState["initialComposerOptions"] {
  if (!state || typeof state !== "object") return undefined;
  const options = (state as { initialComposerOptions?: unknown })
    .initialComposerOptions;
  return normalizeComposerOptions(options) ?? undefined;
}
