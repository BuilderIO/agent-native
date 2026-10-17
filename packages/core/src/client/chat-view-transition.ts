import type { NavigateFunction, NavigateOptions } from "react-router";

export const AGENT_CHAT_VIEW_TRANSITION_NAME = "agent-native-chat";
export const AGENT_CHAT_VIEW_TRANSITION_CLASS =
  "agent-native-chat-view-transition";
export const AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT =
  "agentNative.chatViewTransitionPrepare";
export const AGENT_CHAT_HOME_HANDOFF_TTL_MS = 6 * 60 * 60 * 1000;

export interface AgentChatViewTransition {
  readonly ready: Promise<void>;
  readonly finished: Promise<void>;
  readonly updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

export interface AgentChatViewTransitionOptions {
  document?: Document | null;
  disabled?: boolean;
  respectReducedMotion?: boolean;
}

export interface AgentChatHomeHandoffOptions {
  ttlMs?: number;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (
    callback: () => void | Promise<void>,
  ) => AgentChatViewTransition;
};

function getClientDocument(): Document | null {
  if (typeof document === "undefined") return null;
  return document;
}

function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function agentChatHomeHandoffKey(storageKey?: string | null): string {
  const suffix = storageKey?.trim();
  return suffix
    ? `agent-native.${suffix}.chat-home-handoff`
    : "agent-native.chat-home-handoff";
}

export function supportsAgentChatViewTransition(
  doc: Document | null | undefined = getClientDocument(),
): boolean {
  return (
    typeof (doc as ViewTransitionDocument | null)?.startViewTransition ===
    "function"
  );
}

export function getAgentChatViewTransitionStyle<
  Style extends object | undefined,
>(
  style?: Style,
): (Style extends undefined ? object : Style) & {
  viewTransitionName: string;
} {
  return {
    ...(style ?? {}),
    viewTransitionName: AGENT_CHAT_VIEW_TRANSITION_NAME,
  } as (Style extends undefined ? object : Style) & {
    viewTransitionName: string;
  };
}

function observeTransitionPromise(promise: Promise<void>) {
  promise.catch(() => {});
}

function observeTransitionRejections(transition: AgentChatViewTransition) {
  observeTransitionPromise(transition.ready);
  observeTransitionPromise(transition.finished);
  observeTransitionPromise(transition.updateCallbackDone);
  return transition;
}

export function startAgentChatViewTransition(
  update: () => void | Promise<void>,
  options: AgentChatViewTransitionOptions = {},
): AgentChatViewTransition | null {
  const doc = options.document ?? getClientDocument();
  const startViewTransition = (doc as ViewTransitionDocument | null)
    ?.startViewTransition;

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT),
    );
  }

  if (
    options.disabled ||
    (options.respectReducedMotion !== false && prefersReducedMotion()) ||
    typeof startViewTransition !== "function"
  ) {
    void update();
    return null;
  }

  return observeTransitionRejections(startViewTransition.call(doc, update));
}

export function markAgentChatHomeHandoff(storageKey?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      agentChatHomeHandoffKey(storageKey),
      String(Date.now()),
    );
  } catch {}
}

export function isAgentChatHomeHandoffActive(
  storageKey?: string | null,
  options: AgentChatHomeHandoffOptions = {},
): boolean {
  if (typeof window === "undefined") return false;

  let startedAt = 0;
  try {
    const raw = window.sessionStorage.getItem(
      agentChatHomeHandoffKey(storageKey),
    );
    startedAt = raw ? Number.parseInt(raw, 10) : 0;
  } catch {
    startedAt = 0;
  }

  const ttlMs = options.ttlMs ?? AGENT_CHAT_HOME_HANDOFF_TTL_MS;
  return Number.isFinite(startedAt) && Date.now() - startedAt <= ttlMs;
}

export function consumeAgentChatHomeHandoff(
  storageKey?: string | null,
  options: AgentChatHomeHandoffOptions = {},
): boolean {
  if (typeof window === "undefined") return false;

  let startedAt = 0;
  const key = agentChatHomeHandoffKey(storageKey);
  try {
    const raw = window.sessionStorage.getItem(key);
    startedAt = raw ? Number.parseInt(raw, 10) : 0;
    window.sessionStorage.removeItem(key);
  } catch {
    startedAt = 0;
  }

  return isAgentChatHomeHandoffActiveFromTimestamp(startedAt, options);
}

function isAgentChatHomeHandoffActiveFromTimestamp(
  startedAt: number,
  options: AgentChatHomeHandoffOptions,
): boolean {
  const ttlMs = options.ttlMs ?? AGENT_CHAT_HOME_HANDOFF_TTL_MS;
  return Number.isFinite(startedAt) && Date.now() - startedAt <= ttlMs;
}

export function navigateWithAgentChatViewTransition(
  navigate: NavigateFunction,
  to: string,
  options?: NavigateOptions,
): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT),
    );
  }
  void navigate(to, { ...options, viewTransition: !prefersReducedMotion() });
}
