import type { ResourceSuggestion } from "@agent-native/core/review";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { canonicalizeNfm } from "../../shared/nfm.js";
import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const POSTGRES_ENV = process.env.CONTENT_ROW_MUTATION_POSTGRES_URL
  ? "CONTENT_ROW_MUTATION_POSTGRES_URL"
  : "CONTENT_MIGRATION_POSTGRES_URL";
const POSTGRES_URL = process.env[POSTGRES_ENV];
const OWNER = "synthetic-accept-lock-order-owner@example.test";
const ctx = { caller: "cli" as const, userEmail: OWNER };
const RUNS = 5;

type Db = ReturnType<typeof import("../db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../db/schema.js");
let adapterKind: string;
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let createSuggestion: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let sequence = 0;
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const target = new URL(POSTGRES_URL);
  const databaseName = target.pathname.slice(1);
  console.info(
    `Suggestion accept lock-order target: host ${target.host}, database ${databaseName}, from ${POSTGRES_ENV}`,
  );
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(`${POSTGRES_ENV} must name an isolated test database.`);
  }
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  createSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
  ).default;
  decideSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  await (await import("../plugins/db.js")).default(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  const { CONTENT_FEATURE_FLAGS } =
    await import("../../shared/feature-flags.js");
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
  adapterKind = (await import("./suggested-edits.js"))
    .CONTENT_DOCUMENT_SUGGESTION_ADAPTER;
  // Content's migrations don't create core's organization tables.
  await getDb().execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
      identity_authority TEXT, identity_id TEXT
    )`),
  );
  await getDb().execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS org_members (
      id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
      federation_removal_pending_at BIGINT
    )`),
  );
}, 120_000);

afterAll(() => {
  if (!POSTGRES_URL) return;
  delete process.env.DATABASE_URL;
  if (previousSyncEventsEnabled === undefined)
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  else
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS =
      previousSyncEventsEnabled;
});

const page = [
  "# Plan",
  "",
  "The first paragraph sets the scene.",
  "",
  "A closing paragraph sits here.",
].join("\n");

function rowsOf(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  return (result as { rows?: any[] }).rows ?? [];
}

function failureCode(error: unknown): string {
  let current = error as
    | { code?: unknown; errorCode?: unknown; cause?: unknown }
    | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.code === "string") return current.code;
    if (typeof current.errorCode === "string") return current.errorCode;
    current = current.cause as typeof current;
  }
  return String(error);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function backendPid(tx: Db): Promise<number> {
  return Number(
    rowsOf(await tx.execute(sql`SELECT pg_backend_pid() AS pid`))[0].pid,
  );
}

/** Resolves true once a session waits on `holderPid`, false if `settled()` first. */
async function waitUntilBlockedBy(holderPid: number, settled: () => boolean) {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (settled()) return false;
    const waiting = rowsOf(
      await getDb().execute(
        sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))`,
      ),
    );
    if (waiting.length > 0) return true;
    await sleep(5);
  }
  throw new Error("The accept neither finished nor waited on the held row.");
}

/** A legacy Page, never switched, with one pending suggestion. */
async function seedSuggestion(): Promise<{
  documentId: string;
  suggestion: ResourceSuggestion;
}> {
  sequence += 1;
  const documentId = `synthetic-accept-lock-order-${Date.now()}-${sequence}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: documentId,
      title: "Lock order",
      content: canonicalizeNfm(page),
      ownerEmail: OWNER,
      bodyRevision: 1,
      createdAt: now,
      updatedAt: now,
    });
  const document = await getDocumentAction.run({ id: documentId }, ctx);
  const find = "sets the scene";
  const [operation] = markdownSuggestionOperationsForFindReplace({
    before: document.content,
    find,
    replace: "opens",
    start: document.content.indexOf(find),
  });
  const suggestion = await createSuggestion.run(
    {
      resourceType: "document",
      resourceId: documentId,
      adapterKind,
      baseRevision: document.revision,
      summary: "Edit",
      idempotencyKey: `accept-lock-order-${documentId}`,
      operations: [operation!],
    },
    ctx,
  );
  return { documentId, suggestion };
}

describe.skipIf(!POSTGRES_URL)(
  "a legacy suggestion accept and a live-body conversion on one Page",
  () => {
    it(
      "lock the Page before its suggestions, so neither aborts the other",
      () =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          for (let run = 0; run < RUNS; run += 1) {
            const { documentId, suggestion } = await seedSuggestion();
            let proceed!: () => void;
            const acceptWaiting = new Promise<void>((resolve) => {
              proceed = resolve;
            });
            let pageHeld!: (pid: number) => void;
            const holderPid = new Promise<number>((resolve) => {
              pageHeld = resolve;
            });
            // The conversion's locks: the Page row, then the Page's pending
            // suggestions, which its re-baseline moves onto the new body.
            const conversion = getDb().transaction(async (transaction) => {
              const tx = transaction as unknown as Db;
              const pid = await backendPid(tx);
              await tx.execute(
                sql`SELECT id FROM documents WHERE id = ${documentId} FOR UPDATE`,
              );
              pageHeld(pid);
              await acceptWaiting;
              await tx.execute(
                sql`SELECT id FROM agent_review_suggestions WHERE id = ${suggestion.id} FOR UPDATE`,
              );
            });
            let settled = false;
            let accept: Promise<unknown> | undefined;
            try {
              const pid = await Promise.race([
                holderPid,
                conversion.then(() => {
                  throw new Error(
                    "The conversion ended before it held the Page.",
                  );
                }),
              ]);
              const decision = Promise.resolve(
                decideSuggestion.run(
                  {
                    id: suggestion.id,
                    decision: "accepted",
                    idempotencyKey: `accept-lock-order-decide-${suggestion.id}`,
                    observedBase: suggestion.baseRevision,
                    observedRevision: suggestion.revision,
                  },
                  ctx,
                ),
              );
              accept = decision;
              void decision.then(
                () => (settled = true),
                () => (settled = true),
              );
              const blocked = await waitUntilBlockedBy(pid, () => settled);
              // An accept that ended without waiting reports its own failure.
              if (!blocked) await decision;
              expect(blocked).toBe(true);
            } finally {
              proceed();
            }
            const results = await Promise.allSettled([conversion, accept!]);
            expect(
              results
                .filter((result) => result.status === "rejected")
                .map((result) =>
                  failureCode((result as PromiseRejectedResult).reason),
                ),
              `run ${run + 1}`,
            ).toEqual([]);
            const [stored] = await getDb()
              .select({ content: schema.documents.content })
              .from(schema.documents)
              .where(eq(schema.documents.id, documentId));
            expect(stored!.content).toBe(
              canonicalizeNfm(page.replace("sets the scene", "opens")),
            );
          }
        }),
      120_000,
    );
  },
);
