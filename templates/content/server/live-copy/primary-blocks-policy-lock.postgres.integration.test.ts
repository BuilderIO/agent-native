import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { eq, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { firstRow } from "../lib/first-row.js";

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
const OWNER = "synthetic-policy-lock-owner@example.test";
const ctx = { caller: "cli" as const, userEmail: OWNER };
const LONG_AGO = "2026-01-01T00:00:00.000Z";
const WRITTEN = "A value written while the source policy changed.";

type Db = ReturnType<typeof import("../db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../db/schema.js");
let switchPageToLiveCopy: typeof import("./switch.js").switchPageToLiveCopy;
let seedDefaultBlocksField: typeof import("../../actions/_property-utils.js").seedDefaultBlocksField;
let readBlocksFieldIdentity: typeof import("../../actions/_blocks-field-identity.js").readBlocksFieldIdentity;
let setProperty: typeof import("../../actions/set-document-property.js").default;
let bindSourceField: typeof import("../../actions/bind-content-database-source-field.js").default;
let sequence = 0;

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const target = new URL(POSTGRES_URL);
  const databaseName = target.pathname.slice(1);
  console.info(
    `Primary Blocks policy lock target: host ${target.host}, database ${databaseName}, from ${POSTGRES_ENV}`,
  );
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(`${POSTGRES_ENV} must name an isolated test database.`);
  }
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  registerFeatureFlags(
    (await import("../../shared/feature-flags.js")).CONTENT_FEATURE_FLAGS,
  );
  for (const flag of ["content.live-body-shadow", "content.live-body-writer"]) {
    await putSetting(`feature-flag:${flag}`, {
      version: 1,
      mode: "rules",
      emails: [OWNER],
      orgIds: [],
      percentage: 0,
      updatedAt: null,
      updatedBy: null,
    });
  }
  switchPageToLiveCopy = (await import("./switch.js")).switchPageToLiveCopy;
  seedDefaultBlocksField = (await import("../../actions/_property-utils.js"))
    .seedDefaultBlocksField;
  readBlocksFieldIdentity = (
    await import("../../actions/_blocks-field-identity.js")
  ).readBlocksFieldIdentity;
  setProperty = (await import("../../actions/set-document-property.js"))
    .default;
  bindSourceField = (
    await import("../../actions/bind-content-database-source-field.js")
  ).default;
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
});

type PidRow = { pid: unknown };

function pidRows(result: unknown): PidRow[] {
  if (Array.isArray(result)) return result as PidRow[];
  return (result as { rows?: PidRow[] }).rows ?? [];
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

function failures(results: PromiseSettledResult<unknown>[]): string[] {
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => failureCode((result as PromiseRejectedResult).reason));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function backendPid(tx: Db): Promise<number> {
  const row = firstRow(
    pidRows(await tx.execute(sql`SELECT pg_backend_pid() AS pid`)),
  );
  if (!row) throw new Error("pg_backend_pid() returned no row.");
  return Number(row.pid);
}

type Tracked = { settled: boolean; promise: Promise<unknown> };

/**
 * The session waiting on `holderPid`. Fails if `waiter` settles first, with
 * its own error when it failed.
 */
async function sessionBlockedBy(
  holderPid: number,
  waiter: Tracked,
): Promise<number> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    if (waiter.settled) {
      await waiter.promise;
      throw new Error(`It finished without waiting on session ${holderPid}.`);
    }
    const waiting = pidRows(
      await getDb().execute(
        sql`SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND ${holderPid} = ANY(pg_blocking_pids(pid))`,
      ),
    );
    const blocked = firstRow(waiting);
    if (blocked) return Number(blocked.pid);
    await sleep(5);
  }
  throw new Error(`Nothing finished or waited on session ${holderPid}.`);
}

function track<T>(promise: Promise<T>) {
  const tracked = { settled: false, promise };
  void promise.then(
    () => (tracked.settled = true),
    () => (tracked.settled = true),
  );
  return tracked;
}

/**
 * Holds one row until `release`, so a writer that reaches it stops there
 * with whatever it locked before it.
 */
function holdRow(statement: SQL) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: (pid: number) => void;
  const pid = new Promise<number>((resolve) => {
    held = resolve;
  });
  const done = getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const holder = await backendPid(tx);
    await tx.execute(statement);
    held(holder);
    await released;
  });
  return {
    pid: Promise.race([
      pid,
      done.then(() => {
        throw new Error("The holder ended before it held its row.");
      }),
    ]),
    release,
    done,
  };
}

type Row = {
  id: string;
  databaseId: string;
  propertyId: string;
  sourceFieldId: string;
};

/**
 * A switched page in its space's Files collection, whose primary Blocks
 * field a source owns until that source's field is unbound.
 */
async function switchedRowOwnedBySource(): Promise<Row> {
  sequence += 1;
  const id = `synthetic-policy-lock-${Date.now()}-${sequence}`;
  const databaseId = `database-${id}`;
  const sourceId = `source-${id}`;
  const sourceFieldId = `source-field-${id}`;
  const now = new Date().toISOString();
  for (const page of [
    { id, content: "The page's body before the write." },
    { id: `database-page-${id}`, content: "" },
  ]) {
    await getDb()
      .insert(schema.documents)
      .values({
        ...page,
        title: "Policy lock",
        ownerEmail: OWNER,
        bodyRevision: 1,
        createdAt: LONG_AGO,
        updatedAt: LONG_AGO,
      });
  }
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: databaseId,
      spaceId: `space-${id}`,
      ownerEmail: OWNER,
      documentId: `database-page-${id}`,
      systemRole: "files",
    });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: `item-${id}`,
      ownerEmail: OWNER,
      databaseId,
      documentId: id,
    });
  const propertyId = await seedDefaultBlocksField({
    databaseId,
    ownerEmail: OWNER,
    orgId: null,
    now,
  });
  if (propertyId === null) {
    throw new Error(`Collection ${databaseId} got no primary Blocks field.`);
  }
  await switchPageToLiveCopy(id, { ctx });
  await getDb()
    .insert(schema.contentDatabaseSources)
    .values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "local-table",
      sourceName: "Upstream",
      sourceTable: `upstream-${id}`,
      createdAt: now,
      updatedAt: now,
    });
  await getDb().insert(schema.contentDatabaseSourceFields).values({
    id: sourceFieldId,
    ownerEmail: OWNER,
    sourceId,
    propertyId,
    localFieldKey: propertyId,
    sourceFieldKey: "body",
    sourceFieldLabel: "Body",
    sourceFieldType: "text",
    mappingType: "property",
    writeOwner: "source",
    readOnly: 1,
    createdAt: now,
    updatedAt: now,
  });
  return { id, databaseId, propertyId, sourceFieldId };
}

async function storedBody(row: Row) {
  const pages = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, row.id));
  const page = firstRow(pages);
  if (!page) throw new Error(`Page ${row.id} is gone.`);
  return page.content;
}

async function boundProperty(row: Row) {
  const fields = await getDb()
    .select({ propertyId: schema.contentDatabaseSourceFields.propertyId })
    .from(schema.contentDatabaseSourceFields)
    .where(eq(schema.contentDatabaseSourceFields.id, row.sourceFieldId));
  const field = firstRow(fields);
  if (!field) throw new Error(`Source field ${row.sourceFieldId} is gone.`);
  return field.propertyId;
}

/** The policy change: unbinding the source's field gives the field back to Content. */
function unbind(row: Row) {
  return track(
    Promise.resolve().then(() =>
      bindSourceField.run(
        {
          databaseId: row.databaseId,
          sourceFieldId: row.sourceFieldId,
          propertyId: null,
        },
        ctx,
      ),
    ),
  );
}

async function writePrimary(row: Row) {
  const { revision } = await readBlocksFieldIdentity({
    documentId: row.id,
    propertyId: row.propertyId,
    markdown: await storedBody(row),
  });
  return track(
    Promise.resolve().then(() =>
      setProperty.run(
        {
          documentId: row.id,
          databaseId: row.databaseId,
          propertyId: row.propertyId,
          value: WRITTEN,
          expectedBlocksFieldRevision: revision,
        },
        ctx,
      ),
    ),
  );
}

// oracle-change: needs a Postgres test database; CI's Postgres job sets its URL, so it runs there.
describe.skipIf(!POSTGRES_URL)(
  "a source-policy change and a live-copy primary Blocks write on one page",
  () => {
    it(
      "the write waits for a policy change that locked the collection first, and commits under the new policy",
      () =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const row = await switchedRowOwnedBySource();
          const before = await storedBody(row);
          // Stops the unbind after it locked the collection, before it
          // changes the field.
          const holder = holdRow(
            sql`SELECT id FROM content_database_source_fields WHERE id = ${row.sourceFieldId} FOR UPDATE`,
          );
          let policy: ReturnType<typeof unbind> | undefined;
          let write: Awaited<ReturnType<typeof writePrimary>> | undefined;
          try {
            const holderPid = await holder.pid;
            policy = unbind(row);
            const policyPid = await sessionBlockedBy(holderPid, policy);
            write = await writePrimary(row);
            // A write that didn't wait read the policy mid-change.
            await sessionBlockedBy(policyPid, write);
            expect(await storedBody(row)).toBe(before);
          } finally {
            holder.release();
          }
          const results = await Promise.allSettled([
            holder.done,
            policy.promise,
            write.promise,
          ]);
          expect(failures(results)).toEqual([]);
          expect(await boundProperty(row)).toBeNull();
          expect(await storedBody(row)).toBe(WRITTEN);
        }),
      120_000,
    );

    it(
      "a policy change waits for a write that locked the collection first, and the write is refused under the policy it read",
      () =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const row = await switchedRowOwnedBySource();
          const before = await storedBody(row);
          // Stops the write's commit after the collection and memberships,
          // at the page.
          const holder = holdRow(
            sql`SELECT id FROM documents WHERE id = ${row.id} FOR UPDATE`,
          );
          let policy: ReturnType<typeof unbind> | undefined;
          let write: Awaited<ReturnType<typeof writePrimary>> | undefined;
          try {
            const holderPid = await holder.pid;
            write = await writePrimary(row);
            const writePid = await sessionBlockedBy(holderPid, write);
            policy = unbind(row);
            // A policy change that didn't wait committed under the write.
            await sessionBlockedBy(writePid, policy);
          } finally {
            holder.release();
          }
          const results = await Promise.allSettled([
            holder.done,
            policy.promise,
            write.promise,
          ]);
          expect(failures(results)).toEqual(["PROPERTY_NOT_WRITABLE"]);
          expect(await boundProperty(row)).toBeNull();
          expect(await storedBody(row)).toBe(before);
        }),
      120_000,
    );
  },
);
