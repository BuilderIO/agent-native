import { getFrameOrigin } from "./frame.js";

function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function ancestorOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origins = (
    window.location as Location & { ancestorOrigins?: DOMStringList }
  ).ancestorOrigins;
  const first = origins?.[0];
  const fromAncestor = normalizeOrigin(first);
  if (fromAncestor) return fromAncestor;
  return normalizeOrigin(document.referrer);
}

function isBuilderLikeOrigin(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my") ||
      hostname === "localhost" ||
      hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}

function hasBuilderPreviewParams(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return (
    params.has("builder.space") ||
    params.has("builder.preview") ||
    params.has("builder.user.permissions") ||
    params.has("builder.user.role.name")
  );
}

export function getBuilderParentOrigin(): string | null {
  const frameOrigin = getFrameOrigin();
  if (isBuilderLikeOrigin(frameOrigin) && hasBuilderPreviewParams()) {
    return frameOrigin;
  }
  const origin = ancestorOrigin();
  return isBuilderLikeOrigin(origin) && hasBuilderPreviewParams()
    ? origin
    : null;
}

export function isInBuilderFrame(): boolean {
  if (typeof window === "undefined" || window.parent === window) return false;
  return getBuilderParentOrigin() !== null;
}

export function isTrustedBuilderMessage(event: MessageEvent): boolean {
  if (typeof window === "undefined") return false;
  const origin = getBuilderParentOrigin();
  if (!origin) return false;
  return event.origin === origin && event.source === window.parent;
}

export interface BuilderChatMessage {
  message: string;
  context?: string;
  submit?: boolean;
}

export function sendToBuilderChat(opts: BuilderChatMessage): boolean {
  if (typeof window === "undefined" || !opts.message?.trim()) return false;
  const target = window.parent !== window ? window.parent : window;
  const targetOrigin = getBuilderParentOrigin() ?? "*";
  const payload = {
    type: "builder.submitChat",
    data: {
      message: opts.message,
      context: opts.context,
      submit: opts.submit,
    },
  };
  target.postMessage(payload, targetOrigin);

  // Builder's Electron/webview relay watches console output because webviews
  // cannot always post directly to the app frame. Keep the payload small and
  // never include credential values in callers' context.
  try {
    console.log(
      "BUILDER_PARENT_MESSAGE:" +
        JSON.stringify({ message: payload, targetOrigin }),
    );
  } catch {}

  return true;
}

// Detect "build/create/make/scaffold a new app/agent" style prompts.
// Within agent-native, "agent" and "app" are synonyms — every agent-native
// app is an agent, so users phrase build requests either way.
const BUILD_APP_OR_AGENT_RE =
  /\b(?:build|create|make|scaffold|generate)\b[^.!?\n]*?\b(?:agent[-\s]native\s+)?(?:workspace\s+)?(?:app|agent)\b/i;

// Targets that explicitly are NOT a workspace app — keep these on the local
// agent so dispatch / app agents handle them with their own actions.
const NON_APP_TARGET_RE =
  /\b(?:build|create|make|scaffold|generate)\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+|a\s+new\s+|new\s+)?(?:tool|automation|recurring\s+job|job|destination|secret|skill|reminder|widget|email)\b/i;

/**
 * Returns true if `text` looks like a "build me an app/agent" request that
 * should hand off to the code-writing agent (Builder, local code agent, etc.)
 * rather than be answered by the embedded app's domain agent.
 *
 * Conservative: requires both an imperative build verb AND an explicit
 * "app" / "agent" target word in the same sentence. "Build me a tool",
 * "build a recurring job", "create a destination" do not match — those
 * stay on the local agent which has actions for them.
 */
export function isBuildAppOrAgentRequest(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (NON_APP_TARGET_RE.test(t)) return false;
  return BUILD_APP_OR_AGENT_RE.test(t);
}

/**
 * If the user typed a "build me an app/agent" prompt while running inside
 * the Builder.io webview/iframe, hand the prompt up to the parent Builder
 * chat via `builder.submitChat`. Returns true when delegated.
 *
 * Why: Builder is the code-writing agent. When a workspace app (Dispatch,
 * Mail, etc.) is mounted inside Builder's webview and the user asks the
 * embedded chat to "build an app", the user almost certainly means the
 * already-open Builder chat session — not a separate Builder agent run
 * spawned through `start-workspace-app-creation`.
 */
export function tryDelegateBuildRequestToBuilder(
  text: string | undefined,
): boolean {
  if (!isInBuilderFrame()) return false;
  if (!isBuildAppOrAgentRequest(text)) return false;
  return sendToBuilderChat({ message: (text ?? "").trim(), submit: true });
}
