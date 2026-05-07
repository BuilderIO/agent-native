import { and, eq } from "drizzle-orm";
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
        "Image generation is not configured. Connect Builder.io, or add a Gemini API key in Settings as a manual fallback.",
    });
  }
  return key;
}

export async function isGeminiImageGenerationConfigured(): Promise<boolean> {
  return !!(await resolveSecret("GEMINI_API_KEY").catch(() => null));
}

function isBuilderImageGenerationEnabled(): boolean {
  return process.env.BUILDER_IMAGE_GENERATION_ENABLED === "true";
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

  constructor(message: string, status?: number) {
    super(message);
    this.name = "BuilderImageGenerationError";
    this.status = status;
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
    throw new BuilderImageGenerationError(
      `Builder-managed image generation failed (${response.status}): ${text.slice(0, 300)}`,
      response.status,
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
        "Builder-managed image generation is coming soon. Add a Gemini API key in Settings to generate images for now.",
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
    if (shouldFallback) {
      throw new FeatureNotConfiguredError({
        requiredCredential: "BUILDER_PRIVATE_KEY",
        builderConnectUrl: "/_agent-native/builder/connect",
        byokDocsUrl: "https://aistudio.google.com/apikey",
        message:
          "Image generation needs Builder.io connected, or a Gemini API key configured as the manual fallback.",
      });
    }
    throw err;
  }
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

  return `Create a brand-consistent image for the "${input.libraryTitle}" image library.

Use the ${input.referenceCount} attached reference images as visual evidence. Treat them by role: style references define visual language, logo/product references define accurate brand/product appearance, and prior candidates define continuity.

Style brief:
${style.description || "Infer the style from the references."}${palette}
${style.composition ? `\nComposition: ${style.composition}.` : ""}
${style.lighting ? `\nLighting: ${style.lighting}.` : ""}
${style.typographyPolicy ? `\nTypography policy: ${style.typographyPolicy}.` : ""}
${doNot}${logoInstruction}${diagramInstruction}

Do not render headlines, body text, UI labels, or prompt wording inside the image unless the user explicitly asks for exact visible text.

User request:
${input.prompt}`;
}

export async function selectReferences(input: {
  libraryId: string;
  collectionId?: string | null;
  categories?: ImageCategory[];
  sourceAssetId?: string;
  limit?: number;
}): Promise<ReferenceForGeneration[]> {
  const db = getDb();
  const filters = [eq(schema.imageAssets.libraryId, input.libraryId)];
  if (input.sourceAssetId) {
    filters.push(eq(schema.imageAssets.id, input.sourceAssetId));
  }
  const rows = await db
    .select()
    .from(schema.imageAssets)
    .where(filters.length === 1 ? filters[0] : and(...filters));

  const categories = new Set(input.categories ?? []);
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
    )
    .slice(0, input.limit ?? 8);

  const refs: ReferenceForGeneration[] = [];
  for (const item of scored) {
    const bytes = await getObject(item.asset.objectKey).catch(() => null);
    if (!bytes) continue;
    refs.push({
      id: item.asset.id,
      role: item.asset.role,
      category: item.metadata.category,
      mimeType: item.asset.mimeType,
      data: bytes.toString("base64"),
    });
  }
  return refs;
}
