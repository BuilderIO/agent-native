import { defineAction } from "@agent-native/core";
import { uploadFile } from "@agent-native/core/file-upload";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  delegateImageGenerationToAssets,
  extractAssetUrl,
  imagePreviewMarkdown,
} from "../server/lib/assets-image-delegation.js";
import { DEFAULT_STYLE_REFERENCE_URLS } from "../shared/api.js";

interface ReferenceImage {
  data: string; // base64
  mimeType: string;
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
    slideContent: z
      .string()
      .optional()
      .describe("HTML of the target slide, used as generation context"),
  }),
  run: async (args) => {
    const prompt = args.prompt;
    if (!prompt?.trim()) {
      throw new Error("Prompt is required");
    }

    const delegation = await delegateImageGenerationToAssets({
      prompt,
      deckId: args.deckId,
      slideId: args.slideId,
      slideContent: args.slideContent,
    });

    if (delegation.status === "delegated") {
      const url = extractAssetUrl(delegation.reply, {
        baseUrl: delegation.target,
      });
      return {
        source: "assets-a2a" as const,
        prompt,
        // The reply is the Assets agent's own text. Pass it through verbatim
        // rather than guessing at URLs it did not return.
        reply: delegation.reply,
        ...(url ? { url, showToUser: imagePreviewMarkdown(prompt, url) } : {}),
      };
    }

    if (delegation.status === "pending") {
      throw new Error(
        `Assets is still generating (task ${delegation.taskId}, state "${delegation.lastState}"). ` +
          `It was not cancelled — check the Assets app for the result instead of generating again.`,
      );
    }

    if (delegation.status === "rejected") {
      throw new Error(
        `Assets could not generate this image (${delegation.state}): ${delegation.reason}`,
      );
    }

    // Assets is unreachable — standalone-deploy fallback. The caller is told
    // which path ran and why, so a brand-inconsistent image is never reported
    // as a library-grounded one.
    const { getProvider } =
      await import("../server/handlers/image-providers/index.js");
    const provider = await getProvider(args.model || "auto");

    const refImages: ReferenceImage[] = [];
    const results = await Promise.all(
      DEFAULT_STYLE_REFERENCE_URLS.map(urlToReferenceImage),
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
        "File storage is not configured. Connect Builder.io or another upload provider before generating slide images.",
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
