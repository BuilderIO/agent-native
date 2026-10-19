import { defineAction, fail } from "@agent-native/core/action";
import { ssrfSafeFetch } from "@agent-native/core/extensions/url-safety";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestOrgId } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  MAX_ASSET_FILE_SIZE,
  uploadImageAsset,
} from "../server/handlers/assets.js";
import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  imagePreviewMarkdown,
} from "../server/lib/assets-image-delegation.js";
import {
  insertImageIntoSlideHtml,
  slideHtmlContainsImageSource,
} from "../server/lib/slide-image-insertion.js";
import { findSlideImageInsertionTarget } from "../server/lib/slide-source-editing/image-target.js";
import {
  DEFAULT_STYLE_REFERENCE_URLS,
  normalizeReferenceUrls,
} from "../shared/api.js";
import getDeckAction from "./get-deck.js";
import getSlideSourceAction from "./get-slide-source.js";
import updateSlideSourceAction from "./update-slide-source.js";
import updateSlideAction from "./update-slide.js";

interface ReferenceImage {
  data: string;
  mimeType: string;
}

interface DeckSlide {
  id?: string;
  content?: unknown;
  contentHash?: unknown;
  sourceTsx?: unknown;
}

interface DeckWithSlides {
  slides?: DeckSlide[];
}

const MAX_REFERENCE_IMAGE_URLS = 8;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const referenceImageUrlSchema = z
  .string()
  .max(4_096)
  .transform((value) => value.trim())
  .refine(
    (value) => value.length === 0 || isSafeReferenceImageUrl(value),
    "Use an HTTPS image URL.",
  );

type GeneratedImageInput =
  | { kind: "url"; url: string }
  | { kind: "bytes"; data: Uint8Array; mimeType: string };

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/x-icon": "ico",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

async function urlToReferenceImage(
  url: string,
): Promise<ReferenceImage | null> {
  try {
    const res = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(15_000) },
      { httpsOnly: true, maxRedirects: 2 },
    );
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "";
    const mimeType = contentType.split(";")[0].trim().toLowerCase();
    if (!IMAGE_MIME_EXTENSIONS[mimeType]) return null;
    const data = await readImageResponse(res, MAX_REFERENCE_IMAGE_BYTES);
    return { data: data.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

function isSafeReferenceImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function parseGeneratedImageUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "Image generation did not return a parseable image URL for insertion",
    );
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new Error("unsupported URL");
    }
    return parsed.toString();
  } catch {
    throw new Error(
      "Image generation did not return a parseable image URL for insertion (HTTPS required)",
    );
  }
}

async function readImageResponse(
  response: Response,
  maxBytes = MAX_ASSET_FILE_SIZE,
): Promise<Buffer> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error("Generated image is too large to add to this deck.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length === 0 || data.length > maxBytes) {
      throw new Error("Generated image is empty or exceeds the 10 MB limit.");
    }
    return data;
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
        throw new Error("Generated image exceeds the 10 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (size === 0) throw new Error("Generated image is empty.");
  const data = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

async function registerGeneratedImage({
  deckId,
  input,
}: {
  deckId: string;
  input: GeneratedImageInput;
}) {
  let data: Buffer;
  let mimeType: string;

  if (input.kind === "url") {
    const url = parseGeneratedImageUrl(input.url);
    const response = await ssrfSafeFetch(
      url,
      { signal: AbortSignal.timeout(30_000) },
      { httpsOnly: true, maxRedirects: 2 },
    );
    if (!response.ok) {
      throw new Error(
        `Could not download the selected image (HTTP ${response.status}).`,
      );
    }
    mimeType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!IMAGE_MIME_EXTENSIONS[mimeType]) {
      throw new Error(
        "The selected URL did not return a supported image type.",
      );
    }
    data = await readImageResponse(response);
  } else {
    data = Buffer.from(input.data);
    mimeType = input.mimeType.split(";")[0].trim().toLowerCase();
    if (!IMAGE_MIME_EXTENSIONS[mimeType]) {
      throw new Error("The generated image has an unsupported image type.");
    }
    if (data.length === 0 || data.length > MAX_ASSET_FILE_SIZE) {
      throw new Error("Generated image is empty or exceeds the 10 MB limit.");
    }
  }

  const email = getRequestUserEmail();
  if (!email)
    throw new Error("An authenticated user is required to add an image.");
  const asset = await uploadImageAsset({
    email,
    orgId: getRequestOrgId(),
    deckId,
    originalName: `slides-generated-${Date.now()}.${IMAGE_MIME_EXTENSIONS[mimeType]}`,
    data,
    type: mimeType,
  });
  if (!asset.id || !asset.url) {
    throw new Error(
      "The generated image was uploaded without an asset handle.",
    );
  }
  return asset;
}

async function insertGeneratedImage({
  deckId,
  slideId,
  prompt,
  input,
}: {
  deckId: string | undefined;
  slideId: string | undefined;
  prompt: string;
  input: GeneratedImageInput;
}): Promise<{
  inserted: true;
  url: string;
  assetId: string;
  revision?: number;
  sourceHash?: string;
}> {
  if (!deckId || !slideId) {
    throw new Error(
      "deckId and slideId are required when insertIntoSlide is true",
    );
  }
  if (input.kind === "url") {
    input = { ...input, url: parseGeneratedImageUrl(input.url) };
  }

  const deck = (await getDeckAction.run({
    id: deckId,
    slideId,
    compact: "false",
  })) as DeckWithSlides;
  const slide = deck.slides?.find((candidate) => candidate.id === slideId);
  if (!slide) {
    throw new Error(`Slide ${slideId} was not found in deck ${deckId}.`);
  }

  let sourceSnapshot:
    | Awaited<ReturnType<typeof getSlideSourceAction.run>>
    | undefined;
  let imageTarget: ReturnType<typeof findSlideImageInsertionTarget> | undefined;
  if (typeof slide.sourceTsx === "string") {
    sourceSnapshot = await getSlideSourceAction.run({ deckId, slideId });
    imageTarget = findSlideImageInsertionTarget(sourceSnapshot.slide.sourceTsx);
  } else if (
    typeof slide.content !== "string" ||
    typeof slide.contentHash !== "string"
  ) {
    throw new Error(
      `Slide ${slideId} does not have readable content for image insertion.`,
    );
  }

  const asset = await registerGeneratedImage({ deckId, input });

  if (sourceSnapshot) {
    if (!imageTarget) {
      throw new Error(
        `Slide ${slideId} has source but no safe image insertion target.`,
      );
    }
    const operation =
      imageTarget.operation === "replace-placeholder-with-image"
        ? {
            kind: "replace-placeholder-with-image" as const,
            assetId: asset.id,
          }
        : {
            kind: "insert-image-asset" as const,
            assetId: asset.id,
            alt: prompt.slice(0, 2_000),
          };
    const update = await updateSlideSourceAction.run({
      deckId,
      slideId,
      expectedRevision: sourceSnapshot.slide.revision,
      expectedSourceHash: sourceSnapshot.slide.sourceHash,
      edits: [
        {
          line: imageTarget.line,
          column: imageTarget.column,
          ops: [operation],
        },
      ],
    });
    const verified = await getSlideSourceAction.run({ deckId, slideId });
    const assetRef = `asset://${asset.id}`;
    if (
      verified.slide.revision !== update.revision ||
      verified.slide.sourceHash !== update.sourceHash ||
      !verified.slide.sourceTsx.includes(assetRef)
    ) {
      throw new Error(
        `Image source update could not be verified on slide ${slideId}.`,
      );
    }
    return {
      inserted: true,
      url: asset.url,
      assetId: asset.id,
      revision: verified.slide.revision,
      sourceHash: verified.slide.sourceHash,
    };
  }

  const fullContent = insertImageIntoSlideHtml(
    slide.content as string,
    asset.url,
    {
      alt: prompt,
    },
  );
  const update = await updateSlideAction.run({
    deckId,
    slideId,
    fullContent,
    baseContentHash: slide.contentHash as string,
    preserveSource: true,
  });
  if (!update.ok || !("applied" in update) || !update.applied) {
    throw new Error(`Image insertion was not applied to slide ${slideId}.`);
  }

  const verifiedDeck = (await getDeckAction.run({
    id: deckId,
    slideId,
    compact: "false",
  })) as DeckWithSlides;
  const verifiedSlide = verifiedDeck.slides?.find(
    (candidate) => candidate.id === slideId,
  );
  if (
    !verifiedSlide ||
    typeof verifiedSlide.content !== "string" ||
    !slideHtmlContainsImageSource(verifiedSlide.content, asset.url)
  ) {
    throw new Error(
      `Image insertion could not be verified on slide ${slideId}.`,
    );
  }

  return { inserted: true, url: asset.url, assetId: asset.id };
}

export default defineAction({
  description:
    "Generate a slide image through the Assets agent or import a previously generated preview. For insertion, register it as a deck asset and update source-backed slides with revision-checked source edits. Show the returned `url` to the user as an inline markdown image (![alt](url)) so it renders in chat, never as a bare link.",
  schema: z.object({
    prompt: z.string().optional().describe("Image description (required)"),
    model: z
      .string()
      .optional()
      .describe(
        "Fallback provider used only when Assets is unreachable: 'gemini', 'openai', or 'auto' (default: auto)",
      ),
    deckId: z.string().optional().describe("Deck the image is destined for"),
    slideId: z.string().optional().describe("Slide the image is destined for"),
    insertIntoSlide: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Register the image and insert it into deckId/slideId; source-backed slides use revision-checked source edits",
      ),
    generatedImageUrl: z
      .string()
      .max(4_096)
      .optional()
      .describe(
        "Previously generated or user-provided HTTPS image URL to import after selection; requires insertIntoSlide",
      ),
    slideContent: z
      .string()
      .optional()
      .describe("HTML of the target slide, used as generation context"),
    referenceImageUrls: z
      .array(referenceImageUrlSchema)
      .max(MAX_REFERENCE_IMAGE_URLS)
      .transform(normalizeReferenceUrls)
      .optional()
      .describe("Style reference URLs to forward to Assets"),
  }),
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  run: async (args) => {
    const prompt = args.prompt;
    if (!prompt?.trim()) {
      throw new Error("Prompt is required");
    }
    const referenceImageUrls = normalizeReferenceUrls(args.referenceImageUrls);
    if (
      referenceImageUrls.length > MAX_REFERENCE_IMAGE_URLS ||
      referenceImageUrls.some((url) => !isSafeReferenceImageUrl(url))
    ) {
      fail("Use up to 8 HTTPS reference image URLs without credentials.", {
        errorCode: "invalid_reference_image_urls",
        statusCode: 400,
      });
    }
    if (args.insertIntoSlide && (!args.deckId || !args.slideId)) {
      throw new Error(
        "deckId and slideId are required when insertIntoSlide is true",
      );
    }
    if (args.insertIntoSlide && args.deckId) {
      await assertAccess("deck", args.deckId, "editor");
    }
    if (args.generatedImageUrl) {
      if (!args.insertIntoSlide) {
        throw new Error(
          "generatedImageUrl can only be used with insertIntoSlide: true",
        );
      }
      const insertion = await insertGeneratedImage({
        deckId: args.deckId,
        slideId: args.slideId,
        prompt,
        input: { kind: "url", url: args.generatedImageUrl },
      });
      return {
        source: "selected-preview" as const,
        prompt,
        showToUser: imagePreviewMarkdown(prompt, insertion.url),
        ...insertion,
      };
    }

    const delegation = await delegateImageGenerationToAssets({
      prompt,
      deckId: args.deckId,
      slideId: args.slideId,
      slideContent: args.slideContent,
      referenceImageUrls,
    });

    if (delegation.status === "delegated") {
      const url = extractAssetUrl(delegation.reply, {
        baseUrl: delegation.target,
      });
      const insertion = args.insertIntoSlide
        ? await insertGeneratedImage({
            deckId: args.deckId,
            slideId: args.slideId,
            prompt,
            input: { kind: "url", url: url ?? "" },
          })
        : null;
      const previewUrl = insertion?.url ?? url;
      return {
        source: "assets-a2a" as const,
        prompt,
        reply: delegation.reply,
        ...(insertion
          ? {
              ...insertion,
              showToUser: imagePreviewMarkdown(prompt, insertion.url),
            }
          : previewUrl
            ? {
                url: previewUrl,
                showToUser: imagePreviewMarkdown(prompt, previewUrl),
              }
            : {}),
      };
    }

    if (delegation.status === "pending") {
      throw new Error(
        `Assets is still generating (task ${delegation.taskId}, state "${delegation.lastState}"). ` +
          `It was not cancelled - check the Assets app for the result instead of generating again.`,
      );
    }

    if (delegation.status === "rejected") {
      throw new Error(
        `Assets could not generate this image (${delegation.state}): ${delegation.reason}`,
      );
    }

    const { getProvider } =
      await import("../server/handlers/image-providers/index.js");
    const provider = await getProvider(args.model || "auto");

    const refImages: ReferenceImage[] = [];
    const referenceUrls = normalizeReferenceUrls([
      ...DEFAULT_STYLE_REFERENCE_URLS,
      ...referenceImageUrls,
    ]);
    if (
      referenceUrls.length > MAX_REFERENCE_IMAGE_URLS ||
      referenceUrls.some((url) => !isSafeReferenceImageUrl(url))
    ) {
      fail("Use up to 8 HTTPS reference image URLs without credentials.", {
        errorCode: "invalid_reference_image_urls",
        statusCode: 400,
      });
    }
    const results = await Promise.all(referenceUrls.map(urlToReferenceImage));
    for (const r of results) {
      if (r) refImages.push(r);
    }

    const result = await provider.generate(prompt, refImages);
    if (args.insertIntoSlide) {
      const insertion = await insertGeneratedImage({
        deckId: args.deckId,
        slideId: args.slideId,
        prompt,
        input: {
          kind: "bytes",
          data: result.imageData,
          mimeType: result.mimeType,
        },
      });
      return {
        source: "slides-fallback" as const,
        fallbackReason: delegation.reason,
        showToUser: imagePreviewMarkdown(prompt, insertion.url),
        model: result.model,
        prompt,
        ...insertion,
      };
    }

    const mimeType = result.mimeType.split(";")[0].trim().toLowerCase();
    const extension = IMAGE_MIME_EXTENSIONS[mimeType];
    if (!extension) {
      fail("The generated image has an unsupported image type.", {
        errorCode: "image_generation_invalid_type",
        statusCode: 502,
      });
    }
    if (
      result.imageData.length === 0 ||
      result.imageData.length > MAX_ASSET_FILE_SIZE
    ) {
      fail("Generated image is empty or exceeds the 10 MB limit.", {
        errorCode: "image_generation_invalid_size",
        statusCode: 502,
      });
    }

    const uploaded = await uploadFile({
      data: result.imageData,
      filename: `slides-generated-${Date.now()}.${extension}`,
      mimeType,
      ownerEmail: getRequestUserEmail() ?? undefined,
      recordAsset: false,
    });
    if (!uploaded?.url) {
      fail(
        "No object storage is connected. Use Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads before generating slide images.",
        { errorCode: "object_storage_unavailable", statusCode: 424 },
      );
    }

    return {
      source: "slides-fallback" as const,
      fallbackReason: delegation.reason,
      showToUser: imagePreviewMarkdown(prompt, uploaded.url),
      url: uploaded.url,
      model: result.model,
      prompt,
    };
  },
});
