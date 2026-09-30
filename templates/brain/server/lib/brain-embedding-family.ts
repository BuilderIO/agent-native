import type { EmbeddingFamily } from "@agent-native/core/embeddings";
import { getCredentialContext } from "@agent-native/core/server";

import { resolveSourceCredential } from "./source-credentials.js";

export const BRAIN_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const BRAIN_EMBEDDING_DIMENSIONS = 1024;
const INPUT_CHAR_LIMIT = 24_000;
const TIMEOUT_MS = 30_000;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const PROVIDER_LABEL = `openai/${BRAIN_OPENAI_EMBEDDING_MODEL}`;

export class BrainEmbeddingUnavailableError extends Error {
  readonly code = "openai-credential-unavailable";
  constructor() {
    super("OpenAI embedding credential OPENAI_API_KEY is not configured.");
    this.name = "BrainEmbeddingUnavailableError";
  }
}

function malformed(): Error {
  return new Error("Embedding response was malformed.");
}

function parseEmbeddingResponse(body: unknown, expected: number): number[][] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data) || data.length !== expected) throw malformed();
  const rows = data.map((row) => {
    const index = (row as { index?: unknown } | null)?.index;
    const embedding = (row as { embedding?: unknown } | null)?.embedding;
    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      !Array.isArray(embedding) ||
      embedding.length !== BRAIN_EMBEDDING_DIMENSIONS ||
      embedding.some(
        (entry) => typeof entry !== "number" || !Number.isFinite(entry),
      )
    ) {
      throw malformed();
    }
    return { index, embedding: embedding as number[] };
  });
  rows.sort((a, b) => a.index - b.index);
  if (rows.some((row, position) => row.index !== position)) throw malformed();
  return rows.map((row) => row.embedding);
}

function isAbort(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return name === "AbortError" || name === "TimeoutError";
}

export function createOpenAIEmbeddingFamily(apiKey: string): EmbeddingFamily {
  return {
    id: `openai:${BRAIN_OPENAI_EMBEDDING_MODEL}:${BRAIN_EMBEDDING_DIMENSIONS}`,
    provider: "openai",
    model: BRAIN_OPENAI_EMBEDDING_MODEL,
    version: "2024-01",
    dimensions: BRAIN_EMBEDDING_DIMENSIONS,
    async embed(inputs, _purpose, options) {
      if (!inputs.length) return [];
      if (inputs.some((input) => input.images?.length)) {
        throw new Error("OpenAI embedding family does not support images.");
      }
      const signal = AbortSignal.any([
        AbortSignal.timeout(TIMEOUT_MS),
        ...(options?.signal ? [options.signal] : []),
      ]);
      let body: unknown;
      try {
        const res = await fetch(OPENAI_EMBEDDINGS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: BRAIN_OPENAI_EMBEDDING_MODEL,
            input: inputs.map((input) =>
              (input.text ?? "").slice(0, INPUT_CHAR_LIMIT),
            ),
            dimensions: BRAIN_EMBEDDING_DIMENSIONS,
            encoding_format: "float",
          }),
          signal,
        });
        if (!res.ok) {
          throw new Error(
            `Embedding provider ${PROVIDER_LABEL} failed with status ${res.status}.`,
          );
        }
        body = await res.json().catch((error: unknown) => {
          if (isAbort(error)) throw error;
          throw malformed();
        });
      } catch (error) {
        if (isAbort(error)) {
          throw new Error(`Embedding provider ${PROVIDER_LABEL} timed out.`);
        }
        throw error;
      }
      return parseEmbeddingResponse(body, inputs.length);
    },
  };
}

export async function resolveBrainEmbeddingFamily(): Promise<EmbeddingFamily> {
  const ctx = getCredentialContext();
  if (!ctx?.userEmail) throw new BrainEmbeddingUnavailableError();
  const key = await resolveSourceCredential({
    provider: "openai",
    key: "OPENAI_API_KEY",
    ctx,
  });
  if (!key?.trim()) throw new BrainEmbeddingUnavailableError();
  return createOpenAIEmbeddingFamily(key.trim());
}
