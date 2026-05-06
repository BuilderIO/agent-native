import { and, eq } from "drizzle-orm";
import { readAppSecret } from "@agent-native/core/secrets";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
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
}

export interface GenerateProviderOutput {
  image: Buffer;
  mimeType: string;
  model: string;
  provider: string;
}

async function getGeminiApiKey(): Promise<string> {
  const owner = getRequestUserEmail();
  const stored = owner
    ? await readAppSecret({
        key: "GEMINI_API_KEY",
        scope: "user",
        scopeId: owner,
      }).catch(() => null)
    : null;
  const key = process.env.GEMINI_API_KEY ?? stored?.value;
  if (!key) {
    throw new Error(
      "Gemini is not configured. Add a Gemini API key in Settings before generating images.",
    );
  }
  return key;
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
