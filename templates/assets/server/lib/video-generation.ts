import { readBoundedResponseBytes } from "@agent-native/core/ingestion";
import {
  BuilderCredentialLookupError,
  CredentialStoreUnavailableError,
  getBuilderVideoGenerationBaseUrl,
  resolveBuilderGatewayAuth,
} from "@agent-native/core/server";

import type {
  StyleBrief,
  VideoAspectRatio,
  VideoDuration,
  VideoModel,
  VideoResolution,
} from "../../shared/api.js";
import {
  describeProviderPayloadShape,
  isModelUnavailableDetail,
  readableProviderErrorDetail,
} from "../../shared/provider-error.js";
import { getGeminiApiKey } from "./generation.js";
import {
  hasAllowedSignature,
  MAX_VIDEO_UPLOAD_BYTES,
  VIDEO_MIME_TYPES,
} from "./upload-validation.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class RetryableVideoGenerationError extends Error {
  constructor(
    message: string,
    readonly provider?: "builder" | "gemini",
  ) {
    super(message);
    this.name = "RetryableVideoGenerationError";
  }
}

export class UnconfirmedVideoGenerationStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnconfirmedVideoGenerationStartError";
  }
}

function isRetryableStatus(status: number): boolean {
  return [408, 409, 425, 429].includes(status) || status >= 500;
}

function isRetryableTransportError(error: unknown): error is Error {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      ["AbortError", "TimeoutError"].includes(error.name))
  );
}

async function pollFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (isRetryableTransportError(error)) {
      throw new RetryableVideoGenerationError(error.message);
    }
    throw error;
  }
}

async function readVideoBuffer(
  response: Response,
  declaredMimeType?: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const responseMimeType = normalizeVideoMimeType(
    response.headers.get("content-type"),
  );
  const declared = normalizeVideoMimeType(declaredMimeType);
  const mimeType =
    declared && declared !== "application/octet-stream"
      ? declared
      : responseMimeType === "application/octet-stream"
        ? null
        : responseMimeType;
  if (!mimeType || !VIDEO_MIME_TYPES.has(mimeType)) {
    throw new Error("Video generation returned an unsupported video type.");
  }
  if (
    responseMimeType &&
    responseMimeType !== "application/octet-stream" &&
    responseMimeType !== mimeType
  ) {
    throw new Error("Video generation returned a mismatched video type.");
  }

  try {
    const buffer = Buffer.from(
      await readBoundedResponseBytes(response, MAX_VIDEO_UPLOAD_BYTES),
    );
    if (!hasAllowedSignature(mimeType, buffer)) {
      throw new Error("Video generation returned invalid video data.");
    }
    return { buffer, mimeType };
  } catch (error) {
    if (isRetryableTransportError(error)) {
      throw new RetryableVideoGenerationError(error.message);
    }
    throw error;
  }
}

function videoHttpError(status: number, message: string): Error {
  return isRetryableStatus(status)
    ? new RetryableVideoGenerationError(message)
    : new Error(message);
}

export interface VideoReferenceImage {
  id: string;
  mimeType: string;
  data: string;
  role?: string;
}

export interface GeneratedVideoBytes {
  buffer: Buffer;
  mimeType: string;
  provider: "builder" | "gemini";
  sourceUrl?: string;
  providerGenerationId?: string;
}

export type VideoGenerationOperation =
  | { provider: "gemini"; operationName: string }
  | { provider: "builder"; generationId: string };

type BuilderVideoAuth = NonNullable<
  Awaited<ReturnType<typeof resolveBuilderGatewayAuth>>
>;

export type PreparedVideoGenerationProvider =
  | { provider: "builder"; auth: BuilderVideoAuth }
  | { provider: "gemini"; apiKey: string };

export async function prepareVideoGenerationProvider(
  identity?: { userEmail?: string | null; orgId?: string | null },
  provider?: "builder" | "gemini",
): Promise<PreparedVideoGenerationProvider> {
  if (provider !== "gemini") {
    let auth;
    try {
      auth = await resolveBuilderGatewayAuth(identity);
    } catch (error) {
      if (error instanceof BuilderCredentialLookupError) {
        throw new RetryableVideoGenerationError(error.message, provider);
      }
      throw error;
    }
    if (auth) return { provider: "builder", auth };
    if (provider === "builder") {
      throw new RetryableVideoGenerationError(
        "Builder video generation credentials are temporarily unavailable.",
        "builder",
      );
    }
  }

  try {
    return { provider: "gemini", apiKey: await getGeminiApiKey() };
  } catch (error) {
    if (error instanceof CredentialStoreUnavailableError) {
      throw new RetryableVideoGenerationError(error.message, "gemini");
    }
    throw error;
  }
}

export function compileVideoPrompt(input: {
  libraryTitle: string;
  styleBrief: StyleBrief;
  customInstructions?: string | null;
  prompt: string;
  referenceCount: number;
  includeAudio: boolean;
}): string {
  const style = input.styleBrief;
  const palette = style.palette?.length
    ? `\nPalette to preserve: ${style.palette.join(", ")}.`
    : "";
  const doNot = style.doNot?.length
    ? `\nAvoid: ${style.doNot.join("; ")}.`
    : "";
  const customInstructions = input.customInstructions?.trim()
    ? `\nLibrary custom instructions:\n${input.customInstructions.trim()}\n`
    : "";
  const audioInstruction = input.includeAudio
    ? "\nGenerate natural sound or music only when it supports the prompt. Avoid random speech unless the user asked for dialogue."
    : "\nDo not generate audio.";

  return `Create a brand-consistent video for the "${input.libraryTitle}" asset library.

Use the ${input.referenceCount} attached reference images as visual evidence for subject, product, brand, and style. Preserve recognizable product geometry and color when references are provided.

Style brief:
${style.description || "Infer the style from the references."}${palette}
${style.composition ? `\nComposition: ${style.composition}.` : ""}
${style.lighting ? `\nLighting: ${style.lighting}.` : ""}
${style.typographyPolicy ? `\nTypography policy: ${style.typographyPolicy}.` : ""}
${doNot}${audioInstruction}${customInstructions}

Keep motion intentional, camera language clear, and avoid rendering readable text unless the user explicitly asks for exact visible text.

User request:
${input.prompt}`;
}

export async function startGeminiVideoGeneration(input: {
  apiKey: string;
  model: VideoModel;
  compiledPrompt: string;
  aspectRatio: VideoAspectRatio;
  durationSeconds: VideoDuration;
  resolution: VideoResolution;
  referenceImages?: VideoReferenceImage[];
  sourceImage?: VideoReferenceImage | null;
  negativePrompt?: string | null;
  enhancePrompt?: boolean;
  generateAudio?: boolean;
}): Promise<{ operationName: string }> {
  const instance: Record<string, unknown> = { prompt: input.compiledPrompt };
  if (input.sourceImage) {
    instance.image = {
      inlineData: {
        mimeType: input.sourceImage.mimeType,
        data: input.sourceImage.data,
      },
    };
  } else if (input.referenceImages?.length) {
    instance.referenceImages = input.referenceImages.slice(0, 3).map((ref) => ({
      image: { inlineData: { mimeType: ref.mimeType, data: ref.data } },
      referenceType: ref.role === "style_reference" ? "style" : "asset",
    }));
  }

  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_BASE_URL}/models/${input.model}:predictLongRunning`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.apiKey,
        },
        body: JSON.stringify({
          instances: [instance],
          parameters: {
            aspectRatio: input.aspectRatio,
            durationSeconds: String(input.durationSeconds),
            resolution: input.resolution,
            negativePrompt: input.negativePrompt || undefined,
            enhancePrompt: input.enhancePrompt ?? true,
            generateAudio: input.generateAudio ?? true,
          },
        }),
        signal: AbortSignal.timeout(45_000),
      },
    );
  } catch (error) {
    if (isRetryableTransportError(error)) {
      throw new UnconfirmedVideoGenerationStartError(
        "Gemini may have accepted this video request, but its operation could not be confirmed. It was not retried to avoid a duplicate generation.",
      );
    }
    throw error;
  }

  if (!response.ok) {
    // coercion-ok: the response already failed; an unreadable body only costs
    // detail, and the thrown error still carries the status.
    const errorBody = await response.text().catch(() => "");
    console.error(
      `[assets] video-gen provider error status=${response.status} model=${input.model} bodyShape=${describeProviderPayloadShape(errorBody)} bodyChars=${errorBody.length}`,
    );
    const detail = videoErrorDetailForUser(errorBody, input.model);
    const message = `Gemini video generation failed (${response.status})${detail ? `: ${detail}` : "."}`;
    if ([425, 429].includes(response.status)) {
      throw new RetryableVideoGenerationError(message, "gemini");
    }
    if (isRetryableStatus(response.status)) {
      throw new UnconfirmedVideoGenerationStartError(
        `${message} The request was not retried because Gemini does not provide a confirmed operation ID for this response.`,
      );
    }
    throw new Error(message);
  }
  let body: { name?: string };
  try {
    body = (await response.json()) as { name?: string };
  } catch {
    throw new UnconfirmedVideoGenerationStartError(
      "Gemini may have accepted this video request, but its operation could not be confirmed. It was not retried to avoid a duplicate generation.",
    );
  }
  if (!body.name) {
    throw new UnconfirmedVideoGenerationStartError(
      "Gemini may have accepted this video request, but returned no operation ID. It was not retried to avoid a duplicate generation.",
    );
  }
  return { operationName: body.name };
}

export async function startVideoGeneration(
  input: {
    runId: string;
    libraryId: string;
    callerAppId?: string;
    model: VideoModel;
    compiledPrompt: string;
    aspectRatio: VideoAspectRatio;
    durationSeconds: VideoDuration;
    resolution: VideoResolution;
    referenceImages?: VideoReferenceImage[];
    sourceImage?: VideoReferenceImage | null;
    negativePrompt?: string | null;
    enhancePrompt?: boolean;
    generateAudio?: boolean;
  },
  preparedProvider: PreparedVideoGenerationProvider,
): Promise<VideoGenerationOperation> {
  if (preparedProvider.provider === "gemini") {
    return {
      provider: "gemini",
      ...(await startGeminiVideoGeneration({
        ...input,
        apiKey: preparedProvider.apiKey,
      })),
    };
  }

  const auth = preparedProvider.auth;
  const baseUrl = getBuilderVideoGenerationBaseUrl().replace(/\/$/, "");
  const headers = {
    Authorization: auth.authorization,
    ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
    ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
    "Content-Type": "application/json",
  };
  const requestBody = JSON.stringify({
    idempotencyKey: input.runId,
    prompt: input.compiledPrompt,
    model: input.model,
    aspectRatio: input.aspectRatio,
    durationSeconds: input.durationSeconds,
    resolution: input.resolution,
    negativePrompt: input.negativePrompt || undefined,
    enhancePrompt: input.enhancePrompt ?? true,
    generateAudio: input.generateAudio ?? true,
    ...(input.sourceImage
      ? {
          sourceImage: {
            id: input.sourceImage.id,
            role: "source",
            mimeType: input.sourceImage.mimeType,
            data: input.sourceImage.data,
          },
        }
      : {
          references: (input.referenceImages ?? []).slice(0, 3).map((ref) => ({
            id: ref.id,
            role: ref.role === "style_reference" ? "style" : "asset",
            mimeType: ref.mimeType,
            data: ref.data,
          })),
        }),
    source: {
      appId: input.callerAppId || "assets",
      feature: "video-generation",
      resourceId: input.libraryId,
    },
    metadata: { runId: input.runId },
  });
  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
    try {
      response = await fetch(`${baseUrl}/generations`, {
        method: "POST",
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      if (!isRetryableTransportError(error)) throw error;
      if (attempt === 2) {
        throw new RetryableVideoGenerationError(
          "Builder video generation start could not be confirmed.",
          "builder",
        );
      }
      continue;
    }
    if (response.status === 409) {
      const body = (await response.clone().json()) as {
        code?: unknown;
        generationId?: unknown;
      } | null;
      if (
        body?.code === "request_in_progress" &&
        typeof body.generationId === "string"
      ) {
        return { provider: "builder", generationId: body.generationId };
      }
      if (body?.code === "request_in_progress" && attempt < 2) continue;
    }
    if (
      ([408, 425, 429].includes(response.status) || response.status >= 500) &&
      attempt < 2
    ) {
      continue;
    }
    break;
  }
  if (!response) {
    throw new RetryableVideoGenerationError(
      "Builder video generation start could not be confirmed.",
      "builder",
    );
  }
  if (!response.ok) {
    // coercion-ok: the status is still reported when the provider body is unreadable.
    const body = await response.text().catch(() => "");
    const detail = readableProviderErrorDetail(body, 500);
    const message = `Builder video generation failed (${response.status})${detail ? `: ${detail}` : "."}`;
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      throw new RetryableVideoGenerationError(message, "builder");
    }
    throw new Error(message);
  }
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string" || !body.id) {
    throw new Error("Builder video generation returned no generation ID.");
  }
  return { provider: "builder", generationId: body.id };
}

export async function pollGeminiVideoGeneration(
  operationName: string,
): Promise<
  | { status: "processing"; operation: Record<string, unknown> }
  | { status: "completed"; video: GeneratedVideoBytes }
> {
  const apiKey = await getGeminiApiKey();
  const operationUrl = operationName.startsWith("http")
    ? operationName
    : `${GEMINI_BASE_URL}/${operationName}`;
  const response = await pollFetch(operationUrl, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    // coercion-ok: the response already failed; an unreadable body only costs
    // detail, and the thrown error still carries the status.
    const body = await response.text().catch(() => "");
    console.error(
      `[assets] video-gen poll error status=${response.status} bodyShape=${describeProviderPayloadShape(body)} bodyChars=${body.length}`,
    );
    const detail = videoErrorDetailForUser(body);
    throw videoHttpError(
      response.status,
      `Gemini video operation poll failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const operation = (await response.json()) as Record<string, unknown>;
  if (operation.error) {
    console.error(
      `[assets] video-gen operation error shape=${describeProviderPayloadShape(operation.error)}`,
    );
    const detail = videoErrorDetailForUser(operation.error);
    throw new Error(
      `Gemini video generation failed${detail ? `: ${detail}` : "."}`,
    );
  }
  if (operation.done !== true) return { status: "processing", operation };

  const video = extractVideo(operation);
  if (!video) {
    throw new Error("Gemini video operation completed without a video.");
  }
  if (video.videoBytes) {
    if (video.videoBytes.length > Math.ceil(MAX_VIDEO_UPLOAD_BYTES / 3) * 4) {
      throw new Error("Video generation returned invalid video data.");
    }
    return {
      status: "completed",
      video: {
        ...validateVideoBuffer(
          video.mimeType || "video/mp4",
          Buffer.from(video.videoBytes, "base64"),
        ),
        provider: "gemini",
        sourceUrl: video.uri,
        providerGenerationId: operationName,
      },
    };
  }
  if (!video.uri) {
    throw new Error("Gemini video operation returned no video URI.");
  }
  const videoResponse = await pollFetch(video.uri, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(120_000),
  });
  if (!videoResponse.ok) {
    throw videoHttpError(
      videoResponse.status,
      `Could not download generated video (${videoResponse.status}).`,
    );
  }
  return {
    status: "completed",
    video: {
      ...(await readVideoBuffer(videoResponse, video.mimeType)),
      provider: "gemini",
      sourceUrl: video.uri,
      providerGenerationId: operationName,
    },
  };
}

export async function pollBuilderVideoGeneration(
  generationId: string,
  identity?: { userEmail?: string | null; orgId?: string | null },
): Promise<
  | { status: "processing"; operation: Record<string, unknown> }
  | { status: "completed"; video: GeneratedVideoBytes }
> {
  let auth;
  try {
    auth = await resolveBuilderGatewayAuth(identity);
  } catch (error) {
    if (error instanceof BuilderCredentialLookupError) {
      throw new RetryableVideoGenerationError(error.message);
    }
    throw error;
  }
  if (!auth)
    throw new Error("Builder connection is unavailable for video generation.");
  const baseUrl = getBuilderVideoGenerationBaseUrl().replace(/\/$/, "");
  const response = await pollFetch(
    `${baseUrl}/generations/${encodeURIComponent(generationId)}/poll`,
    {
      method: "POST",
      headers: {
        Authorization: auth.authorization,
        ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
        ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    // coercion-ok: the HTTP status is still reported when the provider body is unreadable.
    const body = await response.text().catch(() => "");
    const detail = readableProviderErrorDetail(body, 500);
    throw videoHttpError(
      response.status,
      `Builder video generation poll failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const operation = (await response.json()) as Record<string, unknown>;
  if (operation.status === "processing")
    return { status: "processing", operation };
  if (operation.status !== "completed") {
    throw new Error("Builder video generation returned an unknown status.");
  }
  const outputs = Array.isArray(operation.outputs) ? operation.outputs : [];
  const output = outputs[0] as Record<string, unknown> | undefined;
  const sourceUrl =
    stringValue(output?.downloadUrl) ?? stringValue(output?.url);
  if (!sourceUrl)
    throw new Error("Builder video generation returned no video URL.");
  const declaredMimeType = normalizeVideoMimeType(
    stringValue(output?.mimeType),
  );
  if (
    declaredMimeType &&
    declaredMimeType !== "application/octet-stream" &&
    !VIDEO_MIME_TYPES.has(declaredMimeType)
  ) {
    throw new Error("Video generation returned an unsupported video type.");
  }
  const downloadUrl = new URL(sourceUrl);
  if (
    downloadUrl.protocol !== "https:" ||
    !(
      downloadUrl.hostname === "builder.io" ||
      downloadUrl.hostname.endsWith(".builder.io")
    )
  ) {
    throw new Error(
      "Builder video generation returned an unsupported video URL.",
    );
  }
  const videoResponse = await pollFetch(downloadUrl, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!videoResponse.ok) {
    throw videoHttpError(
      videoResponse.status,
      `Could not download generated video (${videoResponse.status}).`,
    );
  }
  return {
    status: "completed",
    video: {
      ...(await readVideoBuffer(videoResponse, declaredMimeType ?? undefined)),
      provider: "builder",
      sourceUrl,
      providerGenerationId: stringValue(output?.providerGenerationId),
    },
  };
}

function extractVideo(
  operation: Record<string, unknown>,
): { uri?: string; videoBytes?: string; mimeType?: string } | null {
  const response = readRecord(operation.response);
  const generateVideoResponse = readRecord(response?.generateVideoResponse);
  const sample = readArray(generateVideoResponse?.generatedSamples)[0];
  const restVideo = readRecord(readRecord(sample)?.video);
  if (restVideo) {
    return {
      uri: stringValue(restVideo.uri),
      videoBytes: stringValue(restVideo.videoBytes),
      mimeType: stringValue(restVideo.mimeType),
    };
  }

  const generatedVideo = readArray(response?.generatedVideos)[0];
  const sdkVideo = readRecord(readRecord(generatedVideo)?.video);
  if (sdkVideo) {
    return {
      uri: stringValue(sdkVideo.uri),
      videoBytes: stringValue(sdkVideo.videoBytes),
      mimeType: stringValue(sdkVideo.mimeType),
    };
  }
  return null;
}

// Mirrors the image path: the failure text reaches the generation tray and the
// audit page verbatim, so it must be prose rather than the provider payload.
function videoErrorDetailForUser(value: unknown, model?: VideoModel): string {
  const detail = readableProviderErrorDetail(value, 500);
  if (!detail) return "";
  if (isModelUnavailableDetail(detail)) {
    const label = model ? `the ${model} model` : "the requested video model";
    return `${label} is unavailable right now. Pick a different video model and try again.`;
  }
  return detail;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function normalizeVideoMimeType(value?: string | null): string | null {
  const mimeType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return mimeType || null;
}

function validateVideoBuffer(
  value: string,
  buffer: Buffer,
): { buffer: Buffer; mimeType: string } {
  const mimeType = normalizeVideoMimeType(value);
  if (
    !mimeType ||
    !VIDEO_MIME_TYPES.has(mimeType) ||
    buffer.byteLength > MAX_VIDEO_UPLOAD_BYTES ||
    !hasAllowedSignature(mimeType, buffer)
  ) {
    throw new Error("Video generation returned invalid video data.");
  }
  return { buffer, mimeType };
}
