import { ssrfSafeFetch } from "../../extensions/url-safety.js";
import { reconcileImageBytes } from "../../file-upload/attachment-bytes.js";
import type { EngineMessage, EngineToolResultImagePart } from "./types.js";

const MAX_INLINE_IMAGE_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_CONCURRENCY = 4;
const CACHE_MAX_BYTES = 32_000_000;
const MAX_IMAGES_PER_REQUEST = 8;
const MAX_REQUEST_IMAGE_BYTES = 20_000_000;

// Bytes of successfully inlined images, so history screenshots are not
// re-downloaded on every dispatch. Failures are never cached.
const inlineCache = new Map<string, EngineToolResultImagePart>();

function cacheInlined(url: string, image: EngineToolResultImagePart) {
  inlineCache.delete(url);
  inlineCache.set(url, image);
  let retained = 0;
  for (const entry of inlineCache.values()) retained += entry.data?.length ?? 0;
  for (const key of inlineCache.keys()) {
    if (retained <= CACHE_MAX_BYTES) break;
    retained -= inlineCache.get(key)?.data?.length ?? 0;
    inlineCache.delete(key);
  }
}

async function readCapped(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_INLINE_IMAGE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_INLINE_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return total === 0 ? null : Buffer.concat(chunks);
}

async function fetchAsInlineImage(
  url: string,
): Promise<EngineToolResultImagePart | null> {
  const cached = inlineCache.get(url);
  if (cached) return cached;
  try {
    const response = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      { httpsOnly: true },
    );
    if (!response.ok) return null;
    const bytes = await readCapped(response);
    if (!bytes) return null;
    const data = bytes.toString("base64");
    const verdict = reconcileImageBytes({ base64: data, declared: "image" });
    if (verdict.kind !== "ok") return null;
    const inlined = { data, mediaType: verdict.mediaType };
    cacheInlined(url, inlined);
    return inlined;
  } catch {
    // coercion-ok: an unfetchable image is dropped and flagged in the tool
    // result text, which beats a request the provider rejects outright.
    return null;
  }
}

async function fetchAll(urls: string[]) {
  const results = new Map<string, EngineToolResultImagePart | null>();
  let next = 0;
  const worker = async () => {
    for (let url = urls[next++]; url; url = urls[next++]) {
      results.set(url, await fetchAsInlineImage(url));
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(FETCH_CONCURRENCY, urls.length) }, worker),
  );
  return results;
}

// Claude on Vertex rejects `source.type: "url"` images with an opaque
// invalid_request, so the gateway lane must send bytes.
export async function inlineToolResultImageUrls(
  messages: EngineMessage[],
): Promise<EngineMessage[]> {
  const urls = new Set<string>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      for (const image of part.images ?? []) {
        if (image.url) urls.add(image.url);
      }
    }
  }
  if (urls.size === 0) return messages;

  // Newest images first: older history screenshots are dropped once the
  // per-request count or byte budget is spent.
  const newestFirst = [...urls].reverse().slice(0, MAX_IMAGES_PER_REQUEST);
  const fetched = await fetchAll(newestFirst);
  const inlined = new Map<string, EngineToolResultImagePart | null>();
  let budget = MAX_REQUEST_IMAGE_BYTES;
  for (const url of newestFirst) {
    const image = fetched.get(url);
    const size = image?.data?.length ?? 0;
    if (image && size <= budget) {
      budget -= size;
      inlined.set(url, image);
    }
  }

  return messages.map((message) => ({
    ...message,
    content: message.content.map((part) => {
      if (part.type !== "tool-result" || !part.images?.length) return part;
      let dropped = 0;
      const images = part.images.flatMap((image) => {
        if (!image.url) return [image];
        const resolved = inlined.get(image.url);
        if (!resolved) {
          dropped++;
          return [];
        }
        return [
          { ...resolved, ...(image.label ? { label: image.label } : {}) },
        ];
      });
      const content = dropped
        ? `${part.content}\n[${dropped} image${dropped === 1 ? "" : "s"} from this tool result could not be loaded and ${dropped === 1 ? "is" : "are"} omitted]`
        : part.content;
      return { ...part, images, content };
    }),
  })) as EngineMessage[];
}
