import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `update-document-cas-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let updateDocumentAction: typeof import("./update-document.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  updateDocumentAction = (await import("./update-document.js")).default;
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
  title?: string;
  content?: string;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const id = args.id ?? nextId("doc");
  await db.insert(schema.documents).values({
    id,
    ownerEmail: args.ownerEmail ?? OWNER,
    parentId: null,
    title: args.title ?? "Untitled",
    content: args.content ?? "",
    position: 0,
    visibility: "private",
    orgId: null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function documentRow(documentId: string) {
  const db = getDb();
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return document;
}

describe("update-document compare-and-swap", () => {
  it("applies a content save with no baseUpdatedAt exactly like today (no CAS)", async () => {
    const documentId = await createDocument({ content: "original" });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({ id: documentId, content: "rewritten" }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    expect((result as any).content).toBe("rewritten");
    expect((await documentRow(documentId)).content).toBe("rewritten");
  });

  it("applies a content save when baseUpdatedAt matches the current row", async () => {
    const documentId = await createDocument({ content: "original" });
    const before = await documentRow(documentId);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        content: "updated by matching snapshot",
        baseUpdatedAt: before.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    expect((result as any).content).toBe("updated by matching snapshot");
    expect((await documentRow(documentId)).content).toBe(
      "updated by matching snapshot",
    );
  });

  it("rejects a content save when the row moved past baseUpdatedAt and returns the current server document", async () => {
    const documentId = await createDocument({ content: "original" });
    const staleSnapshot = await documentRow(documentId);

    // Simulate a concurrent write (e.g. the Notion auto-pull) landing after
    // the editor's snapshot but before this save's CAS check runs.
    const db = getDb();
    const remoteUpdatedAt = new Date(
      new Date(staleSnapshot.updatedAt).getTime() + 1000,
    ).toISOString();
    await db
      .update(schema.documents)
      .set({ content: "pulled from notion", updatedAt: remoteUpdatedAt })
      .where(eq(schema.documents.id, documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "New title from the stale editor",
        content: "editor's stale rewrite",
        baseUpdatedAt: staleSnapshot.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).toBe(true);
    if (!("conflict" in result && result.conflict))
      throw new Error("unreachable");
    expect(result.id).toBe(documentId);
    expect(result.document.content).toBe("pulled from notion");
    expect(result.document.updatedAt).toBe(remoteUpdatedAt);

    // The rejected save must not have applied ANY of its fields — including
    // title — since a partial apply would desync fields from what the caller
    // believes it sent.
    const current = await documentRow(documentId);
    expect(current.content).toBe("pulled from notion");
    expect(current.title).toBe("Untitled");
    expect(current.updatedAt).toBe(remoteUpdatedAt);
  });

  it("does not CAS-guard title/icon-only saves even when baseUpdatedAt is stale", async () => {
    const documentId = await createDocument({ content: "original" });
    const staleSnapshot = await documentRow(documentId);

    const db = getDb();
    const remoteUpdatedAt = new Date(
      new Date(staleSnapshot.updatedAt).getTime() + 1000,
    ).toISOString();
    await db
      .update(schema.documents)
      .set({ content: "pulled from notion", updatedAt: remoteUpdatedAt })
      .where(eq(schema.documents.id, documentId));

    // No `content` in this call, so baseUpdatedAt (even though stale) must
    // not trigger the CAS path — title/metadata-only saves keep today's
    // last-write-wins behavior.
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      updateDocumentAction.run({
        id: documentId,
        title: "Renamed",
        baseUpdatedAt: staleSnapshot.updatedAt,
      }),
    );

    expect("conflict" in result && result.conflict).not.toBe(true);
    const current = await documentRow(documentId);
    expect(current.title).toBe("Renamed");
    expect(current.content).toBe("pulled from notion");
  });
});
