import { EXTENSION_EXTERNAL_LINK_BRIDGE_HASH_KEY } from "@agent-native/core/extensions/html-shell";
import { connectExtensionExternalLinkBridge } from "@agent-native/core/extensions/html-shell";
import {
  useEffect,
  useLayoutEffect,
  useState,
  type MutableRefObject,
  type RefObject,
} from "react";

const useClientLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function useExtensionExternalLinkBridgeNonce(): string | null {
  const [nonce, setNonce] = useState<string | null>(null);

  useEffect(() => {
    setNonce(window.crypto.randomUUID());
  }, []);

  return nonce;
}

export function withExtensionExternalLinkBridgeNonce(
  url: string,
  nonce: string,
): string {
  const baseUrl = url.split("#", 1)[0];
  return `${baseUrl}#${EXTENSION_EXTERNAL_LINK_BRIDGE_HASH_KEY}=${encodeURIComponent(nonce)}`;
}

export function useExtensionExternalLinkBridge(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  cleanupRef: MutableRefObject<(() => void) | null>,
  documentKey: string | undefined,
  nonce: string | null,
): void {
  useClientLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !documentKey || !nonce) return;
    const cleanup = connectExtensionExternalLinkBridge(
      iframe,
      window,
      documentKey,
      nonce,
    );
    if (!cleanup) return;

    cleanupRef.current = cleanup;
    return () => {
      cleanup();
      if (cleanupRef.current === cleanup) cleanupRef.current = null;
    };
  }, [cleanupRef, documentKey, iframeRef, nonce]);
}
