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

// Google retired the "-preview" model aliases; Builder's gateway proxies
// straight through to the publisher model id, so it 404s on the old preview
// suffix the same way the direct Gemini SDK path does. Try the GA ids in
// order in case one isn't enabled for a given Builder-connected project.
const BUILDER_IMAGE_MODELS = [
  "gemini-3.1-flash-image",
  "gemini-3-pro-image",
  "gemini-2.5-flash-image",
];
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS_PER_MODEL = 3;
const RETRY_DELAY_MS = 3_000;

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

    let lastError: Error | null = null;

    for (const model of BUILDER_IMAGE_MODELS) {
      // Stable per-model idempotency key: retries of the same model reuse it
      // so a client-side timeout replays the in-progress/finished result
      // instead of starting (and billing) a second generation.
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

      const outcome = await requestModel({
        baseUrl,
        requestBody,
        privateKey: creds.privateKey,
        publicKey: creds.publicKey,
      });

      if (outcome.kind === "success") return outcome.result;
      lastError = outcome.error;
      // Both "model unavailable" and "retries exhausted" fall through to
      // the next model; only a permanent non-model error (e.g. auth)
      // short-circuits the whole loop, since no other model id would fare
      // differently against a rejected Builder connection.
      if (outcome.kind === "permanent") throw outcome.error;
    }

    throw (
      lastError ||
      new Error("Builder-managed image generation failed for all models.")
    );
  }
}

type ModelOutcome =
  | { kind: "success"; result: ImageGenerationResult }
  | { kind: "retryable"; error: Error }
  | { kind: "permanent"; error: Error };

async function requestModel(args: {
  baseUrl: string;
  requestBody: Record<string, unknown>;
  privateKey: string;
  publicKey: string;
}): Promise<ModelOutcome> {
  const { baseUrl, requestBody, privateKey, publicKey } = args;
  const model = requestBody.model as string;
  let lastError: Error = new Error("Builder-managed image generation failed.");

  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
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
      if (isUnknownModelError(response.status, text)) {
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

function isUnknownModelError(status: number, responseText: string): boolean {
  if (status !== 404 && status !== 502) return false;
  return /publisher model|not_found|NOT_FOUND/i.test(responseText);
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
