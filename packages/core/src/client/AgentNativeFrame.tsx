import React, {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type IframeHTMLAttributes,
} from "react";

import {
  createAgentNativeHostBridge,
  type AgentNativeClientActions,
  type AgentNativeHostAuth,
  type AgentNativeHostBridge,
  type AgentNativeHostBridgeEvent,
  type AgentNativeHostCommandHandlers,
  type AgentNativeHostContextGetter,
  type AgentNativeHostSession,
} from "./host-bridge.js";

export interface AgentNativeFrameProps extends Omit<
  IframeHTMLAttributes<HTMLIFrameElement>,
  "src"
> {
  /** URL of the Agent-Native sidecar/frame app. */
  agentUrl: string;
  /**
   * Exact trusted sidecar origin. Defaults to `new URL(agentUrl).origin`.
   * Pass "*" only for local prototypes.
   */
  agentOrigin?: string;
  /** Stable browser-session identity for multi-tab sidecars. */
  session?: string | Partial<AgentNativeHostSession>;
  /** Return page, selection, resource, user/org, and host-specific context. */
  getContext?: AgentNativeHostContextGetter;
  /** Commands the iframe sidecar can ask the host app to run. */
  commands?: AgentNativeHostCommandHandlers;
  /** Live browser-session actions the iframe sidecar can discover and call. */
  actions?: AgentNativeClientActions;
  /** Optional auth payload sent to the trusted iframe sidecar. */
  auth?: AgentNativeHostAuth;
  onBridgeEvent?: (event: AgentNativeHostBridgeEvent) => void;
  onBridgeReady?: (bridge: AgentNativeHostBridge) => void;
}

function originFromUrl(value: string): string | undefined {
  try {
    const base =
      typeof window !== "undefined"
        ? window.location.href
        : "http://agent-native.local";
    return new URL(value, base).origin;
  } catch {
    return undefined;
  }
}

function setForwardedRef<T>(ref: React.ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

const defaultStyle: CSSProperties = {
  border: 0,
  width: "100%",
  height: "100%",
};

export const AgentNativeFrame = forwardRef<
  HTMLIFrameElement,
  AgentNativeFrameProps
>(function AgentNativeFrame(
  {
    agentUrl,
    agentOrigin,
    session,
    getContext,
    commands,
    actions,
    auth,
    onBridgeEvent,
    onBridgeReady,
    title = "Agent Native assistant",
    sandbox = "allow-scripts allow-same-origin allow-forms allow-popups allow-downloads",
    allow = "clipboard-read; clipboard-write; microphone; fullscreen",
    referrerPolicy = "strict-origin-when-cross-origin",
    style,
    onLoad,
    ...iframeProps
  },
  forwardedRef,
) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeRef = useRef<AgentNativeHostBridge | null>(null);
  const resolvedOrigin = useMemo(
    () => agentOrigin ?? originFromUrl(agentUrl),
    [agentOrigin, agentUrl],
  );

  useEffect(() => {
    const bridge = createAgentNativeHostBridge({
      agentOrigin: resolvedOrigin,
      session,
      getContext,
      commands,
      actions,
      auth,
      onEvent: onBridgeEvent,
      targetWindow: iframeRef.current?.contentWindow ?? null,
    }).start();
    bridgeRef.current = bridge;
    onBridgeReady?.(bridge);
    return () => {
      bridge.stop();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [
    auth,
    actions,
    commands,
    getContext,
    onBridgeEvent,
    onBridgeReady,
    resolvedOrigin,
    session,
  ]);

  return (
    <iframe
      {...iframeProps}
      ref={(node) => {
        iframeRef.current = node;
        setForwardedRef(forwardedRef, node);
        bridgeRef.current?.setTargetWindow(node?.contentWindow ?? null);
      }}
      src={agentUrl}
      title={title}
      sandbox={sandbox}
      allow={allow}
      referrerPolicy={referrerPolicy}
      style={{ ...defaultStyle, ...style }}
      onLoad={(event) => {
        bridgeRef.current?.setTargetWindow(
          event.currentTarget.contentWindow ?? null,
        );
        void bridgeRef.current?.sendInit();
        onLoad?.(event);
      }}
    />
  );
});
