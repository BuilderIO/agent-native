import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

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

afterAll(() => {
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

describe("move-document linked folders", () => {
  async function linkedFile(args: {
    path: string;
    parentId?: string | null;
    linked?: boolean;
    mode?: string;
    kind?: string;
    rootPath?: string;
    wrongItem?: boolean;
  }) {
    const db = getDb();
    const databaseId = nextId("files");
    const sourceId = nextId("source");
    const itemId = nextId("item");
    const id = await createDocument({ parentId: args.parentId });
    await db
      .update(schema.documents)
      .set({
        sourceMode: args.mode ?? "local-files",
        sourceKind: args.kind ?? "file",
        sourcePath: args.path,
        sourceRootPath: args.rootPath ?? "vault",
      })
      .where(eq(schema.documents.id, id));
    await db.insert(schema.contentDatabaseSources).values({
      id: sourceId,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "local-folder",
      sourceName: "vault",
      sourceTable: "vault",
    });
    await db.insert(schema.contentDatabaseItems).values({
      id: itemId,
      ownerEmail: OWNER,
      databaseId,
      documentId: id,
    });
    if (args.linked !== false) {
      await db.insert(schema.contentDatabaseSourceRows).values({
        id: nextId("row"),
        ownerEmail: OWNER,
        sourceId,
        databaseItemId: args.wrongItem ? nextId("stale-item") : itemId,
        documentId: id,
        sourceRowId: args.path,
        sourceQualifiedId: `local-folder://vault/${args.path}`,
        sourceDisplayKey: args.path,
      });
    }
    return id;
  }

  it("refuses to reparent linked nested files, including files already moved, without changing their parent", async () => {
    const oldParent = await createDocument({});
    const target = await createDocument({});
    for (const parentId of [null, oldParent]) {
      const id = await linkedFile({ path: "notes/today.md", parentId });
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          moveDocumentAction.run({ id, parentId: target }),
        ),
      ).rejects.toMatchObject({ errorCode: "LOCAL_FOLDER_FILE_MOVE" });
      const [saved] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      expect(saved.parentId).toBe(parentId);
    }
  });

  it("allows position-only ordering and moves of top-level, unlinked, or mismatched source files", async () => {
    const target = await createDocument({});
    const nested = await linkedFile({ path: "notes/today.md" });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      moveDocumentAction.run({ id: nested, position: 0 }),
    );
    for (const args of [
      { path: "readme.md" },
      { path: "notes/unlinked.md", linked: false },
      { path: "notes/wrong-root.md", rootPath: "another-vault" },
      { path: "notes/wrong-kind.md", kind: "folder" },
      { path: "notes/wrong-mode.md", mode: "database" },
      { path: "notes/stale-membership.md", wrongItem: true },
      { path: "notes/../invalid.md" },
    ]) {
      const id = await linkedFile(args);
      await runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id, parentId: target }),
      );
      const [saved] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      expect(saved.parentId).toBe(target);
    }
  });
});

describe("move-document position race", () => {
  it("rejects a parent in another Content space", async () => {
    const id = await createDocument({ spaceId: "space-one" });
    const parentId = await createDocument({ spaceId: "space-two" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id, parentId } as any),
      ),
    ).rejects.toMatchObject({
      message: "Parent document must be in the same Content space",
      errorCode: "PARENT_SPACE_MISMATCH",
    });
  });

  it("refuses a page as its own parent with a typed error", async () => {
    const id = await createDocument({});
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id, parentId: id } as any),
      ),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_MOVE_UNDER_DESCENDANT",
      statusCode: 400,
    });
  });

  it("reports a nonexistent moved document as not-found naming the id argument", async () => {
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id: "missing_doc_id", position: 0 } as any),
      ),
    ).rejects.toThrow(/not found \(argument: id\)/);
  });

  it("reports a nonexistent parent as not-found naming the parentId argument", async () => {
    const id = await createDocument({ title: "Movable" });
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        moveDocumentAction.run({ id, parentId: "missing_parent_id" } as any),
      ),
    ).rejects.toThrow(/not found \(argument: parentId\)/);
  });

  it("rejects a viewer-only actor naming the required role and argument", async () => {
    const viewer = "viewer@example.com";
    const id = await createDocument({ title: "Viewer-shared page" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: id,
        principalType: "user",
        principalId: viewer,
        role: "viewer",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
    const parentId = await createDocument({ title: "Parent" });
    await expect(
      runWithRequestContext({ userEmail: viewer }, () =>
        moveDocumentAction.run({ id, parentId, position: 0 } as any),
      ),
    ).rejects.toThrow(/Requires editor role on document .*argument: id/);
  });

  it("keeps an existing but inaccessible parent forbidden instead of not-found", async () => {
    const outsider = "outsider@example.com";
    const id = await createDocument({ title: "Movable" });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: nextId("share"),
        resourceId: id,
        principalType: "user",
        principalId: outsider,
        role: "editor",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
    const privateParentId = await createDocument({
      title: "Private parent",
      ownerEmail: "someoneelse@example.com",
    });
    await expect(
      runWithRequestContext({ userEmail: outsider }, () =>
        moveDocumentAction.run({ id, parentId: privateParentId } as any),
      ),
    ).rejects.toThrow(
      `No access to document ${privateParentId} (argument: parentId)`,
    );
  });

  it("assigns distinct, gapless positions when several documents are reparented into the same parent at an explicit position concurrently", async () => {
    const parentId = await createDocument({ title: "Parent" });
    const existingChildIds = await Promise.all(
      Array.from({ length: 2 }, (_, index) =>
        createDocument({
          parentId,
          title: `Existing ${index}`,
          position: index,
        }),
      ),
    );
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
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => row.id))).toEqual(
      new Set([...existingChildIds, ...incomingIds]),
    );
    expect(new Set(rows.map((row) => row.position)).size).toBe(8);
    expect(rows.map((row) => row.position).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7,
    ]);
  });
});
