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
    if (!nonce) return;
    return connectExternalExtensionLinks(iframeRef, nonce, setNonce, onReady);
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
  iframeRef: RefObject<HTMLIFrameElement | null>,
  nonce: string,
  onReseed: (nonce: string) => void,
  onReady?: () => void,
): () => void {
  if (typeof MessageChannel === "undefined") {
    return () => {};
  }

  let activePort: MessagePort | null = null;
  let activePortWindow: MessageEventSource | null = null;
  const onPortMessage = (event: MessageEvent) => {
    if (activePortWindow !== iframeRef.current?.contentWindow) return;
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
      event.source !== iframeRef.current?.contentWindow ||
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
    activePortWindow = event.source;
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

  window.open(destination.href, "_blank", "noopener,noreferrer");
  return true;
}
