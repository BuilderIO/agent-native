import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { SuggestionOperation } from "@agent-native/core/review";
import { runWithRequestContext } from "@agent-native/core/server";
import { yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import { markdownSuggestionOperations } from "../../shared/suggestion-diff.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggested-edits-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");
type Adapter =
  typeof import("./suggested-edits.js").contentDocumentSuggestionAdapter;
type DbExec = import("@agent-native/core/db").DbExec;

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let getDbExec: typeof import("@agent-native/core/db").getDbExec;
let adapter: Adapter;
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let updateDocumentAction: typeof import("../../actions/update-document.js").default;
let commentThreadDigest: typeof import("./comment-ai.js").commentThreadDigest;
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

beforeAll(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDbExec = (await import("@agent-native/core/db")).getDbExec;
  adapter = (await import("./suggested-edits.js"))
    .contentDocumentSuggestionAdapter;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  updateDocumentAction = (await import("../../actions/update-document.js"))
    .default;
  commentThreadDigest = (await import("./comment-ai.js")).commentThreadDigest;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
  if (previousSyncEventsEnabled === undefined)
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  else
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS =
      previousSyncEventsEnabled;
});

const ownerEmail = "owner@example.com";
let sequence = 0;

async function seedSystemDatabasePage() {
  sequence += 1;
  const suffix = `${sequence}`;
  const documentId = `suggestion-system-page-${suffix}`;
  const databaseDocumentId = `suggestion-system-db-page-${suffix}`;
  const databaseId = `suggestion-system-db-${suffix}`;
  const propertyId = `suggestion-primary-blocks-${suffix}`;
  const now = new Date().toISOString();
  const db = getDb();
  await db.insert(schema.documents).values([
    {
      id: databaseDocumentId,
      title: "Files",
      content: "",
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: documentId,
      title: "Page",
      content: "Before",
      ownerEmail,
      createdAt: now,
      updatedAt: "rev-1",
    },
  ]);
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    ownerEmail,
    documentId: databaseDocumentId,
    title: "Files",
    systemRole: "files",
    primaryBlocksPropertyId: propertyId,
    blocksSeeded: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.documentPropertyDefinitions).values({
    id: propertyId,
    ownerEmail,
    databaseId,
    name: "Content",
    type: "blocks",
    optionsJson: JSON.stringify({ blocks: { primary: true } }),
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabaseItems).values({
    id: `suggestion-system-item-${suffix}`,
    ownerEmail,
    databaseId,
    documentId,
    createdAt: now,
    updatedAt: now,
  });
  return { documentId, propertyId };
}

const operation = {
  ordinal: 0,
  kind: "replace_text",
  targetId: "body",
  before: { markdown: "Before" },
  after: { markdown: "After" },
  anchor: { from: 0, to: 6, prefix: "", suffix: "" },
  schemaVersion: 1,
} as const;

const contextualOperation = {
  ...operation,
  before: { markdown: "Before", changedText: "Before" },
  after: { markdown: "After", changedText: "After" },
} as const;

function coordination() {
  return {
    ydoc: {
      doc: new Y.Doc(),
      baseVersion: null,
      persist: vi.fn(async () => {}),
    },
    sync: {
      persist: vi.fn(async () => {}),
      isPersisted: () => true,
      publish: vi.fn(),
    },
  };
}

async function accept(
  documentId: string,
  tx: DbExec,
  baseRevision = "rev-1",
  acceptedOperation: SuggestionOperation = operation,
  prepared = coordination(),
) {
  const result = await adapter.apply({
    resourceType: "document",
    resourceId: documentId,
    suggestion: {
      id: `suggestion-${documentId}`,
      revision: 1,
      resourceType: "document",
      resourceId: documentId,
      adapterKind: adapter.kind,
      adapterVersion: 1,
      threadId: `thread-${documentId}`,
      authorEmail: "commenter@example.com",
      actorKind: "human",
      baseRevision,
      status: "pending",
      summary: "Suggest edits",
      ownerEmail,
      orgId: null,
      visibility: "private",
      createdAt: "now",
      updatedAt: "now",
      metadata: null,
      operations: [acceptedOperation],
    },
    operations: [acceptedOperation],
    access: { role: "editor" },
    ctx: {},
    transaction: tx,
    coordination: prepared,
  });
  return { prepared, result };
}

describe("Content suggested edits Blocks transaction", () => {
  it("accepts two proposal edits with one prepared Yjs persistence and replays safely", async () => {
    sequence += 1;
    const documentId = `suggestion-proposal-page-${sequence}`;
    const before = "Alpha, beta is good.";
    const after = "Alpha beta is great.";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: documentId,
      title: "Proposal page",
      content: before,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });
    const ctx = { caller: "cli" as const, userEmail: ownerEmail };
    const actions =
      await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal");
    const decisions =
      await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal");
    const run = () =>
      runWithRequestContext({ userEmail: ownerEmail }, async () => {
        const document = await getDocumentAction.run({ id: documentId }, ctx);
        const operations = markdownSuggestionOperations(before, after);
        expect(operations).toHaveLength(2);
        const created = await actions.default.run(
          {
            resourceType: "document",
            resourceId: documentId,
            adapterKind: adapter.kind,
            baseRevision: document.revision,
            summary: "Two edits",
            idempotencyKey: `content-proposal-${documentId}`,
            suggestions: operations.map((part, index) => ({
              summary: `Edit ${index + 1}`,
              operations: [part],
            })),
          },
          ctx,
        );
        const members = created.suggestions.map((suggestion) => ({
          id: suggestion.id,
          observedRevision: suggestion.revision,
          observedBase: suggestion.baseRevision,
        }));
        const request = {
          proposalId: created.proposal.id,
          decision: "accepted" as const,
          idempotencyKey: `content-proposal-decision-${documentId}`,
          members,
        };
        const accepted = await decisions.default.run(request, ctx);
        expect(
          accepted.suggestions.map((suggestion) => suggestion.status),
        ).toEqual(["accepted", "accepted"]);
        const replay = await decisions.default.run(request, ctx);
        expect(replay.suggestions.map((suggestion) => suggestion.id)).toEqual(
          created.suggestions.map((suggestion) => suggestion.id),
        );
        const updated = await getDocumentAction.run({ id: documentId }, ctx);
        expect(updated.content).toBe(after);
        expect(updated.bodyRevision).toBe(2);
      });
    await run();
  });

  it("rolls back the first Content edit when the second proposal edit conflicts", async () => {
    sequence += 1;
    const documentId = `suggestion-conflict-page-${sequence}`;
    const before = "Alpha, beta is good.";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: documentId,
      title: "Conflict page",
      content: before,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });
    const ctx = { caller: "cli" as const, userEmail: ownerEmail };
    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      const document = await getDocumentAction.run({ id: documentId }, ctx);
      const first = markdownSuggestionOperations(
        before,
        "Alpha beta is good.",
      )[0]!;
      const second = markdownSuggestionOperations(
        before,
        "Alpha; beta is good.",
      )[0]!;
      const created = await (
        await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal")
      ).default.run(
        {
          resourceType: "document",
          resourceId: documentId,
          adapterKind: adapter.kind,
          baseRevision: document.revision,
          summary: "Conflicting edits",
          idempotencyKey: `content-conflict-${documentId}`,
          suggestions: [
            { summary: "Remove comma", operations: [first] },
            { summary: "Replace comma", operations: [second] },
          ],
        },
        ctx,
      );
      await expect(
        (
          await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal")
        ).default.run(
          {
            proposalId: created.proposal.id,
            decision: "accepted",
            idempotencyKey: `content-conflict-decision-${documentId}`,
            members: created.suggestions.map((suggestion) => ({
              id: suggestion.id,
              observedRevision: suggestion.revision,
              observedBase: suggestion.baseRevision,
            })),
          },
          ctx,
        ),
      ).rejects.toThrow("proposal member is stale");
      const unchanged = await getDocumentAction.run({ id: documentId }, ctx);
      expect(unchanged.content).toBe(before);
      expect(unchanged.bodyRevision).toBe(0);
      const listed = await (
        await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
      ).default.run({ resourceType: "document", resourceId: documentId }, ctx);
      expect(listed.suggestions.map((suggestion) => suggestion.status)).toEqual(
        ["pending", "pending"],
      );
    });
  });
  it("rechecks the bound comment thread inside suggestion creation", async () => {
    const { documentId } = await seedSystemDatabasePage();
    const before = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );
    const now = new Date().toISOString();
    const comment = {
      id: `comment-ai-root-${sequence}`,
      ownerEmail,
      documentId,
      threadId: `comment-ai-root-${sequence}`,
      parentId: null,
      content: "Please revise this",
      authorEmail: ownerEmail,
      quotedText: null,
      anchorPrefix: null,
      anchorSuffix: null,
      anchorStartOffset: null,
      resolved: 0,
      createdAt: now,
      updatedAt: now,
    };
    await getDb().insert(schema.documentComments).values(comment);
    const requestId = crypto.randomUUID();
    await getDb()
      .insert(schema.commentAiRequests)
      .values({
        id: requestId,
        ownerEmail,
        requesterEmail: ownerEmail,
        documentId,
        threadId: comment.threadId,
        rootCommentId: comment.id,
        fieldId: "body",
        intent: "suggest",
        status: "running",
        threadDigest: commentThreadDigest([comment]),
        snapshotJson: "[]",
        baseRevision: before.baseRevision,
        suggestionRevision: before.baseRevision,
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .update(schema.documentComments)
      .set({ content: "Changed while AI was working" })
      .where(eq(schema.documentComments.id, comment.id));

    await expect(
      getDbExec().transaction!(async (tx) =>
        adapter.validateProposal({
          resourceType: "document",
          resourceId: documentId,
          baseRevision: before.baseRevision,
          operations: [operation],
          metadata: { commentAiRequestId: requestId },
          ctx: { transaction: tx, userEmail: ownerEmail },
        }),
      ),
    ).rejects.toThrow("comment changed");
  });

  it("accepts a system database Page and reconciles its primary Blocks identity", async () => {
    const { documentId, propertyId } = await seedSystemDatabasePage();
    const before = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );
    await getDbExec().transaction!(async (tx) => {
      await expect(
        adapter.validateProposal({
          resourceType: "document",
          resourceId: documentId,
          baseRevision: before.baseRevision,
          operations: [operation],
          ctx: { transaction: tx },
        }),
      ).resolves.toEqual([operation]);
    });

    let accepted!: Awaited<ReturnType<typeof accept>>;
    await getDbExec().transaction!(async (tx) => {
      accepted = await accept(documentId, tx, before.baseRevision);
    });

    const after = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );

    const db = getDb();
    const [document] = await db
      .select({
        content: schema.documents.content,
        collabBodyRevision: schema.documents.collabBodyRevision,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const [field] = await db
      .select()
      .from(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.propertyId, propertyId));
    const blocks = await db
      .select({ markdown: schema.documentBlocks.markdown })
      .from(schema.documentBlocks)
      .where(eq(schema.documentBlocks.fieldId, field!.id));

    expect(document?.content).toBe("After");
    expect(before.bodyRevision).toBe(0);
    expect(after.bodyRevision).toBe(1);
    expect(after.revision).not.toBe(before.revision);
    expect(after.collabContentRevision).toBe(after.revision);
    expect(document?.collabBodyRevision).toBe(1);
    expect(accepted.result).toMatchObject({
      revision: after.revision,
      baseRevision: after.baseRevision,
      bodyRevision: 1,
    });
    expect(field).toMatchObject({ documentId, propertyId, revision: 1 });
    expect(blocks).toEqual([{ markdown: "After" }]);
    expect(
      yDocToProsemirrorJSON(accepted.prepared.ydoc.doc, "default"),
    ).toMatchObject({
      content: [{ type: "paragraph", content: [{ text: "After" }] }],
    });

    await runWithRequestContext({ userEmail: ownerEmail }, () =>
      updateDocumentAction.run({ id: documentId, content: "Ordinary save" }),
    );
    const afterOrdinarySave = await runWithRequestContext(
      { userEmail: ownerEmail },
      () => getDocumentAction.run({ id: documentId }),
    );
    expect(afterOrdinarySave.bodyRevision).toBe(2);
    expect(afterOrdinarySave.collabContentRevision).toBeNull();
  });

  it("rolls back the collab marker and canonical writes when prepared Yjs persistence fails", async () => {
    const { documentId, propertyId } = await seedSystemDatabasePage();
    const prepared = coordination();
    prepared.ydoc.persist.mockRejectedValueOnce(
      new Error("forced Yjs persistence failure"),
    );
    await expect(
      getDbExec().transaction!(async (tx) => {
        await accept(documentId, tx, "rev-1", operation, prepared);
      }),
    ).rejects.toThrow("forced Yjs persistence failure");

    const db = getDb();
    const [document] = await db
      .select({
        content: schema.documents.content,
        collabBodyRevision: schema.documents.collabBodyRevision,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    const fields = await db
      .select()
      .from(schema.documentBlockFields)
      .where(eq(schema.documentBlockFields.propertyId, propertyId));
    expect(document?.content).toBe("Before");
    expect(document?.collabBodyRevision).toBeNull();
    expect(fields).toEqual([]);
  });

  it("rebases an older saved proposal across an unrelated canonical edit", async () => {
    const { documentId } = await seedSystemDatabasePage();
    await getDb()
      .update(schema.documents)
      .set({ content: "Intro\nBefore", bodyRevision: 1, updatedAt: "rev-2" })
      .where(eq(schema.documents.id, documentId));

    let accepted!: Awaited<ReturnType<typeof accept>>;
    await getDbExec().transaction!(async (tx) => {
      accepted = await accept(documentId, tx, "rev-1", contextualOperation);
    });

    const after = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }),
    );
    expect(after.content).toBe("Intro\nAfter");
    expect(after.bodyRevision).toBe(2);
    expect(accepted.result).toMatchObject({
      revision: after.revision,
      baseRevision: after.baseRevision,
      bodyRevision: 2,
    });
  });
});
