import {
  getBuilderImageGenerationBaseUrl,
  resolveBuilderCredentialsDetailed,
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

  // Builder credentials are scoped per-user/org and must only be read via
  // resolveBuilderCredentials(), never process.env directly (even for a sync
  // existence check), so the real check always happens in
  // isConfiguredForRequest(), which providerIsConfigured() in ./index.ts
  // always prefers when it's defined. This sync fallback is never relied on.
  isConfigured(): boolean {
    return false;
  }

  async isConfiguredForRequest(): Promise<boolean> {
    const creds = await resolveBuilderCredentialsDetailed();
    if (creds.lookupFailed) return true;
    return !!(creds.privateKey && creds.publicKey);
  }

  async generate(
    prompt: string,
    referenceImages: ReferenceImage[] = [],
    _context?: { slideContent?: string; deckText?: string },
    config?: ImageProviderConfig,
  ): Promise<ImageGenerationResult> {
    const creds = await resolveBuilderCredentialsDetailed();
    if (creds.lookupFailed) {
      throw new Error(
        "Could not verify your Builder.io connection right now. Please try again.",
      );
    }
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
        userId: creds.userId,
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
  userId: string | null;
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
  const {
    baseUrl,
    privateKey,
    publicKey,
    userId,
    model,
    prompt,
    references,
    config,
  } = args;
  // Stable idempotency key: retries reuse it so a client-side timeout
  // replays the in-progress/finished result instead of starting (and
  // billing) a second generation.
  const idempotencyKey = `slides-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const requestBody = {
    idempotencyKey,
    prompt,
    model,
    count: 1,
    aspectRatio: toBuilderAspectRatio(config?.aspectRatio, model),
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
          ...(userId ? { "x-builder-user-id": userId } : {}),
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

    let body: BuilderImageGenerationResponse;
    try {
      body = (await response.json()) as BuilderImageGenerationResponse;
    } catch {
      lastError = new Error(
        "Builder-managed image generation returned a malformed response.",
      );
      continue;
    }
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

    let imageResponse: Response;
    try {
      imageResponse = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // Network blip / CDN timeout downloading the already-generated image:
      // retryable (and falls through to the next model in the chain if
      // every attempt here is exhausted), not a permanent failure.
      const name = (err as Error)?.name;
      lastError =
        name === "AbortError" || name === "TimeoutError"
          ? new Error("Timed out downloading the Builder-generated image.")
          : (err as Error);
      continue;
    }
    if (!imageResponse.ok) {
      lastError = new Error(
        `Could not download Builder-generated image (${imageResponse.status}).`,
      );
      if (isTransientError(imageResponse.status)) continue;
      return { kind: "permanent", error: lastError };
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

// gpt-image-* only supports a landscape/square/portrait triplet, unlike
// Gemini's wider set on Builder's gateway — map to the closest one instead
// of sending a ratio the requested model will 400 on.
const OPENAI_ASPECT_RATIOS = new Set(["1:1", "2:3", "3:2"]);
const GEMINI_ASPECT_RATIOS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "9:16",
  "16:9",
  "21:9",
]);

function toBuilderAspectRatio(
  aspectRatio: string | undefined,
  model: string,
): string {
  const isOpenAiModel = model.startsWith("gpt-image");
  const supported = isOpenAiModel ? OPENAI_ASPECT_RATIOS : GEMINI_ASPECT_RATIOS;
  if (aspectRatio && supported.has(aspectRatio)) return aspectRatio;

  if (isOpenAiModel) {
    if (aspectRatio === "4:5" || aspectRatio === "9:16") return "2:3";
    if (
      aspectRatio === "5:4" ||
      aspectRatio === "16:9" ||
      aspectRatio === "21:9"
    )
      return "3:2";
    return "3:2";
  }

  if (aspectRatio === "4:5") return "3:4";
  if (aspectRatio === "5:4") return "4:3";
  return "16:9";
}
