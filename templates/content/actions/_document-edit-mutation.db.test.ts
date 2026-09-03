import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `document-edit-mutation-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "document-editor@example.com";
const DOCUMENT_ID = "document-edit-contract";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let mutateDocumentBody: typeof import("./_document-edit-mutation.js").mutateDocumentBody;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  ({ mutateDocumentBody, documentRevisionToken } =
    await import("./_document-edit-mutation.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.documentEditReceipts);
  await db.delete(schema.documentVersions);
  await db.delete(schema.documents);
  await db.insert(schema.documents).values({
    id: DOCUMENT_ID,
    ownerEmail: OWNER,
    title: "Integrity test",
    content: "alpha beta",
    bodyRevision: 0,
  });
});

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

const ctx = { caller: "mcp" as const, userEmail: OWNER };

describe("revisioned document edit mutation", () => {
  it("commits one revision/version/receipt and replays a double delivery", async () => {
    const input = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "delivery-1",
      edits: [{ find: "alpha", replace: "omega" }],
      ctx,
    };
    const first = await mutateDocumentBody(input);
    const replay = await mutateDocumentBody(input);

    expect(first.receipt).toMatchObject({
      outcome: "applied",
      bodyRevision: { before: 0, after: 1 },
      readback: { verified: true },
      idempotency: { result: "applied" },
    });
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(replay.receipt.idempotency.result).toBe("replayed");

    const db = getDb();
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document).toMatchObject({ content: "omega beta", bodyRevision: 1 });
    expect(await db.select().from(schema.documentVersions)).toHaveLength(1);
    expect(await db.select().from(schema.documentEditReceipts)).toHaveLength(1);
  });

  it("collapses concurrent double delivery to one committed receipt", async () => {
    const input = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "concurrent-delivery",
      edits: [{ find: "alpha", replace: "omega" }],
      ctx,
    };
    const [left, right] = await Promise.all([
      mutateDocumentBody(input),
      mutateDocumentBody(input),
    ]);
    expect(left.receipt.receiptId).toBe(right.receipt.receiptId);
    expect(
      new Set([
        left.receipt.idempotency.result,
        right.receipt.idempotency.result,
      ]),
    ).toEqual(new Set(["applied", "replayed"]));
    expect(await getDb().select().from(schema.documentVersions)).toHaveLength(
      1,
    );
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(1);
  });

  it("replays across transient network and run identifiers in the same trusted scope", async () => {
    const base = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "stable-caller-scope",
      edits: [{ find: "alpha", replace: "omega" }],
    };
    const first = await mutateDocumentBody({
      ...base,
      ctx: {
        ...ctx,
        networkProtocol: "mcp",
        networkId: "request-one",
        networkPeer: "peer-one",
        runId: "run-one",
      },
    });
    const replay = await mutateDocumentBody({
      ...base,
      ctx: {
        ...ctx,
        networkProtocol: "mcp",
        networkId: "request-two",
        networkPeer: "peer-two",
        runId: "run-two",
      },
    });
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(replay.receipt.idempotency.result).toBe("replayed");
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(1);
  });

  it("keeps idempotency receipts distinct for users in the same organization", async () => {
    const base = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "shared-org-key",
      edits: [{ find: "alpha", replace: "omega" }],
    };
    const first = await mutateDocumentBody({
      ...base,
      ctx: { caller: "mcp", userEmail: OWNER, orgId: "org-1" },
    });
    await expect(
      mutateDocumentBody({
        ...base,
        ctx: {
          caller: "mcp",
          userEmail: "another-editor@example.com",
          orgId: "org-1",
        },
      }),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });
    expect(first.receipt.idempotency.result).toBe("applied");
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(1);
  });

  it("does not overwrite a content-only legacy write racing after the base read", async () => {
    const { getDbExec } = await import("@agent-native/core/db");
    await getDbExec().execute(`CREATE TRIGGER document_edit_legacy_race
      AFTER INSERT ON document_versions
      BEGIN
        UPDATE documents
        SET content = 'legacy writer won'
        WHERE id = '${DOCUMENT_ID}';
      END`);
    try {
      await expect(
        mutateDocumentBody({
          documentId: DOCUMENT_ID,
          baseRevision: documentRevisionToken(0, "alpha beta"),
          idempotencyKey: "legacy-race",
          edits: [{ find: "alpha", replace: "omega" }],
          ctx,
        }),
      ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });
      expect(
        await getDb().select().from(schema.documentEditReceipts),
      ).toHaveLength(0);
      expect(await getDb().select().from(schema.documentVersions)).toHaveLength(
        0,
      );
    } finally {
      await getDbExec().execute("DROP TRIGGER document_edit_legacy_race");
    }
  });

  it("rejects a changed payload for the same key and a stale base without writing", async () => {
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "delivery-2",
      edits: [{ find: "alpha", replace: "omega" }],
      ctx,
    });
    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, "alpha beta"),
        idempotencyKey: "delivery-2",
        edits: [{ find: "alpha", replace: "changed" }],
        ctx,
      }),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, "alpha beta"),
        idempotencyKey: "delivery-3",
        edits: [{ find: "beta", replace: "gamma" }],
        ctx,
      }),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect(await getDb().select().from(schema.documentVersions)).toHaveLength(
      1,
    );
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(1);
  });

  it("uses stable base matching for a batch without replacement cascade", async () => {
    const result = await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "delivery-4",
      edits: [
        { find: "alpha", replace: "beta" },
        { find: "beta", replace: "gamma" },
      ],
      ctx,
    });
    expect(result.receipt.ranges).toEqual([
      { editIndex: 0, start: 0, end: 5 },
      { editIndex: 1, start: 6, end: 10 },
    ]);
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("beta gamma");
  });

  it("rejects legacy content drift even when its numeric body revision was not advanced", async () => {
    await getDb()
      .update(schema.documents)
      .set({ content: "legacy writer changed beta" })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, "alpha beta"),
        idempotencyKey: "legacy-drift",
        edits: [{ find: "beta", replace: "gamma" }],
        ctx,
      }),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(0);
  });
});
