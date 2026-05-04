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

function isStrictBuilderHost(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return (
      hostname === "builder.io" ||
      hostname.endsWith(".builder.io") ||
      hostname === "builder.my" ||
      hostname.endsWith(".builder.my")
    );
  } catch {
    return false;
  }
}

function isBuilderLikeOrigin(origin: string | null): boolean {
  if (!origin) return false;
  if (isStrictBuilderHost(origin)) return true;
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1";
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

/**
 * For *.builder.io / *.builder.my the parent origin alone is sufficient — those
 * are Builder-owned hosts and any iframe they load is by definition a Builder
 * editor session. For localhost we still require the legacy `?builder.*` query
 * params, because "parent is localhost" can mean anything in dev. The params
 * check existed historically as a belt-and-suspenders signal, but Builder's
 * Interact mode tunnels straight to the iframe URL without appending them, so
 * requiring them everywhere caused `isInBuilderFrame()` to return false for
 * real Builder editor sessions and `HomeChatPanel` submissions silently fell
 * through to `agentNative.submitChat` (which Builder ignores).
 */
export function getBuilderParentOrigin(): string | null {
  const frameOrigin = getFrameOrigin();
  if (frameOrigin) {
    if (isStrictBuilderHost(frameOrigin)) return frameOrigin;
    if (isBuilderLikeOrigin(frameOrigin) && hasBuilderPreviewParams()) {
      return frameOrigin;
    }
  }
  const origin = ancestorOrigin();
  if (origin) {
    if (isStrictBuilderHost(origin)) return origin;
    if (isBuilderLikeOrigin(origin) && hasBuilderPreviewParams()) {
      return origin;
    }
  }
  return null;
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

/**
 * Returns true if `text` looks like a "build me an app/agent" request that
 * should hand off to the code-writing agent (Builder, local code agent, etc.)
 * rather than be answered by the embedded app's domain agent.
 *
 * Conservative: requires both an imperative build verb AND an explicit
 * "app" / "agent" target word in the same sentence. "Build me a tool",
 * "build a recurring job", "create a destination" do not match — they
 * don't end in "app"/"agent" so they stay on the local agent. "Build me
 * an email app" / "create me an email agent" do match — the target
 * word is "app" / "agent", not "email".
 */
export function isBuildAppOrAgentRequest(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
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
