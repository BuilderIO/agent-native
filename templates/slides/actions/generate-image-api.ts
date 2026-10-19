import { defineAction, fail } from "@agent-native/core/action";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  imagePreviewMarkdown,
} from "../server/lib/assets-image-delegation.js";
import {
  fetchReferenceImages,
  MAX_REFERENCE_IMAGE_COUNT,
  MAX_REFERENCE_IMAGE_INPUT_COUNT,
} from "../server/lib/reference-image-fetch.js";
import {
  insertImageIntoSlideHtml,
  slideHtmlContainsImageSource,
} from "../server/lib/slide-image-insertion.js";
import {
  DEFAULT_STYLE_REFERENCE_URLS,
  MAX_GEMINI_REFERENCE_IMAGE_COUNT,
  normalizeReferenceUrls,
} from "../shared/api.js";
import getDeckAction from "./get-deck.js";
import updateSlideAction from "./update-slide.js";

interface DeckSlide {
  id?: string;
  content?: unknown;
  contentHash?: unknown;
}

interface DeckWithSlides {
  slides?: DeckSlide[];
}

function parseGeneratedImageUrl(url: string | undefined): string {
  if (!url) {
    throw new Error(
      "Image generation did not return a parseable image URL for insertion",
    );
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return parsed.toString();
  } catch {
    throw new Error(
      "Image generation did not return a parseable image URL for insertion",
    );
  }
}

async function insertGeneratedImage({
  deckId,
  slideId,
  prompt,
  url,
}: {
  deckId: string | undefined;
  slideId: string | undefined;
  prompt: string;
  url: string | undefined;
}): Promise<{ inserted: true; url: string }> {
  if (!deckId || !slideId) {
    throw new Error(
      "deckId and slideId are required when insertIntoSlide is true",
    );
  }

  const imageUrl = parseGeneratedImageUrl(url);
  const deck = (await getDeckAction.run({ id: deckId })) as DeckWithSlides;
  const slide = deck.slides?.find((candidate) => candidate.id === slideId);
  if (
    !slide ||
    typeof slide.content !== "string" ||
    typeof slide.contentHash !== "string"
  ) {
    throw new Error(
      `Slide ${slideId} or its contentHash was not found in deck ${deckId} for image insertion`,
    );
  }

  const fullContent = insertImageIntoSlideHtml(slide.content, imageUrl, {
    alt: prompt,
  });
  const update = await updateSlideAction.run({
    deckId,
    slideId,
    fullContent,
    baseContentHash: slide.contentHash,
    preserveSource: true,
  });
  if (!update.ok || !("applied" in update) || !update.applied) {
    throw new Error(`Image insertion was not applied to slide ${slideId}`);
  }

  const verifiedDeck = (await getDeckAction.run({
    id: deckId,
  })) as DeckWithSlides;
  const verifiedSlide = verifiedDeck.slides?.find(
    (candidate) => candidate.id === slideId,
  );
  if (
    !verifiedSlide ||
    typeof verifiedSlide.content !== "string" ||
    !slideHtmlContainsImageSource(verifiedSlide.content, imageUrl)
  ) {
    throw new Error(
      `Image insertion could not be verified on slide ${slideId}`,
    );
  }

  return { inserted: true, url: imageUrl };
}

export default defineAction({
  description:
    "Generate a slide image locally by default. Set `useBrandLibrary: true` only when the user asks for Assets' brand library or an asset/capability exclusive to Assets is required; this delegates through A2A and falls back locally only when Assets is unreachable. Show the returned `url` as inline markdown (![alt](url)), never as a bare link.",
  schema: z.object({
    prompt: z.string().optional().describe("Image description (required)"),
    useBrandLibrary: z
      .boolean()
      .optional()
      .describe(
        "Set true only for a user-requested Assets brand-library generation or an Assets-exclusive asset/capability; defaults to local image generation",
      ),
    model: z
      .string()
      .optional()
      .describe(
        "Local provider: 'gemini', 'openai', or 'auto' (default: auto)",
      ),
    deckId: z.string().optional().describe("Deck the image is destined for"),
    slideId: z.string().optional().describe("Slide the image is destined for"),
    insertIntoSlide: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Insert the generated image into deckId/slideId and verify it persisted",
      ),
    slideContent: z
      .string()
      .optional()
      .describe("HTML of the target slide, used as generation context"),
    referenceImageUrls: z
      .array(z.string())
      .max(MAX_REFERENCE_IMAGE_INPUT_COUNT)
      .optional()
      .describe(
        `Up to ${MAX_REFERENCE_IMAGE_INPUT_COUNT} style reference URLs; local generation fetches at most ${MAX_REFERENCE_IMAGE_COUNT}, and Gemini submits the first ${MAX_GEMINI_REFERENCE_IMAGE_COUNT} loaded references. Check the returned referenceImages counts for omissions and provider submissions.`,
      ),
  }),
  run: async (args) => {
    const prompt = args.prompt;
    if (!prompt?.trim()) {
      throw new Error("Prompt is required");
    }
    if (args.insertIntoSlide && (!args.deckId || !args.slideId)) {
      throw new Error(
        "deckId and slideId are required when insertIntoSlide is true",
      );
    }

    let assetsUnavailableReason: string | undefined;
    if (args.useBrandLibrary) {
      const delegation = await delegateImageGenerationToAssets({
        prompt,
        deckId: args.deckId,
        slideId: args.slideId,
        slideContent: args.slideContent,
        referenceImageUrls: normalizeReferenceUrls(args.referenceImageUrls),
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
              url: url ?? undefined,
            })
          : {};
        return {
          source: "assets-a2a" as const,
          prompt,
          reply: delegation.reply,
          ...(url
            ? { url, showToUser: imagePreviewMarkdown(prompt, url) }
            : {}),
          ...insertion,
        };
      }

      if (delegation.status === "pending") {
        fail(
          `Assets is still generating (task ${delegation.taskId}, state "${delegation.lastState}"). ` +
            `It was not cancelled - check the Assets app for the result instead of generating again.`,
          { errorCode: "assets_generation_pending", statusCode: 409 },
        );
      }

      if (delegation.status === "rejected") {
        fail(
          `Assets could not generate this image (${delegation.state}): ${delegation.reason}`,
          { errorCode: "assets_generation_rejected", statusCode: 424 },
        );
      }

      assetsUnavailableReason = delegation.reason.trim();
      if (!assetsUnavailableReason) {
        fail(
          "Assets reported that image generation is unavailable without a reason; no local fallback was attempted.",
          {
            errorCode: "assets_unavailability_reason_missing",
            statusCode: 424,
          },
        );
      }
    }

    const { getProvider } =
      await import("../server/handlers/image-providers/index.js");
    const provider = await getProvider(args.model || "auto");

    const referenceUrls = normalizeReferenceUrls([
      ...DEFAULT_STYLE_REFERENCE_URLS,
      ...normalizeReferenceUrls(args.referenceImageUrls),
    ]);
    const referenceBatch = await fetchReferenceImages(referenceUrls);
    const refImages = referenceBatch.images.map(({ data, mimeType }) => ({
      data,
      mimeType,
    }));

    const context = args.slideContent
      ? { slideContent: args.slideContent }
      : undefined;
    const result = await provider.generate(prompt, refImages, context);
    const uploaded = await uploadFile({
      data: result.imageData,
      filename: `slides-generated-${Date.now()}.png`,
      mimeType: result.mimeType,
      ownerEmail: getRequestUserEmail() ?? undefined,
      recordAsset: false,
    });
    if (!uploaded?.url) {
      fail(
        "No object storage is connected. Use Builder.io (free) or configure your own S3-compatible storage keys in Settings → File uploads before generating slide images.",
        { errorCode: "object_storage_unavailable", statusCode: 424 },
      );
    }

    const insertion = args.insertIntoSlide
      ? await insertGeneratedImage({
          deckId: args.deckId,
          slideId: args.slideId,
          prompt,
          url: uploaded.url,
        })
      : {};

    return {
      source: assetsUnavailableReason ? "slides-fallback" : "slides-local",
      ...(assetsUnavailableReason
        ? { fallbackReason: assetsUnavailableReason }
        : {}),
      showToUser: imagePreviewMarkdown(prompt, uploaded.url),
      url: uploaded.url,
      model: result.model,
      provider: result.provider,
      prompt,
      referenceImages: {
        requested: referenceBatch.requested,
        attempted: referenceBatch.attempted,
        loaded: referenceBatch.loaded,
        submittedToProvider:
          result.referenceImagesSubmitted ?? refImages.length,
        failed: referenceBatch.failed,
        skipped: referenceBatch.skipped,
        bytesLoaded: referenceBatch.totalBytes,
        failures: referenceBatch.failures,
        skippedReasons: referenceBatch.skippedReasons,
      },
      ...insertion,
    };
  },
});
