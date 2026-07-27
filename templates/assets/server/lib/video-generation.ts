import type {
  StyleBrief,
  VideoAspectRatio,
  VideoDuration,
  VideoModel,
  VideoResolution,
} from "../../shared/api.js";
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
  sourceUrl?: string;
  providerGenerationId?: string;
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
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gemini video generation failed (${response.status})${detail ? `: ${extractErrorDetail(detail)}` : "."}`,
    );
  }
  const body = (await response.json()) as { name?: string };
  if (!body.name) {
    throw new Error("Gemini video generation returned no operation name.");
  }
  return { operationName: body.name };
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
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Gemini video operation poll failed (${response.status})${detail ? `: ${extractErrorDetail(detail)}` : "."}`,
    );
  }
  const operation = (await response.json()) as Record<string, unknown>;
  if (operation.error) {
    throw new Error(
      `Gemini video generation failed: ${extractErrorDetail(operation.error)}`,
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
      sourceUrl: video.uri,
      providerGenerationId: operationName,
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

function extractErrorDetail(value: unknown): string {
  if (typeof value === "string") {
    try {
      return extractErrorDetail(JSON.parse(value));
    } catch {
      return value.trim().slice(0, 500);
    }
  }
  const record = readRecord(value);
  if (!record) return String(value).slice(0, 500);
  for (const key of ["message", "error", "detail", "status"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().slice(0, 500);
    }
    if (candidate && typeof candidate === "object") {
      const nested = extractErrorDetail(candidate);
      if (nested) return nested;
    }
  }
  return JSON.stringify(record).slice(0, 500);
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
