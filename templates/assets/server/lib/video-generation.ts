import {
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

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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
  const apiKey = await getGeminiApiKey();
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

  const response = await fetch(
    `${GEMINI_BASE_URL}/models/${input.model}:predictLongRunning`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
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

  if (!response.ok) {
    // coercion-ok: the response already failed; an unreadable body only costs
    // detail, and the thrown error still carries the status.
    const errorBody = await response.text().catch(() => "");
    console.error(
      `[assets] video-gen provider error status=${response.status} model=${input.model} bodyShape=${describeProviderPayloadShape(errorBody)} bodyChars=${errorBody.length}`,
    );
    const detail = videoErrorDetailForUser(errorBody, input.model);
    throw new Error(
      `Gemini video generation failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }
  const body = (await response.json()) as { name?: string };
  if (!body.name) {
    throw new Error("Gemini video generation returned no operation name.");
  }
  return { operationName: body.name };
}

export async function startVideoGeneration(input: {
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
}): Promise<VideoGenerationOperation> {
  const auth = await resolveBuilderGatewayAuth();
  if (!auth) {
    return {
      provider: "gemini",
      ...(await startGeminiVideoGeneration(input)),
    };
  }

  const baseUrl = getBuilderVideoGenerationBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/generations`, {
    method: "POST",
    headers: {
      Authorization: auth.authorization,
      ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
            references: (input.referenceImages ?? [])
              .slice(0, 3)
              .map((ref) => ({
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
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    // coercion-ok: the status is still reported when the provider body is unreadable.
    const body = await response.text().catch(() => "");
    const detail = readableProviderErrorDetail(body, 500);
    throw new Error(
      `Builder video generation failed (${response.status})${detail ? `: ${detail}` : "."}`,
    );
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
  const response = await fetch(operationUrl, {
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
    throw new Error(
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
    return {
      status: "completed",
      video: {
        buffer: Buffer.from(video.videoBytes, "base64"),
        mimeType: video.mimeType || "video/mp4",
        provider: "gemini",
        sourceUrl: video.uri,
        providerGenerationId: operationName,
      },
    };
  }
  if (!video.uri) {
    throw new Error("Gemini video operation returned no video URI.");
  }
  const videoResponse = await fetch(video.uri, {
    headers: { "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(120_000),
  });
  if (!videoResponse.ok) {
    throw new Error(
      `Could not download generated video (${videoResponse.status}).`,
    );
  }
  return {
    status: "completed",
    video: {
      buffer: Buffer.from(await videoResponse.arrayBuffer()),
      mimeType:
        video.mimeType ||
        videoResponse.headers.get("content-type") ||
        "video/mp4",
      provider: "gemini",
      sourceUrl: video.uri,
      providerGenerationId: operationName,
    },
  };
}

export async function pollBuilderVideoGeneration(
  generationId: string,
): Promise<
  | { status: "processing"; operation: Record<string, unknown> }
  | { status: "completed"; video: GeneratedVideoBytes }
> {
  const auth = await resolveBuilderGatewayAuth();
  if (!auth)
    throw new Error("Builder connection is unavailable for video generation.");
  const baseUrl = getBuilderVideoGenerationBaseUrl().replace(/\/$/, "");
  const response = await fetch(
    `${baseUrl}/generations/${encodeURIComponent(generationId)}/poll`,
    {
      method: "POST",
      headers: {
        Authorization: auth.authorization,
        ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    // coercion-ok: the HTTP status is still reported when the provider body is unreadable.
    const body = await response.text().catch(() => "");
    const detail = readableProviderErrorDetail(body, 500);
    throw new Error(
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
  const videoResponse = await fetch(downloadUrl, {
    signal: AbortSignal.timeout(120_000),
  });
  if (!videoResponse.ok) {
    throw new Error(
      `Could not download generated video (${videoResponse.status}).`,
    );
  }
  return {
    status: "completed",
    video: {
      buffer: Buffer.from(await videoResponse.arrayBuffer()),
      mimeType:
        stringValue(output?.mimeType) ||
        videoResponse.headers.get("content-type") ||
        "video/mp4",
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
