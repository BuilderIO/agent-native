/**
 * Tables for the core search index. Fixed names, scoped by `app` and
 * `resource_type`, so several apps can share one database. Listed in
 * `server/release-schema.ts`.
 */
import type { DbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";

export const SEARCH_RESOURCES_TABLE = "search_resources";
export const SEARCH_INDEX_STATE_TABLE = "search_index_state";

const SEARCH_RESOURCES_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${SEARCH_RESOURCES_TABLE} (
    app TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    title_norm TEXT NOT NULL DEFAULT '',
    summary_norm TEXT NOT NULL DEFAULT '',
    doc_vector TSVECTOR NOT NULL DEFAULT ''::tsvector,
    positions_complete BOOLEAN NOT NULL DEFAULT true,
    modified_at TIMESTAMPTZ,
    content_hash TEXT NOT NULL,
    index_version INTEGER NOT NULL,
    indexed_seq BIGINT NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (app, resource_type, resource_id)
  )
`;

const SEARCH_RESOURCES_VECTOR_INDEX_SQL = `CREATE INDEX IF NOT EXISTS search_resources_doc_vector_gin ON ${SEARCH_RESOURCES_TABLE} USING GIN (doc_vector)`;

const SEARCH_INDEX_STATE_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${SEARCH_INDEX_STATE_TABLE} (
    app TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    target_version INTEGER NOT NULL,
    index_version INTEGER,
    rebuild_high_seq BIGINT,
    rebuild_started_at TIMESTAMPTZ,
    rebuild_completed_at TIMESTAMPTZ,
    PRIMARY KEY (app, resource_type)
  )
`;

let ensured: Promise<void> | undefined;

export function ensureSearchIndexTables(
  injectedClient?: DbExec,
): Promise<void> {
  if (injectedClient) return ensureAll(injectedClient);
  ensured ??= ensureAll().catch((error) => {
    ensured = undefined;
    throw error;
  });
  return ensured;
}

async function ensureAll(injectedClient?: DbExec): Promise<void> {
  const options = { injectedClient };
  await ensureTableExists(
    SEARCH_RESOURCES_TABLE,
    SEARCH_RESOURCES_CREATE_SQL,
    options,
  );
  await ensureIndexExists(
    "search_resources_doc_vector_gin",
    SEARCH_RESOURCES_VECTOR_INDEX_SQL,
    options,
  );
  await ensureTableExists(
    SEARCH_INDEX_STATE_TABLE,
    SEARCH_INDEX_STATE_CREATE_SQL,
    options,
  );
}
