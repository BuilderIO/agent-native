import { injectDocumentMarkup } from "@agent-native/core/shared";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import { parseSrcset } from "./private-replay-screenshot-preview";

const READY = "native-public-asset-ready";
const CONNECT = "native-public-asset-connect";
const REQUEST = "native-public-asset-request";
const RESULT = "native-public-asset-result";
const DISPOSE = "native-public-asset-dispose";
const NONCE = /^[A-Za-z0-9_-]{16,80}$/;
const MAX_ASSETS = 128;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_PIXELS = 32_000_000;
const MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const cleanupByFrame = new WeakMap<HTMLIFrameElement, () => void>();

export class NativePublicAssetPreviewError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativePublicAssetPreviewError";
  }
}

export interface NativePublicAssetPreviewDocument {
  html: string;
  urls: readonly string[];
  origin: string;
  nonce: string | null;
}

function imageUrl(raw: string, base: URL): string | null {
  if (!raw || /^(?:data|blob):/i.test(raw) || raw.startsWith("#")) return null;
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    throw new NativePublicAssetPreviewError(
      "source-public-asset-url-invalid",
      "The public image URL is invalid.",
    );
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.origin !== base.origin
  )
    return null;
  return url.href;
}

export function prepareNativePublicAssetPreviewDocument(
  html: string,
  baseHref: string,
): NativePublicAssetPreviewDocument {
  const parentBase = new URL(baseHref);
  if (parentBase.protocol !== "http:" && parentBase.protocol !== "https:")
    throw new NativePublicAssetPreviewError(
      "source-public-asset-origin-invalid",
      "The preview origin is not an HTTP origin.",
    );
  type Node = DefaultTreeAdapterMap["node"];
  const documentNode = parse(html);
  const hasNativeManifest = (node: Node): boolean => {
    if ("tagName" in node && node.tagName.toLowerCase() === "template")
      return false;
    if (
      "tagName" in node &&
      node.tagName.toLowerCase() === "script" &&
      node.attrs.some(
        (attr) =>
          attr.name === "type" &&
          attr.value === "application/x-agent-native-effects",
      )
    )
      return true;
    return "childNodes" in node && node.childNodes.some(hasNativeManifest);
  };
  if (!hasNativeManifest(documentNode))
    return { html, urls: [], origin: parentBase.origin, nonce: null };
  let base = parentBase;
  const findBase = (node: Node): string | null => {
    if ("tagName" in node && node.tagName.toLowerCase() === "base")
      return node.attrs.find((attr) => attr.name === "href")?.value ?? null;
    if ("childNodes" in node)
      for (const child of node.childNodes) {
        const href = findBase(child);
        if (href !== null) return href;
      }
    return null;
  };
  const baseHrefInDocument = findBase(documentNode);
  if (baseHrefInDocument !== null) {
    try {
      base = new URL(baseHrefInDocument, parentBase);
    } catch {
      throw new NativePublicAssetPreviewError(
        "source-public-asset-origin-invalid",
        "The preview base URL is invalid.",
      );
    }
    if (base.origin !== parentBase.origin)
      throw new NativePublicAssetPreviewError(
        "source-public-asset-origin-invalid",
        "The preview base URL is outside its public origin.",
      );
  }
  const urls = new Set<string>();
  const add = (raw: string) => {
    const url = imageUrl(raw, base);
    if (!url) return;
    urls.add(url);
    if (urls.size > MAX_ASSETS)
      throw new NativePublicAssetPreviewError(
        "source-public-asset-count-exceeded",
        "The preview contains too many public images.",
      );
  };
  const addCss = (css: string) => {
    for (const match of css.matchAll(
      /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi,
    ))
      add((match[1] ?? match[2] ?? match[3] ?? "").trim());
  };
  const visit = (node: Node) => {
    if ("attrs" in node) {
      const tag = "tagName" in node ? node.tagName.toLowerCase() : "";
      for (const attr of node.attrs) {
        if (attr.name === "style") addCss(attr.value);
        if ((tag === "img" || tag === "source") && attr.name === "src")
          add(attr.value);
        if ((tag === "img" || tag === "source") && attr.name === "srcset")
          for (const candidate of parseSrcset(attr.value)) add(candidate.url);
      }
      if (tag === "style" && "childNodes" in node)
        for (const child of node.childNodes)
          if ("value" in child) addCss(child.value);
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(documentNode);
  if (!urls.size)
    return { html, urls: [], origin: parentBase.origin, nonce: null };
  const nonce = crypto.randomUUID();
  return {
    html: injectDocumentMarkup(
      html,
      `<meta name="an-native-public-asset-nonce" content="${nonce}">`,
    ),
    urls: [...urls],
    origin: parentBase.origin,
    nonce,
  };
}

async function publicImage(
  url: string,
  signal: AbortSignal,
): Promise<{ blob: Blob; pixels: number }> {
  const response = await fetch(url, {
    credentials: "omit",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal,
  });
  if (
    !response.ok ||
    response.type === "opaque" ||
    new URL(response.url).origin !== new URL(url).origin ||
    new URL(response.url).href !== new URL(url).href.replace(/#.*$/, "")
  )
    throw new NativePublicAssetPreviewError(
      "source-public-asset-unavailable",
      "The public image could not be read without credentials.",
    );
  const mime = response.headers.get("content-type")?.split(";", 1)[0].trim();
  if (!mime || !MIME.has(mime) || !response.body)
    throw new NativePublicAssetPreviewError(
      "source-public-asset-type-invalid",
      "The public image type is unsupported.",
    );
  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new NativePublicAssetPreviewError(
          "source-public-asset-too-large",
          "The public image exceeds the byte limit.",
        );
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const blob = new Blob([bytes.buffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const pixels = bitmap.width * bitmap.height;
  try {
    if (
      bitmap.width <= 0 ||
      bitmap.height <= 0 ||
      bitmap.width > 4096 ||
      bitmap.height > 4096 ||
      pixels > 8_388_608
    )
      throw new NativePublicAssetPreviewError(
        "source-public-asset-too-large",
        "The public image exceeds the pixel limit.",
      );
  } finally {
    bitmap.close();
  }
  return { blob, pixels };
}

export function connectNativePublicAssetPreview(
  frame: HTMLIFrameElement,
  prepared: NativePublicAssetPreviewDocument,
): () => void {
  cleanupByFrame.get(frame)?.();
  if (!prepared.urls.length) return () => undefined;
  const host = frame.ownerDocument.defaultView;
  if (!host)
    throw new NativePublicAssetPreviewError(
      "source-public-asset-host-unavailable",
      "The preview host is unavailable.",
    );
  const abort = new AbortController();
  let channel: MessagePort | null = null;
  const cached = new Map<number, Promise<Blob>>();
  let cachedBytes = 0;
  let cachedPixels = 0;
  let active = 0;
  const waiting: Array<() => void> = [];
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    host.removeEventListener("message", onReady);
    abort.abort();
    for (const wake of waiting.splice(0)) wake();
    channel?.close();
    channel = null;
    cached.clear();
    cleanupByFrame.delete(frame);
  };
  const onReady = (event: MessageEvent) => {
    if (
      closed ||
      !frame.isConnected ||
      frame.srcdoc !== prepared.html ||
      event.source !== frame.contentWindow ||
      event.origin !== "null" ||
      event.data?.type !== READY ||
      typeof event.data?.nonce !== "string" ||
      !NONCE.test(event.data.nonce) ||
      event.data.nonce !== prepared.nonce ||
      event.ports.length !== 1
    )
      return;
    const nonce = event.data.nonce as string;
    if (channel) {
      event.ports[0]?.close();
      return;
    }
    channel = event.ports[0]!;
    const activeChannel = channel;
    activeChannel.onmessage = (message: MessageEvent) => {
      const request = message.data;
      if (request?.type === DISPOSE) {
        cleanup();
        return;
      }
      if (
        closed ||
        !frame.isConnected ||
        frame.srcdoc !== prepared.html ||
        request?.type !== REQUEST ||
        !Number.isSafeInteger(request.requestId) ||
        request.requestId < 1 ||
        !Number.isSafeInteger(request.index) ||
        request.index < 0 ||
        request.index >= prepared.urls.length
      )
        return;
      const send = (result: object) => {
        if (!closed && frame.isConnected && frame.srcdoc === prepared.html)
          activeChannel.postMessage({
            type: RESULT,
            requestId: request.requestId,
            ...result,
          });
      };
      let image = cached.get(request.index);
      if (!image) {
        image = (async () => {
          if (active >= 4)
            await new Promise<void>((resolve) => waiting.push(resolve));
          if (closed)
            throw new NativePublicAssetPreviewError(
              "source-public-asset-disposed",
              "The public image preview closed.",
            );
          active += 1;
          try {
            const requestAbort = new AbortController();
            const cancel = () => requestAbort.abort();
            abort.signal.addEventListener("abort", cancel, { once: true });
            const timeout = setTimeout(cancel, 8_000);
            try {
              return await publicImage(
                prepared.urls[request.index]!,
                requestAbort.signal,
              );
            } finally {
              clearTimeout(timeout);
              abort.signal.removeEventListener("abort", cancel);
            }
          } finally {
            active -= 1;
            waiting.shift()?.();
          }
        })().then(({ blob, pixels }) => {
          const nextPixels = cachedPixels + pixels;
          const nextBytes = cachedBytes + blob.size;
          if (nextPixels > MAX_TOTAL_PIXELS)
            throw new NativePublicAssetPreviewError(
              "source-public-asset-too-large",
              "The preview public images exceed the pixel limit.",
            );
          if (nextBytes > MAX_TOTAL_BYTES)
            throw new NativePublicAssetPreviewError(
              "source-public-asset-too-large",
              "The preview public images exceed the byte limit.",
            );
          cachedBytes = nextBytes;
          cachedPixels = nextPixels;
          return blob;
        });
        cached.set(request.index, image);
        void image.catch(() => {
          if (cached.get(request.index) === image) cached.delete(request.index);
        });
      }
      void image.then(
        (blob) => send({ blob }),
        (error: unknown) => {
          const failure =
            error instanceof NativePublicAssetPreviewError
              ? error
              : new NativePublicAssetPreviewError(
                  "source-public-asset-unavailable",
                  "The public image could not be read.",
                );
          send({ error: { code: failure.code, message: failure.message } });
        },
      );
    };
    activeChannel.start();
    activeChannel.postMessage({ type: CONNECT, nonce, urls: prepared.urls });
  };
  host.addEventListener("message", onReady);
  cleanupByFrame.set(frame, cleanup);
  return cleanup;
}
