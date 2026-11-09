import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import { documentRevisionToken } from "../lib/document-revision.js";
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
const beforeLiveCopyEdit = vi.hoisted(() => ({
  run: undefined as undefined | ((documentId: string) => Promise<void>),
}));

// Runs a test's peer write after set-document-property's first page check
// and before its live-copy commit.
vi.mock("./write.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write.js")>();
  return {
    ...actual,
    editContentLiveCopy: (async (
      ...args: Parameters<typeof actual.editContentLiveCopy>
    ) => {
      const run = beforeLiveCopyEdit.run;
      beforeLiveCopyEdit.run = undefined;
      if (run) await run(args[0]);
      return actual.editContentLiveCopy(...args);
    }) as typeof actual.editContentLiveCopy,
  };
});

type Db = ReturnType<typeof import("../db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../db/schema.js");
let switchPageToLiveCopy: typeof import("./switch.js").switchPageToLiveCopy;
let seedDefaultBlocksField: typeof import("../../actions/_property-utils.js").seedDefaultBlocksField;
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
async function switchedRowOwnedBySource(
  options: { switched?: boolean; source?: boolean; content?: string } = {},
): Promise<Row> {
  sequence += 1;
  const id = `synthetic-policy-lock-${Date.now()}-${sequence}`;
  const databaseId = `database-${id}`;
  const sourceId = `source-${id}`;
  const sourceFieldId = `source-field-${id}`;
  const now = new Date().toISOString();
  for (const page of [
    { id, content: options.content ?? "The page's body before the write." },
    { id: `database-page-${id}`, content: "" },
  ]) {
    await getDb()
      .insert(schema.documents)
      .values({
        ...page,
        title: "Policy lock",
        ownerEmail: OWNER,
        spaceId: `space-${id}`,
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
  if (options.switched !== false) await switchPageToLiveCopy(id, { ctx });
  if (options.source === false)
    return { id, databaseId, propertyId, sourceFieldId };
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

async function pageRevision(row: Row) {
  const page = firstRow(
    await getDb()
      .select({
        content: schema.documents.content,
        bodyRevision: schema.documents.bodyRevision,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, row.id)),
  );
  if (!page) throw new Error(`Page ${row.id} is gone.`);
  return documentRevisionToken(page.bodyRevision, page.content);
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
  const baseRevision = await pageRevision(row);
  return track(
    Promise.resolve().then(() =>
      setProperty.run(
        {
          documentId: row.id,
          databaseId: row.databaseId,
          propertyId: row.propertyId,
          value: WRITTEN,
          baseRevision,
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
    it.each(["conversion", "attachment"] as const)(
      "serializes direct conversion and source attachment when %s locks first",
      async (first) =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const row = await switchedRowOwnedBySource({
            switched: false,
            source: false,
          });
          const db = getDb();
          const database = firstRow(
            await db
              .select()
              .from(schema.contentDatabases)
              .where(eq(schema.contentDatabases.id, row.databaseId)),
          );
          if (!database)
            throw new Error("Missing attachment fixture collection.");
          const before = await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, row.id));
          const holder = holdRow(
            first === "conversion"
              ? sql`SELECT id FROM documents WHERE id = ${row.id} FOR UPDATE`
              : sql`LOCK TABLE content_database_sources IN SHARE MODE`,
          );
          const { replaceSourceMetadata } =
            await import("../../actions/_database-source-utils.js");
          const convert = () =>
            track(switchPageToLiveCopy(row.id, { ctx, keepLiveEdits: true }));
          const attach = () =>
            track(
              replaceSourceMetadata({
                database,
                source: null,
                sourceType: "mock-local",
                sourceName: "Concurrent source",
                sourceTable: "synthetic-concurrent-source",
                now: new Date().toISOString(),
              }),
            );
          let firstWrite: Tracked | undefined;
          let secondWrite: Tracked | undefined;
          try {
            const holderPid = await holder.pid;
            firstWrite = first === "conversion" ? convert() : attach();
            const firstPid = await sessionBlockedBy(holderPid, firstWrite);
            secondWrite = first === "conversion" ? attach() : convert();
            await sessionBlockedBy(firstPid, secondWrite);
          } finally {
            holder.release();
            await holder.done;
            await Promise.allSettled([
              ...(firstWrite ? [firstWrite.promise] : []),
              ...(secondWrite ? [secondWrite.promise] : []),
            ]);
          }
          await expect(firstWrite.promise).resolves.toBeDefined();
          const pages = await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, row.id));
          const sources = await db
            .select()
            .from(schema.contentDatabaseSources)
            .where(
              eq(schema.contentDatabaseSources.databaseId, row.databaseId),
            );
          if (first === "conversion") {
            await expect(secondWrite.promise).rejects.toMatchObject({
              errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
              statusCode: 409,
            });
            expect(firstRow(pages)?.liveBodySwitchedAt).toEqual(
              expect.any(String),
            );
            expect(sources).toEqual([]);
          } else {
            await expect(secondWrite.promise).rejects.toMatchObject({
              code: "ineligible",
              blockers: ["collection_source"],
            });
            expect(pages).toEqual(before);
            expect(sources).toMatchObject([
              { sourceName: "Concurrent source" },
            ]);
          }
        }),
      120_000,
    );

    it(
      "lets unrelated pages in one collection reach their own page locks together",
      async () =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const first = await switchedRowOwnedBySource();
          const second = await switchedRowOwnedBySource();
          await unbind(first).promise;
          await unbind(second).promise;
          await getDb()
            .insert(schema.contentDatabaseItems)
            .values({
              id: `shared-${second.id}`,
              ownerEmail: OWNER,
              databaseId: first.databaseId,
              documentId: second.id,
            });
          const holders = [first, second].map((row) => ({
            row,
            ...holdRow(
              sql`SELECT id FROM documents WHERE id = ${row.id} FOR UPDATE`,
            ),
          }));
          const writes: Tracked[] = [];
          try {
            await Promise.all(holders.map((holder) => holder.pid));
            const { editContentLiveCopy } = await import("./write.js");
            const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");
            for (const { row, pid } of holders) {
              const holderPid = await pid;
              const write = track(
                editContentLiveCopy(row.id, {
                  cause: { ctx, operation: "test-independent-page-writes" },
                  edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
                  input: { expected: await storedBody(row), content: WRITTEN },
                }),
              );
              writes.push(write);
              await sessionBlockedBy(holderPid, write);
            }
          } finally {
            for (const holder of holders) holder.release();
            expect(
              failures(
                await Promise.allSettled([
                  ...holders.map((holder) => holder.done),
                  ...writes.map((write) => write.promise),
                ]),
              ),
            ).toEqual([]);
          }
          expect(await storedBody(first)).toBe(WRITTEN);
          expect(await storedBody(second)).toBe(WRITTEN);
        }),
      120_000,
    );

    it(
      "locks both containing collections in order before the page",
      async () =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const row = await switchedRowOwnedBySource();
          await unbind(row).promise;
          const secondCollection = `zz-${row.databaseId}`;
          await getDb()
            .insert(schema.contentDatabases)
            .values({
              id: secondCollection,
              ownerEmail: OWNER,
              documentId: `unused-${row.id}`,
            });
          await getDb()
            .insert(schema.contentDatabaseItems)
            .values({
              id: `second-${row.id}`,
              ownerEmail: OWNER,
              databaseId: secondCollection,
              documentId: row.id,
            });
          const before = await storedBody(row);
          const holder = holdRow(
            sql`SELECT id FROM content_databases WHERE id = ${secondCollection} FOR UPDATE`,
          );
          let write: Tracked | undefined;
          let policy: Tracked | undefined;
          try {
            const holderPid = await holder.pid;
            const { editContentLiveCopy } = await import("./write.js");
            const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");
            write = track(
              editContentLiveCopy(row.id, {
                cause: { ctx, operation: "test-two-containing-collections" },
                edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
                input: { expected: before, content: WRITTEN },
              }),
            );
            const writePid = await sessionBlockedBy(holderPid, write);
            policy = track(
              getDb().transaction(async (tx) => {
                await tx.execute(
                  sql`SELECT id FROM content_databases WHERE id = ${row.databaseId} FOR UPDATE`,
                );
              }),
            );
            await sessionBlockedBy(writePid, policy);
          } finally {
            holder.release();
            expect(
              failures(
                await Promise.allSettled([
                  holder.done,
                  ...(write ? [write.promise] : []),
                  ...(policy ? [policy.promise] : []),
                ]),
              ),
            ).toEqual([]);
          }
          expect(await storedBody(row)).toBe(WRITTEN);
        }),
      120_000,
    );

    it.each([false, true])(
      "a body writer without a target collection holds its membership collection (changed: %s)",
      async (changed) =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const row = await switchedRowOwnedBySource();
          await unbind(row).promise;
          const before = await storedBody(row);
          const holder = holdRow(
            sql`SELECT id FROM documents WHERE id = ${row.id} FOR UPDATE`,
          );
          let write: Tracked | undefined;
          let policy: Tracked | undefined;
          try {
            const holderPid = await holder.pid;
            const { editContentLiveCopy } = await import("./write.js");
            const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");
            write = track(
              editContentLiveCopy(row.id, {
                cause: { ctx, operation: "test-containing-collection" },
                edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
                input: {
                  expected: before,
                  content: changed ? WRITTEN : before,
                },
              }),
            );
            const writePid = await sessionBlockedBy(holderPid, write);
            policy = unbind(row);
            await sessionBlockedBy(writePid, policy);
          } finally {
            holder.release();
            const results = await Promise.allSettled([
              holder.done,
              ...(write ? [write.promise] : []),
              ...(policy ? [policy.promise] : []),
            ]);
            expect(failures(results)).toEqual([]);
          }
          expect(await storedBody(row)).toBe(changed ? WRITTEN : before);
          expect(await boundProperty(row)).toBeNull();
        }),
      120_000,
    );

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

    it("refuses an old read after the field identity is reset and the body changes", async () =>
      runWithRequestContext({ userEmail: OWNER }, async () => {
        const a = "Original first.\nOriginal second.";
        const b = "Peer changed first.\nOriginal second.";
        const row = await switchedRowOwnedBySource({
          switched: false,
          source: false,
          content: a,
        });
        const rewrite = async (value: string) =>
          setProperty.run(
            {
              documentId: row.id,
              databaseId: row.databaseId,
              propertyId: row.propertyId,
              value,
              baseRevision: await pageRevision(row),
            },
            ctx,
          );
        // Two unchanged saves move the field revision past its first value.
        await rewrite(a);
        await rewrite(a);
        const oldRead = await pageRevision(row);
        const { deleteBlocksFieldIdentity } =
          await import("../../actions/_blocks-field-identity.js");
        await getDb().transaction(async (tx) => {
          await deleteBlocksFieldIdentity({
            db: tx as unknown as Db,
            documentId: row.id,
            propertyId: row.propertyId,
          });
        });
        await rewrite(b);

        const result = await Promise.allSettled([
          setProperty.run(
            {
              documentId: row.id,
              databaseId: row.databaseId,
              propertyId: row.propertyId,
              value: "Original first.\nOld caller changed second.",
              baseRevision: oldRead,
            },
            ctx,
          ),
        ]);
        expect(failures(result)).toEqual(["DOCUMENT_REVISION_CONFLICT"]);
        expect(await storedBody(row)).toBe(b);
      }));

    it.each(
      [true, false].flatMap((switched) =>
        [true, false].flatMap((storedIdentity) =>
          [false, true].map((aba) => ({ switched, storedIdentity, aba })),
        ),
      ),
    )(
      "refuses a write read before a peer's commit that a late Files membership joined (switched=$switched, stored identity=$storedIdentity, A-B-A=$aba)",
      async ({ switched, storedIdentity, aba }) =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const db = getDb();
          const { canonicalizeNfm } = await import("../../shared/nfm.js");
          const a = canonicalizeNfm("Original first.\n\nOriginal second.");
          const b = canonicalizeNfm("Peer changed first.\n\nOriginal second.");
          const c = canonicalizeNfm(
            "Original first.\n\nCaller changed second.",
          );
          const row = await switchedRowOwnedBySource({
            switched,
            source: false,
            content: a,
          });
          // A second collection holds the page, so the peer writes its body
          // through an alias the Files row doesn't share.
          const otherDatabase = `favorites-${row.id}`;
          await db.insert(schema.documents).values({
            id: `favorites-page-${row.id}`,
            title: "Other alias",
            content: "",
            ownerEmail: OWNER,
            spaceId: `space-${row.id}`,
          });
          await db.insert(schema.contentDatabases).values({
            id: otherDatabase,
            ownerEmail: OWNER,
            spaceId: `space-${row.id}`,
            documentId: `favorites-page-${row.id}`,
            systemRole: "favorites",
          });
          await db.insert(schema.contentDatabaseItems).values({
            id: `favorites-item-${row.id}`,
            databaseId: otherDatabase,
            documentId: row.id,
            ownerEmail: OWNER,
          });
          const otherProperty = await seedDefaultBlocksField({
            databaseId: otherDatabase,
            ownerEmail: OWNER,
            orgId: null,
            now: LONG_AGO,
          });
          if (!otherProperty) throw new Error("Missing second primary alias.");
          const pageBeforeWrite = await pageRevision(row);
          const { persistBlocksFieldIdentity } =
            await import("../../actions/_blocks-field-identity.js");
          if (storedIdentity)
            await persistBlocksFieldIdentity({
              db,
              ownerEmail: OWNER,
              documentId: row.id,
              propertyId: row.propertyId,
              previousMarkdown: a,
              markdown: a,
              now: LONG_AGO,
            });
          await db
            .delete(schema.contentDatabaseItems)
            .where(
              and(
                eq(schema.contentDatabaseItems.documentId, row.id),
                eq(schema.contentDatabaseItems.databaseId, row.databaseId),
              ),
            );
          const { ensureDocumentFilesMembership } =
            await import("../../actions/_content-files.js");
          const getDocument = (await import("../../actions/get-document.js"))
            .default;
          const { editContentLiveCopy } = await import("./write.js");
          const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");
          if (!switched) {
            // Pauses the peer's legacy write after it updates the page and
            // before it commits, which no row lock can do from outside.
            await db.execute(
              sql.raw(
                "CREATE TABLE IF NOT EXISTS test_files_pause_targets (document_id text primary key, content text not null)",
              ),
            );
            await db.execute(
              sql.raw(`CREATE OR REPLACE FUNCTION test_files_pause_body() RETURNS trigger LANGUAGE plpgsql AS $$
              BEGIN
                IF EXISTS (SELECT 1 FROM test_files_pause_targets WHERE document_id = NEW.id AND content = NEW.content) THEN
                  PERFORM pg_advisory_xact_lock(7864001);
                END IF;
                RETURN NEW;
              END $$`),
            );
            await db.execute(
              sql.raw(
                "CREATE OR REPLACE TRIGGER test_files_pause_body AFTER UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION test_files_pause_body()",
              ),
            );
            await db.execute(
              sql`INSERT INTO test_files_pause_targets(document_id, content) VALUES (${row.id}, ${b})`,
            );
          }
          const holder = holdRow(
            switched
              ? sql`SELECT doc_id FROM _collab_docs WHERE doc_id = ${row.id} FOR UPDATE`
              : sql`SELECT pg_advisory_xact_lock(7864001)`,
          );
          let peer: Tracked | undefined;
          let read: Awaited<ReturnType<typeof getDocument.run>> | undefined;
          try {
            peer = track(
              Promise.resolve().then<unknown>(() =>
                switched
                  ? editContentLiveCopy(row.id, {
                      cause: { ctx, operation: "peer-body-write" },
                      edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
                      input: { expected: a, content: b },
                    })
                  : setProperty.run(
                      {
                        documentId: row.id,
                        databaseId: otherDatabase,
                        propertyId: otherProperty,
                        value: b,
                        baseRevision: pageBeforeWrite,
                      },
                      ctx,
                    ),
              ),
            );
            await sessionBlockedBy(await holder.pid, peer);
            await ensureDocumentFilesMembership(db, row.id);
            read = await getDocument.run(
              { id: row.id, databaseId: row.databaseId },
              ctx,
            );
            expect(read.content).toBe(a);
          } finally {
            holder.release();
            await holder.done;
            if (peer) await peer.promise;
            if (!switched) {
              await db.execute(
                sql.raw(
                  "DROP TRIGGER IF EXISTS test_files_pause_body ON documents",
                ),
              );
              await db.execute(
                sql`DELETE FROM test_files_pause_targets WHERE document_id = ${row.id}`,
              );
            }
          }
          expect(await storedBody(row)).toBe(b);
          if (aba)
            await setProperty.run(
              {
                documentId: row.id,
                databaseId: otherDatabase,
                propertyId: otherProperty,
                value: a,
                baseRevision: await pageRevision(row),
              },
              ctx,
            );

          const result = await Promise.allSettled([
            setProperty.run(
              {
                documentId: row.id,
                databaseId: row.databaseId,
                propertyId: row.propertyId,
                value: c,
                baseRevision: read.revision,
              },
              ctx,
            ),
          ]);
          expect(failures(result)).toEqual(["DOCUMENT_REVISION_CONFLICT"]);
          expect(await storedBody(row)).toBe(aba ? a : b);
        }),
      120_000,
    );

    it("refuses a body that went A to B to A between the check and the live-copy commit", async () =>
      runWithRequestContext({ userEmail: OWNER }, async () => {
        const { canonicalizeNfm } = await import("../../shared/nfm.js");
        const a = canonicalizeNfm("Original first.\n\nOriginal second.");
        const b = canonicalizeNfm("Peer changed first.\n\nOriginal second.");
        const c = canonicalizeNfm("Original first.\n\nCaller changed second.");
        const row = await switchedRowOwnedBySource({
          switched: true,
          source: false,
          content: a,
        });
        const { editContentLiveCopy } = await import("./write.js");
        const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");
        const tokenAtA = await pageRevision(row);
        beforeLiveCopyEdit.run = async () => {
          for (const [expected, content] of [
            [a, b],
            [b, a],
          ] as const)
            await editContentLiveCopy(row.id, {
              cause: { ctx, operation: "peer-body-write" },
              edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
              input: { expected, content },
            });
        };
        const result = await Promise.allSettled([
          setProperty.run(
            {
              documentId: row.id,
              databaseId: row.databaseId,
              propertyId: row.propertyId,
              value: c,
              baseRevision: tokenAtA,
            },
            ctx,
          ),
        ]);
        expect(beforeLiveCopyEdit.run).toBeUndefined();
        expect(failures(result)).toEqual(["DOCUMENT_REVISION_CONFLICT"]);
        expect(await storedBody(row)).toBe(a);
      }));

    it.each(["browser-binary", "agent", "primary", "explicit", "open"])(
      "keeps the %s save that a Files repair joins mid-save",
      async (surface) =>
        runWithRequestContext({ userEmail: OWNER }, async () => {
          const converting = surface === "explicit" || surface === "open";
          const row = await switchedRowOwnedBySource({
            switched: !converting,
            source: false,
          });
          const db = getDb();
          const { ensureDocumentFilesMembership } =
            await import("../../actions/_content-files.js");
          let otherProperty: string | null = null;
          const otherDatabase = `other-${row.id}`;
          if (surface === "primary") {
            await db.insert(schema.documents).values({
              id: `other-page-${row.id}`,
              ownerEmail: OWNER,
              spaceId: `space-${row.id}`,
              content: "",
              title: "Other primary",
            });
            await db.insert(schema.contentDatabases).values({
              id: otherDatabase,
              documentId: `other-page-${row.id}`,
              spaceId: `space-${row.id}`,
              ownerEmail: OWNER,
              systemRole: "favorites",
            });
            await db.insert(schema.contentDatabaseItems).values({
              id: `other-item-${row.id}`,
              databaseId: otherDatabase,
              documentId: row.id,
              ownerEmail: OWNER,
            });
            otherProperty = await seedDefaultBlocksField({
              databaseId: otherDatabase,
              ownerEmail: OWNER,
              orgId: null,
              now: LONG_AGO,
            });
            if (!otherProperty) throw new Error("Missing property fixture.");
          }
          await db
            .delete(schema.contentDatabaseItems)
            .where(
              and(
                eq(schema.contentDatabaseItems.documentId, row.id),
                eq(schema.contentDatabaseItems.databaseId, row.databaseId),
              ),
            );
          if (surface === "open") {
            const { deleteSetting } =
              await import("@agent-native/core/settings");
            await putSetting("feature-flag:content.live-body-backfill", {
              version: 1,
              mode: "rules",
              emails: [OWNER],
              orgIds: [],
              percentage: 0,
              updatedAt: null,
              updatedBy: null,
            });
            await deleteSetting(
              "feature-flag-rollout-index:content.live-body-backfill",
            );
            // The test database is shared with other suites.
            onTestFinished(async () => {
              await deleteSetting("feature-flag:content.live-body-backfill");
            });
          }
          const before = await (
            await import("../../actions/get-document.js")
          ).default.run({ id: row.id }, ctx);
          const editDocument = (await import("../../actions/edit-document.js"))
            .default;
          const explicit = (
            await import("../../actions/set-live-body-switch.js")
          ).default;
          const open = (
            await import("../../actions/convert-page-to-live-copy-if-due.js")
          ).default;
          const collab = await import("@agent-native/core/collab");
          const { contentLiveCopy } = await import("./binding.js");
          let bytes: Uint8Array = new Uint8Array();
          if (surface === "browser-binary") {
            const Y = await import("yjs");
            const live = await collab.readLiveCopy(contentLiveCopy, row.id);
            if (live.kind !== "live")
              throw new Error("Browser fixture is not live.");
            const doc = new Y.Doc();
            Y.applyUpdate(doc, live.state);
            const vector = Y.encodeStateVector(doc);
            const paragraph = new Y.XmlElement("paragraph");
            const text = new Y.XmlText();
            text.insert(0, "Browser appended body.");
            paragraph.insert(0, [text]);
            const fragment = doc.getXmlFragment("default");
            fragment.insert(fragment.length, [paragraph]);
            bytes = Y.encodeStateAsUpdate(doc, vector);
            doc.destroy();
          }
          const save = async (): Promise<unknown> => {
            if (surface === "browser-binary")
              return collab.applyUpdate(row.id, bytes);
            if (surface === "agent")
              return editDocument.run(
                {
                  id: row.id,
                  baseRevision: before.revision,
                  idempotencyKey: `files-repair-agent-${row.id}`,
                  find: "before the write",
                  replace: "after the write",
                },
                { caller: "mcp", userEmail: OWNER },
              );
            if (surface === "primary")
              return setProperty.run(
                {
                  documentId: row.id,
                  databaseId: otherDatabase,
                  propertyId: otherProperty as string,
                  value: WRITTEN,
                  baseRevision: before.revision,
                },
                ctx,
              );
            if (surface === "explicit")
              return explicit.run(
                { id: row.id, switched: true },
                { caller: "frontend", userEmail: OWNER },
              );
            return open.run(
              { id: row.id },
              { caller: "frontend", userEmail: OWNER },
            );
          };
          const holder = holdRow(
            sql`SELECT id FROM documents WHERE id = ${row.id} FOR UPDATE`,
          );
          let pending: Tracked | undefined;
          let result: PromiseSettledResult<unknown>[] = [];
          try {
            pending = track(save());
            await sessionBlockedBy(await holder.pid, pending);
            await ensureDocumentFilesMembership(db, row.id);
          } finally {
            holder.release();
            await holder.done;
            result = await Promise.allSettled(pending ? [pending.promise] : []);
          }
          expect(
            failures(result),
            "A Files membership added during the save is not the user's conflict.",
          ).toEqual([]);
          const page = firstRow(
            await db
              .select()
              .from(schema.documents)
              .where(eq(schema.documents.id, row.id)),
          );
          if (surface === "browser-binary")
            expect(page?.content).toContain("Browser appended body.");
          else if (surface === "agent")
            expect(page?.content).toContain("after the write");
          else if (surface === "primary") expect(page?.content).toBe(WRITTEN);
          else expect(page?.liveBodySwitchedAt).not.toBeNull();
        }),
      120_000,
    );
  },
);
