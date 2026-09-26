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
  if (typeof window === "undefined" || window.parent === window) return null;
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
    if (
      hostname === "agent-workspace.builder.io" ||
      hostname === "beta.agent-workspace.builder.io"
    ) {
      return false;
    }
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
    params.has("builder.frameEditing") ||
    params.has("builder.user.permissions") ||
    params.has("builder.user.role.name") ||
    params.has("__builder_editing__")
  );
}

let builderFrameDetected = false;
let builderParentOrigin: string | null = null;

function detectBuilderParentOrigin(): string | null {
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

export function getBuilderParentOrigin(): string | null {
  const detectedOrigin = detectBuilderParentOrigin();
  if (detectedOrigin) builderParentOrigin = detectedOrigin;
  return detectedOrigin ?? builderParentOrigin;
}

if (typeof window !== "undefined") {
  builderFrameDetected =
    getBuilderParentOrigin() !== null || hasBuilderPreviewParams();
}

export function isInBuilderFrame(): boolean {
  if (typeof window === "undefined") return false;
  if (builderFrameDetected) return true;

  builderFrameDetected =
    getBuilderParentOrigin() !== null || hasBuilderPreviewParams();
  return builderFrameDetected;
}

export function _resetBuilderFrameDetectionForTests(): void {
  builderFrameDetected = false;
  builderParentOrigin = null;
}

export function shouldParentFrameOwnAgentPanel(): boolean {
  if (typeof window === "undefined") return false;
  if (window.parent === window) return false;
  return !isInBuilderFrame();
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
  mode?: "act" | "plan";
  requestMode?: "act" | "plan";
  targetOrigin?: string;
}

export function sendToBuilderChat(opts: BuilderChatMessage): boolean {
  if (typeof window === "undefined" || !opts.message?.trim()) return false;
  const hasParentFrame = window.parent !== window;
  const targetOrigin = opts.targetOrigin ?? getBuilderParentOrigin() ?? "*";
  const payload = {
    type: "builder.submitChat",
    data: {
      message: opts.message,
      context: opts.context,
      submit: opts.submit,
      ...(opts.mode ? { mode: opts.mode } : {}),
      ...(opts.requestMode ? { requestMode: opts.requestMode } : {}),
    },
  };

  if (hasParentFrame) {
    window.parent.postMessage(payload, targetOrigin);
  } else {
    try {
      console.log(
        "BUILDER_PARENT_MESSAGE:" +
          JSON.stringify({ message: payload, targetOrigin }),
      );
    } catch {}
  }

  return true;
}

const BUILD_APP_OR_AGENT_RE =
  /\b(?:build|create|make|scaffold|generate)\b[^.!?\n]*?\b(?:agent[-\s]native\s+)?(?:workspace\s+)?(?:app|agent)\b/i;

export function isBuildAppOrAgentRequest(text: string | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return BUILD_APP_OR_AGENT_RE.test(t);
}

export function tryDelegateBuildRequestToBuilder(
  text: string | undefined,
): boolean {
  if (!isInBuilderFrame()) return false;
  if (!isBuildAppOrAgentRequest(text)) return false;
  return sendToBuilderChat({ message: (text ?? "").trim(), submit: true });
}
