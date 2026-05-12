import { and, eq, inArray } from "drizzle-orm";
import {
  FeatureNotConfiguredError,
  getBuilderImageGenerationBaseUrl,
  resolveBuilderAuthHeader,
  resolveSecret,
} from "@agent-native/core/server";
import { getDb, schema } from "../db/index.js";
import { parseJson } from "./json.js";
import { getObject } from "./storage.js";
import type {
  AspectRatio,
  ImageCategory,
  ImageModel,
  ImageSize,
  StyleBrief,
} from "../../shared/api.js";

export interface ReferenceForGeneration {
  id: string;
  role: string;
  category?: string;
  mimeType: string;
  data: string;
}

// Keep automatic reference context compact for Gemini. Explicit
// referenceAssetIds bypass this cap because the caller made a deliberate set.
export const DEFAULT_GENERATION_REFERENCE_LIMIT = 6;

export interface GenerateProviderInput {
  prompt: string;
  compiledPrompt: string;
  references: ReferenceForGeneration[];
  model: ImageModel;
  aspectRatio: AspectRatio;
  imageSize: ImageSize;
  groundingMode: "auto" | "off" | "google-search";
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

async function getGeminiApiKey(): Promise<string> {
  const key = await resolveSecret("GEMINI_API_KEY");
  if (!key) {
    throw new FeatureNotConfiguredError({
      requiredCredential: "GEMINI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message:
        "Image generation is not configured. Open Settings and either click Connect Builder.io, or expand the Image generation setup step and paste a Gemini API key as the manual fallback.",
    });
  }
  return key;
}

export async function isGeminiImageGenerationConfigured(): Promise<boolean> {
  return !!(await resolveSecret("GEMINI_API_KEY").catch(() => null));
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

  constructor(message: string, status?: number, detail?: string) {
    super(message);
    this.name = "BuilderImageGenerationError";
    this.status = status;
    this.detail = detail;
  }
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
  const authHeader = await resolveBuilderAuthHeader();
  if (!authHeader) {
    throw new BuilderImageGenerationError(
      "Builder.io is not connected for managed image generation.",
      401,
    );
  }

  const baseUrl = getBuilderImageGenerationBaseUrl().replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/generations`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      idempotencyKey: input.runId,
      prompt: input.compiledPrompt,
      model: input.model,
      count: 1,
      aspectRatio: toBuilderAspectRatio(input.aspectRatio),
      size: toBuilderImageSize(input.imageSize),
      outputFormat: "png",
      references: input.references.map((ref) => ({
        id: ref.id,
        role: toBuilderReferenceRole(ref.role),
        mimeType: ref.mimeType,
        data: ref.data,
        name: ref.category,
      })),
      source: {
        appId: "images",
        feature: "generate-image",
        resourceId: input.libraryId,
      },
      metadata: {
        collectionId: input.collectionId,
        callerAppId: input.callerAppId,
        source: input.source,
        groundingMode: input.groundingMode,
      },
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch((err) => {
    if ((err as Error)?.name === "AbortError") {
      throw new BuilderImageGenerationError(
        "Builder-managed image generation timed out.",
        504,
      );
    }
    throw err;
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    const detail = extractBuilderErrorDetail(text);
    throw new BuilderImageGenerationError(
      `Builder-managed image generation failed (${response.status})${detail ? `: ${detail}` : "."}`,
      response.status,
      detail,
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

export async function generateWithManagedImageProvider(
  input: GenerateProviderInput,
): Promise<GenerateProviderOutput> {
  if (!isBuilderImageGenerationEnabled()) {
    if (await isGeminiImageGenerationConfigured()) {
      return generateWithGemini(input);
    }
    throw new FeatureNotConfiguredError({
      requiredCredential: "GEMINI_API_KEY",
      builderConnectUrl: "/_agent-native/builder/connect",
      byokDocsUrl: "https://aistudio.google.com/apikey",
      message:
        "Builder-managed image generation is disabled for this deployment. Open Settings, expand the Image generation setup step, and paste a Gemini API key — or re-enable Builder-managed generation.",
    });
  }

  try {
    return await generateWithBuilderImageApi(input);
  } catch (err) {
    const shouldFallback =
      err instanceof BuilderImageGenerationError &&
      [401, 402, 403, 429, 503, 504].includes(err.status ?? 0);
    if (shouldFallback && (await isGeminiImageGenerationConfigured())) {
      return generateWithGemini(input);
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
      return "Image generation needs Builder.io connected or reconnected. Open Settings and click Connect Builder.io, or expand the Image generation setup step and paste a Gemini API key as the manual fallback.";
    case 402:
      return `Builder.io is connected, but this Builder space cannot use managed image generation credits${detail} Open Builder space settings or reconnect to a space with image-generation credits, or add a Gemini API key as the manual fallback.`;
    case 403:
      return `Builder.io is connected, but this Builder space does not have access to managed image generation${detail} Ask a space admin to enable access, reconnect to a different Builder space, or add a Gemini API key as the manual fallback.`;
    case 429:
      return `Builder-managed image generation is rate limited right now${detail} Retry shortly, or add a Gemini API key as the manual fallback.`;
    case 503:
    case 504:
      return `Builder-managed image generation is temporarily unavailable${detail} Retry shortly, or add a Gemini API key as the manual fallback.`;
    default:
      return `Builder-managed image generation failed${detail} Add a Gemini API key as the manual fallback if the Builder-managed provider keeps failing.`;
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
        model: input.model,
        contents,
        config,
      });
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.inlineData?.data) {
          return {
            image: Buffer.from(part.inlineData.data, "base64"),
            mimeType: part.inlineData.mimeType || "image/png",
            model: input.model,
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

function toBuilderImageSize(size: ImageSize) {
  return size === "512" ? "0.5K" : size;
}

function toBuilderReferenceRole(role: string) {
  switch (role) {
    case "style_reference":
      return "style";
    case "logo_reference":
      return "logo";
    case "product_reference":
      return "product";
    case "diagram_reference":
      return "composition";
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
  referenceCount: number;
  includeLogo: boolean;
  category?: ImageCategory;
}): string {
  const style = input.styleBrief;
  const palette = style.palette?.length
    ? `\nPalette to preserve: ${style.palette.join(", ")}.`
    : "";
  const doNot = style.doNot?.length
    ? `\nAvoid: ${style.doNot.join("; ")}.`
    : "";
  const logoInstruction = input.includeLogo
    ? "\nLeave a clean uncluttered area in the upper-right for the real brand logo; do not draw or approximate the logo yourself."
    : "";
  const diagramInstruction =
    input.category === "diagram"
      ? "\nDiagram mode: use clear hierarchy, precise labels only when requested, consistent line weights, and enough whitespace for readability."
      : "";
  const customInstructions = input.customInstructions?.trim()
    ? `\nLibrary custom instructions:\n${input.customInstructions.trim()}\n`
    : "";

  return `Create a brand-consistent image for the "${input.libraryTitle}" image library.

Use the ${input.referenceCount} attached reference images as visual evidence. Treat them by role: style references define visual language, logo/product references define accurate brand/product appearance, and prior candidates define continuity.

Style brief:
${style.description || "Infer the style from the references."}${palette}
${style.composition ? `\nComposition: ${style.composition}.` : ""}
${style.lighting ? `\nLighting: ${style.lighting}.` : ""}
${style.typographyPolicy ? `\nTypography policy: ${style.typographyPolicy}.` : ""}
${doNot}${logoInstruction}${diagramInstruction}${customInstructions}

Do not render headlines, body text, UI labels, or prompt wording inside the image unless the user explicitly asks for exact visible text.

User request:
${input.prompt}`;
}

export async function selectReferences(input: {
  libraryId: string;
  collectionId?: string | null;
  categories?: ImageCategory[];
  referenceAssetIds?: string[];
  sourceAssetId?: string;
  limit?: number;
}): Promise<ReferenceForGeneration[]> {
  const db = getDb();
  const explicitIds = [...new Set(input.referenceAssetIds ?? [])];
  if (explicitIds.length) {
    if (input.sourceAssetId && !explicitIds.includes(input.sourceAssetId)) {
      explicitIds.unshift(input.sourceAssetId);
    }
    const rows = await db
      .select()
      .from(schema.imageAssets)
      .where(
        and(
          eq(schema.imageAssets.libraryId, input.libraryId),
          inArray(schema.imageAssets.id, explicitIds),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return loadReferenceData(
      explicitIds
        .map((id) => byId.get(id))
        .filter(
          (asset): asset is NonNullable<typeof asset> =>
            Boolean(asset) &&
            asset.status !== "archived" &&
            asset.status !== "failed",
        ),
    );
  }
  const filters = [eq(schema.imageAssets.libraryId, input.libraryId)];
  const rows = await db
    .select()
    .from(schema.imageAssets)
    .where(filters.length === 1 ? filters[0] : and(...filters));

  const categories = new Set(input.categories ?? []);
  const limit = input.limit ?? DEFAULT_GENERATION_REFERENCE_LIMIT;
  const scored = rows
    .filter((asset) => asset.status !== "archived" && asset.status !== "failed")
    .map((asset) => {
      const metadata = parseJson<{ category?: string }>(asset.metadata, {});
      let score = 0;
      if (asset.id === input.sourceAssetId) score += 100;
      if (asset.collectionId && asset.collectionId === input.collectionId)
        score += 20;
      if (
        metadata.category &&
        categories.has(metadata.category as ImageCategory)
      )
        score += 10;
      if (asset.role !== "generated") score += 4;
      if (asset.role === "logo_reference") score += 3;
      return { asset, metadata, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score || b.asset.createdAt.localeCompare(a.asset.createdAt),
    );
  const source = input.sourceAssetId
    ? scored.find((item) => item.asset.id === input.sourceAssetId)
    : undefined;
  const remainingLimit = Math.max(0, limit - (source ? 1 : 0));
  const pool = scored
    .filter((item) => item.asset.id !== source?.asset.id)
    .slice(0, Math.max(remainingLimit * 4, remainingLimit));
  const sampled = sampleWeighted(pool, remainingLimit);
  const selected = source ? [source, ...sampled] : sampled;

  return loadReferenceData(selected.map((item) => item.asset));
}

function sampleWeighted<T extends { score: number }>(
  items: T[],
  limit: number,
): T[] {
  if (limit <= 0) return [];
  return items
    .map((item) => ({
      item,
      key: Math.random() ** (1 / Math.max(1, item.score + 1)),
    }))
    .sort((a, b) => b.key - a.key)
    .slice(0, limit)
    .map(({ item }) => item);
}

async function loadReferenceData(
  selected: Array<{
    id: string;
    role: string;
    mimeType: string;
    objectKey: string;
    metadata: string;
  }>,
) {
  const refs: ReferenceForGeneration[] = [];
  for (const asset of selected) {
    const bytes = await getObject(asset.objectKey).catch(() => null);
    if (!bytes) continue;
    const metadata = parseJson<{ category?: string }>(asset.metadata, {});
    refs.push({
      id: asset.id,
      role: asset.role,
      category: metadata.category,
      mimeType: asset.mimeType,
      data: bytes.toString("base64"),
    });
  }
  return refs;
}
