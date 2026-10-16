import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DbExec } from "@agent-native/core/db";
import type { ResourceSuggestion } from "@agent-native/core/review";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";

import { commentAnchorText } from "../../shared/comment-reanchor.js";
import { canonicalizeNfm } from "../../shared/nfm.js";
import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";
import type { LiveCopyBodyCommit } from "./suggestion-live-accept.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggestion-live-accept-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");
type Collab = typeof import("@agent-native/core/collab");

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let collab: Collab;
let binding: import("@agent-native/core/collab").LiveCopyBinding;
let runner: import("@agent-native/core/collab").BoundedTaskRunner;
let adapterKind: string;
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let createSuggestion: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion").default;
let createProposal: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let decideProposal: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal").default;
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

const ownerEmail = "live-accept-owner@example.com";
const ctx = { caller: "cli" as const, userEmail: ownerEmail };
let sequence = 0;

// What the stand-in for Content's body persist wrote, per commit attempt.
const bodyCommits = new WeakMap<DbExec, LiveCopyBodyCommit>();

beforeAll(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  createSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
  ).default;
  createProposal = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal")
  ).default;
  decideSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  decideProposal = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal")
  ).default;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();

  collab = await import("@agent-native/core/collab");
  runner = collab.createBoundedTaskRunner({
    source: await collab.bundleBoundedTaskSource(
      new URL(
        "../live-copy/__fixtures__/accept-live-copy-tasks.ts",
        import.meta.url,
      ),
    ),
    deadlineMs: 10_000,
    memoryLimitMb: 256,
  });
  const { followCommentAnchors } = await import("./comment-anchor-follow.js");
  binding = collab.defineLiveCopy({
    name: "live-accept-test",
    appliesTo: (docId) => docId.startsWith("live-accept-"),
    runner,
    async persist(tx, commit) {
      const [row] = (
        await tx.execute({
          sql: "SELECT content, body_revision FROM documents WHERE id = ? FOR UPDATE",
          args: [commit.docId],
        })
      ).rows;
      if (!row) throw new Error(`No page ${commit.docId}`);
      const before = String(row.content);
      const bodyRevision = Number(row.body_revision) + 1;
      const updatedAt = new Date().toISOString();
      await tx.execute({
        sql: "UPDATE documents SET content = ?, body_revision = ?, collab_body_revision = ?, updated_at = ? WHERE id = ?",
        args: [
          commit.text,
          bodyRevision,
          bodyRevision,
          updatedAt,
          commit.docId,
        ],
      });
      await followCommentAnchors(tx, {
        documentId: commit.docId,
        before,
        after: commit.text,
      });
      bodyCommits.set(tx, {
        before,
        after: commit.text,
        bodyRevision,
        updatedAt,
      });
    },
  });

  const review = await import("@agent-native/core/review");
  const {
    contentDocumentSuggestionAdapter,
    CONTENT_DOCUMENT_SUGGESTION_ADAPTER,
  } = await import("./suggested-edits.js");
  adapterKind = CONTENT_DOCUMENT_SUGGESTION_ADAPTER;
  const { acceptOnLiveCopy } = await import("./suggestion-live-accept.js");
  review.registerSuggestionAdapter({
    ...contentDocumentSuggestionAdapter,
    coordinateDecision: (context, run) =>
      acceptOnLiveCopy(
        context,
        run,
        {
          binding,
          bodyCommit: (tx) => bodyCommits.get(tx),
          withWriteCause: (_cause, write) => write(),
        },
        undefined,
      ),
  });
}, 120_000);

afterAll(async () => {
  if (binding) collab.releaseLiveCopy(binding);
  await runner?.close();
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
  if (previousSyncEventsEnabled === undefined)
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  else
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS =
      previousSyncEventsEnabled;
});

const page = [
  "# Plan",
  "",
  "The first paragraph sets the scene.",
  "",
  "The budget is $60 for the team.",
  "",
  "A closing paragraph sits here.",
].join("\n");

async function seedPage(markdown: string) {
  sequence += 1;
  const id = `live-accept-${sequence}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      title: "Live page",
      content: canonicalizeNfm(markdown),
      ownerEmail,
      bodyRevision: 1,
      collabBodyRevision: 1,
      liveBodySwitchedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  await collab.seedLiveCopy(binding, id, {
    source: canonicalizeNfm(markdown),
  });
  return id;
}

async function stored(documentId: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  return row!;
}

/** The live copy's version, and each top-level block's Yjs item and text. */
async function liveCopy(documentId: string) {
  const read = await collab.readLiveCopy(binding, documentId);
  if (read.kind !== "live") throw new Error(`live copy is ${read.kind}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, read.state);
  const blocks = doc
    .getXmlFragment("default")
    .toArray()
    .map((node) => ({
      item: JSON.stringify((node as Y.XmlElement)._item?.id),
      text: node.toString(),
    }));
  doc.destroy();
  return { version: read.version, text: read.text, blocks };
}

async function suggest(
  documentId: string,
  find: string,
  replace: string,
  metadata?: Record<string, unknown>,
) {
  const document = await getDocumentAction.run({ id: documentId }, ctx);
  sequence += 1;
  const [operation] = markdownSuggestionOperationsForFindReplace({
    before: document.content,
    find,
    replace,
    start: document.content.indexOf(find),
  });
  return createSuggestion.run(
    {
      resourceType: "document",
      resourceId: documentId,
      adapterKind,
      baseRevision: document.revision,
      summary: "Edit",
      idempotencyKey: `live-accept-suggestion-${sequence}`,
      operations: [operation!],
      ...(metadata ? { metadata } : {}),
    },
    ctx,
  );
}

function decide(
  suggestion: ResourceSuggestion,
  decision: "accepted" | "rejected",
  overrides: { idempotencyKey?: string; observedRevision?: number } = {},
) {
  return decideSuggestion.run(
    {
      id: suggestion.id,
      decision,
      idempotencyKey:
        overrides.idempotencyKey ?? `decide-${suggestion.id}-${decision}`,
      observedBase: suggestion.baseRevision,
      observedRevision: overrides.observedRevision ?? suggestion.revision,
    },
    ctx,
  );
}

function ownerIt(name: string, run: () => Promise<void>) {
  it(name, () => runWithRequestContext({ userEmail: ownerEmail }, run));
}

describe("accepting a suggestion on a Page written through its live copy", () => {
  ownerIt(
    "applies exactly its change once, and every block keeps its element",
    async () => {
      const documentId = await seedPage(page);
      const suggestion = await suggest(documentId, "sets the scene", "opens");
      const before = await liveCopy(documentId);
      const storedBefore = await stored(documentId);

      const result = await decide(suggestion, "accepted");
      expect(result.suggestion.status).toBe("accepted");
      const after = await liveCopy(documentId);
      expect(after.version).toBe(before.version + 1);
      expect(after.blocks.map((block) => block.item)).toEqual(
        before.blocks.map((block) => block.item),
      );
      after.blocks.forEach((block, index) => {
        if (index !== 1) expect(block.text).toBe(before.blocks[index]!.text);
      });
      const expected = canonicalizeNfm(page.replace("sets the scene", "opens"));
      expect(after.text).toBe(expected);
      expect(await stored(documentId)).toMatchObject({
        content: expected,
        bodyRevision: storedBefore.bodyRevision + 1,
      });

      // The same decision again replays without editing.
      expect((await decide(suggestion, "accepted")).suggestion.status).toBe(
        "accepted",
      );
      expect((await liveCopy(documentId)).version).toBe(after.version);
      expect((await stored(documentId)).content).toBe(expected);
    },
  );

  ownerIt("leaves the body and its live copy alone on reject", async () => {
    const documentId = await seedPage(page);
    const suggestion = await suggest(documentId, "sets the scene", "opens");
    const before = await liveCopy(documentId);
    const storedBefore = await stored(documentId);

    expect((await decide(suggestion, "rejected")).suggestion.status).toBe(
      "rejected",
    );
    expect(await liveCopy(documentId)).toEqual(before);
    expect(await stored(documentId)).toEqual(storedBefore);
  });

  ownerIt(
    "commits neither the edit nor the decision when the decision fails",
    async () => {
      const documentId = await seedPage(page);
      const suggestion = await suggest(documentId, "sets the scene", "opens");
      const before = await liveCopy(documentId);
      const storedBefore = await stored(documentId);

      await expect(
        decide(suggestion, "accepted", {
          observedRevision: suggestion.revision + 1,
        }),
      ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
      expect(await liveCopy(documentId)).toEqual(before);
      expect(await stored(documentId)).toEqual(storedBefore);
    },
  );

  ownerIt(
    "keeps a suggestion pending when an earlier accept rewrote its text",
    async () => {
      const documentId = await seedPage(page);
      const first = await suggest(documentId, "sets the scene", "opens");
      const second = await suggest(documentId, "the scene", "the stage");
      await decide(first, "accepted");
      const before = await liveCopy(documentId);

      await expect(decide(second, "accepted")).rejects.toMatchObject({
        errorCode: "suggestion_stale",
      });
      expect(await liveCopy(documentId)).toEqual(before);
      const { getSuggestion } = await import("@agent-native/core/review");
      expect((await getSuggestion(second.id))?.status).toBe("pending");
    },
  );

  ownerIt("accepts a proposal's members in one edit", async () => {
    const documentId = await seedPage(page);
    const document = await getDocumentAction.run({ id: documentId }, ctx);
    const find = "first paragraph sets the scene";
    const replace = "opening paragraph sets the whole scene";
    const operations = markdownSuggestionOperationsForFindReplace({
      before: document.content,
      find,
      replace,
      start: document.content.indexOf(find),
    });
    expect(operations.length).toBeGreaterThan(1);
    const created = await createProposal.run(
      {
        resourceType: "document",
        resourceId: documentId,
        adapterKind,
        baseRevision: document.revision,
        summary: "Edits",
        idempotencyKey: `live-accept-proposal-${documentId}`,
        suggestions: operations.map((operation, index) => ({
          summary: `Edit ${index + 1}`,
          operations: [operation],
        })),
      },
      ctx,
    );
    const before = await liveCopy(documentId);

    const result = await decideProposal.run(
      {
        proposalId: created.proposal.id,
        decision: "accepted",
        idempotencyKey: `decide-proposal-${documentId}`,
        members: created.suggestions.map((suggestion) => ({
          id: suggestion.id,
          observedRevision: suggestion.revision,
          observedBase: suggestion.baseRevision,
        })),
      },
      ctx,
    );
    expect(result.suggestions.map((suggestion) => suggestion.status)).toEqual(
      created.suggestions.map(() => "accepted"),
    );
    const after = await liveCopy(documentId);
    expect(after.version).toBe(before.version + 1);
    expect(after.text).toBe(canonicalizeNfm(page.replace(find, replace)));
    expect((await stored(documentId)).content).toBe(after.text);
  });

  ownerIt(
    "moves the stored anchor of a comment on text after the change",
    async () => {
      const documentId = await seedPage(page);
      const content = (await stored(documentId)).content;
      const text = commentAnchorText(content);
      const quote = "closing paragraph";
      const at = text.indexOf(quote);
      const created = "2026-10-01T00:00:00.000Z";
      await getDb()
        .insert(schema.documentComments)
        .values({
          id: `comment-${documentId}`,
          ownerEmail,
          documentId,
          threadId: `comment-${documentId}`,
          content: "Look at this",
          quotedText: quote,
          anchorPrefix: text.slice(Math.max(0, at - 32), at),
          anchorSuffix: text.slice(at + quote.length, at + quote.length + 32),
          anchorStartOffset: at,
          authorEmail: ownerEmail,
          createdAt: created,
          updatedAt: created,
        });
      const suggestion = await suggest(documentId, "sets the scene", "opens");
      await decide(suggestion, "accepted");

      const after = commentAnchorText((await stored(documentId)).content);
      const [comment] = await getDb()
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.id, `comment-${documentId}`));
      expect(comment).toMatchObject({
        quotedText: quote,
        anchorStartOffset: after.indexOf(quote),
        anchorPrefix: after.slice(
          Math.max(0, after.indexOf(quote) - 32),
          after.indexOf(quote),
        ),
        updatedAt: created,
      });
    },
  );
  ownerIt(
    "re-anchors the comment that asked for the suggestion onto its rewrite",
    async () => {
      const documentId = await seedPage(page);
      const text = commentAnchorText((await stored(documentId)).content);
      const quote = "sets the scene";
      const at = text.indexOf(quote);
      const now = new Date().toISOString();
      const comment = {
        id: `ai-comment-${documentId}`,
        ownerEmail,
        documentId,
        threadId: `ai-comment-${documentId}`,
        parentId: null,
        content: "Make this shorter",
        quotedText: quote,
        anchorPrefix: text.slice(Math.max(0, at - 32), at),
        anchorSuffix: text.slice(at + quote.length, at + quote.length + 32),
        anchorStartOffset: at,
        resolved: 0,
        authorEmail: ownerEmail,
        createdAt: now,
        updatedAt: now,
      };
      await getDb().insert(schema.documentComments).values(comment);
      const { commentThreadDigest } = await import("./comment-ai.js");
      const requestId = `ai-request-${documentId}`;
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
          baseRevision: "base-revision",
          suggestionRevision: now,
          createdAt: now,
          updatedAt: now,
        });
      const suggestion = await suggest(documentId, quote, "opens", {
        commentAiRequestId: requestId,
        sourceThreadId: comment.threadId,
      });
      await decide(suggestion, "accepted");

      const after = commentAnchorText((await stored(documentId)).content);
      const [anchored] = await getDb()
        .select()
        .from(schema.documentComments)
        .where(eq(schema.documentComments.id, comment.id));
      expect(anchored!.quotedText).toBe("opens");
      expect(anchored!.anchorStartOffset).toBe(after.indexOf("opens"));
    },
  );
});
