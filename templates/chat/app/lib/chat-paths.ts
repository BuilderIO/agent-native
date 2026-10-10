import type { FilePart } from "@agent-native/agentkit";
import type {
  PromptComposerSubmitOptions,
  Reference,
} from "@agent-native/toolkit/composer";

export const HOME_PATH = "/home";
export const NEW_CHAT_PATH = "/chat";

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
  if (!options || typeof options !== "object") return undefined;

  const value = options as Record<string, unknown>;
  const result: ChatInitialComposerOptions = {
    mode: value.mode === "plan" ? "plan" : "act",
  };
  if (typeof value.engine === "string") result.engine = value.engine;
  if (typeof value.model === "string") result.model = value.model;
  if (typeof value.effort === "string") {
    result.effort = value.effort as NonNullable<
      ChatInitialComposerOptions["effort"]
    >;
  }
  if (value.intent === "immediate" || value.intent === "queued") {
    result.intent = value.intent;
  }
  if (value.steer === true) result.steer = true;
  if (Array.isArray(value.uploadedAttachments)) {
    result.uploadedAttachments = value.uploadedAttachments as FilePart[];
  }
  if (Array.isArray(value.contextItems)) {
    result.contextItems = value.contextItems as NonNullable<
      ChatInitialComposerOptions["contextItems"]
    >;
  }
  if (typeof value.composerModeContext === "string") {
    result.composerModeContext = value.composerModeContext;
  }
  if (Array.isArray(value.references)) {
    result.references = value.references as Reference[];
  }

  return result;
}
