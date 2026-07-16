import { readBoundedResponseBytes } from "@agent-native/core/ingestion";
import { resolveSecret } from "@agent-native/core/server";

import type {
  EmbeddingFamily,
  EmbeddingImageInput,
  EmbeddingInputPurpose,
  MultimodalEmbeddingInput,
} from "./types.js";

const DEFAULT_DIMENSIONS = 1024;

function dataUrl(image: EmbeddingImageInput): string {
  return `data:${image.mimeType};base64,${image.base64}`;
}

function normalizedInput(input: MultimodalEmbeddingInput) {
  const text = input.text?.trim();
  const images = input.images ?? [];
  if (!text && images.length === 0) {
    throw new Error("Embedding input needs text, an image, or both.");
  }
  return { text, images };
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  providerModel: string,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Embedding provider ${providerModel} failed with status ${response.status}.`,
      );
    }
    const bytes = await readBoundedResponseBytes(response, 1_000_000);
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Embedding provider ${providerModel} timed out.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function numberVectors(value: unknown): number[][] {
  if (!Array.isArray(value))
    throw new Error("Embedding response was malformed.");
  return value.map((vector) => {
    if (
      !Array.isArray(vector) ||
      vector.some((entry) => !Number.isFinite(entry))
    ) {
      throw new Error("Embedding response contained an invalid vector.");
    }
    return vector.map(Number);
  });
}

export function createGeminiEmbeddingFamily(
  apiKey: string,
  dimensions = DEFAULT_DIMENSIONS,
): EmbeddingFamily {
  const model = "gemini-embedding-2";
  return {
    id: `gemini:${model}:${dimensions}`,
    provider: "gemini",
    model,
    version: "stable-2026-04",
    dimensions,
    supportedImageMimeTypes: ["image/png", "image/jpeg"],
    async embed(inputs, purpose) {
      const vectors: number[][] = [];
      for (const raw of inputs) {
        const input = normalizedInput(raw);
        const instruction =
          purpose === "query"
            ? "task: search result | query:"
            : "title: none | text:";
        const parts: Record<string, unknown>[] = [
          { text: `${instruction} ${input.text ?? ""}`.trim() },
          ...input.images.map((image) => ({
            inlineData: { mimeType: image.mimeType, data: image.base64 },
          })),
        ];
        const result = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
          { "x-goog-api-key": apiKey },
          {
            content: { parts },
            output_dimensionality: dimensions,
          },
          `gemini/${model}`,
        );
        const embedding = result.embedding as { values?: unknown } | undefined;
        vectors.push(...numberVectors([embedding?.values]));
      }
      return vectors;
    },
  };
}

export function createCohereEmbeddingFamily(
  apiKey: string,
  dimensions = DEFAULT_DIMENSIONS,
): EmbeddingFamily {
  const model = "embed-v4.0";
  return {
    id: `cohere:${model}:${dimensions}`,
    provider: "cohere",
    model,
    version: "v4.0",
    dimensions,
    supportedImageMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ],
    async embed(inputs, purpose) {
      const contentInputs = inputs.map((raw) => {
        const input = normalizedInput(raw);
        return {
          content: [
            ...(input.text ? [{ type: "text", text: input.text }] : []),
            ...input.images.map((image) => ({
              type: "image_url",
              image_url: { url: dataUrl(image) },
            })),
          ],
        };
      });
      const result = await postJson(
        "https://api.cohere.com/v2/embed",
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          inputs: contentInputs,
          input_type: purpose === "query" ? "search_query" : "search_document",
          embedding_types: ["float"],
          output_dimension: dimensions,
        },
        `cohere/${model}`,
      );
      const embeddings = result.embeddings as
        | { float?: unknown; float_?: unknown }
        | undefined;
      return numberVectors(embeddings?.float ?? embeddings?.float_);
    },
  };
}

export function createVoyageEmbeddingFamily(apiKey: string): EmbeddingFamily {
  const model = "voyage-multimodal-3.5";
  return {
    id: `voyage:${model}:1024`,
    provider: "voyage",
    model,
    version: "3.5",
    dimensions: 1024,
    supportedImageMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ],
    async embed(inputs, purpose) {
      const voyageInputs = inputs.map((raw) => {
        const input = normalizedInput(raw);
        return {
          content: [
            ...(input.text ? [{ type: "text", text: input.text }] : []),
            ...input.images.map((image) => ({
              type: "image_base64",
              image_base64: dataUrl(image),
            })),
          ],
        };
      });
      const result = await postJson(
        "https://api.voyageai.com/v1/multimodalembeddings",
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          inputs: voyageInputs,
          input_type: purpose,
          truncation: true,
        },
        `voyage/${model}`,
      );
      return numberVectors(result.embeddings);
    },
  };
}

export async function availableEmbeddingFamilies(): Promise<EmbeddingFamily[]> {
  const [gemini, cohere, voyage] = await Promise.all([
    resolveSecret("GEMINI_API_KEY").catch(() => null),
    resolveSecret("COHERE_API_KEY").catch(() => null),
    resolveSecret("VOYAGE_API_KEY").catch(() => null),
  ]);
  return [
    ...(gemini ? [createGeminiEmbeddingFamily(gemini)] : []),
    ...(cohere ? [createCohereEmbeddingFamily(cohere)] : []),
    ...(voyage ? [createVoyageEmbeddingFamily(voyage)] : []),
  ];
}

export function defaultEmbeddingFamily(
  families: readonly EmbeddingFamily[],
): EmbeddingFamily | null {
  return families.length === 1 ? (families[0] ?? null) : null;
}
