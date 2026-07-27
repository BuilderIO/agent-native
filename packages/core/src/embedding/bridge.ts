import {
  MCP_APP_CHAT_BRIDGE_QUERY_PARAM,
  EMBED_MODE_QUERY_PARAM,
} from "../shared/embed-auth.js";
import {
  AGENT_NATIVE_EMBED_MESSAGE_TYPES,
  createAgentNativeEmbedEnvelope,
  createEmbeddedAppRequestId,
  embeddedAppOrigin,
  isAgentNativeEmbedEnvelope,
  isAllowedEmbeddedAppOrigin,
  messageErrorPayload,
  type AgentNativeEmbedEnvelope,
} from "./protocol.js";

export interface EmbeddedAppMessageEvent<TPayload = unknown> {
  name: string;
  payload: TPayload;
  event: MessageEvent;
}

export type EmbeddedAppMessageHandler = (
  message: EmbeddedAppMessageEvent,
) => void;

export type EmbeddedAppRequestHandler = (
  message: EmbeddedAppMessageEvent,
) => unknown | Promise<unknown>;

export interface EmbeddedAppBridgeOptions {
  /**
   * Exact parent origin to post back to. Defaults to document.referrer's
   * origin when available. If no origin can be resolved, sends fail closed.
   */
  parentOrigin?: string;
  /**
   * Origins allowed to send messages to the embedded app. Defaults to the
   * resolved parent origin.
   */
  allowedOrigins?: string[];
  onMessage?: EmbeddedAppMessageHandler;
  onRequest?: EmbeddedAppRequestHandler;
  targetWindow?: Window | null;
  currentWindow?: Window;
}

export interface EmbeddedAppBridge {
  parentOrigin: string | null;
  postMessage<TPayload = unknown>(name: string, payload?: TPayload): boolean;
  request<TResult = unknown, TPayload = unknown>(
    name: string,
    payload?: TPayload,
    options?: { timeoutMs?: number },
  ): Promise<TResult>;
  ready<TPayload = unknown>(payload?: TPayload): boolean;
  close<TPayload = unknown>(payload?: TPayload): boolean;
  destroy(): void;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

function resolveParentOrigin(win: Window, explicit?: string): string | null {
  if (explicit) return explicit;
  if (shouldUseOpaqueParentTarget(win)) return "*";
  const referrerOrigin = embeddedAppOrigin(win.document?.referrer ?? "");
  return referrerOrigin;
}

function shouldUseOpaqueParentTarget(win: Window): boolean {
  try {
    const url = new URL(win.location.href);
    const chatBridge = url.searchParams.get(MCP_APP_CHAT_BRIDGE_QUERY_PARAM);
    const embedMode = url.searchParams.get(EMBED_MODE_QUERY_PARAM);
    return (
      chatBridge === "1" ||
      chatBridge === "true" ||
      embedMode === "1" ||
      embedMode === "true"
    );
  } catch {
    return false;
  }
}

function defaultAllowedOrigins(
  parentOrigin: string | null,
  referrerOrigin: string | null,
): string[] {
  if (!parentOrigin) return [];
  if (parentOrigin === "*") {
    return ["null", ...(referrerOrigin ? [referrerOrigin] : [])];
  }
  return [parentOrigin];
}

function postToParent(
  win: Window,
  parent: Window | null,
  parentOrigin: string | null,
  envelope: AgentNativeEmbedEnvelope,
): boolean {
  const target = parent ?? (win.parent === win ? null : win.parent);
  if (!parentOrigin) return false;
  if (!target) return false;
  target.postMessage(envelope, parentOrigin);
  return true;
}

export function createEmbeddedAppBridge(
  options: EmbeddedAppBridgeOptions = {},
): EmbeddedAppBridge {
  const win = options.currentWindow ?? window;
  const parentOrigin = resolveParentOrigin(win, options.parentOrigin);
  const referrerOrigin = embeddedAppOrigin(win.document?.referrer ?? "");
  const allowedOrigins =
    options.allowedOrigins ??
    defaultAllowedOrigins(parentOrigin, referrerOrigin);
  const pending = new Map<string, PendingRequest>();
  let destroyed = false;

  const postEnvelope = (envelope: AgentNativeEmbedEnvelope) =>
    postToParent(win, options.targetWindow ?? null, parentOrigin, envelope);

  const listener = (event: MessageEvent) => {
    if (destroyed) return;
    if (!isAllowedEmbeddedAppOrigin(event.origin, allowedOrigins)) return;
    if (!isAgentNativeEmbedEnvelope(event.data)) return;

    const envelope = event.data;
    if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.RESPONSE) {
      const requestId = envelope.requestId;
      if (!requestId) return;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.resolve(envelope.payload);
      return;
    }

    if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.ERROR) {
      const requestId = envelope.requestId;
      if (!requestId) return;
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new Error(envelope.error?.message ?? "Embedded app error"));
      return;
    }

    if (!envelope.name) return;
    const message = {
      name: envelope.name,
      payload: envelope.payload,
      event,
    } satisfies EmbeddedAppMessageEvent;

    if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.REQUEST) {
      Promise.resolve(options.onRequest?.(message))
        .then((payload) => {
          postEnvelope(
            createAgentNativeEmbedEnvelope(
              AGENT_NATIVE_EMBED_MESSAGE_TYPES.RESPONSE,
              { requestId: envelope.requestId, payload },
            ),
          );
        })
        .catch((error) => {
          postEnvelope(
            createAgentNativeEmbedEnvelope(
              AGENT_NATIVE_EMBED_MESSAGE_TYPES.ERROR,
              {
                requestId: envelope.requestId,
                error: messageErrorPayload(error),
              },
            ),
          );
        });
      return;
    }

    if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE) {
      options.onMessage?.(message);
    }
  };

  win.addEventListener("message", listener);

  return {
    parentOrigin,
    postMessage(name, payload) {
      return postEnvelope(
        createAgentNativeEmbedEnvelope(
          AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE,
          { name, payload },
        ),
      );
    },
    request<TResult = unknown, TPayload = unknown>(
      name: string,
      payload?: TPayload,
      requestOptions?: { timeoutMs?: number },
    ) {
      const requestId = createEmbeddedAppRequestId();
      return new Promise<TResult>((resolve, reject) => {
        const timeoutMs = requestOptions?.timeoutMs ?? 30_000;
        const timer =
          timeoutMs > 0
            ? setTimeout(() => {
                pending.delete(requestId);
                reject(new Error(`Embedded app request timed out: ${name}`));
              }, timeoutMs)
            : undefined;
        pending.set(requestId, {
          resolve: (value) => resolve(value as TResult),
          reject,
          timer,
        });
        const posted = postEnvelope(
          createAgentNativeEmbedEnvelope(
            AGENT_NATIVE_EMBED_MESSAGE_TYPES.REQUEST,
            { name, payload, requestId },
          ),
        );
        if (!posted) {
          pending.delete(requestId);
          if (timer) clearTimeout(timer);
          reject(new Error("Embedded app parent window is not available"));
        }
      });
    },
    ready(payload) {
      return postEnvelope(
        createAgentNativeEmbedEnvelope(AGENT_NATIVE_EMBED_MESSAGE_TYPES.READY, {
          payload,
        }),
      );
    },
    close(payload) {
      return this.postMessage("close", payload);
    },
    destroy() {
      destroyed = true;
      win.removeEventListener("message", listener);
      for (const entry of pending.values()) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.reject(new Error("Embedded app bridge destroyed"));
      }
      pending.clear();
    },
  };
}

export function sendEmbeddedAppMessage<TPayload = unknown>(
  name: string,
  payload?: TPayload,
  options: Pick<
    EmbeddedAppBridgeOptions,
    "currentWindow" | "parentOrigin" | "targetWindow"
  > = {},
): boolean {
  const win = options.currentWindow ?? window;
  const parentOrigin = resolveParentOrigin(win, options.parentOrigin);
  return postToParent(
    win,
    options.targetWindow ?? null,
    parentOrigin,
    createAgentNativeEmbedEnvelope(AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE, {
      name,
      payload,
    }),
  );
}

export function announceEmbeddedAppReady<TPayload = unknown>(
  payload?: TPayload,
  options: Pick<
    EmbeddedAppBridgeOptions,
    "currentWindow" | "parentOrigin" | "targetWindow"
  > = {},
): boolean {
  const win = options.currentWindow ?? window;
  const parentOrigin = resolveParentOrigin(win, options.parentOrigin);
  return postToParent(
    win,
    options.targetWindow ?? null,
    parentOrigin,
    createAgentNativeEmbedEnvelope(AGENT_NATIVE_EMBED_MESSAGE_TYPES.READY, {
      payload,
    }),
  );
}
