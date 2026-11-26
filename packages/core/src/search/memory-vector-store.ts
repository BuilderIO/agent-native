/**
 * A vector store kept in memory, for tests of the meaning lane on databases
 * without pgvector, such as PGlite. Pass it to `configureSemanticSearch`.
 */
import type { SearchVectorStore } from "./semantic.js";

interface StoredVector {
  embeddingSetId: string;
  dimensions: number;
  audienceIds: readonly string[];
  vector: readonly number[];
}

export interface MemorySearchVectorStore extends SearchVectorStore {
  /** Every stored vector key, sorted. */
  keys(): string[];
  /** Forgets everything stored. */
  clear(): void;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const x = a[index] ?? 0;
    const y = b[index] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return dot / Math.sqrt(normA * normB);
}

export function createMemorySearchVectorStore(): MemorySearchVectorStore {
  const vectors = new Map<string, StoredVector>();
  return {
    async available() {
      return true;
    },
    async upsert(_exec, input) {
      for (const entry of input.entries) {
        if (entry.vector.length !== input.dimensions) {
          throw new Error(
            `Embedding has ${entry.vector.length} values; expected ${input.dimensions}.`,
          );
        }
        vectors.set(entry.key, {
          embeddingSetId: input.embeddingSetId,
          dimensions: input.dimensions,
          audienceIds: [...input.audienceIds],
          vector: [...entry.vector],
        });
      }
    },
    async remove(_exec, input) {
      for (const key of input.keys) {
        if (vectors.get(key)?.dimensions === input.dimensions) {
          vectors.delete(key);
        }
      }
    },
    async removeAudience(_exec, input) {
      for (const [key, stored] of vectors) {
        if (
          stored.dimensions === input.dimensions &&
          stored.audienceIds.includes(input.audienceId)
        ) {
          vectors.delete(key);
        }
      }
    },
    async query(_exec, input) {
      const allowed = new Set(input.audienceIds);
      return [...vectors.entries()]
        .filter(
          ([, stored]) =>
            stored.embeddingSetId === input.embeddingSetId &&
            stored.dimensions === input.dimensions &&
            stored.audienceIds.some((id) => allowed.has(id)),
        )
        .map(([key, stored]) => ({
          key,
          score: cosine(stored.vector, input.vector),
        }))
        .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))
        .slice(0, input.limit);
    },
    keys() {
      return [...vectors.keys()].sort();
    },
    clear() {
      vectors.clear();
    },
  };
}
