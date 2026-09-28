import { createHash } from "node:crypto";
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

async function documentRowForDraftTest(documentId: string) {
  const [document] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return document;
}

async function authoredSaveBase(documentId: string, candidate: string) {
  const current = await documentRowForDraftTest(documentId);
  const revision = `body:${current.bodyRevision}:sha256:${createHash("sha256")
    .update(current.content)
    .digest("hex")}`;
  return {
    baseRevision: revision,
    authoredBaseRevision: revision,
    authoredBaseContent: current.content,
    authoredCandidateContent: candidate,
  };
}

async function legacyClaimId(args: {
  documentId: string;
  expectedDraftVersion: number;
  expectedDraftTitle: string;
  expectedDraftContent: string;
}) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        OWNER,
        "",
        args.documentId,
        args.expectedDraftVersion,
        args.expectedDraftTitle,
        args.expectedDraftContent,
      ]),
    ),
  );
  const suffix = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 32);
  return `draft-claim-${suffix}`;
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
  it("applies Keep mine with a recorded authored body intent", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "keep_mine",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      content: "Local recovery",
      bodyRevision: 1,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, documentId)),
    ).toEqual([
      expect.objectContaining({
        authoredBaseRevision: 0,
        committedRevision: 1,
        canonicalChanged: true,
      }),
    ]);
  });

  it("retains Keep mine when an update requires preservation", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    const updateSpy = vi.spyOn(updateDocument, "run").mockResolvedValueOnce({
      preservationRequired: true,
      id: documentId,
      document: { ...(await documentRowForDraftTest(documentId)) },
      reason: "provenance",
      checkpointId: "preserved-draft",
    } as any);

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "keep_mine",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toMatchObject({ status: "document_conflict" });
    updateSpy.mockRestore();
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "Local recovery" });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      content: "Server body",
    });
  });

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

  it("recovers an abandoned processing claim after its lease expires", async () => {
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
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockRejectedValueOnce(new Error("worker stopped"));
    const request = {
      choice: "keep_mine" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).rejects.toThrow("worker stopped");
    updateSpy.mockRestore();
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
    await getDb()
      .update(schema.documentVersions)
      .set({
        chatContext: JSON.stringify({
          ...JSON.parse(claim.chatContext),
          processingStartedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
      .where(eq(schema.documentVersions.id, claim.id));
    await getDb()
      .delete(schema.documentPreviewDrafts)
      .where(eq(schema.documentPreviewDrafts.documentId, documentId));

    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
  });

  it("fences an expired worker when a retry completes the side effect first", async () => {
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
    const expiredWorker = asUser(OWNER, () => resolveDraft.run(request));
    await startedPromise;
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
    await getDb()
      .update(schema.documentVersions)
      .set({
        chatContext: JSON.stringify({
          ...JSON.parse(claim.chatContext),
          processingStartedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
      .where(eq(schema.documentVersions.id, claim.id));

    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
    release();
    await expect(expiredWorker).resolves.toMatchObject({
      status: "resolved",
      choice: "keep_mine",
    });
    updateSpy.mockRestore();
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    const [current] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(current.content).toBe("Local recovery");
  });

  it("resumes a claim stored under the legacy recovery id", async () => {
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
    const request = {
      choice: "keep_mine" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockRejectedValueOnce(new Error("worker stopped"));
    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).rejects.toThrow("worker stopped");
    updateSpy.mockRestore();
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
    const legacyId = await legacyClaimId(request);
    await getDb()
      .update(schema.documentVersions)
      .set({ id: legacyId })
      .where(eq(schema.documentVersions.id, claim.id));
    await getDb()
      .delete(schema.documentPreviewDrafts)
      .where(eq(schema.documentPreviewDrafts.documentId, documentId));
    const legacyPayload = JSON.parse(claim.chatContext);
    delete legacyPayload.expectedDocumentUpdatedAt;
    await getDb()
      .update(schema.documentVersions)
      .set({
        chatContext: JSON.stringify({
          ...legacyPayload,
          status: "processing",
          processingStartedAt: "2026-01-01T00:00:00.000Z",
        }),
      })
      .where(eq(schema.documentVersions.id, legacyId));

    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
  });

  it("does not reuse a legacy claim for a later identical draft", async () => {
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
    const [currentDraft] = await getDb()
      .select()
      .from(schema.documentPreviewDrafts)
      .where(eq(schema.documentPreviewDrafts.documentId, documentId));
    const request = {
      choice: "keep_mine" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const legacyId = await legacyClaimId(request);
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentVersions)
      .values({
        id: legacyId,
        ownerEmail: OWNER,
        documentId,
        title: request.expectedDraftTitle,
        content: request.expectedDraftContent,
        chatContext: JSON.stringify({
          choice: "keep_mine",
          status: "resolved",
          draftId: "an-older-identical-draft",
          baseDocumentUpdatedAt: null,
          loadedContentWasEmpty: 0,
          deferredReason: "conflict",
          createdAt: now,
          updatedAt: now,
        }),
        actorEmail: OWNER,
        actorKind: "human",
        origin: "frontend",
        groupKind: "operation",
        groupId: "draft-recovery:old",
        operation: "claim-preview-draft-keep_mine",
        checkpointKind: "recovery",
        createdAt: now,
        updatedAt: now,
      });

    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockRejectedValueOnce(new Error("worker stopped"));
    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).rejects.toThrow("worker stopped");
    updateSpy.mockRestore();
    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
    const claims = await getDb()
      .select({ id: schema.documentVersions.id })
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
    expect(currentDraft.id).not.toBe("an-older-identical-draft");
    expect(claims.map(({ id }) => id)).toContain(legacyId);
    expect(claims).toHaveLength(2);
  });

  it("does not let an older processor resolve a replacement processing token", async () => {
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
    const originalRun = updateDocument.run.bind(updateDocument);
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async (...callArgs) => {
        const result = await originalRun(...callArgs);
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
        await getDb()
          .update(schema.documentVersions)
          .set({
            chatContext: JSON.stringify({
              ...JSON.parse(claim.chatContext),
              processingToken: "replacement-token",
            }),
          })
          .where(eq(schema.documentVersions.id, claim.id));
        return result;
      });

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
    ).rejects.toThrow("already being applied");
    updateSpy.mockRestore();
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
    expect(JSON.parse(claim.chatContext)).toMatchObject({
      status: "processing",
      processingToken: "replacement-token",
    });
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

  it("keeps an edit that lands between the Keep mine claim and save", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    const originalRun = updateDocument.run.bind(updateDocument);
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async (args, ctx) => {
        await originalRun({ id: documentId, content: "Intervening edit" });
        return originalRun(args, ctx);
      });
    try {
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
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Intervening edit",
      );
      expect(
        (await asUser(OWNER, () => getDraft.run({ documentId }))).draft
          ?.content,
      ).toBe("Local recovery");
    } finally {
      updateSpy.mockRestore();
    }
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

  it("rejects a delayed browser save after Use saved settles its generation", async () => {
    const documentId = await createDocument();
    const editorSessionId = "use-saved-tab";
    const editGeneration = 6;
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Discarded local body"),
          deferredReason: "conflict",
          editorSessionId,
          editGeneration,
        },
      }),
    );

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "use_saved",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Discarded local body",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toEqual({ status: "resolved", choice: "use_saved" });

    const beforeDelayedSave = await documentRowForDraftTest(documentId);
    const historyBeforeDelayedSave = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));

    const delayed = await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Discarded local body",
          editorSessionId,
          editorEditGeneration: editGeneration,
          editorSnapshotTitle: "Builder row",
          editorSnapshotContent: "Discarded local body",
          browserSaveAttemptId: "delayed-use-saved-attempt",
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    expect(delayed).toMatchObject({
      superseded: true,
      document: { content: "Server body" },
      editorSessionId,
      editGeneration,
      discardedGeneration: editGeneration,
    });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      content: "Server body",
      bodyRevision: 0,
      updatedAt: beforeDelayedSave.updatedAt,
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, documentId)),
    ).toHaveLength(historyBeforeDelayedSave.length);
    expect(
      await getDb()
        .select()
        .from(schema.documentBodyIntents)
        .where(eq(schema.documentBodyIntents.documentId, documentId)),
    ).toHaveLength(0);
    expect(
      await getDb()
        .select()
        .from(schema.documentBrowserSaveAttempts)
        .where(eq(schema.documentBrowserSaveAttempts.documentId, documentId)),
    ).toHaveLength(0);
  });

  it("accepts a newer browser generation after Use saved", async () => {
    const documentId = await createDocument();
    const editorSessionId = "continued-use-saved-tab";
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Discarded generation six"),
          deferredReason: "conflict",
          editorSessionId,
          editGeneration: 6,
        },
      }),
    );
    await asUser(OWNER, () =>
      resolveDraft.run({
        choice: "use_saved",
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Discarded generation six",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );

    const saveBase = await authoredSaveBase(
      documentId,
      "Authored generation seven",
    );
    const saved = await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Authored generation seven",
          ...saveBase,
          editorSessionId,
          editorEditGeneration: 7,
          editorSnapshotTitle: "Builder row",
          editorSnapshotContent: "Authored generation seven",
          browserSaveAttemptId: "generation-after-use-saved",
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    expect(saved).toMatchObject({
      content: "Authored generation seven",
      browserSaveAttempt: { result: "applied" },
    });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      content: "Authored generation seven",
      bodyRevision: 1,
    });
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
    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "save_separately",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).rejects.toThrow("saved draft changed");
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft?.content,
    ).toBe("Local recovery");
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

  it("does not let a delayed retained draft resurrect after its edit generation saved", async () => {
    const documentId = await createDocument();
    const editorSessionId = "tab-one";
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Unsaved generation one"),
          editorSessionId,
          editGeneration: 1,
        },
      }),
    );

    const saveBase = await authoredSaveBase(documentId, "Saved generation two");
    await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Saved generation two",
          ...saveBase,
          browserSaveAttemptId: "saved-generation-two",
          historySessionId: "history-one",
          editorSessionId,
          editorEditGeneration: 2,
          editorSnapshotTitle: "Builder row",
          editorSnapshotContent: "Saved generation two",
          loadedContentWasEmpty: false,
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    await expect(
      asUser(OWNER, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: {
            ...payload("Delayed generation one"),
            editorSessionId,
            editGeneration: 1,
          },
        }),
      ),
    ).resolves.toEqual({ status: "superseded", draft: null });
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  it("fences a delayed same-generation draft after keep-mine recovery", async () => {
    const documentId = await createDocument();
    const editorSessionId = "keep-mine-tab";
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Recovered local body"),
          deferredReason: "conflict",
          editorSessionId,
          editGeneration: 4,
        },
      }),
    );

    await expect(
      asUser(OWNER, () =>
        resolveDraft.run({
          choice: "keep_mine",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Recovered local body",
          expectedDocumentUpdatedAt: before.updatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });

    await expect(
      asUser(OWNER, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: {
            ...payload("Delayed recovery"),
            editorSessionId,
            editGeneration: 4,
          },
        }),
      ),
    ).resolves.toEqual({ status: "superseded", draft: null });
    const [saved] = await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(saved.content).toBe("Recovered local body");
  });

  it("keeps another tab's newer recovery draft when one tab saves", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Other tab recovery"),
          editorSessionId: "tab-two",
          editGeneration: 3,
        },
      }),
    );

    await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          title: "Saved in tab one",
          historySessionId: "history-one",
          editorSessionId: "tab-one",
          editorEditGeneration: 4,
          editorSnapshotTitle: "Saved in tab one",
          editorSnapshotContent: "Server body",
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({
      content: "Other tab recovery",
      editorSessionId: "tab-two",
      editGeneration: 3,
    });
  });

  it("does not let a tab replace or delete another tab's retained lineage", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Tab two recovery"),
          editorSessionId: "tab-two",
          editGeneration: 5,
        },
      }),
    );

    const replace = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: {
          ...payload("Tab one recovery"),
          editorSessionId: "tab-one",
          editGeneration: 6,
        },
      }),
    );
    expect(replace).toMatchObject({
      status: "conflict",
      draft: { content: "Tab two recovery", editorSessionId: "tab-two" },
    });

    const remove = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedVersion: 1,
        expectedTitle: "Builder row",
        expectedContent: "Tab two recovery",
        expectedEditorSessionId: "tab-one",
        expectedEditGeneration: 6,
      }),
    );
    expect(remove).toMatchObject({
      status: "conflict",
      draft: { content: "Tab two recovery", editorSessionId: "tab-two" },
    });
  });

  it("rejects a delete with only half of the editor identity", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Protected recovery"),
          editorSessionId: "protected-tab",
          editGeneration: 5,
        },
      }),
    );

    await expect(
      asUser(OWNER, () =>
        updateDraft.run({
          operation: "delete",
          documentId,
          expectedVersion: 1,
          expectedTitle: "Builder row",
          expectedContent: "Protected recovery",
          expectedEditorSessionId: "protected-tab",
        }),
      ),
    ).rejects.toThrow(
      "expectedEditorSessionId and expectedEditGeneration must be provided together",
    );
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "Protected recovery", editGeneration: 5 });
  });

  it("does not let a delayed lower generation replace newer unsettled work", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Generation five"),
          editorSessionId: "ordered-tab",
          editGeneration: 5,
        },
      }),
    );

    const delayed = await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        draft: {
          ...payload("Delayed generation four"),
          editorSessionId: "ordered-tab",
          editGeneration: 4,
        },
      }),
    );

    expect(delayed).toMatchObject({
      status: "conflict",
      draft: { content: "Generation five", editGeneration: 5, version: 1 },
    });
  });

  it("settles an unchanged editor snapshot without bumping the document timestamp", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload(before.content),
          title: before.title,
          editorSessionId: "revert-tab",
          editGeneration: 9,
        },
      }),
    );

    await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          title: before.title,
          content: before.content,
          editorSessionId: "revert-tab",
          editorEditGeneration: 9,
          editorSnapshotTitle: before.title,
          editorSnapshotContent: before.content,
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    const after = await documentRowForDraftTest(documentId);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.bodyRevision).toBe(before.bodyRevision);
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  it("does not settle a generation when only part of its editor snapshot was saved", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Local body"),
          title: "Local title",
          editorSessionId: "partial-tab",
          editGeneration: 7,
        },
      }),
    );

    await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Local body",
          editorSessionId: "partial-tab",
          editorEditGeneration: 7,
          editorSnapshotTitle: "Local title",
          editorSnapshotContent: "Local body",
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ title: "Local title", content: "Local body" });
  });

  it("settles a retained generation after its rebased candidate is confirmed", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Local body"),
          editorSessionId: "rebase-tab",
          editGeneration: 8,
        },
      }),
    );

    const saveBase = await authoredSaveBase(
      documentId,
      "Server hunk and local body",
    );
    await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Server hunk and local body",
          ...saveBase,
          browserSaveAttemptId: "rebase-generation-eight",
          editorSessionId: "rebase-tab",
          editorEditGeneration: 8,
          editorSnapshotTitle: "Builder row",
          editorSnapshotContent: "Server hunk and local body",
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );

    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });
});
