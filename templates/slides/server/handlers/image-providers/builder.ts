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

const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3_000;

// "auto" lets Builder pick a model (normally Gemini, which supports the
// style reference images). Some connected Google Cloud projects don't have
// Vertex AI access to any Gemini image publisher model, which surfaces as a
// 404/400 from Builder's gateway regardless of retries — that's a project
// access problem, not a transient one, so fall back to Builder's OpenAI path
// instead of failing the whole request.
const MODEL_FALLBACK_CHAIN = ["auto", "gpt-image-1"];

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
    const references = referenceImages.map((ref, i) => ({
      id: `ref-${i}`,
      role: "style",
      mimeType: ref.mimeType,
      data: ref.data,
    }));

    let lastError: Error = new Error(
      "Builder-managed image generation failed.",
    );

    for (const model of MODEL_FALLBACK_CHAIN) {
      const outcome = await requestModel({
        baseUrl,
        privateKey: creds.privateKey,
        publicKey: creds.publicKey,
        model,
        prompt,
        references,
        config,
      });
      if (outcome.kind === "success") return outcome.result;
      lastError = outcome.error;
      if (outcome.kind === "permanent") throw outcome.error;
    }

    throw lastError;
  }
}

type ModelOutcome =
  | { kind: "success"; result: ImageGenerationResult }
  | { kind: "retryable"; error: Error }
  | { kind: "permanent"; error: Error };

async function requestModel(args: {
  baseUrl: string;
  privateKey: string;
  publicKey: string;
  model: string;
  prompt: string;
  references: Array<{
    id: string;
    role: string;
    mimeType: string;
    data: string;
  }>;
  config?: ImageProviderConfig;
}): Promise<ModelOutcome> {
  const { baseUrl, privateKey, publicKey, model, prompt, references, config } =
    args;
  // Stable idempotency key: retries reuse it so a client-side timeout
  // replays the in-progress/finished result instead of starting (and
  // billing) a second generation.
  const idempotencyKey = `slides-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestBody = {
    idempotencyKey,
    prompt,
    model,
    count: 1,
    aspectRatio: toBuilderAspectRatio(config?.aspectRatio),
    size: "1K",
    outputFormat: config?.outputFormat || "png",
    references,
    source: { appId: "slides", feature: "generate-image" },
  };

  let lastError: Error = new Error("Builder-managed image generation failed.");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, attempt * RETRY_DELAY_MS));
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${privateKey}`,
          "x-builder-api-key": publicKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as Error)?.name;
      lastError =
        name === "AbortError" || name === "TimeoutError"
          ? new Error("Builder-managed image generation timed out.")
          : (err as Error);
      continue;
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      lastError = new Error(
        `Builder-managed image generation failed (${response.status})${text ? `: ${text}` : "."}`,
      );
      if (isModelUnavailableError(response.status, text)) {
        return { kind: "retryable", error: lastError };
      }
      if (isTransientError(response.status)) continue;
      return { kind: "permanent", error: lastError };
    }

    const body = (await response.json()) as BuilderImageGenerationResponse;
    const output = body.outputs?.[0];
    const sourceUrl = output?.downloadUrl ?? output?.url;
    if (!sourceUrl) {
      return {
        kind: "permanent",
        error: new Error(
          "Builder-managed image generation returned no image URL.",
        ),
      };
    }

    const imageResponse = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imageResponse.ok) {
      return {
        kind: "permanent",
        error: new Error(
          `Could not download Builder-generated image (${imageResponse.status}).`,
        ),
      };
    }

    return {
      kind: "success",
      result: {
        imageData: Buffer.from(await imageResponse.arrayBuffer()),
        mimeType:
          output.mimeType ||
          imageResponse.headers.get("content-type") ||
          "image/png",
        model: body.model?.publicId || model,
        provider: "builder",
      },
    };
  }

  return { kind: "retryable", error: lastError };
}

function isTransientError(status: number): boolean {
  return [429, 500, 503, 504].includes(status);
}

function isModelUnavailableError(
  status: number,
  responseText: string,
): boolean {
  if (status !== 404 && status !== 502 && status !== 400) return false;
  return /publisher model|not_found|NOT_FOUND|unknown_model|unknown image model/i.test(
    responseText,
  );
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
