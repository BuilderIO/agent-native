import {
  EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
  EXTENSION_LINK_CHANNEL_RESEED_MESSAGE_TYPE,
  EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE,
} from "@agent-native/core/extensions/html-shell";
import { useEffect, useState, type RefObject } from "react";

export function useExternalExtensionLinks(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  frameIdentity: unknown,
  onReady?: () => void,
): string | null {
  const [nonce, setNonce] = useState<string | null>(null);

  useEffect(() => {
    setNonce(createExternalExtensionLinkNonce());
  }, []);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !nonce) return;
    return connectExternalExtensionLinks(iframe, nonce, setNonce, onReady);
  }, [iframeRef, frameIdentity, nonce, onReady]);

  return nonce;
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
  iframe: HTMLIFrameElement,
  nonce: string,
  onReseed: (nonce: string) => void,
  onReady?: () => void,
): () => void {
  const contentWindow = iframe.contentWindow;
  if (!contentWindow || typeof MessageChannel === "undefined") {
    return () => {};
  }

  let activePort: MessagePort | null = null;
  const onPortMessage = (event: MessageEvent) => {
    const message = event.data;
    if (
      typeof message !== "object" ||
      message === null ||
      message.type !== EXTENSION_OPEN_EXTERNAL_LINK_MESSAGE_TYPE
    ) {
      return;
    }
    openExternalExtensionLink(message.href);
  };

  const onWindowMessage = (event: MessageEvent) => {
    if (
      event.source !== contentWindow ||
      event.origin !== "null" ||
      typeof event.data !== "object" ||
      event.data === null
    ) {
      return;
    }

    const message = event.data as { type?: unknown; nonce?: unknown };
    if (message.type === EXTENSION_LINK_CHANNEL_RESEED_MESSAGE_TYPE) {
      if (event.ports.length === 0)
        onReseed(createExternalExtensionLinkNonce());
      return;
    }

    if (
      message.type !== EXTENSION_LINK_CHANNEL_HELLO_MESSAGE_TYPE ||
      message.nonce !== nonce ||
      event.ports.length !== 1
    ) {
      for (const port of event.ports) port.close();
      return;
    }

    activePort?.close();
    activePort = event.ports[0];
    activePort.addEventListener("message", onPortMessage);
    activePort.start();
    activePort.postMessage({
      type: EXTENSION_LINK_CHANNEL_READY_MESSAGE_TYPE,
    });
    onReady?.();
  };

  window.addEventListener("message", onWindowMessage);
  return () => {
    window.removeEventListener("message", onWindowMessage);
    activePort?.close();
  };
}

function openExternalExtensionLink(value: unknown): boolean {
  if (typeof value !== "string") return false;

  let destination: URL;
  try {
    destination = new URL(value);
  } catch {
    return false;
  }

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

  window.open(destination.href, "_blank", "noopener,noreferrer");
  return true;
}
