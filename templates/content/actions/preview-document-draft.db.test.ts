import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import {
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq, ne, or } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { expectedPreviewDraftIdentity } from "../shared/preview-draft-identity.js";

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

const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let getDraft: typeof import("./get-preview-document-draft.js").default;
let updateDraft: typeof import("./update-preview-document-draft.js").default;
let resolveDraft: typeof import("./resolve-preview-document-draft.js").default;
let updateDocument: typeof import("./update-document.js").default;
let createRecoveryDocument: typeof import("./create-document.js").default;
let settlement: typeof import("./_preview-document-draft-settlement.js");

beforeAll(async () => {
  const postgresUrl = process.env.CONTENT_MIGRATION_POSTGRES_URL;
  const target = postgresUrl ? new URL(postgresUrl) : null;
  if (
    target &&
    (!["127.0.0.1", "localhost"].includes(target.hostname) ||
      !target.pathname.startsWith("/test_7781_title_"))
  )
    throw new Error(
      "Draft native tests require an isolated local test_7781_title_ database.",
    );
  process.env.DATABASE_URL = postgresUrl ?? "pglite:memory";
  console.info("Draft test database target", {
    host: target?.host ?? "embedded PGlite",
    database: target?.pathname.slice(1) ?? "memory",
    env: {
      DATABASE_URL: target
        ? "postgresql:<isolated local test database>"
        : "pglite:<isolated test database>",
      CONTENT_MIGRATION_POSTGRES_URL: target
        ? "local isolated test target"
        : "unset",
    },
  });
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
  createRecoveryDocument = (await import("./create-document.js")).default;
  settlement = await import("./_preview-document-draft-settlement.js");
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

afterAll(async () => {
  await (await import("@agent-native/core/db")).closeDbExec();
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

const selectedIdentities = new Map<
  string,
  ReturnType<typeof expectedPreviewDraftIdentity>
>();
async function selectedDraftIdentity(documentId: string) {
  const owner = getRequestUserEmail() ?? OWNER;
  const key = `${owner}:${documentId}`;
  let selected = selectedIdentities.get(key);
  if (!selected) {
    const [draft] = await getDb()
      .select()
      .from(schema.documentPreviewDrafts)
      .where(
        and(
          eq(schema.documentPreviewDrafts.documentId, documentId),
          eq(schema.documentPreviewDrafts.ownerEmail, owner),
        ),
      )
      .limit(1);
    if (!draft)
      throw new Error("Select the original draft before retrying recovery.");
    selected = expectedPreviewDraftIdentity(draft);
    selectedIdentities.set(key, selected);
  }
  return selected;
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

async function legacyClaimId(
  args: {
    documentId: string;
    expectedDraftVersion: number;
    expectedDraftTitle: string;
    expectedDraftContent: string;
    expectedDocumentUpdatedAt?: string;
  },
  includeDocumentVersion = false,
) {
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
        ...(includeDocumentVersion ? [args.expectedDocumentUpdatedAt] : []),
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
  baseTitle: "Builder row",
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

function traceDraftTransaction(tx: any, queries: string[]) {
  const wrap = (builder: any): any =>
    new Proxy(builder, {
      get(target, prop) {
        if (prop === "then")
          return (resolve: any, reject: any) => {
            queries.push(target.toSQL().sql);
            return target.then(resolve, reject);
          };
        const value = target[prop];
        return typeof value === "function"
          ? (...args: any[]) => {
              const result = value.apply(target, args);
              return result && typeof result.toSQL === "function"
                ? wrap(result)
                : result;
            }
          : value;
      },
    });
  return new Proxy(tx, {
    get(target, prop) {
      const value = target[prop];
      return ["select", "insert", "update", "delete"].includes(String(prop))
        ? (...args: any[]) => wrap(value.apply(target, args))
        : typeof value === "function"
          ? value.bind(target)
          : value;
    },
  });
}

// getDb() runs each transaction inside its own query scope. A spy that calls
// back into that method opens a second scope around the first, and native
// PostgreSQL then refuses the outer handle, so spies start the unscoped one.
function spyOnTransaction(
  db: any,
  intercept: (
    fn: any,
    transaction: (run: (tx: any) => unknown) => Promise<any>,
  ) => Promise<unknown>,
) {
  const start = Object.getPrototypeOf(db).transaction;
  return vi.spyOn(db, "transaction").mockImplementation(function (
    this: unknown,
    fn: any,
  ) {
    return intercept(fn, (run) => start.call(this, run));
  });
}

async function editorSettlement(documentId: string, editorSessionId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documentPreviewDraftSettlements)
    .where(
      and(
        eq(schema.documentPreviewDraftSettlements.documentId, documentId),
        eq(
          schema.documentPreviewDraftSettlements.editorSessionId,
          editorSessionId,
        ),
      ),
    );
  return row;
}

function expectRecoveryLockOrder(queries: string[]) {
  const page = queries.findIndex(
    (q) => q.includes('from "documents"') && q.includes("for update"),
  );
  const claim = queries.findIndex(
    (q) => q.includes('from "document_versions"') && q.includes("for update"),
  );
  const settlement = queries.findIndex(
    (q) =>
      q.includes('from "document_preview_draft_settlements"') &&
      q.includes("for update"),
  );
  const draft = queries.findIndex(
    (q) =>
      q.startsWith('delete from "document_preview_drafts"') ||
      (q.includes('from "document_preview_drafts"') &&
        q.includes("for update")),
  );
  expect(page).toBeGreaterThanOrEqual(0);
  expect(claim).toBeGreaterThan(page);
  expect(settlement).toBeGreaterThan(claim);
  if (draft !== -1) expect(draft).toBeGreaterThan(settlement);
}

async function chosenAwayDraft(
  choice: "use_saved" | "save_separately",
  identified: boolean,
  baseTitle: string | null = "Builder row",
) {
  const documentId = await createDocument();
  const before = await documentRowForDraftTest(documentId);
  const draft = {
    ...payload("Chosen away body"),
    baseTitle,
    baseDocumentUpdatedAt: before.updatedAt,
    baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
    ...(identified
      ? { editorSessionId: `prior-choice-${documentId}`, editGeneration: 5 }
      : {}),
  };
  await asUser(OWNER, async () =>
    updateDraft.run({
      operation: "upsert",
      documentId,
      expectedVersion: null,
      draft,
    }),
  );
  const [original] = await getDb()
    .select()
    .from(schema.documentPreviewDrafts)
    .where(eq(schema.documentPreviewDrafts.documentId, documentId));
  const request = {
    trigger: "reviewed" as const,
    choice,
    documentId,
    ...(await selectedDraftIdentity(documentId)),
    expectedDraftVersion: 1,
    expectedDraftTitle: draft.title,
    expectedDraftContent: draft.content,
    expectedDraftBaseTitle: baseTitle,
    expectedDocumentTitle: before.title,
    expectedDocumentUpdatedAt: before.updatedAt,
  };
  if (choice === "save_separately") {
    const stop = vi
      .spyOn(createRecoveryDocument, "run")
      .mockRejectedValueOnce(new Error("copy unavailable"));
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("copy unavailable");
    } finally {
      stop.mockRestore();
    }
  } else {
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved" });
    // Historical resolved claims can coexist with the original retained row.
    await getDb().insert(schema.documentPreviewDrafts).values(original);
  }
  const [claim] = await getDb()
    .select()
    .from(schema.documentVersions)
    .where(
      and(
        eq(schema.documentVersions.ownerEmail, OWNER),
        eq(schema.documentVersions.groupId, `draft-recovery:${original.id}`),
      ),
    );
  await asUser(OWNER, async () =>
    updateDocument.run({ id: documentId, title: "Peer rename" }),
  );
  const reviewed = await documentRowForDraftTest(documentId);
  const retained = (
    await asUser(OWNER, async () => getDraft.run({ documentId }))
  ).draft;
  return {
    documentId,
    draft,
    claim,
    retained,
    reviewed,
    request: {
      ...request,
      expectedDocumentTitle: reviewed.title,
      expectedDocumentUpdatedAt: reviewed.updatedAt,
    },
  };
}

async function unreviewedDraft(
  identified = true,
  baseTitle: string | null = "Builder row",
) {
  const documentId = await createDocument();
  const page = await documentRowForDraftTest(documentId);
  const draft = {
    ...payload("Unreviewed generation five body"),
    baseTitle,
    baseDocumentUpdatedAt: page.updatedAt,
    baseContentHash: `sha256:${createHash("sha256").update(page.content).digest("hex")}`,
    ...(identified
      ? { editorSessionId: `unreviewed-${documentId}`, editGeneration: 5 }
      : {}),
  };
  await asUser(OWNER, async () =>
    updateDraft.run({
      operation: "upsert",
      documentId,
      expectedVersion: null,
      draft,
    }),
  );
  const saved = (await asUser(OWNER, async () => getDraft.run({ documentId })))
    .draft;
  const unreviewedRequest = {
    choice: "keep_mine" as const,
    documentId,
    ...(await selectedDraftIdentity(documentId)),
    expectedDraftVersion: 1,
    expectedDraftTitle: draft.title,
    expectedDraftContent: draft.content,
    expectedDraftBaseTitle: baseTitle,
    expectedDocumentTitle: page.title,
    expectedDocumentUpdatedAt: page.updatedAt,
  };
  return { documentId, page, draft, saved, unreviewedRequest };
}

async function unchangedGenerationSix(
  state: Awaited<ReturnType<typeof unreviewedDraft>>,
) {
  await asUser(OWNER, async () =>
    updateDocument.run(
      {
        id: state.documentId,
        title: state.page.title,
        content: state.page.content,
        editorSessionId: state.draft.editorSessionId!,
        editorEditGeneration: 6,
        editorSnapshotTitle: state.page.title,
        editorSnapshotContent: state.page.content,
        reuseLabels: [],
      },
      { caller: "frontend" } as any,
    ),
  );
  expect(await documentRowForDraftTest(state.documentId)).toEqual(state.page);
  expect(
    (
      await asUser(OWNER, async () =>
        getDraft.run({ documentId: state.documentId }),
      )
    ).draft,
  ).toBeNull();
}

describe("private preview document drafts", () => {
  it.each(["newer_generation", "same_generation", "legacy"] as const)(
    "binds an automatic conflict retry to the original draft incarnation (%s)",
    async (replacement) => {
      const s = await unreviewedDraft(
        replacement !== "legacy",
        replacement === "legacy" ? null : "Builder row",
      );
      const [original] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, s.documentId));
      const request = {
        ...s.unreviewedRequest,
        choice: "use_saved" as const,
        trigger: "automatic" as const,
        expectedDraftId: original.id,
        expectedDraftEditorSessionId: original.editorSessionId,
        expectedDraftEditGeneration: original.editGeneration,
      };
      await asUser(OWNER, async () =>
        updateDocument.run({ id: s.documentId, description: "Peer metadata" }),
      );
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "document_conflict" });
      const peer = await documentRowForDraftTest(s.documentId);
      if (replacement === "newer_generation") {
        await asUser(OWNER, async () =>
          updateDocument.run(
            {
              id: s.documentId,
              title: peer.title,
              content: peer.content,
              editorSessionId: s.draft.editorSessionId!,
              editorEditGeneration: 6,
              editorSnapshotTitle: peer.title,
              editorSnapshotContent: peer.content,
              reuseLabels: [],
            },
            { caller: "frontend" } as any,
          ),
        );
      } else {
        await asUser(OWNER, async () =>
          updateDraft.run({
            operation: "delete",
            documentId: s.documentId,
            expectedDraftId: s.saved!.id,
            expectedVersion: original.version,
            expectedTitle: original.title,
            expectedContent: original.content,
            expectedBaseTitle: original.baseTitle,
          }),
        );
      }
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toBeNull();
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId: s.documentId,
          expectedVersion: null,
          draft: {
            ...s.draft,
            baseDocumentUpdatedAt: peer.updatedAt,
            ...(replacement === "newer_generation"
              ? { editGeneration: 7 }
              : {}),
          },
        }),
      );
      const [newer] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, s.documentId));
      expect(newer.id).not.toBe(original.id);
      expect(newer.version).toBe(original.version);
      const retry = await asUser(OWNER, async () =>
        resolveDraft.run({
          ...request,
          expectedDocumentTitle: peer.title,
          expectedDocumentUpdatedAt: peer.updatedAt,
        }),
      );
      expect(
        await getDb()
          .select()
          .from(schema.documentPreviewDrafts)
          .where(eq(schema.documentPreviewDrafts.documentId, s.documentId)),
      ).toEqual([newer]);
      expect(retry).toMatchObject({
        status: "recovery_required",
        reason: "draft_changed",
      });
      expect(await documentRowForDraftTest(s.documentId)).toEqual(peer);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, s.documentId)),
      ).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ operation: "use-saved-preview-draft" }),
        ]),
      );
      if (replacement === "newer_generation")
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId!),
        ).toMatchObject({ settledGeneration: 6, discardedGeneration: null });
    },
  );

  it.each(["automatic", "reviewed"] as const)(
    "refuses an unbound %s draft selection without inventing source identity",
    async (trigger) => {
      const s = await unreviewedDraft();
      const before = await documentRowForDraftTest(s.documentId);
      const {
        expectedDraftId,
        expectedDraftEditorSessionId,
        expectedDraftEditGeneration,
        ...unbound
      } = s.unreviewedRequest;
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...unbound, choice: "use_saved", trigger }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "draft_changed",
      });
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toEqual(s.saved);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(before);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, s.documentId)),
      ).toEqual([]);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId!),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: null });
    },
  );

  it.each(
    [true, false].flatMap((identified) =>
      ["incarnation", "timestamp", "legacy"].map((format) => ({
        identified,
        format,
      })),
    ),
  )(
    "binds $format claim retries to the selected source and preserves a newer draft (identified=$identified)",
    async ({ identified, format }) => {
      const s = await chosenAwayDraft("use_saved", identified);
      const original = (
        await asUser(OWNER, async () =>
          getDraft.run({ documentId: s.documentId }),
        )
      ).draft!;
      const payload = JSON.parse(s.claim.chatContext!);
      if (format !== "incarnation") {
        const id = await legacyClaimId(
          {
            ...s.request,
            expectedDocumentUpdatedAt: payload.expectedDocumentUpdatedAt,
          },
          format === "timestamp",
        );
        await getDb()
          .update(schema.documentVersions)
          .set({ id })
          .where(eq(schema.documentVersions.id, s.claim.id));
      }
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "delete",
          documentId: s.documentId,
          expectedDraftId: original.id,
          expectedVersion: original.version,
          expectedTitle: original.title,
          expectedContent: original.content,
        }),
      );
      const newResult = await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId: s.documentId,
          expectedVersion: null,
          draft: { ...s.draft, ...(identified ? { editGeneration: 7 } : {}) },
        }),
      );
      const newer = newResult.draft!;
      expect(newer.id).not.toBe(original.id);
      const before = await documentRowForDraftTest(s.documentId);
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...s.request, trigger: "automatic" }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
      });
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request,
            expectedDocumentTitle: payload.reviewedDocumentTitle,
            expectedDocumentUpdatedAt: payload.expectedDocumentUpdatedAt,
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toEqual(newer);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(before);
      if (identified)
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId!),
        ).toMatchObject({ discardedGeneration: 5, settledGeneration: 5 });
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request,
            ...expectedPreviewDraftIdentity(newer),
            trigger: "automatic",
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toBeNull();
    },
  );

  it("keeps a different snapshot on the same row when an original durable claim settles", async () => {
    const s = await chosenAwayDraft("use_saved", true);
    const payload = JSON.parse(s.claim.chatContext!);
    await getDb()
      .update(schema.documentPreviewDrafts)
      .set({ version: 2, content: "Different retained snapshot" })
      .where(eq(schema.documentPreviewDrafts.id, s.retained!.id));
    const newer = (
      await asUser(OWNER, async () =>
        getDraft.run({ documentId: s.documentId }),
      )
    ).draft;
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          ...s.request,
          expectedDocumentTitle: payload.reviewedDocumentTitle,
          expectedDocumentUpdatedAt: payload.expectedDocumentUpdatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved" });
    expect(
      (
        await asUser(OWNER, async () =>
          getDraft.run({ documentId: s.documentId }),
        )
      ).draft,
    ).toEqual(newer);
    expect(
      await editorSettlement(s.documentId, s.draft.editorSessionId!),
    ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
  });

  it("refuses an unbound delete and an old bound delete after same-text row replacement", async () => {
    const s = await unreviewedDraft();
    const deletion = {
      operation: "delete" as const,
      documentId: s.documentId,
      expectedVersion: s.saved!.version,
      expectedTitle: s.saved!.title,
      expectedContent: s.saved!.content,
    };
    await expect(
      asUser(OWNER, async () => updateDraft.run(deletion)),
    ).resolves.toMatchObject({ status: "conflict", draft: s.saved });
    const bound = { ...deletion, expectedDraftId: s.saved!.id };
    await expect(
      asUser(OWNER, async () => updateDraft.run(bound)),
    ).resolves.toMatchObject({ status: "deleted" });
    const newer = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId: s.documentId,
        expectedVersion: null,
        draft: { ...s.draft, editGeneration: 7 },
      }),
    );
    await expect(
      asUser(OWNER, async () => updateDraft.run(bound)),
    ).resolves.toMatchObject({ status: "conflict", draft: newer.draft });
    expect(
      (
        await asUser(OWNER, async () =>
          getDraft.run({ documentId: s.documentId }),
        )
      ).draft,
    ).toEqual(newer.draft);
  });

  it.each(["legacy", "same_generation", "newer_generation"] as const)(
    "refuses a delayed update after its row is replaced at the same version (%s)",
    async (replacement) => {
      const documentId = await createDocument();
      const editorSessionId = `replaced-row-${documentId}`;
      const identity = (editGeneration: number) =>
        replacement === "legacy" ? {} : { editorSessionId, editGeneration };
      const original = (
        await asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft: { ...payload("Original row"), ...identity(5) },
          }),
        )
      ).draft!;
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "delete",
            documentId,
            expectedDraftId: original.id,
            expectedVersion: original.version,
            expectedTitle: original.title,
            expectedContent: original.content,
          }),
        ),
      ).resolves.toEqual({ status: "deleted", draft: null });
      const newer = (
        await asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft: {
              ...payload("Replacement row"),
              ...identity(replacement === "newer_generation" ? 7 : 5),
            },
          }),
        )
      ).draft!;
      expect(newer.id).not.toBe(original.id);
      expect(newer.version).toBe(original.version);

      const delayed = {
        operation: "upsert" as const,
        documentId,
        expectedVersion: original.version,
        draft: { ...payload("Delayed original update"), ...identity(5) },
      };
      for (const request of [
        delayed,
        { ...delayed, expectedDraftId: original.id },
        { ...delayed, expectedDraftId: "unknown-draft" },
      ]) {
        await expect(
          asUser(OWNER, async () => updateDraft.run(request)),
        ).resolves.toMatchObject({ status: "conflict", draft: newer });
      }
      expect(
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
      ).toEqual(newer);

      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: newer.version,
            expectedDraftId: newer.id,
            draft: {
              ...payload("Bound replacement update"),
              ...identity(newer.editGeneration ?? 0),
            },
          }),
        ),
      ).resolves.toMatchObject({
        status: "saved",
        draft: {
          id: newer.id,
          version: newer.version + 1,
          content: "Bound replacement update",
        },
      });
    },
  );

  it.each(["session", "generation"] as const)(
    "refuses the right row with a different original %s before claims or fences",
    async (field) => {
      const s = await unreviewedDraft();
      const request = {
        ...s.unreviewedRequest,
        choice: "use_saved" as const,
        ...(field === "session"
          ? { expectedDraftEditorSessionId: "another-session" }
          : { expectedDraftEditGeneration: 7 }),
      };
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "draft_changed",
      });
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toEqual(s.saved);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, s.documentId)),
      ).toEqual([]);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId!),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: null });
    },
  );

  async function historicalUnfencedClaim(
    choice: "use_saved" | "save_separately" | "keep_mine",
    legacy: boolean,
  ) {
    const state = await unreviewedDraft();
    const original = (
      await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, state.documentId))
    )[0];
    const request = {
      ...state.unreviewedRequest,
      trigger: "reviewed" as const,
      choice,
    };
    const resolved = await asUser(OWNER, async () => resolveDraft.run(request));
    const [claim] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.groupId, `draft-recovery:${original.id}`),
          eq(schema.documentVersions.ownerEmail, OWNER),
          eq(
            schema.documentVersions.operation,
            choice === "use_saved"
              ? "use-saved-preview-draft"
              : `claim-preview-draft-${choice}`,
          ),
        ),
      );
    let claimId = claim.id;
    let copyId =
      "createdDocumentId" in resolved ? resolved.createdDocumentId : undefined;
    if (legacy) {
      claimId = await legacyClaimId(request);
      await getDb()
        .update(schema.documentVersions)
        .set({ id: claimId })
        .where(eq(schema.documentVersions.id, claim.id));
      if (copyId) {
        const legacyCopyId = claimId.replace("draft-claim-", "recovery-");
        await getDb()
          .update(schema.documents)
          .set({ id: legacyCopyId })
          .where(eq(schema.documents.id, copyId));
        copyId = legacyCopyId;
      }
    }
    await getDb()
      .update(schema.documentPreviewDraftSettlements)
      .set({ settledGeneration: -1, discardedGeneration: null })
      .where(
        eq(schema.documentPreviewDraftSettlements.documentId, state.documentId),
      );
    await getDb().insert(schema.documentPreviewDrafts).values(original);
    return {
      ...state,
      request,
      original,
      claim: { ...claim, id: claimId },
      copyId,
    };
  }

  it.each(
    (["use_saved", "save_separately", "keep_mine"] as const).flatMap((choice) =>
      [false, true].map((legacy) => ({ choice, legacy })),
    ),
  )(
    "repairs a historical $choice fence before automatic refusal commits (legacy=$legacy)",
    async ({ choice, legacy }) => {
      const state = await historicalUnfencedClaim(choice, legacy);
      const before = await documentRowForDraftTest(state.documentId);
      const base = await authoredSaveBase(
        state.documentId,
        state.draft.content,
      );
      const db = getDb();
      const queries: string[] = [];
      let injected = false;
      let delayed: any;
      const spy = spyOnTransaction(db, async (fn, transaction) => {
        const result = await transaction((tx: any) =>
          fn(injected ? tx : traceDraftTransaction(tx, queries)),
        );
        if (!injected) {
          injected = true;
          delayed = await asUser(OWNER, async () =>
            updateDocument.run(
              {
                id: state.documentId,
                content: state.draft.content,
                ...base,
                editorSessionId: state.draft.editorSessionId!,
                editorEditGeneration: 5,
                editorSnapshotTitle: state.draft.title,
                editorSnapshotContent: state.draft.content,
                browserSaveAttemptId: `automatic-refusal-${state.documentId}`,
                reuseLabels: [],
              },
              { caller: "frontend" } as any,
            ),
          );
        }
        return result;
      });
      try {
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run({
              ...state.request,
              trigger: "automatic",
              choice: "keep_mine",
            }),
          ),
        ).resolves.toMatchObject({
          status: "recovery_required",
          reason: "prior_choice",
          choice,
        });
      } finally {
        spy.mockRestore();
      }
      expect(injected).toBe(true);
      if (choice === "keep_mine")
        expect(delayed).not.toHaveProperty("superseded");
      else
        expect(delayed).toMatchObject({
          superseded: true,
          discardedGeneration: 5,
        });
      if (choice === "keep_mine") {
        expect(await documentRowForDraftTest(state.documentId)).toMatchObject({
          title: before.title,
          content: before.content,
          bodyRevision: before.bodyRevision,
        });
        expect(
          await editorSettlement(
            state.documentId,
            state.draft.editorSessionId!,
          ),
        ).toMatchObject({ discardedGeneration: null });
      } else
        expect(await documentRowForDraftTest(state.documentId)).toEqual(before);
      if (choice !== "keep_mine")
        expect(
          await getDb()
            .select()
            .from(schema.documentPreviewDrafts)
            .where(
              eq(schema.documentPreviewDrafts.documentId, state.documentId),
            ),
        ).toEqual([state.original]);
      expect(
        (
          await getDb()
            .select()
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.id, state.claim.id))
        )[0],
      ).toEqual(state.claim);
      expectRecoveryLockOrder(queries);
    },
  );

  it.each([false, true])(
    "fences a historical missing separate copy without terminal settlement (legacy=%s)",
    async (legacy) => {
      const state = await historicalUnfencedClaim("save_separately", legacy);
      expect(state.copyId).toBeDefined();
      await getDb()
        .delete(schema.documents)
        .where(eq(schema.documents.id, state.copyId!));
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...state.request, trigger: "automatic" }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
      });
      expect(
        await editorSettlement(state.documentId, state.draft.editorSessionId!),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: 5 });
      await expect(
        asUser(OWNER, async () => resolveDraft.run(state.request)),
      ).rejects.toMatchObject({ errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT" });
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: state.documentId }),
          )
        ).draft,
      ).toMatchObject({ content: state.draft.content });
      expect(
        await editorSettlement(state.documentId, state.draft.editorSessionId!),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: 5 });
    },
  );

  it.each(["use_saved", "save_separately"] as const)(
    "refuses delayed %s draft admission between discard fencing and final settlement",
    async (choice) => {
      const state = await unreviewedDraft();
      const db = getDb();
      let injected = false;
      const spy = spyOnTransaction(db, async (fn, transaction) => {
        const result = await transaction(fn);
        if (!injected) {
          injected = true;
          expect(
            await editorSettlement(
              state.documentId,
              state.draft.editorSessionId!,
            ),
          ).toMatchObject({ settledGeneration: -1, discardedGeneration: 5 });
          for (let retry = 0; retry < 2; retry++) {
            await expect(
              asUser(OWNER, async () =>
                updateDraft.run({
                  operation: "upsert",
                  documentId: state.documentId,
                  expectedVersion: null,
                  draft: state.draft,
                }),
              ),
            ).resolves.toEqual({ status: "superseded", draft: null });
          }
        }
        return result;
      });
      try {
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run({
              ...state.unreviewedRequest,
              trigger: "reviewed",
              choice,
            }),
          ),
        ).resolves.toMatchObject({ status: "resolved", choice });
      } finally {
        spy.mockRestore();
      }
      expect(injected).toBe(true);
      const next = {
        ...state.draft,
        editGeneration: 6,
        content: "New intentional body",
      };
      const created = await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId: state.documentId,
          expectedVersion: null,
          draft: next,
        }),
      );
      expect(created).toMatchObject({
        status: "saved",
        draft: { editGeneration: 6, version: 1 },
      });
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId: state.documentId,
            expectedVersion: 1,
            expectedDraftId: created.draft!.id,
            draft: next,
          }),
        ),
      ).resolves.toMatchObject({
        status: "saved",
        draft: { editGeneration: 6, version: 2 },
      });
      expect((await documentRowForDraftTest(state.documentId)).content).toBe(
        "Server body",
      );
    },
  );

  it("preserves the exact journal draft in History on a fresh automatic retry without changing the peer page", async () => {
    const state = await unreviewedDraft();
    await asUser(OWNER, async () =>
      updateDocument.run({
        id: state.documentId,
        title: "Peer journal title",
        description: "Peer metadata",
      }),
    );
    const peer = await documentRowForDraftTest(state.documentId);
    const request = {
      ...state.unreviewedRequest,
      trigger: "automatic" as const,
      choice: "use_saved" as const,
    };
    const first = await asUser(OWNER, async () => resolveDraft.run(request));
    expect(first).toMatchObject({
      status: "document_conflict",
      document: peer,
    });
    expect(
      (
        await asUser(OWNER, async () =>
          getDraft.run({ documentId: state.documentId }),
        )
      ).draft,
    ).toEqual(state.saved);
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          ...request,
          expectedDocumentTitle: peer.title,
          expectedDocumentUpdatedAt: peer.updatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved", choice: "use_saved" });
    expect(await documentRowForDraftTest(state.documentId)).toEqual(peer);
    expect(
      (
        await asUser(OWNER, async () =>
          getDraft.run({ documentId: state.documentId }),
        )
      ).draft,
    ).toBeNull();
    const versions = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, state.documentId));
    expect(versions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: state.draft.title,
          content: state.draft.content,
          operation: "use-saved-preview-draft",
        }),
      ]),
    );
    expect(
      await editorSettlement(state.documentId, state.draft.editorSessionId!),
    ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
  });

  it.each(
    (["use_saved", "save_separately"] as const).flatMap((priorChoice) =>
      (["keep_mine", "use_saved"] as const).flatMap((requestedChoice) =>
        [true, false].map((identified) => ({
          priorChoice,
          requestedChoice,
          identified,
        })),
      ),
    ),
  )(
    "missing review marker preserves prior $priorChoice across rename for $requestedChoice (identified=$identified)",
    async ({ priorChoice, requestedChoice, identified }) => {
      const state = await chosenAwayDraft(priorChoice, identified);
      const { trigger, ...unmarked } = state.request;
      expect(trigger).toBe("reviewed");
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...unmarked, choice: requestedChoice }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
        choice: priorChoice,
        recoveryVersionId: state.claim.id,
      });
      expect(await documentRowForDraftTest(state.documentId)).toEqual(
        state.reviewed,
      );
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: state.documentId }),
          )
        ).draft,
      ).toEqual(state.retained);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.groupId, state.claim.groupId)),
      ).toEqual([state.claim]);
    },
  );

  it.each(["automatic", "reviewed", undefined] as const)(
    "missing review marker preserves a no-draft %s claim after unchanged generation six until explicit review",
    async (durableTrigger) => {
      const state = await unreviewedDraft();
      const stop = vi
        .spyOn(updateDocument, "run")
        .mockRejectedValueOnce(new Error("automatic body transport failed"));
      try {
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run({
              ...state.unreviewedRequest,
              trigger: "automatic",
            }),
          ),
        ).rejects.toThrow("automatic body transport failed");
      } finally {
        stop.mockRestore();
      }
      const [automaticClaim] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, state.documentId));
      const payload = JSON.parse(automaticClaim.chatContext);
      expect(payload).toMatchObject({
        trigger: "automatic",
        status: "claimed",
        editGeneration: 5,
      });
      if (durableTrigger !== "automatic") {
        // Historical claims may predate the marker or record an older review.
        const historical = { ...payload, trigger: durableTrigger };
        await getDb()
          .update(schema.documentVersions)
          .set({ chatContext: JSON.stringify(historical) })
          .where(eq(schema.documentVersions.id, automaticClaim.id));
      }
      const [claimBefore] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, automaticClaim.id));
      await unchangedGenerationSix(state);
      for (const request of [
        { ...state.unreviewedRequest, trigger: "automatic" as const },
        state.unreviewedRequest,
      ]) {
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({
          status: "recovery_required",
          reason: "prior_choice",
          recoveryVersionId: automaticClaim.id,
        });
        expect(await documentRowForDraftTest(state.documentId)).toEqual(
          state.page,
        );
        expect(
          await getDb()
            .select()
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.id, automaticClaim.id)),
        ).toEqual([claimBefore]);
        expect(
          await getDb()
            .select()
            .from(schema.documentPreviewDraftSettlements)
            .where(
              eq(
                schema.documentPreviewDraftSettlements.documentId,
                state.documentId,
              ),
            ),
        ).toEqual([
          expect.objectContaining({
            editorSessionId: state.draft.editorSessionId,
            settledGeneration: 6,
            discardedGeneration: null,
          }),
        ]);
      }
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...state.unreviewedRequest, trigger: "reviewed" }),
        ),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(await documentRowForDraftTest(state.documentId)).toMatchObject({
        title: state.page.title,
        content: state.draft.content,
      });
      const [reviewedClaim] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, automaticClaim.id));
      expect(JSON.parse(reviewedClaim.chatContext)).toMatchObject({
        trigger: "reviewed",
        status: "resolved",
      });
      expect(
        await editorSettlement(state.documentId, state.draft.editorSessionId!),
      ).toMatchObject({ settledGeneration: 6 });
    },
  );

  it("missing review marker uses original automatic lineage for a fresh safe recovery", async () => {
    const state = await unreviewedDraft();
    await expect(
      asUser(OWNER, async () => resolveDraft.run(state.unreviewedRequest)),
    ).resolves.toMatchObject({ status: "resolved" });
    const [claim] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, state.documentId),
          eq(
            schema.documentVersions.operation,
            "claim-preview-draft-keep_mine",
          ),
        ),
      );
    expect(JSON.parse(claim.chatContext)).toMatchObject({
      trigger: "automatic",
      status: "resolved",
      editGeneration: 5,
    });
    expect(await documentRowForDraftTest(state.documentId)).toMatchObject({
      title: state.page.title,
      content: state.draft.content,
    });
    expect(
      (
        await asUser(OWNER, async () =>
          getDraft.run({ documentId: state.documentId }),
        )
      ).draft,
    ).toBeNull();
    expect(
      await getDb()
        .select()
        .from(schema.documentPreviewDraftSettlements)
        .where(
          eq(
            schema.documentPreviewDraftSettlements.documentId,
            state.documentId,
          ),
        ),
    ).toEqual([
      expect.objectContaining({
        editorSessionId: state.draft.editorSessionId,
        settledGeneration: 5,
      }),
    ]);
  });

  it.each(["Builder row", null])(
    "missing review marker refuses an identityless legacy draft with base %s",
    async (baseTitle) => {
      const state = await unreviewedDraft(false, baseTitle);
      await expect(
        asUser(OWNER, async () => resolveDraft.run(state.unreviewedRequest)),
      ).rejects.toMatchObject({
        errorCode:
          baseTitle === null
            ? "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN"
            : "PREVIEW_DRAFT_AUTOMATIC_RECOVERY_REFUSED",
      });
      expect(await documentRowForDraftTest(state.documentId)).toEqual(
        state.page,
      );
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: state.documentId }),
          )
        ).draft,
      ).toEqual(state.saved);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, state.documentId)),
      ).toEqual([]);
    },
  );

  it("missing review marker cannot reconstruct a draft after a newer generation removed it", async () => {
    const state = await unreviewedDraft();
    await unchangedGenerationSix(state);
    await expect(
      asUser(OWNER, async () => resolveDraft.run(state.unreviewedRequest)),
    ).resolves.toMatchObject({
      status: "recovery_required",
      reason: "draft_changed",
    });
    expect(await documentRowForDraftTest(state.documentId)).toEqual(state.page);
    expect(
      await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, state.documentId)),
    ).toEqual([]);
  });
  it.each([false, true])(
    "automatically applies a fresh known draft using its original generation (authoredTitle=%s)",
    async (authoredTitle) => {
      const documentId = await createDocument();
      const before = await documentRowForDraftTest(documentId);
      const editorSessionId = `fresh-auto-${documentId}`;
      const draft = {
        ...payload("Automatically recovered body"),
        title: authoredTitle ? "Authored title" : before.title,
        editorSessionId,
        editGeneration: 5,
        baseDocumentUpdatedAt: before.updatedAt,
        baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      if (!authoredTitle)
        await asUser(OWNER, async () =>
          updateDocument.run({ id: documentId, title: "Peer title" }),
        );
      const reviewed = await documentRowForDraftTest(documentId);
      const result = await asUser(OWNER, async () =>
        resolveDraft.run({
          choice: "keep_mine",
          trigger: "automatic",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: draft.title,
          expectedDraftContent: draft.content,
          expectedDraftBaseTitle: draft.baseTitle,
          expectedDocumentTitle: reviewed.title,
          expectedDocumentUpdatedAt: reviewed.updatedAt,
        }),
      );
      expect(result).toMatchObject({ status: "resolved", choice: "keep_mine" });
      expect(await documentRowForDraftTest(documentId)).toMatchObject({
        title: authoredTitle ? "Authored title" : "Peer title",
        content: draft.content,
      });
      expect(
        await getDb()
          .select()
          .from(schema.documentPreviewDraftSettlements)
          .where(
            eq(schema.documentPreviewDraftSettlements.documentId, documentId),
          ),
      ).toEqual([
        expect.objectContaining({
          editorSessionId,
          settledGeneration: 5,
          discardedGeneration: null,
        }),
      ]);
      expect(
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
      ).toBeNull();
    },
  );

  it("requires review for an authored title conflict without consuming the automatic draft", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    const draft = {
      ...payload("Local body"),
      title: "Authored title",
      editorSessionId: `title-conflict-${documentId}`,
      editGeneration: 5,
      baseDocumentUpdatedAt: before.updatedAt,
      baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Peer title" }),
    );
    const reviewed = await documentRowForDraftTest(documentId);
    const retained = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft;
    const request = {
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: draft.title,
      expectedDraftContent: draft.content,
      expectedDraftBaseTitle: draft.baseTitle,
      expectedDocumentTitle: reviewed.title,
      expectedDocumentUpdatedAt: reviewed.updatedAt,
    };
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({ ...request, trigger: "automatic" }),
      ),
    ).rejects.toMatchObject({ errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT" });
    expect(await documentRowForDraftTest(documentId)).toEqual(reviewed);
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toEqual(retained);
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({ ...request, trigger: "reviewed" }),
      ),
    ).resolves.toMatchObject({ status: "resolved" });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      title: "Authored title",
      content: "Local body",
    });
  });

  it.each(
    (["use_saved", "save_separately"] as const).flatMap((priorChoice) =>
      (["keep_mine", "use_saved"] as const).flatMap((automaticChoice) =>
        [true, false].map((identified) => ({
          priorChoice,
          automaticChoice,
          identified,
        })),
      ),
    ),
  )(
    "keeps prior $priorChoice when automatic $automaticChoice follows a rename (identified=$identified)",
    async ({ priorChoice, automaticChoice, identified }) => {
      const state = await chosenAwayDraft(priorChoice, identified);
      const result = await asUser(OWNER, async () =>
        resolveDraft.run({
          ...state.request,
          choice: automaticChoice,
          trigger: "automatic",
        }),
      );
      expect(result).toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
        choice: priorChoice,
        recoveryVersionId: state.claim.id,
      });
      expect(await documentRowForDraftTest(state.documentId)).toEqual(
        state.reviewed,
      );
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: state.documentId }),
          )
        ).draft,
      ).toEqual(state.retained);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(
            eq(
              schema.documentVersions.groupId,
              `draft-recovery:${JSON.parse(state.claim.chatContext).draftId}`,
            ),
          ),
      ).toEqual([state.claim]);
    },
  );

  it.each(["use_saved", "save_separately"] as const)(
    "preserves identity-less unknown title lineage after %s",
    async (choice) => {
      const state = await chosenAwayDraft(choice, false, null);
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...state.request,
            choice: "keep_mine",
            trigger: "automatic",
          }),
        ),
      ).resolves.toMatchObject({ status: "recovery_required", choice });
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...state.request,
            choice: "keep_mine",
            trigger: "reviewed",
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN",
      });
      expect(await documentRowForDraftTest(state.documentId)).toEqual(
        state.reviewed,
      );
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: state.documentId }),
          )
        ).draft,
      ).toEqual(state.retained);
    },
  );

  it.each([true, false])(
    "retries the original separate choice after rename and another copy failure (identified=%s)",
    async (identified) => {
      const state = await chosenAwayDraft(
        "save_separately",
        identified,
        identified ? "Builder row" : null,
      );
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...state.request,
            choice: "use_saved",
            trigger: "automatic",
          }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        choice: "save_separately",
      });
      const stop = vi
        .spyOn(createRecoveryDocument, "run")
        .mockRejectedValueOnce(new Error("copy still unavailable"));
      try {
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run({ ...state.request, trigger: "reviewed" }),
          ),
        ).rejects.toThrow("copy still unavailable");
      } finally {
        stop.mockRestore();
      }
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: state.documentId }),
          )
        ).draft,
      ).toEqual(state.retained);
      const retried = await asUser(OWNER, async () =>
        resolveDraft.run({ ...state.request, trigger: "reviewed" }),
      );
      expect(retried).toMatchObject({
        status: "resolved",
        choice: "save_separately",
        createdDocumentId: state.claim.id.replace("draft-claim-", "recovery-"),
      });
      expect(await documentRowForDraftTest(state.documentId)).toEqual(
        state.reviewed,
      );
      expect(
        await documentRowForDraftTest(retried.createdDocumentId!),
      ).toMatchObject({
        title: state.draft.title,
        content: state.draft.content,
      });
      const claims = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.groupId, state.claim.groupId));
      expect(claims).toHaveLength(1);
      expect(claims[0].id).toBe(state.claim.id);
      expect(JSON.parse(claims[0].chatContext)).toMatchObject({
        choice: "save_separately",
        status: "resolved",
        expectedDocumentUpdatedAt: state.reviewed.updatedAt,
        reviewedDocumentTitle: "Peer rename",
        baseTitle: state.draft.baseTitle,
      });
    },
  );

  it.each(["use_saved", "save_separately"] as const)(
    "allows an intentional reviewed Keep mine override after %s without weakening the original fence",
    async (choice) => {
      const state = await chosenAwayDraft(choice, true);
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...state.request,
            choice: "keep_mine",
            trigger: "automatic",
          }),
        ),
      ).resolves.toMatchObject({ status: "recovery_required" });
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...state.request,
            choice: "keep_mine",
            trigger: "reviewed",
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
      expect(await documentRowForDraftTest(state.documentId)).toMatchObject({
        title: "Peer rename",
        content: state.draft.content,
      });
      expect(
        await editorSettlement(state.documentId, state.draft.editorSessionId!),
      ).toMatchObject({ discardedGeneration: 5 });
      const oldSave = await authoredSaveBase(
        state.documentId,
        "Delayed discarded generation",
      );
      await expect(
        asUser(OWNER, async () =>
          updateDocument.run(
            {
              id: state.documentId,
              content: "Delayed discarded generation",
              ...oldSave,
              editorSessionId: state.draft.editorSessionId!,
              editorEditGeneration: 5,
              editorSnapshotTitle: "Peer rename",
              editorSnapshotContent: "Delayed discarded generation",
              browserSaveAttemptId: `delayed-old-${state.documentId}`,
            },
            { caller: "frontend" } as any,
          ),
        ),
      ).resolves.toMatchObject({ superseded: true, discardedGeneration: 5 });
      expect((await documentRowForDraftTest(state.documentId)).content).toBe(
        state.draft.content,
      );
    },
  );

  it("rechecks the original source generation inside the automatic body mutation", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    const editorSessionId = `automatic-owner-${documentId}`;
    const draft = {
      ...payload("Old generation body"),
      editorSessionId,
      editGeneration: 5,
      baseDocumentUpdatedAt: before.updatedAt,
      baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const original = updateDocument.run;
    const spy = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async (...args) => {
        expect(args[0]).toMatchObject({
          editorSessionId,
          editorEditGeneration: 5,
        });
        await original(
          {
            id: documentId,
            title: before.title,
            content: before.content,
            editorSessionId,
            editorEditGeneration: 6,
            editorSnapshotTitle: before.title,
            editorSnapshotContent: before.content,
            reuseLabels: [],
          },
          { caller: "frontend" } as any,
        );
        expect((await documentRowForDraftTest(documentId)).updatedAt).toBe(
          before.updatedAt,
        );
        return original(...args);
      });
    try {
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            choice: "keep_mine",
            trigger: "automatic",
            documentId,
            ...(await selectedDraftIdentity(documentId)),
            expectedDraftVersion: 1,
            expectedDraftTitle: draft.title,
            expectedDraftBaseTitle: draft.baseTitle,
            expectedDraftContent: draft.content,
            expectedDocumentTitle: before.title,
            expectedDocumentUpdatedAt: before.updatedAt,
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "PREVIEW_DRAFT_AUTOMATIC_RECOVERY_REFUSED",
      });
    } finally {
      spy.mockRestore();
    }
    expect((await documentRowForDraftTest(documentId)).content).toBe(
      before.content,
    );
    expect(await editorSettlement(documentId, editorSessionId)).toMatchObject({
      settledGeneration: 6,
    });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({
      content: draft.content,
      editGeneration: 5,
      baseTitle: draft.baseTitle,
    });
  });

  it("preserves a pending separate choice across a peer rename during automatic recovery", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    const original = {
      ...payload("Chosen separate body"),
      baseDocumentUpdatedAt: before.updatedAt,
      baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
      editorSessionId: `consent-${documentId}`,
      editGeneration: 5,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: original,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "save_separately" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: original.title,
      expectedDraftContent: original.content,
      expectedDraftBaseTitle: original.baseTitle,
      expectedDocumentTitle: before.title,
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const stopped = vi
      .spyOn(createRecoveryDocument, "run")
      .mockRejectedValueOnce(new Error("copy transport unavailable"));
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("copy transport unavailable");
    } finally {
      stopped.mockRestore();
    }
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Peer rename" }),
    );
    const renamed = await documentRowForDraftTest(documentId);
    const retained = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft!;
    expect(retained).toMatchObject({ ...original, loadedContentWasEmpty: 0 });
    expect(retained.baseContentHash).toBe(
      `sha256:${createHash("sha256").update(renamed.content).digest("hex")}`,
    );
    expect(retained.baseTitle).toBe(retained.title);
    const auto = await asUser(OWNER, async () =>
      resolveDraft.run({
        ...request,
        choice: "keep_mine",
        trigger: "automatic",
        expectedDraftVersion: retained.version,
        expectedDocumentTitle: renamed.title,
        expectedDocumentUpdatedAt: renamed.updatedAt,
      }),
    );
    const after = await documentRowForDraftTest(documentId);
    const claims = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    console.info(
      "REVIEW_R1_CONSENT_OUTCOME",
      JSON.stringify({
        result: auto.status,
        before: { title: renamed.title, content: renamed.content },
        after: { title: after.title, content: after.content },
        claims: claims
          .filter((x: any) => x.chatContext?.includes("draftId"))
          .map((x: any) => ({
            operation: x.operation,
            payload: JSON.parse(x.chatContext),
          })),
      }),
    );
    expect(after).toEqual(renamed);
    expect(auto).toMatchObject({
      status: "recovery_required",
      choice: "save_separately",
    });
    const recoveryClaims = claims.filter(
      (claim: any) =>
        claim.operation === "claim-preview-draft-save_separately" ||
        claim.operation === "claim-preview-draft-keep_mine" ||
        claim.operation === "use-saved-preview-draft",
    );
    expect(recoveryClaims).toHaveLength(1);
    expect(JSON.parse(recoveryClaims[0].chatContext)).toMatchObject({
      choice: "save_separately",
      status: "claimed",
      editGeneration: 5,
    });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toEqual(retained);
  });

  it("refuses automatic replay of generation five after generation six settles during copy failure", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    const original = {
      ...payload("Chosen separate body"),
      baseDocumentUpdatedAt: before.updatedAt,
      baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
      editorSessionId: `consent-${documentId}`,
      editGeneration: 5,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: original,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "save_separately" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: original.title,
      expectedDraftContent: original.content,
      expectedDraftBaseTitle: original.baseTitle,
      expectedDocumentTitle: before.title,
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const stopped = vi
      .spyOn(createRecoveryDocument, "run")
      .mockImplementationOnce(async () => {
        const authored = await authoredSaveBase(documentId, before.content);
        await updateDocument.run(
          {
            id: documentId,
            title: "Newer generation title",
            content: before.content,
            ...authored,
            baseTitle: before.title,
            editorSessionId: original.editorSessionId,
            editorEditGeneration: 6,
            editorSnapshotTitle: "Newer generation title",
            editorSnapshotContent: before.content,
            browserSaveAttemptId: `newer-generation-${documentId}`,
          },
          { caller: "frontend" } as any,
        );
        throw new Error("copy transport unavailable");
      });
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("copy transport unavailable");
    } finally {
      stopped.mockRestore();
    }
    const [settled] = await getDb()
      .select()
      .from(schema.documentPreviewDraftSettlements)
      .where(eq(schema.documentPreviewDraftSettlements.documentId, documentId));
    expect(settled).toMatchObject({
      settledGeneration: 6,
      discardedGeneration: 5,
    });
    console.info("REVIEW_R1_NEWER_SETTLEMENT", JSON.stringify(settled));
    const renamed = await documentRowForDraftTest(documentId);
    const retained = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft!;
    expect(retained).toMatchObject({ ...original, loadedContentWasEmpty: 0 });
    expect(retained.baseContentHash).toBe(
      `sha256:${createHash("sha256").update(renamed.content).digest("hex")}`,
    );
    expect(retained.baseTitle).toBe(retained.title);
    const auto = await asUser(OWNER, async () =>
      resolveDraft.run({
        ...request,
        choice: "keep_mine",
        trigger: "automatic",
        expectedDraftVersion: retained.version,
        expectedDocumentTitle: renamed.title,
        expectedDocumentUpdatedAt: renamed.updatedAt,
      }),
    );
    const after = await documentRowForDraftTest(documentId);
    const claims = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    console.info(
      "REVIEW_R1_CONSENT_OUTCOME",
      JSON.stringify({
        result: auto.status,
        before: { title: renamed.title, content: renamed.content },
        after: { title: after.title, content: after.content },
        claims: claims
          .filter((x: any) => x.chatContext?.includes("draftId"))
          .map((x: any) => ({
            operation: x.operation,
            payload: JSON.parse(x.chatContext),
          })),
      }),
    );
    expect(after).toEqual(renamed);
    expect(auto).toMatchObject({
      status: "recovery_required",
      choice: "save_separately",
    });
    const recoveryClaims = claims.filter(
      (claim: any) =>
        claim.operation === "claim-preview-draft-save_separately" ||
        claim.operation === "claim-preview-draft-keep_mine" ||
        claim.operation === "use-saved-preview-draft",
    );
    expect(recoveryClaims).toHaveLength(1);
    expect(JSON.parse(recoveryClaims[0].chatContext)).toMatchObject({
      choice: "save_separately",
      status: "claimed",
      editGeneration: 5,
    });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toEqual(retained);
  });

  it.each(
    (["use_saved", "save_separately", "keep_mine"] as const).flatMap((choice) =>
      (["claim", "settled"] as const).map((phase) => ({ choice, phase })),
    ),
  )(
    "honors a fresh $choice choice for an authored save after $phase commit",
    async ({ choice, phase }) => {
      const documentId = await createDocument();
      const before = await documentRowForDraftTest(documentId);
      const draft = {
        ...payload("Local recovery"),
        deferredReason: "conflict" as const,
        editorSessionId: `fresh-${documentId}`,
        editGeneration: 5,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDocumentUpdatedAt: before.updatedAt,
      };
      const base = await authoredSaveBase(documentId, draft.content);
      const save = () =>
        asUser(OWNER, async () =>
          updateDocument.run(
            {
              id: documentId,
              content: draft.content,
              ...base,
              baseTitle: before.title,
              editorSessionId: draft.editorSessionId,
              editorEditGeneration: draft.editGeneration,
              editorSnapshotTitle: draft.title,
              editorSnapshotContent: draft.content,
              browserSaveAttemptId: `fresh-save-${documentId}`,
              reuseLabels: [],
            },
            { caller: "frontend" } as any,
          ),
        );
      const db = getDb();
      const queries: string[] = [];
      let injected = false;
      let delayed: any;
      let claimSettlement: any;
      let retainedReplacement: any;
      const spy = spyOnTransaction(db, async (fn, transaction) => {
        const first = !injected;
        const result = await transaction((tx: any) =>
          fn(first ? traceDraftTransaction(tx, queries) : tx),
        );
        if (first) {
          // Await the real first claim commit before delivering the browser save.
          injected = true;
          [claimSettlement] = await db
            .select()
            .from(schema.documentPreviewDraftSettlements)
            .where(
              and(
                eq(
                  schema.documentPreviewDraftSettlements.documentId,
                  documentId,
                ),
                eq(
                  schema.documentPreviewDraftSettlements.editorSessionId,
                  draft.editorSessionId,
                ),
              ),
            );
          if (phase === "claim") delayed = await save();
          retainedReplacement = await asUser(OWNER, async () =>
            updateDraft.run({
              operation: "upsert",
              documentId,
              expectedVersion: null,
              draft: {
                ...draft,
                content: "Newer recoverable body",
                ...(phase === "claim"
                  ? { editGeneration: 6 }
                  : { editorSessionId: `${draft.editorSessionId}-other` }),
              },
            }),
          );
        }
        return result;
      });
      let resolved: any;
      try {
        resolved = await asUser(OWNER, async () => resolveDraft.run(request));
      } finally {
        spy.mockRestore();
      }
      if (phase === "settled") delayed = await save();
      expect(resolved).toMatchObject({ status: "resolved", choice });
      expect(injected).toBe(true);
      expect(retainedReplacement.status).toBe("saved");
      if (choice === "keep_mine") {
        expect(delayed).not.toHaveProperty("superseded");
      } else {
        expect(delayed).toMatchObject({
          superseded: true,
          discardedGeneration: 5,
        });
      }
      expect(await documentRowForDraftTest(documentId)).toMatchObject({
        title: before.title,
        content: choice === "keep_mine" ? draft.content : before.content,
        bodyRevision: choice === "keep_mine" ? 1 : before.bodyRevision,
      });
      expect(claimSettlement).toMatchObject({
        settledGeneration: -1,
        discardedGeneration: choice === "keep_mine" ? null : 5,
      });
      const [settled] = await db
        .select()
        .from(schema.documentPreviewDraftSettlements)
        .where(
          and(
            eq(schema.documentPreviewDraftSettlements.documentId, documentId),
            eq(
              schema.documentPreviewDraftSettlements.editorSessionId,
              draft.editorSessionId,
            ),
          ),
        );
      expect(settled).toMatchObject({
        settledGeneration: 5,
        discardedGeneration: choice === "keep_mine" ? null : 5,
      });
      const settlementLock = queries.findIndex(
        (q) =>
          q.includes('from "document_preview_draft_settlements"') &&
          q.includes("for update"),
      );
      const draftLock = queries.findIndex(
        (q) =>
          q.includes('from "document_preview_drafts"') &&
          q.includes("for update"),
      );
      expect(settlementLock).toBeGreaterThanOrEqual(0);
      expect(draftLock).toBeGreaterThan(settlementLock);
      expectRecoveryLockOrder(queries);
      const claimInsert = queries.findIndex((q) =>
        q.startsWith('insert into "document_versions"'),
      );
      expect(claimInsert).toBeGreaterThanOrEqual(0);
      expect(settlementLock).toBeGreaterThan(claimInsert);
      if (choice === "save_separately") {
        expect(
          await documentRowForDraftTest(resolved.createdDocumentId),
        ).toMatchObject({
          title: draft.title,
          content: draft.content,
          ownerEmail: OWNER,
        });
      }
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, async () => getDraft.run({ documentId })),
      ).resolves.toMatchObject({
        draft: retainedReplacement.draft,
      });
    },
  );

  it.each(
    (["use_saved", "save_separately"] as const).flatMap((choice) =>
      (["failure", "replacement", "title_base"] as const).map((interrupt) => ({
        choice,
        interrupt,
      })),
    ),
  )(
    "rolls back a fresh $choice claim after fence $interrupt",
    async ({ choice, interrupt }) => {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        editorSessionId: `rollback-${documentId}`,
        editGeneration: 5,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const [original] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const fence = settlement.fencePreviewDocumentDraftGeneration;
      const failure = new ActionContractError("Fence interrupted.", {
        errorCode: "TEST_FENCE_INTERRUPTED",
        statusCode: 503,
      });
      const spy = vi
        .spyOn(settlement, "fencePreviewDocumentDraftGeneration")
        .mockImplementationOnce(async (input) => {
          await fence(input);
          if (interrupt === "failure") throw failure;
          // A delete/reinsert can preserve the displayed snapshot but change lineage.
          await input.db
            .update(schema.documentPreviewDrafts)
            .set(
              interrupt === "title_base"
                ? { baseTitle: "Other title base" }
                : {
                    id: `${original.id}-replacement`,
                    editorSessionId: "replacement-tab",
                  },
            )
            .where(eq(schema.documentPreviewDrafts.id, original.id));
        });
      try {
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run({
              trigger: "reviewed",
              choice,
              documentId,
              ...(await selectedDraftIdentity(documentId)),
              expectedDraftVersion: 1,
              expectedDraftTitle: draft.title,
              expectedDraftContent: draft.content,
              expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
            }),
          ),
        ).rejects.toMatchObject({
          errorCode:
            interrupt === "failure"
              ? "TEST_FENCE_INTERRUPTED"
              : "PREVIEW_DRAFT_RECOVERY_CONFLICT",
        });
      } finally {
        spy.mockRestore();
      }
      expect(
        await getDb()
          .select()
          .from(schema.documentPreviewDrafts)
          .where(eq(schema.documentPreviewDrafts.documentId, documentId)),
      ).toEqual([original]);
      expect(
        await editorSettlement(documentId, draft.editorSessionId),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: null });
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId)),
      ).toEqual([]);
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        "Server body",
      );
    },
  );

  it.each([false, true])(
    "keeps a failed separate copy fenced and retriable (draftPresent=$0)",
    async (draftPresent) => {
      const documentId = await createDocument();
      const before = await documentRowForDraftTest(documentId);
      const draft = {
        ...payload("Local recovery"),
        editorSessionId: `copy-failure-${documentId}`,
        editGeneration: 5,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const [original] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const request = {
        trigger: "reviewed" as const,
        choice: "save_separately" as const,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDocumentUpdatedAt: before.updatedAt,
      };
      const failure = new ActionContractError("Copy unavailable.", {
        errorCode: "TEST_COPY_UNAVAILABLE",
        statusCode: 503,
      });
      const spy = vi
        .spyOn(createRecoveryDocument, "run")
        .mockRejectedValueOnce(failure);
      try {
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).rejects.toBe(failure);
      } finally {
        spy.mockRestore();
      }
      const [claim] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, documentId));
      expect(JSON.parse(claim.chatContext)).toMatchObject({
        status: "claimed",
        choice: "save_separately",
        draftId: original.id,
      });
      expect(claim.content).toBe(draft.content);
      expect(
        await documentRowForDraftTest(
          claim.id.replace("draft-claim-", "recovery-"),
        ),
      ).toBeUndefined();
      expect(
        await getDb()
          .select()
          .from(schema.documentPreviewDrafts)
          .where(eq(schema.documentPreviewDrafts.documentId, documentId)),
      ).toEqual([original]);
      expect(
        await editorSettlement(documentId, draft.editorSessionId),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: 5 });
      const base = await authoredSaveBase(documentId, draft.content);
      await expect(
        asUser(OWNER, async () =>
          updateDocument.run(
            {
              id: documentId,
              content: draft.content,
              ...base,
              baseTitle: before.title,
              editorSessionId: draft.editorSessionId,
              editorEditGeneration: 5,
              editorSnapshotTitle: draft.title,
              editorSnapshotContent: draft.content,
              browserSaveAttemptId: `failed-copy-save-${documentId}`,
              reuseLabels: [],
            },
            { caller: "frontend" } as any,
          ),
        ),
      ).resolves.toMatchObject({ superseded: true, discardedGeneration: 5 });
      expect(await documentRowForDraftTest(documentId)).toEqual(before);
      if (!draftPresent)
        await getDb()
          .delete(schema.documentPreviewDrafts)
          .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const recovered = await asUser(OWNER, async () =>
        resolveDraft.run(request),
      );
      expect(recovered).toMatchObject({
        status: "resolved",
        choice: "save_separately",
      });
      expect(
        await documentRowForDraftTest(recovered.createdDocumentId!),
      ).toMatchObject({ content: draft.content, ownerEmail: OWNER });
      expect(
        await editorSettlement(documentId, draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
      expect(
        JSON.parse(
          (
            await getDb()
              .select()
              .from(schema.documentVersions)
              .where(eq(schema.documentVersions.id, claim.id))
          )[0].chatContext,
        ).status,
      ).toBe("resolved");
      expect(await documentRowForDraftTest(documentId)).toEqual(before);
    },
  );

  it.each(
    (["use_saved", "keep_mine", "save_separately"] as const).flatMap((choice) =>
      [false, true].map((exactDraft) => ({ choice, exactDraft })),
    ),
  )(
    "fences an unresolved $choice retry before its first commit (exactDraft=$exactDraft)",
    async ({ choice, exactDraft }) => {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        editorSessionId: `retry-${documentId}`,
        editGeneration: 5,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const [original] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      };
      await asUser(OWNER, async () => resolveDraft.run(request));
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
      // Reconstruct an abandoned, unfenced claim from the earlier resolver.
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
        .update(schema.documentPreviewDraftSettlements)
        .set({ settledGeneration: -1, discardedGeneration: null })
        .where(
          eq(schema.documentPreviewDraftSettlements.documentId, documentId),
        );
      await getDb()
        .update(schema.documents)
        .set({ updatedAt: request.expectedDocumentUpdatedAt })
        .where(eq(schema.documents.id, documentId));
      if (exactDraft)
        await getDb().insert(schema.documentPreviewDrafts).values(original);
      const before = await documentRowForDraftTest(documentId);
      const base = await authoredSaveBase(documentId, draft.content);
      const db = getDb();
      const queries: string[] = [];
      let injected = false;
      let delayed: any;
      let firstSettlement: any;
      const spy = spyOnTransaction(db, async (fn, transaction) => {
        const first = !injected;
        const result = await transaction((tx: any) =>
          fn(first ? traceDraftTransaction(tx, queries) : tx),
        );
        if (first) {
          injected = true;
          firstSettlement = await editorSettlement(
            documentId,
            draft.editorSessionId,
          );
          delayed = await asUser(OWNER, async () =>
            updateDocument.run(
              {
                id: documentId,
                content: draft.content,
                ...base,
                baseTitle: before.title,
                editorSessionId: draft.editorSessionId,
                editorEditGeneration: 5,
                editorSnapshotTitle: draft.title,
                editorSnapshotContent: draft.content,
                browserSaveAttemptId: `unresolved-save-${documentId}`,
                reuseLabels: [],
              },
              { caller: "frontend" } as any,
            ),
          );
        }
        return result;
      });
      try {
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({ status: "resolved", choice });
      } finally {
        spy.mockRestore();
      }
      expect(injected).toBe(true);
      if (choice === "keep_mine")
        expect(delayed).not.toHaveProperty("superseded");
      else
        expect(delayed).toMatchObject({
          superseded: true,
          discardedGeneration: 5,
        });
      expect(firstSettlement).toMatchObject({
        settledGeneration: -1,
        discardedGeneration: choice === "keep_mine" ? null : 5,
      });
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        before.content,
      );
      expectRecoveryLockOrder(queries);
    },
  );

  it("keeps a failed copy pending when a newer source generation settles", async () => {
    const documentId = await createDocument();
    const draft = {
      ...payload("Local recovery"),
      editorSessionId: `newer-copy-${documentId}`,
      editGeneration: 5,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "save_separately" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: draft.title,
      expectedDraftContent: draft.content,
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    const failure = new ActionContractError("Copy unavailable.", {
      errorCode: "TEST_COPY_UNAVAILABLE",
      statusCode: 503,
    });
    const spy = vi
      .spyOn(createRecoveryDocument, "run")
      .mockImplementationOnce(async () => {
        const base = await authoredSaveBase(documentId, "Newer source");
        await updateDocument.run(
          {
            id: documentId,
            content: "Newer source",
            ...base,
            baseTitle: draft.title,
            editorSessionId: draft.editorSessionId,
            editorEditGeneration: 6,
            editorSnapshotTitle: draft.title,
            editorSnapshotContent: "Newer source",
            browserSaveAttemptId: `newer-copy-save-${documentId}`,
            reuseLabels: [],
          },
          { caller: "frontend" } as any,
        );
        throw failure;
      });
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toBe(failure);
    } finally {
      spy.mockRestore();
    }
    const [claim] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, documentId),
          eq(
            schema.documentVersions.operation,
            "claim-preview-draft-save_separately",
          ),
        ),
      );
    expect(JSON.parse(claim.chatContext).status).toBe("claimed");
    expect(
      await documentRowForDraftTest(
        claim.id.replace("draft-claim-", "recovery-"),
      ),
    ).toBeUndefined();
    await expect(
      asUser(OWNER, async () => getDraft.run({ documentId })),
    ).resolves.toMatchObject({
      draft: { content: draft.content, editGeneration: 5 },
    });
    expect(
      await editorSettlement(documentId, draft.editorSessionId),
    ).toMatchObject({ settledGeneration: 6, discardedGeneration: 5 });
    const current = await documentRowForDraftTest(documentId);
    expect(current.content).toBe("Newer source");
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "document_conflict" });
    const recovered = await asUser(OWNER, async () =>
      resolveDraft.run({
        ...request,
        expectedDocumentUpdatedAt: current.updatedAt,
      }),
    );
    expect(recovered).toMatchObject({
      status: "resolved",
      choice: "save_separately",
    });
    expect(
      await documentRowForDraftTest(recovered.createdDocumentId!),
    ).toMatchObject({ content: draft.content });
    expect(await documentRowForDraftTest(documentId)).toEqual(current);
  });

  async function stoppedSeparateCopy(
    stopBeforeCopy = false,
    peerChange: "metadata" | "title" = "metadata",
  ) {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    const draft = {
      ...payload(`Stopped separate body ${documentId}`),
      baseDocumentUpdatedAt: before.updatedAt,
      baseContentHash: `sha256:${createHash("sha256").update(before.content).digest("hex")}`,
      editorSessionId: `stopped-copy-${documentId}`,
      editGeneration: 5,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "save_separately" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: draft.title,
      expectedDraftContent: draft.content,
      expectedDraftBaseTitle: draft.baseTitle,
      expectedDocumentTitle: before.title,
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const settleSpy = stopSettlingEditor(draft.editorSessionId);
    const copySpy = stopBeforeCopy
      ? vi
          .spyOn(createRecoveryDocument, "run")
          .mockRejectedValueOnce(new Error("copy stopped"))
      : null;
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow(stopBeforeCopy ? "copy stopped" : "settlement stopped");
    } finally {
      settleSpy.mockRestore();
      copySpy?.mockRestore();
    }
    const claim = async () => {
      const [row] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.documentId, documentId),
            eq(
              schema.documentVersions.operation,
              "claim-preview-draft-save_separately",
            ),
          ),
        );
      return { id: row.id as string, ...JSON.parse(row.chatContext) };
    };
    // Model a worker that stopped before putting the draft back, as a crash
    // would leave it.
    const { id: claimId, ...stopped } = await claim();
    await getDb()
      .update(schema.documentVersions)
      .set({
        chatContext: JSON.stringify({ ...stopped, status: "processing" }),
      })
      .where(eq(schema.documentVersions.id, claimId));
    await getDb()
      .delete(schema.documentPreviewDrafts)
      .where(eq(schema.documentPreviewDrafts.documentId, documentId));
    await asUser(OWNER, async () =>
      updateDocument.run({
        id: documentId,
        ...(peerChange === "title"
          ? { title: "Peer renamed page" }
          : { description: "Peer metadata" }),
      }),
    );
    const peer = await documentRowForDraftTest(documentId);
    expect(peer.updatedAt).not.toBe(before.updatedAt);
    if (peerChange === "title") expect(peer.title).toBe("Peer renamed page");
    return {
      documentId,
      draft,
      request,
      claim,
      copyId: claimId.replace("draft-claim-", "recovery-"),
      peer,
    };
  }

  it.each([
    ["metadata", "original"],
    ["metadata", "fresh"],
    ["title", "original"],
    ["title", "fresh"],
  ] as const)(
    "finishes a stopped reviewed separate copy after a peer %s change (%s page values)",
    async (peerChange, pageValues) => {
      const s = await stoppedSeparateCopy(false, peerChange);
      expect(await documentRowForDraftTest(s.copyId)).toMatchObject({
        ownerEmail: OWNER,
        title: s.draft.title,
        content: s.draft.content,
      });
      const retry =
        pageValues === "original"
          ? s.request
          : {
              ...s.request,
              expectedDocumentTitle: s.peer.title,
              expectedDocumentUpdatedAt: s.peer.updatedAt,
            };
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...retry, trigger: "automatic" }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
        choice: "save_separately",
      });
      expect(await s.claim()).toMatchObject({ status: "processing" });

      await expect(
        asUser(OWNER, async () => resolveDraft.run(retry)),
      ).resolves.toMatchObject({
        status: "resolved",
        choice: "save_separately",
        createdDocumentId: s.copyId,
        urlPath: `/page/${s.copyId}`,
      });
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.peer);
      expect(await s.claim()).toMatchObject({ status: "resolved" });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toBeNull();
      expect(
        await getDb()
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(eq(schema.documents.content, s.draft.content)),
      ).toEqual([{ id: s.copyId }]);

      const base = await authoredSaveBase(s.documentId, s.draft.content);
      await asUser(OWNER, async () =>
        updateDocument.run(
          {
            id: s.documentId,
            content: s.draft.content,
            ...base,
            editorSessionId: s.draft.editorSessionId,
            editorEditGeneration: 5,
            editorSnapshotTitle: s.draft.title,
            editorSnapshotContent: s.draft.content,
            browserSaveAttemptId: `stopped-copy-late-${s.documentId}`,
            reuseLabels: [],
          },
          { caller: "frontend" } as any,
        ),
      );
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.peer);
    },
  );

  it.each(["not created", "edited", "owned by another user"] as const)(
    "keeps a stopped separate copy pending after a peer change when its copy is %s",
    async (copyState) => {
      const s = await stoppedSeparateCopy(copyState === "not created");
      if (copyState === "edited")
        await getDb()
          .update(schema.documents)
          .set({ content: "Edited copy" })
          .where(eq(schema.documents.id, s.copyId));
      if (copyState === "owned by another user")
        await getDb()
          .update(schema.documents)
          .set({ ownerEmail: COLLABORATOR })
          .where(eq(schema.documents.id, s.copyId));
      const copy = await documentRowForDraftTest(s.copyId);
      await expect(
        asUser(OWNER, async () => resolveDraft.run(s.request)),
      ).resolves.toMatchObject({ status: "document_conflict" });
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.peer);
      expect(await documentRowForDraftTest(s.copyId)).toEqual(copy);
      expect(await s.claim()).toMatchObject({ status: "processing" });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: 5 });
    },
  );

  it.each(["not created", "edited", "owned by another user"] as const)(
    "keeps a stopped separate copy refused after a peer rename when its copy is %s",
    async (copyState) => {
      const s = await stoppedSeparateCopy(copyState === "not created", "title");
      if (copyState === "edited")
        await getDb()
          .update(schema.documents)
          .set({ content: "Edited copy" })
          .where(eq(schema.documents.id, s.copyId));
      if (copyState === "owned by another user")
        await getDb()
          .update(schema.documents)
          .set({ ownerEmail: COLLABORATOR })
          .where(eq(schema.documents.id, s.copyId));
      const copy = await documentRowForDraftTest(s.copyId);
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request,
            expectedDocumentTitle: s.peer.title,
            expectedDocumentUpdatedAt: s.peer.updatedAt,
          }),
        ),
      ).rejects.toThrow("The reviewed page title changed during recovery.");
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.peer);
      expect(await documentRowForDraftTest(s.copyId)).toEqual(copy);
      expect(await s.claim()).toMatchObject({ status: "processing" });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: -1, discardedGeneration: 5 });
    },
  );

  it("keeps a stopped Keep mine refused when its retry carries a peer's new title", async () => {
    const documentId = await createDocument();
    const draft = {
      ...payload(`Stopped kept body ${documentId}`),
      editorSessionId: `stopped-keep-${documentId}`,
      editGeneration: 4,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: draft.title,
      expectedDraftContent: draft.content,
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    const settleSpy = stopSettlingEditor(draft.editorSessionId);
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("settlement stopped");
    } finally {
      settleSpy.mockRestore();
    }
    const claim = async () => {
      const [row] = await getDb()
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
      return { id: row.id as string, ...JSON.parse(row.chatContext) };
    };
    const { id: claimId, ...stopped } = await claim();
    await getDb()
      .update(schema.documentVersions)
      .set({
        chatContext: JSON.stringify({ ...stopped, status: "processing" }),
      })
      .where(eq(schema.documentVersions.id, claimId));
    await getDb()
      .delete(schema.documentPreviewDrafts)
      .where(eq(schema.documentPreviewDrafts.documentId, documentId));
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Peer renamed page" }),
    );
    const peer = await documentRowForDraftTest(documentId);

    // A reviewed Keep mine resumes its own claim from any page version, so
    // both retries reach the claim's title check.
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({ ...request, expectedDocumentTitle: peer.title }),
      ),
    ).rejects.toThrow("The reviewed page title changed during recovery.");
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          ...request,
          expectedDocumentTitle: peer.title,
          expectedDocumentUpdatedAt: peer.updatedAt,
        }),
      ),
    ).rejects.toThrow("The reviewed page title changed during recovery.");
    expect(await documentRowForDraftTest(documentId)).toEqual(peer);
    expect(await claim()).toMatchObject({ status: "processing" });
  });

  async function resolvedClaimBesideRetainedDraft(
    claimShape: "legacy" | "historical" | "current",
    retained: "consumed" | "same body" | "another body",
    baseTitle: string | null = "Builder row",
  ) {
    const documentId = await createDocument();
    const draft = {
      ...payload(`Claimed body ${documentId}`),
      baseTitle,
      editorSessionId: `resolved-claim-${documentId}`,
      editGeneration: 5,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const drafts = () =>
      getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
    const [original] = await drafts();
    const request = {
      trigger: "reviewed" as const,
      choice: "use_saved" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: draft.title,
      expectedDraftContent: draft.content,
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved" });
    const claim = async () => {
      const [row] = await getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.documentId, documentId),
            eq(schema.documentVersions.operation, "use-saved-preview-draft"),
          ),
        );
      return row;
    };
    const { id: claimId, chatContext } = await claim();
    const { draftVersion, ...legacy } = JSON.parse(chatContext);
    // Model a choice resolved before claims fenced their generation or
    // recorded their version, beside the draft row it consumed.
    if (claimShape !== "current")
      await getDb()
        .update(schema.documentVersions)
        .set({
          chatContext: JSON.stringify(legacy),
          ...(claimShape === "historical"
            ? { id: await legacyClaimId(request) }
            : {}),
        })
        .where(eq(schema.documentVersions.id, claimId));
    await getDb()
      .update(schema.documentPreviewDraftSettlements)
      .set({ settledGeneration: -1, discardedGeneration: null })
      .where(
        eq(
          schema.documentPreviewDraftSettlements.editorSessionId,
          draft.editorSessionId,
        ),
      );
    await getDb().insert(schema.documentPreviewDrafts).values(original);
    if (retained !== "consumed")
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: 1,
            expectedDraftId: original.id,
            draft: {
              ...draft,
              content:
                retained === "same body"
                  ? draft.content
                  : "Retained version two",
            },
          }),
        ),
      ).resolves.toMatchObject({ status: "saved", draft: { version: 2 } });
    const claims = () =>
      getDb()
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.ownerEmail, OWNER),
            eq(
              schema.documentVersions.groupId,
              `draft-recovery:${original.id}`,
            ),
          ),
        )
        .orderBy(schema.documentVersions.createdAt);
    return { documentId, draft, request, drafts, claim, claims, draftVersion };
  }

  it.each(
    (["legacy", "historical", "current"] as const).flatMap((claimShape) =>
      (["same body", "another body"] as const).flatMap((retained) =>
        (["reviewed", "automatic"] as const)
          // A reviewed choice about the retained version itself starts its own claim.
          .filter(
            (trigger) => retained !== "same body" || trigger !== "reviewed",
          )
          .map((trigger) => ({ claimShape, retained, trigger })),
      ),
    ),
  )(
    "refuses a $trigger resolved $claimShape claim's retry for a later draft version with $retained before any effect",
    async ({ claimShape, retained, trigger }) => {
      const s = await resolvedClaimBesideRetainedDraft(claimShape, retained);
      const rows = await s.drafts();
      const claimsBefore = await s.claims();
      const settlementBefore = await editorSettlement(
        s.documentId,
        s.draft.editorSessionId,
      );

      // These retries used to return resolved because the claim was found
      // through its draft's recovery group alone: the chooser then marked
      // version 2 settled while it stayed in SQL behind a skeleton.
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request,
            trigger,
            expectedDraftVersion: 2,
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
        // Version 2 holds other text, so this request names no retained draft.
        message:
          claimShape === "current" &&
          retained === "another body" &&
          trigger === "reviewed"
            ? "The saved draft changed during recovery."
            : "This recovery choice was made for another version of the draft.",
      });
      expect(await s.drafts()).toEqual(rows);
      expect(
        (
          await asUser(OWNER, async () =>
            getDraft.run({ documentId: s.documentId }),
          )
        ).draft,
      ).toMatchObject({
        version: 2,
        content:
          retained === "same body" ? s.draft.content : "Retained version two",
      });
      expect(await s.claims()).toEqual(claimsBefore);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toEqual(settlementBefore);
      if (claimShape === "current") expect(s.draftVersion).toBe(1);
    },
  );

  it.each(
    (["legacy", "historical", "current"] as const).flatMap((claimShape) =>
      (["use_saved", "save_separately"] as const).map((choice) => ({
        claimShape,
        choice,
      })),
    ),
  )(
    "completes a reviewed $choice for a later same-text draft through its own claim beside a $claimShape claim",
    async ({ claimShape, choice }) => {
      const s = await resolvedClaimBesideRetainedDraft(
        claimShape,
        "same body",
        null,
      );
      await getDb()
        .update(schema.documents)
        .set({
          title: "Peer title Y",
          content: "Peer body Y",
          updatedAt: "2099-01-01T00:00:00.000Z",
        })
        .where(eq(schema.documents.id, s.documentId));
      const page = await documentRowForDraftTest(s.documentId);
      const [earlierClaim] = await s.claims();
      const [retained] = await s.drafts();
      expect(retained).toMatchObject({ version: 2, baseTitle: null });
      expect(s.draftVersion).toBe(1);
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId: s.documentId,
        ...expectedPreviewDraftIdentity(retained),
        expectedDraftVersion: 2,
        expectedDraftTitle: retained.title,
        expectedDraftContent: retained.content,
        expectedDraftBaseTitle: null,
        expectedDocumentTitle: page.title,
        expectedDocumentUpdatedAt: page.updatedAt,
      };
      const copies = () =>
        getDb()
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.ownerEmail, OWNER),
              eq(schema.documents.title, retained.title),
              eq(schema.documents.content, retained.content),
            ),
          );

      const result = await asUser(OWNER, async () => resolveDraft.run(request));

      expect(result).toMatchObject({ status: "resolved", choice });
      expect(await s.drafts()).toEqual([]);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(page);
      const resolvedClaims = await s.claims();
      expect(resolvedClaims).toHaveLength(2);
      const [first, laterClaim] = resolvedClaims;
      expect(first).toEqual(earlierClaim);
      expect(laterClaim).toMatchObject({
        title: retained.title,
        content: retained.content,
        documentId: s.documentId,
        operation:
          choice === "use_saved"
            ? "use-saved-preview-draft"
            : "claim-preview-draft-save_separately",
      });
      expect(laterClaim.id).not.toBe(earlierClaim.id);
      expect(JSON.parse(laterClaim.chatContext!)).toMatchObject({
        choice,
        status: "resolved",
        draftId: retained.id,
        draftVersion: 2,
        baseTitle: null,
        editorSessionId: s.draft.editorSessionId,
        editGeneration: 5,
        expectedDocumentUpdatedAt: page.updatedAt,
      });
      const copyId = `recovery-${laterClaim.id.slice("draft-claim-".length)}`;
      expect((await copies()).map(({ id }) => id)).toEqual(
        choice === "save_separately" ? [copyId] : [],
      );
      if (choice === "save_separately")
        expect(result).toMatchObject({ createdDocumentId: copyId });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });

      // Neither the same request nor one reviewed against a later peer
      // timestamp makes another claim or copy.
      const copiesAfter = await copies();
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await getDb()
        .update(schema.documents)
        .set({ updatedAt: "2099-01-02T00:00:00.000Z" })
        .where(eq(schema.documents.id, s.documentId));
      const laterPage = await documentRowForDraftTest(s.documentId);
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...request,
            expectedDocumentUpdatedAt: laterPage.updatedAt,
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...request,
            choice: choice === "use_saved" ? "save_separately" : "use_saved",
          }),
        ),
      ).rejects.toThrow("This draft was already resolved with another choice.");
      expect(await s.claims()).toEqual(resolvedClaims);
      expect(await copies()).toEqual(copiesAfter);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(laterPage);
    },
  );

  it.each(
    (["legacy", "historical", "current"] as const).flatMap((claimShape) =>
      (["same body", "another body"] as const).flatMap((retained) =>
        (["reviewed", "automatic"] as const).map((trigger) => ({
          claimShape,
          retained,
          trigger,
        })),
      ),
    ),
  )(
    "refuses a $trigger resolved $claimShape claim's own retry while its generation holds a later draft with $retained",
    async ({ claimShape, retained, trigger }) => {
      const s = await resolvedClaimBesideRetainedDraft(claimShape, retained);
      const rows = await s.drafts();
      const claimsBefore = await s.claims();
      const settlementBefore = await editorSettlement(
        s.documentId,
        s.draft.editorSessionId,
      );

      // Settling version 1 again would fence the generation version 2
      // still holds, though only the version 1 row would be deleted.
      await expect(
        asUser(OWNER, async () => resolveDraft.run({ ...s.request, trigger })),
      ).rejects.toMatchObject({
        errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
        message: "The saved draft changed during recovery.",
      });
      expect(await s.drafts()).toEqual(rows);
      expect(rows).toMatchObject([{ version: 2 }]);
      expect(await s.claims()).toEqual(claimsBefore);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toEqual(settlementBefore);
    },
  );

  it.each(["reviewed", "automatic"] as const)(
    "finishes a %s resolved claim's own retry when its generation is already fenced over a later draft",
    async (trigger) => {
      const s = await resolvedClaimBesideRetainedDraft("current", "same body");
      await getDb()
        .update(schema.documentPreviewDraftSettlements)
        .set({ settledGeneration: 5, discardedGeneration: 5 })
        .where(
          eq(
            schema.documentPreviewDraftSettlements.editorSessionId,
            s.draft.editorSessionId,
          ),
        );
      const rows = await s.drafts();
      const claimsBefore = await s.claims();

      await expect(
        asUser(OWNER, async () => resolveDraft.run({ ...s.request, trigger })),
      ).resolves.toMatchObject(
        trigger === "reviewed"
          ? { status: "resolved", choice: "use_saved" }
          : {
              status: "recovery_required",
              reason: "prior_choice",
              choice: "use_saved",
            },
      );
      expect(await s.drafts()).toEqual(rows);
      expect(await s.claims()).toEqual(claimsBefore);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
    },
  );

  it.each(["exact", "later page"] as const)(
    "finishes a resolved claim's %s retry behind a later claim on another version",
    async (page) => {
      const s = await resolvedClaimBesideRetainedDraft("current", "consumed");
      const [earlierClaim] = await s.claims();
      const earlierPayload = JSON.parse(earlierClaim.chatContext!);
      await getDb()
        .insert(schema.documentVersions)
        .values({
          ...earlierClaim,
          id: `draft-claim-later-${s.documentId}`,
          chatContext: JSON.stringify({ ...earlierPayload, draftVersion: 2 }),
          createdAt: "2099-01-01T00:00:00.000Z",
          updatedAt: "2099-01-01T00:00:00.000Z",
        });
      if (page === "later page")
        await getDb()
          .update(schema.documents)
          .set({ updatedAt: "2099-01-02T00:00:00.000Z" })
          .where(eq(schema.documents.id, s.documentId));
      const claimsBefore = await s.claims();

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request,
            expectedDocumentUpdatedAt: (
              await documentRowForDraftTest(s.documentId)
            ).updatedAt,
          }),
        ),
      ).resolves.toMatchObject({ status: "resolved", choice: "use_saved" });
      expect(await s.drafts()).toEqual([]);
      expect(await s.claims()).toEqual(claimsBefore);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
    },
  );

  it.each(["legacy", "historical", "current"] as const)(
    "finishes a resolved %s claim's retry for the draft version it consumed",
    async (claimShape) => {
      const s = await resolvedClaimBesideRetainedDraft(claimShape, "consumed");
      const claimBefore = await s.claim();

      await expect(
        asUser(OWNER, async () => resolveDraft.run(s.request)),
      ).resolves.toMatchObject({ status: "resolved", choice: "use_saved" });
      expect(await s.drafts()).toEqual([]);
      expect(await s.claim()).toEqual(claimBefore);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });
    },
  );

  it("keeps a peer rename when recovering a body-only draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Peer rename" }),
    );
    const reviewed = await documentRowForDraftTest(documentId);
    const request = {
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDraftBaseTitle: "Builder row",
      expectedDocumentTitle: "Peer rename",
      expectedDocumentUpdatedAt: reviewed.updatedAt,
    };
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved" });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      title: "Peer rename",
      content: "Local recovery",
    });
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved" });
  });

  it("recovers a known authored title after reviewing a peer title", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Authored body"), title: "Authored title" },
      }),
    );
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Peer title" }),
    );
    const reviewed = await documentRowForDraftTest(documentId);
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: "Authored title",
          expectedDraftContent: "Authored body",
          expectedDraftBaseTitle: "Builder row",
          expectedDocumentTitle: reviewed.title,
          expectedDocumentUpdatedAt: reviewed.updatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved" });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      title: "Authored title",
      content: "Authored body",
    });
  });

  it.each([null, undefined])(
    "refuses unknown title intent (%s) without consuming the draft",
    async (baseTitle) => {
      const documentId = await createDocument();
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: { ...payload("Legacy body"), baseTitle },
        }),
      );
      const before = await documentRowForDraftTest(documentId);
      const draftBefore = (
        await asUser(OWNER, async () => getDraft.run({ documentId }))
      ).draft;
      expect(draftBefore?.baseTitle).toBeNull();
      const request = {
        trigger: "reviewed" as const,
        choice: "keep_mine" as const,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Legacy body",
        expectedDraftBaseTitle: null,
        expectedDocumentTitle: before.title,
        expectedDocumentUpdatedAt: before.updatedAt,
      };
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toMatchObject({
        errorCode: "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN",
      });
      expect(await documentRowForDraftTest(documentId)).toEqual(before);
      expect(
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
      ).toEqual(draftBefore);
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId)),
      ).toEqual([]);
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({ ...request, choice: "use_saved" }),
        ),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.documentId, documentId)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ content: "Legacy body" }),
        ]),
      );
    },
  );

  it.each(["reviewed title", "title base"])(
    "rejects a stale %s without consuming lineage",
    async (stale) => {
      const documentId = await createDocument();
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: payload("Local recovery"),
        }),
      );
      const before = await documentRowForDraftTest(documentId);
      const request = {
        trigger: "reviewed" as const,
        choice: "keep_mine" as const,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDraftBaseTitle:
          stale === "title base" ? "Other base" : "Builder row",
        expectedDocumentTitle:
          stale === "reviewed title" ? "Other review" : before.title,
        expectedDocumentUpdatedAt: before.updatedAt,
      };
      if (stale === "title base")
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).rejects.toMatchObject({
          errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
        });
      else
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({ status: "document_conflict" });
      expect(await documentRowForDraftTest(documentId)).toEqual(before);
      expect(
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
      ).toMatchObject({ baseTitle: "Builder row", content: "Local recovery" });
    },
  );

  it.each([false, true])(
    "restores and retries the original title lineage without an exact draft (%s identityless)",
    async (identityless) => {
      const documentId = await createDocument();
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: {
            ...payload("Retry body"),
            ...(identityless
              ? {}
              : {
                  editorSessionId: `lineage-${documentId}`,
                  editGeneration: 4,
                }),
          },
        }),
      );
      await asUser(OWNER, async () =>
        updateDocument.run({ id: documentId, title: "Peer title" }),
      );
      const reviewed = await documentRowForDraftTest(documentId);
      const request = {
        trigger: "reviewed" as const,
        choice: "keep_mine" as const,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Retry body",
        expectedDraftBaseTitle: "Builder row",
        expectedDocumentTitle: reviewed.title,
        expectedDocumentUpdatedAt: reviewed.updatedAt,
      };
      const stopped = vi
        .spyOn(updateDocument, "run")
        .mockRejectedValueOnce(new Error("lineage retry stopped"));
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("lineage retry stopped");
      stopped.mockRestore();
      expect(
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
      ).toMatchObject({
        baseTitle: "Builder row",
        title: "Builder row",
        content: "Retry body",
      });
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
        baseTitle: "Builder row",
        reviewedDocumentTitle: "Peer title",
        status: "claimed",
      });
      await getDb()
        .delete(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved" });
      expect(await documentRowForDraftTest(documentId)).toMatchObject({
        title: "Peer title",
        content: "Retry body",
      });
    },
  );

  it.each(["no_op", "already_applied", "winner"] as const)(
    "uses the reviewed body-only title for the %s check",
    async (boundary) => {
      const documentId = await createDocument();
      const content = boundary === "no_op" ? "Server body" : "Local recovery";
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: payload(content),
        }),
      );
      await asUser(OWNER, async () =>
        updateDocument.run({ id: documentId, title: "Peer title" }),
      );
      const reviewed = await documentRowForDraftTest(documentId);
      const request = {
        trigger: "reviewed" as const,
        choice: "keep_mine" as const,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: content,
        expectedDraftBaseTitle: "Builder row",
        expectedDocumentTitle: reviewed.title,
        expectedDocumentUpdatedAt: reviewed.updatedAt,
      };
      let restore = () => {};
      if (boundary === "winner") {
        const original = updateDocument.run;
        const spy = vi
          .spyOn(updateDocument, "run")
          .mockImplementationOnce(async (...args) => {
            await original(...args);
            return {
              conflict: true,
              document: await documentRowForDraftTest(documentId),
            } as any;
          });
        restore = () => spy.mockRestore();
      } else if (boundary === "already_applied") {
        const spy = vi
          .spyOn(settlement, "settlePreviewDocumentDraft")
          .mockRejectedValueOnce(new Error("mark stopped"));
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).rejects.toThrow("mark stopped");
        spy.mockRestore();
        await getDb()
          .delete(schema.documentPreviewDrafts)
          .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      }
      try {
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({ status: "resolved" });
      } finally {
        restore();
      }
      expect(await documentRowForDraftTest(documentId)).toMatchObject({
        title: "Peer title",
        content,
        bodyRevision: boundary === "no_op" ? 0 : 1,
      });
    },
  );

  it("refuses an interrupted legacy claim whose title lineage is absent", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("Legacy claim body"),
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Legacy claim body",
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    const stop = vi
      .spyOn(updateDocument, "run")
      .mockRejectedValueOnce(new Error("legacy stopped"));
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).rejects.toThrow("legacy stopped");
    stop.mockRestore();
    const [claim] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, documentId));
    const legacy = JSON.parse(claim.chatContext);
    delete legacy.baseTitle;
    delete legacy.reviewedDocumentTitle;
    await getDb()
      .update(schema.documentVersions)
      .set({ chatContext: JSON.stringify(legacy) })
      .where(eq(schema.documentVersions.id, claim.id));
    const before = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft;
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).rejects.toMatchObject({
      errorCode: "PREVIEW_DRAFT_TITLE_INTENT_UNKNOWN",
    });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toEqual(before);
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      title: "Builder row",
      content: "Server body",
    });
    expect(
      (
        await getDb()
          .select()
          .from(schema.documentVersions)
          .where(eq(schema.documentVersions.id, claim.id))
      )[0].chatContext,
    ).toBe(JSON.stringify(legacy));
  });

  it("preserves a newer generation while retrying the claimed body-only draft", async () => {
    const documentId = await createDocument();
    const editorSessionId = `title-newer-${documentId}`;
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Old recovery"),
          editorSessionId,
          editGeneration: 4,
        },
      }),
    );
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Peer title" }),
    );
    const reviewed = await documentRowForDraftTest(documentId);
    const request = {
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftBaseTitle: "Builder row",
      expectedDraftContent: "Old recovery",
      expectedDocumentTitle: reviewed.title,
      expectedDocumentUpdatedAt: reviewed.updatedAt,
    };
    const stop = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async () => {
        await asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft: {
              ...payload("New recovery"),
              editorSessionId,
              editGeneration: 5,
            },
          }),
        );
        throw new Error("newer retained");
      });
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).rejects.toThrow("newer draft replaced");
    stop.mockRestore();
    const newer = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft;
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
          processingStartedAt: "2000-01-01T00:00:00.000Z",
        }),
      })
      .where(eq(schema.documentVersions.id, claim.id));
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved" });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toEqual(newer);
    expect(newer).toMatchObject({
      content: "New recovery",
      baseTitle: "Builder row",
      editGeneration: 5,
    });
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      title: "Peer title",
      content: "Old recovery",
    });
  });

  it("includes the title base when comparing an exact draft deletion", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("Delete candidate"),
      }),
    );
    const deletion = {
      operation: "delete" as const,
      documentId,
      expectedDraftId: (await selectedDraftIdentity(documentId))
        .expectedDraftId,
      expectedVersion: 1,
      expectedTitle: "Builder row",
      expectedContent: "Delete candidate",
    };
    await expect(
      asUser(OWNER, async () =>
        updateDraft.run({ ...deletion, expectedBaseTitle: null }),
      ),
    ).resolves.toMatchObject({
      status: "conflict",
      draft: { baseTitle: "Builder row" },
    });
    await expect(
      asUser(OWNER, async () =>
        updateDraft.run({ ...deletion, expectedBaseTitle: "Builder row" }),
      ),
    ).resolves.toMatchObject({ status: "deleted", draft: null });
  });

  it("restores the originating lineage when a peer renames after the recovery claim", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("Local recovery"),
      }),
    );
    await asUser(OWNER, async () =>
      updateDocument.run({ id: documentId, title: "Reviewed peer title" }),
    );
    const reviewed = await documentRowForDraftTest(documentId);
    const original = updateDocument.run;
    const spy = vi
      .spyOn(updateDocument, "run")
      .mockImplementationOnce(async (...args) => {
        await original({ id: documentId, title: "Newer peer title" });
        return original(...args);
      });
    try {
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            trigger: "reviewed",
            choice: "keep_mine",
            documentId,
            ...(await selectedDraftIdentity(documentId)),
            expectedDraftVersion: 1,
            expectedDraftTitle: "Builder row",
            expectedDraftBaseTitle: "Builder row",
            expectedDraftContent: "Local recovery",
            expectedDocumentTitle: reviewed.title,
            expectedDocumentUpdatedAt: reviewed.updatedAt,
          }),
        ),
      ).resolves.toMatchObject({ status: "document_conflict" });
    } finally {
      spy.mockRestore();
    }
    expect(await documentRowForDraftTest(documentId)).toMatchObject({
      title: "Newer peer title",
      content: "Server body",
    });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({
      title: "Builder row",
      baseTitle: "Builder row",
      content: "Local recovery",
    });
  });

  it("applies Keep mine with a recorded authored body intent", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );

    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
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
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toMatchObject({ status: "document_conflict" });
    updateSpy.mockRestore();
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
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
    await asUser(OWNER, async () =>
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
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const first = asUser(OWNER, async () => resolveDraft.run(request));
    await startedPromise;
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
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
    await asUser(OWNER, async () =>
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
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
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
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
  });

  it("keeps the draft's body hash when a retried claim puts the draft back", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const baseContentHash = `sha256:${"a".repeat(64)}`;
    await asUser(OWNER, async () =>
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
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
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
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("retry stopped");
    } finally {
      updateSpy.mockRestore();
    }
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "use_saved" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Discarded local body",
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    const settleSpy = stopSettlingEditor(draft.editorSessionId);
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("settlement stopped");
    } finally {
      settleSpy.mockRestore();
    }

    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toEqual({ status: "resolved", choice: "use_saved" });
    await expect(
      asUser(OWNER, async () =>
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
    const delayed = await asUser(OWNER, async () =>
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
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      };
      const settleSpy = stopSettlingEditor(draft.editorSessionId);
      try {
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
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
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, async () =>
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

  it("does not restore a draft whose separate copy landed before its settlement failed", async () => {
    const documentId = await createDocument();
    const draft = {
      ...payload("Separate local body"),
      deferredReason: "conflict" as const,
      editorSessionId: "separate-settle-tab",
      editGeneration: 4,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft,
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "save_separately" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Separate local body",
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    // Only the first settlement fails, so the restore that follows can settle.
    const settle = settlement.settlePreviewDocumentDraft;
    let failed = false;
    const settleSpy = vi
      .spyOn(settlement, "settlePreviewDocumentDraft")
      .mockImplementation(async (input) => {
        if (!failed && input.editorSessionId === draft.editorSessionId) {
          failed = true;
          throw new Error("settlement stopped once");
        }
        return settle(input);
      });
    try {
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).rejects.toThrow("settlement stopped once");
    } finally {
      settleSpy.mockRestore();
    }

    const [claim] = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.documentId, documentId),
          eq(
            schema.documentVersions.operation,
            "claim-preview-draft-save_separately",
          ),
        ),
      );
    expect(JSON.parse(claim.chatContext!)).toMatchObject({
      choice: "save_separately",
      status: "resolved",
    });
    const copyId = `recovery-${claim.id.slice("draft-claim-".length)}`;
    const [copy] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, copyId));
    expect(copy).toMatchObject({
      ownerEmail: OWNER,
      title: "Builder row",
      content: "Separate local body",
    });
    expect(
      await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId)),
    ).toEqual([]);

    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({
      status: "resolved",
      choice: "save_separately",
      createdDocumentId: copyId,
    });
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({ ...request, choice: "use_saved" }),
      ),
    ).rejects.toThrow("This draft was already resolved with another choice.");
    expect((await documentRowForDraftTest(documentId)).content).toBe(
      "Server body",
    );
  });

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
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).rejects.toThrow("settlement stopped");
      } finally {
        settleSpy.mockRestore();
      }
      // Resolvers before this fix could mark a retried claim resolved without
      // settling it, and those claims are still in the database.
      await getDb()
        .update(schema.documentPreviewDraftSettlements)
        .set({ settledGeneration: -1, discardedGeneration: null })
        .where(
          eq(schema.documentPreviewDraftSettlements.documentId, documentId),
        );
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
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            expectedVersion: null,
            draft,
          }),
        ),
      ).resolves.toEqual({ status: "superseded", draft: null });
      if (choice === "keep_mine") return;
      const delayed = await asUser(OWNER, async () =>
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

  it.each(["use_saved", "keep_mine", "save_separately"] as const)(
    "preserves an identity-less exact draft on resolved %s retry after the page advances",
    async (choice) => {
      const documentId = await createDocument();
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft: { ...payload("Local recovery"), deferredReason: "conflict" },
        }),
      );
      const [originalDraft] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      expect(originalDraft).toMatchObject({
        editorSessionId: null,
        editGeneration: null,
      });
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: originalDraft.version,
        expectedDraftTitle: originalDraft.title,
        expectedDraftContent: originalDraft.content,
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      };
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await getDb()
        .update(schema.documents)
        .set({
          title: "Peer revision",
          content: "Peer body",
          updatedAt: "2099-01-01T00:00:00.000Z",
        })
        .where(eq(schema.documents.id, documentId));
      const advancedDocument = await documentRowForDraftTest(documentId);
      // Historical resolved claims can coexist with their exact original draft.
      await getDb().insert(schema.documentPreviewDrafts).values(originalDraft);

      const retry = await asUser(OWNER, async () => resolveDraft.run(request));
      const remainingDrafts = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      expect({ retry, remainingDrafts }).toEqual({
        retry: { status: "document_conflict", document: advancedDocument },
        remainingDrafts: [originalDraft],
      });
      expect(await documentRowForDraftTest(documentId)).toEqual(
        advancedDocument,
      );

      await getDb()
        .delete(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.id, originalDraft.id));
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      expect(await documentRowForDraftTest(documentId)).toEqual(
        advancedDocument,
      );
    },
  );

  it.each(
    (["use_saved", "keep_mine", "save_separately"] as const).flatMap((choice) =>
      [false, true].flatMap((legacy) =>
        [false, true].map((exactDraft) => ({ choice, legacy, exactDraft })),
      ),
    ),
  )(
    "fences resolved $choice before releasing the page lock (legacy=$legacy, exactDraft=$exactDraft)",
    async ({ choice, legacy, exactDraft }) => {
      const documentId = await createDocument();
      const draft = {
        ...payload("Local recovery"),
        deferredReason: "conflict" as const,
        editorSessionId: `gap-${documentId}`,
        editGeneration: 5,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const [originalDraft] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const request = {
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      };
      await asUser(OWNER, async () => resolveDraft.run(request));
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
      expect(JSON.parse(claim.chatContext).status).toBe("resolved");
      if (legacy) {
        const id = await legacyClaimId(request);
        if (choice === "save_separately") {
          await getDb()
            .update(schema.documents)
            .set({ id: id.replace("draft-claim-", "recovery-") })
            .where(
              eq(
                schema.documents.id,
                claim.id.replace("draft-claim-", "recovery-"),
              ),
            );
        }
        await getDb()
          .update(schema.documentVersions)
          .set({ id })
          .where(eq(schema.documentVersions.id, claim.id));
      }
      // Recreate a historical resolver's resolved claim without its fence.
      await getDb()
        .update(schema.documentPreviewDraftSettlements)
        .set({ settledGeneration: -1, discardedGeneration: null })
        .where(
          eq(schema.documentPreviewDraftSettlements.documentId, documentId),
        );
      if (exactDraft) {
        await getDb()
          .update(schema.documents)
          .set({ updatedAt: request.expectedDocumentUpdatedAt })
          .where(eq(schema.documents.id, documentId));
        await getDb()
          .insert(schema.documentPreviewDrafts)
          .values(originalDraft);
        const settle = settlement.settlePreviewDocumentDraft;
        const stop = vi
          .spyOn(settlement, "settlePreviewDocumentDraft")
          .mockImplementationOnce(async (input) => {
            await settle(input);
            throw new Error("stop after fence before commit");
          });
        try {
          await expect(
            asUser(OWNER, async () => resolveDraft.run(request)),
          ).rejects.toThrow("stop after fence before commit");
        } finally {
          stop.mockRestore();
        }
        expect(
          await getDb()
            .select()
            .from(schema.documentPreviewDrafts)
            .where(eq(schema.documentPreviewDrafts.documentId, documentId)),
        ).toEqual([originalDraft]);
        expect(
          await getDb()
            .select()
            .from(schema.documentPreviewDraftSettlements)
            .where(
              and(
                eq(
                  schema.documentPreviewDraftSettlements.documentId,
                  documentId,
                ),
                eq(
                  schema.documentPreviewDraftSettlements.editorSessionId,
                  draft.editorSessionId,
                ),
              ),
            ),
        ).toEqual([
          expect.objectContaining({
            settledGeneration: -1,
            discardedGeneration: null,
          }),
        ]);
      }
      const before = await documentRowForDraftTest(documentId);
      const saveBase = await authoredSaveBase(documentId, draft.content);
      const db = getDb();
      let injected = false;
      let delayed: unknown;
      const queries: string[] = [];
      const transactionSpy = spyOnTransaction(db, async (fn, transaction) => {
        const result = await transaction((tx: any) =>
          fn(injected ? tx : traceDraftTransaction(tx, queries)),
        );
        if (!injected) {
          // This is after claimExactDraft commits, before its caller resumes
          // and can start the old split settlement transaction.
          injected = true;
          delayed = await asUser(OWNER, async () =>
            choice !== "keep_mine"
              ? updateDocument.run(
                  {
                    id: documentId,
                    content: draft.content,
                    ...saveBase,
                    baseTitle: before.title,
                    editorSessionId: draft.editorSessionId,
                    editorEditGeneration: draft.editGeneration,
                    editorSnapshotTitle: draft.title,
                    editorSnapshotContent: draft.content,
                    browserSaveAttemptId: `gap-save-${documentId}`,
                    reuseLabels: [],
                  },
                  { caller: "frontend" } as any,
                )
              : updateDraft.run({
                  operation: "upsert",
                  documentId,
                  expectedVersion: null,
                  draft,
                }),
          );
        }
        return result;
      });
      try {
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({ status: "resolved", choice });
      } finally {
        transactionSpy.mockRestore();
      }
      expect(injected).toBe(true);
      expect(delayed).toMatchObject(
        choice !== "keep_mine"
          ? { superseded: true, discardedGeneration: draft.editGeneration }
          : { status: "superseded", draft: null },
      );
      expect((await documentRowForDraftTest(documentId)).content).toBe(
        before.content,
      );
      const pageLock = queries.findIndex(
        (query) =>
          query.includes('from "documents"') && query.includes("for update"),
      );
      const claimLock = queries.findIndex(
        (query) =>
          query.includes('from "document_versions"') &&
          query.includes("for update"),
      );
      const settlementLock = queries.findIndex(
        (query) =>
          query.includes('from "document_preview_draft_settlements"') &&
          query.includes("for update"),
      );
      const firstDraftWrite = queries.findIndex(
        (query) =>
          query.startsWith('delete from "document_preview_drafts"') ||
          (query.includes('from "document_preview_drafts"') &&
            query.includes("for update")),
      );
      expect(pageLock).toBeGreaterThanOrEqual(0);
      expect(claimLock).toBeGreaterThan(pageLock);
      expect(settlementLock).toBeGreaterThan(claimLock);
      expect(firstDraftWrite).toBeGreaterThan(settlementLock);
      await expect(
        asUser(OWNER, async () => resolveDraft.run(request)),
      ).resolves.toMatchObject({ status: "resolved", choice });
      await expect(
        asUser(OWNER, async () => getDraft.run({ documentId })),
      ).resolves.toMatchObject({ draft: null });
      if (!legacy && !exactDraft) {
        for (const replacement of [
          { ...draft, editGeneration: draft.editGeneration + 1 },
          { ...draft, editorSessionId: `${draft.editorSessionId}-other` },
        ]) {
          const retained = await asUser(OWNER, async () =>
            updateDraft.run({
              operation: "upsert",
              documentId,
              expectedVersion: null,
              draft: replacement,
            }),
          );
          expect(retained.status).toBe("saved");
          await getDb()
            .update(schema.documentPreviewDraftSettlements)
            .set({ settledGeneration: -1, discardedGeneration: null })
            .where(
              eq(schema.documentPreviewDraftSettlements.documentId, documentId),
            );
          await expect(
            asUser(OWNER, async () => resolveDraft.run(request)),
          ).resolves.toMatchObject({ status: "resolved", choice });
          await expect(
            asUser(OWNER, async () => getDraft.run({ documentId })),
          ).resolves.toMatchObject({ draft: retained.draft });
          await getDb()
            .delete(schema.documentPreviewDrafts)
            .where(eq(schema.documentPreviewDrafts.documentId, documentId));
        }
      }
    },
  );

  it("fences an expired worker when a retry completes the side effect first", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, async () =>
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
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const expiredWorker = asUser(OWNER, async () => resolveDraft.run(request));
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
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
    release();
    await expect(expiredWorker).resolves.toMatchObject({
      status: "resolved",
      choice: "keep_mine",
    });
    updateSpy.mockRestore();
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    const request = {
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: before.updatedAt,
    };
    const updateSpy = vi
      .spyOn(updateDocument, "run")
      .mockRejectedValueOnce(new Error("worker stopped"));
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
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
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
  });

  it("does not reuse a legacy claim for a later identical draft", async () => {
    const documentId = await createDocument();
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, async () =>
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
      trigger: "reviewed" as const,
      choice: "keep_mine" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
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
      asUser(OWNER, async () => resolveDraft.run(request)),
    ).rejects.toThrow("worker stopped");
    updateSpy.mockRestore();
    await expect(
      asUser(OWNER, async () => resolveDraft.run(request)),
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
    await asUser(OWNER, async () =>
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
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );

    const result = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "keep_mine",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );

    expect(result.status).toBe("resolved");
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    const [current] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(current.content).toBe("Local recovery");
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "keep_mine",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload(content), deferredReason: "conflict" },
      }),
    );

    await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "keep_mine",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
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

    const result = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "keep_mine",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );
    expect(result.status).toBe("document_conflict");
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft
        ?.content,
    ).toBe("Local recovery");
  });

  it("keeps an edit that lands between the Keep mine claim and save", async () => {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    await asUser(OWNER, async () =>
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
      const result = await asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft
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
    await asUser(OWNER, async () =>
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
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Claimed recovery",
          expectedDocumentUpdatedAt: before.updatedAt,
        }),
      ),
    ).rejects.toThrow("preserved in Version History");
    updateSpy.mockRestore();

    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft
        ?.content,
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "use_saved",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "use_saved",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toEqual({ status: "resolved", choice: "use_saved" });

    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
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
    await asUser(OWNER, async () =>
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
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "use_saved",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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

    const delayed = await asUser(OWNER, async () =>
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
    await asUser(OWNER, async () =>
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
    await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "use_saved",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
    const saved = await asUser(OWNER, async () =>
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
    await asUser(OWNER, async () =>
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

    const result = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "use_saved",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Local recovery",
        expectedDocumentUpdatedAt: before.updatedAt,
      }),
    );

    expect(result.status).toBe("document_conflict");
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft
        ?.content,
    ).toBe("Local recovery");
  });

  it("saves the exact local draft as one separate page without changing the original", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );

    const result = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "save_separately",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
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

    const retry = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "save_separately",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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

    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload("Local recovery"), deferredReason: "conflict" },
      }),
    );
    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "save_separately",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Local recovery",
          expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
        }),
      ),
    ).resolves.toMatchObject({
      status: "resolved",
      createdDocumentId: result.createdDocumentId,
    });
    const newer = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft!;
    expect(newer.content).toBe("Local recovery");
    expect(newer.id).not.toBe(
      (await selectedDraftIdentity(documentId)).expectedDraftId,
    );
    const selectedNew = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "save_separately",
        documentId,
        ...expectedPreviewDraftIdentity(newer),
        expectedDraftVersion: newer.version,
        expectedDraftTitle: newer.title,
        expectedDraftContent: newer.content,
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );
    expect(selectedNew).toMatchObject({ status: "resolved" });
    expect(selectedNew.createdDocumentId).not.toBe(result.createdDocumentId);
    // Outcome delivery runs in the next task, outside the recovery transaction.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("counts an idempotent inner create replay separately from the winning recovery write", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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
      trigger: "reviewed" as const,
      choice: "save_separately" as const,
      documentId,
      ...(await selectedDraftIdentity(documentId)),
      expectedDraftVersion: 1,
      expectedDraftTitle: "Builder row",
      expectedDraftContent: "Local recovery",
      expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
    };
    outcomeCounter.mockClear();
    try {
      const resolved = await asUser(OWNER, async () =>
        resolveDraft.run(request),
      );
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
      const retry = await asUser(OWNER, async () => resolveDraft.run(request));
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
    await asUser(OWNER, async () =>
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
      const resolved = await asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "save_separately",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: { ...payload(content), deferredReason: "conflict" },
      }),
    );

    const result = await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "save_separately",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
    await asUser(COLLABORATOR, async () =>
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

    const result = await asUser(COLLABORATOR, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "save_separately",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("Terminal recovery"),
      }),
    );
    await asUser(OWNER, async () =>
      resolveDraft.run({
        trigger: "reviewed",
        choice: "use_saved",
        documentId,
        ...(await selectedDraftIdentity(documentId)),
        expectedDraftVersion: 1,
        expectedDraftTitle: "Builder row",
        expectedDraftContent: "Terminal recovery",
        expectedDocumentUpdatedAt: documentUpdatedAt(documentId),
      }),
    );

    await expect(
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "save_separately",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("owner draft"),
      }),
    );
    const result = await asUser(OWNER, async () =>
      getDraft.run({ documentId }),
    );
    expect(result.draft).toMatchObject({
      documentId,
      content: "owner draft",
      version: 1,
    });
    expect(result.draft).not.toHaveProperty("ownerEmail");
    expect(result.draft?.id).toEqual(expect.any(String));
  });

  it("keeps collaborator drafts private per request user", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("owner draft"),
      }),
    );
    await asUser(COLLABORATOR, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("collaborator draft"),
      }),
    );
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft
        ?.content,
    ).toBe("owner draft");
    expect(
      (await asUser(COLLABORATOR, async () => getDraft.run({ documentId })))
        .draft?.content,
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }), "org-b"))
        .draft,
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }), "org-b"))
        .draft?.content,
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
      asUser(COLLABORATOR, async () => getDraft.run({ documentId })),
    ).rejects.toThrow();
  });

  it("answers a reader without edit access instead of refusing, and keeps any old draft private", async () => {
    const documentId = await createDocument();
    await asUser(COLLABORATOR, async () =>
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
      asUser(COLLABORATOR, async () => getDraft.run({ documentId })),
    ).resolves.toEqual({ editable: false, draft: null });
    await expect(
      asUser(OWNER, async () => getDraft.run({ documentId })),
    ).resolves.toEqual({ editable: true, draft: null });
  });

  it("returns the current draft when two tabs race to create or update", async () => {
    const documentId = await createDocument();
    const first = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("tab A"),
      }),
    );
    const createRace = await asUser(OWNER, async () =>
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

    const updated = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        expectedDraftId: first.draft!.id,
        draft: payload("tab A v2"),
      }),
    );
    expect(updated).toMatchObject({ status: "saved", draft: { version: 2 } });
    const stale = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        expectedDraftId: first.draft!.id,
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
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("v1"),
      }),
    );
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
        draft: payload("v2"),
      }),
    );
    const staleDelete = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
        expectedVersion: 1,
        expectedTitle: "Builder row",
        expectedContent: "v1",
      }),
    );
    expect(staleDelete).toMatchObject({
      status: "conflict",
      draft: { content: "v2", version: 2 },
    });
    const deleted = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "v2",
      }),
    );
    expect(deleted).toEqual({ status: "deleted", draft: null });
  });

  it("deletes a draft the page holds only while the stored page still holds it", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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
      expectedDraftId: (await selectedDraftIdentity(documentId))
        .expectedDraftId,
      expectedVersion: 1,
      expectedTitle: "Builder row",
      expectedContent: "Server body",
      ifPageHoldsDraft: true as const,
    };
    const refused = await asUser(OWNER, async () => updateDraft.run(held));
    expect(refused).toMatchObject({
      status: "conflict",
      draft: { content: "Server body", version: 1 },
    });

    await getDb()
      .update(schema.documents)
      .set({ content: "Server body" })
      .where(eq(schema.documents.id, documentId));
    const deleted = await asUser(OWNER, async () => updateDraft.run(held));
    expect(deleted).toEqual({ status: "deleted", draft: null });
  });

  it("keeps C2 recoverable when older C1 persistence finishes after the C2 draft", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: payload("C1"),
      }),
    );
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
        draft: payload("C2"),
      }),
    );

    const c1CompletionCleanup = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "C2", version: 2 });

    const c2CompletionCleanup = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
        expectedVersion: 2,
        expectedTitle: "Builder row",
        expectedContent: "C2",
      }),
    );
    expect(c2CompletionCleanup).toEqual({ status: "deleted", draft: null });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  it("does not let a delayed retained draft resurrect after its edit generation saved", async () => {
    const documentId = await createDocument();
    const editorSessionId = "tab-one";
    await asUser(OWNER, async () =>
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
    await asUser(OWNER, async () =>
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
    await expect(
      asUser(OWNER, async () =>
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  it("fences a delayed same-generation draft after keep-mine recovery", async () => {
    const documentId = await createDocument();
    const editorSessionId = "keep-mine-tab";
    const [before] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    await asUser(OWNER, async () =>
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
      asUser(OWNER, async () =>
        resolveDraft.run({
          trigger: "reviewed",
          choice: "keep_mine",
          documentId,
          ...(await selectedDraftIdentity(documentId)),
          expectedDraftVersion: 1,
          expectedDraftTitle: "Builder row",
          expectedDraftContent: "Recovered local body",
          expectedDocumentUpdatedAt: before.updatedAt,
        }),
      ),
    ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });

    await expect(
      asUser(OWNER, async () =>
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
    await asUser(OWNER, async () =>
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

    await asUser(OWNER, async () =>
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({
      content: "Other tab recovery",
      editorSessionId: "tab-two",
      editGeneration: 3,
    });
  });

  it("does not let a tab replace or delete another tab's retained lineage", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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

    const replace = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
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

    const remove = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "delete",
        documentId,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
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

  it("answers a closed tab's journal upsert with another tab's same-text draft unchanged", async () => {
    const documentId = await createDocument();
    const tabTwo = {
      ...payload("Same text in both tabs"),
      editorSessionId: "tab-two",
      editGeneration: 5,
    };
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: tabTwo,
      }),
    );
    const before = (
      await asUser(OWNER, async () => getDraft.run({ documentId }))
    ).draft!;
    const journal = {
      ...tabTwo,
      editorSessionId: "tab-one",
      editGeneration: 1,
      deferredReason: "conflict" as const,
    };

    for (const binding of [
      { expectedVersion: null },
      { expectedVersion: before.version, expectedDraftId: before.id },
    ])
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId,
            ...binding,
            draft: journal,
          }),
        ),
      ).resolves.toEqual({ status: "conflict", draft: before });
    expect(
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toEqual(before);
    expect(await editorSettlement(documentId, "tab-two")).toMatchObject({
      settledGeneration: -1,
      discardedGeneration: null,
    });
  });

  it("rejects a delete with only half of the editor identity", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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
      asUser(OWNER, async () =>
        updateDraft.run({
          operation: "delete",
          documentId,
          expectedDraftId: (await selectedDraftIdentity(documentId))
            .expectedDraftId,
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ content: "Protected recovery", editGeneration: 5 });
  });

  it("does not let a delayed lower generation replace newer unsettled work", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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

    const delayed = await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: 1,
        expectedDraftId: (await selectedDraftIdentity(documentId))
          .expectedDraftId,
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
    await asUser(OWNER, async () =>
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

    await asUser(OWNER, async () =>
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  it("does not settle a generation when only part of its editor snapshot was saved", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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

    await asUser(OWNER, async () =>
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toMatchObject({ title: "Local title", content: "Local body" });
  });

  async function saveBodyAfterPeerRename(
    editorTitle: (savedTitle: string) => string,
  ) {
    const documentId = await createDocument();
    const before = await documentRowForDraftTest(documentId);
    const snapshotTitle = editorTitle(before.title);
    await asUser(OWNER, async () =>
      updateDraft.run({
        operation: "upsert",
        documentId,
        expectedVersion: null,
        draft: {
          ...payload("Local body"),
          title: snapshotTitle,
          editorSessionId: "renamed-tab",
          editGeneration: 5,
        },
      }),
    );
    await asUser(OWNER, async () =>
      updateDocument.run(
        { id: documentId, title: "Renamed in another tab", reuseLabels: [] },
        { caller: "frontend" } as any,
      ),
    );
    const saveBase = await authoredSaveBase(documentId, "Local body");
    await asUser(OWNER, async () =>
      updateDocument.run(
        {
          id: documentId,
          content: "Local body",
          ...saveBase,
          browserSaveAttemptId: "body-after-peer-rename",
          editorSessionId: "renamed-tab",
          editorEditGeneration: 5,
          editorSnapshotTitle: snapshotTitle,
          editorSnapshotTitleBase: before.title,
          editorSnapshotContent: "Local body",
          reuseLabels: [],
        },
        { caller: "frontend" } as any,
      ),
    );
    const after = await documentRowForDraftTest(documentId);
    expect(after).toMatchObject({
      title: "Renamed in another tab",
      content: "Local body",
    });
    return (await asUser(OWNER, async () => getDraft.run({ documentId })))
      .draft;
  }

  it("settles a body save whose untouched title a peer renamed", async () => {
    expect(await saveBodyAfterPeerRename((saved) => saved)).toBeNull();
  });

  it("keeps the draft of a title the editor edited when a peer renamed it", async () => {
    expect(await saveBodyAfterPeerRename(() => "Local title")).toMatchObject({
      title: "Local title",
      content: "Local body",
    });
  });

  it("settles a retained generation after its rebased candidate is confirmed", async () => {
    const documentId = await createDocument();
    await asUser(OWNER, async () =>
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
    await asUser(OWNER, async () =>
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
      (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft,
    ).toBeNull();
  });

  describe("a claim's terminal transition", () => {
    async function claimedGeneration(content: string) {
      const documentId = await createDocument();
      const page = await documentRowForDraftTest(documentId);
      const draft = {
        ...payload(content),
        title: page.title,
        baseTitle: page.title,
        baseDocumentUpdatedAt: page.updatedAt,
        baseContentHash: `sha256:${createHash("sha256").update(page.content).digest("hex")}`,
        deferredReason: "conflict" as const,
        editorSessionId: `terminal-${documentId}`,
        editGeneration: 4,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const [claimed] = await getDb()
        .select()
        .from(schema.documentPreviewDrafts)
        .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const request = (
        choice: "keep_mine" | "use_saved" | "save_separately",
        reviewed: { title: string; updatedAt: string } = page,
        selected: {
          id: string;
          version: number;
          title: string;
          content: string;
          baseTitle: string | null;
          editorSessionId: string | null;
          editGeneration: number | null;
        } = claimed,
      ) => ({
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...expectedPreviewDraftIdentity(selected),
        expectedDraftVersion: selected.version,
        expectedDraftTitle: selected.title,
        expectedDraftContent: selected.content,
        expectedDraftBaseTitle: selected.baseTitle,
        expectedDocumentTitle: reviewed.title,
        expectedDocumentUpdatedAt: reviewed.updatedAt,
      });
      const claims = () =>
        getDb()
          .select()
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.ownerEmail, OWNER),
              eq(
                schema.documentVersions.groupId,
                `draft-recovery:${claimed.id}`,
              ),
            ),
          );
      const retained = async () =>
        (await asUser(OWNER, async () => getDraft.run({ documentId }))).draft;
      return { documentId, page, draft, claimed, request, claims, retained };
    }

    const outcome = (run: Promise<unknown>) =>
      run.then(
        (value) => ({ value }),
        (error) => ({ error }),
      );

    it.each(["reviewed", "automatic"] as const)(
      "keeps a same-generation draft written while %s Keep mine saves out of its claim's settlement",
      async (trigger) => {
        const s = await claimedGeneration("Claimed generation four");
        const late = { ...s.draft, content: "Written after the claim" };
        const save = updateDocument.run.bind(updateDocument);
        let written: unknown;
        const updateSpy = vi
          .spyOn(updateDocument, "run")
          .mockImplementationOnce(async (args, ctx) => {
            // The claim has committed and taken its row. Generation four is
            // still unsettled, so its writer can save another draft.
            written = await updateDraft.run({
              operation: "upsert",
              documentId: s.documentId,
              expectedVersion: null,
              draft: late,
            });
            return save(args, ctx);
          });
        let result: unknown;
        try {
          result = await outcome(
            asUser(OWNER, async () =>
              resolveDraft.run({ ...s.request("keep_mine"), trigger }),
            ),
          );
        } finally {
          updateSpy.mockRestore();
        }
        expect(written).toMatchObject({
          status: "saved",
          draft: { content: late.content, editGeneration: 4 },
        });
        const later = await s.retained();
        expect(later).toMatchObject({
          content: late.content,
          editorSessionId: s.draft.editorSessionId,
          editGeneration: 4,
        });
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId),
        ).toMatchObject({ settledGeneration: -1, discardedGeneration: null });
        const [claim] = await s.claims();
        expect(JSON.parse(claim.chatContext!).status).not.toBe("resolved");
        expect(result).toMatchObject({
          error: { errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT" },
        });
        expect(await documentRowForDraftTest(s.documentId)).toMatchObject({
          content: s.draft.content,
        });

        const page = await documentRowForDraftTest(s.documentId);
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run(s.request("use_saved", page, later!)),
          ),
        ).resolves.toMatchObject({ status: "resolved", choice: "use_saved" });
        await expect(
          asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
        ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
        expect(await s.retained()).toBeNull();
        expect(
          (await s.claims()).map(
            ({ chatContext }) => JSON.parse(chatContext!).status,
          ),
        ).toEqual(["resolved"]);
        expect(await documentRowForDraftTest(s.documentId)).toMatchObject({
          content: s.draft.content,
        });
      },
    );

    it.each([true, false])(
      "checks the generation before a reacquired Keep mine claim resumes (applied=%s)",
      async (applied) => {
        const s = await claimedGeneration("Claimed generation four");
        const db = getDb();
        const save = updateDocument.run.bind(updateDocument);
        let stopped = false;
        const updateSpy = vi
          .spyOn(updateDocument, "run")
          .mockImplementationOnce(async (args, ctx) => {
            if (applied) await save(args, ctx);
            stopped = true;
            throw new Error("worker stopped");
          });
        // The worker stops before it can restore or settle anything.
        const stopSpy = spyOnTransaction(db, async (fn, transaction) =>
          stopped ? undefined : transaction(fn),
        );
        try {
          await expect(
            asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
          ).rejects.toThrow("worker stopped");
        } finally {
          stopSpy.mockRestore();
          updateSpy.mockRestore();
        }
        const [claim] = await s.claims();
        const stoppedClaim = JSON.parse(claim.chatContext!);
        expect(stoppedClaim.status).toBe("processing");
        await getDb()
          .update(schema.documentVersions)
          .set({
            chatContext: JSON.stringify({
              ...stoppedClaim,
              processingStartedAt: "2026-01-01T00:00:00.000Z",
            }),
          })
          .where(eq(schema.documentVersions.id, claim.id));
        const before = await documentRowForDraftTest(s.documentId);
        expect(before.content).toBe(applied ? s.draft.content : s.page.content);
        expect(await s.retained()).toBeNull();
        const late = { ...s.draft, content: "Written before reacquisition" };
        let written: unknown;
        const transactionSpy = spyOnTransaction(db, async (fn, transaction) => {
          const result = await transaction(fn);
          if (written === undefined) {
            // After the retry's first transaction commits, before the next
            // one reacquires the claim.
            written = null;
            written = await updateDraft.run({
              operation: "upsert",
              documentId: s.documentId,
              expectedVersion: null,
              draft: late,
            });
          }
          return result;
        });
        let result: unknown;
        try {
          result = await outcome(
            asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
          );
        } finally {
          transactionSpy.mockRestore();
        }
        expect(written).toMatchObject({ status: "saved" });
        expect(await s.retained()).toMatchObject({
          content: late.content,
          editGeneration: 4,
        });
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId),
        ).toMatchObject({ settledGeneration: -1 });
        expect(JSON.parse((await s.claims())[0].chatContext!)).toMatchObject({
          status: "processing",
          processingToken: stoppedClaim.processingToken,
        });
        expect(await documentRowForDraftTest(s.documentId)).toEqual(before);
        expect(result).toMatchObject({
          error: { errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT" },
        });
      },
    );

    it("does not resolve an unapplied Keep mine because another snapshot settled its generation", async () => {
      const s = await claimedGeneration("Claimed X");
      const save = updateDocument.run.bind(updateDocument);
      const updateSpy = vi
        .spyOn(updateDocument, "run")
        .mockImplementationOnce(async (args, ctx) => {
          await save({ id: s.documentId, content: "Peer Y" });
          const other = await updateDraft.run({
            operation: "upsert",
            documentId: s.documentId,
            expectedVersion: null,
            draft: { ...s.draft, content: "Another snapshot" },
          });
          const peer = await documentRowForDraftTest(s.documentId);
          await expect(
            resolveDraft.run(s.request("use_saved", peer, other.draft!)),
          ).resolves.toMatchObject({ status: "resolved" });
          return save(args, ctx);
        });
      let result: unknown;
      try {
        result = await asUser(OWNER, async () =>
          resolveDraft.run(s.request("keep_mine")),
        );
      } finally {
        updateSpy.mockRestore();
      }
      expect(result).toMatchObject({ status: "document_conflict" });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 4, discardedGeneration: 4 });
      expect(JSON.parse((await s.claims())[0].chatContext!).status).toBe(
        "claimed",
      );
      expect(await s.retained()).toMatchObject({
        id: s.claimed.id,
        version: 1,
        content: "Claimed X",
        editorSessionId: s.draft.editorSessionId,
        editGeneration: 4,
      });
      const peer = await documentRowForDraftTest(s.documentId);
      expect(peer.content).toBe("Peer Y");

      await expect(
        asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
      ).resolves.toMatchObject({ status: "document_conflict" });
      expect(await documentRowForDraftTest(s.documentId)).toEqual(peer);

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run(s.request("keep_mine", peer)),
        ),
      ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
      expect((await documentRowForDraftTest(s.documentId)).content).toBe(
        "Claimed X",
      );
      expect(
        (await s.claims()).map(
          ({ chatContext }) => JSON.parse(chatContext!).status,
        ),
      ).toEqual(["resolved"]);
    });

    async function failedClaim(prior: "keep_mine" | "save_separately") {
      const s = await claimedGeneration(`Failed ${prior} body`);
      if (prior === "keep_mine") {
        const save = updateDocument.run.bind(updateDocument);
        const updateSpy = vi
          .spyOn(updateDocument, "run")
          .mockImplementationOnce(async (args, ctx) => {
            await save({ id: s.documentId, content: "Intervening edit" });
            return save(args, ctx);
          });
        try {
          await expect(
            asUser(OWNER, async () => resolveDraft.run(s.request(prior))),
          ).resolves.toMatchObject({ status: "document_conflict" });
        } finally {
          updateSpy.mockRestore();
        }
      } else {
        const stop = vi
          .spyOn(createRecoveryDocument, "run")
          .mockRejectedValueOnce(new Error("copy unavailable"));
        try {
          await expect(
            asUser(OWNER, async () => resolveDraft.run(s.request(prior))),
          ).rejects.toThrow("copy unavailable");
        } finally {
          stop.mockRestore();
        }
        await asUser(OWNER, async () =>
          updateDocument.run({ id: s.documentId, title: "Peer rename" }),
        );
      }
      const [claim] = await s.claims();
      expect(JSON.parse(claim.chatContext!)).toMatchObject({
        choice: prior,
        status: "claimed",
        draftVersion: 1,
        expectedDocumentUpdatedAt: s.page.updatedAt,
      });
      expect(await s.retained()).toMatchObject({
        id: s.claimed.id,
        version: 1,
      });
      const page = await documentRowForDraftTest(s.documentId);
      expect(page.updatedAt).not.toBe(s.page.updatedAt);
      return { ...s, claim, page };
    }

    it("finishes a failed Keep mine through its own claim after the page timestamp changed", async () => {
      const s = await failedClaim("keep_mine");

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run(s.request("keep_mine", s.page)),
        ),
      ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
      expect((await documentRowForDraftTest(s.documentId)).content).toBe(
        s.draft.content,
      );
      const claims = await s.claims();
      expect(claims.map(({ id }) => id)).toEqual([s.claim.id]);
      expect(JSON.parse(claims[0].chatContext!)).toMatchObject({
        status: "resolved",
        draftVersion: 1,
        expectedDocumentUpdatedAt: s.page.updatedAt,
        reviewedDocumentTitle: s.page.title,
      });
    });

    it("leaves a failed Save separately's claim to it when a reviewed Keep mine overrides the snapshot", async () => {
      const s = await failedClaim("save_separately");

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run(s.request("keep_mine", s.page)),
        ),
      ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
      expect((await documentRowForDraftTest(s.documentId)).content).toBe(
        s.draft.content,
      );
      const claims = await s.claims();
      expect(claims).toHaveLength(2);
      expect(claims.find(({ id }) => id === s.claim.id)).toEqual(s.claim);
      expect(
        JSON.parse(claims.find(({ id }) => id !== s.claim.id)!.chatContext!),
      ).toMatchObject({
        choice: "keep_mine",
        status: "resolved",
        expectedDocumentUpdatedAt: s.page.updatedAt,
      });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ discardedGeneration: 4 });
    });

    it.each(["keep_mine", "save_separately"] as const)(
      "finishes a legacy %s claim's retry by the page version the claim recorded",
      async (prior) => {
        const s = await failedClaim(prior);
        // A claim from before claims recorded their draft version, with the
        // ID hashed from the page version it was reviewed against.
        const { draftVersion: _recorded, ...legacy } = JSON.parse(
          s.claim.chatContext!,
        );
        await getDb()
          .update(schema.documentVersions)
          .set({ chatContext: JSON.stringify(legacy) })
          .where(eq(schema.documentVersions.id, s.claim.id));

        const result = await asUser(OWNER, async () =>
          resolveDraft.run(s.request(prior, s.page)),
        );

        expect(result).toMatchObject({ status: "resolved", choice: prior });
        const claims = await s.claims();
        expect(claims.map(({ id }) => id)).toEqual([s.claim.id]);
        expect(JSON.parse(claims[0].chatContext!)).toMatchObject({
          choice: prior,
          status: "resolved",
          draftVersion: 1,
        });
        if (prior === "save_separately")
          expect(result).toMatchObject({
            createdDocumentId: `recovery-${s.claim.id.slice("draft-claim-".length)}`,
          });
        else
          expect((await documentRowForDraftTest(s.documentId)).content).toBe(
            s.draft.content,
          );
        expect(await s.retained()).toBeNull();
      },
    );

    const ownedCopies = (s: {
      documentId: string;
      draft: { content: string };
    }) =>
      getDb()
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.ownerEmail, OWNER),
            eq(schema.documents.content, s.draft.content),
            ne(schema.documents.id, s.documentId),
          ),
        );
    const byId = <T extends { id: string }>(rows: T[]) =>
      [...rows].sort((a, b) => a.id.localeCompare(b.id));

    // Its copy fails, so the claim keeps its draft at the page version it
    // was reviewed against, and nothing has changed the page since.
    async function stoppedSaveSeparately(content: string) {
      const s = await claimedGeneration(content);
      const stop = vi
        .spyOn(createRecoveryDocument, "run")
        .mockRejectedValueOnce(new Error("copy unavailable"));
      try {
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run(s.request("save_separately")),
          ),
        ).rejects.toThrow("copy unavailable");
      } finally {
        stop.mockRestore();
      }
      const [claim] = await s.claims();
      expect(JSON.parse(claim.chatContext!)).toMatchObject({
        choice: "save_separately",
        status: "claimed",
        draftVersion: 1,
        expectedDocumentUpdatedAt: s.page.updatedAt,
      });
      expect(await s.retained()).toMatchObject({
        id: s.claimed.id,
        version: 1,
      });
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.page);
      const fence = await editorSettlement(
        s.documentId,
        s.draft.editorSessionId,
      );
      expect(fence).toMatchObject({ discardedGeneration: 4 });
      return { ...s, claim, fence };
    }

    it.each(["current", "historical"] as const)(
      "overrides a stopped Save separately's %s claim at the page version it claimed through a Keep mine claim of its own",
      async (claimShape) => {
        const s = await stoppedSaveSeparately(`Override ${claimShape} body`);
        let claim = s.claim;
        if (claimShape === "historical") {
          // A claim from before IDs hashed the draft's source or claims
          // recorded its version.
          const { draftVersion: _recorded, ...legacy } = JSON.parse(
            claim.chatContext!,
          );
          const id = await legacyClaimId(s.request("save_separately"), true);
          await getDb()
            .update(schema.documentVersions)
            .set({ id, chatContext: JSON.stringify(legacy) })
            .where(eq(schema.documentVersions.id, claim.id));
          [claim] = await s.claims();
          expect(claim.id).toBe(id);
        }

        await expect(
          asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
        ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
        const overridden = await documentRowForDraftTest(s.documentId);
        expect(overridden).toMatchObject({
          title: s.page.title,
          content: s.draft.content,
        });
        const claims = byId(await s.claims());
        expect(claims).toHaveLength(2);
        expect(claims.find(({ id }) => id === claim.id)).toEqual(claim);
        const override = claims.find(({ id }) => id !== claim.id)!;
        expect(override).toMatchObject({
          documentId: s.documentId,
          title: s.draft.title,
          content: s.draft.content,
          groupKind: "operation",
          groupId: `draft-recovery:${s.claimed.id}`,
          operation: "claim-preview-draft-keep_mine",
        });
        expect(JSON.parse(override.chatContext!)).toMatchObject({
          choice: "keep_mine",
          status: "resolved",
          draftId: s.claimed.id,
          draftVersion: 1,
          editorSessionId: s.draft.editorSessionId,
          editGeneration: 4,
          expectedDocumentUpdatedAt: s.page.updatedAt,
          reviewedDocumentTitle: s.page.title,
        });
        expect(await s.retained()).toBeNull();
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId),
        ).toMatchObject({ settledGeneration: 4, discardedGeneration: 4 });

        // Every retry of the override returns its claim, before and after
        // the page moves on, and writes nothing.
        await expect(
          asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
        ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
        expect(await documentRowForDraftTest(s.documentId)).toEqual(overridden);
        await asUser(OWNER, async () =>
          updateDocument.run({ id: s.documentId, content: "Peer body" }),
        );
        const edited = await documentRowForDraftTest(s.documentId);
        for (const reviewed of [s.page, edited])
          await expect(
            asUser(OWNER, async () =>
              resolveDraft.run(s.request("keep_mine", reviewed)),
            ),
          ).resolves.toMatchObject({
            status: "resolved",
            choice: "keep_mine",
          });
        await asUser(OWNER, async () =>
          updateDocument.run({ id: s.documentId, title: "Peer rename" }),
        );
        const renamed = await documentRowForDraftTest(s.documentId);
        await expect(
          asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
        ).resolves.toMatchObject({ status: "resolved", choice: "keep_mine" });
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run(s.request("keep_mine", renamed)),
          ),
        ).rejects.toThrow("The reviewed page title changed during recovery.");
        // The earlier choice's retry still names its own claim.
        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run(s.request("save_separately")),
          ),
        ).resolves.toMatchObject({ status: "document_conflict" });
        expect(byId(await s.claims())).toEqual(claims);
        expect(await documentRowForDraftTest(s.documentId)).toEqual(renamed);
        expect(await ownedCopies(s)).toEqual([]);
      },
    );

    it("leaves a stopped Save separately's own retry to its claim", async () => {
      const s = await stoppedSaveSeparately("Stopped copy retried body");

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run(s.request("save_separately")),
        ),
      ).resolves.toMatchObject({
        status: "resolved",
        choice: "save_separately",
        createdDocumentId: `recovery-${s.claim.id.slice("draft-claim-".length)}`,
      });
      expect((await s.claims()).map(({ id }) => id)).toEqual([s.claim.id]);
      expect(await ownedCopies(s)).toHaveLength(1);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.page);
      expect(await s.retained()).toBeNull();
    });

    it("keeps an automatic Keep mine and a reviewed Use saved from overriding a stopped Save separately", async () => {
      const s = await stoppedSaveSeparately("Stopped copy kept body");

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request("keep_mine"),
            trigger: "automatic",
          }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
        choice: "save_separately",
        recoveryVersionId: s.claim.id,
      });
      await expect(
        asUser(OWNER, async () => resolveDraft.run(s.request("use_saved"))),
      ).rejects.toThrow("This draft was already resolved with another choice.");
      expect(await s.claims()).toEqual([s.claim]);
      expect(await s.retained()).toMatchObject({
        id: s.claimed.id,
        version: 1,
      });
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.page);
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({
        settledGeneration: s.fence.settledGeneration,
        discardedGeneration: 4,
      });
    });

    it.each([
      "is filed under another operation",
      "records another base title",
      "names another editor session",
      "holds a malformed payload",
    ] as const)(
      "refuses a reviewed Keep mine whose claim %s, without overriding it",
      async (basis) => {
        const s = await stoppedSaveSeparately(`Unproven claim ${basis}`);
        const claimed = JSON.parse(s.claim.chatContext!);
        const changes = {
          "is filed under another operation": {
            operation: "use-saved-preview-draft",
          },
          "records another base title": {
            chatContext: JSON.stringify({
              ...claimed,
              baseTitle: "Another base title",
            }),
          },
          "names another editor session": {
            chatContext: JSON.stringify({
              ...claimed,
              editorSessionId: "another-editor-session",
            }),
          },
          "holds a malformed payload": {
            chatContext: JSON.stringify({ ...claimed, status: "unknown" }),
          },
        }[basis];
        await getDb()
          .update(schema.documentVersions)
          .set(changes)
          .where(eq(schema.documentVersions.id, s.claim.id));
        const claims = await s.claims();
        const retained = await s.retained();

        const refused = asUser(OWNER, async () =>
          resolveDraft.run(s.request("keep_mine")),
        );
        if (basis === "names another editor session")
          await expect(refused).resolves.toMatchObject({
            status: "recovery_required",
            reason: "draft_changed",
          });
        // A malformed durable claim fails loudly instead of proving anything.
        else if (basis === "holds a malformed payload")
          await expect(refused).rejects.toThrow();
        else
          await expect(refused).rejects.toMatchObject({
            errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
            message: "This draft was already resolved with another choice.",
          });
        expect(await s.claims()).toEqual(claims);
        expect(await s.retained()).toEqual(retained);
        expect(await documentRowForDraftTest(s.documentId)).toEqual(s.page);
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId),
        ).toEqual(s.fence);
      },
    );

    // A Save separately waits at its copy. Past its processing lease a retry
    // takes the claim over and fails before that copy lands, which gives the
    // claim its draft back. The first copy then lands under a token that no
    // longer holds the claim, and a peer changes the page.
    async function copyAfterTakeover(content: string) {
      const s = await claimedGeneration(content);
      const create = createRecoveryDocument.run.bind(createRecoveryDocument);
      let entered!: () => void;
      const atCopy = new Promise<void>((resolve) => (entered = resolve));
      let proceed!: () => void;
      const held = new Promise<void>((resolve) => (proceed = resolve));
      const createSpy = vi
        .spyOn(createRecoveryDocument, "run")
        .mockImplementationOnce(async (args, ctx) => {
          entered();
          await held;
          return create(args, ctx);
        })
        .mockRejectedValueOnce(new Error("copy unavailable"));
      const first = outcome(
        asUser(OWNER, async () =>
          resolveDraft.run(s.request("save_separately")),
        ),
      );
      try {
        await Promise.race([atCopy, first]);
        const clock = vi
          .spyOn(Date, "now")
          .mockReturnValue(Date.now() + 6 * 60_000);
        try {
          await expect(
            asUser(OWNER, async () =>
              resolveDraft.run(s.request("save_separately")),
            ),
          ).rejects.toThrow("copy unavailable");
        } finally {
          clock.mockRestore();
        }
      } finally {
        proceed();
        await first;
        createSpy.mockRestore();
      }
      expect(await first).toMatchObject({
        error: {
          errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
          message: "This recovery choice is already being applied.",
        },
      });
      const [claim] = await s.claims();
      expect(JSON.parse(claim.chatContext!)).toMatchObject({
        choice: "save_separately",
        status: "claimed",
        expectedDocumentUpdatedAt: s.page.updatedAt,
      });
      expect(await s.retained()).toMatchObject({
        id: s.claimed.id,
        version: 1,
      });
      const [copy, ...others] = await ownedCopies(s);
      expect(others).toEqual([]);
      expect(copy.id).toBe(`recovery-${claim.id.slice("draft-claim-".length)}`);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.page);
      await asUser(OWNER, async () =>
        updateDocument.run({ id: s.documentId, title: "Peer rename" }),
      );
      const peer = await documentRowForDraftTest(s.documentId);
      expect(peer.updatedAt).not.toBe(s.page.updatedAt);
      return { ...s, claim, copy, peer };
    }

    it.each(["original", "current"] as const)(
      "finishes the %s reviewed request of a Save separately through the copy it made before a takeover gave its draft back",
      async (reviewed) => {
        const s = await copyAfterTakeover(`Landed copy ${reviewed} body`);

        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run(
              s.request(
                "save_separately",
                reviewed === "original" ? s.page : s.peer,
              ),
            ),
          ),
        ).resolves.toMatchObject({
          status: "resolved",
          choice: "save_separately",
          createdDocumentId: s.copy.id,
        });
        const claims = await s.claims();
        expect(claims.map(({ id }) => id)).toEqual([s.claim.id]);
        expect(JSON.parse(claims[0].chatContext!)).toMatchObject({
          status: "resolved",
        });
        expect(await ownedCopies(s)).toEqual([s.copy]);
        expect(await s.retained()).toBeNull();
        expect(await documentRowForDraftTest(s.documentId)).toEqual(s.peer);
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId),
        ).toMatchObject({ settledGeneration: 4, discardedGeneration: 4 });
      },
    );

    it.each([
      "edited",
      "retitled",
      "another owner's",
      "missing",
      "claimed by a malformed payload",
    ] as const)(
      "keeps the draft when a landed copy is %s after the page changed",
      async (basis) => {
        const s = await copyAfterTakeover(`Unproven copy ${basis} body`);
        const copyRow = eq(schema.documents.id, s.copy.id);
        if (basis === "edited")
          await getDb()
            .update(schema.documents)
            .set({ content: "Edited copy" })
            .where(copyRow);
        else if (basis === "retitled")
          await getDb()
            .update(schema.documents)
            .set({ title: "Retitled copy" })
            .where(copyRow);
        else if (basis === "another owner's")
          await getDb()
            .update(schema.documents)
            .set({ ownerEmail: COLLABORATOR })
            .where(copyRow);
        else if (basis === "missing")
          await getDb().delete(schema.documents).where(copyRow);
        else
          await getDb()
            .update(schema.documentVersions)
            .set({
              chatContext: JSON.stringify({
                ...JSON.parse(s.claim.chatContext!),
                status: "unknown",
              }),
            })
            .where(eq(schema.documentVersions.id, s.claim.id));
        const effects = async () => ({
          claims: await s.claims(),
          drafts: await getDb()
            .select()
            .from(schema.documentPreviewDrafts)
            .where(eq(schema.documentPreviewDrafts.documentId, s.documentId)),
          copy: await getDb().select().from(schema.documents).where(copyRow),
          page: await documentRowForDraftTest(s.documentId),
          settlement: await editorSettlement(
            s.documentId,
            s.draft.editorSessionId,
          ),
        });
        const before = await effects();
        expect(before.drafts).toHaveLength(1);

        const refused = asUser(OWNER, async () =>
          resolveDraft.run(s.request("save_separately")),
        );
        if (basis === "claimed by a malformed payload")
          await expect(refused).rejects.toThrow();
        else
          await expect(refused).resolves.toMatchObject({
            status: "document_conflict",
          });
        expect(await effects()).toEqual(before);
      },
    );

    it("finishes through a landed copy while sparing the generation's later draft", async () => {
      const s = await copyAfterTakeover("Landed copy beside a later draft");
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId: s.documentId,
            expectedVersion: 1,
            expectedDraftId: s.claimed.id,
            draft: {
              ...s.draft,
              content: "Written by the next generation",
              editGeneration: 5,
            },
          }),
        ),
      ).resolves.toMatchObject({ status: "saved", draft: { version: 2 } });

      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run(s.request("save_separately")),
        ),
      ).resolves.toMatchObject({
        status: "resolved",
        choice: "save_separately",
        createdDocumentId: s.copy.id,
      });
      expect(await s.retained()).toMatchObject({
        id: s.claimed.id,
        version: 2,
        content: "Written by the next generation",
        editGeneration: 5,
      });
      expect(
        await editorSettlement(s.documentId, s.draft.editorSessionId),
      ).toMatchObject({ settledGeneration: 4, discardedGeneration: 4 });
      expect(await ownedCopies(s)).toEqual([s.copy]);
      expect(await documentRowForDraftTest(s.documentId)).toEqual(s.peer);
    });

    it("keeps the page's consent gate and the prior choice after a landed copy", async () => {
      const s = await copyAfterTakeover("Landed copy consent body");
      const effects = async () => ({
        claims: byId(await s.claims()),
        retained: await s.retained(),
        copies: await ownedCopies(s),
        page: await documentRowForDraftTest(s.documentId),
      });
      const before = await effects();

      // Keep mine writes the page, so it still needs the page it reviewed.
      await expect(
        asUser(OWNER, async () => resolveDraft.run(s.request("keep_mine"))),
      ).resolves.toMatchObject({ status: "document_conflict" });
      await expect(
        asUser(OWNER, async () =>
          resolveDraft.run({
            ...s.request("save_separately"),
            trigger: "automatic",
          }),
        ),
      ).resolves.toMatchObject({
        status: "recovery_required",
        reason: "prior_choice",
        choice: "save_separately",
        recoveryVersionId: s.claim.id,
      });
      expect(await effects()).toEqual(before);
    });
  });

  describe("a claim from before claims recorded draft versions", () => {
    // The ID formats main wrote: from #5181 hashed with the reviewed page
    // version it recorded; from #5105 without it, though recorded; and
    // before that neither.
    const formats = ["page-versioned", "unversioned", "unrecorded"] as const;
    const LATER_TEXT = "Later version text";
    const ANOTHER_VERSION =
      "This recovery choice was made for another version of the draft.";
    const DRAFT_CHANGED = "The saved draft changed during recovery.";

    // Main stored this claim for a Save separately that failed: it restored
    // the draft, and its editor then saved the same generation again.
    async function mainEraClaim(
      format: (typeof formats)[number],
      later: "same text" | "other text" | "none" = "same text",
    ) {
      const documentId = await createDocument();
      const t0 = documentUpdatedAt(documentId);
      const draft = {
        ...payload(`Main-era body ${documentId}`),
        baseTitle: null,
        editorSessionId: `main-era-${documentId}`,
        editGeneration: 5,
      };
      await asUser(OWNER, async () =>
        updateDraft.run({
          operation: "upsert",
          documentId,
          expectedVersion: null,
          draft,
        }),
      );
      const drafts = () =>
        getDb()
          .select()
          .from(schema.documentPreviewDrafts)
          .where(eq(schema.documentPreviewDrafts.documentId, documentId));
      const [original] = await drafts();
      const originalRequest = {
        trigger: "reviewed" as const,
        choice: "save_separately" as const,
        documentId,
        ...expectedPreviewDraftIdentity(original),
        expectedDraftVersion: 1,
        expectedDraftTitle: draft.title,
        expectedDraftContent: draft.content,
        expectedDocumentUpdatedAt: t0,
      };
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.documentVersions)
        .values({
          id: await legacyClaimId(originalRequest, format === "page-versioned"),
          ownerEmail: OWNER,
          documentId,
          title: draft.title,
          content: draft.content,
          chatContext: JSON.stringify({
            choice: "save_separately",
            status: "claimed",
            ...(format === "unrecorded"
              ? {}
              : { expectedDocumentUpdatedAt: t0 }),
            processingToken: "main-era-processor",
            processingStartedAt: now,
            draftId: original.id,
            baseDocumentUpdatedAt: original.baseDocumentUpdatedAt,
            loadedContentWasEmpty: original.loadedContentWasEmpty,
            deferredReason: original.deferredReason,
            editorSessionId: original.editorSessionId,
            editGeneration: original.editGeneration,
            createdAt: original.createdAt,
            updatedAt: original.updatedAt,
          }),
          actorEmail: OWNER,
          actorKind: "human",
          origin: "frontend",
          groupKind: "operation",
          groupId: `draft-recovery:${original.id}`,
          operation: "claim-preview-draft-save_separately",
          checkpointKind: "recovery",
          createdAt: now,
          updatedAt: now,
        });
      if (later !== "none")
        await expect(
          asUser(OWNER, async () =>
            updateDraft.run({
              operation: "upsert",
              documentId,
              expectedVersion: 1,
              expectedDraftId: original.id,
              draft: {
                ...draft,
                content: later === "same text" ? draft.content : LATER_TEXT,
              },
            }),
          ),
        ).resolves.toMatchObject({ status: "saved", draft: { version: 2 } });
      const claims = () =>
        getDb()
          .select()
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.ownerEmail, OWNER),
              eq(
                schema.documentVersions.groupId,
                `draft-recovery:${original.id}`,
              ),
            ),
          )
          .orderBy(
            schema.documentVersions.createdAt,
            schema.documentVersions.id,
          );
      const copies = () =>
        getDb()
          .select()
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.ownerEmail, OWNER),
              ne(schema.documents.id, documentId),
              or(
                eq(schema.documents.content, draft.content),
                eq(schema.documents.content, LATER_TEXT),
              ),
            ),
          );
      const peerSave = async () => {
        await getDb()
          .update(schema.documents)
          .set({
            title: "Peer title Y",
            content: "Peer body Y",
            updatedAt: "2099-01-01T00:00:00.000Z",
          })
          .where(eq(schema.documents.id, documentId));
        return documentRowForDraftTest(documentId);
      };
      const request = (
        choice: "use_saved" | "save_separately",
        page: { title: string; updatedAt: string },
        retained: typeof original,
      ) => ({
        trigger: "reviewed" as const,
        choice,
        documentId,
        ...expectedPreviewDraftIdentity(retained),
        expectedDraftVersion: retained.version,
        expectedDraftTitle: retained.title,
        expectedDraftContent: retained.content,
        expectedDraftBaseTitle: null,
        expectedDocumentTitle: page.title,
        expectedDocumentUpdatedAt: page.updatedAt,
      });
      const effects = async () => ({
        page: await documentRowForDraftTest(documentId),
        drafts: await drafts(),
        claims: await claims(),
        copies: await copies(),
        settlement:
          (await editorSettlement(documentId, draft.editorSessionId)) ?? null,
      });
      return {
        documentId,
        draft,
        originalRequest,
        drafts,
        claims,
        copies,
        peerSave,
        request,
        effects,
      };
    }

    it.each(
      formats.flatMap((format) =>
        (["use_saved", "save_separately"] as const).map((choice) => ({
          format,
          choice,
        })),
      ),
    )(
      "starts its own claim for a reviewed $choice about a later version beside a $format claim",
      async ({ format, choice }) => {
        const s = await mainEraClaim(format);
        const page = await s.peerSave();
        const [retained] = await s.drafts();
        expect(retained).toMatchObject({
          version: 2,
          content: s.draft.content,
        });
        const [earlierClaim] = await s.claims();
        const request = s.request(choice, page, retained);

        // No ID format gives the earlier claim's ID for version 2, so it was
        // made for version 1. This choice used to be refused every time.
        const result = await asUser(OWNER, async () =>
          resolveDraft.run(request),
        );

        expect(result).toMatchObject({ status: "resolved", choice });
        expect(await s.drafts()).toEqual([]);
        expect(await documentRowForDraftTest(s.documentId)).toEqual(page);
        const claims = await s.claims();
        expect(claims).toHaveLength(2);
        expect(claims[0]).toEqual(earlierClaim);
        const laterClaim = claims[1];
        expect(laterClaim).toMatchObject({
          documentId: s.documentId,
          title: retained.title,
          content: retained.content,
          operation:
            choice === "use_saved"
              ? "use-saved-preview-draft"
              : "claim-preview-draft-save_separately",
        });
        expect(JSON.parse(laterClaim.chatContext!)).toMatchObject({
          choice,
          trigger: "reviewed",
          status: "resolved",
          draftId: retained.id,
          draftVersion: 2,
          editorSessionId: s.draft.editorSessionId,
          editGeneration: 5,
          expectedDocumentUpdatedAt: page.updatedAt,
          reviewedDocumentTitle: page.title,
        });
        const copyId = `recovery-${laterClaim.id.slice("draft-claim-".length)}`;
        expect((await s.copies()).map(({ id }) => id)).toEqual(
          choice === "save_separately" ? [copyId] : [],
        );
        expect(
          await editorSettlement(s.documentId, s.draft.editorSessionId),
        ).toMatchObject({ settledGeneration: 5, discardedGeneration: 5 });

        const { settlement: _settled, ...after } = await s.effects();
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({ status: "resolved", choice });
        const { settlement: _resettled, ...again } = await s.effects();
        expect(again).toEqual(after);
      },
    );

    it.each(formats)(
      "finishes a %s claim's retry for its own version after the page changed",
      async (format) => {
        const s = await mainEraClaim(format, "none");
        const page = await s.peerSave();
        const [retained] = await s.drafts();
        expect(retained).toMatchObject({ version: 1 });
        const [claim] = await s.claims();
        const request = s.request("save_separately", page, retained);
        const copyId = `recovery-${claim.id.slice("draft-claim-".length)}`;

        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({
          status: "resolved",
          choice: "save_separately",
          createdDocumentId: copyId,
        });

        const claims = await s.claims();
        expect(claims.map(({ id }) => id)).toEqual([claim.id]);
        expect(JSON.parse(claims[0].chatContext!)).toMatchObject({
          status: "resolved",
          draftVersion: 1,
        });
        expect((await s.copies()).map(({ id }) => id)).toEqual([copyId]);
        expect(await s.drafts()).toEqual([]);
        expect(await documentRowForDraftTest(s.documentId)).toEqual(page);
        const { settlement: _settled, ...after } = await s.effects();
        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).resolves.toMatchObject({
          status: "resolved",
          createdDocumentId: copyId,
        });
        const { settlement: _resettled, ...again } = await s.effects();
        expect(again).toEqual(after);
      },
    );

    it.each(formats)(
      "refuses an automatic choice about a later version beside a %s claim before any effect",
      async (format) => {
        const s = await mainEraClaim(format);
        const page = await s.peerSave();
        const [retained] = await s.drafts();
        const { trigger: _reviewed, ...request } = s.request(
          "save_separately",
          page,
          retained,
        );
        const before = await s.effects();

        await expect(
          asUser(OWNER, async () => resolveDraft.run(request)),
        ).rejects.toMatchObject({
          errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
          message: ANOTHER_VERSION,
        });
        expect(await s.effects()).toEqual(before);
      },
    );

    it.each(
      formats.flatMap((format) =>
        (["reviewed", "automatic"] as const).map((trigger) => ({
          format,
          trigger,
        })),
      ),
    )(
      "refuses a $format claim's own $trigger retry while its generation holds the later version",
      async ({ format, trigger }) => {
        const s = await mainEraClaim(format);
        const before = await s.effects();

        await expect(
          asUser(OWNER, async () =>
            resolveDraft.run({ ...s.originalRequest, trigger }),
          ),
        ).rejects.toMatchObject({
          errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
          message: DRAFT_CHANGED,
        });
        expect(await s.effects()).toEqual(before);
      },
    );

    it.each([
      ["names another org", ANOTHER_VERSION],
      ["names another page", DRAFT_CHANGED],
      ["names another editor session", DRAFT_CHANGED],
      ["names another edit generation", DRAFT_CHANGED],
      ["names another draft", DRAFT_CHANGED],
      [
        "names the earlier text for a later version with other text",
        ANOTHER_VERSION,
      ],
      ["names a later version no draft holds", ANOTHER_VERSION],
    ] as const)(
      "refuses a reviewed choice beside an earlier claim when it %s, before any effect",
      async (scope, message) => {
        const s = await mainEraClaim(
          "page-versioned",
          scope.includes("other text") ? "other text" : "same text",
        );
        const page = await s.peerSave();
        const [retained] = await s.drafts();
        let request: Record<string, unknown> = s.request(
          "save_separately",
          page,
          retained,
        );
        if (scope === "names another page") {
          const otherPage = await documentRowForDraftTest(
            await createDocument(),
          );
          request = {
            ...request,
            documentId: otherPage.id,
            expectedDocumentTitle: otherPage.title,
            expectedDocumentUpdatedAt: otherPage.updatedAt,
          };
        }
        if (scope === "names another editor session")
          request = { ...request, expectedDraftEditorSessionId: "another" };
        if (scope === "names another edit generation")
          request = { ...request, expectedDraftEditGeneration: 6 };
        if (scope === "names another draft")
          request = { ...request, expectedDraftId: "another-draft" };
        if (scope.includes("other text"))
          request = { ...request, expectedDraftContent: s.draft.content };
        if (scope === "names a later version no draft holds")
          await getDb()
            .delete(schema.documentPreviewDrafts)
            .where(eq(schema.documentPreviewDrafts.documentId, s.documentId));
        const before = await s.effects();

        await expect(
          asUser(
            OWNER,
            async () => resolveDraft.run(request as any),
            scope === "names another org" ? "another-org" : undefined,
          ),
        ).rejects.toMatchObject({
          errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
          message,
        });
        expect(await s.effects()).toEqual(before);
      },
    );

    it.each([
      "is no claim hash",
      "names another choice's operation",
      "is outside an operation group",
      "is filed under itself for the page owner",
      "names another draft",
      "holds a malformed payload",
    ] as const)(
      "refuses a reviewed choice about a later version beside a claim whose row %s, before any effect",
      async (basis) => {
        const s = await mainEraClaim("page-versioned");
        const page = await s.peerSave();
        const [retained] = await s.drafts();
        const [claim] = await s.claims();
        const claimed = JSON.parse(claim.chatContext!);
        const changes = {
          "is no claim hash": { id: "draft-claim-not-a-hash" },
          "names another choice's operation": {
            operation: "claim-preview-draft-keep_mine",
          },
          "is outside an operation group": { groupKind: "checkpoint" },
          "is filed under itself for the page owner": { documentId: claim.id },
          "names another draft": {
            chatContext: JSON.stringify({
              ...claimed,
              draftId: "an-older-draft",
            }),
          },
          "holds a malformed payload": {
            chatContext: JSON.stringify({ ...claimed, status: "unknown" }),
          },
        }[basis];
        await getDb()
          .update(schema.documentVersions)
          .set(changes)
          .where(eq(schema.documentVersions.id, claim.id));
        const before = await s.effects();

        const refused = expect(
          asUser(OWNER, async () =>
            resolveDraft.run(s.request("save_separately", page, retained)),
          ),
        ).rejects;
        // A malformed durable claim fails loudly instead of proving anything.
        if (basis === "holds a malformed payload") await refused.toThrow();
        else
          await refused.toMatchObject({
            errorCode: "PREVIEW_DRAFT_RECOVERY_CONFLICT",
            message: ANOTHER_VERSION,
          });
        expect(await s.effects()).toEqual(before);
      },
    );
  });
});
