import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `preview-drafts-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let getDraft: typeof import("./get-preview-document-draft.js").default;
let updateDraft: typeof import("./update-preview-document-draft.js").default;
let resolveDraft: typeof import("./resolve-preview-document-draft.js").default;
let updateDocument: typeof import("./update-document.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDraft = (await import("./get-preview-document-draft.js")).default;
  updateDraft = (await import("./update-preview-document-draft.js")).default;
  resolveDraft = (await import("./resolve-preview-document-draft.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

let counter = 0;
const createdDocumentUpdatedAt = new Map<string, string>();
async function createDocument() {
  const id = `draft_doc_${++counter}`;
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    title: "Builder row",
    content: "Server body",
    position: 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share_${counter}`,
      resourceId: id,
      principalType: "user",
      principalId: COLLABORATOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: now,
    });
  createdDocumentUpdatedAt.set(id, now);
  return id;
}

function documentUpdatedAt(documentId: string) {
  const updatedAt = createdDocumentUpdatedAt.get(documentId);
  if (!updatedAt) throw new Error(`Missing timestamp for ${documentId}`);
  return updatedAt;
}

const payload = (content: string) => ({
  title: "Builder row",
  content,
  baseDocumentUpdatedAt: "server-v1",
  loadedContentWasEmpty: false,
  deferredReason: "hydration" as const,
});

function asUser<T>(userEmail: string, fn: () => Promise<T>, orgId?: string) {
  return runWithRequestContext({ userEmail, orgId }, fn);
}

describe("private preview document drafts", () => {
  it("allows only one request to apply a claimed recovery choice", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    let release!: () => void;
    let started!: () => void;
    const startedPromise = new Promise<void>((resolve) => (started = resolve));
    const releasePromise = new Promise<void>((resolve) => (release = resolve));
    const originalRun = updateDocument.run.bind(updateDocument);
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async (...callArgs) => {
        started();
        await releasePromise;
        return originalRun(...callArgs);
      });
    const request = {
      choice: "keep_mine" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const first = asUser(OWNER, () => resolveDraft.run(request));
    await startedPromise;
    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).rejects.toThrow("already being applied");
    release();
    await expect(first).resolves.toMatchObject({
      status: "resolved",
      choice: "keep_mine",
    });
    updateSpy.mockRestore();
  });

  it("keeps the local version against the exact displayed page and preserves history", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );

    const result = await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "keep_mine",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );

    expect(result.status).toBe("resolved");
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    const [current] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(current.content).toBe("Local recovery");
    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "keep_mine",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: before.updatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
    const versions = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(versions.map((version: any) => version.content)).toEqual(
      expect.arrayContaining(["Server body", "Local recovery"]),
    );
  });

  it("finishes an already-applied Keep mine claim after resolution marking was interrupted", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "keep_mine",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );
    const [claim] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, documentId),
          eq(
            schema.documentVersions.operation,
            "claim-preview-draft-keep_mine",
          ),
        ),
      );
    const claimPayload = JSON.parse(claim.chatContext);
    await getDb()
      .update(schema.documentVersions)
      .set({
        chatContext: JSON.stringify({
          ...claimPayload,
          status: "processing",
          processingToken: "interrupted-request",
          processingStartedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
      .where(eq(schema.documentVersions.id, claim.id));

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "keep_mine",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: before.updatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
  });

  it("preserves a matching leading H1 when Keep mine resolves a draft", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const content = "# Builder row\n\nLocal recovery";
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload(content), deferredReason: "conflict" },
      }),
    );

    await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "keep_mine",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: content,
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );
    const [current] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(current.content).toBe(content);
  });

  it("keeps a newer page and the exact draft when Keep mine sees an unseen revision", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await getDb()
      .update(schema.documents)
      .set({
        content: "Unseen body",
        updatedAt: new Date(Date.now() + 1_000).toISOString(),
      })
      .where(eq(schema.documents.id, documentId));

    const result = await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "keep_mine",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );
    expect(result.status).toBe("document_conflict");
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft?.content,
    ).toBe("Local recovery");
  });

  it("preserves a claimed draft in Version History when a newer draft wins restoration", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Claimed recovery"), deferredReason: "conflict" },
      }),
    );
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async () => {
        await updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: { ...payload("Newer recovery"), deferredReason: "conflict" },
        });
        return { conflict: true, document: {} } as any;
      });

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "keep_mine",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Claimed recovery",
          expectedDocumentUpdatedAt: before.updatedAt,
        }),
      ),
    ).rejects.toThrow("preserved in Version History");
    updateSpy.mockRestore();

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft?.content,
    ).toBe("Newer recovery");
    const versions = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: "Claimed recovery",
          operation: "claim-preview-draft-keep_mine",
          checkpointKind: "recovery",
        }),
      ]),
    );
  });

  it("archives local edits in Version History before using the saved page", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "use_saved",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "use_saved",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toEqual({ status: "resolved", choice: "use_saved" });

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    expect(
      (
        await getDb()
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId))
      )[0].content,
    ).toBe("Server body");
    const recovery = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(recovery).toEqual([
      expect.objectContaining({
        content: "Local recovery",
        checkpointKind: "recovery",
        operation: "use-saved-preview-draft",
      }),
    ]);
  });

  it("keeps the exact draft when Use saved was reviewed against an older page", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await getDb()
      .update(schema.documents)
      .set({
        content: "Unseen saved body",
        updatedAt: new Date(Date.now() + 1_000).toISOString(),
      })
      .where(eq(schema.documents.id, documentId));

    const result = await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "use_saved",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );

    expect(result.status).toBe("document_conflict");
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft?.content,
    ).toBe("Local recovery");
  });

  it("saves the exact local draft as one separate page without changing the original", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );

    const result = await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "save_separately",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );

    expect(result).toMatchObject({
      status: "resolved",
      choice: "save_separately",
      createdDocumentId: expect.stringMatching(/^recovery-/),
    });
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    const [original] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const [copy] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId!));
    expect(original.content).toBe("Server body");
    expect(copy).toMatchObject({
      title: "Builder row",
      content: "Local recovery",
      ownerEmail: OWNER,
    });

    const retry = await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "save_separately",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    expect(retry).toMatchObject({
      status: "resolved",
      createdDocumentId: result.createdDocumentId,
      urlPath: result.urlPath,
    });

    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "save_separately",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  it("preserves a matching leading H1 in a separate recovery page", async () => {
    const documentId = await createDocument();
    const content = "# Builder row\n\nLocal recovery";
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload(content), deferredReason: "conflict" },
      }),
    );

    const result = await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "save_separately",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: content,
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    const [copy] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId!));

    expect(copy.content).toBe(content);
  });

  it("saves a directly shared page into the collaborator's personal space", async () => {
    const documentId = await createDocument();
    await asUser(COLLABORATOR, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Collaborator recovery"),
          deferredReason: "conflict",
        },
      }),
    );

    const result = await asUser(COLLABORATOR, () =>
      resolveDraft.run({
        choice: "save_separately",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Collaborator recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    const [copy] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, result.createdDocumentId!));

    expect(copy).toMatchObject({
      ownerEmail: COLLABORATOR,
      parentId: null,
      content: "Collaborator recovery",
    });
    const sharedHistory = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    expect(sharedHistory).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: "Collaborator recovery" }),
      ]),
    );
  });

  it("rejects a different terminal recovery choice for an already claimed draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("Terminal recovery"),
      }),
    );
    await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "use_saved",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Terminal recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "save_separately",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Terminal recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).rejects.toThrow("already resolved with another choice");
  });

  it("runs the additive migration and projects only the caller's draft fields", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("owner draft"),
      }),
    );
    const result = await asUser(OWNER, () => getDraft.run({ documentId }));
    expect(result.draft).toMatchObject({
      documentId,
      content: "owner draft",
      version: 1,
    });
    expect(result.draft).not.toHaveProperty("ownerEmail");
    expect(result.draft).not.toHaveProperty("id");
  });

  it("keeps collaborator drafts private per request user", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("owner draft"),
      }),
    );
    await asUser(COLLABORATOR, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("collaborator draft"),
      }),
    );
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft?.content,
    ).toBe("owner draft");
    expect(
      (await asUser(COLLABORATOR, () => getDraft.run({ documentId }))).draft
        ?.content,
    ).toBe("collaborator draft");
  });

  it("keeps drafts isolated when a document moves between organizations", async () => {
    const documentId = await createDocument();
    await getDb()
      .update(schema.documents)
      .set({ orgId: "org-a" })
      .where(eq(schema.documents.id, documentId));
    await asUser(
      OWNER,
      () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: payload("org A draft"),
        }),
      "org-a",
    );
    await getDb()
      .update(schema.documents)
      .set({ orgId: "org-b" })
      .where(eq(schema.documents.id, documentId));

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }), "org-b")).draft,
    ).toBeNull();
    await asUser(
      OWNER,
      () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: payload("org B draft"),
        }),
      "org-b",
    );
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }), "org-b")).draft
        ?.content,
    ).toBe("org B draft");
  });

  it("fails closed after editor access is revoked", async () => {
    const documentId = await createDocument();
    await getDb()
      .delete(schema.documentShares)
      .where(
        and(
          eq(schema.documentShares.resourceId, documentId),
          eq(schema.documentShares.principalId, COLLABORATOR),
        ),
      );
    await expect(
      asUser(COLLABORATOR, () => getDraft.run({ documentId })),
    ).rejects.toThrow();
  });

  it("returns the current draft when two tabs race to create or update", async () => {
    const documentId = await createDocument();
    const first = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("tab A"),
      }),
    );
    const createRace = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("tab B"),
      }),
    );
    expect(first.status).toBe("saved");
    expect(createRace).toMatchObject({
      status: "conflict",
      draft: { content: "tab A", version: 1 },
    });

    const updated = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("tab A v2"),
      }),
    );
    expect(updated).toMatchObject({ status: "saved", draft: { version: 2 } });
    const stale = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("stale tab B"),
      }),
    );
    expect(stale).toMatchObject({
      status: "conflict",
      draft: { content: "tab A v2", version: 2 },
    });
  });

  it("does not let a stale delete erase a newer draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("v1"),
      }),
    );
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("v2"),
      }),
    );
    const staleDelete = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 1,
        expectedTitle: "Builder row",
        expectedContent: "v1",
      }),
    );
    expect(staleDelete).toMatchObject({
      status: "conflict",
      draft: { content: "v2", version: 2 },
    });
    const deleted = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "v2",
      }),
    );
    expect(deleted).toEqual({ status: "deleted", draft: null });
  });

  it("keeps C2 recoverable when older C1 persistence finishes after the C2 draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("C1"),
      }),
    );
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: payload("C2"),
      }),
    );

    const c1CompletionCleanup = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "C1",
      }),
    );

    expect(c1CompletionCleanup).toMatchObject({
      status: "conflict",
      draft: { content: "C2", version: 2 },
    });
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "C2", version: 2 });

    const c2CompletionCleanup = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "C2",
      }),
    );
    expect(c2CompletionCleanup).toEqual({ status: "deleted", draft: null });
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });
});
