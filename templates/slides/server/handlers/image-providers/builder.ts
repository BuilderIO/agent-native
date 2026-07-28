import {
  getBuilderImageGenerationBaseUrl,
  resolveBuilderCredentials,
} from "@agent-native/core/server";

import type {
  ImageProvider,
  ImageProviderConfig,
  ImageGenerationResult,
  ReferenceImage,
} from "./types.js";

const BUILDER_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const REQUEST_TIMEOUT_MS = 90_000;

interface BuilderImageGenerationResponse {
  id: string;
  model: { publicId: string; provider: string };
  outputs: Array<{ url?: string; downloadUrl?: string; mimeType?: string }>;
}

/**
 * Builder-managed generation lets a deck author with a connected Builder.io
 * account generate images without bringing their own Gemini/OpenAI key —
 * Builder's gateway holds the provider credentials. `isConfigured()` only
 * has env available (sync), so it under-reports until a request can check
 * the per-user/org connection via `isConfiguredForRequest()`.
 */
export class BuilderProvider implements ImageProvider {
  name = "builder";

  isConfigured(): boolean {
    return !!(
      process.env.BUILDER_PRIVATE_KEY && process.env.BUILDER_PUBLIC_KEY
    );
  }

  async isConfiguredForRequest(): Promise<boolean> {
    const creds = await resolveBuilderCredentials();
    return !!(creds.privateKey && creds.publicKey);
  }

  async generate(
    prompt: string,
    referenceImages: ReferenceImage[] = [],
    _context?: { slideContent?: string; deckText?: string },
    config?: ImageProviderConfig,
  ): Promise<ImageGenerationResult> {
    const creds = await resolveBuilderCredentials();
    if (!creds.privateKey || !creds.publicKey) {
      throw new Error(
        "Builder.io is not fully connected for managed image generation.",
      );
    }

    const baseUrl = getBuilderImageGenerationBaseUrl().replace(/\/$/, "");
    const requestBody = {
      idempotencyKey: `slides-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      prompt,
      model: BUILDER_IMAGE_MODEL,
      count: 1,
      aspectRatio: toBuilderAspectRatio(config?.aspectRatio),
      size: "1K",
      outputFormat: config?.outputFormat || "png",
      references: referenceImages.map((ref, i) => ({
        id: `ref-${i}`,
        role: "style",
        mimeType: ref.mimeType,
        data: ref.data,
      })),
      source: { appId: "slides", feature: "generate-image" },
    };

    const response = await fetch(`${baseUrl}/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.privateKey}`,
        "x-builder-api-key": creds.publicKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Builder-managed image generation failed (${response.status})${text ? `: ${text}` : "."}`,
      );
    }

    const body = (await response.json()) as BuilderImageGenerationResponse;
    const output = body.outputs?.[0];
    const sourceUrl = output?.downloadUrl ?? output?.url;
    if (!sourceUrl) {
      throw new Error(
        "Builder-managed image generation returned no image URL.",
      );
    }

    const imageResponse = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imageResponse.ok) {
      throw new Error(
        `Could not download Builder-generated image (${imageResponse.status}).`,
      );
    }

    return {
      imageData: Buffer.from(await imageResponse.arrayBuffer()),
      mimeType:
        output.mimeType ||
        imageResponse.headers.get("content-type") ||
        "image/png",
      model: body.model?.publicId || BUILDER_IMAGE_MODEL,
      provider: "builder",
    };
  }
}

function toBuilderAspectRatio(aspectRatio?: string): string {
  const supported = new Set([
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "9:16",
    "16:9",
    "21:9",
  ]);
  if (aspectRatio && supported.has(aspectRatio)) return aspectRatio;
  if (aspectRatio === "4:5") return "3:4";
  if (aspectRatio === "5:4") return "4:3";
  return "16:9";
}
