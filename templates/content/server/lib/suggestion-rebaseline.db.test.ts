import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { commentAnchorText } from "../../shared/comment-reanchor.js";
import { canonicalizeNfm } from "../../shared/nfm.js";
import { applyMarkdownSuggestionOperation } from "../../shared/suggestion-apply.js";
import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-suggestion-rebaseline-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");
type DbExec = import("@agent-native/core/db").DbExec;

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let getDbExec: typeof import("@agent-native/core/db").getDbExec;
let adapterKind: string;
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let documentRevisionToken: typeof import("../../actions/_document-edit-mutation.js").documentRevisionToken;
let rebaselinePageForCanonicalBody: typeof import("./suggestion-rebaseline.js").rebaselinePageForCanonicalBody;
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

beforeAll(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDbExec = (await import("@agent-native/core/db")).getDbExec;
  adapterKind = (await import("./suggested-edits.js"))
    .CONTENT_DOCUMENT_SUGGESTION_ADAPTER;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  documentRevisionToken = (
    await import("../../actions/_document-edit-mutation.js")
  ).documentRevisionToken;
  rebaselinePageForCanonicalBody = (await import("./suggestion-rebaseline.js"))
    .rebaselinePageForCanonicalBody;
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
const ctx = { caller: "cli" as const, userEmail: ownerEmail };
let sequence = 0;

// One page as an agent sends it, with every known difference from the
// canonical form, and one change to suggest on each.
const agentPage = [
  String.raw`Run snake\_case\_name first.`,
  "",
  "Keep __bold words__ here.",
  "",
  "It costs $60 today.",
  "",
  "|  Name  | Cost |",
  "| --- | --- |",
  "|  Tea  | $5 |",
  "",
  "",
  "",
  "A closing line sits here.",
].join("\n");

const changes = [
  { find: "first", replace: "last" },
  { find: "here.", replace: "there." },
  { find: "today", replace: "now" },
  { find: "Tea", replace: "Coffee" },
  { find: "closing line", replace: "final line" },
];

async function seedPage(content: string) {
  sequence += 1;
  const documentId = `rebaseline-page-${sequence}`;
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: documentId,
    title: "Agent page",
    content,
    ownerEmail,
    createdAt: now,
    updatedAt: now,
  });
  return documentId;
}

function operationFor(before: string, find: string, replace: string) {
  const start = before.indexOf(find);
  if (start < 0) throw new Error(`"${find}" is not in the page`);
  const operations = markdownSuggestionOperationsForFindReplace({
    before,
    find,
    replace,
    start,
  });
  expect(operations).toHaveLength(1);
  return operations[0]!;
}

async function suggest(
  documentId: string,
  edits: { find: string; replace: string }[],
  key: string,
) {
  const document = await getDocumentAction.run({ id: documentId }, ctx);
  return (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal")
  ).default.run(
    {
      resourceType: "document",
      resourceId: documentId,
      adapterKind,
      baseRevision: document.revision,
      summary: "Agent edits",
      idempotencyKey: key,
      suggestions: edits.map((edit, index) => ({
        summary: `Edit ${index + 1}`,
        operations: [operationFor(document.content, edit.find, edit.replace)],
      })),
    },
    ctx,
  );
}

async function pendingSuggestions(documentId: string) {
  return (
    await (
      await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
    ).default.run({ resourceType: "document", resourceId: documentId }, ctx)
  ).suggestions.filter((suggestion) => suggestion.status === "pending");
}

async function addComment(documentId: string, text: string, quote: string) {
  const at = text.indexOf(quote);
  if (at < 0) throw new Error(`"${quote}" is not in the page text`);
  const id = `comment-${documentId}-${at}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentComments)
    .values({
      id,
      ownerEmail,
      documentId,
      threadId: `thread-${id}`,
      content: "Look at this",
      quotedText: quote,
      anchorPrefix: text.slice(Math.max(0, at - 32), at),
      anchorSuffix: text.slice(at + quote.length, at + quote.length + 32),
      anchorStartOffset: at,
      authorEmail: ownerEmail,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

/** Converts the page the way L6b does, with the re-baseline inside it. */
async function convert(documentId: string, previousLiveText: string | null) {
  return getDbExec().transaction!(async (tx: DbExec) => {
    const row = (
      await tx.execute({
        sql: "SELECT content, body_revision FROM documents WHERE id = ? FOR UPDATE",
        args: [documentId],
      })
    ).rows[0]!;
    const stored = String(row.content);
    const bodyRevision = Number(row.body_revision);
    const canonical = canonicalizeNfm(stored);
    const now = new Date().toISOString();
    const report = await rebaselinePageForCanonicalBody(tx, {
      documentId,
      stored,
      canonical,
      storedRevision: documentRevisionToken(bodyRevision, stored),
      canonicalRevision: documentRevisionToken(bodyRevision + 1, canonical),
      previousLiveText,
      now,
    });
    if (report.status !== "rebaselined") return report;
    await tx.execute({
      sql: "UPDATE documents SET content = ?, body_revision = ?, updated_at = ? WHERE id = ?",
      args: [canonical, bodyRevision + 1, now, documentId],
    });
    return report;
  });
}

describe("rebaselinePageForCanonicalBody", () => {
  it("keeps every pending suggestion on an agent page acceptable after conversion", async () => {
    const documentId = await seedPage(agentPage);
    await runWithRequestContext({ userEmail: ownerEmail }, async () => {
      await suggest(documentId, changes.slice(0, 3), `agent-a-${documentId}`);
      await suggest(documentId, changes.slice(3), `agent-b-${documentId}`);
      const before = await pendingSuggestions(documentId);
      expect(before).toHaveLength(changes.length);

      const report = await convert(documentId, null);
      expect(report).toMatchObject({ status: "rebaselined" });
      if (report.status !== "rebaselined") return;
      expect(report.suggestions.map(({ outcome }) => outcome)).toEqual(
        changes.map(() => "rebased"),
      );

      const canonical = canonicalizeNfm(agentPage);
      const page = await getDocumentAction.run({ id: documentId }, ctx);
      expect(page.content).toBe(canonical);
      const after = await pendingSuggestions(documentId);
      for (const suggestion of after) {
        const previous = before.find((entry) => entry.id === suggestion.id)!;
        expect(suggestion.revision).toBe(previous.revision + 1);
        expect(suggestion.baseRevision).toBe(page.revision);
        expect(
          (suggestion.operations[0]!.before as { markdown: string }).markdown,
        ).toBe(canonical);
      }

      // Each one accepts exactly its own change; none turns stale.
      let expected = agentPage;
      for (const suggestion of after) {
        const result = await (
          await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
        ).default.run(
          {
            id: suggestion.id,
            decision: "accepted",
            idempotencyKey: `accept-${suggestion.id}`,
            observedBase: suggestion.baseRevision,
            observedRevision: suggestion.revision,
          },
          ctx,
        );
        expect(result.suggestion.status).toBe("accepted");
        const original = before.find((entry) => entry.id === suggestion.id)!;
        expected = applyMarkdownSuggestionOperation(
          expected,
          original.operations[0]!,
        )!;
      }
      const accepted = await getDocumentAction.run({ id: documentId }, ctx);
      expect(canonicalizeNfm(accepted.content)).toBe(canonicalizeNfm(expected));
    });
  });

  it("leaves comment quotes alone when conversion doesn't change the page text", async () => {
    const documentId = await seedPage(agentPage);
    const text = commentAnchorText(agentPage);
    const commentId = await addComment(
      documentId,
      text,
      text.slice(text.indexOf("snake"), text.indexOf(" first")),
    );
    const report = await convert(documentId, null);
    expect(report).toMatchObject({
      status: "rebaselined",
      comments: [{ id: commentId, outcome: "unchanged" }],
    });
  });

  it("moves a comment quote onto the text the converted page shows", async () => {
    // The live copy showed the underscores as text; the canonical body bolds.
    const previousText = "Keep __bold words__ here.";
    const documentId = await seedPage("Keep **bold words** here.");
    const commentId = await addComment(
      documentId,
      previousText,
      "__bold words__ here",
    );
    const report = await convert(documentId, previousText);
    expect(report).toMatchObject({
      status: "rebaselined",
      comments: [{ id: commentId, outcome: "rebased" }],
    });
    const [comment] = await getDb()
      .select()
      .from(schema.documentComments)
      .where(
        (await import("drizzle-orm")).eq(schema.documentComments.id, commentId),
      );
    expect(comment).toMatchObject({
      quotedText: "bold words here",
      anchorPrefix: "Keep ",
      anchorSuffix: ".",
      anchorStartOffset: 5,
    });
  });

  it("refuses to convert while Comment AI is working on the page", async () => {
    const documentId = await seedPage(agentPage);
    await runWithRequestContext({ userEmail: ownerEmail }, () =>
      suggest(documentId, changes.slice(0, 1), `agent-ai-${documentId}`),
    );
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.commentAiRequests)
      .values({
        id: `ai-${documentId}`,
        ownerEmail,
        requesterEmail: ownerEmail,
        documentId,
        threadId: "thread-ai",
        rootCommentId: "comment-ai",
        fieldId: "body",
        intent: "edit",
        status: "running",
        threadDigest: "digest",
        snapshotJson: "{}",
        baseRevision: "rev",
        suggestionRevision: "rev",
        createdAt: now,
        updatedAt: now,
      });
    const before = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      pendingSuggestions(documentId),
    );
    expect(await convert(documentId, null)).toEqual({
      status: "blocked",
      reason: "comment_ai_active",
      ids: [`ai-${documentId}`],
    });
    const after = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      pendingSuggestions(documentId),
    );
    expect(after).toEqual(before);
    const page = await runWithRequestContext({ userEmail: ownerEmail }, () =>
      getDocumentAction.run({ id: documentId }, ctx),
    );
    expect(page.content).toBe(agentPage);
  });

  it("refuses to convert when a comment quote would become different words", async () => {
    const documentId = await seedPage("The dog sat on the mat.");
    const previousText = "The cat sat on the mat.";
    const commentId = await addComment(documentId, previousText, "cat sat");
    expect(await convert(documentId, previousText)).toEqual({
      status: "blocked",
      reason: "comment_quote_changes",
      ids: [commentId],
    });
  });
});
