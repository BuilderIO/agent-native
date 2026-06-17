export const AGENT_CHAT_VIEW_TRANSITION_NAME = "agent-native-chat";
export const AGENT_CHAT_VIEW_TRANSITION_CLASS =
  "agent-native-chat-view-transition";
export const AGENT_CHAT_VIEW_TRANSITION_PREPARE_EVENT =
  "agentNative.chatViewTransitionPrepare";

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
