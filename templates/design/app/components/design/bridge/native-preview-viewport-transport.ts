import {
  NATIVE_PREVIEW_INSET_ATTRIBUTES,
  planNativePreviewViewport,
  readNativePreviewInsetClip,
  type NativePreviewBox,
} from "./native-preview-geometry";

export const NATIVE_PREVIEW_VIEWPORT_MESSAGE =
  "native-preview-viewport" as const;
export const NATIVE_PREVIEW_VIEWPORT_REQUEST_MESSAGE =
  "native-preview-viewport-request" as const;

export interface NativePreviewViewportRequest {
  type: typeof NATIVE_PREVIEW_VIEWPORT_REQUEST_MESSAGE;
  schemaVersion: 1;
  nonce: string;
  width: number;
  height: number;
}

export interface NativePreviewViewportResponse {
  type: typeof NATIVE_PREVIEW_VIEWPORT_MESSAGE;
  schemaVersion: 1;
  nonce: string;
  width: number;
  height: number;
  viewport: NativePreviewBox | null;
  maxViewportWidth: number | null;
  maxViewportHeight: number | null;
  displayScale: number;
  error?: { code: string; message: string };
}

const MAX_VIEWPORT_DIMENSION = 16_384;
const MAX_ANCESTOR_DEPTH = 128;
const TRANSFORM_AXIS_TOLERANCE = 0.000001;

function exceedsAxisTolerance(value: number): boolean {
  return Math.abs(value) > TRANSFORM_AXIS_TOLERANCE;
}

export function isNativePreviewViewportRequest(
  value: unknown,
): value is NativePreviewViewportRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<NativePreviewViewportRequest>;
  return (
    request.type === NATIVE_PREVIEW_VIEWPORT_REQUEST_MESSAGE &&
    request.schemaVersion === 1 &&
    typeof request.nonce === "string" &&
    /^[A-Za-z0-9_-]{16,80}$/.test(request.nonce) &&
    typeof request.width === "number" &&
    Number.isFinite(request.width) &&
    request.width > 0 &&
    request.width <= MAX_VIEWPORT_DIMENSION &&
    typeof request.height === "number" &&
    Number.isFinite(request.height) &&
    request.height > 0 &&
    request.height <= MAX_VIEWPORT_DIMENSION
  );
}

export function isTrustedOpaquePreviewViewportRequest(input: {
  eventSourceIsFrame: boolean;
  eventOrigin: string;
  hasOneTransferredPort: boolean;
  request: unknown;
}): input is typeof input & { request: NativePreviewViewportRequest } {
  return (
    input.eventSourceIsFrame &&
    input.eventOrigin === "null" &&
    input.hasOneTransferredPort &&
    isNativePreviewViewportRequest(input.request)
  );
}

export function isNativePreviewViewportResponse(
  value: unknown,
): value is NativePreviewViewportResponse {
  if (!value || typeof value !== "object") return false;
  const response = value as Partial<NativePreviewViewportResponse>;
  if (
    response.type !== NATIVE_PREVIEW_VIEWPORT_MESSAGE ||
    response.schemaVersion !== 1 ||
    typeof response.nonce !== "string" ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(response.nonce) ||
    typeof response.width !== "number" ||
    !Number.isFinite(response.width) ||
    response.width <= 0 ||
    response.width > MAX_VIEWPORT_DIMENSION ||
    typeof response.height !== "number" ||
    !Number.isFinite(response.height) ||
    response.height <= 0 ||
    response.height > MAX_VIEWPORT_DIMENSION ||
    typeof response.displayScale !== "number" ||
    !Number.isFinite(response.displayScale) ||
    response.displayScale <= 0 ||
    response.displayScale > 100
  )
    return false;
  if (response.error !== undefined) {
    return (
      response.error !== null &&
      typeof response.error === "object" &&
      typeof response.error.code === "string" &&
      /^[a-z0-9-]{1,80}$/.test(response.error.code) &&
      typeof response.error.message === "string" &&
      response.error.message.length <= 500 &&
      response.viewport === null &&
      response.maxViewportWidth === null &&
      response.maxViewportHeight === null
    );
  }
  const viewport = response.viewport;
  const maxWidth = response.maxViewportWidth;
  const maxHeight = response.maxViewportHeight;
  return (
    (viewport === null && maxWidth === null && maxHeight === null) ||
    (typeof viewport === "object" &&
      viewport !== null &&
      viewport !== undefined &&
      typeof maxWidth === "number" &&
      Number.isFinite(maxWidth) &&
      0 < maxWidth &&
      maxWidth <= response.width &&
      typeof maxHeight === "number" &&
      Number.isFinite(maxHeight) &&
      0 < maxHeight &&
      maxHeight <= response.height &&
      [viewport.x, viewport.y, viewport.width, viewport.height].every(
        Number.isFinite,
      ) &&
      viewport.x >= 0 &&
      viewport.y >= 0 &&
      viewport.width > 0 &&
      viewport.height > 0 &&
      maxWidth + 0.001 >= viewport.width &&
      maxHeight + 0.001 >= viewport.height &&
      viewport.x + viewport.width <= response.width + 0.001 &&
      viewport.y + viewport.height <= response.height + 0.001)
  );
}

export function trustedOpaquePreviewParentOrigin(referrer: string): string {
  if (!referrer)
    throw new TypeError("The preview parent origin is unreadable.");
  let origin: string;
  try {
    const url = new URL(referrer);
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new Error();
    origin = url.origin;
  } catch {
    throw new TypeError("The preview parent origin is unreadable.");
  }
  if (!origin || origin === "null")
    throw new TypeError("The preview parent origin is unreadable.");
  return origin;
}

export function isTrustedOpaquePreviewViewportPortResponse(input: {
  nonce: string | null;
  response: unknown;
}): input is typeof input & { response: NativePreviewViewportResponse } {
  if (!isNativePreviewViewportResponse(input.response)) return false;
  return input.response.nonce === input.nonce;
}

function viewportResponse(
  nonce: string,
  request: NativePreviewViewportRequest,
  frame: HTMLIFrameElement,
): NativePreviewViewportResponse {
  try {
    const parent = frame.ownerDocument.defaultView;
    if (!parent) throw new RangeError("The preview host is unavailable.");
    const display = frame.getBoundingClientRect();
    const clips: NativePreviewBox[] = [
      { x: 0, y: 0, width: parent.innerWidth, height: parent.innerHeight },
    ];
    let depth = 0;
    for (let node: Element | null = frame; node; node = node.parentElement) {
      if (++depth > MAX_ANCESTOR_DEPTH)
        throw new RangeError("The preview host nesting is unsupported.");
      const insetClip = readNativePreviewInsetClip(node);
      if (insetClip) clips.push(insetClip);
      const style = parent.getComputedStyle(node);
      const transform = new DOMMatrixReadOnly(
        style.transform === "none" ? undefined : style.transform,
      );
      if (
        exceedsAxisTolerance(transform.b) ||
        exceedsAxisTolerance(transform.c) ||
        transform.a <= 0 ||
        transform.d <= 0 ||
        !transform.is2D ||
        (style.rotate && style.rotate !== "none" && style.rotate !== "0deg")
      )
        throw new RangeError(
          "The editor preview requires an axis-aligned frame transform.",
        );
      if (
        node === frame ||
        (style.overflowX === "visible" && style.overflowY === "visible")
      )
        continue;
      const rect = node.getBoundingClientRect();
      clips.push({
        x: style.overflowX === "visible" ? 0 : rect.left,
        y: style.overflowY === "visible" ? 0 : rect.top,
        width: style.overflowX === "visible" ? parent.innerWidth : rect.width,
        height:
          style.overflowY === "visible" ? parent.innerHeight : rect.height,
      });
    }
    const planned = planNativePreviewViewport({
      width: request.width,
      height: request.height,
      display: {
        x: display.left,
        y: display.top,
        width: display.width,
        height: display.height,
      },
      clips,
    });
    const displayScale = Math.max(
      display.width / request.width,
      display.height / request.height,
    );
    if (
      !Number.isFinite(displayScale) ||
      displayScale <= 0 ||
      displayScale > 100
    )
      throw new RangeError("The preview display scale is unsupported.");
    return {
      type: NATIVE_PREVIEW_VIEWPORT_MESSAGE,
      schemaVersion: 1,
      nonce,
      width: request.width,
      height: request.height,
      viewport: planned?.viewport ?? null,
      maxViewportWidth: planned?.maxViewportWidth ?? null,
      maxViewportHeight: planned?.maxViewportHeight ?? null,
      displayScale,
    };
  } catch (error) {
    return {
      type: NATIVE_PREVIEW_VIEWPORT_MESSAGE,
      schemaVersion: 1,
      nonce,
      width: request.width,
      height: request.height,
      viewport: null,
      maxViewportWidth: null,
      maxViewportHeight: null,
      displayScale: 1,
      error: {
        code: "preview-viewport-unreadable",
        message:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "The editor preview viewport cannot be read.",
      },
    };
  }
}

export function attachNativePreviewViewportPublisher(
  frame: HTMLIFrameElement,
): () => void {
  const parentWindow = frame.ownerDocument.defaultView;
  if (!parentWindow || !frame.hasAttribute("srcdoc")) return () => {};
  const parent: Window = parentWindow;
  let disposed = false;
  let nonce: string | null = null;
  let request: NativePreviewViewportRequest | null = null;
  let responsePort: MessagePort | null = null;
  let lastResponse: NativePreviewViewportResponse | null = null;
  let animationFrame = 0;
  let observing = false;
  const observer = new MutationObserver(schedulePublish);
  const resizeObserver = new ResizeObserver(schedulePublish);
  const targetWindow = () => frame.contentWindow;

  function publish(): void {
    animationFrame = 0;
    const target = targetWindow();
    if (disposed || !nonce || !request || !target || !frame.isConnected) return;
    const response = viewportResponse(nonce, request, frame);
    if (
      lastResponse &&
      JSON.stringify(lastResponse) === JSON.stringify(response)
    )
      return;
    lastResponse = response;
    responsePort?.postMessage(response);
  }

  function schedulePublish(): void {
    if (!animationFrame && !disposed)
      animationFrame = parent.requestAnimationFrame(publish);
  }

  function onMessage(event: MessageEvent): void {
    if (
      disposed ||
      frame.sandbox.contains("allow-same-origin") ||
      !isTrustedOpaquePreviewViewportRequest({
        eventSourceIsFrame: event.source === targetWindow(),
        eventOrigin: event.origin,
        hasOneTransferredPort: event.ports.length === 1,
        request: event.data,
      })
    )
      return;
    responsePort?.close();
    responsePort = event.ports[0];
    lastResponse = null;
    nonce = event.data.nonce;
    request = event.data;
    if (!observing) {
      observing = true;
      let observationDepth = 0;
      for (let node: Element | null = frame; node; node = node.parentElement) {
        if (observationDepth++ >= MAX_ANCESTOR_DEPTH) break;
        observer.observe(node, {
          attributes: true,
          attributeFilter: [
            "style",
            "class",
            ...NATIVE_PREVIEW_INSET_ATTRIBUTES,
          ],
        });
        resizeObserver.observe(node);
      }
      parent.addEventListener("scroll", schedulePublish, true);
      parent.addEventListener("resize", schedulePublish);
      parent.visualViewport?.addEventListener("scroll", schedulePublish);
      parent.visualViewport?.addEventListener("resize", schedulePublish);
    }
    schedulePublish();
  }

  parent.addEventListener("message", onMessage);

  return () => {
    disposed = true;
    responsePort?.close();
    responsePort = null;
    parent.removeEventListener("message", onMessage);
    parent.removeEventListener("scroll", schedulePublish, true);
    parent.removeEventListener("resize", schedulePublish);
    parent.visualViewport?.removeEventListener("scroll", schedulePublish);
    parent.visualViewport?.removeEventListener("resize", schedulePublish);
    observer.disconnect();
    resizeObserver.disconnect();
    if (animationFrame) parent.cancelAnimationFrame(animationFrame);
  };
}
