export const AGENT_NATIVE_EMBED_PROTOCOL = "agent-native.embed" as const;
export const AGENT_NATIVE_EMBED_VERSION = 1 as const;

export const AGENT_NATIVE_EMBED_MESSAGE_TYPES = {
  READY: "ready",
  MESSAGE: "message",
  REQUEST: "request",
  RESPONSE: "response",
  ERROR: "error",
} as const;

export type AgentNativeEmbedMessageType =
  (typeof AGENT_NATIVE_EMBED_MESSAGE_TYPES)[keyof typeof AGENT_NATIVE_EMBED_MESSAGE_TYPES];

export interface AgentNativeEmbedErrorPayload {
  message: string;
  code?: string;
}

export interface AgentNativeEmbedEnvelope<TPayload = unknown> {
  protocol: typeof AGENT_NATIVE_EMBED_PROTOCOL;
  version: typeof AGENT_NATIVE_EMBED_VERSION;
  type: AgentNativeEmbedMessageType;
  name?: string;
  payload?: TPayload;
  requestId?: string;
  error?: AgentNativeEmbedErrorPayload;
}

export interface EmbeddedAppUrlOptions {
  /**
   * Add the framework's embedded route marker. Defaults to true.
   */
  embedded?: boolean;
  /**
   * Extra query params to include in the iframe URL.
   */
  params?: Record<string, string | number | boolean | null | undefined>;
}

export function isAgentNativeEmbedEnvelope(
  value: unknown,
): value is AgentNativeEmbedEnvelope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<AgentNativeEmbedEnvelope>;
  if (
    candidate.protocol !== AGENT_NATIVE_EMBED_PROTOCOL ||
    candidate.version !== AGENT_NATIVE_EMBED_VERSION ||
    typeof candidate.type !== "string" ||
    !Object.values(AGENT_NATIVE_EMBED_MESSAGE_TYPES).includes(
      candidate.type as AgentNativeEmbedMessageType,
    )
  ) {
    return false;
  }
  if (candidate.name !== undefined && typeof candidate.name !== "string") {
    return false;
  }
  if (
    candidate.requestId !== undefined &&
    typeof candidate.requestId !== "string"
  ) {
    return false;
  }
  if (candidate.error !== undefined) {
    if (
      !candidate.error ||
      typeof candidate.error !== "object" ||
      Array.isArray(candidate.error)
    ) {
      return false;
    }
    const error = candidate.error as Partial<AgentNativeEmbedErrorPayload>;
    if (typeof error.message !== "string") return false;
    if (error.code !== undefined && typeof error.code !== "string") {
      return false;
    }
  }
  return true;
}

export function createAgentNativeEmbedEnvelope<TPayload>(
  type: AgentNativeEmbedMessageType,
  options: {
    name?: string;
    payload?: TPayload;
    requestId?: string;
    error?: AgentNativeEmbedErrorPayload;
  } = {},
): AgentNativeEmbedEnvelope<TPayload> {
  return {
    protocol: AGENT_NATIVE_EMBED_PROTOCOL,
    version: AGENT_NATIVE_EMBED_VERSION,
    type,
    ...options,
  };
}

export function embeddedAppOrigin(url: string, base?: string): string | null {
  try {
    const resolvedBase =
      base ??
      (typeof window !== "undefined"
        ? window.location.href
        : "http://agent-native.local");
    return new URL(url, resolvedBase).origin;
  } catch {
    return null;
  }
}

export function isAllowedEmbeddedAppOrigin(
  origin: string,
  allowedOrigins: readonly string[] | undefined,
): boolean {
  if (!allowedOrigins?.length) return false;
  return allowedOrigins.some(
    (allowed) => allowed === "*" || allowed === origin,
  );
}

export function withEmbeddedAppParams(
  url: string,
  options: EmbeddedAppUrlOptions = {},
): string {
  const shouldMarkEmbedded = options.embedded ?? true;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(url);
  const isProtocolRelative = url.startsWith("//");
  const isAbsolutePath = url.startsWith("/");
  const isRelative = !hasScheme && !isProtocolRelative;

  try {
    const base =
      typeof window !== "undefined"
        ? window.location.href
        : "http://agent-native.local";
    const parsed = new URL(url, base);

    if (shouldMarkEmbedded && !parsed.searchParams.has("embedded")) {
      parsed.searchParams.set("embedded", "1");
    }

    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value === undefined || value === null) continue;
      parsed.searchParams.set(key, String(value));
    }

    if (isRelative) {
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return isAbsolutePath ? path : path.replace(/^\//, "");
    }
    return parsed.toString();
  } catch {
    const [beforeHash, hash = ""] = url.split("#", 2);
    const separator = beforeHash.includes("?") ? "&" : "?";
    const params = new URLSearchParams();
    if (shouldMarkEmbedded) params.set("embedded", "1");
    for (const [key, value] of Object.entries(options.params ?? {})) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
    const query = params.toString();
    if (!query) return url;
    return `${beforeHash}${separator}${query}${hash ? `#${hash}` : ""}`;
  }
}

export function createEmbeddedAppRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `embed-${crypto.randomUUID()}`;
  }
  return `embed-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function messageErrorPayload(
  error: unknown,
): AgentNativeEmbedErrorPayload {
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}
