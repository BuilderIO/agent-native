/**
 * The meaning lane of core search. Each registered resource's text is cut
 * into chunks and embedded with its organization's provider, so a search can
 * find a page that answers a question without sharing its words. Apps merge
 * these matches with word matches by rank (`reciprocalRankFusion`) and check
 * access on every result, as they do for words.
 *
 * The lane is the resource change feed's second consumer. The capture the
 * word index installed records every change once per subscribed consumer,
 * so the lane needs no triggers of its own. It drains in the recurring sweep
 * and briefly after writes, never before a search, and leaves a resource
 * alone until its edits pause, so autosaves don't re-embed a page while
 * someone types.
 *
 * Organizations can turn the lane off (`semantic-setting.ts`). Then none of
 * their text is embedded, their stored vectors are deleted, and their
 * searches report the lane as off.
 */
import { getDbExec, type DbExec } from "../db/client.js";
import { ensureIndexExists, ensureTableExists } from "../db/ddl-guard.js";
import type { MigrationEntry } from "../db/migrations.js";
import { defineStore } from "../db/store-registry.js";
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  EmbeddingProviderError,
  resolveDefaultEmbeddingFamily,
  type EmbeddingFamily,
} from "../embeddings/index.js";
import {
  pauseProviderBudget,
  releaseProviderBudgetReservation,
  reserveProviderBudget,
  type ProviderAdmission,
  type ProviderConnectionScope,
} from "../provider-api/provider-budget.js";
import {
  claimResourceChanges,
  completeResourceChanges,
  deferResourceChanges,
  enqueueAllResourceChanges,
  enqueueSelectedResourceChanges,
  ensureResourceChangeTables,
  failResourceChanges,
  hasPendingResourceChanges,
  subscribeResourceChangeConsumer,
  RESOURCE_CHANGE_MAX_ATTEMPTS,
  type ClaimedResourceChange,
  type ResourceChangeFeed,
} from "../resource-changes/store.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "../server/request-context.js";
import { recordUsage } from "../usage/store.js";
import {
  deletePgVectors,
  ensurePgVectorIndex,
  pgVectorIndexMigration,
  queryPgVectorIndex,
  searchNamespaceIdentifiers,
  upsertPgVector,
} from "./lanes.js";
import {
  listSearchableResources,
  searchableResourceSource,
  type SearchableResourceDocument,
  type SearchableResourceRegistration,
} from "./registry.js";
import { readSemanticSearchSetting } from "./semantic-setting.js";

/** The change-feed consumer name the meaning lane subscribes as. */
export const SEMANTIC_CHANGE_CONSUMER = "search-embeddings";

/**
 * The feed that carries a registration's backfill: one change, queued by
 * `semanticSearchMigration`, which a drain runs by queueing every resource
 * for the lane. That writes a row a resource, so it runs in the background,
 * not in a migration boot waits for. The feed's claim, lease and retries run
 * it again if a process stops part way.
 */
const BACKFILL_CONSUMER = "search-embeddings-backfill";
const BACKFILL_RESOURCE_ID = "all";

export const SEARCH_EMBEDDINGS_TABLE = "search_embeddings";

/** pgvector tables are `search_vectors_<dimensions>`. */
const VECTOR_NAMESPACE = "search";

/**
 * Chunks of about 1,200 characters, cut at sentence ends and each led by the
 * title and summary, with a page's best chunk standing for it: the shape the
 * question-search bake-off measured. Bump the version when chunking changes,
 * so every resource is embedded again.
 */
const CHUNK_CHARACTERS = 1_200;
const MAX_CHUNKS = 12;
/** The title and summary leading each chunk are cut to this length. */
const HEAD_CHARACTERS = 400;
const CHUNKING_VERSION = 1;

/** A resource edited more recently than this waits for the next drain. */
const SETTLED_SECONDS = 60;
const CLAIM_BATCH = 16;
const EMBED_BATCH = 32;
/** Chunk matches read per search, before they're folded into resources. */
const QUERY_CHUNK_LIMIT = 100;
const QUERY_EMBED_TIMEOUT_MS = 4_000;
/**
 * A document embedding call that takes longer, or runs past the drain's
 * deadline, fails, so a stalled provider can't hold a claim past its lease.
 */
const DOCUMENT_EMBED_TIMEOUT_MS = 15_000;
/**
 * How long changes wait after the provider answers "rate limited", unless
 * its Retry-After asks for longer, up to the cap.
 */
const RATE_LIMIT_WAIT_SECONDS = 60;
const RATE_LIMIT_MAX_WAIT_SECONDS = 15 * 60;
const SEARCH_FIRST_SECONDS = 2 * 60;
const REFUSED_CREDENTIALS_WAIT_SECONDS = 60 * 60;

/** Thrown when a drain's time is up before its next embedding call. */
class DrainDeadlineReached extends Error {
  constructor() {
    super("The drain's time ran out before embedding finished.");
  }
}
/**
 * Query vectors kept per process, so following pages of one search embed it
 * once and fuse the same matches.
 */
const QUERY_CACHE_MS = 10 * 60_000;
const QUERY_CACHE_ENTRIES = 200;
/** How long a database without a vector store is trusted to stay without one. */
const STORE_RECHECK_MS = 10 * 60_000;

const SEARCH_EMBEDDINGS_CREATE_SQL = `
  CREATE TABLE IF NOT EXISTS ${SEARCH_EMBEDDINGS_TABLE} (
    app TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    audience_id TEXT NOT NULL,
    embedding_set_id TEXT,
    dimensions INTEGER,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    content_hash TEXT NOT NULL,
    embedded_seq BIGINT NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (app, resource_type, resource_id)
  )
`;

const SEARCH_EMBEDDINGS_AUDIENCE_INDEX_SQL = `CREATE INDEX IF NOT EXISTS search_embeddings_audience_idx ON ${SEARCH_EMBEDDINGS_TABLE} (audience_id)`;

/**
 * One row per resource the lane has seen: who it belongs to, and what was
 * embedded for it. A resource whose organization turned the lane off keeps a
 * row with nothing embedded, so turning it back on knows what to embed.
 */
export const semanticSearchStore = defineStore({
  id: "search_embeddings",
  migrations: [{ name: "baseline", run: () => ensureTables() }],
});

export function ensureSemanticSearchTables(
  injectedClient?: DbExec,
): Promise<void> {
  if (injectedClient) return ensureTables(injectedClient);
  return semanticSearchStore.ready();
}

async function ensureTables(injectedClient?: DbExec): Promise<void> {
  const options = injectedClient ? { injectedClient } : {};
  await ensureTableExists(
    SEARCH_EMBEDDINGS_TABLE,
    SEARCH_EMBEDDINGS_CREATE_SQL,
    options,
  );
  await ensureIndexExists(
    "search_embeddings_audience_idx",
    SEARCH_EMBEDDINGS_AUDIENCE_INDEX_SQL,
    options,
  );
}

/**
 * Where vectors live. The default is pgvector in the app's database; a host
 * without it can supply another store through `configureSemanticSearch`.
 */
export interface SearchVectorStore {
  /**
   * Whether this database can hold vectors. Without it, the lane is
   * unavailable. Throws when it can't tell, so the answer isn't remembered.
   */
  available(exec: DbExec): Promise<boolean>;
  upsert(
    exec: DbExec,
    input: {
      embeddingSetId: string;
      dimensions: number;
      audienceIds: readonly string[];
      entries: readonly { key: string; vector: readonly number[] }[];
    },
  ): Promise<void>;
  remove(
    exec: DbExec,
    input: { dimensions: number; keys: readonly string[] },
  ): Promise<void>;
  /** Removes every vector stored for an audience. */
  removeAudience(
    exec: DbExec,
    input: { dimensions: number; audienceId: string },
  ): Promise<void>;
  /** The closest vectors in the set among the audiences, closest first. */
  query(
    exec: DbExec,
    input: {
      embeddingSetId: string;
      dimensions: number;
      vector: readonly number[];
      audienceIds: readonly string[];
      limit: number;
    },
  ): Promise<{ key: string; score: number }[]>;
}

/** Who a resource is embedded as, or the searcher when omitted. */
export interface SemanticEmbeddingIdentity {
  userEmail?: string;
  orgId?: string;
}

export interface SemanticSearchOptions {
  vectorStore?: SearchVectorStore;
  /**
   * The embedding family for an identity, or null when it has none. The
   * default is core's resolver, run as that identity: the organization's
   * Embeddings choice, otherwise Builder.io's gateway, then Gemini, Cohere,
   * and Voyage.
   */
  resolveEmbeddingFamily?: (
    identity: SemanticEmbeddingIdentity | undefined,
  ) => Promise<EmbeddingFamily | null>;
}

let options: SemanticSearchOptions = {};
const queryVectors = new Map<string, { vector: number[]; at: number }>();

/**
 * Replaces the vector store or the embedding resolver. Pass `{}` to return
 * to the defaults. Tests use it to run the lane without pgvector or a
 * provider.
 */
export function configureSemanticSearch(next: SemanticSearchOptions): void {
  options = next;
  storeAvailability.clear();
  queryVectors.clear();
}

function vectorStore(): SearchVectorStore {
  return options.vectorStore ?? pgVectorStore;
}

function resolveFamily(
  identity: SemanticEmbeddingIdentity | undefined,
): Promise<EmbeddingFamily | null> {
  if (options.resolveEmbeddingFamily) {
    return options.resolveEmbeddingFamily(identity);
  }
  if (!identity) return resolveDefaultEmbeddingFamily();
  const { userEmail, orgId } = identity;
  return Promise.resolve(
    runWithRequestContext(
      { ...(userEmail ? { userEmail } : {}), ...(orgId ? { orgId } : {}) },
      resolveDefaultEmbeddingFamily,
    ),
  );
}

/**
 * The organization a user's credentials resolve to when a request names
 * none, or undefined when they have none. Throws when their memberships
 * can't be read.
 */
async function ownerOrgId(
  userEmail: string | undefined,
): Promise<string | undefined> {
  if (!userEmail) return undefined;
  const { resolveOrgIdForEmail } = await import("../org/context.js");
  return (await resolveOrgIdForEmail(userEmail)) ?? undefined;
}

/**
 * The organization whose switch decides whether a resource is embedded: its
 * own, or for one with no organization, its owner's, since that
 * organization's provider embeds it. Resolved as `resolveFamily` resolves
 * credentials, so both name the same organization.
 */
async function governingOrgId(
  identity: SemanticEmbeddingIdentity,
): Promise<string | undefined> {
  if (identity.orgId) return identity.orgId;
  const { userEmail } = identity;
  if (!userEmail) return undefined;
  return runWithRequestContext({ userEmail }, () => ownerOrgId(userEmail));
}

/**
 * The audiences an organization's switch governs: the organization's own,
 * and its members' resources with no organization. A member's resources
 * count even when their credentials resolve to another of their
 * organizations, so turning the lane off never leaves their vectors behind.
 * Binds the audience id, then the organization id.
 */
const GOVERNED_AUDIENCES_SQL = `SELECT CAST(? AS TEXT) AS audience_id
  UNION SELECT 'user:' || LOWER(TRIM(email)) FROM org_members WHERE org_id = ?`;

const storeAvailability = new Map<
  SearchVectorStore,
  { available: boolean; checkedAt: number }
>();

async function storeAvailable(
  exec: DbExec,
  store: SearchVectorStore,
): Promise<boolean> {
  const known = storeAvailability.get(store);
  if (
    known &&
    (known.available || Date.now() - known.checkedAt < STORE_RECHECK_MS)
  ) {
    return known.available;
  }
  const available = await store.available(exec);
  storeAvailability.set(store, { available, checkedAt: Date.now() });
  return available;
}

const ensuredVectorTables = new Set<number>();

const pgVectorStore: SearchVectorStore = {
  async available(exec) {
    // A failed check throws rather than answering no, so a passing database
    // error isn't remembered as a database without pgvector.
    const { rows } = await exec.execute(
      "SELECT installed_version FROM pg_available_extensions WHERE name = 'vector'",
    );
    const [row] = rows;
    if (!row) return false;
    if (row.installed_version != null) return true;
    // Available but not installed: install it now, as the first vector
    // table would, so a database that refuses is found here rather than
    // by every batch failing.
    try {
      await exec.execute("CREATE EXTENSION IF NOT EXISTS vector");
      return true;
    } catch (error) {
      console.warn(
        "[search] Installing pgvector failed, so semantic search is unavailable for now:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  },
  async upsert(exec, input) {
    if (!ensuredVectorTables.has(input.dimensions)) {
      await ensurePgVectorIndex(exec, input.dimensions, {
        namespace: VECTOR_NAMESPACE,
      });
      ensuredVectorTables.add(input.dimensions);
    }
    for (const entry of input.entries) {
      await upsertPgVector(
        exec,
        {
          vectorKey: entry.key,
          embeddingSetId: input.embeddingSetId,
          dimensions: input.dimensions,
          vector: entry.vector,
          audienceIds: input.audienceIds,
        },
        { namespace: VECTOR_NAMESPACE, indexInitialized: true },
      );
    }
  },
  async remove(exec, input) {
    if (!(await vectorTableExists(exec, input.dimensions))) return;
    await deletePgVectors(exec, {
      dimensions: input.dimensions,
      vectorKeys: input.keys,
      namespace: VECTOR_NAMESPACE,
    });
  },
  async removeAudience(exec, input) {
    if (!(await vectorTableExists(exec, input.dimensions))) return;
    const table = searchNamespaceIdentifiers(
      VECTOR_NAMESPACE,
      input.dimensions,
    ).vectorTable;
    // raw-sql-ok: names come from searchNamespaceIdentifiers (lowercase letters, digits, underscores); values are bound.
    await exec.execute({
      sql: `DELETE FROM ${table} WHERE audience_ids && ARRAY[?]::TEXT[]`,
      args: [input.audienceId],
    });
  },
  async query(exec, input) {
    if (!(await vectorTableExists(exec, input.dimensions))) return [];
    const hits = await queryPgVectorIndex(exec, {
      embeddingSetId: input.embeddingSetId,
      dimensions: input.dimensions,
      vector: input.vector,
      allowedAudienceIds: input.audienceIds,
      limit: input.limit,
      namespace: VECTOR_NAMESPACE,
    });
    return hits.map((hit) => ({ key: hit.vectorKey, score: hit.score }));
  },
};

async function vectorTableExists(
  exec: DbExec,
  dimensions: number,
): Promise<boolean> {
  if (ensuredVectorTables.has(dimensions)) return true;
  const table = searchNamespaceIdentifiers(
    VECTOR_NAMESPACE,
    dimensions,
  ).vectorTable;
  const { rows } = await exec.execute({
    sql: "SELECT 1 AS present WHERE to_regclass(?) IS NOT NULL",
    args: [table],
  });
  if (rows.length) ensuredVectorTables.add(dimensions);
  return rows.length > 0;
}

/**
 * The audience id a resource's vectors carry: its organization, or its owner
 * when it has none. Null when it has neither, so it isn't embedded.
 */
export function semanticAudienceId(
  audience: SearchableResourceDocument["audience"],
): string | null {
  const orgId = audience?.orgId?.trim();
  if (orgId) return `org:${orgId}`;
  const owner = audience?.ownerEmail?.trim().toLowerCase();
  return owner ? `user:${owner}` : null;
}

/** The audience ids a searcher may match: their own, and their organizations'. */
export function semanticSearcherAudienceIds(input: {
  userEmail?: string | null | undefined;
  orgIds: readonly string[];
}): string[] {
  const ids = new Set<string>();
  const owner = input.userEmail?.trim().toLowerCase();
  if (owner) ids.add(`user:${owner}`);
  for (const orgId of input.orgIds) {
    const trimmed = orgId.trim();
    if (trimmed) ids.add(`org:${trimmed}`);
  }
  return [...ids];
}

/**
 * A resource's text in chunks of about 1,200 characters, cut at sentence
 * ends, each led by its title and summary, cut to `HEAD_CHARACTERS`. Only the
 * first `MAX_CHUNKS` are embedded. A resource with no text has no chunks.
 */
export function semanticChunks(document: SearchableResourceDocument): string[] {
  const head = [document.title, document.summary]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, HEAD_CHARACTERS)
    .trim();
  const body = (document.body ?? "").replace(/\s+/gu, " ").trim();
  if (!body) return head ? [head] : [];
  const chunks: string[] = [];
  let chunk = "";
  // Sentences end at . ! or ? before a space, or at CJK marks, which take none.
  for (const sentence of body.split(/(?<=[.!?])\s+|(?<=[。！？])\s*/u)) {
    // A sentence longer than a chunk is cut at the chunk length.
    for (let start = 0; start < sentence.length; start += CHUNK_CHARACTERS) {
      if (chunks.length >= MAX_CHUNKS) break;
      const piece = sentence.slice(start, start + CHUNK_CHARACTERS);
      if (chunk && chunk.length + 1 + piece.length > CHUNK_CHARACTERS) {
        chunks.push(chunk);
        chunk = "";
      }
      chunk = chunk ? `${chunk} ${piece}` : piece;
    }
  }
  if (chunk && chunks.length < MAX_CHUNKS) chunks.push(chunk);
  return chunks
    .slice(0, MAX_CHUNKS)
    .map((text) => (head ? `${head}\n${text}` : text));
}

/**
 * The set a resource's vectors belong to. It names the model's version too,
 * so a new version's queries never match vectors an older one made, and a
 * page embedded with an older one counts as changed.
 */
function embeddingSetId(
  registration: SearchableResourceRegistration,
  family: EmbeddingFamily,
): string {
  return `${registration.app}/${registration.type}/${family.id}@${family.version}`;
}

function chunkKeyPrefix(
  registration: SearchableResourceRegistration,
  resourceId: string,
): string {
  return `${registration.app}/${registration.type}/${resourceId}/`;
}

function chunkKeys(
  registration: SearchableResourceRegistration,
  resourceId: string,
  from: number,
  to: number,
): string[] {
  const prefix = chunkKeyPrefix(registration, resourceId);
  return Array.from(
    { length: Math.max(0, to - from) },
    (_, index) => `${prefix}${from + index}`,
  );
}

/** cyrb53, as the word index uses it: enough to skip unchanged work. */
function hash53(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function semanticHash(
  setId: string,
  audienceId: string,
  chunks: readonly string[],
): string {
  const text = [setId, audienceId, ...chunks].join("\u0000");
  return `c${CHUNKING_VERSION}:${text.length}:${hash53(text)}`;
}

/** Recorded for a resource whose organization turned the lane off. */
const OFF_HASH = "off";
/** Recorded for a resource first seen while its owner had no provider. */
const NO_PROVIDER_HASH = "no-provider";
/** Recorded before storing vectors, so a failed store is embedded again. */
const PENDING_HASH = "pending";
/**
 * Recorded when two drains stored a resource's vectors at once, so the next
 * drain embeds it again. A drain finishing meanwhile can't record over it.
 */
const REPAIR_HASH = "repair";

/**
 * A named migration that subscribes the meaning lane to the registration's
 * change feed and asks for a backfill, which the next drain runs by queueing
 * every resource once. Add it to the app's `runMigrations` list after
 * `searchIndexMigration`, whose capture records the changes. Adding another
 * one later embeds every resource again, as a new model needs.
 */
export function semanticSearchMigration(
  registration: SearchableResourceRegistration,
  entry: { version: number; name: string },
): MigrationEntry {
  if (!registration.semantic) {
    throw new Error(
      `Search registration ${registration.app}/${registration.type} needs \`semantic: true\` for semanticSearchMigration.`,
    );
  }
  const source = searchableResourceSource(registration);
  return {
    version: entry.version,
    name: entry.name,
    sql: {},
    run: async (exec) => {
      await ensureSemanticSearchTables(exec);
      await ensureResourceChangeTables(exec);
      // Subscribed first, so a write made while the backfill is queued is
      // recorded for this consumer too.
      await subscribeResourceChangeConsumer(
        exec,
        source,
        SEMANTIC_CHANGE_CONSUMER,
      );
      await enqueueSelectedResourceChanges(
        exec,
        backfillFeedFor(registration),
        {
          sql: `SELECT CAST(? AS TEXT) AS resource_id`,
          args: [BACKFILL_RESOURCE_ID],
        },
        "semantic-backfill",
      );
    },
  };
}

/**
 * A named migration that makes the vector table the meaning lane stores
 * embeddings in, at release, where a hosted request can't. Without it a
 * hosted app reports no vector store and searches by words alone. Pass
 * `dimensions` for a family that isn't built in.
 */
export function semanticVectorStoreMigration(entry: {
  version: number;
  name: string;
  dimensions?: readonly number[];
}): MigrationEntry {
  return pgVectorIndexMigration({
    version: entry.version,
    name: entry.name,
    namespace: VECTOR_NAMESPACE,
    dimensions: entry.dimensions ?? [DEFAULT_EMBEDDING_DIMENSIONS],
  });
}

function backfillFeedFor(
  registration: SearchableResourceRegistration,
): ResourceChangeFeed {
  return {
    consumer: BACKFILL_CONSUMER,
    app: registration.app,
    resourceType: registration.type,
  };
}

/** Registrations whose backfill this process has seen finished. */
const backfilled = new Set<string>();

/**
 * Runs the registration's backfill if one is waiting: queues every resource
 * for the lane, then marks the backfill done. The queued changes wait out
 * the settle window like any other.
 */
async function runBackfill(
  exec: DbExec,
  registration: SearchableResourceRegistration,
): Promise<void> {
  const key = `${registration.app}:${registration.type}`;
  if (backfilled.has(key)) return;
  const feed = backfillFeedFor(registration);
  const claimed = await claimResourceChanges(exec, feed, 1);
  if (claimed.length) {
    try {
      await enqueueAllResourceChanges(
        exec,
        searchableResourceSource(registration),
        SEMANTIC_CHANGE_CONSUMER,
        "semantic-backfill",
      );
    } catch (error) {
      await failResourceChanges(exec, feed, claimed);
      throw error;
    }
    await completeResourceChanges(exec, feed, claimed);
  }
  // Another process may hold it, or be waiting to retry it.
  if (!(await hasPendingResourceChanges(exec, feed))) backfilled.add(key);
}

function feedFor(
  registration: SearchableResourceRegistration,
): ResourceChangeFeed {
  return {
    consumer: SEMANTIC_CHANGE_CONSUMER,
    app: registration.app,
    resourceType: registration.type,
  };
}

const inFlight = new Map<string, Promise<void>>();

/** Embeds pending changes for every semantic registration, in turn, until `deadline`. */
export async function drainAllSemanticIndexes(deadline: number): Promise<void> {
  for (const registration of listSearchableResources()) {
    if (!registration.semantic) continue;
    if (Date.now() >= deadline) return;
    await drainSemanticIndex(registration, deadline);
  }
}

/**
 * Embeds pending changes for one registration until `deadline`, finishing
 * the batch it is on. Concurrent calls in one process share a drain.
 */
export function drainSemanticIndex(
  registration: SearchableResourceRegistration,
  deadline: number,
): Promise<void> {
  const key = `${registration.app}:${registration.type}`;
  const running = inFlight.get(key);
  if (running) return running;
  const run = drain(registration, deadline)
    .catch((error: unknown) => {
      console.error(
        `[search] Embedding ${registration.app}/${registration.type} changes failed:`,
        failureText(error),
      );
    })
    .finally(() => {
      if (inFlight.get(key) === run) inFlight.delete(key);
    });
  inFlight.set(key, run);
  return run;
}

async function drain(
  registration: SearchableResourceRegistration,
  deadline: number,
): Promise<void> {
  const exec = getDbExec();
  const store = vectorStore();
  // Without a vector store the changes stay queued, ready for when one exists.
  if (!(await storeAvailable(exec, store))) return;
  await runBackfill(exec, registration);
  const feed = feedFor(registration);
  const context: DrainContext = {
    deadline,
    limits: new Map(),
    deferred: new Set(),
    finished: new Set(),
  };
  while (Date.now() < deadline) {
    const claimed = await claimResourceChanges(
      exec,
      feed,
      CLAIM_BATCH,
      undefined,
      { settledSeconds: SETTLED_SECONDS },
    );
    if (!claimed.length) return;
    const fresh = claimed.filter((change) => change.attempts <= 1);
    const retries = claimed.filter((change) => change.attempts > 1);
    if (fresh.length) {
      await embedGroup(exec, store, registration, feed, fresh, context);
    }
    for (const change of retries) {
      // Changes left claimed are claimed again when their lease expires.
      if (Date.now() >= deadline) return;
      await embedGroup(exec, store, registration, feed, [change], context);
    }
  }
}

/**
 * Providers that answered "rate limited" during one drain, by the
 * credentials they were called with, and the seconds their pages wait. Their
 * other pages wait too, without another call.
 */
type RateLimits = Map<string, number>;

interface DrainContext {
  deadline: number;
  limits: RateLimits;
  /** Changes already put back for a rate limit, so none is put back twice. */
  deferred: Set<ClaimedResourceChange>;
  /** Changes already completed, so none is embedded again when a batch fails. */
  finished: Set<ClaimedResourceChange>;
}

/**
 * The seconds to wait when the provider refused a call because the caller is
 * rate limited, which every other call would meet too until the wait is over.
 */
function rateLimitWaitSeconds(error: unknown): number | undefined {
  if (!(error instanceof EmbeddingProviderError) || error.status !== 429) {
    return undefined;
  }
  const asked = Math.ceil((error.retryAfterMs ?? 0) / 1000);
  return Math.min(
    RATE_LIMIT_MAX_WAIT_SECONDS,
    Math.max(RATE_LIMIT_WAIT_SECONDS, asked),
  );
}

function changesWait(count: number, seconds: number): string {
  return `${count} ${count === 1 ? "change waits" : "changes wait"} ${seconds}s`;
}

function refusedCredentialsWaitSeconds(error: unknown): number | undefined {
  return error instanceof EmbeddingProviderError &&
    (error.status === 401 || error.status === 403)
    ? REFUSED_CREDENTIALS_WAIT_SECONDS
    : undefined;
}

function failureText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error instanceof EmbeddingProviderError && error.code
    ? `${error.message} The provider's code: ${error.code}.`
    : error.message;
}

/** Puts changes back untried, logging rather than throwing when it can't. */
async function deferAfterRateLimit(
  exec: DbExec,
  feed: ResourceChangeFeed,
  changes: ClaimedResourceChange[],
  seconds: number,
  deferred: Set<ClaimedResourceChange>,
  countAttempt = false,
): Promise<void> {
  for (const change of changes) deferred.add(change);
  // Changes not put back are claimed again when their lease expires.
  await deferResourceChanges(exec, feed, changes, seconds, undefined, {
    countAttempt,
  }).catch((error: unknown) => {
    console.error(
      `[search] Putting back ${changes.length} ${feed.app}/${feed.resourceType} changes to wait failed, so they are retried when their claim expires:`,
      error instanceof Error ? error.message : String(error),
    );
  });
}

function documentBudgetScope({
  scope,
  policy,
}: NonNullable<EmbeddingFamily["documentBudget"]>): ProviderConnectionScope {
  return {
    ...scope,
    connectionId: `${scope.connectionId}:${policy.capacity}/${policy.windowMs}`,
  };
}

async function documentBudgetWait(
  family: EmbeddingFamily,
  label: string,
  deadline: number,
): Promise<number | undefined> {
  const budget = family.documentBudget;
  if (!budget) return undefined;
  if (Date.now() >= deadline) throw new DrainDeadlineReached();
  let admission: ProviderAdmission;
  try {
    admission = await reserveProviderBudget(
      documentBudgetScope(budget),
      budget.policy,
    );
  } catch (error) {
    console.warn(
      `[search] Reading the embedding provider's budget for ${label} failed, so indexing goes on without it:`,
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
  if (admission.status === "paused") {
    if (admission.resumeAt === null) return RATE_LIMIT_MAX_WAIT_SECONDS;
    return Math.max(1, Math.ceil((admission.resumeAt - Date.now()) / 1000));
  }
  if (Date.now() >= deadline) {
    await releaseProviderBudgetReservation(admission).catch(
      (error: unknown) => {
        console.warn(
          `[search] Returning an unused call to the embedding provider's budget for ${label} failed:`,
          error instanceof Error ? error.message : String(error),
        );
      },
    );
    throw new DrainDeadlineReached();
  }
  return undefined;
}

async function holdDocumentBudget(
  family: EmbeddingFamily,
  seconds: number,
  label: string,
): Promise<void> {
  const budget = family.documentBudget;
  if (!budget) return;
  try {
    await pauseProviderBudget(
      documentBudgetScope(budget),
      { reason: "provider_throttle", resumeAt: Date.now() + seconds * 1000 },
      budget.policy,
    );
  } catch (error) {
    console.warn(
      `[search] Holding back ${label} indexing on every server failed:`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Embeds a claimed batch. When a batch fails, each change is retried alone,
 * so one resource that can't be embedded only holds back itself.
 */
async function embedGroup(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  changes: ClaimedResourceChange[],
  context: DrainContext,
): Promise<void> {
  const { deadline } = context;
  const label = `${registration.app}/${registration.type}`;
  try {
    await embedChanges(exec, store, registration, feed, changes, context);
  } catch (error) {
    // Out of time isn't a failure: the changes stay claimed, and are claimed
    // again when their lease expires.
    if (error instanceof DrainDeadlineReached || Date.now() >= deadline) return;
    const message = failureText(error);
    const only = changes.length === 1 ? changes.at(0) : undefined;
    if (!only) {
      console.warn(
        `[search] Embedding ${changes.length} ${label} changes together failed, so each is retried alone:`,
        message,
      );
      for (const change of changes) {
        // Changes left claimed are claimed again when their lease expires.
        if (Date.now() >= deadline) return;
        // Changes put back for a rate limit wait it out already, and finished
        // ones are done.
        if (context.deferred.has(change) || context.finished.has(change)) {
          continue;
        }
        await embedGroup(exec, store, registration, feed, [change], context);
      }
      return;
    }
    console.error(
      `[search] Embedding ${label} "${only.resourceId}" failed on attempt ${only.attempts}` +
        (only.attempts >= RESOURCE_CHANGE_MAX_ATTEMPTS
          ? "; it keeps being retried every few minutes"
          : "") +
        ":",
      message,
    );
    await failResourceChanges(exec, feed, changes).catch(
      (backoffError: unknown) => {
        console.error(
          `[search] Recording the failure of ${label} "${only.resourceId}" failed, so it is retried when its claim expires:`,
          backoffError instanceof Error
            ? backoffError.message
            : String(backoffError),
        );
      },
    );
  }
}

interface StoredEmbedding {
  audienceId: string;
  dimensions: number | null;
  chunkCount: number;
  contentHash: string;
}

async function storedEmbeddings(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  ids: readonly string[],
): Promise<Map<string, StoredEmbedding>> {
  // raw-sql-ok: only a ? placeholder per value is interpolated; values are bound.
  const { rows } = await exec.execute({
    sql: `SELECT resource_id, audience_id, dimensions, chunk_count, content_hash
          FROM search_embeddings
          WHERE app = ? AND resource_type = ? AND resource_id IN (${ids.map(() => "?").join(", ")})`,
    args: [registration.app, registration.type, ...ids],
  });
  return new Map(
    rows.map((row) => [
      String(row.resource_id),
      {
        audienceId: String(row.audience_id),
        dimensions: row.dimensions == null ? null : Number(row.dimensions),
        chunkCount: Number(row.chunk_count),
        contentHash: String(row.content_hash),
      },
    ]),
  );
}

interface PendingEmbedding {
  change: ClaimedResourceChange;
  chunks: string[];
  hash: string;
  stored: StoredEmbedding | undefined;
}

interface AudienceGroup {
  identity: SemanticEmbeddingIdentity;
  audienceId: string;
  items: {
    change: ClaimedResourceChange;
    document: SearchableResourceDocument;
  }[];
}

async function embedChanges(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  changes: ClaimedResourceChange[],
  context: DrainContext,
): Promise<void> {
  const { deadline } = context;
  const ids = changes.map((change) => change.resourceId);
  const documents = await registration.load(ids);
  const byId = new Map(documents.map((document) => [document.id, document]));
  const stored = await storedEmbeddings(exec, registration, ids);
  const done: ClaimedResourceChange[] = [];
  const groups = new Map<string, AudienceGroup>();
  try {
    for (const change of changes) {
      const document = byId.get(change.resourceId);
      const audienceId =
        document && document.semantic !== false
          ? semanticAudienceId(document.audience)
          : null;
      if (!document || !audienceId) {
        await forgetResource(
          exec,
          store,
          registration,
          change,
          stored.get(change.resourceId),
        );
        done.push(change);
        continue;
      }
      const orgId = document.audience?.orgId?.trim() || undefined;
      const userEmail = document.audience?.ownerEmail?.trim() || undefined;
      const groupKey = `${audienceId}\u0000${userEmail ?? ""}`;
      const group: AudienceGroup = groups.get(groupKey) ?? {
        identity: {
          ...(userEmail ? { userEmail } : {}),
          ...(orgId ? { orgId } : {}),
        },
        audienceId,
        items: [],
      };
      group.items.push({ change, document });
      groups.set(groupKey, group);
    }
    for (const group of groups.values()) {
      // Changes in the groups left over stay claimed for the next drain.
      if (Date.now() >= deadline) break;
      await embedAudienceGroup(exec, store, registration, feed, group, stored, {
        ...context,
        done,
      });
    }
  } finally {
    // Completed even when a later change throws, such as at the deadline, so
    // finished work isn't claimed again.
    await completeResourceChanges(exec, feed, done);
    for (const change of done) context.finished.add(change);
  }
}

async function embedAudienceGroup(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  group: AudienceGroup,
  stored: Map<string, StoredEmbedding>,
  {
    done,
    deferred,
    deadline,
    limits,
  }: DrainContext & { done: ClaimedResourceChange[] },
): Promise<void> {
  // An unreadable setting or membership throws, so nothing is sent until it
  // reads as on.
  const orgId = await governingOrgId(group.identity);
  if (
    orgId &&
    !(await readSemanticSearchSetting(orgId, { fresh: true })).enabled
  ) {
    for (const { change } of group.items) {
      await recordOff(
        exec,
        store,
        registration,
        change,
        group.audienceId,
        stored,
      );
      done.push(change);
    }
    return;
  }
  const family = await resolveFamily(group.identity);
  if (!family) {
    // Nothing can embed for this owner. The row keeps its audience, so
    // choosing a provider later queues it. Vectors from an earlier provider
    // carry its set id, which searches with another family never match.
    for (const { change } of group.items) {
      const previous = stored.get(change.resourceId);
      if (
        previous?.dimensions != null &&
        previous.audienceId !== group.audienceId
      ) {
        // Its vectors still carry the audience it had, but its row will name
        // the new one, so turning the old audience's lane off would never
        // find them; they're deleted now. The row is claimed for this change
        // first, so work a later change already finished is never deleted.
        if (await markPending(exec, registration, change)) {
          await removeVectors(
            exec,
            store,
            registration,
            change.resourceId,
            previous,
          );
          await recordEmbedding(exec, registration, {
            resourceId: change.resourceId,
            audienceId: group.audienceId,
            setId: null,
            dimensions: null,
            chunkCount: 0,
            hash: NO_PROVIDER_HASH,
            seq: change.seq,
          });
        }
        done.push(change);
        continue;
      }
      await recordAudience(exec, registration, change, group.audienceId);
      done.push(change);
    }
    return;
  }
  const setId = embeddingSetId(registration, family);
  const pending: PendingEmbedding[] = [];
  for (const { change, document } of group.items) {
    const chunks = semanticChunks(document);
    const previous = stored.get(change.resourceId);
    if (!chunks.length) {
      await forgetResource(exec, store, registration, change, previous);
      done.push(change);
      continue;
    }
    const hash = semanticHash(setId, group.audienceId, chunks);
    if (previous?.contentHash === hash) {
      done.push(change);
      continue;
    }
    pending.push({ change, chunks, hash, stored: previous });
  }
  if (!pending.length) return;
  const label = `${registration.app}/${registration.type}`;
  // A provider rate limits the credentials it's called with. Members of one
  // organization can resolve different ones, such as a personal key, so a
  // limit holds back one owner's pages; owners sharing credentials each learn
  // of it from one refused call.
  const scope = [family.id, orgId ?? "", group.identity.userEmail ?? ""].join(
    "\u0000",
  );
  // Each call embeds whole pages, stored before the next call, so a provider
  // that starts refusing part way keeps what it already embedded. A provider
  // that takes fewer inputs a request gets fewer pages a call.
  const slices = wholePageSlices(
    pending,
    Math.min(EMBED_BATCH, family.inputsPerRequest ?? EMBED_BATCH),
  );
  for (const [index, slice] of slices.entries()) {
    const left = slices
      .slice(index)
      .flat()
      .map((item) => item.change);
    const limited =
      limits.get(scope) ?? (await documentBudgetWait(family, label, deadline));
    if (limited !== undefined) {
      limits.set(scope, limited);
      await deferAfterRateLimit(exec, feed, left, limited, deferred);
      return;
    }
    let on: boolean;
    try {
      on = await embedAndStore(
        exec,
        store,
        registration,
        feed,
        group,
        stored,
        slice,
        { family, setId, orgId, done, deadline },
      );
    } catch (error) {
      const limited = rateLimitWaitSeconds(error);
      const wait = limited ?? refusedCredentialsWaitSeconds(error);
      if (wait === undefined) throw error;
      const sent =
        limited === undefined ? slice.map((item) => item.change) : [];
      const rest = left.slice(sent.length);
      console.warn(
        limited === undefined
          ? `[search] The embedding provider refused the credentials for ${label}. Of the changes left, ${changesWait(sent.length, 2 * wait)} (those it was sent, retried one by one next) and ${changesWait(rest.length, wait)}:`
          : `[search] The embedding provider is rate limiting ${label}, so ${changesWait(rest.length, wait)}:`,
        failureText(error),
      );
      limits.set(scope, wait);
      await holdDocumentBudget(family, wait, label);
      await deferAfterRateLimit(exec, feed, sent, 2 * wait, deferred, true);
      // Put back now, so they wait even if a later group runs out of time.
      await deferAfterRateLimit(exec, feed, rest, wait, deferred);
      return;
    }
    if (!on) {
      // The lane was turned off, so the pages not embedded yet are recorded
      // off without being sent.
      for (const item of slices.slice(index + 1).flat()) {
        await recordOff(
          exec,
          store,
          registration,
          item.change,
          group.audienceId,
          stored,
        );
        done.push(item.change);
      }
      return;
    }
  }
}

/**
 * Pending pages in runs of whole pages of at most `limit` chunks, each sent
 * in one embedding call. A page with more chunks than that goes alone.
 */
function wholePageSlices(
  pending: PendingEmbedding[],
  limit: number,
): PendingEmbedding[][] {
  const slices: PendingEmbedding[][] = [];
  let slice: PendingEmbedding[] = [];
  let chunks = 0;
  for (const item of pending) {
    if (slice.length && chunks + item.chunks.length > limit) {
      slices.push(slice);
      slice = [];
      chunks = 0;
    }
    slice.push(item);
    chunks += item.chunks.length;
  }
  if (slice.length) slices.push(slice);
  return slices;
}

/**
 * Embeds pages and stores their vectors. Returns false, with the pages
 * recorded off, when the organization turned the lane off meanwhile.
 */
async function embedAndStore(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  group: AudienceGroup,
  stored: Map<string, StoredEmbedding>,
  pending: PendingEmbedding[],
  {
    family,
    setId,
    orgId,
    done,
    deadline,
  }: {
    family: EmbeddingFamily;
    setId: string;
    orgId: string | undefined;
    done: ClaimedResourceChange[];
    deadline: number;
  },
): Promise<boolean> {
  const vectors = await embedDocumentChunks(
    family,
    pending.flatMap((item) => item.chunks),
    { registration, identity: group.identity, deadline },
  );
  // The organization may have turned the lane off while its text was being
  // embedded; then nothing is stored.
  if (
    orgId &&
    !(await readSemanticSearchSetting(orgId, { fresh: true })).enabled
  ) {
    for (const item of pending) {
      await recordOff(
        exec,
        store,
        registration,
        item.change,
        group.audienceId,
        stored,
      );
      done.push(item.change);
    }
    return false;
  }
  const written: { change: ClaimedResourceChange; chunkCount: number }[] = [];
  let offset = 0;
  for (const item of pending) {
    const own = vectors.slice(offset, offset + item.chunks.length);
    offset += item.chunks.length;
    const previous = item.stored;
    // Vectors from a model with other dimensions live in another table. The
    // row is claimed for this change first, so work a later change already
    // finished is never deleted.
    if (
      previous?.dimensions != null &&
      previous.dimensions !== family.dimensions
    ) {
      if (!(await markPending(exec, registration, item.change))) {
        done.push(item.change);
        continue;
      }
      await removeVectors(
        exec,
        store,
        registration,
        item.change.resourceId,
        previous,
      );
    }
    const kept =
      previous?.dimensions === family.dimensions ? previous.chunkCount : 0;
    // Recorded as pending first, counting every chunk that may exist, so if
    // storing fails the retry embeds the page again, and deleting the page
    // still finds all of its vectors.
    const current = await recordEmbedding(exec, registration, {
      resourceId: item.change.resourceId,
      audienceId: group.audienceId,
      setId,
      dimensions: family.dimensions,
      chunkCount: Math.max(own.length, kept),
      hash: PENDING_HASH,
      seq: item.change.seq,
    });
    // A later change already recorded newer work for this resource.
    if (!current) {
      done.push(item.change);
      continue;
    }
    const keys = chunkKeys(registration, item.change.resourceId, 0, own.length);
    await store.upsert(exec, {
      embeddingSetId: setId,
      dimensions: family.dimensions,
      audienceIds: [group.audienceId],
      entries: own.map((vector, index) => ({
        key:
          keys[index] ??
          `${chunkKeyPrefix(registration, item.change.resourceId)}${index}`,
        vector,
      })),
    });
    if (kept > own.length) {
      await store.remove(exec, {
        dimensions: family.dimensions,
        keys: chunkKeys(registration, item.change.resourceId, own.length, kept),
      });
    }
    const finished = await finishEmbedding(exec, registration, {
      resourceId: item.change.resourceId,
      setId,
      dimensions: family.dimensions,
      chunkCount: own.length,
      hash: item.hash,
      seq: item.change.seq,
    });
    if (!finished) {
      // Another drain stored or deleted this resource's vectors at the same
      // time, for a later change or asking for repair, so either may have
      // replaced the other's chunks or added ones the row doesn't count.
      await repairOverlappingStore(exec, store, registration, feed, {
        resourceId: item.change.resourceId,
        dimensions: family.dimensions,
        chunkCount: own.length,
      });
      done.push(item.change);
      continue;
    }
    written.push({ change: item.change, chunkCount: own.length });
    done.push(item.change);
  }
  // Turning the lane off deletes the vectors of every audience it governs
  // after saving the setting. Checking again after storing means that either
  // that deletion sees these vectors or this check sees the setting.
  if (
    orgId &&
    written.length &&
    !(await readSemanticSearchSetting(orgId, { fresh: true })).enabled
  ) {
    for (const { change, chunkCount } of written) {
      await store.remove(exec, {
        dimensions: family.dimensions,
        keys: chunkKeys(registration, change.resourceId, 0, chunkCount),
      });
      await recordEmbedding(exec, registration, {
        resourceId: change.resourceId,
        audienceId: group.audienceId,
        setId: null,
        dimensions: null,
        chunkCount: 0,
        hash: OFF_HASH,
        seq: change.seq,
      });
    }
    return false;
  }
  return true;
}

/**
 * Repairs after two drains stored a resource's vectors at once: marks its row
 * for repair, counting every chunk either may have written, and queues it so
 * the next drain embeds its current text over them and removes the extras.
 */
async function repairOverlappingStore(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  feed: ResourceChangeFeed,
  written: { resourceId: string; dimensions: number; chunkCount: number },
): Promise<void> {
  const { rows } = await exec.execute({
    sql: `UPDATE search_embeddings
          SET chunk_count = GREATEST(chunk_count, ?::integer), content_hash = ?
          WHERE app = ? AND resource_type = ? AND resource_id = ? AND dimensions = ?::integer
          RETURNING resource_id`,
    args: [
      written.chunkCount,
      REPAIR_HASH,
      registration.app,
      registration.type,
      written.resourceId,
      written.dimensions,
    ],
  });
  if (rows.length) {
    await enqueueSelectedResourceChanges(
      exec,
      feed,
      {
        sql: `SELECT CAST(? AS TEXT) AS resource_id`,
        args: [written.resourceId],
      },
      "semantic-repair",
    );
    return;
  }
  // The later change deleted the resource, turned the lane off, or used
  // another model, so nothing it stored shares these keys.
  await store.remove(exec, {
    dimensions: written.dimensions,
    keys: chunkKeys(registration, written.resourceId, 0, written.chunkCount),
  });
}

/** Embeds document chunks in batches, recording each call as the owner's usage. */
async function embedDocumentChunks(
  family: EmbeddingFamily,
  texts: readonly string[],
  context: {
    registration: SearchableResourceRegistration;
    identity: SemanticEmbeddingIdentity;
    deadline: number;
  },
): Promise<number[][]> {
  const vectors: number[][] = [];
  for (let start = 0; start < texts.length; start += EMBED_BATCH) {
    const remaining = context.deadline - Date.now();
    if (remaining <= 0) throw new DrainDeadlineReached();
    const batch = texts.slice(start, start + EMBED_BATCH);
    const embedded = await family.embed(
      batch.map((text) => ({ text })),
      "document",
      {
        signal: AbortSignal.timeout(
          Math.min(DOCUMENT_EMBED_TIMEOUT_MS, remaining),
        ),
      },
    );
    if (embedded.length !== batch.length) {
      throw new Error(
        `The embedding provider returned ${embedded.length} vectors for ${batch.length} chunks.`,
      );
    }
    vectors.push(...embedded);
    await recordEmbeddingUsage(family, batch, {
      ownerEmail: context.identity.userEmail,
      orgId: context.identity.orgId,
      app: context.registration.app,
      label: "search-index-embeddings",
    });
  }
  return vectors;
}

/**
 * Records embedding calls as usage. Providers here report no token counts,
 * so tokens are estimated at four characters each and the cost is left
 * unknown rather than priced as chat.
 */
async function recordEmbeddingUsage(
  family: EmbeddingFamily,
  texts: readonly string[],
  record: {
    ownerEmail: string | undefined;
    orgId: string | undefined;
    app: string;
    label: string;
  },
): Promise<void> {
  if (!record.ownerEmail) return;
  const characters = texts.reduce((sum, text) => sum + text.length, 0);
  try {
    await recordUsage({
      ownerEmail: record.ownerEmail,
      inputTokens: Math.max(1, Math.ceil(characters / 4)),
      outputTokens: 0,
      model: family.model,
      label: record.label,
      app: record.app,
      engineName: family.provider,
      costSource: "unavailable",
      ...(record.orgId ? { orgId: record.orgId } : {}),
    });
  } catch (error) {
    // The embedding already happened; losing its usage row shouldn't undo it.
    console.warn(
      "[search] Recording embedding usage failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Records what was embedded for a resource, unless a later change already
 * recorded newer work. Returns whether this change's work is current.
 */
async function recordEmbedding(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  input: {
    resourceId: string;
    audienceId: string;
    setId: string | null;
    dimensions: number | null;
    chunkCount: number;
    hash: string;
    seq: string;
  },
): Promise<boolean> {
  const { rows } = await exec.execute({
    sql: `INSERT INTO search_embeddings
            (app, resource_type, resource_id, audience_id, embedding_set_id, dimensions,
             chunk_count, content_hash, embedded_seq, embedded_at)
          VALUES (?, ?, ?, ?, ?, ?::integer, ?::integer, ?, ?::bigint, now())
          ON CONFLICT (app, resource_type, resource_id) DO UPDATE SET
            audience_id = EXCLUDED.audience_id,
            embedding_set_id = EXCLUDED.embedding_set_id,
            dimensions = EXCLUDED.dimensions,
            chunk_count = EXCLUDED.chunk_count,
            content_hash = EXCLUDED.content_hash,
            embedded_seq = EXCLUDED.embedded_seq,
            embedded_at = EXCLUDED.embedded_at
          WHERE search_embeddings.embedded_seq <= EXCLUDED.embedded_seq
          RETURNING resource_id`,
    args: [
      registration.app,
      registration.type,
      input.resourceId,
      input.audienceId,
      input.setId,
      input.dimensions,
      input.chunkCount,
      input.hash,
      input.seq,
    ],
  });
  return rows.length > 0;
}

/**
 * Records that a change's vectors are stored. It only updates the row its
 * pending write made, so it records nothing once a later change recorded
 * newer work or deleted the row, or a repair was asked for. Returns whether
 * it recorded.
 */
async function finishEmbedding(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  input: {
    resourceId: string;
    setId: string;
    dimensions: number;
    chunkCount: number;
    hash: string;
    seq: string;
  },
): Promise<boolean> {
  const { rows } = await exec.execute({
    sql: `UPDATE search_embeddings
          SET embedding_set_id = ?, dimensions = ?::integer, chunk_count = ?::integer,
              content_hash = ?, embedded_seq = ?::bigint, embedded_at = now()
          WHERE app = ? AND resource_type = ? AND resource_id = ?
            AND embedded_seq <= ?::bigint AND content_hash <> ?
          RETURNING resource_id`,
    args: [
      input.setId,
      input.dimensions,
      input.chunkCount,
      input.hash,
      input.seq,
      registration.app,
      registration.type,
      input.resourceId,
      input.seq,
      REPAIR_HASH,
    ],
  });
  return rows.length > 0;
}

/**
 * Marks a resource's row pending for a change, keeping what it records, unless
 * a later change already recorded newer work. Returns whether it did.
 */
async function markPending(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  change: ClaimedResourceChange,
): Promise<boolean> {
  const { rows } = await exec.execute({
    sql: `UPDATE search_embeddings SET content_hash = ?, embedded_seq = ?::bigint
          WHERE app = ? AND resource_type = ? AND resource_id = ?
            AND embedded_seq <= ?::bigint
          RETURNING resource_id`,
    args: [
      PENDING_HASH,
      change.seq,
      registration.app,
      registration.type,
      change.resourceId,
      change.seq,
    ],
  });
  return rows.length > 0;
}

/**
 * Records a resource's audience, keeping whatever was embedded for it, and
 * claims its row for the change, so an older drain still running records
 * nothing over it.
 */
async function recordAudience(
  exec: DbExec,
  registration: SearchableResourceRegistration,
  change: ClaimedResourceChange,
  audienceId: string,
): Promise<void> {
  await exec.execute({
    sql: `INSERT INTO search_embeddings
            (app, resource_type, resource_id, audience_id, chunk_count, content_hash, embedded_seq)
          VALUES (?, ?, ?, ?, 0, ?, ?::bigint)
          ON CONFLICT (app, resource_type, resource_id) DO UPDATE SET
            audience_id = EXCLUDED.audience_id,
            embedded_seq = EXCLUDED.embedded_seq
          WHERE search_embeddings.embedded_seq <= EXCLUDED.embedded_seq`,
    args: [
      registration.app,
      registration.type,
      change.resourceId,
      audienceId,
      NO_PROVIDER_HASH,
      change.seq,
    ],
  });
}

/** Keeps a resource's audience with nothing embedded, deleting what was. */
async function recordOff(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  change: ClaimedResourceChange,
  audienceId: string,
  stored: Map<string, StoredEmbedding>,
): Promise<void> {
  const previous = stored.get(change.resourceId);
  // Claimed for the change first, as `forgetResource` does, so vectors a
  // later change stored under the same keys are never deleted.
  if (previous && !(await markPending(exec, registration, change))) return;
  await removeVectors(exec, store, registration, change.resourceId, previous);
  await recordEmbedding(exec, registration, {
    resourceId: change.resourceId,
    audienceId,
    setId: null,
    dimensions: null,
    chunkCount: 0,
    hash: OFF_HASH,
    seq: change.seq,
  });
}

async function removeVectors(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  resourceId: string,
  previous: StoredEmbedding | undefined,
): Promise<void> {
  if (previous?.dimensions == null || previous.chunkCount <= 0) return;
  await store.remove(exec, {
    dimensions: previous.dimensions,
    keys: chunkKeys(registration, resourceId, 0, previous.chunkCount),
  });
}

/**
 * Deletes a resource's vectors and its row: it's gone, or has no text or
 * owner. The row is claimed for the change first, and deleted only while it's
 * still this change's, so work a later change recorded is never deleted.
 */
async function forgetResource(
  exec: DbExec,
  store: SearchVectorStore,
  registration: SearchableResourceRegistration,
  change: ClaimedResourceChange,
  previous: StoredEmbedding | undefined,
): Promise<void> {
  if (previous && !(await markPending(exec, registration, change))) return;
  await removeVectors(exec, store, registration, change.resourceId, previous);
  await exec.execute({
    sql: `DELETE FROM search_embeddings
          WHERE app = ? AND resource_type = ? AND resource_id = ?
            AND embedded_seq <= ?::bigint`,
    args: [registration.app, registration.type, change.resourceId, change.seq],
  });
}

/**
 * Deletes every vector stored for the resources an organization's switch
 * governs, keeping each resource's row so `requeueSemanticSearchForOrg` can
 * embed them again. Called when the organization turns semantic search off.
 */
export async function forgetSemanticSearchForOrg(orgId: string): Promise<void> {
  await ensureSemanticSearchTables();
  const exec = getDbExec();
  // raw-sql-ok: GOVERNED_AUDIENCES_SQL is a constant; values are bound.
  const { rows } = await exec.execute({
    sql: `SELECT DISTINCT audience_id, dimensions FROM search_embeddings
          WHERE dimensions IS NOT NULL
            AND audience_id IN (${GOVERNED_AUDIENCES_SQL})`,
    args: [`org:${orgId}`, orgId],
  });
  const store = vectorStore();
  for (const row of rows) {
    await store.removeAudience(exec, {
      dimensions: Number(row.dimensions),
      audienceId: String(row.audience_id),
    });
  }
  // A pending or repairing row may have vectors being stored right now,
  // after the deletion above. It keeps its count, so the drain, which sees
  // the lane off when it retries or checks after storing, can delete them.
  // raw-sql-ok: GOVERNED_AUDIENCES_SQL is a constant; values are bound.
  await exec.execute({
    sql: `UPDATE search_embeddings
          SET embedding_set_id = NULL, dimensions = NULL, chunk_count = 0, content_hash = ?
          WHERE content_hash NOT IN (?, ?)
            AND audience_id IN (${GOVERNED_AUDIENCES_SQL})`,
    args: [OFF_HASH, PENDING_HASH, REPAIR_HASH, `org:${orgId}`, orgId],
  });
  // A member whose credentials resolve to another of their organizations
  // lost vectors that organization's switch still allows. Queued again, the
  // drain embeds those and leaves the rest off.
  for (const registration of listSearchableResources()) {
    if (!registration.semantic) continue;
    // raw-sql-ok: GOVERNED_AUDIENCES_SQL is a constant; values are bound.
    await enqueueSelectedResourceChanges(
      exec,
      feedFor(registration),
      {
        sql: `SELECT resource_id FROM search_embeddings
              WHERE app = ? AND resource_type = ? AND audience_id <> ?
                AND audience_id IN (${GOVERNED_AUDIENCES_SQL})`,
        args: [
          registration.app,
          registration.type,
          `org:${orgId}`,
          `org:${orgId}`,
          orgId,
        ],
      },
      "semantic-requeue",
    );
  }
  // Another admin may have turned the lane back on while this ran, and
  // queued the pages before the update above cleared their rows. Queued
  // again, the drain embeds them.
  if ((await readSemanticSearchSetting(orgId, { fresh: true })).enabled) {
    await requeueSemanticSearchForOrg(orgId);
  }
}

/**
 * Queues the resources an organization's switch governs to be embedded
 * again: after it turns semantic search back on, or changes the provider its
 * embeddings use. Pages never embedded have no row to say whose they are, so
 * every queued change without one is retried now too, whichever organization
 * it belongs to.
 */
export async function requeueSemanticSearchForOrg(
  orgId: string,
): Promise<void> {
  await ensureSemanticSearchTables();
  const exec = getDbExec();
  for (const registration of listSearchableResources()) {
    if (!registration.semantic) continue;
    // raw-sql-ok: GOVERNED_AUDIENCES_SQL is a constant; values are bound.
    await enqueueSelectedResourceChanges(
      exec,
      feedFor(registration),
      {
        sql: `SELECT resource_id FROM search_embeddings
              WHERE app = ? AND resource_type = ?
                AND audience_id IN (${GOVERNED_AUDIENCES_SQL})
              UNION
              SELECT c.resource_id FROM app_resource_changes AS c
              WHERE c.consumer = ? AND c.app = ? AND c.resource_type = ?
                AND NOT EXISTS (
                  SELECT 1 FROM search_embeddings AS e
                  WHERE e.app = c.app AND e.resource_type = c.resource_type
                    AND e.resource_id = c.resource_id
                )`,
        args: [
          registration.app,
          registration.type,
          `org:${orgId}`,
          orgId,
          SEMANTIC_CHANGE_CONSUMER,
          registration.app,
          registration.type,
        ],
      },
      "semantic-requeue",
    );
  }
}

async function queryVector(
  family: EmbeddingFamily,
  query: string,
  usage: {
    ownerEmail: string | undefined;
    orgId: string | undefined;
    app: string;
  },
  label: string,
): Promise<number[]> {
  const key = `${family.id}\u0000${family.version}\u0000${query}`;
  const cached = queryVectors.get(key);
  if (cached && Date.now() - cached.at < QUERY_CACHE_MS) {
    // Re-inserted, so the map's order runs from least to most recently used.
    queryVectors.delete(key);
    queryVectors.set(key, cached);
    return cached.vector;
  }
  const vectors = await family
    .embed([{ text: query }], "query", {
      signal: AbortSignal.timeout(QUERY_EMBED_TIMEOUT_MS),
    })
    .catch(async (error: unknown) => {
      const wait = rateLimitWaitSeconds(error);
      if (wait !== undefined && family.documentBudget) {
        const seconds = Math.max(SEARCH_FIRST_SECONDS, wait);
        console.warn(
          `[search] ${label} searches were rate limited, so indexing with the same credentials waits ${seconds}s on every server:`,
          failureText(error),
        );
        await holdDocumentBudget(family, seconds, label);
      }
      throw error;
    });
  const vector = vectors.at(0);
  if (!vector) throw new Error("The embedding provider returned no vector.");
  await recordEmbeddingUsage(family, [query], {
    ...usage,
    label: "search-query-embeddings",
  });
  queryVectors.delete(key);
  queryVectors.set(key, { vector, at: Date.now() });
  for (const oldest of queryVectors.keys()) {
    if (queryVectors.size <= QUERY_CACHE_ENTRIES) break;
    queryVectors.delete(oldest);
  }
  return vector;
}

export type SemanticSearchUnavailableReason =
  /** No embedding provider answers for the searcher. */
  | "no-provider"
  /** The database has no vector store (pgvector). */
  | "no-vector-store"
  /** Embedding the query or reading vectors failed. */
  | "error";

export type SemanticSearchResult =
  | { status: "used"; hits: { id: string; score: number }[] }
  | { status: "off" }
  | { status: "unavailable"; reason: SemanticSearchUnavailableReason };

/**
 * Finds the resources whose text is closest in meaning to `query`, among the
 * audiences given, best first, as the current request's user. The caller
 * must still check access to each hit. It never throws: when the lane can't
 * answer, it says why, and the caller answers by words alone.
 */
export async function searchSemanticIndex(
  registration: SearchableResourceRegistration,
  input: { query: string; audienceIds: readonly string[]; limit: number },
): Promise<SemanticSearchResult> {
  const label = `${registration.app}/${registration.type}`;
  const orgId = getRequestOrgId();
  const audienceIds: string[] = [];
  try {
    const switches = new Map<string, Promise<boolean>>();
    const isOn = (id: string) => {
      const known = switches.get(id);
      if (known) return known;
      const on = readSemanticSearchSetting(id).then(
        (setting) => setting.enabled,
      );
      switches.set(id, on);
      return on;
    };
    // With no organization in the request, the searcher's credentials, and so
    // the provider that embeds the query, are their own organization's.
    const settingOrgId = orgId ?? (await ownerOrgId(getRequestUserEmail()));
    if (settingOrgId && !(await isOn(settingOrgId))) return { status: "off" };
    // Each audience answers to its own organization's switch, as embedding
    // does, so another organization that turned it off is never matched,
    // even while its vectors are still being deleted.
    for (const audienceId of input.audienceIds) {
      const governing = audienceId.startsWith("org:")
        ? audienceId.slice("org:".length)
        : audienceId.startsWith("user:")
          ? await governingOrgId({
              userEmail: audienceId.slice("user:".length),
            })
          : undefined;
      if (!governing || (await isOn(governing))) audienceIds.push(audienceId);
    }
  } catch (error) {
    console.warn(
      `[search] Reading whether ${label} semantic search is on failed:`,
      error instanceof Error ? error.message : String(error),
    );
    return { status: "unavailable", reason: "error" };
  }
  try {
    const exec = getDbExec();
    const store = vectorStore();
    if (!(await storeAvailable(exec, store))) {
      return { status: "unavailable", reason: "no-vector-store" };
    }
    const family = await resolveFamily(undefined);
    if (!family) return { status: "unavailable", reason: "no-provider" };
    if (!audienceIds.length || !input.query.trim()) {
      return { status: "used", hits: [] };
    }
    const vector = await queryVector(
      family,
      input.query,
      {
        ownerEmail: getRequestUserEmail(),
        orgId,
        app: registration.app,
      },
      label,
    );
    const matches = await store.query(exec, {
      embeddingSetId: embeddingSetId(registration, family),
      dimensions: family.dimensions,
      vector,
      audienceIds,
      limit: QUERY_CHUNK_LIMIT,
    });
    const prefix = `${registration.app}/${registration.type}/`;
    const floor = family.minSimilarity ?? -Infinity;
    const best = new Map<string, number>();
    for (const match of matches) {
      if (!match.key.startsWith(prefix) || match.score < floor) continue;
      const rest = match.key.slice(prefix.length);
      const id = rest.slice(0, rest.lastIndexOf("/"));
      if (!id || best.has(id)) continue;
      best.set(id, match.score);
    }
    return {
      status: "used",
      hits: [...best.entries()]
        .slice(0, Math.max(1, input.limit))
        .map(([id, score]) => ({ id, score })),
    };
  } catch (error) {
    console.warn(
      `[search] ${label} semantic search failed, so it answered by words alone:`,
      failureText(error),
    );
    return { status: "unavailable", reason: "error" };
  }
}
