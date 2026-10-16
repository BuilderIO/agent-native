import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resolveAnchor } from "../../app/components/editor/comment-anchors.js";
import { commentAnchorText } from "../../shared/comment-reanchor.js";
import { nfmToDoc } from "../../shared/nfm.js";
import { suggestionEditorSchema } from "../../shared/suggestion-apply.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-anchor-follow-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let getDbExec: typeof import("@agent-native/core/db").getDbExec;
let followCommentAnchors: typeof import("./comment-anchor-follow.js").followCommentAnchors;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  getDbExec = (await import("@agent-native/core/db")).getDbExec;
  followCommentAnchors = (await import("./comment-anchor-follow.js"))
    .followCommentAnchors;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

const ownerEmail = "owner@example.com";
const created = "2026-10-01T00:00:00.000Z";
let sequence = 0;

const page = "Keep the plan here.\n\nMove the plan there.";

/** A comment on the last copy of `quote`, captured from `markdown`. */
async function addComment(markdown: string, quote: string) {
  sequence += 1;
  const documentId = `follow-page-${sequence}`;
  const id = `follow-comment-${sequence}`;
  const text = commentAnchorText(markdown);
  const at = text.lastIndexOf(quote);
  await getDb()
    .insert(schema.documentComments)
    .values({
      id,
      ownerEmail,
      documentId,
      threadId: id,
      content: "Look at this",
      quotedText: quote,
      anchorPrefix: text.slice(Math.max(0, at - 32), at),
      anchorSuffix: text.slice(at + quote.length, at + quote.length + 32),
      anchorStartOffset: at,
      authorEmail: ownerEmail,
      createdAt: created,
      updatedAt: created,
    });
  return { documentId, id };
}

async function commentRow(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documentComments)
    .where(eq(schema.documentComments.id, id));
  return row!;
}

function commit(documentId: string, before: string, after: string) {
  return getDbExec().transaction!((tx) =>
    followCommentAnchors(tx, { documentId, before, after }),
  );
}

/** Where a tab opening `markdown` puts the comment's highlight, as text offset. */
function highlightOffset(
  markdown: string,
  anchor: {
    quotedText: string | null;
    anchorPrefix: string | null;
    anchorSuffix: string | null;
    anchorStartOffset: number | null;
  },
) {
  const doc = suggestionEditorSchema().nodeFromJSON(nfmToDoc(markdown));
  const range = resolveAnchor(doc, {
    quotedText: anchor.quotedText,
    prefix: anchor.anchorPrefix ?? undefined,
    suffix: anchor.anchorSuffix ?? undefined,
    startOffset: anchor.anchorStartOffset ?? undefined,
  });
  if (!range) throw new Error("The anchor does not resolve");
  return doc.textBetween(0, range.from, "").length;
}

describe("followCommentAnchors", () => {
  it("keeps a tab opened later on the copy open tabs highlight", async () => {
    // Each step is one commit. Afterwards the first copy's context reads like
    // the context the comment was captured with.
    const steps = [
      page,
      "Keep the plan here.\n\nShift the plan there.",
      "Move the plan there.\n\nShift the plan there.",
    ];
    const { documentId, id } = await addComment(page, "the plan");
    const captured = await commentRow(id);
    for (const [index, next] of steps.slice(1).entries())
      expect(await commit(documentId, steps[index]!, next)).toEqual([id]);

    const final = steps[2]!;
    const own = commentAnchorText(final).lastIndexOf("the plan");
    const followed = await commentRow(id);
    expect(highlightOffset(final, followed)).toBe(own);
    // The anchor as captured would open on the other copy.
    expect(highlightOffset(final, captured)).not.toBe(own);
    expect(followed.quotedText).toBe("the plan");
    expect(followed.updatedAt).toBe(created);
  });

  it("leaves the anchor of a quote the commit cut into", async () => {
    const { documentId, id } = await addComment(page, "the plan");
    const captured = await commentRow(id);
    const next = page.replace("Move the plan", "Move the new plan");
    expect(await commit(documentId, page, next)).toEqual([]);
    expect(await commentRow(id)).toEqual(captured);
  });

  it("does nothing when the commit leaves the page's text alone", async () => {
    const { documentId, id } = await addComment(page, "the plan");
    const captured = await commentRow(id);
    const next = page.replace("Keep", "**Keep**");
    expect(await commit(documentId, page, next)).toEqual([]);
    expect(await commentRow(id)).toEqual(captured);
  });

  it("skips a thread while a Comment AI request works on it", async () => {
    const { documentId, id } = await addComment(page, "the plan");
    const captured = await commentRow(id);
    const requestId = `follow-request-${sequence}`;
    await getDb().insert(schema.commentAiRequests).values({
      id: requestId,
      ownerEmail,
      requesterEmail: ownerEmail,
      documentId,
      threadId: id,
      rootCommentId: id,
      fieldId: "body",
      intent: "reply",
      status: "running",
      threadDigest: "digest",
      snapshotJson: "[]",
      baseRevision: "base-revision",
      suggestionRevision: created,
      createdAt: created,
      updatedAt: created,
    });
    const next = `Intro.\n\n${page}`;
    expect(await commit(documentId, page, next)).toEqual([]);
    expect(await commentRow(id)).toEqual(captured);

    await getDb()
      .update(schema.commentAiRequests)
      .set({ status: "replied" })
      .where(eq(schema.commentAiRequests.id, requestId));
    expect(await commit(documentId, page, next)).toEqual([id]);
    expect(await commentRow(id)).toMatchObject({
      anchorPrefix: "Intro.Keep the plan here.Move ",
      anchorStartOffset: captured.anchorStartOffset! + "Intro.".length,
    });
  });
});
