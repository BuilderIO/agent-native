import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

import {
  commentAnchorHoldsOn,
  commentAnchorText,
  commentAnchorTextOf,
} from "../../shared/comment-reanchor.js";
import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema.js";
import { materializeLiveBody } from "../../shared/live-body.js";
import { canonicalizeNfm, nfmToDoc } from "../../shared/nfm.js";
import { markdownSuggestionOperationsForFindReplace } from "../../shared/suggestion-diff.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-switch-rebaseline-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let collab: typeof import("@agent-native/core/collab");
let switching: typeof import("./switch.js");
let contentLiveCopy: typeof import("./binding.js").contentLiveCopy;
let setSwitch: typeof import("../../actions/set-live-body-switch.js").default;
let getDocumentAction: typeof import("../../actions/get-document.js").default;
let createSuggestion: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let listSuggestions: typeof import("@agent-native/core/review/suggestions/actions/list-resource-suggestions").default;
let adapterKind: string;
const previousSyncEventsEnabled =
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;

const ownerEmail = "switch-rebaseline-owner@example.com";
const ctx = { caller: "cli" as const, userEmail: ownerEmail };
const editorSchema = createContentEditorStructuralSchema();
let sequence = 0;

beforeAll(async () => {
  process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS = "1";
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  registerFeatureFlags(
    (await import("../../shared/feature-flags.js")).CONTENT_FEATURE_FLAGS,
  );
  for (const flag of ["content.live-body-shadow", "content.live-body-writer"])
    await putSetting(`feature-flag:${flag}`, {
      version: 1,
      mode: "rules",
      emails: [ownerEmail],
      orgIds: [],
      percentage: 0,
      updatedAt: null,
      updatedBy: null,
    });
  collab = await import("@agent-native/core/collab");
  switching = await import("./switch.js");
  contentLiveCopy = (await import("./binding.js")).contentLiveCopy;
  setSwitch = (await import("../../actions/set-live-body-switch.js")).default;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
  createSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion")
  ).default;
  decideSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  listSuggestions = (
    await import("@agent-native/core/review/suggestions/actions/list-resource-suggestions")
  ).default;
  adapterKind = (await import("../lib/suggested-edits.js"))
    .CONTENT_DOCUMENT_SUGGESTION_ADAPTER;
}, 120_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
  if (previousSyncEventsEnabled === undefined)
    delete process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS;
  else
    process.env.AGENT_NATIVE_SYNC_EVENTS_ENABLE_IN_TESTS =
      previousSyncEventsEnabled;
});

function asOwner<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: ownerEmail }, run);
}

// An agent wrote this page through the legacy writer: `$60` and the blank
// lines are not how the live copy writes it.
const stored = [
  "The first paragraph sets the scene.",
  "",
  "The budget is $60 for the team.",
  "",
  "A closing paragraph sits here.",
].join("\n");

async function insertPage(content: string) {
  sequence += 1;
  const id = `switch-rebaseline-${sequence}`;
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    title: "Legacy page",
    content,
    ownerEmail,
    bodyRevision: 1,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function page(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row!;
}

/** The tree browsers load, and its text. */
async function browsersTree(id: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, await collab.getState(id));
  const body = materializeLiveBody(doc);
  doc.destroy();
  if (body.kind !== "body") throw new Error(`browsers' body is ${body.kind}`);
  return {
    markdown: body.markdown,
    text: commentAnchorTextOf(body.root.toJSON()),
  };
}

/** Each top-level block of the live copy: its Yjs item and its text. */
async function liveBlocks(id: string) {
  const read = await collab.readLiveCopy(contentLiveCopy, id);
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
  return blocks;
}

async function collabVersion(id: string) {
  const { rows } = await (
    await import("@agent-native/core/db")
  )
    .getDbExec()
    .execute({
      sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
      args: [id],
    });
  return rows[0] === undefined ? undefined : Number(rows[0].version);
}

/**
 * A tab opened the legacy page and typed a paragraph above its body. Its
 * save hasn't reached the stored body, so the live copy holds text the
 * stored body lacks.
 */
async function typeAboveInTab(id: string, content: string, typed: string) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const { meta } = initProseMirrorDoc(fragment, editorSchema);
  const root = editorSchema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: typed }] },
      ...(nfmToDoc(content).content ?? []),
    ],
  });
  updateYFragment(doc, fragment, root, meta);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  await asOwner(() => collab.applyUpdate(id, update));
}

/** A comment the tab added on `quote`, captured from the text it showed. */
async function commentInTab(documentId: string, text: string, quote: string) {
  const at = text.indexOf(quote);
  if (at < 0 || text.indexOf(quote, at + 1) >= 0)
    throw new Error(`"${quote}" is not once in the tab's text`);
  sequence += 1;
  const id = `comment-${sequence}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentComments)
    .values({
      id,
      ownerEmail,
      documentId,
      threadId: `thread-${id}`,
      content: "Is this right?",
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

async function comment(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, id));
  return {
    quotedText: row!.quotedText ?? "",
    prefix: row!.anchorPrefix,
    suffix: row!.anchorSuffix,
    startOffset: row!.anchorStartOffset,
  };
}

/** An agent's suggestion on the stored body, as get-document serves it. */
async function suggest(documentId: string, find: string, replace: string) {
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
      idempotencyKey: `switch-rebaseline-suggestion-${sequence}`,
      operations: [operation!],
    },
    ctx,
  );
}

async function pending(documentId: string) {
  return (
    await listSuggestions.run(
      { resourceType: "document", resourceId: documentId },
      ctx,
    )
  ).suggestions.filter((suggestion) => suggestion.status === "pending");
}

async function startCommentAi(documentId: string) {
  const now = new Date().toISOString();
  const id = `ai-${documentId}`;
  await getDb().insert(schema.commentAiRequests).values({
    id,
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
  return id;
}

describe("switching a page moves its suggestions and comment quotes onto the live copy's body", () => {
  it("accepts a suggestion made on the stored body at its place, and keeps a tab's comment on its words", async () => {
    await asOwner(async () => {
      const documentId = await insertPage(stored);
      await typeAboveInTab(documentId, stored, "A note typed in a tab.");
      const commentId = await commentInTab(
        documentId,
        (await browsersTree(documentId)).text,
        "closing paragraph",
      );
      // It reads `$60`, which the live copy writes `\$60`.
      const made = await suggest(documentId, "$60", "$75");

      await expect(
        switching.switchPageToLiveCopy(documentId, { ctx }),
      ).resolves.toEqual({ writePath: "live_copy" });
      const canonical = canonicalizeNfm(stored);
      expect(canonical).not.toBe(stored);
      expect((await page(documentId)).content).toBe(canonical);
      expect(
        commentAnchorHoldsOn(
          await comment(commentId),
          (await browsersTree(documentId)).text,
        ),
      ).toBe(true);

      // The suggestion now reads the body the page holds.
      const [suggestion] = await pending(documentId);
      expect(suggestion).toMatchObject({
        id: made.id,
        baseRevision: (await getDocumentAction.run({ id: documentId }, ctx))
          .revision,
      });
      const before = await liveBlocks(documentId);
      const result = await decideSuggestion.run(
        {
          id: suggestion!.id,
          decision: "accepted",
          idempotencyKey: `accept-${suggestion!.id}`,
          observedBase: suggestion!.baseRevision,
          observedRevision: suggestion!.revision,
        },
        ctx,
      );
      expect(result.suggestion.status).toBe("accepted");
      const expected = canonicalizeNfm(stored.replace("$60", "$75"));
      expect((await page(documentId)).content).toBe(expected);
      // Only the block it changed was rewritten, in place.
      const after = await liveBlocks(documentId);
      expect(after.map((block) => block.item)).toEqual(
        before.map((block) => block.item),
      );
      expect(after.map((block) => block.text)).toEqual(
        before.map((block, index) =>
          index === 1 ? block.text.replace("60", "75") : block.text,
        ),
      );
      const tree = await browsersTree(documentId);
      expect(tree.markdown).toBe(expected);
      expect(commentAnchorHoldsOn(await comment(commentId), tree.text)).toBe(
        true,
      );
    });
  });

  it("refuses a switch while Comment AI works on the page, with a typed 409, and commits nothing", async () => {
    await asOwner(async () => {
      const documentId = await insertPage(stored);
      await typeAboveInTab(documentId, stored, "A note typed in a tab.");
      await suggest(documentId, "sets the scene", "opens");
      const requestId = await startCommentAi(documentId);
      const before = {
        page: await page(documentId),
        version: await collabVersion(documentId),
        suggestions: await pending(documentId),
      };

      await expect(
        setSwitch.run(
          { id: documentId, switched: true },
          { caller: "frontend", userEmail: ownerEmail },
        ),
      ).rejects.toMatchObject({
        errorCode: "LIVE_BODY_SWITCH_BLOCKED",
        statusCode: 409,
        details: { reason: "comment_ai_active", ids: [requestId] },
      });
      expect(await page(documentId)).toEqual(before.page);
      expect(await collabVersion(documentId)).toBe(before.version);
      expect(await pending(documentId)).toEqual(before.suggestions);
    });
  });

  it("refuses a switch whose live copy already holds the body, too", async () => {
    await asOwner(async () => {
      const documentId = await insertPage(canonicalizeNfm(stored));
      await expect(switching.switchPageToLiveCopy(documentId)).resolves.toEqual(
        { writePath: "live_copy" },
      );
      await switching.switchPageToLegacy(documentId);
      const requestId = await startCommentAi(documentId);
      const before = {
        page: await page(documentId),
        version: await collabVersion(documentId),
      };

      await expect(
        switching.switchPageToLiveCopy(documentId),
      ).rejects.toMatchObject({
        name: "LiveBodyConversionError",
        code: "rebaseline_blocked",
        blocked: { reason: "comment_ai_active", ids: [requestId] },
      });
      expect(await page(documentId)).toEqual(before.page);
      expect(await collabVersion(documentId)).toBe(before.version);
    });
  });
});
