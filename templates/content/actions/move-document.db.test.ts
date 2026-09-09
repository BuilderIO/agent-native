import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// move-document fires a `writeAppState("refresh-signal", …)` UI-refresh ping
// after every move, through a separate raw connection from the action's own
// `getDb()`. Six concurrent moves each opening/closing a `db.transaction()`
// on the drizzle connection while that separate connection tries to upsert
// `application_state` creates cross-connection lock contention in local tests,
// which can occasionally exceed the query timeout — a pre-existing test-harness
// artifact of that dual-connection
// design, unrelated to the sibling-position race this file tests. Stub it
// out so the test isolates the resequencing behavior.
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

const accessRace = vi.hoisted(() => ({
  afterAccess: null as null | ((id: string) => Promise<void>),
}));
vi.mock("@agent-native/core/sharing", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@agent-native/core/sharing")>();
  return {
    ...actual,
    assertAccess: async (...args: Parameters<typeof actual.assertAccess>) => {
      const access = await actual.assertAccess(...args);
      await accessRace.afterAccess?.(args[1]);
      return access;
    },
  };
});

const positionRace = vi.hoisted(() => ({
  beforeLock: null as null | ((db: any) => Promise<void>),
}));
vi.mock("./_document-lifecycle.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_document-lifecycle.js")>();
  return {
    ...actual,
    lockLiveDocuments: async (
      ...args: Parameters<typeof actual.lockLiveDocuments>
    ) => {
      await positionRace.beforeLock?.(args[0]);
      return actual.lockLiveDocuments(...args);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `move-document-position-race-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let moveDocumentAction: typeof import("./move-document.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  moveDocumentAction = (await import("./move-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(async () => {
  await closeDbExec();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;

function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${Math.random().toString(36).slice(2, 8)}`;
}

async function createDocument(args: {
  id?: string;
  parentId?: string | null;
  title?: string;
  position?: number;
  ownerEmail?: string;
  spaceId?: string | null;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    spaceId: args.spaceId ?? null,
    parentId: args.parentId ?? null,
    title: args.title ?? "Untitled",
    content: "",
    position: args.position ?? 0,
    visibility: "private",
    orgId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function childPositions(parentId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: schema.documents.id,
      position: schema.documents.position,
    })
    .from(schema.documents)
    .where(eq(schema.documents.parentId, parentId));
  return rows as { id: string; position: number }[];
}

describe("move-document position race", () => {
  it.each(["source", "destination"])(
    "rejects a move when the %s enters Trash after preflight",
    async (target) => {
      const id = await createDocument({ title: "Moving page" });
      const parentId = await createDocument({ title: "Destination" });
      const trashedId = target === "source" ? id : parentId;
      accessRace.afterAccess = async (accessedId) => {
        if (accessedId !== parentId) return;
        accessRace.afterAccess = null;
        await getDb()
          .update(schema.documents)
          .set({ trashedAt: new Date().toISOString(), trashRootId: trashedId })
          .where(eq(schema.documents.id, trashedId));
      };
      try {
        await expect(
          runWithRequestContext({ userEmail: OWNER }, () =>
            moveDocumentAction.run({ id, parentId }),
          ),
        ).rejects.toMatchObject({ errorCode: "DOCUMENT_TRASHED" });
        await expect(
          getDb()
            .select({ parentId: schema.documents.parentId })
            .from(schema.documents)
            .where(eq(schema.documents.id, id)),
        ).resolves.toEqual([{ parentId: null }]);
      } finally {
        accessRace.afterAccess = null;
      }
    },
  );

  it("moves into a live parent without reordering its trashed children", async () => {
    const parentId = await createDocument({ title: "Live destination" });
    const trashedId = await createDocument({ parentId, position: 7 });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString(), trashRootId: trashedId })
      .where(eq(schema.documents.id, trashedId));
    const id = await createDocument({ title: "Moving page" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id, parentId, position: 0 }),
      ),
    ).resolves.toMatchObject({ id, parentId, position: 0 });
    await expect(
      getDb()
        .select({ position: schema.documents.position })
        .from(schema.documents)
        .where(eq(schema.documents.id, trashedId)),
    ).resolves.toEqual([{ position: 7 }]);
  });

  it.each(["append", "reorder"])(
    "refreshes %s positions when a child arrives before the parent lock",
    async (mode) => {
      const parentId = await createDocument({ title: "Parent" });
      const id = await createDocument({ title: "Moving page" });
      const arrivalId = nextId("arrival");
      positionRace.beforeLock = async (db) => {
        positionRace.beforeLock = null;
        const now = new Date().toISOString();
        await db.insert(schema.documents).values({
          id: arrivalId,
          parentId,
          ownerEmail: OWNER,
          title: "New child",
          content: "",
          visibility: "private",
          position: 0,
          createdAt: now,
          updatedAt: now,
        });
      };
      try {
        const result = runWithRequestContext({ userEmail: OWNER }, () =>
          moveDocumentAction.run({
            id,
            parentId,
            ...(mode === "reorder" ? { position: 0 } : {}),
          }),
        );
        if (mode === "append") {
          await expect(result).resolves.toMatchObject({
            id,
            parentId,
            position: 1,
          });
        } else {
          await expect(result).rejects.toMatchObject({
            errorCode: "DOCUMENT_HIERARCHY_CHANGED",
          });
          await expect(
            getDb()
              .select({ parentId: schema.documents.parentId })
              .from(schema.documents)
              .where(eq(schema.documents.id, id)),
          ).resolves.toEqual([{ parentId: null }]);
        }
      } finally {
        positionRace.beforeLock = null;
      }
    },
  );

  it("rejects a parent in another Content space", async () => {
    const id = await createDocument({ spaceId: "space-one" });
    const parentId = await createDocument({ spaceId: "space-two" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id, parentId } as any),
      ),
    ).rejects.toThrow("same Content space");
  });

  it("assigns distinct, gapless positions when several documents are reparented into the same parent at an explicit position concurrently", async () => {
    const parentId = await createDocument({ title: "Parent" });
    // Two pre-existing children the resequence branch must also account for.
    const existingChildIds = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        createDocument({
          parentId,
          title: `Existing ${index}`,
          position: index,
        }),
      ),
    );
    // Six standalone documents that all get reparented into the same parent,
    // each pinned to the top (position 0), concurrently — e.g. several
    // near-simultaneous drag-to-top or bulk-reparent operations. The
    // explicit-position resequence branch reads every current sibling under
    // the target parent, computes a full renumbering, then writes it back;
    // none of these six calls' reads can see each other's new row (each
    // reads the parent's children before any of the others have committed),
    // so each independently computes "I'm the only new arrival" and writes
    // itself at position 0 without touching the others' rows — regardless of
    // commit order, that produces a 6-way collision at position 0 unless the
    // reads are serialized against the writes.
    const incomingIds = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createDocument({ title: `Incoming ${index}` }),
      ),
    );

    await Promise.all(
      incomingIds.map((id) =>
        Promise.resolve(
          runWithRequestContext({ userEmail: OWNER }, () =>
            moveDocumentAction.run({ id, parentId, position: 0 } as any),
          ),
        ),
      ),
    );

    const rows = await childPositions(parentId);
    // Eight documents now share this parent: the two pre-existing children
    // plus the six reparented incoming documents.
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => row.id))).toEqual(
      new Set([...existingChildIds, ...incomingIds]),
    );
    // Every position must be unique — concurrent reparents resequencing the
    // same parent from a stale read would otherwise collide on (or skip) a
    // position value.
    expect(new Set(rows.map((row) => row.position)).size).toBe(8);
    expect(rows.map((row) => row.position).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
