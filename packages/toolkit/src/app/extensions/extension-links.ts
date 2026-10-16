import { openMcpAppHostLink } from "@agent-native/core/client/agent-chat";
import { isEmbedMcpChatBridgeActive } from "@agent-native/core/client/host";
import {
  EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_HOST_PORT_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
  EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
} from "@agent-native/core/extensions/html-shell";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

const useLinkEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface ExternalExtensionLinkOptions {
  enabled?: boolean;
  onReady?: () => void;
  onHostPortReady?: (port: MessagePort) => void;
}

export function useExternalExtensionLinks(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  frameIdentity: unknown,
  options: ExternalExtensionLinkOptions = {},
): string | null {
  const { enabled = true, onReady, onHostPortReady } = options;
  const [nonce, setNonce] = useState<string | null>(null);
  const recoveryAttemptedRef = useRef(false);

  useEffect(() => {
    recoveryAttemptedRef.current = false;
    setNonce(enabled ? createExternalExtensionLinkNonce() : null);
  }, [enabled]);

  useLinkEffect(() => {
    if (!enabled || !nonce) return;
    return connectExternalExtensionLinks(
      iframeRef,
      nonce,
      onReady,
      onHostPortReady,
      recoveryAttemptedRef,
      () => {
        if (recoveryAttemptedRef.current) return;
        recoveryAttemptedRef.current = true;
        setNonce(createExternalExtensionLinkNonce());
      },
    );
  }, [enabled, frameIdentity, iframeRef, nonce, onHostPortReady, onReady]);

  return enabled ? nonce : null;
}

export function createExternalExtensionLinkNonce(): string {
  const bytes = window.crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function extensionFrameUrlWithLinkNonce(
  source: string,
  nonce: string,
): string {
  const url = new URL(source, window.location.href);
  url.hash = nonce;
  return url.toString();
}

function connectExternalExtensionLinks(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  nonce: string,
  onReady: (() => void) | undefined,
  onHostPortReady: ((port: MessagePort) => void) | undefined,
  recoveryAttemptedRef: { current: boolean },
  recover: () => void,
): () => void {
  if (typeof MessageChannel === "undefined") {
    return () => {};
  }

  let activeLinkPort: MessagePort | null = null;
  let activeHostBridgePort: MessagePort | null = null;
  let activePortWindow: MessageEventSource | null = null;
  let handshakeBeforeFrameLoad = false;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let readyReported = false;

  const onPortMessage = (event: MessageEvent) => {
    if (activePortWindow !== iframeRef.current?.contentWindow) return;
    const message = event.data;
    if (message?.type === EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE) {
      if (!readyReported) {
        readyReported = true;
        onReady?.();
      }
      return;
    }
    if (
      typeof message !== "object" ||
      message === null ||
      message.type !== EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE
    ) {
      return;
    }
    openExternalExtensionLink(message.href);
  };

  const onFrameLoad = (event: Event) => {
    const iframe = iframeRef.current;
    if (!iframe || event.target !== iframe) return;
    iframe.removeAttribute("data-link-channel-ready");
    if (handshakeBeforeFrameLoad) {
      handshakeBeforeFrameLoad = false;
      return;
    }

    activeLinkPort?.close();
    activeHostBridgePort?.close();
    activeLinkPort = null;
    activeHostBridgePort = null;
    activePortWindow = null;
    if (recoveryTimer) clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(() => {
      recoveryTimer = null;
      recover();
    }, 2500);
  };

  const onWindowMessage = (event: MessageEvent) => {
    if (
      event.source !== iframeRef.current?.contentWindow ||
      event.origin !== "null" ||
      typeof event.data !== "object" ||
      event.data === null
    ) {
      return;
    }

    const message = event.data as { type?: unknown; nonce?: unknown };

    if (
      message.type !== EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE ||
      message.nonce !== nonce ||
      event.ports.length !== 1
    ) {
      for (const port of event.ports) port.close();
      return;
    }

    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    } else {
      handshakeBeforeFrameLoad = true;
    }
    recoveryAttemptedRef.current = false;
    activeLinkPort?.close();
    activeHostBridgePort?.close();
    activePortWindow = event.source;
    activeLinkPort = event.ports[0];
    readyReported = false;
    activeLinkPort.addEventListener("message", onPortMessage);
    activeLinkPort.start();

    if (onHostPortReady) {
      const channel = new MessageChannel();
      activeHostBridgePort = channel.port1;
      onHostPortReady(channel.port1);
      activeLinkPort.postMessage(
        { type: EXTENSION_LINK_CHANNEL_HOST_PORT_MESSAGE_TYPE },
        [channel.port2],
      );
    }

    activeLinkPort.postMessage({
      type: EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
    });
  };

  window.addEventListener("message", onWindowMessage);
  document.addEventListener("load", onFrameLoad, true);
  return () => {
    window.removeEventListener("message", onWindowMessage);
    document.removeEventListener("load", onFrameLoad, true);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    activeLinkPort?.close();
    activeHostBridgePort?.close();
    activePortWindow = null;
  };
}

function openExternalExtensionLink(value: unknown): boolean {
  if (typeof value !== "string") return false;

  if (!URL.canParse(value)) return false;
  const destination = new URL(value);

  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    destination.origin === window.location.origin ||
    destination.username !== "" ||
    destination.password !== ""
  ) {
    return false;
  }

  if (
    typeof navigator.userActivation !== "undefined" &&
    !navigator.userActivation.isActive
  ) {
    return false;
  }

  if (isEmbedMcpChatBridgeActive()) {
    void openMcpAppHostLink(destination.href);
    return true;
  }

  window.open(destination.href, "_blank", "noopener,noreferrer");
  return true;
}
