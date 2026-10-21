import { trustedOpaquePreviewParentOrigin } from "./native-preview-viewport-transport";

const READY = "native-public-asset-ready";
const CONNECT = "native-public-asset-connect";
const REQUEST = "native-public-asset-request";
const RESULT = "native-public-asset-result";
const DISPOSE = "native-public-asset-dispose";
const NONCE = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_ASSETS = 128;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;

export class NativeOpaquePublicAssetError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeOpaquePublicAssetError";
  }
}

interface AssetResult {
  type: typeof RESULT;
  requestId: number;
  blob?: Blob;
  error?: { code: string; message: string };
}

let connection: Promise<void> | null = null;
let cancelConnection: (() => void) | null = null;
let closed = false;
let port: MessagePort | null = null;
let allowedUrls: string[] = [];
let nextRequestId = 0;
const pending = new Map<
  number,
  { resolve: (blob: Blob) => void; reject: (error: Error) => void }
>();
const objectUrls = new Map<string, Promise<string>>();
const decodedImages = new Map<string, Promise<HTMLImageElement>>();

export function isOpaquePublicAssetPreview(): boolean {
  if (location.origin !== "null") return false;
  try {
    return window.frameElement === null;
  } catch {
    return true;
  }
}

export function opaquePublicAssetUrl(raw: string): string {
  if (/^(?:data|blob):/i.test(raw)) return raw;
  let url: URL;
  try {
    try {
      url = new URL(raw);
    } catch {
      const base = document.baseURI;
      url = new URL(
        raw,
        /^https?:$/.test(new URL(base).protocol) ? base : document.referrer,
      );
    }
  } catch {
    throw new NativeOpaquePublicAssetError(
      "source-public-asset-url-invalid",
      "The public image URL is invalid.",
    );
  }
  const origin = trustedOpaquePreviewParentOrigin(document.referrer);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== origin
  )
    throw new NativeOpaquePublicAssetError(
      "source-public-asset-denied",
      "The image is outside the public preview origin.",
    );
  return url.href;
}

function ensureConnection(): Promise<void> {
  if (closed)
    return Promise.reject(
      new NativeOpaquePublicAssetError(
        "source-public-asset-disposed",
        "The public image channel closed.",
      ),
    );
  if (port) return Promise.resolve();
  if (connection) return connection;
  connection = new Promise<void>((resolve, reject) => {
    const nonce = document.querySelector<HTMLMetaElement>(
      'meta[name="an-native-public-asset-nonce"]',
    )?.content;
    if (!nonce || !NONCE.test(nonce)) {
      reject(
        new NativeOpaquePublicAssetError(
          "source-public-asset-unavailable",
          "The preview asset channel has no trusted document nonce.",
        ),
      );
      return;
    }
    const origin = trustedOpaquePreviewParentOrigin(document.referrer);
    let finished = false;
    const candidates = new Set<MessagePort>();
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      cancelConnection = null;
      clearInterval(retry);
      clearTimeout(timeout);
      for (const candidate of candidates) {
        if (candidate !== port) candidate.close();
      }
      candidates.clear();
      if (error) reject(error);
      else resolve();
    };
    const onConnect = (event: MessageEvent, candidatePort: MessagePort) => {
      if (finished || closed) return;
      if (
        event.data?.type !== CONNECT ||
        event.data?.nonce !== nonce ||
        !NONCE.test(nonce) ||
        !Array.isArray(event.data?.urls) ||
        event.data.urls.length > MAX_ASSETS
      )
        return;
      const urls = event.data.urls as unknown[];
      try {
        if (
          urls.some(
            (url) =>
              typeof url !== "string" ||
              url.length > 4096 ||
              opaquePublicAssetUrl(url) !== url,
          )
        )
          return;
      } catch {
        return;
      }
      allowedUrls = urls as string[];
      port = candidatePort;
      port.onmessage = onResult;
      port.start();
      finish();
    };
    const sendReady = () => {
      if (finished || closed) return;
      const channel = new MessageChannel();
      candidates.add(channel.port1);
      channel.port1.onmessage = (event) => onConnect(event, channel.port1);
      channel.port1.start();
      try {
        window.parent.postMessage({ type: READY, nonce }, origin, [
          channel.port2,
        ]);
      } catch {
        channel.port2.close();
        finish(
          new NativeOpaquePublicAssetError(
            "source-public-asset-unavailable",
            "The public image channel could not contact its parent.",
          ),
        );
      }
    };
    const retry = setInterval(sendReady, 250);
    const timeout = setTimeout(
      () =>
        finish(
          new NativeOpaquePublicAssetError(
            "source-public-asset-unavailable",
            "The public image channel did not connect.",
          ),
        ),
      8_000,
    );
    cancelConnection = () =>
      finish(
        new NativeOpaquePublicAssetError(
          "source-public-asset-disposed",
          "The public image channel closed.",
        ),
      );
    sendReady();
  }).catch((error: unknown) => {
    connection = null;
    throw error;
  });
  return connection;
}

function onResult(event: MessageEvent<AssetResult>): void {
  const result = event.data;
  if (result?.type !== RESULT || !Number.isSafeInteger(result.requestId))
    return;
  const request = pending.get(result.requestId);
  if (!request) return;
  pending.delete(result.requestId);
  if (result.error) {
    request.reject(
      new NativeOpaquePublicAssetError(result.error.code, result.error.message),
    );
    return;
  }
  if (
    !(result.blob instanceof Blob) ||
    result.blob.size <= 0 ||
    result.blob.size > MAX_IMAGE_BYTES ||
    !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(
      result.blob.type,
    )
  ) {
    request.reject(
      new NativeOpaquePublicAssetError(
        "source-public-asset-invalid",
        "The public image response is invalid.",
      ),
    );
    return;
  }
  request.resolve(result.blob);
}

export function resolveOpaquePublicAsset(
  raw: string,
): string | Promise<string> {
  if (!isOpaquePublicAssetPreview()) return raw;
  if (closed)
    throw new NativeOpaquePublicAssetError(
      "source-public-asset-disposed",
      "The public image channel closed.",
    );
  const url = opaquePublicAssetUrl(raw);
  if (/^(?:data|blob):/i.test(url)) return url;
  const cached = objectUrls.get(url);
  if (cached) return cached;
  const result = ensureConnection().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const index = allowedUrls.indexOf(url);
        if (index < 0 || !port) {
          reject(
            new NativeOpaquePublicAssetError(
              "source-public-asset-denied",
              "The image was not in the prepared preview.",
            ),
          );
          return;
        }
        const requestId = ++nextRequestId;
        const timeout = setTimeout(() => {
          pending.delete(requestId);
          reject(
            new NativeOpaquePublicAssetError(
              "source-public-asset-timeout",
              "The public image request timed out.",
            ),
          );
        }, 8_000);
        pending.set(requestId, {
          resolve: (blob) => {
            clearTimeout(timeout);
            resolve(URL.createObjectURL(blob));
          },
          reject: (error) => {
            clearTimeout(timeout);
            reject(error);
          },
        });
        port.postMessage({ type: REQUEST, requestId, index });
      }),
  );
  objectUrls.set(url, result);
  result.catch(() => objectUrls.delete(url));
  return result;
}

export function resolveOpaquePublicImage(
  element: HTMLImageElement,
  raw: string,
): HTMLImageElement | Promise<HTMLImageElement> {
  if (!isOpaquePublicAssetPreview() || /^(?:data|blob):/i.test(raw))
    return element;
  const url = opaquePublicAssetUrl(raw);
  const cached = decodedImages.get(url);
  if (cached) return cached;
  const result = Promise.resolve(resolveOpaquePublicAsset(url)).then(
    async (localUrl) => {
      const image = new Image();
      image.src = localUrl;
      await image.decode();
      return image;
    },
  );
  decodedImages.set(url, result);
  result.catch(() => decodedImages.delete(url));
  return result;
}

export function closeOpaquePublicAssets(): void {
  closed = true;
  cancelConnection?.();
  port?.postMessage({ type: DISPOSE });
  port?.close();
  port = null;
  for (const request of pending.values())
    request.reject(
      new NativeOpaquePublicAssetError(
        "source-public-asset-disposed",
        "The public image channel closed.",
      ),
    );
  pending.clear();
  for (const asset of objectUrls.values())
    void asset.then(
      (url) => URL.revokeObjectURL(url),
      () => undefined,
    );
  objectUrls.clear();
  decodedImages.clear();
  allowedUrls = [];
  connection = null;
}

if (typeof window !== "undefined")
  window.addEventListener("pagehide", closeOpaquePublicAssets, { once: true });
