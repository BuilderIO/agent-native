import type { RefObject } from "react";

const REQUEST_TYPE = "agentNative.designPreview.request";
const STATE_TYPE = "agentNative.designPreview.state";

type PreviewRect = { x: number; y: number; width: number; height: number };
type PreviewRequest = {
  action?: unknown;
  previewBounds?: PreviewRect;
  clipBounds?: PreviewRect;
  [key: string]: unknown;
};
type PreviewState = { [key: string]: unknown };

interface DesktopPreviewBridge {
  request(request: PreviewRequest): void;
  onState(callback: (state: PreviewState) => void): () => void;
}

function getDesktopPreviewBridge(): DesktopPreviewBridge | null {
  const desktop = (
    window as typeof window & {
      agentNativeDesktop?: { designPreview?: DesktopPreviewBridge };
    }
  ).agentNativeDesktop;
  return desktop?.designPreview ?? null;
}

function offsetRect(rect: PreviewRect, offset: DOMRect): PreviewRect {
  return {
    x: rect.x + offset.x,
    y: rect.y + offset.y,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Relay nested local Design requests to the top-level desktop webview preload.
 * The nested iframe never receives Electron APIs: both its Window identity and
 * exact configured origin must match before the frame forwards a bounded
 * request to the main process, which performs the authoritative validation.
 */
export function installDesktopDesignPreviewRelay(options: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  appUrl: string;
}): () => void {
  const bridge = getDesktopPreviewBridge();
  if (!bridge) return () => {};

  let appOrigin: string;
  try {
    appOrigin = new URL(options.appUrl).origin;
  } catch {
    return () => {};
  }

  const onMessage = (event: MessageEvent) => {
    const iframe = options.iframeRef.current;
    if (
      !iframe?.contentWindow ||
      event.source !== iframe.contentWindow ||
      event.origin !== appOrigin ||
      event.data?.type !== REQUEST_TYPE ||
      !event.data.data ||
      typeof event.data.data !== "object" ||
      Array.isArray(event.data.data)
    ) {
      return;
    }
    const request = event.data.data as PreviewRequest;
    if (request.action === "update") {
      if (!request.previewBounds || !request.clipBounds) return;
      const frameRect = iframe.getBoundingClientRect();
      bridge.request({
        ...request,
        previewBounds: offsetRect(request.previewBounds, frameRect),
        clipBounds: offsetRect(request.clipBounds, frameRect),
      });
      return;
    }
    if (request.action === "destroy") bridge.request(request);
  };
  window.addEventListener("message", onMessage);

  const unsubscribeState = bridge.onState((state) => {
    options.iframeRef.current?.contentWindow?.postMessage(
      { type: STATE_TYPE, data: state },
      appOrigin,
    );
  });

  return () => {
    window.removeEventListener("message", onMessage);
    unsubscribeState();
  };
}
