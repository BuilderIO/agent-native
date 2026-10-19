const config = async () => {
  try {
    const m = await import("dotenv");
    m.config();
  } catch {}
};
import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";

import { parseArgs } from "@agent-native/core";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import pLimit from "p-limit";

import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  extractAssetUrls,
  imagePreviewMarkdown,
  stripHtml,
} from "../server/lib/assets-image-delegation.js";
import {
  DEFAULT_STYLE_REFERENCE_URLS,
  normalizeReferenceUrls,
} from "../shared/api.js";
import getDeck from "./get-deck.js";

const MAX_REFERENCE_IMAGE_URLS = 8;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_GENERATED_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

function urlHostLabel(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "unknown host";
  }
}

export function normalizeReferenceImageUrls(urls: readonly string[]) {
  const normalized = normalizeReferenceUrls(urls);
  if (normalized.length > MAX_REFERENCE_IMAGE_URLS) {
    throw new Error(
      `Use no more than ${MAX_REFERENCE_IMAGE_URLS} reference images.`,
    );
  }
  for (const value of normalized) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Reference image URLs must be valid HTTPS URLs.");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw new Error("Reference image URLs must be valid HTTPS URLs.");
    }
  }
  return normalized;
}

async function readBoundedImageBody(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

  const reader = response.body?.getReader();
  if (!reader) {
    const data = Buffer.from(await response.arrayBuffer());
    return data.length > 0 && data.length <= maxBytes ? data : null;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) return null;
  const data = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

export async function fetchReferenceImage(
  url: string,
): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(8_000) },
      { httpsOnly: true, maxRedirects: 2 },
    );
    if (!res.ok) return null;
    const mimeType = (res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!IMAGE_MIME_EXTENSIONS[mimeType]) return null;
    const data = await readBoundedImageBody(res, MAX_REFERENCE_IMAGE_BYTES);
    return data ? { data: data.toString("base64"), mimeType } : null;
  } catch {
    console.warn(`Could not load reference image from ${urlHostLabel(url)}.`);
    return null;
  }
}

async function saveDelegatedImages(
  reply: string,
  outputPrefix: string,
  baseUrl: string,
): Promise<void> {
  const urls = extractAssetUrls(reply, { prefer: "download", baseUrl });
  if (urls.length === 0) {
    console.error(
      `Assets returned no parseable image URL, so nothing was written to ${outputPrefix}.`,
    );
    throw new Error("Script failed");
  }
  mkdirSync(dirname(outputPrefix), { recursive: true });
  let failures = 0;
  for (const [i, url] of urls.entries()) {
    const res = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(30_000) },
      { httpsOnly: true, maxRedirects: 2 },
    ).catch(() => {
      console.error(
        `Could not download generated image from ${urlHostLabel(url)}.`,
      );
      return null;
    });
    if (!res || !res.ok) {
      if (res) {
        console.error(
          `Could not download generated image from ${urlHostLabel(url)} (${res.status}).`,
        );
      }
      failures++;
      continue;
    }
    const mimeType = (res.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const extension = IMAGE_MIME_EXTENSIONS[mimeType];
    if (!extension) {
      console.error(
        `Generated image from ${urlHostLabel(url)} had no supported image type.`,
      );
      failures++;
      continue;
    }
    const data = await readBoundedImageBody(res, MAX_GENERATED_IMAGE_BYTES);
    if (!data) {
      console.error(
        `Generated image from ${urlHostLabel(url)} was empty or exceeded the 10 MB limit.`,
      );
      failures++;
      continue;
    }
    const filePath = `${outputPrefix}-v${i + 1}.${extension}`;
    writeFileSync(filePath, data);
    console.log(`Saved: ${filePath}`);
  }
  if (failures > 0) {
    console.error(
      `${failures} of ${urls.length} generated image(s) could not be saved to ${outputPrefix}.`,
    );
    throw new Error("Script failed");
  }
}

export async function loadDeckContext(
  deckId: string,
  slideId?: string,
  explicitSlideContent?: string,
): Promise<{ slideContent?: string; deckText: string }> {
  const context = {
    caller: "cli" as const,
    actionName: "get-deck",
    appId: "slides-2",
  };
  const deck = await getDeck.run({ deckId, compact: "false" }, context);
  const slides = Array.isArray(deck.slides) ? deck.slides : [];
  let slideContent = explicitSlideContent;

  const textParts: string[] = [
    `Deck: ${typeof deck.title === "string" ? deck.title : deckId}`,
  ];
  for (const [index, slide] of slides.entries()) {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) continue;
    const summary = slide as Record<string, unknown>;
    const currentSlideId =
      typeof summary.id === "string" ? summary.id : `slide ${index + 1}`;
    const content = typeof summary.content === "string" ? summary.content : "";
    const text = stripHtml(content);
    const isCurrent = slideId !== undefined && currentSlideId === slideId;
    if (slideContent === undefined && isCurrent) slideContent = content;
    textParts.push(
      `${isCurrent ? `[CURRENT SLIDE ${currentSlideId}]` : `Slide ${currentSlideId}`}: ${text}`,
    );
  }

  return { slideContent, deckText: textParts.join("\n") };
}

export default async function main(args: string[]) {
  await config();

  const opts = parseArgs(args);

  if (opts["help"]) {
    console.log(`Usage: pnpm action generate-image --prompt "description" [options]

Options:
  --prompt                Image description (required)
  --slide-content         HTML content of the current slide (primary context)
  --deck-id               Deck ID to load full deck text as secondary context
  --slide-id              Slide ID within the deck (highlights current slide)
  --model                 Provider: 'gemini', 'openai', or 'auto' (default: auto)
  --reference-image-urls  Comma-separated URLs of extra reference images
  --count                 Number of variations (default: 1)
  --output                Output file path prefix (files: {prefix}-v1.<type>, etc.)
  --help                  Show this help`);
    return;
  }

  const prompt = opts["prompt"];
  if (!prompt) {
    console.error("Error: --prompt is required");
    throw new Error("Script failed");
  }

  const count = parseInt(opts["count"] || "1", 10);
  const outputPrefix = opts["output"];
  const extraReferenceUrls = normalizeReferenceImageUrls(
    opts["reference-image-urls"] ? opts["reference-image-urls"].split(",") : [],
  );

  let slideContent = opts["slide-content"];
  let deckText = "";

  if (opts["deck-id"]) {
    const deckCtx = await loadDeckContext(
      opts["deck-id"],
      opts["slide-id"],
      slideContent,
    );
    slideContent = deckCtx.slideContent;
    deckText = deckCtx.deckText;
    console.log(`Loaded deck context: ${deckCtx.deckText.length} chars`);
  }

  const delegation = await delegateImageGenerationToAssets({
    prompt,
    count,
    deckId: opts["deck-id"],
    slideId: opts["slide-id"],
    slideContent,
    ...(extraReferenceUrls.length
      ? { referenceImageUrls: extraReferenceUrls }
      : {}),
  });
  if (delegation.status === "delegated") {
    console.log(delegation.reply);
    const previewUrl = extractAssetUrl(delegation.reply, {
      baseUrl: delegation.target,
    });
    if (previewUrl) {
      console.log(
        `\nShow this to the user verbatim so the image renders inline:\n` +
          imagePreviewMarkdown(prompt, previewUrl),
      );
    }
    if (outputPrefix) {
      await saveDelegatedImages(
        delegation.reply,
        outputPrefix,
        delegation.target,
      );
    }
    return;
  }
  if (delegation.status === "pending") {
    console.error(
      `Assets is still generating (task ${delegation.taskId}, last state ` +
        `"${delegation.lastState}"). It was not cancelled — check the Assets ` +
        `app rather than generating a duplicate.`,
    );
    throw new Error("Script failed");
  }
  if (delegation.status === "rejected") {
    console.error(
      `Assets could not generate this image (${delegation.state}): ${delegation.reason}`,
    );
    throw new Error("Script failed");
  }
  console.warn(
    `[slides/generate-image] Assets unavailable (${delegation.reason}); ` +
      `using the local fallback provider — output will not be brand-grounded.`,
  );

  const { getProvider } =
    await import("../server/handlers/image-providers/index.js");
  const modelChoice = opts["model"] || "auto";
  let provider: Awaited<ReturnType<typeof getProvider>>;
  try {
    provider = await getProvider(modelChoice);
  } catch {
    console.error(
      "Error: No image generation provider configured. Save GOOGLE_GENERATIVE_AI_API_KEY or OPENAI_API_KEY in settings.",
    );
    throw new Error("Script failed");
  }

  const context =
    slideContent || deckText ? { slideContent, deckText } : undefined;

  const referenceUrls = normalizeReferenceImageUrls([
    ...DEFAULT_STYLE_REFERENCE_URLS,
    ...extraReferenceUrls,
  ]);
  const refFetchLimit = pLimit(4);
  const refImages = (
    await Promise.all(
      referenceUrls.map((url) =>
        refFetchLimit(async () => {
          console.log(`Loading reference image from ${urlHostLabel(url)}`);
          return fetchReferenceImage(url);
        }),
      ),
    )
  ).filter((r): r is { data: string; mimeType: string } => r !== null);

  console.log(`\nGenerating ${count} image(s) with prompt: "${prompt}"`);
  console.log(
    `Using ${refImages.length} reference image(s) for style matching`,
  );
  if (context) {
    console.log(
      `With context: slide content=${!!slideContent}, deck text=${deckText.length > 0}`,
    );
  }

  if (outputPrefix) {
    mkdirSync(dirname(outputPrefix), { recursive: true });
  }

  const genLimit = pLimit(2);
  const variantResults = await Promise.allSettled(
    Array.from({ length: count }, (_, i) =>
      genLimit(async () => {
        console.log(`\nGenerating variation ${i + 1}/${count}...`);
        const result = await provider.generate(prompt, refImages, context);
        return { i, result };
      }),
    ),
  );

  const generatedFiles: string[] = [];

  for (const settled of variantResults) {
    if (settled.status === "rejected") {
      const err = settled.reason as { message?: string } | undefined;
      console.error(
        `Failed to generate variation: ${err instanceof Error ? err.message : JSON.stringify(err)}`,
      );
      continue;
    }
    const { i, result } = settled.value;
    const mimeType = result.mimeType.split(";")[0].trim().toLowerCase();
    const extension = IMAGE_MIME_EXTENSIONS[mimeType];
    if (!extension) {
      console.error("Image provider returned an unsupported image type.");
      continue;
    }
    if (
      result.imageData.length === 0 ||
      result.imageData.length > MAX_GENERATED_IMAGE_BYTES
    ) {
      console.error("Image provider returned an empty or oversized image.");
      continue;
    }
    if (outputPrefix) {
      const filePath = `${outputPrefix}-v${i + 1}.${extension}`;
      writeFileSync(filePath, result.imageData);
      generatedFiles.push(filePath);
      console.log(
        `Saved: ${filePath} (${Math.round(result.imageData.length / 1024)}KB)`,
      );
    } else {
      const dataUrl = `data:${result.mimeType};base64,${result.imageData.toString("base64")}`;
      console.log(`\nGenerated image ${i + 1}:`);
      console.log(`  MIME type: ${result.mimeType}`);
      console.log(`  Size: ${Math.round(result.imageData.length / 1024)}KB`);
      console.log(
        `  Data URL (first 100 chars): ${dataUrl.substring(0, 100)}...`,
      );
    }
  }

  if (generatedFiles.length > 0) {
    console.log(`\n✓ Generated ${generatedFiles.length} image(s):`);
    for (const f of generatedFiles) {
      console.log(`  ${f}`);
    }
  }

  console.log("\nDone!");
}
