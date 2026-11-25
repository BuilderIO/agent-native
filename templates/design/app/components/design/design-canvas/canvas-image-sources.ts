import { appApiPath } from "@agent-native/core/client/api-path";
import {
  canvasImageFrameBootstrap,
  CANVAS_IMAGE_ROUTE,
  withCanvasImageSizing,
} from "@shared/canvas-image-url";
import { injectHeadStartMarkup } from "@shared/visual-layers";

function canvasImageOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const { origin, protocol } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return null;
  return appApiPath(CANVAS_IMAGE_ROUTE) === CANVAS_IMAGE_ROUTE ? origin : null;
}

export function withCanvasRenderSources(html: string): string {
  const origin = canvasImageOrigin();
  return origin === null ? html : withCanvasImageSizing(html, origin);
}

export function canvasImageBootstrapMarkup(): string {
  const origin = canvasImageOrigin();
  return origin === null ? "" : canvasImageFrameBootstrap(origin);
}

export function withCanvasImageBootstrap(frameDocument: string): string {
  return injectHeadStartMarkup(frameDocument, canvasImageBootstrapMarkup());
}
