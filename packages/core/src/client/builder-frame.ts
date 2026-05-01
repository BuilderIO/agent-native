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
