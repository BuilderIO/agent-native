import { createHash } from "node:crypto";

import {
  FeatureNotConfiguredError,
  getBuilderImageGenerationBaseUrl,
  resolveBuilderCredentials,
  resolveSecret,
} from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";

import type {
  AspectRatio,
  GenerationIntent,
  ImageCategory,
  ImageModel,
  ImageQualityTier,
  ImageSize,
  StyleStrength,
  StyleBrief,
} from "../../shared/api.js";
import { getDb, schema } from "../db/index.js";
import { parseJson } from "./json.js";
import { getObject } from "./storage.js";

export interface ReferenceForGeneration {
  id: string;
  role: string;
  category?: string;
  mimeType: string;
  data: string;
  selectionReason?: "subject" | "source" | "anchor" | "scored" | "explicit";
}

// Keep automatic reference context compact for Gemini. Explicit
// referenceAssetIds bypass this cap because the caller made a deliberate set.
export const DEFAULT_GENERATION_REFERENCE_LIMIT = 6;
const STYLE_ANALYSIS_REFERENCE_LIMIT = 8;
const STYLE_ANALYSIS_MODEL =
  process.env.ASSETS_STYLE_ANALYSIS_MODEL || "gemini-2.5-flash";

export interface GenerateProviderInput {
  prompt: string;
  compiledPrompt: string;
  references: ReferenceForGeneration[];
  model: ImageModel;
  mode?: "generate" | "edit";
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  background?: "transparent" | "opaque" | "auto";
  groundingMode: "auto" | "off" | "google-search";
  intent?: GenerationIntent;
  styleStrength?: StyleStrength;
  runId?: string;
  libraryId?: string;
  collectionId?: string | null;
  source?: "chat" | "ui" | "a2a";
  callerAppId?: string;
}

export interface GenerateProviderOutput {
  image: Buffer;
  mimeType: string;
  model: string;
  provider: string;
  sourceUrl?: string;
  providerGenerationId?: string;
  creditsCharged?: number;
}

const MANAGED_PROVIDER_MAX_ATTEMPTS = 3;
const MANAGED_PROVIDER_RETRY_DELAY_MS =
  process.env.NODE_ENV === "test" ? 0 : 2500;
// A single managed image generation can legitimately run longer than one
// request's abort window (pro models routinely exceed 90s). The request always
// carries the run id as an idempotency key, so re-POSTing the same key replays
// the finished result (or answers 409 "request in progress") instead of
// starting a second, double-charged generation. When a request aborts client
// side, hits an upstream gateway timeout, or reports in-progress, we poll the
// same key until it resolves rather than failing. ~40 polls * 6s ≈ 4 min.
const MANAGED_PROVIDER_INFLIGHT_MAX_POLLS =
  process.env.NODE_ENV === "test" ? 6 : 40;
const MANAGED_PROVIDER_INFLIGHT_POLL_MS =
  process.env.NODE_ENV === "test" ? 0 : 6000;
// Slow image models (e.g. gpt-image-*) return the finished image synchronously
// but can take several minutes end-to-end (generate + encode the large PNG +
// transfer). The old 90s window was tuned for Gemini and aborted these mid-
// response, so the request just needs a longer budget rather than the poll-and-
// replay fallback. Override per deployment with ASSETS_IMAGE_GENERATION_TIMEOUT_MS.
const IMAGE_GENERATION_REQUEST_TIMEOUT_MS =
  Number(process.env.ASSETS_IMAGE_GENERATION_TIMEOUT_MS) || 300_000;

// Lightweight structured logging for the image-generation providers. Slow
// models (e.g. gpt-image-*) can exceed the 90s per-request abort window and get
// converted into an in-flight poll, so these logs make the provider, model,
// elapsed time, and abort/poll outcome visible when a generation "completes on
// the provider but times out in the app". Silenced under NODE_ENV=test.
function logGeneration(
  event: string,
  fields: Record<string, unknown> = {},
): void {
  if (process.env.NODE_ENV === "test") return;
  const parts = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatLogValue(value)}`)
    .join(" ");
  console.info(`[assets] image-gen ${event}${parts ? ` ${parts}` : ""}`);
}

function formatLogValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function getGeminiApiKey(): Promise<string> {
  const key = await resolveSecret("GEMINI_API_KEY");
  if (!key) {
    throw new FeatureNotConfiguredError({
      requiredCredential: "GEMINI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message:
        "Asset generation is not configured. Open Settings and either click Connect Builder.io for images, or expand the Asset generation setup step and paste a Gemini API key for videos and image fallback.",
    });
  }
  return key;
}

export async function isGeminiImageGenerationConfigured(): Promise<boolean> {
  return !!(await resolveSecret("GEMINI_API_KEY").catch(() => null));
}

async function getOpenAIImageApiKey(): Promise<string> {
  const key = await resolveSecret("OPENAI_API_KEY");
  if (!key) {
    throw new FeatureNotConfiguredError({
      requiredCredential: "OPENAI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://platform.openai.com/api-keys",
      message:
        "Image generation is not configured. Open Settings and connect Builder.io, or add an OpenAI or Gemini API key manually.",
    });
  }
  return key;
}

export async function isOpenAIImageGenerationConfigured(): Promise<boolean> {
  return !!(await resolveSecret("OPENAI_API_KEY").catch(() => null));
}

async function isManualImageGenerationConfigured(): Promise<boolean> {
  return (
    (await isGeminiImageGenerationConfigured()) ||
    (await isOpenAIImageGenerationConfigured())
  );
}

export function isImageGenerationSetupError(err: unknown): boolean {
  if (err instanceof FeatureNotConfiguredError) return true;
  const message = err instanceof Error ? err.message : "";
  return /Image generation is not configured|Asset generation is not configured|Builder\.io is connected, but this Builder space/i.test(
    message,
  );
}

export function isBuilderImageGenerationEnabled(): boolean {
  return process.env.BUILDER_IMAGE_GENERATION_ENABLED !== "false";
}

function isRetryableProviderError(err: unknown): boolean {
  const anyErr = err as { status?: number; message?: string };
  return (
    anyErr.status === 429 ||
    anyErr.status === 503 ||
    /429|503|overloaded|RESOURCE_EXHAUSTED|UNAVAILABLE|high demand/i.test(
      anyErr.message ?? "",
    )
  );
}

class BuilderImageGenerationError extends Error {
  readonly status?: number;
  readonly detail?: string;
  readonly code?: string;

  constructor(
    message: string,
    status?: number,
    detail?: string,
    code?: string,
  ) {
    super(message);
    this.name = "BuilderImageGenerationError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

function isRetryableBuilderImageGenerationError(err: unknown): boolean {
  return (
    err instanceof BuilderImageGenerationError &&
    [429, 500, 503, 504].includes(err.status ?? 0)
  );
}

// A client-side abort, an upstream gateway timeout, or the service's explicit
// 409 "request_in_progress" all mean the generation is still running under this
// idempotency key. Re-POSTing the same key replays the finished result once the
// service completes, so these are polled rather than surfaced as failures.
function isInFlightImageGenerationError(err: unknown): boolean {
  if (!(err instanceof BuilderImageGenerationError)) return false;
  return (
    err.code === "client_timeout" ||
    err.code === "request_in_progress" ||
    err.status === 504 ||
    err.status === 409
  );
}

function generationRetryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, attempt * MANAGED_PROVIDER_RETRY_DELAY_MS);
  });
}

function generationPollDelay(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, MANAGED_PROVIDER_INFLIGHT_POLL_MS);
  });
}

interface BuilderImageGenerationResponse {
  id: string;
  status: "completed";
  model: {
    publicId: string;
    provider: string;
    providerModel: string;
  };
  outputs: Array<{
    id: string;
    url: string;
    downloadUrl?: string;
    mimeType: string;
  }>;
  creditsCharged?: number;
}

export async function generateWithBuilderImageApi(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  const builderCredentials = await resolveBuilderCredentials();
  if (!builderCredentials.privateKey || !builderCredentials.publicKey) {
    const detail =
      !builderCredentials.privateKey && !builderCredentials.publicKey
        ? "Builder private and public keys are missing"
        : !builderCredentials.privateKey
          ? "Builder private key is missing"
          : "Builder public key is missing";
    throw new BuilderImageGenerationError(
      "Builder.io is not fully connected for managed image generation. Reconnect Builder.io so both Builder private and public keys are available.",
      401,
      detail,
    );
  }

  const baseUrl = getBuilderImageGenerationBaseUrl().replace(/\/$/, "");
  const requestModel = toBuilderImageModel(input.model);
  const startedAt = Date.now();
  const requestBody = {
    idempotencyKey: input.runId,
    prompt: input.compiledPrompt,
    model: requestModel,
    ...(input.mode ? { mode: input.mode } : {}),
    count: 1,
    aspectRatio: toBuilderAspectRatio(input.aspectRatio),
    size: toBuilderImageSize(input.imageSize),
    outputFormat: "png",
    ...(input.background ? { background: input.background } : {}),
    references: input.references.map((ref) => ({
      id: ref.id,
      role: toBuilderReferenceRole(ref.role),
      mimeType: ref.mimeType,
      data: ref.data,
      name: ref.category,
    })),
    source: {
      appId: "assets",
      feature: "generate-image",
      resourceId: input.libraryId,
    },
    metadata: {
      collectionId: input.collectionId ?? undefined,
      callerAppId: input.callerAppId,
      source: input.source,
      groundingMode: input.groundingMode,
      intent: input.intent,
    },
  };
  logGeneration("builder.request", {
    model: requestModel,
    mode: input.mode,
    requestedModel: input.model,
    host: safeUrlHost(baseUrl),
    aspectRatio: toBuilderAspectRatio(input.aspectRatio),
    size: toBuilderImageSize(input.imageSize),
    references: input.references.length,
    referenceRoles: input.references
      .map((ref) => `${ref.id}:${toBuilderReferenceRole(ref.role)}`)
      .join(","),
    runId: input.runId,
  });
  if (
    input.mode === "edit" ||
    process.env.ASSETS_IMAGE_GENERATION_DEBUG_PAYLOAD
  ) {
    logGeneration("builder.request_payload", {
      payload: await sanitizedBuilderRequestPayload(requestBody),
    });
  }
  const response = await fetch(`${baseUrl}/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${builderCredentials.privateKey}`,
      "x-builder-api-key": builderCredentials.publicKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(IMAGE_GENERATION_REQUEST_TIMEOUT_MS),
  }).catch((err) => {
    // `AbortSignal.timeout()` rejects with a `TimeoutError` DOMException, while a
    // manual `AbortController.abort()` rejects with `AbortError` — treat both as
    // "socket gave up, but the service keeps generating under this idempotency
    // key". Flag it so the retry loop polls the key instead of starting a fresh
    // (double-charged) generation. Matching only "AbortError" silently let the
    // per-request timeout escape as a hard failure for slow models.
    const name = (err as Error)?.name;
    if (name === "AbortError" || name === "TimeoutError") {
      logGeneration("builder.abort", {
        model: requestModel,
        elapsedMs: Date.now() - startedAt,
        timeoutMs: IMAGE_GENERATION_REQUEST_TIMEOUT_MS,
        runId: input.runId,
        note: "socket aborted at client timeout; provider may still be running under this idempotency key",
      });
      throw new BuilderImageGenerationError(
        "Builder-managed image generation timed out.",
        504,
        undefined,
        "client_timeout",
      );
    }
    logGeneration("builder.fetch_error", {
      model: requestModel,
      elapsedMs: Date.now() - startedAt,
      name: (err as Error)?.name,
      runId: input.runId,
    });
    throw err;
  });

  logGeneration("builder.response", {
    model: requestModel,
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - startedAt,
    runId: input.runId,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = extractBuilderErrorDetail(text);
    const code = extractBuilderErrorCode(text);
    throw new BuilderImageGenerationError(
      `Builder-managed image generation failed (${response.status})${detail ? `: ${detail}` : "."}`,
      response.status,
      detail,
      code,
    );
  }

  const body = (await response.json()) as BuilderImageGenerationResponse;
  const output = body.outputs[0];
  if (!output?.url && !output?.downloadUrl) {
    throw new BuilderImageGenerationError(
      "Builder-managed image generation returned no image URL.",
      502,
    );
  }

  const sourceUrl = output.downloadUrl ?? output.url;
  const imageResponse = await fetch(sourceUrl, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!imageResponse.ok) {
    throw new BuilderImageGenerationError(
      `Could not download Builder-generated image (${imageResponse.status}).`,
      imageResponse.status,
    );
  }

  logGeneration("builder.success", {
    requestedModel: input.model,
    providerModel: body.model.publicId || input.model,
    provider: body.model.provider,
    elapsedMs: Date.now() - startedAt,
    runId: input.runId,
  });

  return {
    image: Buffer.from(await imageResponse.arrayBuffer()),
    mimeType:
      output.mimeType ||
      imageResponse.headers.get("content-type") ||
      "image/png",
    model: body.model.publicId || input.model,
    provider: "builder",
    sourceUrl,
    providerGenerationId: body.id,
    creditsCharged: body.creditsCharged,
  };
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

async function sanitizedBuilderRequestPayload(input: {
  idempotencyKey?: string;
  prompt: string;
  model: string;
  mode?: string;
  count: number;
  aspectRatio: string;
  size: string;
  outputFormat: string;
  background?: string;
  references: Array<{
    id: string;
    role: string;
    mimeType: string;
    data: string;
    name?: string;
  }>;
  source: Record<string, unknown>;
  metadata: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  return {
    ...input,
    promptChars: input.prompt.length,
    references: await Promise.all(
      input.references.map(async (reference) => ({
        id: reference.id,
        role: reference.role,
        mimeType: reference.mimeType,
        name: reference.name,
        data: await referenceDataDebugSummary(reference.data),
      })),
    ),
  };
}

async function referenceDataDebugSummary(data: string): Promise<
  | {
      omitted: true;
      bytes: number;
      sha256: string;
      width?: number;
      height?: number;
      channels?: number;
      hasAlpha?: boolean;
      alpha?: {
        min: number;
        max: number;
        transparent: number;
        opaque: number;
        partial: number;
      };
    }
  | { omitted: true; error: string; chars: number }
> {
  try {
    const buffer = decodeReferenceData(data);
    const metadata = await sharp(buffer, { failOn: "none" }).metadata();
    const alpha = metadata.hasAlpha
      ? await alphaDebugSummary(buffer).catch(() => undefined)
      : undefined;
    return {
      omitted: true,
      bytes: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex").slice(0, 16),
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha,
      alpha,
    };
  } catch (err) {
    return {
      omitted: true,
      error: err instanceof Error ? err.message : "Unable to inspect reference",
      chars: data.length,
    };
  }
}

function decodeReferenceData(data: string): Buffer {
  const base64 = data.includes(",") ? data.split(",").pop()! : data;
  return Buffer.from(base64, "base64");
}

async function alphaDebugSummary(data: Buffer): Promise<{
  min: number;
  max: number;
  transparent: number;
  opaque: number;
  partial: number;
}> {
  const alpha = await sharp(data, { failOn: "none" })
    .ensureAlpha()
    .extractChannel("alpha")
    .raw()
    .toBuffer();
  let min = 255;
  let max = 0;
  let transparent = 0;
  let opaque = 0;
  let partial = 0;
  for (const value of alpha) {
    if (value < min) min = value;
    if (value > max) max = value;
    if (value === 0) transparent += 1;
    else if (value === 255) opaque += 1;
    else partial += 1;
  }
  return { min, max, transparent, opaque, partial };
}

async function generateWithRetryingBuilderImageApi(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  let transientAttempts = 0;
  let inFlightPolls = 0;
  for (;;) {
    try {
      return await generateWithBuilderImageApi(input);
    } catch (err) {
      // The generation is still running under this idempotency key. Poll the
      // same key — a pending request returns 409 immediately and the final
      // poll returns the stored image as an idempotent replay (no re-charge) —
      // until it resolves or we exhaust the polling budget.
      if (isInFlightImageGenerationError(err)) {
        if (inFlightPolls >= MANAGED_PROVIDER_INFLIGHT_MAX_POLLS) {
          logGeneration("builder.poll_exhausted", {
            model: input.model,
            polls: inFlightPolls,
            maxPolls: MANAGED_PROVIDER_INFLIGHT_MAX_POLLS,
            runId: input.runId,
            note: "provider never returned a completed result under this idempotency key within the wait budget",
          });
          throw new BuilderImageGenerationError(
            "Builder-managed image generation is still running after the wait budget. It may finish shortly — try again to pick up the result.",
            504,
            err instanceof BuilderImageGenerationError ? err.detail : undefined,
            "client_timeout",
          );
        }
        inFlightPolls += 1;
        logGeneration("builder.poll", {
          model: input.model,
          poll: inFlightPolls,
          maxPolls: MANAGED_PROVIDER_INFLIGHT_MAX_POLLS,
          code:
            err instanceof BuilderImageGenerationError ? err.code : undefined,
          status:
            err instanceof BuilderImageGenerationError ? err.status : undefined,
          runId: input.runId,
        });
        await generationPollDelay();
        continue;
      }
      // Fresh transient server errors get a few quick retries with backoff.
      if (
        isRetryableBuilderImageGenerationError(err) &&
        transientAttempts < MANAGED_PROVIDER_MAX_ATTEMPTS - 1
      ) {
        transientAttempts += 1;
        logGeneration("builder.transient_retry", {
          model: input.model,
          attempt: transientAttempts,
          status:
            err instanceof BuilderImageGenerationError ? err.status : undefined,
          runId: input.runId,
        });
        await generationRetryDelay(transientAttempts);
        continue;
      }
      throw err;
    }
  }
}

export async function generateWithManagedImageProvider(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  logGeneration("dispatch", {
    model: input.model,
    mode: input.mode,
    intent: input.intent,
    background: input.background,
    builderEnabled: isBuilderImageGenerationEnabled(),
    runId: input.runId,
  });
  if (!isBuilderImageGenerationEnabled()) {
    if (await isManualImageGenerationConfigured()) {
      return generateWithManualImageProvider(input);
    }
    throw new FeatureNotConfiguredError({
      requiredCredential: "GEMINI_API_KEY or OPENAI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message:
        "Builder-managed image generation is disabled for this deployment. Open Settings and add a Gemini or OpenAI API key manually, or re-enable Builder-managed generation.",
    });
  }

  try {
    return await generateWithRetryingBuilderImageApi(input);
  } catch (err) {
    const shouldFallback =
      err instanceof BuilderImageGenerationError &&
      [401, 402, 403, 429, 503, 504].includes(err.status ?? 0);
    if (shouldFallback && (await isManualImageGenerationConfigured())) {
      logGeneration("builder.fallback_to_manual", {
        model: input.model,
        status:
          err instanceof BuilderImageGenerationError ? err.status : undefined,
        runId: input.runId,
      });
      return generateWithManualImageProvider(input);
    }
    if (shouldFallback && err instanceof BuilderImageGenerationError) {
      throw createBuilderImageGenerationFallbackError(err);
    }
    throw err;
  }
}

function createBuilderImageGenerationFallbackError(
  err: BuilderImageGenerationError,
): Error {
  const message = builderImageGenerationFallbackMessage(err);
  if ([401, 402, 403].includes(err.status ?? 0)) {
    return new FeatureNotConfiguredError({
      requiredCredential:
        err.status === 401 ? "BUILDER_PRIVATE_KEY" : "GEMINI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message,
    });
  }
  return new BuilderImageGenerationError(message, err.status, err.detail);
}

function builderImageGenerationFallbackMessage(
  err: BuilderImageGenerationError,
): string {
  const detail = err.detail ? `: ${err.detail}` : ".";
  switch (err.status) {
    case 401:
      return `Image generation needs Builder.io connected or reconnected${err.detail ? ` (${err.detail})` : ""}. Open Settings and click Connect Builder.io, or expand the Asset generation setup step and add an OpenAI or Gemini API key as the manual fallback.`;
    case 402:
      return `Builder.io is connected, but this Builder space cannot use managed image generation credits${detail} Open Builder space settings or reconnect to a space with image-generation credits, or add an OpenAI or Gemini API key as the manual fallback.`;
    case 403:
      return `Builder.io is connected, but this Builder space does not have access to managed image generation${detail} Ask a space admin to enable access, reconnect to a different Builder space, or add an OpenAI or Gemini API key as the manual fallback.`;
    case 429:
      return `Builder-managed image generation is rate limited right now${detail} Retry shortly, or add an OpenAI or Gemini API key as the manual fallback.`;
    case 503:
    case 504:
      return `Builder-managed image generation is temporarily unavailable${detail} Retry shortly, or add an OpenAI or Gemini API key as the manual fallback.`;
    default:
      return `Builder-managed image generation failed${detail} Add an OpenAI or Gemini API key as the manual fallback if the Builder-managed provider keeps failing.`;
  }
}

function extractBuilderErrorDetail(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const detail = readProviderErrorDetail(parsed);
    if (detail) return detail.slice(0, 300);
  } catch {
    // Fall back to the raw response text below.
  }
  return trimmed.slice(0, 300);
}

// The managed service tags errors with a stable machine code (e.g.
// "request_in_progress") in the JSON body. It drives retry vs. poll decisions.
function extractBuilderErrorCode(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { code?: unknown };
    return typeof parsed?.code === "string" ? parsed.code : undefined;
  } catch {
    return undefined;
  }
}

function readProviderErrorDetail(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["message", "error", "detail"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
    const nested = readProviderErrorDetail(candidate);
    if (nested) return nested;
  }
  return null;
}

export async function generateWithGemini(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: await getGeminiApiKey() });
  const model = normalizeGeminiImageModel(input.model);
  const contents: Array<Record<string, unknown>> = [
    { text: input.compiledPrompt },
    ...input.references.map((ref) => ({
      inlineData: { mimeType: ref.mimeType, data: ref.data },
    })),
  ];
  const config: Record<string, unknown> = {
    responseModalities: ["TEXT", "IMAGE"],
    imageConfig: {
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
    },
  };
  if (input.groundingMode !== "off") {
    config.tools = [{ googleSearch: {} }];
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 2500));
      }
      const response = await client.models.generateContent({
        model,
        contents,
        config,
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return {
            image: Buffer.from(part.inlineData.data, "base64"),
            mimeType: part.inlineData.mimeType || "image/png",
            model,
            provider: "gemini",
          };
        }
      }
      throw new Error("Gemini returned no image data.");
    } catch (err) {
      lastError = err;
      if (!isRetryableProviderError(err)) break;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini image generation failed.");
}

function normalizeGeminiImageModel(model: ImageModel): ImageModel {
  if (model === "gemini-3.1-flash-image-preview") {
    return "gemini-3.1-flash-image";
  }
  if (model === "gemini-3-pro-image-preview") {
    return "gemini-3-pro-image";
  }
  return model;
}

export interface StyleAnalysisOutput {
  styleBrief: StyleBrief;
  model: string;
}

export async function analyzeStyleWithGemini(input: {
  references: ReferenceForGeneration[];
  previous?: StyleBrief;
}): Promise<StyleAnalysisOutput> {
  const refs = input.references.slice(0, STYLE_ANALYSIS_REFERENCE_LIMIT);
  if (!refs.length) {
    return { styleBrief: input.previous ?? {}, model: STYLE_ANALYSIS_MODEL };
  }

  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: await getGeminiApiKey() });
  const response = await client.models.generateContent({
    model: STYLE_ANALYSIS_MODEL,
    contents: [
      {
        text: [
          "Analyze these brand/style reference images for a reusable image generation style brief.",
          "Return only compact JSON with keys: description, medium, mood, subjectMatter, texture, composition, lighting, fontFamilies, fontWeights, letterforms, caseStyle, typographyPolicy, doNot.",
          "For typography, describe specific letterforms and font traits, not just broad sans/serif categories; omit any typography field you cannot determine confidently.",
          "Use specific trait-locking phrases that can be reused across future image prompts.",
          "Do not name brands, artists, studios, franchises, or copyrighted works unless they appear as user-provided brand identity.",
          "Keep doNot as an array of short constraints. Omit uncertain fields instead of guessing.",
          input.previous?.description
            ? `Existing style description to preserve unless contradicted: ${input.previous.description}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      ...refs.map((ref) => ({
        inlineData: { mimeType: ref.mimeType, data: ref.data },
      })),
    ],
    config: {
      responseMimeType: "application/json",
    },
  });

  const text =
    response.candidates?.[0]?.content?.parts
      ?.map((part: any) => part.text)
      .filter(Boolean)
      .join("\n") ?? "";
  const parsed = parseJson<Record<string, unknown>>(
    extractJsonObject(text),
    {},
  );
  return {
    styleBrief: sanitizeStyleBrief(parsed),
    model: STYLE_ANALYSIS_MODEL,
  };
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return "{}";
}

export function sanitizeStyleBrief(value: Record<string, unknown>): StyleBrief {
  const stringField = (key: string) => {
    const raw = value[key];
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  };
  const stringArrayField = (key: string) => {
    const raw = value[key];
    return Array.isArray(raw)
      ? raw
          .filter(
            (item): item is string => typeof item === "string" && !!item.trim(),
          )
          .map((item) => item.trim())
      : undefined;
  };
  const fontFamilies = stringArrayField("fontFamilies");
  const fontWeights = stringArrayField("fontWeights");
  const doNot = stringArrayField("doNot");
  return {
    description: stringField("description"),
    medium: stringField("medium"),
    mood: stringField("mood"),
    subjectMatter: stringField("subjectMatter"),
    texture: stringField("texture"),
    composition: stringField("composition"),
    lighting: stringField("lighting"),
    fontFamilies: fontFamilies?.length ? fontFamilies : undefined,
    fontWeights: fontWeights?.length ? fontWeights : undefined,
    letterforms: stringField("letterforms"),
    caseStyle: stringField("caseStyle"),
    typographyPolicy: stringField("typographyPolicy"),
    doNot: doNot?.length ? doNot : undefined,
  };
}

async function generateWithManualImageProvider(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  if (input.mode === "edit") {
    throw new FeatureNotConfiguredError({
      requiredCredential: "BUILDER_PRIVATE_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message:
        "Mask inpainting runs need Builder-managed image generation because the manual fallback cannot pass the image-edit mask.",
    });
  }
  if (await isGeminiImageGenerationConfigured()) {
    return generateWithGemini(input);
  }
  if (input.intent === "restyle" || input.intent === "edit") {
    throw new FeatureNotConfiguredError({
      requiredCredential: "GEMINI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message:
        "Restyle and edit runs need Builder-managed image generation or a Gemini API key because the OpenAI fallback cannot attach source images in this pipeline yet.",
    });
  }
  return generateWithOpenAI(input);
}

export async function generateWithOpenAI(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  const startedAt = Date.now();
  const model = openAIImageModelForInput(input.model);
  logGeneration("openai.request", {
    model,
    requestedModel: input.model,
    size: toOpenAIImageSize(input.aspectRatio),
    runId: input.runId,
  });
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await getOpenAIImageApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: buildOpenAIImagePrompt(input),
      n: 1,
      size: toOpenAIImageSize(input.aspectRatio),
      quality: "medium",
      output_format: "png",
      ...(input.background ? { background: input.background } : {}),
    }),
    signal: AbortSignal.timeout(IMAGE_GENERATION_REQUEST_TIMEOUT_MS),
  }).catch((err) => {
    logGeneration("openai.fetch_error", {
      elapsedMs: Date.now() - startedAt,
      name: (err as Error)?.name,
      timeoutMs: IMAGE_GENERATION_REQUEST_TIMEOUT_MS,
      runId: input.runId,
    });
    throw err;
  });

  logGeneration("openai.response", {
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - startedAt,
    runId: input.runId,
  });

  const body = (await response.json().catch(() => ({}))) as {
    data?: Array<{ b64_json?: string; url?: string }>;
    error?: { message?: string };
  };
  if (!response.ok) {
    const detail = body.error?.message || `OpenAI returned ${response.status}`;
    throw new Error(`OpenAI image generation failed: ${detail}`);
  }

  const output = body.data?.[0];
  if (output?.b64_json) {
    return {
      image: Buffer.from(output.b64_json, "base64"),
      mimeType: "image/png",
      model,
      provider: "openai",
    };
  }
  if (output?.url) {
    const imageResponse = await fetch(output.url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!imageResponse.ok) {
      throw new Error(
        `Could not download OpenAI-generated image (${imageResponse.status}).`,
      );
    }
    return {
      image: Buffer.from(await imageResponse.arrayBuffer()),
      mimeType:
        imageResponse.headers.get("content-type")?.split(";")[0] || "image/png",
      model,
      provider: "openai",
      sourceUrl: output.url,
    };
  }
  throw new Error("OpenAI returned no image data.");
}

function openAIImageModelForInput(
  model: ImageModel,
): "gpt-image-1" | "gpt-image-2" {
  return model === "gpt-image-1" || model === "gpt-image-2"
    ? model
    : "gpt-image-2";
}

function buildOpenAIImagePrompt(input: GenerateProviderInput): string {
  if (!input.references.length) return input.compiledPrompt;
  return `${input.compiledPrompt}

Reference note: this manual OpenAI fallback cannot attach the library reference images directly. Use the written style brief and prompt constraints as the source of truth.`;
}

function toBuilderAspectRatio(aspectRatio: AspectRatio) {
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
  if (supported.has(aspectRatio)) return aspectRatio;
  if (aspectRatio === "4:5") return "3:4";
  if (aspectRatio === "5:4") return "4:3";
  if (aspectRatio === "1:4" || aspectRatio === "1:8") return "9:16";
  if (aspectRatio === "4:1" || aspectRatio === "8:1") return "21:9";
  return "1:1";
}

function toOpenAIImageSize(
  aspectRatio: AspectRatio,
): "1024x1024" | "1536x1024" | "1024x1536" | "auto" {
  if (aspectRatio === "1:1") return "1024x1024";
  if (
    aspectRatio === "9:16" ||
    aspectRatio === "2:3" ||
    aspectRatio === "3:4" ||
    aspectRatio === "1:4" ||
    aspectRatio === "1:8"
  ) {
    return "1024x1536";
  }
  if (
    aspectRatio === "16:9" ||
    aspectRatio === "3:2" ||
    aspectRatio === "4:3" ||
    aspectRatio === "4:1" ||
    aspectRatio === "8:1" ||
    aspectRatio === "21:9"
  ) {
    return "1536x1024";
  }
  return "auto";
}

function toBuilderImageSize(size: ImageSize) {
  return size === "512" ? "0.5K" : size;
}

function toBuilderImageModel(model: ImageModel) {
  if (model === "gemini-3.1-flash-image") {
    return "gemini-3.1-flash-image-preview";
  }
  if (model === "gemini-3-pro-image") {
    return "gemini-3-pro-image-preview";
  }
  return model;
}

function resolveModelForTier(
  tier: ImageQualityTier | undefined,
  category: ImageCategory | undefined,
): ImageModel | undefined {
  if (!tier) return undefined;
  if (tier === "fast") return "gemini-3.1-flash-image";
  if (tier === "best") return "gemini-3-pro-image";
  return ["hero", "landing", "logo", "campaign"].includes(category ?? "")
    ? "gemini-3-pro-image"
    : "gemini-3.1-flash-image";
}

export function resolveImageModelForRequest(input: {
  explicitModel?: ImageModel;
  imageModelDefault?: ImageModel;
  explicitTier?: ImageQualityTier;
  resolvedTier?: ImageQualityTier;
  category?: ImageCategory;
  presetModel?: ImageModel | null;
  embeddedText?: string | null;
}): ImageModel {
  if (input.explicitModel) return input.explicitModel;

  // Exact embedded text is materially better on Gemini Pro, so upgrade to it by
  // default for text requests — but never override a model or tier the caller
  // or a tagged preset already chose (presets "own" model/tier per the action
  // docs). Only auto-upgrade when there is no tier (explicit or preset-derived)
  // and no preset model in play; this still upgrades a bare text request over
  // the composer default.
  const textAccurateModel: ImageModel | undefined =
    input.embeddedText?.trim() &&
    !input.explicitTier &&
    !input.resolvedTier &&
    !input.presetModel
      ? "gemini-3-pro-image"
      : undefined;

  // Precedence: explicit per-request model (handled above) > embedded-text
  // upgrade > an EXPLICIT per-request tier > the preset's saved model > the
  // preset-DERIVED tier mapping > the sticky composer default > the floor.
  //
  // Two subtleties:
  //   - An explicit per-request tier outranks the preset's saved model (the
  //     caller is deliberately overriding the preset this turn).
  //   - The preset's explicit saved model outranks its OWN derived tier: a
  //     preset's `model` column and `settings.tier` can drift out of sync
  //     (update-generation-preset can change one without the other), and the
  //     explicitly saved model is the authoritative choice.
  //   - The composer default ranks LAST of the real signals: it is a global
  //     stored preference and must not defeat a tagged preset or a tier request.
  return (
    textAccurateModel ??
    resolveModelForTier(input.explicitTier, input.category) ??
    input.presetModel ??
    resolveModelForTier(input.resolvedTier, input.category) ??
    input.imageModelDefault ??
    "gemini-3.1-flash-image"
  );
}

function toBuilderReferenceRole(role: string) {
  switch (role) {
    case "style_reference":
      return "style";
    case "logo_reference":
      return "logo";
    case "product_reference":
      return "product";
    case "background_reference":
    case "diagram_reference":
      return "composition";
    case "mask":
      return "mask";
    case "subject_reference":
    case "edit_target":
      return "source";
    case "generated":
      return "source";
    default:
      return "other";
  }
}

export function compilePrompt(input: {
  libraryTitle: string;
  styleBrief: StyleBrief;
  customInstructions?: string | null;
  prompt: string;
  embeddedText?: string | null;
  textPlacement?: string | null;
  referenceCount: number;
  includeLogo: boolean;
  skeletonContentMode?: "cutout" | "fill" | null;
  hasBackgroundPlate?: boolean;
  skeletonInpaint?: boolean;
  aspectRatio?: AspectRatio;
  imageSize?: ImageSize;
  category?: ImageCategory;
  intent?: GenerationIntent;
  styleStrength?: StyleStrength;
}): string {
  const style = input.styleBrief;
  const intent = input.intent ?? "generate";
  const palette = style.palette?.length
    ? `\nPalette to preserve: ${style.palette.join(", ")}.`
    : "";
  const doNot = style.doNot?.length
    ? `\nAvoid: ${style.doNot.join("; ")}.`
    : "";
  const typographyBlock = formatBrandTypography(style);
  const requestedEmbeddedText = hasEmbeddedText(input.embeddedText);
  const textInstruction = requestedEmbeddedText
    ? formatEmbeddedTextInstruction(input.embeddedText, input.textPlacement)
    : "Do not render headlines, body text, UI labels, or prompt wording inside the image unless the user explicitly asks for exact visible text.";
  const logoInstruction = input.includeLogo
    ? "\nLeave a clean uncluttered area in the upper-right for the real brand logo; do not draw or approximate the logo yourself."
    : "";
  const cutoutInstruction =
    input.skeletonContentMode === "cutout" && !input.skeletonInpaint
      ? "\nCutout mode: generate the subject in isolation on an empty transparent background; no scenery, no baked-in ground plane, no environment, and no baked-in shadow."
      : "";
  const backgroundPlateInstruction = input.hasBackgroundPlate
    ? "\nA background plate is attached as a composition reference. It is the FIXED brand layout your output will be composited onto — it already contains the logo, framing, and all fixed text/headlines. Render ONLY the subject, isolated on a transparent background. Do NOT draw, repeat, restyle, or overlap the plate's logo, headline, body text, CTA, or framing. Keep the subject within the plate's open/empty area and leave the occupied regions clear."
    : "";
  const skeletonInpaintInstruction = input.skeletonInpaint
    ? "\nSkeleton inpaint mode: the attached background plate is the fixed final image, and its transparent/open region is the only editable area. Render ONLY the requested foreground content inside that editable region. If the request asks for exact text, CTA, linework, or graphic elements, render those elements only within the editable region. Match the surrounding plate's lighting, perspective, scale, and contact geometry. Do NOT alter, redraw, repeat, restyle, or overlap the plate's existing logo, text, framing, borders, or other brand chrome in the opaque/preserved regions; the plate already contains them. Return the finished plate with the opaque regions preserved."
    : "";
  const diagramInstruction =
    input.category === "diagram"
      ? "\nDiagram mode: use clear hierarchy, precise labels only when requested, consistent line weights, and enough whitespace for readability."
      : "";
  const frameInstruction =
    input.aspectRatio || input.imageSize
      ? `\nOutput frame: ${[input.aspectRatio, input.imageSize].filter(Boolean).join(", ")}. Honor this requested canvas/frame size and composition; do not choose a different crop unless the user explicitly asks for it.`
      : "";
  const customInstructions = input.customInstructions?.trim()
    ? `\nLibrary custom instructions:\n${input.customInstructions.trim()}\n`
    : "";
  const referenceInstruction =
    intent === "edit"
      ? "Use the attached image as the edit target. Preserve all unchanged areas, geometry, camera, dimensions, and identity as closely as the model allows."
      : intent === "restyle"
        ? `The first attached image is the subject to preserve. Keep its identity, pose, composition, and framing. Treat the remaining attached images as style evidence for the brand library. Apply the library look with ${input.styleStrength ?? "balanced"} strength.`
        : input.referenceCount > 0
          ? `Use the ${input.referenceCount} attached reference image${input.referenceCount === 1 ? "" : "s"} as visual evidence. Treat them by role: style references define visual language, logo/product references define accurate brand/product appearance, background references define fixed composition plates/layout only, mask references define editable regions only, subject/source references provide content or composition only, and prior candidates define continuity. Subject/source/background/mask references must not override the library style brief or custom instructions.`
          : "No reference images are attached for this run. Use the style brief and custom instructions as the source of truth.";

  if (intent === "edit") {
    const editTypographyInstruction =
      requestedEmbeddedText && typographyBlock ? `\n\n${typographyBlock}` : "";
    const editTextInstruction = requestedEmbeddedText
      ? `\n\n${formatEmbeddedTextInstruction(input.embeddedText, input.textPlacement)}`
      : "";
    const editConstraint = requestedEmbeddedText
      ? "Do not reimagine the image, change its aspect ratio, or alter unrelated subjects. Do not add any other new text. Return the full image."
      : "Do not reimagine the image, change its aspect ratio, add new text, or alter unrelated subjects. Return the full image.";
    return `Edit the attached image for the "${input.libraryTitle}" asset library.

${referenceInstruction}
${editTypographyInstruction}

Make only this change:
${input.prompt}
${editTextInstruction}

${editConstraint}`;
  }

  return `Create a brand-consistent image for the "${input.libraryTitle}" asset library.

${referenceInstruction}

Style brief:
${style.description || "Infer the style from the references."}${palette}
${style.medium ? `\nMedium: ${style.medium}.` : ""}
${style.mood ? `\nMood: ${style.mood}.` : ""}
${style.subjectMatter ? `\nSubject matter: ${style.subjectMatter}.` : ""}
${style.texture ? `\nTexture/material treatment: ${style.texture}.` : ""}
${style.composition ? `\nComposition: ${style.composition}.` : ""}
${style.lighting ? `\nLighting: ${style.lighting}.` : ""}
${typographyBlock ? `\n${typographyBlock}` : ""}${frameInstruction}
${doNot}${logoInstruction}${cutoutInstruction}${backgroundPlateInstruction}${skeletonInpaintInstruction}${diagramInstruction}${customInstructions}

${textInstruction}

User request:
${input.prompt}`;
}

function hasEmbeddedText(value?: string | null): boolean {
  return typeof value === "string" && !!value.trim();
}

function formatEmbeddedTextInstruction(
  embeddedText?: string | null,
  textPlacement?: string | null,
): string {
  const placement = textPlacement?.trim();
  return [
    `Render this text exactly, spelled correctly, inside the image: ${JSON.stringify(embeddedText ?? "")}.`,
    placement ? `Placement: ${placement}.` : "",
    "Match the brand typography described above where specified; keep it legible and well-kerned.",
  ]
    .filter(Boolean)
    .join(" ");
}

function formatBrandTypography(style: StyleBrief): string {
  const parts = [
    style.fontFamilies?.length
      ? `families ${style.fontFamilies.join(", ")}`
      : "",
    style.fontWeights?.length ? `weights ${style.fontWeights.join(", ")}` : "",
    style.letterforms ? `letterforms: ${style.letterforms}` : "",
    style.caseStyle ? `case: ${style.caseStyle}` : "",
    style.typographyPolicy,
  ].filter((part): part is string => typeof part === "string" && !!part.trim());

  if (!parts.length) return "";
  return `Brand typography: ${parts.join("; ")}. Match these for any rendered text.`;
}

// A content-only reference is an image the user attached as subject/content for
// a single request (not a reusable brand/style reference). It should never count
// as a brand-kit style reference.
function isContentOnlyReferenceAsset(asset: {
  role: string;
  metadata: string;
}): boolean {
  if (asset.role === "subject_reference") return true;
  const metadata = parseJson<{ intent?: string }>(asset.metadata, {});
  return metadata.intent === "subject";
}

export async function selectReferences(input: {
  libraryId: string;
  collectionId?: string | null;
  categories?: ImageCategory[];
  referenceAssetIds?: string[];
  excludeAssetIds?: string[];
  sourceAssetId?: string;
  subjectAssetId?: string;
  intent?: GenerationIntent;
  limit?: number;
}): Promise<ReferenceForGeneration[]> {
  const db = getDb();
  const requestedExplicitIds = new Set(input.referenceAssetIds ?? []);
  const excludedAssetIds = new Set(input.excludeAssetIds ?? []);
  let explicitIds = [...requestedExplicitIds];
  if (explicitIds.length) {
    explicitIds = [
      input.subjectAssetId,
      input.sourceAssetId === input.subjectAssetId
        ? undefined
        : input.sourceAssetId,
      ...explicitIds,
    ].filter(
      (id, index, all): id is string => !!id && all.indexOf(id) === index,
    );
    const rows = await db
      .select()
      .from(schema.assets)
      .where(
        and(
          eq(schema.assets.libraryId, input.libraryId),
          inArray(schema.assets.id, explicitIds),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    const explicitAssets = explicitIds
      .map((id) => byId.get(id))
      .filter(
        (asset): asset is NonNullable<typeof asset> =>
          asset != null &&
          asset.mimeType.startsWith("image/") &&
          asset.status !== "archived" &&
          asset.status !== "failed" &&
          !excludedAssetIds.has(asset.id),
      );
    const explicitRefs = await loadReferenceData(
      explicitAssets,
      (asset) =>
        asset.id === input.subjectAssetId
          ? input.intent === "edit"
            ? "edit_target"
            : "subject_reference"
          : undefined,
      () => "explicit",
    );
    // When every caller-requested reference is a content-only attachment (a
    // subject/content image dropped in for this one request), it should ADD to —
    // not replace — the library's curated brand style. Otherwise attaching a
    // content image silently strips every style/anchor reference and the
    // generation ignores the brand kit entirely. `edit` keeps exact control
    // because the edit target must stand alone.
    const requestedContentAssets = explicitAssets.filter((asset) =>
      requestedExplicitIds.has(asset.id),
    );
    const allRequestedAreContentOnly =
      input.intent !== "edit" &&
      requestedContentAssets.length > 0 &&
      requestedContentAssets.every(isContentOnlyReferenceAsset);
    if (!allRequestedAreContentOnly) return explicitRefs;
    const styleLimit = Math.max(
      0,
      (input.limit ?? DEFAULT_GENERATION_REFERENCE_LIMIT) - explicitRefs.length,
    );
    if (styleLimit === 0) return explicitRefs;
    const styleRefs = await selectReferences({
      libraryId: input.libraryId,
      collectionId: input.collectionId,
      categories: input.categories,
      excludeAssetIds: input.excludeAssetIds,
      intent: input.intent,
      limit: styleLimit,
    });
    const seen = new Set(explicitRefs.map((ref) => ref.id));
    return [...explicitRefs, ...styleRefs.filter((ref) => !seen.has(ref.id))];
  }
  const [library] = await db
    .select({ settings: schema.assetLibraries.settings })
    .from(schema.assetLibraries)
    .where(eq(schema.assetLibraries.id, input.libraryId))
    .limit(1);
  const rows = await db
    .select()
    .from(schema.assets)
    .where(eq(schema.assets.libraryId, input.libraryId));

  const categories = new Set(input.categories ?? []);
  const intent = input.intent ?? "generate";
  const limit = input.limit ?? DEFAULT_GENERATION_REFERENCE_LIMIT;
  const settings = parseJson<{
    canonicalStyleAssetIds?: string[];
  }>(library?.settings, {});
  const canonicalStyleAssetIds = Array.isArray(settings.canonicalStyleAssetIds)
    ? settings.canonicalStyleAssetIds.filter((id) => typeof id === "string")
    : [];
  const candidates = rows
    .filter((asset) => {
      const metadata = parseJson<{ category?: string }>(asset.metadata, {});
      return (
        asset.mimeType.startsWith("image/") &&
        asset.status !== "archived" &&
        asset.status !== "failed" &&
        metadata.category !== "skeleton" &&
        !excludedAssetIds.has(asset.id)
      );
    })
    .map((asset) => {
      const metadata = parseJson<{
        category?: string;
        isStyleAnchor?: boolean;
        intent?: string;
      }>(asset.metadata, {});
      let score = 0;
      const isSubject = asset.id === input.subjectAssetId;
      const isSource = asset.id === input.sourceAssetId;
      const isAnchor =
        metadata.isStyleAnchor === true ||
        canonicalStyleAssetIds.includes(asset.id);
      if (isSubject) score += 120;
      if (isSource) score += 100;
      if (isAnchor) score += 30;
      if (asset.collectionId && asset.collectionId === input.collectionId)
        score += 20;
      if (
        metadata.category &&
        categories.has(metadata.category as ImageCategory)
      )
        score += 10;
      if (asset.role !== "generated") score += 4;
      if (asset.role === "logo_reference") score += 3;
      if (asset.role === "product_reference") score += 3;
      if (intent === "restyle" && asset.role === "style_reference") score += 5;
      if (intent === "restyle" && asset.role === "generated") score -= 4;
      return { asset, metadata, score, isAnchor, isSubject, isSource };
    })
    .filter(
      (item) =>
        item.isSubject ||
        item.isSource ||
        item.isAnchor ||
        (item.metadata.intent !== "subject" &&
          item.asset.role !== "subject_reference"),
    );

  const byId = new Map(candidates.map((item) => [item.asset.id, item]));
  const selected: typeof candidates = [];
  const selectedIds = new Set<string>();
  const push = (item: (typeof candidates)[number] | undefined) => {
    if (!item || selectedIds.has(item.asset.id)) return;
    selected.push(item);
    selectedIds.add(item.asset.id);
  };

  push(input.subjectAssetId ? byId.get(input.subjectAssetId) : undefined);
  if (intent === "edit") {
    return loadReferenceData(
      selected.map((item) => item.asset),
      () => "edit_target",
      () => "subject",
    );
  }
  push(input.sourceAssetId ? byId.get(input.sourceAssetId) : undefined);

  const anchorLimit =
    intent === "restyle"
      ? Math.min(4, Math.max(1, Math.ceil(limit * 0.6)))
      : Math.max(1, Math.ceil(limit * 0.6));
  const anchorIds = [
    ...canonicalStyleAssetIds,
    ...candidates
      .filter((item) => item.metadata.isStyleAnchor === true)
      .sort(compareReferenceCandidates)
      .map((item) => item.asset.id),
  ];
  for (const id of [...new Set(anchorIds)].slice(0, anchorLimit)) {
    push(byId.get(id));
  }

  const remainingLimit = Math.max(0, limit - selected.length);
  const fill = candidates
    .filter((item) => !selectedIds.has(item.asset.id))
    .sort(compareReferenceCandidates)
    .slice(0, remainingLimit);
  for (const item of fill) push(item);

  return loadReferenceData(
    selected.map((item) => item.asset),
    (asset) =>
      asset.id === input.subjectAssetId ? "subject_reference" : undefined,
    (asset) => {
      if (asset.id === input.subjectAssetId) return "subject";
      if (asset.id === input.sourceAssetId) return "source";
      const item = byId.get(asset.id);
      return item?.isAnchor ? "anchor" : "scored";
    },
  );
}

type ReferenceCandidate = {
  asset: { id: string; createdAt: string };
  score: number;
};

export function compareReferenceCandidates(
  a: ReferenceCandidate,
  b: ReferenceCandidate,
): number {
  return (
    b.score - a.score ||
    b.asset.createdAt.localeCompare(a.asset.createdAt) ||
    a.asset.id.localeCompare(b.asset.id)
  );
}

async function loadReferenceData(
  selected: Array<{
    id: string;
    role: string;
    mimeType: string;
    objectKey: string;
    metadata: string;
  }>,
  roleForAsset?: (asset: { id: string; role: string }) => string | undefined,
  reasonForAsset?: (asset: {
    id: string;
    role: string;
  }) => ReferenceForGeneration["selectionReason"] | undefined,
) {
  const refs: ReferenceForGeneration[] = [];
  for (const asset of selected) {
    const bytes = await getObject(asset.objectKey).catch(() => null);
    if (!bytes) continue;
    const metadata = parseJson<{ category?: string }>(asset.metadata, {});
    refs.push({
      id: asset.id,
      role: roleForAsset?.(asset) ?? asset.role,
      category: metadata.category,
      mimeType: asset.mimeType,
      data: bytes.toString("base64"),
      selectionReason: reasonForAsset?.(asset),
    });
  }
  return refs;
}
