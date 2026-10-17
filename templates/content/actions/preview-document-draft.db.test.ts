import { createHash } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { serializeIconValue } from "@agent-native/core/icons";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { outcomeCounter } = vi.hoisted(() => ({ outcomeCounter: vi.fn() }));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  countOutcome: outcomeCounter,
}));
vi.mock("@agent-native/core/application-state", async (importOriginal) => {
  const original =
    await importOriginal<
      typeof import("@agent-native/core/application-state")
    >();
  return { ...original, writeAppState: vi.fn(original.writeAppState) };
});
vi.mock("../server/lib/private-icon-authority.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/lib/private-icon-authority.js")
  >()),
  assertPrivateIconOwner: vi.fn(async () => {
    throw new Error("Private icon is unavailable to this user.");
  }),
}));

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
let editDocument: typeof import("./edit-document.js").default;
let settlement: typeof import("./_preview-document-draft-settlement.js");

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const { registerLabs } = await import("@agent-native/core/labs/registry");
  const { CREATIVE_CONTEXT_LIBRARY_LAB } =
    await import("@agent-native/creative-context");
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDraft = (await import("./get-preview-document-draft.js")).default;
  updateDraft = (await import("./update-preview-document-draft.js")).default;
  resolveDraft = (await import("./resolve-preview-document-draft.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  editDocument = (await import("./edit-document.js")).default;
  settlement = await import("./_preview-document-draft-settlement.js");
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

// An agent's edit to the page body, through edit-document.
async function agentEdit(documentId: string, find: string, replace: string) {
  const { baseRevision } = await authoredSaveBase(documentId, "");
  return asUser(OWNER, () =>
    editDocument.run(
      {
        id: documentId,
        baseRevision,
        idempotencyKey: crypto.randomUUID(),
        find,
        replace,
      },
      { caller: "mcp", userEmail: OWNER } as any,
    ),
  );
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

function stopSettlingEditor(editorSessionId: string) {
  const settle = settlement.settlePreviewDocumentDraft;
  return vi
    .spyOn(settlement, "settlePreviewDocumentDraft")
    .mockImplementation(async (input) => {
      if (input.editorSessionId === editorSessionId)
        throw new Error("settlement stopped");
      return settle(input);
    });
}

async function settlementOf(editorSessionId: string) {
  const rows = await getDb()
    .select()
    .from(schema.documentPreviewDraftSettlements)
    .where(
      eq(
        schema.documentPreviewDraftSettlements.editorSessionId,
        editorSessionId,
      ),
    );
  return rows.map((row: any) => [
    row.settledGeneration,
    row.discardedGeneration,
  ]);
}

// The save PageDraftRecovery sends when it replays a journal entry: the
// original editor session and edit generation, on the journal's base. An open
// editor sends the same save without the replay marker.
function replayJournal(input: {
  userEmail: string;
  documentId: string;
  editorSessionId: string;
  editGeneration: number;
  content: string;
  journalBase: Awaited<ReturnType<typeof authoredSaveBase>>;
  fromOpenEditor?: boolean;
  browserSaveAttemptId?: string;
}) {
  return asUser(input.userEmail, () =>
    updateDocument.run(
      {
        id: input.documentId,
        browserSaveAttemptId: input.browserSaveAttemptId ?? crypto.randomUUID(),
        ...(input.fromOpenEditor ? {} : { journalReplay: true as const }),
        content: input.content,
        baseUpdatedAt: documentUpdatedAt(input.documentId),
        baseRevision: input.journalBase.baseRevision,
        loadedUpdatedAt: documentUpdatedAt(input.documentId),
        loadedContentWasEmpty: false,
        editorSessionId: input.editorSessionId,
        editorEditGeneration: input.editGeneration,
        editorSnapshotTitle: "Builder row",
        editorSnapshotContent: input.content,
        authoredBaseRevision: input.journalBase.authoredBaseRevision,
        authoredBaseContent: input.journalBase.authoredBaseContent,
        authoredCandidateContent: input.content,
        reuseLabels: [],
      },
      { caller: "frontend" } as any,
    ),
  );
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
          status: "processing",
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

  it("keeps the draft's body hash when a retried claim puts the draft back", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const baseContentHash = `sha256:${"a".repeat(64)}`;
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Local recovery"),
          baseContentHash,
          deferredReason: "conflict",
        },
      }),
    );
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockRejectedValueOnce(new Error("worker stopped"))
      .mockRejectedValueOnce(new Error("retry stopped"));
    const request = {
      choice: "keep_mine" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    try {
      await expect(
        asUser(OWNER, () => resolveDraft.run(request)),
      ).rejects.toThrow("worker stopped");
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
      // A worker that stopped before putting the draft back leaves its claim
      // processing; the failed request above put it back as claimed.
      await getDb()
        .update(schema.documentVersions)
        .set({
          chatContext: JSON.stringify({
            ...JSON.parse(claim.chatContext),
            status: "processing",
            processingStartedAt: "2026-01-01T00:00:00.000Z",
          }),
        })
        .where(eq(schema.documentVersions.id, claim.id));
      await getDb()
        .delete(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));

      await expect(
        asUser(OWNER, () => resolveDraft.run(request)),
      ).rejects.toThrow("retry stopped");
    } finally {
      updateSpy.mockRestore();
    }
    expect(
      (await asUser(OWNER, () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "Local recovery", baseContentHash });
  });

  it("settles a retried Use saved whose first request stopped before settling", async () => {
    const documentId = await createDocument();
    const draft = {
      ...payload("Discarded local body"),
      deferredReason: "conflict" as const,
      editorSessionId: "use-saved-tab",
      editGeneration: 6,
    };
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const request = {
      choice: "use_saved" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Discarded local body",
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    const settleSpy = stopSettlingEditor(draft.editorSessionId);
    try {
      await expect(
        asUser(OWNER, () => resolveDraft.run(request)),
      ).rejects.toThrow("settlement stopped");
    } finally {
      settleSpy.mockRestore();
    }

    await expect(
      asUser(OWNER, () => resolveDraft.run(request)),
    ).resolves.toEqual({ status: "resolved", choice: "use_saved" });
    await expect(
      asUser(OWNER, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      ),
    ).resolves.toEqual({ status: "superseded", draft: null });
    const delayedSaveBase = await authoredSaveBase(
      documentId,
      "Discarded local body",
    );
    const delayed = await asUser(OWNER, () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Discarded local body",
          ...delayedSaveBase,
          editorSessionId: draft.editorSessionId,
          editorEditGeneration: draft.editGeneration,
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
      discardedGeneration: draft.editGeneration,
    });
    expect((await documentRowForDraftTest(documentId)).content).toBe(
      "Server body",
    );
  });

  it.each(["keep_mine", "save_separately"] as const)(
    "settles a %s choice applied by a worker that stopped before settling",
    async (choice) => {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        deferredReason: "conflict" as const,
        editorSessionId: `${choice}-tab`,
        editGeneration: 4,
      };
      await asUser(OWNER, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const request = {
        choice,
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      };
      const settleSpy = stopSettlingEditor(draft.editorSessionId);
      try {
        await expect(
          asUser(OWNER, () => resolveDraft.run(request)),
        ).rejects.toThrow("settlement stopped");
      } finally {
        settleSpy.mockRestore();
      }
      // The choice's write landed; model a worker that stopped before
      // putting the draft back, as a crash would leave it.
      const [claim] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.documentId, documentId),
            eq(
              schema.documentVersions.operation,
              `claim-preview-draft-${choice}`,
            ),
          ),
        );
      await getDb()
        .update(schema.documentVersions)
        .set({
          chatContext: JSON.stringify({
            ...JSON.parse(claim.chatContext),
            status: "processing",
          }),
        })
        .where(eq(schema.documentVersions.id, claim.id));
      await getDb()
        .delete(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));

      await expect(
        asUser(OWNER, () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft,
          }),
        ),
      ).resolves.toEqual({ status: "superseded", draft: null });
    },
  );

  it.each(["use_saved", "keep_mine", "save_separately"] as const)(
    "settles a %s claim an earlier resolver marked resolved without settling",
    async (choice) => {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        deferredReason: "conflict" as const,
        editorSessionId: `unsettled-${choice}-tab`,
        editGeneration: 5,
      };
      await asUser(OWNER, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const request = {
        choice,
        documentId,
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      };
      const delayedSaveBase = await authoredSaveBase(
        documentId,
        "Local recovery",
      );
      const settleSpy = stopSettlingEditor(draft.editorSessionId);
      try {
        await expect(
          asUser(OWNER, () => resolveDraft.run(request)),
        ).rejects.toThrow("settlement stopped");
      } finally {
        settleSpy.mockRestore();
      }
      // Resolvers before this fix could mark a retried claim resolved without
      // settling it, and those claims are still in the database.
      const [claim] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.documentId, documentId),
            eq(
              schema.documentVersions.operation,
              choice === "use_saved"
                ? "use-saved-preview-draft"
                : `claim-preview-draft-${choice}`,
            ),
          ),
        );
      await getDb()
        .update(schema.documentVersions)
        .set({
          chatContext: JSON.stringify({
            ...JSON.parse(claim.chatContext),
            status: "resolved",
          }),
        })
        .where(eq(schema.documentVersions.id, claim.id));
      await getDb()
        .delete(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const unsettled = await getDb()
        .select()
        .from(schema.documentPreviewDraftSettlements)
        .where(
          eq(
            schema.documentPreviewDraftSettlements.editorSessionId,
            draft.editorSessionId,
          ),
        );
      expect(
        unsettled.map((row) => [
          row.settledGeneration,
          row.discardedGeneration,
        ]),
      ).toEqual([[-1, null]]);

      await expect(
        asUser(OWNER, () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft,
          }),
        ),
      ).resolves.toEqual({ status: "superseded", draft: null });
      if (choice !== "use_saved") return;
      const delayed = await asUser(OWNER, () =>
        updateDocument.run(
          {
            id: documentId,
            content: "Local recovery",
            ...delayedSaveBase,
            editorSessionId: draft.editorSessionId,
            editorEditGeneration: draft.editGeneration,
            editorSnapshotTitle: "Builder row",
            editorSnapshotContent: "Local recovery",
            browserSaveAttemptId: "delayed-unsettled-use-saved-attempt",
            reuseLabels: [],
          },
          { caller: "frontend" } as any,
        ),
      );
      expect(delayed).toMatchObject({
        superseded: true,
        discardedGeneration: draft.editGeneration,
      });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
    },
  );

  describe("claims an earlier resolver left resolved without settling", () => {
    // The state main leaves: the first request applied the choice and
    // stopped, and a retry marked the claim resolved without settling. Claims
    // written before the draft hash have no baseContentHash.
    async function leaveUnsettledClaim(input: {
      choice: "use_saved" | "keep_mine" | "save_separately";
      userEmail: string;
      shape: "main" | "r3";
    }) {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        deferredReason: "conflict" as const,
        editorSessionId: `tab:${documentId}:legacy-${input.choice}-${input.shape}`,
        editGeneration: 5,
      };
      await asUser(input.userEmail, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const journalBase = await authoredSaveBase(documentId, "Local recovery");
      const settleSpy = stopSettlingEditor(draft.editorSessionId);
      try {
        await expect(
          asUser(input.userEmail, () =>
            resolveDraft.run({
              choice: input.choice,
              documentId,
              expectedDraftVersion: 1,
              expectedDraftTitle: "Builder row",
              expectedDraftContent: "Local recovery",
              expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
            }),
          ),
        ).rejects.toThrow("settlement stopped");
      } finally {
        settleSpy.mockRestore();
      }
      const claims = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.ownerEmail, input.userEmail),
            eq(
              schema.documentVersions.operation,
              input.choice === "use_saved"
                ? "use-saved-preview-draft"
                : `claim-preview-draft-${input.choice}`,
            ),
          ),
        );
      const claim = claims.find(
        (row: any) =>
          JSON.parse(row.chatContext).editorSessionId === draft.editorSessionId,
      );
      expect(claim?.documentId).toBe(
        input.userEmail === OWNER ? documentId : claim?.id,
      );
      expect(JSON.parse(claim!.chatContext).editorSessionId).toBe(
        draft.editorSessionId,
      );
      const { baseContentHash, ...withoutHash } = JSON.parse(
        claim!.chatContext,
      );
      await getDb()
        .update(schema.documentVersions)
        .set({
          chatContext: JSON.stringify({
            ...(input.shape === "main"
              ? withoutHash
              : { ...withoutHash, baseContentHash }),
            status: "resolved",
          }),
        })
        .where(eq(schema.documentVersions.id, claim!.id));
      await getDb()
        .delete(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      return { documentId, draft, journalBase };
    }

    it.each([
      ["main", OWNER],
      ["r3", OWNER],
      ["main", COLLABORATOR],
      ["r3", COLLABORATOR],
    ] as const)(
      "refuses a journal replay of a Use saved generation a %s resolver left unsettled for %s",
      async (shape, userEmail) => {
        const { documentId, draft, journalBase } = await leaveUnsettledClaim({
          choice: "use_saved",
          userEmail,
          shape,
        });
        expect(await settlementOf(draft.editorSessionId)).toEqual([[-1, null]]);

        const replay = () =>
          replayJournal({
            userEmail,
            documentId,
            editorSessionId: draft.editorSessionId,
            editGeneration: draft.editGeneration,
            content: "Local recovery",
            journalBase,
          });
        await expect(replay()).resolves.toMatchObject({
          superseded: true,
          discardedGeneration: draft.editGeneration,
        });
        expect((await documentRowForDraftTest(documentId)).content).toBe(
          "Server body",
        );
        expect(await settlementOf(draft.editorSessionId)).toEqual([
          [draft.editGeneration, draft.editGeneration],
        ]);
        await expect(replay()).resolves.toMatchObject({ superseded: true });
        expect((await documentRowForDraftTest(documentId)).content).toBe(
          "Server body",
        );
      },
    );

    it("repairs a claim whose session has no settlement row yet", async () => {
      const { documentId, draft, journalBase } = await leaveUnsettledClaim({
        choice: "use_saved",
        userEmail: OWNER,
        shape: "main",
      });
      await getDb()
        .delete(schema.documentPreviewDraftSettlements)
        .where(
          eq(
            schema.documentPreviewDraftSettlements.editorSessionId,
            draft.editorSessionId,
          ),
        );

      await expect(
        replayJournal({
          userEmail: OWNER,
          documentId,
          editorSessionId: draft.editorSessionId,
          editGeneration: draft.editGeneration,
          content: "Local recovery",
          journalBase,
        }),
      ).resolves.toMatchObject({
        superseded: true,
        discardedGeneration: draft.editGeneration,
      });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
    });

    it.each(["keep_mine", "save_separately"] as const)(
      "refuses a delayed draft from a %s generation an earlier resolver left unsettled",
      async (choice) => {
        const { documentId, draft } = await leaveUnsettledClaim({
          choice,
          userEmail: OWNER,
          shape: "main",
        });

        await expect(
          asUser(OWNER, () =>
            updateDraft.run({
              operation: "upsert",
              documentId,
              expectedVersion: null,
              draft,
            }),
          ),
        ).resolves.toEqual({ status: "superseded", draft: null });
        expect(await settlementOf(draft.editorSessionId)).toEqual([
          [draft.editGeneration, null],
        ]);
      },
    );

    it("keeps the session's later edits and other sessions' saves after a repair", async () => {
      const { documentId, draft, journalBase } = await leaveUnsettledClaim({
        choice: "use_saved",
        userEmail: OWNER,
        shape: "r3",
      });
      const otherSession = `tab:${documentId}:other`;
      await expect(
        asUser(OWNER, () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft: {
              ...draft,
              content: "Other tab",
              editorSessionId: otherSession,
              editGeneration: 1,
            },
          }),
        ),
      ).resolves.toMatchObject({ status: "saved" });
      expect(await settlementOf(otherSession)).toEqual([[-1, null]]);

      const later = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId: draft.editorSessionId,
        editGeneration: draft.editGeneration + 1,
        content: "Typed after the choice",
        journalBase,
        fromOpenEditor: true,
      });
      expect(later).not.toHaveProperty("superseded");
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Typed after the choice",
      );
      expect(await settlementOf(draft.editorSessionId)).toEqual([
        [draft.editGeneration + 1, draft.editGeneration],
      ]);
    });
  });

  describe("a journal entry newer than a generation recovery discarded", () => {
    // The state PageDraftRecovery leaves after its automatic Use saved: the
    // closed editor's draft at generation 1 is in History, and its journal
    // still holds generation 2, typed on top of the discarded edits.
    async function discardDraftGeneration(userEmail: string) {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        deferredReason: "conflict" as const,
        editorSessionId: `tab:${documentId}:closed`,
        editGeneration: 1,
      };
      await asUser(userEmail, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const journalBase = await authoredSaveBase(documentId, "Local recovery");
      await expect(
        asUser(userEmail, () =>
          resolveDraft.run({
            choice: "use_saved",
            documentId,
            expectedDraftVersion: 1,
            expectedDraftTitle: "Builder row",
            expectedDraftContent: "Local recovery",
            expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(await settlementOf(draft.editorSessionId)).toEqual([[1, 1]]);
      return {
        documentId,
        editorSessionId: draft.editorSessionId,
        journalBase,
      };
    }

    async function historyContent(checkpointId: string) {
      const [checkpoint] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, checkpointId));
      return checkpoint?.content;
    }

    it.each([OWNER, COLLABORATOR])(
      "keeps a newer journal generation in History instead of merging the discarded edits for %s",
      async (userEmail) => {
        const { documentId, editorSessionId, journalBase } =
          await discardDraftGeneration(userEmail);

        const replayed = await replayJournal({
          userEmail,
          documentId,
          editorSessionId,
          editGeneration: 2,
          content: "Local recovery, then more typing",
          journalBase,
        });

        expect(replayed).toMatchObject({
          preservationRequired: true,
          reason: "provenance",
          checkpointId: expect.any(String),
        });
        expect((await documentRowForDraftTest(documentId)).content).toBe(
          "Server body",
        );
        expect(await historyContent((replayed as any).checkpointId)).toBe(
          "Local recovery, then more typing",
        );
        expect(await settlementOf(editorSessionId)).toEqual([[1, 1]]);
      },
    );

    it("keeps a newer journal generation in History after Save separately settles a later one elsewhere", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);
      await asUser(OWNER, () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: {
            ...payload("Local recovery, then more typing"),
            deferredReason: "conflict" as const,
            editorSessionId,
            editGeneration: 2,
          },
        }),
      );
      await expect(
        asUser(OWNER, () =>
          resolveDraft.run({
            choice: "save_separately",
            documentId,
            expectedDraftVersion: 1,
            expectedDraftTitle: "Builder row",
            expectedDraftContent: "Local recovery, then more typing",
            expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(await settlementOf(editorSessionId)).toEqual([[2, 1]]);

      const replayed = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 3,
        content: "Local recovery, then more typing, last word",
        journalBase,
      });

      expect(replayed).toMatchObject({ preservationRequired: true });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
      expect(await historyContent((replayed as any).checkpointId)).toBe(
        "Local recovery, then more typing, last word",
      );
    });

    it("keeps a newer journal generation in History after a title-only save settles a later one", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);
      await asUser(OWNER, () =>
        updateDocument.run(
          {
            id: documentId,
            title: "New title",
            editorSessionId,
            editorEditGeneration: 2,
            editorSnapshotTitle: "New title",
            editorSnapshotContent: "Server body",
            reuseLabels: [],
          },
          { caller: "frontend" } as any,
        ),
      );
      expect(await settlementOf(editorSessionId)).toEqual([[2, 1]]);

      const replayed = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 3,
        content: "Local recovery, then more typing",
        journalBase,
      });

      expect(replayed).toMatchObject({ preservationRequired: true });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
    });

    it("merges a newer journal generation onto a body the session saved under a title another writer changed", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);
      await getDb()
        .update(schema.documents)
        .set({ title: "Peer title" })
        .where(eq(schema.documents.id, documentId));
      await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 2,
        content: "Local recovery, then more typing",
        journalBase,
        fromOpenEditor: true,
      });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Local recovery, then more typing",
      );
      // The body was applied, but its snapshot's title is not the page's.
      expect(await settlementOf(editorSessionId)).toEqual([[1, 1]]);
      createdDocumentUpdatedAt.set(
        documentId,
        (await documentRowForDraftTest(documentId)).updatedAt,
      );

      const replayed = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 3,
        content: "Local recovery, then more typing, last word",
        journalBase: await authoredSaveBase(documentId, ""),
      });

      expect(replayed).not.toHaveProperty("preservationRequired");
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Local recovery, then more typing, last word",
      );
    });

    it.each([
      [
        "a title another writer changed",
        { title: "Local title", baseTitle: "Builder row" },
        { conflict: true },
      ],
      [
        "an invalid base revision",
        { baseRevision: "invalid" },
        { errorCode: "INVALID_BASE_REVISION" },
      ],
    ])(
      "refuses a replay over %s as it refuses an open editor's save",
      async (_case, change, refusal) => {
        const { documentId, editorSessionId, journalBase } =
          await discardDraftGeneration(OWNER);
        if ("title" in change) {
          await getDb()
            .update(schema.documents)
            .set({ title: "Peer title" })
            .where(eq(schema.documents.id, documentId));
        }
        const save = (marker: { journalReplay?: true }) =>
          asUser(OWNER, async () => {
            try {
              return await updateDocument.run(
                {
                  id: documentId,
                  browserSaveAttemptId: crypto.randomUUID(),
                  ...marker,
                  content: "Local recovery, then more typing",
                  ...journalBase,
                  ...change,
                  authoredCandidateContent: "Local recovery, then more typing",
                  editorSessionId,
                  editorEditGeneration: 2,
                  editorSnapshotTitle: "Local title",
                  editorSnapshotContent: "Local recovery, then more typing",
                  reuseLabels: [],
                },
                { caller: "frontend" } as any,
              );
            } catch (error) {
              return error;
            }
          });

        expect(await save({})).toMatchObject(refusal);
        expect(await save({ journalReplay: true })).toMatchObject(refusal);
        expect((await documentRowForDraftTest(documentId)).content).toBe(
          "Server body",
        );
      },
    );

    it("refuses a replay without an authored base over a stale timestamp as it refuses an open editor's save", async () => {
      const { documentId, editorSessionId } =
        await discardDraftGeneration(OWNER);
      const save = (marker: { journalReplay?: true }) =>
        asUser(OWNER, () =>
          updateDocument.run(
            {
              id: documentId,
              browserSaveAttemptId: crypto.randomUUID(),
              ...marker,
              title: "Local title",
              baseTitle: "Builder row",
              content: "Server body",
              baseUpdatedAt: "2000-01-01T00:00:00.000Z",
              editorSessionId,
              editorEditGeneration: 2,
              editorSnapshotTitle: "Local title",
              editorSnapshotContent: "Server body",
              reuseLabels: [],
            },
            { caller: "frontend" } as any,
          ),
        );

      expect(await save({})).toMatchObject({ conflict: true });
      expect(await save({ journalReplay: true })).toMatchObject({
        conflict: true,
      });
      expect((await documentRowForDraftTest(documentId)).title).toBe(
        "Builder row",
      );
    });

    it("refuses a replay that adds a private callout icon the user cannot use as it refuses an open editor's save", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);
      const icon = serializeIconValue({
        version: 1,
        kind: "image",
        authority: "private-icon",
        assetId: "00000000-0000-4000-8000-000000000001",
      })!;
      const content = `<callout icon="${icon.replace(/"/g, "&quot;")}">\n\tLocal recovery, then more typing\n</callout>`;
      const save = (marker: { journalReplay?: true }) =>
        asUser(OWNER, () =>
          updateDocument.run(
            {
              id: documentId,
              browserSaveAttemptId: crypto.randomUUID(),
              ...marker,
              ...journalBase,
              content,
              authoredCandidateContent: content,
              editorSessionId,
              editorEditGeneration: 2,
              editorSnapshotTitle: "Builder row",
              editorSnapshotContent: content,
              reuseLabels: [],
            },
            { caller: "frontend" } as any,
          ),
        );
      const checkpoints = async () =>
        (
          await getDb()
            .select({ id: schema.documentVersions.id })
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.documentId, documentId))
        ).length;
      const checkpointsBefore = await checkpoints();

      await expect(save({})).rejects.toThrow(
        "Private icon is unavailable to this user.",
      );
      await expect(save({ journalReplay: true })).rejects.toThrow(
        "Private icon is unavailable to this user.",
      );
      expect(await checkpoints()).toBe(checkpointsBefore);
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
    });

    it.each([
      ["all", false],
      ["part", true],
    ])(
      "keeps a newer journal generation in History after the session's later body had %s of it displaced to History",
      async (_kind, partial) => {
        const { documentId, editorSessionId, journalBase } =
          await discardDraftGeneration(OWNER);
        const cleanBody = partial ? "Server body\nOther body" : "Server body";
        let base = journalBase;
        if (partial) {
          await agentEdit(documentId, "Server body", cleanBody);
          base = await authoredSaveBase(documentId, "");
        }
        await agentEdit(documentId, "Server body", "Agent body");
        const typed = (text: string) =>
          partial ? `${text}\nOther body edited` : text;
        // The merge keeps the agent's edit and moves the session's first
        // paragraph to History.
        await expect(
          replayJournal({
            userEmail: OWNER,
            documentId,
            editorSessionId,
            editGeneration: 2,
            content: typed("Local recovery, then more typing"),
            journalBase: base,
            fromOpenEditor: true,
          }),
        ).resolves.toMatchObject({
          bodyIntentOutcome: { status: "displaced-preserved" },
        });
        expect(
          (await documentRowForDraftTest(documentId)).content,
        ).not.toContain("Local recovery");
        await agentEdit(
          documentId,
          (await documentRowForDraftTest(documentId)).content,
          cleanBody,
        );

        const replayed = await replayJournal({
          userEmail: OWNER,
          documentId,
          editorSessionId,
          editGeneration: 3,
          content: typed("Local recovery, then more typing, last word"),
          journalBase: base,
        });

        expect(replayed).toMatchObject({ preservationRequired: true });
        expect((await documentRowForDraftTest(documentId)).content).toBe(
          cleanBody,
        );
      },
    );

    it("still refuses a replay of the discarded generation itself", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);

      await expect(
        replayJournal({
          userEmail: OWNER,
          documentId,
          editorSessionId,
          editGeneration: 1,
          content: "Local recovery",
          journalBase,
        }),
      ).resolves.toMatchObject({ superseded: true, discardedGeneration: 1 });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
    });

    it("merges an open editor's save from the same session after the automatic Use saved", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);

      const saved = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 2,
        content: "Local recovery, then more typing",
        journalBase,
        fromOpenEditor: true,
      });

      expect(saved).not.toHaveProperty("preservationRequired");
      expect(saved).not.toHaveProperty("superseded");
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Local recovery, then more typing",
      );
      expect(await settlementOf(editorSessionId)).toEqual([[2, 1]]);
    });

    it("replays a later entry normally once the session saved after the discard", async () => {
      const { documentId, editorSessionId, journalBase } =
        await discardDraftGeneration(OWNER);
      await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 2,
        content: "Local recovery, then more typing",
        journalBase,
        fromOpenEditor: true,
      });
      const savedPage = await documentRowForDraftTest(documentId);
      createdDocumentUpdatedAt.set(documentId, savedPage.updatedAt);

      const replayed = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 3,
        content: "Local recovery, then more typing, and the last word",
        journalBase: await authoredSaveBase(documentId, ""),
      });

      expect(replayed).not.toHaveProperty("preservationRequired");
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Local recovery, then more typing, and the last word",
      );
      expect(await settlementOf(editorSessionId)).toEqual([[3, 1]]);
    });

    // During a deploy, a request an older server took without the marker can
    // be retried against a newer one, or the other way round.
    it.each([
      ["without", "with"],
      ["with", "without"],
    ])(
      "refuses a retry sent %s the marker after a first request %s it as a reused attempt",
      async (retried, first) => {
        const documentId = await createDocument();
        const replay = {
          userEmail: OWNER,
          documentId,
          editorSessionId: `tab:${documentId}:closed-retry`,
          editGeneration: 2,
          content: "Typed before the tab closed",
          journalBase: await authoredSaveBase(documentId, ""),
          browserSaveAttemptId: crypto.randomUUID(),
        };

        await replayJournal({ ...replay, fromOpenEditor: first === "without" });
        await expect(
          replayJournal({ ...replay, fromOpenEditor: retried === "without" }),
        ).rejects.toMatchObject({ errorCode: "BROWSER_SAVE_ATTEMPT_REUSED" });
        expect((await documentRowForDraftTest(documentId)).content).toBe(
          "Typed before the tab closed",
        );
      },
    );

    it("replays an entry normally from a session with nothing discarded", async () => {
      const documentId = await createDocument();
      const editorSessionId = `tab:${documentId}:closed-clean`;

      const replayed = await replayJournal({
        userEmail: OWNER,
        documentId,
        editorSessionId,
        editGeneration: 2,
        content: "Typed before the tab closed",
        journalBase: await authoredSaveBase(documentId, ""),
      });

      expect(replayed).not.toHaveProperty("preservationRequired");
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Typed before the tab closed",
      );
      expect(await settlementOf(editorSessionId)).toEqual([[2, null]]);
    });
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

  it("counts an idempotent inner create replay separately from the winning recovery write", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    const createAction = (await import("./create-document.js")).default;
    const runCreate = createAction.run;
    let replayError: unknown;

    const createSpy = vi
      .spyOn(createAction, "run")
      .mockImplementationOnce(async (args, ctx) => {
        await runCreate(args, ctx);
        try {
          return await runCreate(args, ctx);
        } catch (error) {
          replayError = error;
          throw error;
        }
      });
    const request = {
      choice: "save_separately" as const,
      documentId,
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    outcomeCounter.mockClear();
    try {
      const resolved = await asUser(OWNER, () => resolveDraft.run(request));
      expect(resolved).toMatchObject({ status: "resolved" });
      expect(replayError).toBeUndefined();

      const [copy] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, resolved.createdDocumentId!));
      expect(copy).toMatchObject({
        ownerEmail: OWNER,
        title: "Builder row",
        content: "Local recovery",
      });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
      const retry = await asUser(OWNER, () => resolveDraft.run(request));
      expect(retry).toMatchObject({
        status: "resolved",
        createdDocumentId: resolved.createdDocumentId,
      });
      expect(createSpy).toHaveBeenCalledTimes(1);
      await vi.waitFor(() => expect(outcomeCounter).toHaveBeenCalledTimes(2));
      expect(
        outcomeCounter.mock.calls.map(([, dimensions]) => dimensions),
      ).toEqual([
        expect.objectContaining({
          operation: "create_document",
          outcome: "written",
          origin: "recovery",
          history_effect: "none",
        }),
        expect.objectContaining({
          operation: "create_document",
          outcome: "replayed",
          origin: "recovery",
          history_effect: "none",
        }),
      ]);
    } finally {
      createSpy.mockRestore();
    }
  });

  it("counts a committed recovery create once when a post-save step fails", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    const { writeAppState } =
      await import("@agent-native/core/application-state");
    const appStateWrite = vi.mocked(writeAppState);
    appStateWrite.mockRejectedValueOnce(new Error("Post-save refresh failed"));
    outcomeCounter.mockClear();
    try {
      const resolved = await asUser(OWNER, () =>
        resolveDraft.run({
          choice: "save_separately",
          documentId,
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      );
      expect(resolved).toMatchObject({ status: "resolved" });
      const [copy] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, resolved.createdDocumentId!));
      expect(copy).toMatchObject({
        ownerEmail: OWNER,
        title: "Builder row",
        content: "Local recovery",
      });
      await vi.waitFor(() => expect(outcomeCounter).toHaveBeenCalledTimes(1));
      expect(outcomeCounter).toHaveBeenCalledWith(
        "content_save_outcome_counts",
        expect.objectContaining({
          operation: "create_document",
          outcome: "written",
          origin: "recovery",
          history_effect: "none",
        }),
      );
    } finally {
      appStateWrite.mockReset();
    }
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

  it("answers a reader without edit access instead of refusing, and keeps any old draft private", async () => {
    const documentId = await createDocument();
    await asUser(COLLABORATOR, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("collaborator draft"),
      }),
    );
    await getDb()
      .update(schema.documentShares)
      .set({ role: "viewer" })
      .where(
        and(
          eq(schema.documentShares.resourceId, documentId),
          eq(schema.documentShares.principalId, COLLABORATOR),
        ),
      );

    await expect(
      asUser(COLLABORATOR, () => getDraft.run({ documentId })),
    ).resolves.toEqual({ editable: false, draft: null });
    await expect(
      asUser(OWNER, () => getDraft.run({ documentId })),
    ).resolves.toEqual({ editable: true, draft: null });
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

  it("deletes a draft the page holds only while the stored page still holds it", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("Server body"),
      }),
    );
    await getDb()
      .update(schema.documents)
      .set({ content: "Server body, then another tab's edit" })
      .where(eq(schema.documents.id, documentId));
    const held = {
      operation: "delete" as const,
      documentId,
      expectedVersion: 1,
      expectedTitle: "Builder row",
      expectedContent: "Server body",
      ifPageHoldsDraft: true as const,
    };
    const refused = await asUser(OWNER, () => updateDraft.run(held));
    expect(refused).toMatchObject({
      status: "conflict",
      draft: { content: "Server body", version: 1 },
    });

    await getDb()
      .update(schema.documents)
      .set({ content: "Server body" })
      .where(eq(schema.documents.id, documentId));
    const deleted = await asUser(OWNER, () => updateDraft.run(held));
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
