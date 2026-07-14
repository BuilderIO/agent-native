import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// move-document fires a `writeAppState("refresh-signal", …)` UI-refresh ping
// after every move, through a separate raw connection from the action's own
// `getDb()`. Six concurrent moves each opening/closing a `db.transaction()`
// on the drizzle connection while that separate connection tries to upsert
// `application_state` is enough cross-connection SQLite write-lock
// contention to occasionally exceed `busy_timeout` and throw "database is
// locked" — a pre-existing test-harness artifact of that dual-connection
// design, unrelated to the sibling-position race this file tests. Stub it
// out so the test isolates the resequencing behavior.
vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `move-document-position-race-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let moveDocumentAction: typeof import("./move-document.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  moveDocumentAction = (await import("./move-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
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
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
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
        runWithRequestContext({ userEmail: OWNER }, () =>
          moveDocumentAction.run({ id, parentId, position: 0 } as any),
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
