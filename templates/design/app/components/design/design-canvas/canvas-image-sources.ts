import { appApiPath } from "@agent-native/core/client/api-path";
import { callAction } from "@agent-native/core/client/use-action";
import {
  canvasImageFrameBootstrap,
  CANVAS_IMAGE_DENIED_MESSAGE,
  CANVAS_IMAGE_ROUTE,
  withCanvasImageSizing,
  type CanvasImageAuth,
  type CanvasImageProxy,
} from "@shared/canvas-image-url";
import { injectHeadStartMarkup } from "@shared/visual-layers";
import { useEffect, useSyncExternalStore } from "react";

const SETTLE_WAIT_MS = 1500;
const REFRESH_LEAD_MS = 10 * 60 * 1000;
const DENIED_REFRESH_MIN_MS = 60 * 1000;
const RETRY_DELAYS_MS = [2000, 8000, 30_000, 120_000];

let canvasImageAuth: CanvasImageAuth | null = null;
let settled = false;
let requestInFlight = false;
let retryCount = 0;
let lastRequestAt = 0;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
const settledListeners = new Set<() => void>();

function settle(): void {
  if (settled) return;
  settled = true;
  settledListeners.forEach((listener) => listener());
}

function scheduleRefresh(exp: number): void {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(
    requestCanvasImageToken,
    Math.max(exp * 1000 - Date.now() - REFRESH_LEAD_MS, DENIED_REFRESH_MIN_MS),
  );
}

function requestCanvasImageToken(): void {
  if (requestInFlight) return;
  requestInFlight = true;
  lastRequestAt = Date.now();
  callAction("get-canvas-image-token", {}, { method: "GET" }).then(
    (result) => {
      requestInFlight = false;
      retryCount = 0;
      if (result.available) {
        canvasImageAuth = {
          subject: result.subject,
          exp: result.exp,
          token: result.token,
        };
        scheduleRefresh(result.exp);
      } else {
        canvasImageAuth = null;
      }
      settle();
    },
    (error: unknown) => {
      requestInFlight = false;
      console.warn("[canvas-image] token unavailable", error);
      settle();
      if (retryCount < RETRY_DELAYS_MS.length) {
        setTimeout(requestCanvasImageToken, RETRY_DELAYS_MS[retryCount]);
      }
      retryCount += 1;
    },
  );
}

function refreshAfterDenial(): void {
  if (Date.now() - lastRequestAt < DENIED_REFRESH_MIN_MS) return;
  requestCanvasImageToken();
}

let started = false;

function startCanvasImageToken(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("message", (event) => {
    const data: unknown = event.data;
    if (
      typeof data === "object" &&
      data !== null &&
      (data as { type?: unknown }).type === CANVAS_IMAGE_DENIED_MESSAGE
    ) {
      refreshAfterDenial();
    }
  });
  setTimeout(settle, SETTLE_WAIT_MS);
  requestCanvasImageToken();
}

function subscribeToSettled(listener: () => void): () => void {
  settledListeners.add(listener);
  return () => settledListeners.delete(listener);
}

export function useCanvasImagesReady(): boolean {
  useEffect(startCanvasImageToken, []);
  return useSyncExternalStore(
    subscribeToSettled,
    () => settled,
    () => true,
  );
}

function canvasImageRoute(): string | null {
  const route = appApiPath(CANVAS_IMAGE_ROUTE);
  return route.startsWith("/") ? route : null;
}

function canvasImageProxy(): CanvasImageProxy | null {
  if (typeof window === "undefined" || canvasImageAuth === null) return null;
  const { origin, protocol } = window.location;
  if (protocol !== "http:" && protocol !== "https:") return null;
  const route = canvasImageRoute();
  return route === null ? null : { origin, route, auth: canvasImageAuth };
}

export function withCanvasRenderSources(html: string): string {
  const proxy = canvasImageProxy();
  return proxy === null ? html : withCanvasImageSizing(html, proxy);
}

export function canvasImageBootstrapMarkup(): string {
  const proxy = canvasImageProxy();
  return proxy === null ? "" : canvasImageFrameBootstrap(proxy);
}

export function withCanvasImageBootstrap(frameDocument: string): string {
  return injectHeadStartMarkup(frameDocument, canvasImageBootstrapMarkup());
}
