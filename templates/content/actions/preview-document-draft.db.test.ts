import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import {
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
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
      const transaction = db.transaction.bind(db);
      const queries: string[] = [];
      let injected = false;
      let delayed: any;
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (fn: any) => {
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
      const transaction = db.transaction.bind(db);
      let injected = false;
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (fn: any) => {
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
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId: state.documentId,
            expectedVersion: null,
            draft: next,
          }),
        ),
      ).resolves.toMatchObject({
        status: "saved",
        draft: { editGeneration: 6, version: 1 },
      });
      await expect(
        asUser(OWNER, async () =>
          updateDraft.run({
            operation: "upsert",
            documentId: state.documentId,
            expectedVersion: 1,
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
      const transaction = db.transaction.bind(db);
      const queries: string[] = [];
      let injected = false;
      let delayed: any;
      let claimSettlement: any;
      let retainedReplacement: any;
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (fn: any) => {
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
      const transaction = db.transaction.bind(db);
      const queries: string[] = [];
      let injected = false;
      let delayed: any;
      let firstSettlement: any;
      const spy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (fn: any) => {
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
      const transaction = db.transaction.bind(db);
      let injected = false;
      let delayed: unknown;
      const queries: string[] = [];
      const transactionSpy = vi
        .spyOn(db, "transaction")
        .mockImplementation(async (fn: any) => {
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
        draft: payload("tab A v2"),
      }),
    );
    expect(updated).toMatchObject({ status: "saved", draft: { version: 2 } });
    const stale = await asUser(OWNER, async () =>
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
});
