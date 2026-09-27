import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `document-edit-mutation-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "document-editor@example.com";
const DOCUMENT_ID = "document-edit-contract";

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let mutateDocumentBody: typeof import("./_document-edit-mutation.js").mutateDocumentBody;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  ({ getDb, schema } = await import("../server/db/index.js"));
  ({ mutateDocumentBody, documentRevisionToken } =
    await import("./_document-edit-mutation.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

beforeEach(async () => {
  const db = getDb();
  await db.delete(schema.documentBodyIntents);
  await db.delete(schema.documentEditReceipts);
  await db.delete(schema.documentVersions);
  await db.delete(schema.documentShares);
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
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

const ctx = { caller: "mcp" as const, userEmail: OWNER };

describe("revisioned document edit mutation", () => {
  it("records the first revision-tagged base after a legacy History checkpoint", async () => {
    const db = getDb();
    await db.insert(schema.documentVersions).values({
      id: "legacy-checkpoint",
      ownerEmail: OWNER,
      documentId: DOCUMENT_ID,
      title: "Integrity test",
      content: "alpha beta",
      bodyRevision: null,
      checkpointKind: "after",
    });
    const baseRevision = documentRevisionToken(0, "alpha beta");
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision,
      idempotencyKey: "first-after-legacy",
      edits: [{ find: "alpha", replace: "gamma" }],
      ctx,
    });
    const stale = await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision,
      idempotencyKey: "stale-after-legacy",
      edits: [{ find: "beta", replace: "delta" }],
      ctx,
    });
    expect(stale.receipt.outcome).toBe("applied");
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("gamma delta");
    const history = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, DOCUMENT_ID));
    expect(
      history.some(
        (version) =>
          version.bodyRevision === 0 && version.content === "alpha beta",
      ),
    ).toBe(true);
  });

  it("preserves a middle-key stale edit when two intervening writers touched one passage", async () => {
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: "alpha charlie" })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha charlie"),
      idempotencyKey: "z",
      edits: [{ find: "alpha", replace: "zulu" }],
      ctx,
    });
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(1, "zulu charlie"),
      idempotencyKey: "a",
      edits: [{ find: "charlie", replace: "apple" }],
      ctx,
    });
    const middle = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha charlie"),
      idempotencyKey: "m",
      edits: [{ find: "alpha", replace: "middle" }],
      ctx,
    };
    const first = await mutateDocumentBody(middle);
    const retry = await mutateDocumentBody(middle);
    expect(first.receipt.outcome).toBe("preservation-required");
    expect(retry.receipt.idempotency.result).toBe("replayed");
    expect(retry.preservationRequired?.checkpointId).toBe(
      first.preservationRequired?.checkpointId,
    );
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("zulu apple");
    const history = await db
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, DOCUMENT_ID));
    expect(
      history.filter((version) => version.content === "middle charlie"),
    ).toHaveLength(1);
  });

  it("initializes an exactly empty body without normalizing Markdown bytes", async () => {
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: "" })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    const content = "# Integrity test\n\nCafé 🌱\n";
    const input = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, ""),
      idempotencyKey: "initialize-empty-body",
      initializeContent: content,
      ctx,
    };

    const first = await mutateDocumentBody(input);
    const replay = await mutateDocumentBody(input);
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));

    expect(document).toMatchObject({ content, bodyRevision: 1 });
    expect(first.receipt).toMatchObject({
      outcome: "applied",
      bodyRevision: { before: 0, after: 1 },
      ranges: [{ editIndex: 0, start: 0, end: 0 }],
      readback: { verified: true },
    });
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(replay.receipt.idempotency.result).toBe("replayed");
    expect(await db.select().from(schema.documentVersions)).toHaveLength(2);
    expect(await db.select().from(schema.documentEditReceipts)).toHaveLength(1);
  });

  it("never treats whitespace or later content as an empty initialization target", async () => {
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: " " })
      .where(eq(schema.documents.id, DOCUMENT_ID));

    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, " "),
        idempotencyKey: "initialize-whitespace",
        initializeContent: "new body",
        ctx,
      }),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_BODY_NOT_EMPTY" });
    expect(await db.select().from(schema.documentEditReceipts)).toHaveLength(0);
  });

  it("rejects whitespace-only initialization content without consuming the empty body", async () => {
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: "" })
      .where(eq(schema.documents.id, DOCUMENT_ID));

    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, ""),
        idempotencyKey: "initialize-whitespace-content",
        initializeContent: " \n\t",
        ctx,
      }),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_INITIALIZATION_CONTENT_REQUIRED",
    });
    expect(await db.select().from(schema.documentEditReceipts)).toHaveLength(0);
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document).toMatchObject({ content: "", bodyRevision: 0 });
  });

  it("allows only one of two differently keyed concurrent initializers", async () => {
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: "" })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    const attempts = await Promise.allSettled(
      ["left", "right"].map((side) =>
        mutateDocumentBody({
          documentId: DOCUMENT_ID,
          baseRevision: documentRevisionToken(0, ""),
          idempotencyKey: `concurrent-initialize-${side}`,
          initializeContent: `${side} body`,
          ctx,
        }),
      ),
    );

    expect(
      attempts.filter(({ status }) => status === "fulfilled"),
    ).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(
      1,
    );
    expect(await db.select().from(schema.documentEditReceipts)).toHaveLength(1);
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(["left body", "right body"]).toContain(document.content);
  });

  it("replays initialization after a later edit and rejects changed retry content", async () => {
    const db = getDb();
    await db
      .update(schema.documents)
      .set({ content: "" })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    const initialization = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, ""),
      idempotencyKey: "initialize-then-edit",
      initializeContent: "first body",
      ctx,
    };
    const first = await mutateDocumentBody(initialization);
    await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: first.receipt.revisions.after,
      idempotencyKey: "later-edit",
      edits: [{ find: "first", replace: "later" }],
      ctx,
    });

    const replay = await mutateDocumentBody(initialization);
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(replay.receipt.idempotency.result).toBe("replayed");
    await expect(
      mutateDocumentBody({
        ...initialization,
        initializeContent: "different body",
      }),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
    const [document] = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("later body");
  });

  it("rechecks editor access inside the write transaction", async () => {
    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, "alpha beta"),
        idempotencyKey: "revoked-editor",
        edits: [{ find: "alpha", replace: "omega" }],
        ctx: { caller: "mcp", userEmail: "revoked@example.com" },
      }),
    ).rejects.toThrow(/access|editor/i);
    expect(await getDb().select().from(schema.documentEditReceipts)).toEqual(
      [],
    );
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document).toMatchObject({ content: "alpha beta", bodyRevision: 0 });
  });

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
    expect(document).toMatchObject({
      content: "omega beta",
      bodyRevision: 1,
      createdBy: null,
      updatedBy: OWNER,
    });
    expect(await db.select().from(schema.documentVersions)).toHaveLength(2);
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
      2,
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
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(first.receipt.idempotency.result).toBe("applied");
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(1);
  });

  it("does not overwrite a content-only legacy write racing after the base read", async () => {
    const { getDbExec } = await import("@agent-native/core/db");
    await getDbExec().execute(`
      CREATE FUNCTION document_edit_legacy_race_fn() RETURNS trigger
      LANGUAGE plpgsql AS $legacy$
      BEGIN
        UPDATE documents
        SET content = 'legacy writer won'
        WHERE id = '${DOCUMENT_ID}';
        RETURN NEW;
      END;
      $legacy$
    `);
    await getDbExec().execute(`
      CREATE TRIGGER document_edit_legacy_race
      AFTER INSERT ON document_versions
      FOR EACH ROW EXECUTE FUNCTION document_edit_legacy_race_fn()
    `);
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
      await getDbExec().execute(
        `DROP TRIGGER document_edit_legacy_race ON document_versions`,
      );
      await getDbExec().execute(`DROP FUNCTION document_edit_legacy_race_fn()`);
    }
  });

  it("rejects a changed retry payload and rebases an independent exact-base edit", async () => {
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
    const rebased = await mutateDocumentBody({
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "delivery-3",
      edits: [{ find: "beta", replace: "gamma" }],
      ctx,
    });
    expect(rebased.receipt).toMatchObject({ outcome: "applied" });
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, DOCUMENT_ID));
    expect(document.content).toBe("omega gamma");

    expect(await getDb().select().from(schema.documentVersions)).toHaveLength(
      3,
    );
    expect(
      await getDb().select().from(schema.documentEditReceipts),
    ).toHaveLength(2);
  });

  it("binds creative-context provenance to the idempotency payload", async () => {
    const input = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "context-bound-delivery",
      edits: [{ find: "alpha", replace: "omega" }],
      ctx,
    };
    await mutateDocumentBody(input);

    await expect(
      mutateDocumentBody({
        ...input,
        creativeContext: {
          contextMode: "off",
          contextPackId: null,
          reuseLabels: [],
          elementProvenance: [],
        },
      }),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("replays a receipt before revalidating mutable creative context", async () => {
    let resolutionCount = 0;
    const input = {
      documentId: DOCUMENT_ID,
      baseRevision: documentRevisionToken(0, "alpha beta"),
      idempotencyKey: "stable-context-replay",
      edits: [{ find: "alpha", replace: "omega" }],
      creativeContextDigest: {
        contextPackId: "pack-from-request",
        contextModeOverride: null,
        reuseLabels: [],
      },
      ctx,
    };
    const first = await mutateDocumentBody({
      ...input,
      resolveCreativeContext: async () => {
        resolutionCount += 1;
        const [document] = await getDb()
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, DOCUMENT_ID));
        expect(document.content).toBe("alpha beta");
        return undefined;
      },
    });
    const replay = await mutateDocumentBody({
      ...input,
      resolveCreativeContext: async () => {
        throw new Error("mutable context should not be revalidated");
      },
    });

    expect(resolutionCount).toBe(1);
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(replay.receipt.idempotency.result).toBe("replayed");
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

  it("rejects a stale base before resolving mutable creative context", async () => {
    await getDb()
      .update(schema.documents)
      .set({ content: "changed outside the edit protocol" })
      .where(eq(schema.documents.id, DOCUMENT_ID));
    let resolutionCount = 0;
    await expect(
      mutateDocumentBody({
        documentId: DOCUMENT_ID,
        baseRevision: documentRevisionToken(0, "alpha beta"),
        idempotencyKey: "stale-before-context",
        edits: [{ find: "alpha", replace: "omega" }],
        resolveCreativeContext: async () => {
          resolutionCount += 1;
          throw new Error("mutable context should not be resolved");
        },
        ctx,
      }),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });
    expect(resolutionCount).toBe(0);
  });
});
