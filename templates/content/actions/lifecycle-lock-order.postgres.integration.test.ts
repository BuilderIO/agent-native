import { runWithRequestContext } from "@agent-native/core/server";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("./_document-flush.js", () => ({
  flushOpenDocumentEditorToSql: vi.fn(async () => undefined),
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/core/application-state")
  >()),
  writeAppState: vi.fn(async () => {}),
}));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  countOutcome: vi.fn(),
  track: vi.fn(),
}));
vi.mock("@agent-native/core/collab", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/collab")>()),
  agentTouchDocument: vi.fn(),
}));
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
const OWNER = "synthetic-lock-order-owner@example.test";
const SPACE_ID = "synthetic_lock_order_space";
const STAMP = "2026-01-01T00:00:00.000Z";
const CYCLE_RUNS = 50;

type Db = ReturnType<typeof import("../server/db/index.js").getDb>;
let getDb: () => Db;
let schema: typeof import("../server/db/schema.js");
let compareRowIds: typeof import("./_row-lock-order.js").compareRowIds;
let lockDocumentRows: typeof import("./_row-lock-order.js").lockDocumentRows;
let lockOwnerPageTree: typeof import("./_row-lock-order.js").lockOwnerPageTree;
let lockContentDatabaseMutation: typeof import("./_content-database-mutation-lock.js").lockContentDatabaseMutation;
let lockPrimaryBlocksFields: typeof import("./_blocks-field-identity.js").lockPrimaryBlocksFields;
let lockDatabaseMemberships: typeof import("./_database-membership-lock.js").lockDatabaseMemberships;
let lockDocumentForSave: typeof import("./_document-save-locks.js").lockDocumentForSave;
let configurationRevision: typeof import("./_database-setup-mutation.js").configurationRevision;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
let importedStateFingerprint: typeof import("../server/lib/content-import.js").importedStateFingerprint;
let favoritesSystemIds: typeof import("./_content-favorites.js").favoritesSystemIds;
let favoriteMembershipId: typeof import("./_content-favorites.js").favoriteMembershipId;
let deleteDocument: typeof import("./delete-document.js").default;
let restoreDocument: typeof import("./restore-document.js").default;
let deleteContentDatabase: typeof import("./delete-content-database.js").default;
let restoreContentDatabase: typeof import("./restore-content-database.js").default;
let moveDocument: typeof import("./move-document.js").default;
let undoContentImport: typeof import("./undo-content-import.js").default;
let importContentSource: typeof import("./import-content-source.js").default;
let rollbackSlashDocument: typeof import("./rollback-created-slash-document.js").default;
let planContentTrashPurge: typeof import("./plan-content-trash-purge.js").default;
let permanentlyDeleteDocument: typeof import("./permanently-delete-document.js").default;
let editDocument: typeof import("./edit-document.js").default;
let updateDocument: typeof import("./update-document.js").default;
let restoreDocumentVersion: typeof import("./restore-document-version.js").default;
let removeDatabaseItems: typeof import("./remove-database-items.js").default;
let createDocument: typeof import("./create-document.js").default;
let createContentDatabase: typeof import("./create-content-database.js").default;
let processContentTrashPurge: typeof import("../server/lib/content-trash-purge.js").processContentTrashPurge;

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const target = new URL(POSTGRES_URL);
  const databaseName = target.pathname.slice(1);
  console.info(
    `Lock-order harness target: host ${target.host}, database ${databaseName}, from ${POSTGRES_ENV}`,
  );
  if (!databaseName.toLowerCase().includes("test")) {
    throw new Error(`${POSTGRES_ENV} must name an isolated test database.`);
  }
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  ({ compareRowIds, lockDocumentRows, lockOwnerPageTree } =
    await import("./_row-lock-order.js"));
  ({ lockContentDatabaseMutation } =
    await import("./_content-database-mutation-lock.js"));
  ({ lockPrimaryBlocksFields } = await import("./_blocks-field-identity.js"));
  ({ lockDatabaseMemberships } =
    await import("./_database-membership-lock.js"));
  ({ lockDocumentForSave } = await import("./_document-save-locks.js"));
  ({ configurationRevision } = await import("./_database-setup-mutation.js"));
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  ({ favoritesSystemIds, favoriteMembershipId } =
    await import("./_content-favorites.js"));
  ({ importedStateFingerprint } =
    await import("../server/lib/content-import.js"));
  deleteDocument = (await import("./delete-document.js")).default;
  restoreDocument = (await import("./restore-document.js")).default;
  deleteContentDatabase = (await import("./delete-content-database.js"))
    .default;
  restoreContentDatabase = (await import("./restore-content-database.js"))
    .default;
  moveDocument = (await import("./move-document.js")).default;
  undoContentImport = (await import("./undo-content-import.js")).default;
  importContentSource = (await import("./import-content-source.js")).default;
  rollbackSlashDocument = (await import("./rollback-created-slash-document.js"))
    .default;
  planContentTrashPurge = (await import("./plan-content-trash-purge.js"))
    .default;
  permanentlyDeleteDocument = (await import("./permanently-delete-document.js"))
    .default;
  editDocument = (await import("./edit-document.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  restoreDocumentVersion = (await import("./restore-document-version.js"))
    .default;
  removeDatabaseItems = (await import("./remove-database-items.js")).default;
  createDocument = (await import("./create-document.js")).default;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  ({ processContentTrashPurge } =
    await import("../server/lib/content-trash-purge.js"));
  await (await import("../server/plugins/db.js")).default(undefined as any);
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
  await getDb()
    .insert(schema.contentSpaces)
    .values({
      id: SPACE_ID,
      name: "Synthetic lock-order space",
      kind: "personal",
      ownerEmail: OWNER,
      orgId: null,
      filesDatabaseId: `${SPACE_ID}_files`,
      createdBy: OWNER,
      createdAt: STAMP,
      updatedAt: STAMP,
    })
    .onConflictDoNothing();
}, 60_000);

afterAll(() => {
  delete process.env.DATABASE_URL;
});

const asOwner = async <T>(run: () => T | Promise<T>): Promise<T> =>
  runWithRequestContext({ userEmail: OWNER }, run);
const agent = { caller: "mcp" as const, userEmail: OWNER };

type LockKind = "collection" | "membership" | "page";
type LockedRow = { label: string; kind: LockKind; id: string };

const TABLE: Record<LockKind, string> = {
  collection: "content_databases",
  membership: "content_database_items",
  page: "documents",
};
const KIND_RANK: Record<LockKind, number> = {
  collection: 0,
  membership: 1,
  page: 2,
};

function compareLockedRows(left: LockedRow, right: LockedRow) {
  return (
    KIND_RANK[left.kind] - KIND_RANK[right.kind] ||
    compareRowIds(left.id, right.id)
  );
}

function rowsOf(result: unknown): any[] {
  if (Array.isArray(result)) return result;
  return (result as { rows?: any[] }).rows ?? [];
}

function postgresCode(error: unknown): string | undefined {
  let current = error as { code?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current.code === "string") return current.code;
    current = current.cause as typeof current;
  }
  return undefined;
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
  throw new Error("The action neither finished nor waited on the held row.");
}

async function isRowLocked(row: LockedRow) {
  try {
    await getDb().execute(
      sql`SELECT id FROM ${sql.identifier(TABLE[row.kind])} WHERE id = ${row.id} FOR UPDATE NOWAIT`,
    );
    return false;
  } catch (error) {
    if (postgresCode(error) === "55P03") return true;
    throw error;
  }
}

async function holdRow(row: LockedRow) {
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
    const holderPid = await backendPid(tx);
    const locked = rowsOf(
      await tx.execute(
        sql`SELECT id FROM ${sql.identifier(TABLE[row.kind])} WHERE id = ${row.id} FOR UPDATE`,
      ),
    );
    if (locked.length !== 1)
      throw new Error(`Fixture row ${row.label} is missing.`);
    held(holderPid);
    await released;
  });
  return {
    pid: await Promise.race([
      pid,
      done.then(() => {
        throw new Error("The holder ended before it held its row.");
      }),
    ]),
    release,
    done,
  };
}

type ProbeCase = { rows: LockedRow[]; run: () => Promise<unknown> };

/**
 * Holds each fixture row in turn while the real action runs. When the action
 * waits on the held row, every row it already holds must sort before it in
 * the global order. Each row gets a fresh fixture.
 */
async function probeLockOrder(prepare: () => Promise<ProbeCase>) {
  const first = await prepare();
  const labels = first.rows.map((row) => row.label);
  const waitedOn: string[] = [];
  const violations: string[] = [];
  for (let index = 0; index < labels.length; index += 1) {
    const probe = index === 0 ? first : await prepare();
    expect(probe.rows.map((row) => row.label)).toEqual(labels);
    const target = probe.rows[index]!;
    const holder = await holdRow(target);
    let settled = false;
    const outcome = probe.run().then(
      () => ({ error: undefined as unknown }),
      (error: unknown) => ({ error }),
    );
    void outcome.then(() => {
      settled = true;
    });
    try {
      if (await waitUntilBlockedBy(holder.pid, () => settled)) {
        waitedOn.push(target.label);
        for (const row of probe.rows) {
          if (compareLockedRows(row, target) <= 0) continue;
          if (await isRowLocked(row)) {
            violations.push(`${row.label} before ${target.label}`);
          }
        }
      }
    } finally {
      holder.release();
      await holder.done;
    }
    const { error } = await outcome;
    if (error) throw error;
  }
  return { waitedOn, violations };
}

/**
 * Runs `hold` in a second transaction, starts the action once it holds its
 * rows, and commits `hold` once the action waits on it.
 */
async function raceAgainst(
  hold: (tx: Db) => Promise<unknown>,
  run: () => Promise<unknown>,
) {
  let proceed!: () => void;
  const actionWaiting = new Promise<void>((resolve) => {
    proceed = resolve;
  });
  let holding!: (pid: number) => void;
  const holderPid = new Promise<number>((resolve) => {
    holding = resolve;
  });
  const holder = getDb().transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    const pid = await backendPid(tx);
    await hold(tx);
    holding(pid);
    await actionWaiting;
  });
  let action: Promise<unknown> | undefined;
  let settled = false;
  try {
    const pid = await Promise.race([
      holderPid,
      holder.then(() => {
        throw new Error("The holder ended before it held its rows.");
      }),
    ]);
    action = run();
    void action.then(
      () => (settled = true),
      () => (settled = true),
    );
    expect(await waitUntilBlockedBy(pid, () => settled)).toBe(true);
  } finally {
    proceed();
  }
  await holder;
  return { action: action! };
}

/**
 * Replays the opposing operation's two lock steps in a holder transaction:
 * the first before the action starts, the second once the action waits on
 * it. In the opposite order the two deadlock and Postgres aborts one with
 * 40P01.
 */
async function runCycle(
  prepare: () => Promise<{
    first: (tx: Db) => Promise<unknown>;
    second: (tx: Db) => Promise<unknown>;
    run: () => Promise<unknown>;
  }>,
) {
  for (let run = 0; run < CYCLE_RUNS; run += 1) {
    const cycle = await prepare();
    let proceed!: () => void;
    const actionWaiting = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    let firstHeld!: (pid: number) => void;
    const holderPid = new Promise<number>((resolve) => {
      firstHeld = resolve;
    });
    const holder = getDb().transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      const pid = await backendPid(tx);
      await cycle.first(tx);
      firstHeld(pid);
      await actionWaiting;
      await cycle.second(tx);
    });
    let settled = false;
    let action: Promise<unknown> | undefined;
    try {
      const pid = await Promise.race([
        holderPid,
        holder.then(() => {
          throw new Error("The holder ended before its first lock.");
        }),
      ]);
      action = cycle.run();
      void action.then(
        () => (settled = true),
        () => (settled = true),
      );
      expect(await waitUntilBlockedBy(pid, () => settled)).toBe(true);
    } finally {
      proceed();
    }
    const [holderResult, actionResult] = await Promise.allSettled([
      holder,
      action!,
    ]);
    const failures = [holderResult, actionResult]
      .filter((result) => result.status === "rejected")
      .map((result) => (result as PromiseRejectedResult).reason);
    expect(
      failures.map((error) => postgresCode(error) ?? String(error)),
      `run ${run + 1}`,
    ).toEqual([]);
  }
}

let fixtureSequence = 0;
function fixtureKey() {
  fixtureSequence += 1;
  return `lock_${process.pid}_${Date.now().toString(36)}_${fixtureSequence}`;
}

function pageValues(
  id: string,
  parentId: string | null,
  title: string,
  extra: Partial<typeof schema.documents.$inferInsert> = {},
): typeof schema.documents.$inferInsert {
  return {
    id,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    parentId,
    title,
    content: "",
    visibility: "private",
    createdBy: OWNER,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

function itemValues(
  id: string,
  databaseId: string,
  documentId: string,
  position: number,
): typeof schema.contentDatabaseItems.$inferInsert {
  return {
    id,
    ownerEmail: OWNER,
    databaseId,
    documentId,
    position,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

/**
 * A collection with three rows. Ids are inserted out of id order, so a lock
 * taken in scan order differs from one taken in id order.
 */
async function seedCollection() {
  const key = fixtureKey();
  const ids = {
    collection: `${key}_c`,
    collectionPage: `${key}_p0`,
    row: `${key}_p2`,
    later: `${key}_p3`,
    earlier: `${key}_p1`,
    rowItem: `${key}_m3`,
    laterItem: `${key}_m1`,
    earlierItem: `${key}_m2`,
    otherParent: `${key}_p4`,
  };
  const db = getDb();
  await db.insert(schema.documents).values([
    pageValues(ids.collectionPage, null, "Lock-order collection"),
    pageValues(ids.row, ids.collectionPage, "Row", {
      content: "Row body",
      position: 0,
    }),
    pageValues(ids.later, ids.collectionPage, "Later", { position: 1 }),
    pageValues(ids.earlier, ids.collectionPage, "Earlier", { position: 2 }),
    pageValues(ids.otherParent, null, "Other parent"),
  ]);
  await db.insert(schema.contentDatabases).values({
    id: ids.collection,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    documentId: ids.collectionPage,
    title: "Lock-order collection",
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db
    .insert(schema.contentDatabaseItems)
    .values([
      itemValues(ids.rowItem, ids.collection, ids.row, 0),
      itemValues(ids.laterItem, ids.collection, ids.later, 1),
      itemValues(ids.earlierItem, ids.collection, ids.earlier, 2),
    ]);
  const rows: LockedRow[] = [
    { label: "collection", kind: "collection", id: ids.collection },
    { label: "row membership", kind: "membership", id: ids.rowItem },
    { label: "later membership", kind: "membership", id: ids.laterItem },
    { label: "earlier membership", kind: "membership", id: ids.earlierItem },
    { label: "collection page", kind: "page", id: ids.collectionPage },
    { label: "row page", kind: "page", id: ids.row },
    { label: "later page", kind: "page", id: ids.later },
    { label: "earlier page", kind: "page", id: ids.earlier },
    { label: "other parent page", kind: "page", id: ids.otherParent },
  ];
  return { key, ids, rows };
}

/** A page with three children, and a second parent with one child. */
async function seedPageTree() {
  const key = fixtureKey();
  const ids = {
    parent: `${key}_p0`,
    moved: `${key}_p2`,
    later: `${key}_p3`,
    earlier: `${key}_p1`,
    otherParent: `${key}_p5`,
    otherChild: `${key}_p4`,
  };
  await getDb()
    .insert(schema.documents)
    .values([
      pageValues(ids.parent, null, "Parent"),
      pageValues(ids.moved, ids.parent, "Moved", { position: 0 }),
      pageValues(ids.later, ids.parent, "Later", { position: 1 }),
      pageValues(ids.earlier, ids.parent, "Earlier", { position: 2 }),
      pageValues(ids.otherParent, null, "Other parent"),
      pageValues(ids.otherChild, ids.otherParent, "Other child", {
        position: 0,
      }),
    ]);
  const rows: LockedRow[] = Object.entries(ids).map(([label, id]) => ({
    label: `${label} page`,
    kind: "page",
    id,
  }));
  return { ids, rows };
}

/**
 * A page with a child in one space, both in that space's Files collection, and
 * a page in a second space to move them under.
 */
async function seedSpaceMove() {
  const key = fixtureKey();
  const ids = {
    fromSpace: `${key}_sa`,
    toSpace: `${key}_sb`,
    fromFiles: `${key}_fa`,
    toFiles: `${key}_fb`,
    moved: `${key}_p1`,
    child: `${key}_p3`,
    parent: `${key}_p2`,
    movedItem: `${key}_m2`,
    childItem: `${key}_m1`,
    parentItem: `${key}_m3`,
  };
  const db = getDb();
  for (const [spaceId, filesId] of [
    [ids.fromSpace, ids.fromFiles],
    [ids.toSpace, ids.toFiles],
  ] as const) {
    await db.insert(schema.contentSpaces).values({
      id: spaceId,
      name: `Synthetic ${spaceId}`,
      kind: "user",
      ownerEmail: OWNER,
      orgId: null,
      filesDatabaseId: filesId,
      createdBy: OWNER,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
    await db.insert(schema.contentDatabases).values({
      id: filesId,
      ownerEmail: OWNER,
      spaceId,
      documentId: `${filesId}_page`,
      title: "Files",
      systemRole: "files",
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  }
  await db.insert(schema.documents).values([
    pageValues(ids.moved, null, "Moved", { spaceId: ids.fromSpace }),
    pageValues(ids.child, ids.moved, "Child", {
      spaceId: ids.fromSpace,
      position: 0,
    }),
    pageValues(ids.parent, null, "New parent", { spaceId: ids.toSpace }),
  ]);
  await db
    .insert(schema.contentDatabaseItems)
    .values([
      itemValues(ids.movedItem, ids.fromFiles, ids.moved, 0),
      itemValues(ids.childItem, ids.fromFiles, ids.child, 1),
      itemValues(ids.parentItem, ids.toFiles, ids.parent, 0),
    ]);
  const rows: LockedRow[] = [
    { label: "child membership", kind: "membership", id: ids.childItem },
    { label: "moved membership", kind: "membership", id: ids.movedItem },
    { label: "moved page", kind: "page", id: ids.moved },
    { label: "new parent page", kind: "page", id: ids.parent },
    { label: "child page", kind: "page", id: ids.child },
  ];
  return { key, ids, rows };
}

function moveToOtherSpace(seed: Awaited<ReturnType<typeof seedSpaceMove>>) {
  return asOwner(() =>
    moveDocument.run({
      id: seed.ids.moved,
      spaceId: seed.ids.toSpace,
      parentId: seed.ids.parent,
    }),
  );
}

/** An empty page fresh from the slash menu, filed in a collection with its parent. */
async function seedSlashPage() {
  const key = fixtureKey();
  const now = new Date().toISOString();
  const ids = {
    collection: `${key}_c`,
    collectionPage: `${key}_p0`,
    parent: `${key}_p3`,
    child: `${key}_p1`,
    childItem: `${key}_m2`,
    parentItem: `${key}_m1`,
  };
  const db = getDb();
  await db
    .insert(schema.documents)
    .values([
      pageValues(ids.collectionPage, null, "Files"),
      pageValues(ids.parent, null, "Parent", { content: "Parent body" }),
      pageValues(ids.child, ids.parent, "", { createdAt: now, updatedAt: now }),
    ]);
  await db.insert(schema.contentDatabases).values({
    id: ids.collection,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    documentId: ids.collectionPage,
    title: "Files",
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db
    .insert(schema.contentDatabaseItems)
    .values([
      itemValues(ids.childItem, ids.collection, ids.child, 1),
      itemValues(ids.parentItem, ids.collection, ids.parent, 0),
    ]);
  const rows: LockedRow[] = [
    { label: "collection", kind: "collection", id: ids.collection },
    { label: "child membership", kind: "membership", id: ids.childItem },
    { label: "parent membership", kind: "membership", id: ids.parentItem },
    { label: "collection page", kind: "page", id: ids.collectionPage },
    { label: "parent page", kind: "page", id: ids.parent },
    { label: "child page", kind: "page", id: ids.child },
  ];
  return { ids, rows };
}

/**
 * A Favorites collection, in a space of its own (one per space), holding a
 * page in Trash and a page about to be removed.
 */
async function seedFavorites() {
  const key = fixtureKey();
  const ids = {
    space: `${key}_space`,
    collection: `${key}_c`,
    collectionPage: `${key}_p0`,
    kept: `${key}_p1`,
    removed: `${key}_p2`,
    keptItem: `${key}_m1`,
    removedItem: `${key}_m2`,
  };
  const db = getDb();
  await db.insert(schema.contentSpaces).values({
    id: ids.space,
    name: "Synthetic Favorites space",
    kind: "personal",
    ownerEmail: OWNER,
    orgId: null,
    filesDatabaseId: `${ids.space}_files`,
    createdBy: OWNER,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  const inSpace = { spaceId: ids.space };
  await db.insert(schema.documents).values([
    pageValues(ids.collectionPage, null, "Favorites", inSpace),
    pageValues(ids.kept, null, "Kept", {
      ...inSpace,
      trashedAt: STAMP,
      trashRootId: ids.kept,
    }),
    pageValues(ids.removed, null, "Removed", inSpace),
  ]);
  await db.insert(schema.contentDatabases).values({
    id: ids.collection,
    ownerEmail: OWNER,
    spaceId: ids.space,
    documentId: ids.collectionPage,
    systemRole: "favorites",
    title: "Favorites",
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db
    .insert(schema.contentDatabaseItems)
    .values([
      itemValues(ids.removedItem, ids.collection, ids.removed, 1),
      itemValues(ids.keptItem, ids.collection, ids.kept, 0),
    ]);
  const rows: LockedRow[] = [
    { label: "favorites collection", kind: "collection", id: ids.collection },
    { label: "kept membership", kind: "membership", id: ids.keptItem },
    { label: "removed membership", kind: "membership", id: ids.removedItem },
    { label: "favorites page", kind: "page", id: ids.collectionPage },
    { label: "kept page", kind: "page", id: ids.kept },
    { label: "removed page", kind: "page", id: ids.removed },
  ];
  return { ids, rows };
}

/** A page that owns an inline collection its body no longer embeds. */
async function seedInlineCollection() {
  const key = fixtureKey();
  const ids = {
    collection: `${key}_c`,
    owner: `${key}_p2`,
    collectionPage: `${key}_p1`,
  };
  const db = getDb();
  await db
    .insert(schema.documents)
    .values([
      pageValues(ids.owner, null, "Owner", { content: "Owner body" }),
      pageValues(ids.collectionPage, ids.owner, "Inline collection"),
    ]);
  await db.insert(schema.contentDatabases).values({
    id: ids.collection,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    documentId: ids.collectionPage,
    ownerDocumentId: ids.owner,
    ownerBlockId: `${key}_block`,
    title: "Inline collection",
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  const rows: LockedRow[] = [
    { label: "inline collection", kind: "collection", id: ids.collection },
    { label: "owner page", kind: "page", id: ids.owner },
    { label: "inline collection page", kind: "page", id: ids.collectionPage },
  ];
  return { key, ids, rows };
}

/**
 * A page that backs a collection, owns an inline collection with a lower id,
 * and is a row in a third collection.
 */
async function seedSavedPage() {
  const key = fixtureKey();
  const ids = {
    inline: `${key}_c1`,
    backed: `${key}_c2`,
    outer: `${key}_c3`,
    item: `${key}_m1`,
    outerPage: `${key}_p0`,
    inlinePage: `${key}_p1`,
    page: `${key}_p3`,
  };
  const db = getDb();
  await db
    .insert(schema.documents)
    .values([
      pageValues(ids.outerPage, null, "Outer collection"),
      pageValues(ids.page, ids.outerPage, "Page", { content: "Page body" }),
      pageValues(ids.inlinePage, ids.page, "Inline collection"),
    ]);
  const collection = (id: string, documentId: string, title: string) => ({
    id,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    documentId,
    title,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db.insert(schema.contentDatabases).values([
    {
      ...collection(ids.inline, ids.inlinePage, "Inline collection"),
      ownerDocumentId: ids.page,
      ownerBlockId: `${key}_block`,
    },
    collection(ids.backed, ids.page, "Page"),
    collection(ids.outer, ids.outerPage, "Outer collection"),
  ]);
  await db
    .insert(schema.contentDatabaseItems)
    .values(itemValues(ids.item, ids.outer, ids.page, 0));
  const rows: LockedRow[] = [
    { label: "inline collection", kind: "collection", id: ids.inline },
    { label: "backed collection", kind: "collection", id: ids.backed },
    { label: "outer collection", kind: "collection", id: ids.outer },
    { label: "membership", kind: "membership", id: ids.item },
    { label: "outer collection page", kind: "page", id: ids.outerPage },
    { label: "inline collection page", kind: "page", id: ids.inlinePage },
    { label: "page", kind: "page", id: ids.page },
  ];
  return { ids, rows };
}

async function recordVersion(key: string, documentId: string) {
  const versionId = `${key}_version`;
  await getDb()
    .insert(schema.documentVersions)
    .values({
      id: versionId,
      ownerEmail: OWNER,
      documentId,
      title: (await readPage(documentId)).title,
      content: "Earlier body",
      bodyRevision: 0,
      createdAt: STAMP,
    });
  return versionId;
}

const saveBody = (id: string) =>
  asOwner(() => updateDocument.run({ id, content: "Saved body" }));

const restoreVersion = (documentId: string, versionId: string) =>
  asOwner(() =>
    restoreDocumentVersion.run({
      documentId,
      versionId,
      expectedUpdatedAt: STAMP,
    }),
  );

/** Locks a page the way an UPDATE of it does, without changing it. */
const touchPage = (tx: Db, id: string) =>
  tx
    .update(schema.documents)
    .set({ updatedAt: sql`${schema.documents.updatedAt}` })
    .where(eq(schema.documents.id, id));

/**
 * Two rows in Trash, each its own Trash unit, in two collections. The row in
 * the collection with the higher id has the higher page id.
 */
/**
 * A root page in its space's Files, and in OWNER's Favorites unless
 * `favorite` is false.
 */
async function seedImportedFavorite(favorite = true) {
  const key = fixtureKey();
  const ids = {
    space: `${key}_s`,
    files: `${key}_f`,
    page: `${key}_p`,
    filesItem: `${key}_m1`,
    membership: `${key}_m2`,
  };
  const db = getDb();
  await db.insert(schema.contentSpaces).values({
    id: ids.space,
    name: "Synthetic Favorites import space",
    kind: "user",
    ownerEmail: OWNER,
    orgId: null,
    filesDatabaseId: ids.files,
    createdBy: OWNER,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db.insert(schema.contentDatabases).values({
    id: ids.files,
    ownerEmail: OWNER,
    spaceId: ids.space,
    documentId: `${ids.files}_page`,
    title: "Files",
    systemRole: "files",
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db
    .insert(schema.documents)
    .values(pageValues(ids.page, null, "Favorite", { spaceId: ids.space }));
  await db
    .insert(schema.contentDatabaseItems)
    .values(itemValues(ids.filesItem, ids.files, ids.page, 0));
  if (favorite) {
    await db
      .insert(schema.contentDatabaseItems)
      .values(
        itemValues(
          ids.membership,
          favoritesSystemIds(OWNER).databaseId,
          ids.page,
          0,
        ),
      );
  }
  const rows: LockedRow[] = [
    { label: "favorite membership", kind: "membership", id: ids.membership },
    { label: "favorite page", kind: "page", id: ids.page },
  ];
  const importUnfavorited = () =>
    asOwner(() =>
      importContentSource.run({
        files: {
          "favorite.md": `---
id: "${ids.page}"
title: "Favorite"
isFavorite: false
---
`,
        },
      }),
    );
  return { ids, rows, importUnfavorited };
}

async function seedPurgeUnits() {
  const key = fixtureKey();
  const ids = {
    lowCollection: `${key}_c1`,
    highCollection: `${key}_c2`,
    lowItem: `${key}_m1`,
    highItem: `${key}_m2`,
    lowCollectionPage: `${key}_p0`,
    highCollectionPage: `${key}_p1`,
    lowRow: `${key}_p2`,
    highRow: `${key}_p3`,
  };
  const db = getDb();
  await db
    .insert(schema.documents)
    .values([
      pageValues(ids.lowCollectionPage, null, "Low collection"),
      pageValues(ids.highCollectionPage, null, "High collection"),
      pageValues(ids.lowRow, ids.lowCollectionPage, "Low row"),
      pageValues(ids.highRow, ids.highCollectionPage, "High row"),
    ]);
  const collection = (id: string, documentId: string, title: string) => ({
    id,
    ownerEmail: OWNER,
    spaceId: SPACE_ID,
    documentId,
    title,
    createdAt: STAMP,
    updatedAt: STAMP,
  });
  await db
    .insert(schema.contentDatabases)
    .values([
      collection(ids.lowCollection, ids.lowCollectionPage, "Low collection"),
      collection(ids.highCollection, ids.highCollectionPage, "High collection"),
    ]);
  await db
    .insert(schema.contentDatabaseItems)
    .values([
      itemValues(ids.lowItem, ids.lowCollection, ids.lowRow, 0),
      itemValues(ids.highItem, ids.highCollection, ids.highRow, 0),
    ]);
  await asOwner(() => deleteDocument.run({ id: ids.lowRow }));
  await asOwner(() => deleteDocument.run({ id: ids.highRow }));
  const plan = await asOwner(() =>
    planContentTrashPurge.run({
      mode: "selection",
      documentIds: [ids.lowRow, ids.highRow],
    }),
  );
  const operationId = `${key}_purge`;
  await db.insert(schema.contentTrashPurgeOperations).values({
    id: operationId,
    planId: plan.planId,
    actorEmail: OWNER,
    idempotencyKey: operationId,
    status: "queued",
    eligibleCount: plan.eligibleCount,
  });
  const rows: LockedRow[] = [
    { label: "low collection", kind: "collection", id: ids.lowCollection },
    { label: "high collection", kind: "collection", id: ids.highCollection },
    { label: "low membership", kind: "membership", id: ids.lowItem },
    { label: "high membership", kind: "membership", id: ids.highItem },
    { label: "low collection page", kind: "page", id: ids.lowCollectionPage },
    { label: "high collection page", kind: "page", id: ids.highCollectionPage },
    { label: "low row page", kind: "page", id: ids.lowRow },
    { label: "high row page", kind: "page", id: ids.highRow },
  ];
  return { ids, rows, operationId };
}

/** Trashed pages a sharer owns, each shared to OWNER as an admin. */
async function seedSharedOrgTrash(
  key: string,
  pages: Array<{ id: string; parentId?: string; trashRootId: string }>,
) {
  const sharer = "synthetic-lock-order-sharer@example.test";
  const orgId = `${key}_org`;
  const spaceId = `${key}_space`;
  // Purging someone else's pages needs an organization space.
  await getDb().execute(
    sql`INSERT INTO organizations (id, name, created_by, created_at) VALUES (${orgId}, 'Lock order', ${sharer}, ${Date.now()})`,
  );
  await getDb().execute(
    sql`INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (${`${orgId}_member`}, ${orgId}, ${OWNER}, 'admin', ${Date.now()})`,
  );
  await getDb()
    .insert(schema.contentSpaces)
    .values({
      id: spaceId,
      name: "Lock order org",
      kind: "organization",
      ownerEmail: sharer,
      orgId,
      filesDatabaseId: `${key}_files`,
      createdBy: sharer,
      createdAt: STAMP,
      updatedAt: STAMP,
    });
  await getDb()
    .insert(schema.documents)
    .values(
      pages.map(({ id, parentId, trashRootId }) =>
        pageValues(id, parentId ?? null, id, {
          ownerEmail: sharer,
          createdBy: sharer,
          orgId,
          spaceId,
          trashedAt: STAMP,
          trashRootId,
        }),
      ),
    );
  await getDb()
    .insert(schema.documentShares)
    .values(
      pages.map(({ id }) => ({
        id: `${id}_share`,
        resourceId: id,
        principalType: "user",
        principalId: OWNER,
        role: "admin",
        createdBy: sharer,
      })),
    );
  const asMember = <T>(run: () => Promise<T>) =>
    runWithRequestContext({ userEmail: OWNER, orgId }, run);
  return { sharer, orgId, spaceId, asMember };
}

async function queuePurge(key: string, orgId: string, documentIds: string[]) {
  const plan = await runWithRequestContext({ userEmail: OWNER, orgId }, () =>
    planContentTrashPurge.run({ mode: "selection", documentIds }),
  );
  expect(plan.blockedCount).toBe(0);
  const operationId = `${key}_purge`;
  await getDb().insert(schema.contentTrashPurgeOperations).values({
    id: operationId,
    planId: plan.planId,
    actorEmail: OWNER,
    orgId,
    idempotencyKey: operationId,
    status: "queued",
    eligibleCount: plan.eligibleCount,
  });
  return { planId: plan.planId, operationId };
}

async function readPurgeOperation(operationId: string) {
  const [operation] = await getDb()
    .select({
      status: schema.contentTrashPurgeOperations.status,
      deletedCount: schema.contentTrashPurgeOperations.deletedCount,
      blockedCount: schema.contentTrashPurgeOperations.blockedCount,
    })
    .from(schema.contentTrashPurgeOperations)
    .where(eq(schema.contentTrashPurgeOperations.id, operationId));
  return operation;
}

async function readPage(id: string) {
  const [page] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  if (!page) throw new Error(`Fixture page ${id} is missing.`);
  return page;
}

async function readCollection(id: string) {
  const [collection] = await getDb()
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.id, id));
  if (!collection) throw new Error(`Fixture collection ${id} is missing.`);
  return collection;
}

async function trashRow(seed: Awaited<ReturnType<typeof seedCollection>>) {
  await asOwner(() => deleteDocument.run({ id: seed.ids.row }));
  return (await readPage(seed.ids.row)).trashedAt!;
}

async function trashCollection(
  seed: Awaited<ReturnType<typeof seedCollection>>,
) {
  await asOwner(() =>
    deleteContentDatabase.run({ databaseId: seed.ids.collection }),
  );
}

function collectionTarget(seed: Awaited<ReturnType<typeof seedCollection>>) {
  return {
    spaceId: SPACE_ID,
    databaseId: seed.ids.collection,
    databaseDocumentId: seed.ids.collectionPage,
  };
}

async function recordImport(importId: string, pageIds: string[]) {
  for (const pageId of pageIds) {
    const page = await readPage(pageId);
    await getDb()
      .insert(schema.documentImports)
      .values({
        documentId: pageId,
        ownerEmail: OWNER,
        importId,
        requestSha256: "synthetic",
        sourceName: `${pageId}.md`,
        sourceFormat: "markdown",
        sourceBytes: page.content.length,
        sourceSha256: "synthetic",
        originalBlob: "synthetic",
        importedTitle: page.title,
        importedStateSha256: importedStateFingerprint(page),
        reportJson: "{}",
      });
  }
}

const COLLECTION_ROWS = [
  "collection",
  "row membership",
  "later membership",
  "earlier membership",
  "row page",
  "later page",
  "earlier page",
];

describe.skipIf(!POSTGRES_URL)(
  POSTGRES_URL
    ? "Content row-lock order on PostgreSQL"
    : "Content row-lock order on PostgreSQL (skipped: set CONTENT_ROW_MUTATION_POSTGRES_URL or CONTENT_MIGRATION_POSTGRES_URL to a test database)",
  () => {
    describe("lifecycle actions lock collections, then memberships, then pages, each by id", () => {
      it("guarded Trash", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                deleteDocument.run(
                  {
                    id: seed.ids.row,
                    expectedUpdatedAt: STAMP,
                    idempotencyKey: `${seed.key}-trash`,
                  },
                  agent,
                ),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["collection", "row page"]);
      });

      it("legacy Trash", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () => asOwner(() => deleteDocument.run({ id: seed.ids.row })),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["collection", "row page"]);
      });

      it("guarded restore", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          const trashedAt = await trashRow(seed);
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                restoreDocument.run(
                  {
                    id: seed.ids.row,
                    expectedTrashedAt: trashedAt,
                    idempotencyKey: `${seed.key}-restore`,
                  },
                  agent,
                ),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(COLLECTION_ROWS);
      });

      it("legacy restore", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          await trashRow(seed);
          return {
            rows: seed.rows,
            run: () => asOwner(() => restoreDocument.run({ id: seed.ids.row })),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(COLLECTION_ROWS);
      });

      it("restore locks every membership's page, wherever it lives", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          const otherItem = `${seed.key}_m4`;
          await getDb()
            .insert(schema.contentDatabaseItems)
            .values(
              itemValues(
                otherItem,
                seed.ids.collection,
                seed.ids.otherParent,
                3,
              ),
            );
          const trashedAt = await trashRow(seed);
          return {
            rows: [
              ...seed.rows,
              {
                label: "other parent membership",
                kind: "membership",
                id: otherItem,
              },
            ],
            run: () =>
              asOwner(() =>
                restoreDocument.run(
                  {
                    id: seed.ids.row,
                    expectedTrashedAt: trashedAt,
                    idempotencyKey: `${seed.key}-restore`,
                  },
                  agent,
                ),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          ...COLLECTION_ROWS,
          "other parent page",
          "other parent membership",
        ]);
      });

      it("guarded collection Trash", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          const collection = await readCollection(seed.ids.collection);
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                deleteContentDatabase.run(
                  {
                    target: collectionTarget(seed),
                    expectedConfigurationRevision:
                      configurationRevision(collection),
                    idempotencyKey: `${seed.key}-collection-trash`,
                  },
                  agent,
                ),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "collection page",
          "row page",
          "later page",
          "earlier page",
        ]);
      });

      it("legacy collection Trash", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                deleteContentDatabase.run({ databaseId: seed.ids.collection }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "collection page",
          "row page",
          "later page",
          "earlier page",
        ]);
      });

      it("guarded collection restore", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          await trashCollection(seed);
          const collection = await readCollection(seed.ids.collection);
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                restoreContentDatabase.run(
                  {
                    target: collectionTarget(seed),
                    expectedConfigurationRevision:
                      configurationRevision(collection),
                    idempotencyKey: `${seed.key}-collection-restore`,
                  },
                  agent,
                ),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "row membership",
          "later membership",
          "earlier membership",
          "collection page",
          "row page",
          "later page",
          "earlier page",
        ]);
      });

      it("legacy collection restore", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          await trashCollection(seed);
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                restoreContentDatabase.run({ databaseId: seed.ids.collection }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "row membership",
          "later membership",
          "earlier membership",
          "collection page",
          "row page",
          "later page",
          "earlier page",
        ]);
      });

      it("permanent delete", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          await trashRow(seed);
          const plan = await asOwner(() =>
            planContentTrashPurge.run({
              mode: "selection",
              documentIds: [seed.ids.row],
            }),
          );
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                permanentlyDeleteDocument.run({
                  id: seed.ids.row,
                  planId: plan.planId,
                  scopeToken: plan.scopeToken,
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "row membership",
          "later membership",
          "earlier membership",
          "row page",
        ]);
      });

      it("permanent delete of a page whose child is its own Trash item", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedPageTree();
          await asOwner(() => deleteDocument.run({ id: seed.ids.otherChild }));
          await asOwner(() => deleteDocument.run({ id: seed.ids.otherParent }));
          const plan = await asOwner(() =>
            planContentTrashPurge.run({
              mode: "selection",
              documentIds: [seed.ids.otherParent],
            }),
          );
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                permanentlyDeleteDocument.run({
                  id: seed.ids.otherParent,
                  planId: plan.planId,
                  scopeToken: plan.scopeToken,
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "otherParent page",
          "otherChild page",
        ]);
      });

      it("a Trash purge of two units in two collections", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedPurgeUnits();
          return {
            rows: seed.rows,
            run: async () => {
              await asOwner(() => processContentTrashPurge(seed.operationId));
              const [operation] = await getDb()
                .select({
                  status: schema.contentTrashPurgeOperations.status,
                  lastError: schema.contentTrashPurgeOperations.lastError,
                })
                .from(schema.contentTrashPurgeOperations)
                .where(
                  eq(schema.contentTrashPurgeOperations.id, seed.operationId),
                );
              if (operation?.status !== "succeeded") {
                throw new Error(
                  `Purge ended ${operation?.status}: ${operation?.lastError}`,
                );
              }
            },
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "low collection",
          "high collection",
          "low membership",
          "high membership",
          "low row page",
          "high row page",
        ]);
      });

      it("removing a Favorite", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedFavorites();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                removeDatabaseItems.run({
                  databaseId: seed.ids.collection,
                  itemIds: [seed.ids.removedItem],
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "favorites collection",
          "kept membership",
          "removed membership",
        ]);
      });

      it("removing a collection row", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                removeDatabaseItems.run({
                  databaseId: seed.ids.collection,
                  itemIds: [seed.ids.rowItem],
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "row membership",
          "later membership",
          "earlier membership",
          "later page",
          "earlier page",
        ]);
      });

      it("move to a new position among siblings", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedPageTree();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                moveDocument.run({ id: seed.ids.moved, position: 2 }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "moved page",
          "later page",
          "earlier page",
        ]);
      });

      it("move under a new parent at a position", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedPageTree();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                moveDocument.run({
                  id: seed.ids.moved,
                  parentId: seed.ids.otherParent,
                  position: 0,
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "moved page",
          "otherParent page",
          "otherChild page",
        ]);
      });

      it("move a collection's page", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                moveDocument.run({
                  id: seed.ids.collectionPage,
                  parentId: seed.ids.otherParent,
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "collection page",
          "other parent page",
        ]);
      });

      it("move an inline collection's page out of its owner page", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedInlineCollection();
          return {
            rows: seed.rows,
            run: async () => {
              await asOwner(() =>
                moveDocument.run({
                  id: seed.ids.collectionPage,
                  parentId: null,
                }),
              );
              const [collection] = await getDb()
                .select({
                  ownerDocumentId: schema.contentDatabases.ownerDocumentId,
                })
                .from(schema.contentDatabases)
                .where(eq(schema.contentDatabases.id, seed.ids.collection));
              if (collection?.ownerDocumentId !== null) {
                throw new Error("The move kept the collection's owner page.");
              }
            },
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "inline collection",
          "inline collection page",
        ]);
      });

      it("move to another space", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedSpaceMove();
          return { rows: seed.rows, run: () => moveToOtherSpace(seed) };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "child membership",
          "moved membership",
          "moved page",
          "new parent page",
          "child page",
        ]);
      });

      it("undo import", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          const importId = `${seed.key}-import`;
          await recordImport(importId, [seed.ids.row, seed.ids.later]);
          return {
            rows: seed.rows,
            run: () => asOwner(() => undoContentImport.run({ importId })),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "row page",
          "later page",
        ]);
      });

      it("slash-menu rollback", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedSlashPage();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                rollbackSlashDocument.run({
                  id: seed.ids.child,
                  parentId: seed.ids.parent,
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "collection",
          "parent page",
          "child page",
        ]);
      });
    });

    describe("saves lock memberships before the page", () => {
      it("guarded edit", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                editDocument.run(
                  {
                    id: seed.ids.row,
                    baseRevision: documentRevisionToken(0, "Row body"),
                    idempotencyKey: `${seed.key}-edit`,
                    find: "Row body",
                    replace: "Edited body",
                  },
                  agent,
                ),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["row membership", "row page"]);
      });

      it("legacy edit", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () =>
              asOwner(() =>
                editDocument.run({
                  id: seed.ids.row,
                  find: "Row body",
                  replace: "Edited body",
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["row membership", "row page"]);
      });

      it("import that removes a favorite", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedImportedFavorite();
          return { rows: seed.rows, run: seed.importUnfavorited };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "favorite membership",
          "favorite page",
        ]);
      });

      it("update-document", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          return {
            rows: seed.rows,
            run: () => saveBody(seed.ids.row),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["row membership", "row page"]);
      });

      it("restore-document-version", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedCollection();
          const versionId = await recordVersion(seed.key, seed.ids.row);
          return {
            rows: seed.rows,
            run: () => restoreVersion(seed.ids.row, versionId),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["row membership", "row page"]);
      });
    });

    describe("saves that drop an inline collection lock it before the owner page", () => {
      it("update-document", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedInlineCollection();
          return {
            rows: seed.rows,
            run: () => saveBody(seed.ids.owner),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["inline collection", "owner page"]);
        const seed = await seedInlineCollection();
        await saveBody(seed.ids.owner);
        expect(
          (await readCollection(seed.ids.collection)).deletedAt,
        ).toBeTruthy();
      });

      it("restore-document-version", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedInlineCollection();
          const versionId = await recordVersion(seed.key, seed.ids.owner);
          return {
            rows: seed.rows,
            run: () => restoreVersion(seed.ids.owner, versionId),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual(["inline collection", "owner page"]);
      });

      it("lockDocumentForSave takes a page's own and inline collections in one pass", async () => {
        const report = await probeLockOrder(async () => {
          const seed = await seedSavedPage();
          return {
            rows: seed.rows,
            run: () =>
              getDb().transaction((tx) =>
                lockDocumentForSave(tx as unknown as Db, {
                  documentId: seed.ids.page,
                  ownerEmail: OWNER,
                  body: true,
                }),
              ),
          };
        });
        expect(report.violations).toEqual([]);
        expect(report.waitedOn).toEqual([
          "inline collection",
          "backed collection",
          "membership",
          "page",
        ]);
      });
    });

    describe(`known cycles run ${CYCLE_RUNS} times without a deadlock`, () => {
      it("importing a favorite's removal against an edit of the page", async () => {
        await runCycle(async () => {
          const seed = await seedImportedFavorite();
          return {
            // edit-document: the page's memberships, then the page.
            first: (tx) =>
              lockDatabaseMemberships(tx, [
                seed.ids.filesItem,
                seed.ids.membership,
              ]),
            second: (tx) => lockDocumentRows(tx, [seed.ids.page]),
            run: seed.importUnfavorited,
          };
        });
      });

      it("restoring a collection row against an edit of it (cycle #1)", async () => {
        await runCycle(async () => {
          const seed = await seedCollection();
          const trashedAt = await trashRow(seed);
          return {
            // edit-document: the page's memberships, then the page.
            first: (tx) => lockPrimaryBlocksFields(tx, seed.ids.row),
            second: (tx) => touchPage(tx, seed.ids.row),
            run: () =>
              asOwner(() =>
                restoreDocument.run(
                  {
                    id: seed.ids.row,
                    expectedTrashedAt: trashedAt,
                    idempotencyKey: `${seed.key}-restore`,
                  },
                  agent,
                ),
              ),
          };
        });
      }, 120_000);

      it("undoing an import against a Trash of its page", async () => {
        await runCycle(async () => {
          const seed = await seedCollection();
          const importId = `${seed.key}-import`;
          await recordImport(importId, [seed.ids.row]);
          return {
            // Trash: the page's collection, then the page.
            first: (tx) => lockContentDatabaseMutation(tx, seed.ids.collection),
            second: (tx) => lockDocumentRows(tx, [seed.ids.row]),
            run: () => asOwner(() => undoContentImport.run({ importId })),
          };
        });
      }, 120_000);

      it("saving a collection row against an edit of it (cycle A)", async () => {
        await runCycle(async () => {
          const seed = await seedCollection();
          return {
            first: (tx) => lockPrimaryBlocksFields(tx, seed.ids.row),
            second: (tx) => touchPage(tx, seed.ids.row),
            run: () => saveBody(seed.ids.row),
          };
        });
      }, 120_000);

      it("restoring a version of a collection row against an edit of it (cycle B)", async () => {
        await runCycle(async () => {
          const seed = await seedCollection();
          const versionId = await recordVersion(seed.key, seed.ids.row);
          return {
            first: (tx) => lockPrimaryBlocksFields(tx, seed.ids.row),
            second: (tx) => touchPage(tx, seed.ids.row),
            run: () => restoreVersion(seed.ids.row, versionId),
          };
        });
      }, 120_000);

      it("saving a page that drops its inline collection against a Trash of the page (cycle C)", async () => {
        await runCycle(async () => {
          const seed = await seedInlineCollection();
          return {
            // Trash: the subtree's collections, then its pages.
            first: (tx) => lockContentDatabaseMutation(tx, seed.ids.collection),
            second: (tx) => lockDocumentRows(tx, [seed.ids.owner]),
            run: () => saveBody(seed.ids.owner),
          };
        });
      }, 120_000);

      it("rolling back a slash-menu page against a Trash of it", async () => {
        await runCycle(async () => {
          const seed = await seedSlashPage();
          return {
            first: (tx) => lockContentDatabaseMutation(tx, seed.ids.collection),
            second: (tx) => lockDocumentRows(tx, [seed.ids.child]),
            run: () =>
              asOwner(() =>
                rollbackSlashDocument.run({
                  id: seed.ids.child,
                  parentId: seed.ids.parent,
                }),
              ),
          };
        });
      }, 120_000);

      it("moving a page to another space against an edit of it", async () => {
        await runCycle(async () => {
          const seed = await seedSpaceMove();
          return {
            // edit-document: the page's memberships, then the page.
            first: (tx) => lockPrimaryBlocksFields(tx, seed.ids.moved),
            second: (tx) =>
              tx
                .update(schema.documents)
                .set({ updatedAt: sql`${schema.documents.updatedAt}` })
                .where(eq(schema.documents.id, seed.ids.moved)),
            run: () => moveToOtherSpace(seed),
          };
        });
      }, 120_000);

      it("removing a collection row against a Blocks-field lock on its siblings", async () => {
        await runCycle(async () => {
          const seed = await seedCollection();
          return {
            // Deleting another collection's primary Blocks property locks
            // its pages' memberships here, in id order.
            first: (tx) => lockDatabaseMemberships(tx, [seed.ids.laterItem]),
            second: (tx) => lockDatabaseMemberships(tx, [seed.ids.rowItem]),
            run: () =>
              asOwner(() =>
                removeDatabaseItems.run({
                  databaseId: seed.ids.collection,
                  itemIds: [seed.ids.rowItem],
                }),
              ),
          };
        });
      }, 120_000);
    });

    it.each([
      {
        path: "revisioned",
        edit: (seed: Awaited<ReturnType<typeof seedCollection>>) =>
          editDocument.run(
            {
              id: seed.ids.row,
              baseRevision: documentRevisionToken(0, "Row body"),
              idempotencyKey: `${seed.key}-edit`,
              find: "Row body",
              replace: "Edited body",
            },
            agent,
          ),
      },
      {
        path: "unrevisioned",
        edit: (seed: Awaited<ReturnType<typeof seedCollection>>) =>
          editDocument.run({
            id: seed.ids.row,
            find: "Row body",
            replace: "Edited body",
          }),
      },
      {
        path: "browser save",
        edit: (seed: Awaited<ReturnType<typeof seedCollection>>) =>
          updateDocument.run({ id: seed.ids.row, content: "Saved body" }),
      },
      {
        path: "version restore",
        edit: async (seed: Awaited<ReturnType<typeof seedCollection>>) =>
          restoreDocumentVersion.run({
            documentId: seed.ids.row,
            versionId: await recordVersion(seed.key, seed.ids.row),
            expectedUpdatedAt: STAMP,
          }),
      },
    ])(
      "refuses an edit ($path) whose page moves to Trash while it commits",
      async ({ edit: runEdit }) => {
        const seed = await seedCollection();
        let proceed!: () => void;
        const editWaiting = new Promise<void>((resolve) => {
          proceed = resolve;
        });
        let trashing!: (pid: number) => void;
        const holderPid = new Promise<number>((resolve) => {
          trashing = resolve;
        });
        const trashedAt = new Date().toISOString();
        const trash = getDb().transaction(async (transaction) => {
          const tx = transaction as unknown as Db;
          const pid = await backendPid(tx);
          await lockContentDatabaseMutation(tx, seed.ids.collection);
          await lockDocumentRows(tx, [seed.ids.row]);
          await tx
            .update(schema.documents)
            .set({ trashedAt, trashRootId: seed.ids.row, updatedAt: trashedAt })
            .where(eq(schema.documents.id, seed.ids.row));
          trashing(pid);
          await editWaiting;
        });
        let edit: Promise<unknown> | undefined;
        let settled = false;
        try {
          const pid = await holderPid;
          edit = asOwner(() => runEdit(seed));
          void edit.then(
            () => (settled = true),
            () => (settled = true),
          );
          expect(await waitUntilBlockedBy(pid, () => settled)).toBe(true);
        } finally {
          proceed();
        }
        await trash;
        await expect(edit).rejects.toMatchObject({
          errorCode: "DOCUMENT_NOT_FOUND",
          statusCode: 404,
        });
        expect(await readPage(seed.ids.row)).toMatchObject({
          content: "Row body",
          bodyRevision: 0,
          trashedAt,
        });
      },
    );

    const saves = [
      {
        path: "browser save",
        prepare: async (_key: string, pageId: string) => () => saveBody(pageId),
      },
      {
        path: "version restore",
        prepare: async (key: string, pageId: string) => {
          const versionId = await recordVersion(key, pageId);
          return () => restoreVersion(pageId, versionId);
        },
      },
    ];
    // Each row is added after the save took its locks, so the save holds the
    // page but not the row an edit, restore or Trash of the page locks first.
    const scopeChanges = [
      {
        change: "an inline collection it would drop is created",
        add: async (tx: Db, key: string, pageId: string) => {
          await tx
            .insert(schema.documents)
            .values(pageValues(`${key}_p1`, pageId, "Inline"));
          await tx.insert(schema.contentDatabases).values({
            id: `${key}_c`,
            ownerEmail: OWNER,
            spaceId: SPACE_ID,
            documentId: `${key}_p1`,
            ownerDocumentId: pageId,
            ownerBlockId: `${key}_block`,
            title: "Inline",
            createdAt: STAMP,
            updatedAt: STAMP,
          });
        },
        unchanged: async (key: string) => {
          const [collection] = await getDb()
            .select({ deletedAt: schema.contentDatabases.deletedAt })
            .from(schema.contentDatabases)
            .where(eq(schema.contentDatabases.id, `${key}_c`));
          expect(collection).toEqual({ deletedAt: null });
        },
      },
      {
        change: "the page is added to a collection",
        add: async (tx: Db, key: string, pageId: string) => {
          await tx
            .insert(schema.documents)
            .values(pageValues(`${key}_p1`, null, "Collection"));
          await tx.insert(schema.contentDatabases).values({
            id: `${key}_c`,
            ownerEmail: OWNER,
            spaceId: SPACE_ID,
            documentId: `${key}_p1`,
            title: "Collection",
            createdAt: STAMP,
            updatedAt: STAMP,
          });
          await tx
            .insert(schema.contentDatabaseItems)
            .values(itemValues(`${key}_m`, `${key}_c`, pageId, 0));
        },
        unchanged: async () => {},
      },
    ];

    it.each(
      saves.flatMap((save) =>
        scopeChanges.map((scopeChange) => ({ ...save, ...scopeChange })),
      ),
    )(
      "refuses a $path when $change while it waits",
      async ({ prepare, add, unchanged }) => {
        const key = fixtureKey();
        const pageId = `${key}_p2`;
        await getDb()
          .insert(schema.documents)
          .values(pageValues(pageId, null, "Owner", { content: "Owner body" }));
        const save = await prepare(key, pageId);
        const { action } = await raceAgainst(async (tx) => {
          await lockDocumentRows(tx, [pageId]);
          await add(tx, key, pageId);
        }, save);
        await expect(action).rejects.toMatchObject({
          errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED",
          statusCode: 409,
        });
        await unchanged(key);
        expect(await readPage(pageId)).toMatchObject({
          content: "Owner body",
          bodyRevision: 0,
        });
      },
    );

    it.each(saves)(
      "refuses a $path when one of its memberships is removed while it waits",
      async ({ prepare }) => {
        const seed = await seedCollection();
        const save = await prepare(seed.key, seed.ids.row);
        const { action } = await raceAgainst(
          (tx) =>
            tx
              .delete(schema.contentDatabaseItems)
              .where(eq(schema.contentDatabaseItems.id, seed.ids.rowItem)),
          save,
        );
        await expect(action).rejects.toMatchObject({
          errorCode: "DATABASE_MEMBERSHIPS_CHANGED",
          statusCode: 409,
        });
        expect(await readPage(seed.ids.row)).toMatchObject({
          content: "Row body",
          bodyRevision: 0,
        });
      },
    );

    it("refuses with a typed conflict when a membership is deleted while it waits to lock it", async () => {
      const seed = await seedCollection();
      const { action: lock } = await raceAgainst(
        (tx) =>
          tx
            .delete(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.id, seed.ids.rowItem)),
        () =>
          getDb().transaction((tx) =>
            lockDatabaseMemberships(tx, [seed.ids.rowItem, seed.ids.laterItem]),
          ),
      );
      await expect(lock).rejects.toMatchObject({
        errorCode: "DATABASE_MEMBERSHIPS_CHANGED",
        statusCode: 409,
      });
    });

    it("refuses a move that would close a cycle with a concurrent move of other pages", async () => {
      const seed = await seedPageTree();
      // The concurrent move puts parent under otherChild, locking neither page
      // this move locks. Afterwards otherParent's subtree holds moved.
      const { action: move } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.parent, seed.ids.otherChild]);
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.otherChild })
            .where(eq(schema.documents.id, seed.ids.parent));
        },
        () =>
          asOwner(() =>
            moveDocument.run({
              id: seed.ids.otherParent,
              parentId: seed.ids.moved,
            }),
          ),
      );
      await expect(move).rejects.toMatchObject({
        errorCode: "DOCUMENT_MOVE_UNDER_DESCENDANT",
        statusCode: 400,
        message: "A document cannot be moved under one of its children",
      });
      expect(await readPage(seed.ids.otherParent)).toMatchObject({
        parentId: null,
      });
    });

    it("refuses a reorder whose sibling moves to another parent while it waits", async () => {
      const seed = await seedPageTree();
      const { action: move } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.later, seed.ids.otherParent]);
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.otherParent })
            .where(eq(schema.documents.id, seed.ids.later));
        },
        () =>
          asOwner(() => moveDocument.run({ id: seed.ids.moved, position: 2 })),
      );
      await expect(move).rejects.toMatchObject({
        errorCode: "DOCUMENT_MOVE_SCOPE_CHANGED",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.later)).toMatchObject({
        parentId: seed.ids.otherParent,
        position: 1,
      });
    });

    it("refuses a move to another space that would close a cycle with a concurrent move back", async () => {
      const seed = await seedSpaceMove();
      // The concurrent move takes the new parent into the first space, under
      // child. This move waits on nothing else that move holds.
      const { action: move } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.parent]);
          await tx
            .update(schema.documents)
            .set({ spaceId: seed.ids.fromSpace, parentId: seed.ids.child })
            .where(eq(schema.documents.id, seed.ids.parent));
        },
        () => moveToOtherSpace(seed),
      );
      await expect(move).rejects.toMatchObject({
        errorCode: "DOCUMENT_MOVE_SCOPE_CHANGED",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        spaceId: seed.ids.fromSpace,
        parentId: null,
      });
    });

    it("refuses a move to another space whose new parent moves to Trash while it waits", async () => {
      const seed = await seedSpaceMove();
      const trashedAt = new Date().toISOString();
      const { action: move } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.parent]);
          await tx
            .update(schema.documents)
            .set({
              trashedAt,
              trashRootId: seed.ids.parent,
              updatedAt: trashedAt,
            })
            .where(eq(schema.documents.id, seed.ids.parent));
        },
        () => moveToOtherSpace(seed),
      );
      await expect(move).rejects.toMatchObject({
        errorCode: "PARENT_TRASHED",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        spaceId: seed.ids.fromSpace,
        parentId: null,
      });
    });

    it("skips an imported reparent that would close a cycle with a concurrent move", async () => {
      // The first space has a Files collection, which the import files into.
      const seed = await seedSpaceMove();
      const other = `${seed.key}_p0`;
      const otherChild = `${seed.key}_p4`;
      await getDb()
        .insert(schema.documents)
        .values([
          pageValues(other, null, "Other", { spaceId: seed.ids.fromSpace }),
          pageValues(otherChild, other, "Other child", {
            spaceId: seed.ids.fromSpace,
          }),
        ]);
      // The move puts moved under otherChild while the import puts other
      // under child, which is under moved. They lock no row in common.
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.moved, otherChild]);
          await tx
            .update(schema.documents)
            .set({ parentId: otherChild })
            .where(eq(schema.documents.id, seed.ids.moved));
        },
        () =>
          asOwner(() =>
            importContentSource.run({
              files: {
                "other.md": `---
id: "${other}"
title: "Other"
parentId: "${seed.ids.child}"
---
`,
              },
            }),
          ),
      );
      await expect(imported).resolves.toMatchObject({
        skipped: [
          { path: "other.md", reason: "Skipped parent update: cycle." },
        ],
      });
      expect(await readPage(other)).toMatchObject({ parentId: null });
    });

    it("skips an imported reparent to an unchanged parent that a concurrent move put under the page", async () => {
      const seed = await seedSpaceMove();
      const file = (position: number) => ({
        "child.md": `---
id: "${seed.ids.child}"
title: "Child"
parentId: "${seed.ids.moved}"
position: ${position}
---
`,
      });
      // The first import records the source, so the second writes nothing
      // before its reparent and doesn't wait on the child's row there.
      await asOwner(() => importContentSource.run({ files: file(0) }));
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.child, seed.ids.moved]);
          await tx
            .update(schema.documents)
            .set({ parentId: null })
            .where(eq(schema.documents.id, seed.ids.child));
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.child })
            .where(eq(schema.documents.id, seed.ids.moved));
        },
        () => asOwner(() => importContentSource.run({ files: file(8) })),
      );
      await expect(imported).resolves.toMatchObject({
        skipped: [
          {
            path: "child.md",
            reason:
              "Skipped layout update: the page moved while it was being imported.",
          },
        ],
      });
      expect(await readPage(seed.ids.child)).toMatchObject({ parentId: null });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        parentId: seed.ids.child,
      });
    });

    it("skips an imported reparent whose parent moves to Trash while it waits", async () => {
      const seed = await seedSpaceMove();
      const other = `${seed.key}_p0`;
      await getDb()
        .insert(schema.documents)
        .values(
          pageValues(other, null, "Other", { spaceId: seed.ids.fromSpace }),
        );
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.moved]);
          await tx
            .update(schema.documents)
            .set({ trashedAt: STAMP, trashRootId: seed.ids.moved })
            .where(eq(schema.documents.id, seed.ids.moved));
        },
        () =>
          asOwner(() =>
            importContentSource.run({
              files: {
                "other.md": `---
id: "${other}"
title: "Other"
parentId: "${seed.ids.moved}"
---
`,
              },
            }),
          ),
      );
      await expect(imported).resolves.toMatchObject({
        skipped: [
          {
            path: "other.md",
            reason: `Skipped parent "${seed.ids.moved}" because it is in Trash.`,
          },
        ],
      });
      expect(await readPage(other)).toMatchObject({ parentId: null });
    });

    it("refuses a move to another space when a page under it moves out while it waits", async () => {
      const seed = await seedSpaceMove();
      const { action: moved } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.child]);
          await tx
            .update(schema.documents)
            .set({ parentId: null })
            .where(eq(schema.documents.id, seed.ids.child));
        },
        () => moveToOtherSpace(seed),
      );
      await expect(moved).rejects.toMatchObject({
        errorCode: "PAGE_SUBTREE_CHANGED",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.child)).toMatchObject({
        parentId: null,
        spaceId: seed.ids.fromSpace,
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        spaceId: seed.ids.fromSpace,
      });
    });

    it("gives a page moved to another space the access its new parent has once the move holds it", async () => {
      const seed = await seedSpaceMove();
      await getDb()
        .update(schema.documents)
        .set({ visibility: "public" })
        .where(eq(schema.documents.id, seed.ids.parent));
      await getDb()
        .insert(schema.documentShares)
        .values({
          id: `${seed.key}_share`,
          resourceId: seed.ids.parent,
          principalType: "user",
          principalId: "viewer@example.test",
          role: "viewer",
          createdBy: OWNER,
          createdAt: STAMP,
        });
      const { action: moved } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.parent]);
          await tx
            .update(schema.documents)
            .set({ visibility: "private" })
            .where(eq(schema.documents.id, seed.ids.parent));
          await tx
            .delete(schema.documentShares)
            .where(eq(schema.documentShares.resourceId, seed.ids.parent));
        },
        () => moveToOtherSpace(seed),
      );
      await expect(moved).resolves.toMatchObject({ id: seed.ids.moved });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        spaceId: seed.ids.toSpace,
        visibility: "private",
      });
      expect(
        await getDb()
          .select({ id: schema.documentShares.id })
          .from(schema.documentShares)
          .where(eq(schema.documentShares.resourceId, seed.ids.moved)),
      ).toEqual([]);
    });

    it("refuses a move to another space whose mover loses access to the page while it waits", async () => {
      const seed = await seedSpaceMove();
      const mover = "synthetic-lock-order-mover@example.test";
      await getDb()
        .update(schema.contentSpaces)
        .set({ ownerEmail: mover, createdBy: mover })
        .where(eq(schema.contentSpaces.id, seed.ids.toSpace));
      await getDb()
        .update(schema.contentDatabases)
        .set({ ownerEmail: mover })
        .where(eq(schema.contentDatabases.id, seed.ids.toFiles));
      const shareOf = (page: string) => `${page}_mover_share`;
      await getDb()
        .insert(schema.documentShares)
        .values(
          [seed.ids.moved, seed.ids.child].map((page) => ({
            id: shareOf(page),
            resourceId: page,
            principalType: "user",
            principalId: mover,
            role: "editor",
            createdBy: OWNER,
            createdAt: STAMP,
          })),
        );
      const { action: moved } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.moved]);
          await tx
            .delete(schema.documentShares)
            .where(eq(schema.documentShares.id, shareOf(seed.ids.moved)));
        },
        () =>
          runWithRequestContext({ userEmail: mover }, () =>
            moveDocument.run({ id: seed.ids.moved, spaceId: seed.ids.toSpace }),
          ),
      );
      await expect(moved).rejects.toMatchObject({ statusCode: 403 });
      for (const page of [seed.ids.moved, seed.ids.child]) {
        expect(await readPage(page)).toMatchObject({
          ownerEmail: OWNER,
          spaceId: seed.ids.fromSpace,
        });
      }
    });

    it("refuses a move to another space of a page turned into a collection while it waits", async () => {
      const seed = await seedSpaceMove();
      const { action: moved } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.child]);
          await tx.insert(schema.contentDatabases).values({
            id: `${seed.key}_c1`,
            ownerEmail: OWNER,
            spaceId: seed.ids.fromSpace,
            documentId: seed.ids.child,
            title: "Converted",
            createdAt: STAMP,
            updatedAt: STAMP,
          });
        },
        () =>
          asOwner(() =>
            moveDocument.run({ id: seed.ids.moved, spaceId: seed.ids.toSpace }),
          ),
      );
      await expect(moved).rejects.toMatchObject({
        errorCode: "PAGE_CONTAINS_COLLECTION",
        statusCode: 409,
      });
      for (const page of [seed.ids.moved, seed.ids.child]) {
        expect(await readPage(page)).toMatchObject({
          spaceId: seed.ids.fromSpace,
        });
      }
    });

    it("appends a page moved to another space after a page another move appended while it waited", async () => {
      const seed = await seedSpaceMove();
      const sibling = `${seed.key}_p4`;
      await getDb()
        .insert(schema.documents)
        .values(
          pageValues(sibling, null, "Sibling", { spaceId: seed.ids.toSpace }),
        );
      const { action: moved } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.parent, position: 0 })
            .where(eq(schema.documents.id, sibling));
        },
        () => moveToOtherSpace(seed),
      );
      await expect(moved).resolves.toMatchObject({ id: seed.ids.moved });
      expect(await readPage(sibling)).toMatchObject({
        parentId: seed.ids.parent,
        position: 0,
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        parentId: seed.ids.parent,
        position: 1,
      });
    });

    it("skips an imported update of a page already in Trash", async () => {
      const seed = await seedSpaceMove();
      await getDb()
        .update(schema.documents)
        .set({ trashedAt: STAMP, trashRootId: seed.ids.child })
        .where(eq(schema.documents.id, seed.ids.child));
      const imported = await asOwner(() =>
        importContentSource.run({
          files: {
            "child.md": `---
id: "${seed.ids.child}"
title: "Renamed"
parentId: "${seed.ids.moved}"
position: 8
---
`,
          },
        }),
      );
      expect(imported).toMatchObject({
        updated: [],
        skipped: [
          {
            path: "child.md",
            reason:
              "Skipped update: the page is in Trash. Restore it, then import again.",
          },
        ],
      });
      expect(await readPage(seed.ids.child)).toMatchObject({
        title: "Child",
        position: 0,
      });
    });

    it("skips an imported update of a page that moves to Trash while it waits", async () => {
      const seed = await seedSpaceMove();
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.child]);
          await tx
            .update(schema.documents)
            .set({ trashedAt: STAMP, trashRootId: seed.ids.child })
            .where(eq(schema.documents.id, seed.ids.child));
        },
        () =>
          asOwner(() =>
            importContentSource.run({
              files: {
                "child.md": `---
id: "${seed.ids.child}"
title: "Renamed"
---
`,
              },
            }),
          ),
      );
      await expect(imported).resolves.toMatchObject({
        updated: [],
        skipped: [
          {
            path: "child.md",
            reason:
              "Skipped update: the page is in Trash. Restore it, then import again.",
          },
        ],
      });
      expect((await readPage(seed.ids.child)).title).toBe("Child");
    });

    it("skips an imported layout update for a page that moves to Trash while it waits", async () => {
      const seed = await seedSpaceMove();
      const file = (position: number) => ({
        "child.md": `---
id: "${seed.ids.child}"
title: "Child"
parentId: "${seed.ids.moved}"
position: ${position}
---
`,
      });
      await asOwner(() => importContentSource.run({ files: file(0) }));
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.child]);
          await tx
            .update(schema.documents)
            .set({ trashedAt: STAMP, trashRootId: seed.ids.child })
            .where(eq(schema.documents.id, seed.ids.child));
        },
        () => asOwner(() => importContentSource.run({ files: file(8) })),
      );
      await expect(imported).resolves.toMatchObject({
        skipped: [
          {
            path: "child.md",
            reason:
              "Skipped layout update: the page was deleted or moved to Trash.",
          },
        ],
      });
      expect((await readPage(seed.ids.child)).position).not.toBe(8);
    });

    it("skips an imported layout update for a page that moves to another parent while it waits", async () => {
      const seed = await seedSpaceMove();
      const other = `${seed.key}_p4`;
      await getDb()
        .insert(schema.documents)
        .values(
          pageValues(other, null, "Other", { spaceId: seed.ids.fromSpace }),
        );
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.moved, other]);
          await tx
            .update(schema.documents)
            .set({ parentId: other, position: 3 })
            .where(eq(schema.documents.id, seed.ids.moved));
        },
        () =>
          asOwner(() =>
            importContentSource.run({
              files: {
                "moved.md": `---
id: "${seed.ids.moved}"
title: "Moved"
position: 7
---
`,
              },
            }),
          ),
      );
      await expect(imported).resolves.toMatchObject({
        skipped: [
          {
            path: "moved.md",
            reason:
              "Skipped layout update: the page moved while it was being imported.",
          },
        ],
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        parentId: other,
        position: 3,
      });
    });

    it("refuses a reorder whose siblings are reordered while it waits", async () => {
      const seed = await seedPageTree();
      const { action: reordered } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.later, seed.ids.earlier]);
          await tx
            .update(schema.documents)
            .set({ position: 2 })
            .where(eq(schema.documents.id, seed.ids.later));
          await tx
            .update(schema.documents)
            .set({ position: 1 })
            .where(eq(schema.documents.id, seed.ids.earlier));
        },
        () =>
          asOwner(() => moveDocument.run({ id: seed.ids.moved, position: 2 })),
      );
      await expect(reordered).rejects.toMatchObject({
        errorCode: "DOCUMENT_MOVE_SCOPE_CHANGED",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.earlier)).toMatchObject({ position: 1 });
      expect(await readPage(seed.ids.later)).toMatchObject({ position: 2 });
    });

    it("refuses a reorder whose page moves to another parent while it waits", async () => {
      const seed = await seedPageTree();
      const { action: reordered } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await lockDocumentRows(tx, [seed.ids.moved, seed.ids.otherParent]);
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.otherParent, position: 1 })
            .where(eq(schema.documents.id, seed.ids.moved));
        },
        () =>
          asOwner(() => moveDocument.run({ id: seed.ids.moved, position: 2 })),
      );
      await expect(reordered).rejects.toMatchObject({
        errorCode: "DOCUMENT_MOVE_SCOPE_CHANGED",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        parentId: seed.ids.otherParent,
        position: 1,
      });
    });

    it.each([
      { kind: "reorder", move: () => ({ position: 2 }) },
      {
        kind: "reparent",
        move: (ids: { otherParent: string }) => ({ parentId: ids.otherParent }),
      },
    ])(
      "refuses a $kind of a page that moves to Trash while it waits",
      async ({ move }) => {
        const seed = await seedPageTree();
        const { action: moving } = await raceAgainst(
          async (tx) => {
            await lockOwnerPageTree(tx, OWNER);
            await lockDocumentRows(tx, [seed.ids.moved]);
            await tx
              .update(schema.documents)
              .set({ trashedAt: STAMP, trashRootId: seed.ids.moved })
              .where(eq(schema.documents.id, seed.ids.moved));
          },
          () =>
            asOwner(() =>
              moveDocument.run({ id: seed.ids.moved, ...move(seed.ids) }),
            ),
        );
        await expect(moving).rejects.toMatchObject({
          errorCode: "DOCUMENT_NOT_FOUND",
          statusCode: 404,
        });
        expect(await readPage(seed.ids.moved)).toMatchObject({
          parentId: seed.ids.parent,
          position: 0,
        });
      },
    );

    for (const [created, create] of [
      [
        "page",
        (parentId: string) =>
          createDocument.run({ title: "Late child", parentId }),
      ],
      [
        "collection",
        (parentId: string) =>
          createContentDatabase.run({ title: "Late collection", parentId }),
      ],
    ] as const)
      for (const [change, update, errorCode] of [
        ["moves to another space", "space", "PARENT_SCOPE_CHANGED"],
        ["moves to Trash", "trash", "PARENT_TRASHED"],
      ] as const) {
        it(`refuses a ${created} created under a parent that ${change} while it waits`, async () => {
          const seed = await seedSpaceMove();
          const { action: creating } = await raceAgainst(
            async (tx) => {
              await lockDocumentRows(tx, [seed.ids.moved]);
              await tx
                .update(schema.documents)
                .set(
                  update === "space"
                    ? { spaceId: seed.ids.toSpace }
                    : { trashedAt: STAMP, trashRootId: seed.ids.moved },
                )
                .where(eq(schema.documents.id, seed.ids.moved));
            },
            () => asOwner(() => create(seed.ids.moved)),
          );
          await expect(creating).rejects.toMatchObject({
            errorCode,
            statusCode: 409,
          });
          expect(
            await getDb()
              .select({ id: schema.documents.id })
              .from(schema.documents)
              .where(eq(schema.documents.parentId, seed.ids.moved)),
          ).toEqual([{ id: seed.ids.child }]);
        });
      }

    it("fails only the imported file whose favorite removal races a new favorite", async () => {
      const seed = await seedImportedFavorite(false);
      const other = `${seed.ids.page}_other`;
      await getDb()
        .insert(schema.documents)
        .values(pageValues(other, null, "Other", { spaceId: seed.ids.space }));
      await getDb()
        .insert(schema.contentDatabaseItems)
        .values(itemValues(`${other}_item`, seed.ids.files, other, 1));
      const { action: imported } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.page]);
          await tx
            .insert(schema.contentDatabaseItems)
            .values(
              itemValues(
                seed.ids.membership,
                favoritesSystemIds(OWNER).databaseId,
                seed.ids.page,
                0,
              ),
            );
        },
        () =>
          asOwner(() =>
            importContentSource.run({
              files: {
                "favorite.md": `---
id: "${seed.ids.page}"
title: "Favorite"
isFavorite: false
---
`,
                "other.md": `---
id: "${other}"
title: "Other renamed"
---
`,
              },
            }),
          ),
      );
      await expect(imported).resolves.toMatchObject({
        errors: [
          {
            path: "favorite.md",
            reason:
              "The page's Favorites membership changed while it was being imported. Import it again.",
          },
        ],
        updated: [{ id: other, path: "other.md" }],
      });
      expect((await readPage(other)).title).toBe("Other renamed");
      const memberships = await getDb()
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.documentId, seed.ids.page));
      expect(memberships.map((row) => row.id).sort(compareRowIds)).toEqual(
        [seed.ids.filesItem, seed.ids.membership].sort(compareRowIds),
      );
    });

    it("refuses a favorite added while a permanent delete removes the page", async () => {
      const seed = await seedImportedFavorite(false);
      const { action: favorited } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.page]);
          await tx
            .delete(schema.contentDatabaseItems)
            .where(eq(schema.contentDatabaseItems.documentId, seed.ids.page));
          await tx
            .delete(schema.documents)
            .where(eq(schema.documents.id, seed.ids.page));
        },
        () =>
          asOwner(() =>
            updateDocument.run({ id: seed.ids.page, isFavorite: true }),
          ),
      );
      await expect(favorited).rejects.toMatchObject({
        errorCode: "DOCUMENT_NOT_FOUND",
      });
      expect(
        await getDb()
          .select({ id: schema.contentDatabaseItems.id })
          .from(schema.contentDatabaseItems)
          .where(eq(schema.contentDatabaseItems.documentId, seed.ids.page)),
      ).toEqual([]);
    });

    it("holds a new imported favorite's page until its membership is inserted", async () => {
      const pageId = `${fixtureKey()}_p`;
      // A pending insert of the same membership stalls the favorite at its
      // insert. A Trash or delete that takes the page meanwhile would miss it.
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let holding!: (pid: number) => void;
      const holderPid = new Promise<number>((resolve) => {
        holding = resolve;
      });
      const holder = getDb().transaction(async (transaction) => {
        const tx = transaction as unknown as Db;
        await tx
          .insert(schema.contentDatabaseItems)
          .values(
            itemValues(
              favoriteMembershipId(OWNER, pageId),
              favoritesSystemIds(OWNER).databaseId,
              pageId,
              0,
            ),
          );
        holding(await backendPid(tx));
        await released;
      });
      const pid = await Promise.race([
        holderPid,
        holder.then(() => {
          throw new Error("The holder ended before it held its row.");
        }),
      ]);
      let settled = false;
      const imported = asOwner(() =>
        importContentSource.run({
          files: {
            "new.md": `---
id: "${pageId}"
title: "New favorite"
isFavorite: true
---
`,
          },
        }),
      );
      void imported.then(
        () => (settled = true),
        () => (settled = true),
      );
      let pageHeld: boolean;
      try {
        expect(await waitUntilBlockedBy(pid, () => settled)).toBe(true);
        pageHeld = await isRowLocked({
          label: "new page",
          kind: "page",
          id: pageId,
        });
      } finally {
        release();
      }
      await holder;
      await expect(imported).resolves.toMatchObject({
        created: [expect.objectContaining({ id: pageId })],
      });
      expect(pageHeld).toBe(true);
    });

    it("refuses a permanent delete whose page a move takes out of its Trash group while it waits", async () => {
      const seed = await seedPageTree();
      await asOwner(() => deleteDocument.run({ id: seed.ids.otherParent }));
      const plan = await asOwner(() =>
        planContentTrashPurge.run({
          mode: "selection",
          documentIds: [seed.ids.otherParent],
        }),
      );
      const { action: purge } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.otherChild]);
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.parent })
            .where(eq(schema.documents.id, seed.ids.otherChild));
        },
        () =>
          asOwner(() =>
            permanentlyDeleteDocument.run({
              id: seed.ids.otherParent,
              planId: plan.planId,
              scopeToken: plan.scopeToken,
            }),
          ),
      );
      await expect(purge).rejects.toMatchObject({
        errorCode: "scope_changed",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.otherChild)).toMatchObject({
        parentId: seed.ids.parent,
      });
      await readPage(seed.ids.otherParent);
    });

    it("refuses a permanent delete whose page is restored while it waits", async () => {
      const seed = await seedPageTree();
      await asOwner(() => deleteDocument.run({ id: seed.ids.otherChild }));
      const plan = await asOwner(() =>
        planContentTrashPurge.run({
          mode: "selection",
          documentIds: [seed.ids.otherChild],
        }),
      );
      const { action: purge } = await raceAgainst(
        async (tx) => {
          await lockDocumentRows(tx, [seed.ids.otherChild]);
          await tx
            .update(schema.documents)
            .set({ trashedAt: null, trashRootId: null })
            .where(eq(schema.documents.id, seed.ids.otherChild));
        },
        () =>
          asOwner(() =>
            permanentlyDeleteDocument.run({
              id: seed.ids.otherChild,
              planId: plan.planId,
              scopeToken: plan.scopeToken,
            }),
          ),
      );
      await expect(purge).rejects.toMatchObject({
        errorCode: "scope_changed",
        statusCode: 409,
      });
      expect(await readPage(seed.ids.otherChild)).toMatchObject({
        trashedAt: null,
      });
    });

    it("checks access to each purge unit in that unit's transaction", async () => {
      const key = fixtureKey();
      const pages = [`${key}_p1`, `${key}_p2`];
      const { orgId, asMember } = await seedSharedOrgTrash(
        key,
        pages.map((id) => ({ id, trashRootId: id })),
      );
      const { planId, operationId } = await queuePurge(key, orgId, pages);
      // The sharer revokes both shares as the first unit's deletion commits.
      const revoke = `${key}_revoke`;
      await getDb().execute(
        sql.raw(
          `CREATE FUNCTION ${revoke}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM document_shares WHERE id IN ('${pages[0]}_share', '${pages[1]}_share'); RETURN NEW; END $$`,
        ),
      );
      await getDb().execute(
        sql.raw(
          `CREATE TRIGGER ${revoke} AFTER UPDATE OF outcome ON content_trash_purge_plan_items FOR EACH ROW WHEN (NEW.outcome = 'deleted' AND NEW.plan_id = '${planId}') EXECUTE FUNCTION ${revoke}()`,
        ),
      );
      try {
        await asMember(() => processContentTrashPurge(operationId));
      } finally {
        await getDb().execute(
          sql.raw(`DROP TRIGGER ${revoke} ON content_trash_purge_plan_items`),
        );
        await getDb().execute(sql.raw(`DROP FUNCTION ${revoke}()`));
      }
      expect(await readPurgeOperation(operationId)).toEqual({
        status: "partially_completed",
        deletedCount: 1,
        blockedCount: 1,
      });
      const remaining = await getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(inArray(schema.documents.id, pages));
      expect(remaining).toHaveLength(1);
    });

    it("blocks the collection owner of a page in a purge unit that loses access", async () => {
      const key = fixtureKey();
      const ids = {
        root: `${key}_p1`,
        member: `${key}_p2`,
        owner: `${key}_p3`,
        collection: `${key}_c1`,
        membership: `${key}_m1`,
      };
      const { sharer, orgId, spaceId, asMember } = await seedSharedOrgTrash(
        key,
        [
          { id: ids.root, trashRootId: ids.root },
          { id: ids.member, parentId: ids.root, trashRootId: ids.root },
          { id: ids.owner, trashRootId: ids.owner },
        ],
      );
      await getDb().insert(schema.contentDatabases).values({
        id: ids.collection,
        ownerEmail: sharer,
        spaceId,
        documentId: ids.owner,
        title: "Owner collection",
        createdAt: STAMP,
        updatedAt: STAMP,
      });
      await getDb()
        .insert(schema.contentDatabaseItems)
        .values({
          ...itemValues(ids.membership, ids.collection, ids.member, 0),
          ownerEmail: sharer,
        });
      const { operationId } = await queuePurge(key, orgId, [
        ids.root,
        ids.owner,
      ]);
      // The member keeps its own share, so only the root page loses access.
      await getDb()
        .delete(schema.documentShares)
        .where(eq(schema.documentShares.id, `${ids.root}_share`));
      await asMember(() => processContentTrashPurge(operationId));
      expect(await readPurgeOperation(operationId)).toMatchObject({
        deletedCount: 0,
        blockedCount: 3,
      });
      const remaining = await getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(inArray(schema.documents.id, [ids.root, ids.member, ids.owner]));
      expect(remaining).toHaveLength(3);
      expect(await readCollection(ids.collection)).toBeDefined();
    });

    it("appends a moved page after a page another move appended while it waited", async () => {
      const seed = await seedPageTree();
      const { action: moved } = await raceAgainst(
        async (tx) => {
          await lockOwnerPageTree(tx, OWNER);
          await tx
            .update(schema.documents)
            .set({ parentId: seed.ids.otherParent, position: 1 })
            .where(eq(schema.documents.id, seed.ids.later));
        },
        () =>
          asOwner(() =>
            moveDocument.run({
              id: seed.ids.moved,
              parentId: seed.ids.otherParent,
            }),
          ),
      );
      await moved;
      expect(await readPage(seed.ids.later)).toMatchObject({
        parentId: seed.ids.otherParent,
        position: 1,
      });
      expect(await readPage(seed.ids.moved)).toMatchObject({
        parentId: seed.ids.otherParent,
        position: 2,
      });
    });

    it.each([
      {
        change: "moves to Trash",
        update: (ids: { otherParent: string; moved: string }) => ({
          trashedAt: new Date().toISOString(),
          trashRootId: ids.otherParent,
        }),
        refusal: { errorCode: "DOCUMENT_NOT_FOUND", statusCode: 404 },
      },
      {
        change: "moves to another section",
        update: () => ({ orgId: "another-org" }),
        refusal: { errorCode: "DOCUMENT_MOVE_SCOPE_CHANGED", statusCode: 409 },
      },
      {
        change: "moves under the page",
        update: (ids: { otherParent: string; moved: string }) => ({
          parentId: ids.moved,
        }),
        refusal: {
          errorCode: "DOCUMENT_MOVE_UNDER_DESCENDANT",
          statusCode: 400,
          message: "A document cannot be moved under one of its children",
        },
      },
    ])(
      "refuses a move under a parent that $change while the move commits",
      async ({ update, refusal }) => {
        const seed = await seedPageTree();
        const { action: move } = await raceAgainst(
          async (tx) => {
            await lockDocumentRows(tx, [seed.ids.otherParent]);
            await tx
              .update(schema.documents)
              .set(update(seed.ids))
              .where(eq(schema.documents.id, seed.ids.otherParent));
          },
          () =>
            asOwner(() =>
              moveDocument.run({
                id: seed.ids.moved,
                parentId: seed.ids.otherParent,
              }),
            ),
        );
        await expect(move).rejects.toMatchObject(refusal);
        expect(await readPage(seed.ids.moved)).toMatchObject({
          parentId: seed.ids.parent,
        });
      },
    );
  },
);
