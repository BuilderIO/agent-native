import { readBoundedResponseBytes } from "../ingestion/index.js";
import {
  getBuilderEmbeddingsBaseUrl,
  prefetchSecrets,
  resolveBuilderGatewayAuth,
  type BuilderGatewayAuth,
} from "../server/credential-provider.js";
import {
  GEMINI_API_KEY,
  resolveSecretWithAliasesDetailed,
  secretKeyNames,
} from "../server/secret-key-aliases.js";

export type EmbeddingInputPurpose = "query" | "document";
export interface EmbeddingImageInput {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  base64: string;
}
export interface MultimodalEmbeddingInput {
  text?: string;
  images?: EmbeddingImageInput[];
}
export interface EmbeddingFamily {
  id: string;
  provider: "gemini" | "cohere" | "voyage" | (string & {});
  model: string;
  version: string;
  dimensions: number;
  supportedImageMimeTypes?: readonly EmbeddingImageInput["mimeType"][];
  embed(
    inputs: readonly MultimodalEmbeddingInput[],
    purpose: EmbeddingInputPurpose,
  ): Promise<number[][]>;
}

const DEFAULT_DIMENSIONS = 1024;
const BUILDER_EMBEDDING_MODEL = "builder-multimodal-embedding";
const BUILDER_EMBEDDING_BATCH_LIMIT = 32;
const BUILDER_EMBEDDING_INPUT_TEXT_LIMIT = 32_000;
const BUILDER_EMBEDDING_INPUT_IMAGE_LIMIT = 6;
const BUILDER_EMBEDDING_IMAGE_BASE64_LIMIT = 14_000_000;
const BUILDER_EMBEDDING_REQUEST_TEXT_LIMIT = 256_000;
const BUILDER_EMBEDDING_REQUEST_BASE64_LIMIT = 24_000_000;
function dataUrl(image: EmbeddingImageInput) {
  return `data:${image.mimeType};base64,${image.base64}`;
}
function normalizedInput(input: MultimodalEmbeddingInput) {
  const text = input.text?.trim();
  const images = input.images ?? [];
  if (!text && !images.length)
    throw new Error("Embedding input needs text, an image, or both.");
  return { text, images };
}
function builderEmbeddingBatches(inputs: readonly MultimodalEmbeddingInput[]) {
  const batches: ReturnType<typeof normalizedInput>[][] = [];
  let batch: ReturnType<typeof normalizedInput>[] = [];
  let batchTextLength = 0;
  let batchImageBase64Length = 0;

  for (const raw of inputs) {
    const input = normalizedInput(raw);
    const textLength = input.text?.length ?? 0;
    const imageBase64Length = input.images.reduce(
      (total, image) => total + image.base64.length,
      0,
    );

    if (textLength > BUILDER_EMBEDDING_INPUT_TEXT_LIMIT) {
      throw new Error(
        "Builder embedding text input exceeds 32,000 characters.",
      );
    }
    if (input.images.length > BUILDER_EMBEDDING_INPUT_IMAGE_LIMIT) {
      throw new Error("Builder embedding input exceeds 6 images.");
    }
    if (
      input.images.some(
        ({ base64 }) =>
          !base64.length ||
          base64.length > BUILDER_EMBEDDING_IMAGE_BASE64_LIMIT,
      )
    ) {
      throw new Error(
        "Builder embedding image data must be 1 to 14,000,000 characters.",
      );
    }
    if (imageBase64Length > BUILDER_EMBEDDING_REQUEST_BASE64_LIMIT) {
      throw new Error(
        "Builder embedding input exceeds the request size limit.",
      );
    }

    if (
      batch.length === BUILDER_EMBEDDING_BATCH_LIMIT ||
      batchTextLength + textLength > BUILDER_EMBEDDING_REQUEST_TEXT_LIMIT ||
      batchImageBase64Length + imageBase64Length >
        BUILDER_EMBEDDING_REQUEST_BASE64_LIMIT
    ) {
      batches.push(batch);
      batch = [];
      batchTextLength = 0;
      batchImageBase64Length = 0;
    }

    batch.push(input);
    batchTextLength += textLength;
    batchImageBase64Length += imageBase64Length;
  }

  if (batch.length) batches.push(batch);
  return batches;
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
    if (!response.ok)
      throw new Error(
        `Embedding provider ${providerModel} failed with status ${response.status}.`,
      );
    const bytes = await readBoundedResponseBytes(response, 1_000_000);
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
  } catch (error) {
    if (controller.signal.aborted)
      throw new Error(`Embedding provider ${providerModel} timed out.`);
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
    )
      throw new Error("Embedding response contained an invalid vector.");
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
        const result = await postJson(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`,
          { "x-goog-api-key": apiKey },
          {
            content: {
              parts: [
                { text: `${instruction} ${input.text ?? ""}`.trim() },
                ...input.images.map((image) => ({
                  inlineData: { mimeType: image.mimeType, data: image.base64 },
                })),
              ],
            },
            output_dimensionality: dimensions,
          },
          `gemini/${model}`,
        );
        vectors.push(
          ...numberVectors([
            (result.embedding as { values?: unknown } | undefined)?.values,
          ]),
        );
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
      const result = await postJson(
        "https://api.cohere.com/v2/embed",
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          inputs: inputs.map((raw) => {
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
          }),
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
      const result = await postJson(
        "https://api.voyageai.com/v1/multimodalembeddings",
        { Authorization: `Bearer ${apiKey}` },
        {
          model,
          inputs: inputs.map((raw) => {
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
          }),
          input_type: purpose,
          truncation: true,
        },
        `voyage/${model}`,
      );
      return numberVectors(result.embeddings);
    },
  };
}

function builderEmbeddingVectors(
  value: unknown,
  expectedCount: number,
): number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new Error("Embedding response was malformed.");
  }
  const vectors: (number[] | undefined)[] = new Array(expectedCount);
  for (const entry of value) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !Number.isInteger((entry as { index?: unknown }).index)
    ) {
      throw new Error("Embedding response was malformed.");
    }
    const { index, embedding } = entry as {
      index: number;
      embedding?: unknown;
    };
    if (index < 0 || index >= expectedCount || vectors[index]) {
      throw new Error("Embedding response was malformed.");
    }
    const vector = numberVectors([embedding])[0];
    if (vector.length !== DEFAULT_DIMENSIONS) {
      throw new Error("Embedding response contained an invalid vector.");
    }
    vectors[index] = vector;
  }
  if (vectors.some((vector) => !vector)) {
    throw new Error("Embedding response was malformed.");
  }
  return vectors as number[][];
}

export function createBuilderEmbeddingFamily(
  auth: BuilderGatewayAuth,
): EmbeddingFamily {
  return {
    id: `builder:${BUILDER_EMBEDDING_MODEL}:${DEFAULT_DIMENSIONS}`,
    provider: "builder",
    model: BUILDER_EMBEDDING_MODEL,
    version: "3.5",
    dimensions: DEFAULT_DIMENSIONS,
    supportedImageMimeTypes: [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ],
    async embed(inputs, purpose) {
      const vectors: number[][] = [];
      const baseUrl = getBuilderEmbeddingsBaseUrl().replace(/\/$/, "");
      for (const batch of builderEmbeddingBatches(inputs)) {
        const result = await postJson(
          `${baseUrl}/embeddings`,
          {
            Authorization: auth.authorization,
            ...(auth.spaceId ? { "x-builder-api-key": auth.spaceId } : {}),
            ...(auth.userId ? { "x-builder-user-id": auth.userId } : {}),
          },
          {
            model: BUILDER_EMBEDDING_MODEL,
            inputType: purpose,
            inputs: batch.map((input) => {
              return {
                ...(input.text ? { text: input.text } : {}),
                images: input.images.map(({ mimeType, base64 }) => ({
                  mimeType,
                  data: base64,
                })),
              };
            }),
          },
          `builder/${BUILDER_EMBEDDING_MODEL}`,
        );
        vectors.push(...builderEmbeddingVectors(result.data, batch.length));
      }
      return vectors;
    },
  };
}
const EMBEDDING_CREDENTIALS = [
  {
    provider: "gemini",
    key: GEMINI_API_KEY,
    create: createGeminiEmbeddingFamily,
  },
  {
    provider: "cohere",
    key: "COHERE_API_KEY",
    create: createCohereEmbeddingFamily,
  },
  {
    provider: "voyage",
    key: "VOYAGE_API_KEY",
    create: createVoyageEmbeddingFamily,
  },
] as const;

export interface EmbeddingFamilyAvailability {
  families: EmbeddingFamily[];
  unavailableProviders: string[];
}

export async function readEmbeddingFamilyAvailability(): Promise<EmbeddingFamilyAvailability> {
  await prefetchSecrets(
    EMBEDDING_CREDENTIALS.flatMap(({ key }) => secretKeyNames(key)),
  ).catch(() => undefined);
  const resolved = await Promise.all(
    EMBEDDING_CREDENTIALS.map(async (credential) => {
      try {
        return {
          credential,
          detail: await resolveSecretWithAliasesDetailed(credential.key),
        };
      } catch {
        return {
          credential,
          detail: { value: null, lookupFailed: true },
        };
      }
    }),
  );
  const directFamilies = resolved.flatMap(({ credential, detail }) =>
    detail.value ? [credential.create(detail.value)] : [],
  );
  const unavailableProviders: string[] = resolved.flatMap(
    ({ credential, detail }) =>
      detail.lookupFailed && !detail.value ? [credential.provider] : [],
  );
  let builderFamily: EmbeddingFamily | null = null;
  try {
    const builderAuth = await resolveBuilderGatewayAuth();
    if (builderAuth) builderFamily = createBuilderEmbeddingFamily(builderAuth);
  } catch {
    unavailableProviders.push("builder");
  }

  return {
    families: [...directFamilies, ...(builderFamily ? [builderFamily] : [])],
    unavailableProviders,
  };
}

export async function availableEmbeddingFamilies(): Promise<EmbeddingFamily[]> {
  const availability = await readEmbeddingFamilyAvailability();
  if (availability.unavailableProviders.length) {
    throw new Error(
      `Embedding credential lookup is temporarily unavailable for: ${availability.unavailableProviders.join(", ")}.`,
    );
  }
  return availability.families;
}
export function defaultEmbeddingFamily(
  families: readonly EmbeddingFamily[],
): EmbeddingFamily | null {
  return families.length === 1 ? (families[0] ?? null) : null;
}
