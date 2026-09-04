import { createGetDb, getDbExec, isPostgres } from "@agent-native/core/db";

import {
  createDefaultContextConnectorExecutionContext,
  createDefaultContextImportConnectorRegistry,
} from "../connectors/index.js";
import type { ContextImportConnectorRegistry } from "../connectors/registry.js";
import type { ContextConnectorExecutionContext } from "../connectors/types.js";
import * as defaultSchema from "../schema/index.js";
import type { PgVectorAdapter } from "../types.js";
import type {
  CreativeContextElementProvenance,
  ContextMedia,
} from "../types.js";
import {
  deletePgVectors,
  queryPgVectorIndex,
  upsertPgVector,
} from "../vector/pgvector.js";

export type CreativeContextSchema = typeof defaultSchema;
export type CreativeContextGetDb = () => any;

export interface CreativeContextServerContext {
  getDb: CreativeContextGetDb;
  schema: CreativeContextSchema;
  vectorAdapter?: PgVectorAdapter;
  connectors: ContextImportConnectorRegistry;
  connectorContext: ContextConnectorExecutionContext;
  projections?: CreativeContextProjectionAdapters;
  enrichment?: CreativeContextEnrichmentAdapters;
}

export interface CreativeContextProjectionAdapters {
  canonicalLogo?: {
    apply(input: {
      profileId: string | null;
      itemId: string;
      itemVersionId: string;
      payload: Record<string, unknown>;
    }): Promise<void>;
  };
  layoutTemplate?: {
    promote(input: {
      suggestionId: string;
      itemId: string;
      itemVersionId: string;
      projectionItemId: string;
      htmlSnapshot: string | null;
    }): Promise<void>;
    demote(input: {
      suggestionId: string;
      projectionItemId: string | null;
    }): Promise<void>;
  };
  generation?: {
    record(input: {
      appId: string;
      artifactType: string;
      artifactId: string;
      contextPackId: string | null;
      elementProvenance: readonly CreativeContextElementProvenance[];
    }): Promise<void>;
  };
  media?: {
    project(input: {
      sourceId: string;
      itemId: string;
      itemVersionId: string;
      media: ContextMedia;
      sourceType: "brand-import";
      dedupeKey: string;
    }): Promise<void>;
  };
}

export interface CreativeContextEnrichmentAdapters {
  captionImage?(input: {
    data: Uint8Array;
    mimeType: string;
    itemId: string;
    itemVersionId: string;
    mediaId: string;
  }): Promise<string | null>;
  ocrImage?(input: {
    data: Uint8Array;
    mimeType: string;
    itemId: string;
    itemVersionId: string;
    mediaId: string;
  }): Promise<string | null>;
}

const defaultGetDb = createGetDb(defaultSchema);
const CONTEXT_KEY = Symbol.for("@agent-native/creative-context.context");

type GlobalContext = {
  [CONTEXT_KEY]?: CreativeContextServerContext;
};

function defaultVectorAdapter(): PgVectorAdapter | undefined {
  if (!isPostgres()) return undefined;
  return {
    async upsert(input) {
      const vectorKey = input.embeddingId;
      await upsertPgVector(getDbExec(), {
        vectorKey,
        embeddingSetId: input.embeddingSetId,
        dimensions: input.vector.length,
        vector: input.vector,
      });
      return { vectorKey };
    },
    async search(input) {
      const hits = await queryPgVectorIndex(getDbExec(), {
        embeddingSetId: input.embeddingSetId,
        dimensions: input.vector.length,
        vector: input.vector,
        limit: input.limit,
        allowedVectorKeys: input.allowedVectorKeys,
      });
      return hits.map((hit) => ({
        embeddingId: hit.vectorKey,
        score: hit.score,
      }));
    },
    async delete(input) {
      await deletePgVectors(getDbExec(), {
        dimensions: input.dimensions,
        vectorKeys: [input.vectorKey],
      });
    },
  };
}

export function configureCreativeContext(
  context: Partial<CreativeContextServerContext> = {},
): CreativeContextServerContext {
  const appId = context.connectorContext?.appId ?? "creative-context";
  const configured: CreativeContextServerContext = {
    getDb: context.getDb ?? defaultGetDb,
    schema: context.schema ?? defaultSchema,
    vectorAdapter: context.vectorAdapter ?? defaultVectorAdapter(),
    connectors:
      context.connectors ?? createDefaultContextImportConnectorRegistry(),
    connectorContext: {
      ...createDefaultContextConnectorExecutionContext({ appId }),
      ...context.connectorContext,
      appId,
    },
    projections: context.projections,
    enrichment: context.enrichment,
  };
  (globalThis as GlobalContext)[CONTEXT_KEY] = configured;
  return configured;
}

export function getCreativeContext(): CreativeContextServerContext {
  return (
    (globalThis as GlobalContext)[CONTEXT_KEY] ?? configureCreativeContext()
  );
}
