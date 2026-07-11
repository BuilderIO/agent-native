import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type IframeHTMLAttributes,
} from "react";

import {
  AGENT_NATIVE_EMBED_MESSAGE_TYPES,
  createAgentNativeEmbedEnvelope,
  createEmbeddedAppRequestId,
  embeddedAppOrigin,
  isAgentNativeEmbedEnvelope,
  isAllowedEmbeddedAppOrigin,
  messageErrorPayload,
  withEmbeddedAppParams,
  type AgentNativeEmbedEnvelope,
  type EmbeddedAppUrlOptions,
} from "./protocol.js";

export interface EmbeddedAppRef {
  iframe: HTMLIFrameElement | null;
  origin: string | null;
  postMessage<TPayload = unknown>(name: string, payload?: TPayload): boolean;
  request<TResult = unknown, TPayload = unknown>(
    name: string,
    payload?: TPayload,
    options?: { timeoutMs?: number },
  ): Promise<TResult>;
  focus(): void;
}

export interface EmbeddedAppMessageInfo<TPayload = unknown> {
  name: string;
  payload: TPayload;
  event: MessageEvent;
  ref: EmbeddedAppRef;
}

export interface EmbeddedAppProps extends Omit<
  IframeHTMLAttributes<HTMLIFrameElement>,
  "src" | "onLoad"
> {
  url: string;
  /**
   * Origin used when posting messages to the iframe. Defaults to url's origin.
   */
  targetOrigin?: string;
  /**
   * Origins allowed to send messages back. Defaults to targetOrigin.
   */
  allowedOrigins?: string[];
  /**
   * Adds `embedded=1` by default. Pass false to use the URL untouched.
   */
  embed?: boolean | EmbeddedAppUrlOptions;
  onLoad?: (ref: EmbeddedAppRef) => void;
  onReady?: (
    payload: unknown,
    event: MessageEvent,
    ref: EmbeddedAppRef,
  ) => void;
  onMessage?: <TPayload = unknown>(
    name: string,
    payload: TPayload,
    event: MessageEvent,
    ref: EmbeddedAppRef,
  ) => void;
  onRequest?: (
    name: string,
    payload: unknown,
    event: MessageEvent,
    ref: EmbeddedAppRef,
  ) => unknown | Promise<unknown>;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
};

const defaultStyle: CSSProperties = {
  border: 0,
  width: "100%",
  height: "100%",
};

function postEnvelope(
  iframe: HTMLIFrameElement | null,
  targetOrigin: string | null | undefined,
  envelope: AgentNativeEmbedEnvelope,
): boolean {
  const targetWindow = iframe?.contentWindow;
  if (!targetOrigin) return false;
  if (!targetWindow) return false;
  targetWindow.postMessage(envelope, targetOrigin);
  return true;
}

export function isEmbeddedAppMessageSource(
  event: Pick<MessageEvent, "source">,
  iframe: Pick<HTMLIFrameElement, "contentWindow"> | null,
) {
  return Boolean(
    iframe?.contentWindow && event.source === iframe.contentWindow,
  );
}

export const EmbeddedApp = forwardRef<EmbeddedAppRef, EmbeddedAppProps>(
  function EmbeddedApp(
    {
      url,
      targetOrigin,
      allowedOrigins,
      embed = true,
      onLoad,
      onReady,
      onMessage,
      onRequest,
      title = "Agent-Native embedded app",
      sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
      allow = "clipboard-read; clipboard-write; microphone; fullscreen",
      referrerPolicy = "strict-origin-when-cross-origin",
      style,
      ...iframeProps
    },
    forwardedRef,
  ) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const pendingRef = useRef(new Map<string, PendingRequest>());
    const resolvedOrigin = useMemo(
      () => targetOrigin ?? embeddedAppOrigin(url),
      [targetOrigin, url],
    );
    const trustedOrigins = useMemo(
      () =>
        allowedOrigins ??
        (resolvedOrigin && resolvedOrigin !== "*" ? [resolvedOrigin] : []),
      [allowedOrigins, resolvedOrigin],
    );
    const src = useMemo(() => {
      if (embed === false) return url;
      const options = typeof embed === "object" ? embed : {};
      return withEmbeddedAppParams(url, options);
    }, [embed, url]);

    const refValue = useMemo<EmbeddedAppRef>(
      () => ({
        get iframe() {
          return iframeRef.current;
        },
        origin: resolvedOrigin,
        postMessage(name, payload) {
          return postEnvelope(
            iframeRef.current,
            resolvedOrigin ?? undefined,
            createAgentNativeEmbedEnvelope(
              AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE,
              { name, payload },
            ),
          );
        },
        request<TResult = unknown, TPayload = unknown>(
          name: string,
          payload?: TPayload,
          options?: { timeoutMs?: number },
        ) {
          const requestId = createEmbeddedAppRequestId();
          return new Promise<TResult>((resolve, reject) => {
            const timeoutMs = options?.timeoutMs ?? 30_000;
            const timer =
              timeoutMs > 0
                ? setTimeout(() => {
                    pendingRef.current.delete(requestId);
                    reject(
                      new Error(`Embedded app request timed out: ${name}`),
                    );
                  }, timeoutMs)
                : undefined;
            pendingRef.current.set(requestId, {
              resolve: (value) => resolve(value as TResult),
              reject,
              timer,
            });
            const posted = postEnvelope(
              iframeRef.current,
              resolvedOrigin ?? undefined,
              createAgentNativeEmbedEnvelope(
                AGENT_NATIVE_EMBED_MESSAGE_TYPES.REQUEST,
                { name, payload, requestId },
              ),
            );
            if (!posted) {
              pendingRef.current.delete(requestId);
              if (timer) clearTimeout(timer);
              reject(new Error("Embedded app iframe is not ready"));
            }
          });
        },
        focus() {
          iframeRef.current?.focus();
        },
      }),
      [resolvedOrigin],
    );

    useImperativeHandle(forwardedRef, () => refValue, [refValue]);

    const respond = useCallback(
      (
        requestId: string | undefined,
        type: "response" | "error",
        value: unknown,
      ) => {
        if (!requestId) return;
        postEnvelope(
          iframeRef.current,
          resolvedOrigin ?? undefined,
          createAgentNativeEmbedEnvelope(
            type === "response"
              ? AGENT_NATIVE_EMBED_MESSAGE_TYPES.RESPONSE
              : AGENT_NATIVE_EMBED_MESSAGE_TYPES.ERROR,
            type === "response"
              ? { requestId, payload: value }
              : { requestId, error: messageErrorPayload(value) },
          ),
        );
      },
      [resolvedOrigin],
    );

    useEffect(() => {
      const listener = (event: MessageEvent) => {
        if (!isEmbeddedAppMessageSource(event, iframeRef.current)) return;
        if (!isAllowedEmbeddedAppOrigin(event.origin, trustedOrigins)) return;
        if (!isAgentNativeEmbedEnvelope(event.data)) return;

        const envelope = event.data;
        if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.READY) {
          onReady?.(envelope.payload, event, refValue);
          return;
        }

        if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.RESPONSE) {
          const requestId = envelope.requestId;
          if (!requestId) return;
          const pending = pendingRef.current.get(requestId);
          if (!pending) return;
          pendingRef.current.delete(requestId);
          if (pending.timer) clearTimeout(pending.timer);
          pending.resolve(envelope.payload);
          return;
        }

        if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.ERROR) {
          const requestId = envelope.requestId;
          if (!requestId) return;
          const pending = pendingRef.current.get(requestId);
          if (!pending) return;
          pendingRef.current.delete(requestId);
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(
            new Error(envelope.error?.message ?? "Embedded app error"),
          );
          return;
        }

        if (!envelope.name) return;

        if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.REQUEST) {
          Promise.resolve(
            onRequest?.(envelope.name, envelope.payload, event, refValue),
          )
            .then((payload) => respond(envelope.requestId, "response", payload))
            .catch((error) => respond(envelope.requestId, "error", error));
          return;
        }

        if (envelope.type === AGENT_NATIVE_EMBED_MESSAGE_TYPES.MESSAGE) {
          onMessage?.(envelope.name, envelope.payload, event, refValue);
        }
      };

      window.addEventListener("message", listener);
      return () => {
        window.removeEventListener("message", listener);
      };
    }, [onMessage, onReady, onRequest, refValue, respond, trustedOrigins]);

    useEffect(() => {
      return () => {
        for (const pending of pendingRef.current.values()) {
          if (pending.timer) clearTimeout(pending.timer);
          pending.reject(new Error("Embedded app unmounted"));
        }
        pendingRef.current.clear();
      };
    }, []);

    return (
      <iframe
        {...iframeProps}
        ref={iframeRef}
        src={src}
        title={title}
        sandbox={sandbox}
        allow={allow}
        referrerPolicy={referrerPolicy}
        style={{ ...defaultStyle, ...style }}
        onLoad={() => onLoad?.(refValue)}
      />
    );
  },
);
