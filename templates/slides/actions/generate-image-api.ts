import { defineAction } from "@agent-native/core";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  imagePreviewMarkdown,
} from "../server/lib/assets-image-delegation.js";
import {
  insertImageIntoSlideHtml,
  slideHtmlContainsImageSource,
} from "../server/lib/slide-image-insertion.js";
import {
  DEFAULT_STYLE_REFERENCE_URLS,
  normalizeReferenceUrls,
} from "../shared/api.js";
import getDeckAction from "./get-deck.js";
import updateSlideAction from "./update-slide.js";

interface ReferenceImage {
  data: string; // base64
  mimeType: string;
}

interface DeckSlide {
  id?: string;
  content?: unknown;
}

interface DeckWithSlides {
  slides?: DeckSlide[];
}

async function urlToReferenceImage(
  url: string,
): Promise<ReferenceImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = contentType.split(";")[0].trim();
    return { data: buffer.toString("base64"), mimeType };
  } catch {
    return null;
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
  if (!slide || typeof slide.content !== "string") {
    throw new Error(
      `Slide ${slideId} was not found in deck ${deckId} for image insertion`,
    );
  }

  const fullContent = insertImageIntoSlideHtml(slide.content, imageUrl, {
    alt: prompt,
  });
  const update = await updateSlideAction.run({
    deckId,
    slideId,
    fullContent,
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
    "Generate a slide image. Delegates to the Assets app over A2A so generations use the brand library, presets, and audit log; falls back to a local Gemini/OpenAI key only when Assets is unreachable. Show the returned `url` to the user as an inline markdown image (![alt](url)) so it renders in chat, never as a bare link.",
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
        "Insert the generated image into deckId/slideId and verify it persisted",
      ),
    slideContent: z
      .string()
      .optional()
      .describe("HTML of the target slide, used as generation context"),
    referenceImageUrls: z
      .array(z.string())
      .optional()
      .describe("Style reference URLs to forward to Assets"),
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
        // The reply is the Assets agent's own text. Pass it through verbatim
        // rather than guessing at URLs it did not return.
        reply: delegation.reply,
        ...(url ? { url, showToUser: imagePreviewMarkdown(prompt, url) } : {}),
        ...insertion,
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

    // Assets is unreachable - standalone-deploy fallback. The caller is told
    // which path ran and why, so a brand-inconsistent image is never reported
    // as a library-grounded one.
    const { getProvider } =
      await import("../server/handlers/image-providers/index.js");
    const provider = await getProvider(args.model || "auto");

    const refImages: ReferenceImage[] = [];
    const results = await Promise.all(
      normalizeReferenceUrls([
        ...DEFAULT_STYLE_REFERENCE_URLS,
        ...normalizeReferenceUrls(args.referenceImageUrls),
      ]).map(urlToReferenceImage),
    );
    for (const r of results) {
      if (r) refImages.push(r);
    }

    const result = await provider.generate(prompt, refImages);
    const uploaded = await uploadFile({
      data: result.imageData,
      filename: `slides-generated-${Date.now()}.png`,
      mimeType: result.mimeType,
      ownerEmail: getRequestUserEmail() ?? undefined,
      recordAsset: false,
    });
    if (!uploaded?.url) {
      throw new Error(
        "File storage is not configured. Connect Builder.io (free tier available) or another upload provider before generating slide images.",
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
      source: "slides-fallback" as const,
      fallbackReason: delegation.reason,
      showToUser: imagePreviewMarkdown(prompt, uploaded.url),
      url: uploaded.url,
      model: result.model,
      prompt,
      ...insertion,
    };
  },
});
