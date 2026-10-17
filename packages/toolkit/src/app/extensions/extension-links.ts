import { openMcpAppHostLink } from "@agent-native/core/client/agent-chat";
import { agentNativePath, appPath } from "@agent-native/core/client/api-path";
import { isEmbedMcpChatBridgeActive } from "@agent-native/core/client/host";
import {
  EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_HOST_PORT_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
  EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE,
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
  const acceptedNonceRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onReady, onHostPortReady });
  callbacksRef.current = { onReady, onHostPortReady };

  useLinkEffect(() => {
    recoveryAttemptedRef.current = false;
    setNonce(enabled ? createExternalExtensionLinkNonce() : null);
  }, [enabled, frameIdentity]);

  useLinkEffect(() => {
    if (!enabled || !nonce) return;
    return connectExternalExtensionLinks(
      iframeRef,
      nonce,
      () => callbacksRef.current.onReady?.(),
      () => callbacksRef.current.onHostPortReady,
      recoveryAttemptedRef,
      acceptedNonceRef,
      () => {
        if (recoveryAttemptedRef.current) return;
        recoveryAttemptedRef.current = true;
        setNonce(createExternalExtensionLinkNonce());
      },
    );
  }, [enabled, frameIdentity, iframeRef, nonce]);

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
  const appFragment = url.hash.slice(1);
  url.hash = `__agent_native_link_nonce=${encodeURIComponent(nonce)}&__agent_native_app_fragment=${encodeURIComponent(appFragment)}`;
  return url.toString();
}

function connectExternalExtensionLinks(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  nonce: string,
  onReady: (() => void) | undefined,
  getOnHostPortReady:
    | (() => ((port: MessagePort) => void) | undefined)
    | undefined,
  recoveryAttemptedRef: { current: boolean },
  acceptedNonceRef: { current: string | null },
  recover: () => void,
): () => void {
  if (typeof MessageChannel === "undefined") {
    return () => {};
  }

  let activeLinkPort: MessagePort | null = null;
  let activeHostBridgePort: MessagePort | null = null;
  let activePortWindow: MessageEventSource | null = null;
  let initialFrameLoadObserved = false;
  let handshakeBeforeFrameLoad = false;
  let handshakeAcknowledged = false;
  let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  let readyReported = false;

  const onPortMessage = (event: MessageEvent) => {
    if (
      event.currentTarget !== activeLinkPort ||
      activePortWindow !== iframeRef.current?.contentWindow
    ) {
      return;
    }
    const message = event.data;
    if (message?.type === EXTENSION_LINK_CHANNEL_ACK_MESSAGE_TYPE) {
      handshakeAcknowledged = true;
      if (recoveryTimer) {
        clearTimeout(recoveryTimer);
        recoveryTimer = null;
      }
      if (!readyReported) {
        readyReported = true;
        onReady?.();
      }
      return;
    }
    if (message?.type === EXTENSION_NAVIGATE_SAME_ORIGIN_MESSAGE_TYPE) {
      navigateSameOriginExtensionLink(message.href);
      return;
    }
    if (
      typeof message !== "object" ||
      message === null ||
      message.type !== EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE
    ) {
      return;
    }
    openExternalExtensionLink(message.href, message.openInNewContext === true);
  };

  const onFrameLoad = (event: Event) => {
    const iframe = iframeRef.current;
    if (!iframe || event.target !== iframe) return;
    const isInitialLoad = !initialFrameLoadObserved;
    initialFrameLoadObserved = true;
    iframe.removeAttribute("data-link-channel-ready");
    if (isInitialLoad && handshakeBeforeFrameLoad) {
      handshakeBeforeFrameLoad = false;
      if (handshakeAcknowledged) return;

      if (recoveryTimer) clearTimeout(recoveryTimer);
      recoveryTimer = setTimeout(() => {
        recoveryTimer = null;
        recover();
      }, 2500);
      return;
    }
    handshakeBeforeFrameLoad = false;

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

  const onPageHide = (event: PageTransitionEvent) => {
    if (!event.persisted) return;

    acceptedNonceRef.current = null;
    handshakeAcknowledged = false;
    readyReported = false;
    activeLinkPort?.close();
    activeHostBridgePort?.close();
    activeLinkPort = null;
    activeHostBridgePort = null;
    activePortWindow = null;
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    }
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
      event.ports.length !== 1 ||
      (acceptedNonceRef.current === nonce && handshakeAcknowledged)
    ) {
      for (const port of event.ports) port.close();
      return;
    }

    acceptedNonceRef.current = nonce;
    if (recoveryTimer) {
      clearTimeout(recoveryTimer);
      recoveryTimer = null;
    } else if (!initialFrameLoadObserved) {
      handshakeBeforeFrameLoad = true;
    }
    recoveryAttemptedRef.current = false;
    activeLinkPort?.close();
    activeHostBridgePort?.close();
    activePortWindow = event.source;
    activeLinkPort = event.ports[0];
    handshakeAcknowledged = false;
    readyReported = false;
    activeLinkPort.addEventListener("message", onPortMessage);
    activeLinkPort.start();

    const onHostPortReady = getOnHostPortReady?.();
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
  window.addEventListener("pagehide", onPageHide);
  document.addEventListener("load", onFrameLoad, true);
  return () => {
    window.removeEventListener("message", onWindowMessage);
    window.removeEventListener("pagehide", onPageHide);
    document.removeEventListener("load", onFrameLoad, true);
    if (recoveryTimer) clearTimeout(recoveryTimer);
    activeLinkPort?.close();
    activeHostBridgePort?.close();
    activePortWindow = null;
  };
}

function openExternalExtensionLink(
  value: unknown,
  openInNewContext = false,
): boolean {
  if (typeof value !== "string") return false;

  if (!URL.canParse(value)) return false;
  const destination = new URL(value);

  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    (destination.origin === window.location.origin && !openInNewContext) ||
    destination.username !== "" ||
    destination.password !== ""
  ) {
    return false;
  }

  if (
    destination.origin === window.location.origin &&
    isExtensionApiPath(destination.pathname)
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
    let hostRequest: Promise<boolean> | false;
    try {
      hostRequest = openMcpAppHostLink(destination.href);
    } catch {
      hostRequest = false;
    }

    if (hostRequest === false) {
      window.open(destination.href, "_blank", "noopener,noreferrer");
      return true;
    }

    const fallbackWindow = reserveExternalLinkFallbackWindow();
    void Promise.resolve(hostRequest).then(
      (openedByHost) => {
        if (openedByHost) closeExternalLinkFallbackWindow(fallbackWindow);
        else openExternalLinkFallback(destination.href, fallbackWindow);
      },
      () => openExternalLinkFallback(destination.href, fallbackWindow),
    );
    return true;
  }

  window.open(destination.href, "_blank", "noopener,noreferrer");
  return true;
}

function navigateSameOriginExtensionLink(value: unknown): boolean {
  if (typeof value !== "string" || !URL.canParse(value)) return false;

  const destination = new URL(value);
  if (
    (destination.protocol !== "http:" && destination.protocol !== "https:") ||
    destination.origin !== window.location.origin ||
    destination.username !== "" ||
    destination.password !== ""
  ) {
    return false;
  }

  // The extensions API serves user-authored HTML at its /render endpoint.
  if (isExtensionApiPath(destination.pathname)) return false;

  if (
    typeof navigator.userActivation !== "undefined" &&
    !navigator.userActivation.isActive
  ) {
    return false;
  }

  window.location.assign(destination.href);
  return true;
}

export function isExtensionApiPath(pathname: string): boolean {
  const baseHref =
    typeof window === "undefined"
      ? "http://agent-native.invalid/"
      : window.location.href;
  const apiPathPrefixes = ["/_agent-native/extensions", "/_agent-native/tools"]
    .flatMap((path) => [agentNativePath(path), appPath(path)])
    .map((path) => new URL(path, baseHref).pathname.replace(/\/+$/, ""));
  const matchesApiPath = (candidate: string) =>
    apiPathPrefixes.some(
      (prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`),
    );

  let candidate = pathname;
  for (let decodePass = 0; decodePass < 3; decodePass += 1) {
    if (matchesApiPath(candidate)) return true;
    const decoded = candidate
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .join("/");
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return matchesApiPath(candidate);
}

function reserveExternalLinkFallbackWindow(): Window | null {
  let fallbackWindow: Window | null;
  try {
    fallbackWindow = window.open("about:blank", "_blank");
  } catch {
    // coercion-ok: a blocked popup returns an unavailable sentinel to the caller.
    return null;
  }
  if (!fallbackWindow) return null;

  try {
    fallbackWindow.opener = null;
    return fallbackWindow;
  } catch {
    try {
      fallbackWindow.close();
    } catch {
      // coercion-ok: best-effort cleanup after opener isolation failed.
      // The popup may already have been closed by the browser.
    }
    return null;
  }
}

function closeExternalLinkFallbackWindow(fallbackWindow: Window | null): void {
  if (!fallbackWindow) return;
  try {
    if (!fallbackWindow.closed) fallbackWindow.close();
  } catch {
    // coercion-ok: host acceptance is complete; this is cleanup only.
    // The popup may already have been closed by the browser.
  }
}

function openExternalLinkFallback(
  url: string,
  fallbackWindow: Window | null,
): void {
  if (fallbackWindow) {
    try {
      if (!fallbackWindow.closed) {
        fallbackWindow.location.replace(url);
        return;
      }
    } catch {
      closeExternalLinkFallbackWindow(fallbackWindow);
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
