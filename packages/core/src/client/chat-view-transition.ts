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
  /** Document to use. Defaults to the current browser document. */
  document?: Document | null;
  /** Disable the transition while still running the update callback. */
  disabled?: boolean;
  /** Respect `prefers-reduced-motion: reduce`. Defaults to true. */
  respectReducedMotion?: boolean;
}

export interface AgentChatHomeHandoffOptions {
  /** How long the handoff marker remains valid. Defaults to 6 hours. */
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

/**
 * Mark that a full-page chat is navigating into an app route that should show
 * the same chat in AgentSidebar. Pair with `consumeAgentChatHomeHandoff()` in
 * the destination layout.
 */
export function markAgentChatHomeHandoff(storageKey?: string | null): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      agentChatHomeHandoffKey(storageKey),
      String(Date.now()),
    );
  } catch {}
}

/**
 * Consume a recent full-page-chat handoff marker. Returns true only once per
 * marker, so layouts can keep `openOnChatRunning` scoped to the route that
 * actually received the handoff.
 */
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

  const ttlMs = options.ttlMs ?? AGENT_CHAT_HOME_HANDOFF_TTL_MS;
  const active = Number.isFinite(startedAt) && Date.now() - startedAt <= ttlMs;
  return active;
}

/**
 * Navigate with the agent-chat morph. Fires the warm-handoff prepare signal so
 * the destination chat renders a warm thread instead of a skeleton, then lets
 * React Router own the View Transition (`viewTransition: true`) so the snapshot
 * is taken *after* the new route commits. A manual
 * `document.startViewTransition(() => navigate(...))` snapshots the old DOM —
 * `navigate()` commits asynchronously and `flushSync` cannot commit a lazy
 * route + async loader in time — so the morph would run between two identical
 * frames. Respects `prefers-reduced-motion`.
 */
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
