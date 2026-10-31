import { ssrfSafeFetch } from "../../extensions/url-safety.js";
import { sniffAttachmentMediaType } from "../../file-upload/attachment-bytes.js";
import type { EngineMessage, EngineToolResultImagePart } from "./types.js";

const MAX_INLINE_IMAGE_BYTES = 5_000_000;
const FETCH_TIMEOUT_MS = 10_000;

async function fetchAsInlineImage(
  image: EngineToolResultImagePart,
): Promise<EngineToolResultImagePart | null> {
  try {
    const response = await ssrfSafeFetch(
      image.url!,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      { httpsOnly: true },
    );
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INLINE_IMAGE_BYTES) {
      return null;
    }
    const data = bytes.toString("base64");
    const sniffed = sniffAttachmentMediaType(data);
    if (!sniffed || sniffed === "application/pdf") return null;
    return {
      data,
      mediaType: sniffed,
      ...(image.label ? { label: image.label } : {}),
    };
  } catch {
    // coercion-ok: an unfetchable image is dropped; the tool result text still
    // reaches the model, which beats a request the provider rejects outright.
    return null;
  }
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

  const inlined = new Map<string, EngineToolResultImagePart | null>();
  await Promise.all(
    [...urls].map(async (url) => {
      inlined.set(url, await fetchAsInlineImage({ url }));
    }),
  );

  return messages.map((message) => ({
    ...message,
    content: message.content.map((part) => {
      if (part.type !== "tool-result" || !part.images?.length) return part;
      const images = part.images.flatMap((image) => {
        if (!image.url) return [image];
        const resolved = inlined.get(image.url);
        if (!resolved) return [];
        return [
          { ...resolved, ...(image.label ? { label: image.label } : {}) },
        ];
      });
      return { ...part, images };
    }),
  })) as EngineMessage[];
}
