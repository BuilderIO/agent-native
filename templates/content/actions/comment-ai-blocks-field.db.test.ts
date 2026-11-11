import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { firstRow } from "../server/lib/first-row.js";
import {
  blocksFieldSuggestionRevision,
  CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
} from "../shared/blocks-field-suggestions.js";
import { markdownSuggestionOperation } from "../shared/suggestion-diff.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));
vi.mock("../server/lib/comment-notifications.js", () => ({
  notifyDocumentComment: vi.fn(async () => false),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `content-comment-ai-blocks-field-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const ctx = { caller: "frontend" as const, userEmail: OWNER };
const toolCtx = { caller: "tool" as const, userEmail: OWNER };

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createContentDatabase: typeof import("./create-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let listDocumentProperties: typeof import("./list-document-properties.js").default;
let addComment: typeof import("./add-comment.js").default;
let commentAi: typeof import("../server/lib/comment-ai.js");
let getContext: typeof import("./get-comment-ai-context.js").default;
let createAiSuggestion: typeof import("./create-comment-ai-suggestion.js").default;
let replyRequest: typeof import("./reply-to-comment-ai-request.js").default;
let createProposal: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let getSuggestion: typeof import("@agent-native/core/review/suggestions/actions/get-resource-suggestion").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createContentDatabase = (await import("./create-content-database.js"))
    .default;
  configureDocumentProperty = (await import("./configure-document-property.js"))
    .default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  addDatabaseItem = (await import("./add-database-item.js")).default;
  setDocumentProperty = (await import("./set-document-property.js")).default;
  listDocumentProperties = (await import("./list-document-properties.js"))
    .default;
  addComment = (await import("./add-comment.js")).default;
  commentAi = await import("../server/lib/comment-ai.js");
  getContext = (await import("./get-comment-ai-context.js")).default;
  createAiSuggestion = (await import("./create-comment-ai-suggestion.js"))
    .default;
  replyRequest = (await import("./reply-to-comment-ai-request.js")).default;
  createProposal = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal")
  ).default;
  decideSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  getSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/get-resource-suggestion")
  ).default;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  await (
    await import("../server/plugins/suggested-edits.js")
  ).default(undefined as never);
}, 180_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function as<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER, orgId: null }, run);
}

/** Runs `run` as the Ask AI agent working on request `requestId`. */
function asAgent<T>(
  requestId: string,
  agentThreadId: string,
  run: () => Promise<T>,
) {
  return runWithRequestContext(
    {
      userEmail: OWNER,
      orgId: null,
      run: {
        actionScope: { kind: "content-comment-ai", requestId },
        threadId: agentThreadId,
        runId: `run-${requestId}`,
        model: "openai/gpt-5.6-sol",
      },
    },
    run,
  );
}

function present<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Fixture is missing ${what}.`);
  return value;
}

/** A Collection with its body field and a "Notes" field, and one row. */
async function seedRow(suffix: string, body: string, notes: string) {
  return as(async () => {
    const created = await createContentDatabase.run({
      title: `Board ${suffix}`,
    });
    const databaseId = created.database.id;
    const configured = await configureDocumentProperty.run({
      documentId: created.database.documentId,
      databaseId,
      name: "Notes",
      type: "blocks",
    });
    const blocks = configured.properties.filter(
      (property) => property.definition.type === "blocks",
    );
    const primaryId = present(
      blocks.find(
        (property) => property.definition.options.blocks?.primary === true,
      ),
      "the body's Blocks field",
    ).definition.id;
    const notesId = present(
      blocks.find((property) => property.definition.name === "Notes"),
      "the Notes field",
    ).definition.id;
    const read = await getContentDatabase.run({ databaseId });
    if (!("database" in read) || !read.mutationContract)
      throw new Error("Fixture Collection has no mutation contract.");
    const added = await addDatabaseItem.run({
      target: read.mutationContract.target,
      expectedSchemaRevision: read.mutationContract.schemaRevision,
      idempotencyKey: `comment-ai-blocks-field-${suffix}`,
      title: "Row",
    });
    const row = added.receipt.row.documentId as string;
    await setDocumentProperty.run(
      { documentId: row, databaseId, propertyId: primaryId, value: body },
      ctx,
    );
    await setDocumentProperty.run(
      { documentId: row, databaseId, propertyId: notesId, value: notes },
      ctx,
    );
    return { databaseId, row, primaryId, notesId };
  });
}

async function fieldState(row: string, databaseId: string, fieldId: string) {
  const listed = await as(() =>
    listDocumentProperties.run({ documentId: row, databaseId }),
  );
  const property = present(
    listed.properties.find((candidate) => candidate.definition.id === fieldId),
    `field ${fieldId}`,
  );
  const stored = firstRow(
    await getDb()
      .select({ content: schema.documentBlockFieldContents.content })
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(schema.documentBlockFieldContents.documentId, row),
          eq(schema.documentBlockFieldContents.propertyId, fieldId),
        ),
      ),
  );
  return {
    content: stored?.content ?? "",
    revision: property.blocksField?.revision ?? 0,
  };
}

async function pageBody(row: string) {
  return firstRow(
    await getDb()
      .select({ content: schema.documents.content })
      .from(schema.documents)
      .where(eq(schema.documents.id, row)),
  )?.content;
}

async function storedComment(id: string) {
  return firstRow(
    await getDb()
      .select()
      .from(schema.documentComments)
      .where(eq(schema.documentComments.id, id)),
  );
}

async function storedRequest(id: string) {
  return firstRow(
    await getDb()
      .select()
      .from(schema.commentAiRequests)
      .where(eq(schema.commentAiRequests.id, id)),
  );
}

/** A new thread quoting `quotedText` in `fieldId`'s tab, or the body. */
function thread(row: string, quotedText: string, fieldId?: string) {
  return as(() =>
    addComment.run(
      {
        documentId: row,
        content: "Make it a dog",
        quotedText,
        ...(fieldId ? { fieldId } : {}),
      },
      ctx,
    ),
  );
}

function start(
  requestId: string,
  root: { id: string; threadId: string },
  row: string,
  intent: "reply" | "suggest" | "apply-resolve",
) {
  return as(() =>
    commentAi.startCommentAiRequest({
      requestId,
      agentThreadId: `agent-thread-${requestId}`,
      documentId: row,
      threadId: root.threadId,
      rootCommentId: root.id,
      intent,
    }),
  );
}

describe("Ask AI on a Blocks field tab's thread", () => {
  it("reads the tab, suggests its edit there, and accepting it moves the thread's quote", async () => {
    const seeded = await seedRow(
      "suggest",
      "The body stays as it is.",
      "The cat sat on the mat.",
    );
    const notes = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    const root = await thread(seeded.row, "cat", seeded.notesId);
    const requestId = "11111111-1111-4111-8111-111111111111";
    const started = await start(requestId, root, seeded.row, "suggest");
    expect(await storedRequest(requestId)).toMatchObject({
      fieldId: seeded.notesId,
      suggestionRevision: blocksFieldSuggestionRevision(
        seeded.notesId,
        notes.revision,
      ),
    });

    const context = await asAgent(requestId, started.agentThreadId, () =>
      getContext.run({}, toolCtx),
    );
    expect(context).toMatchObject({
      fieldId: seeded.notesId,
      field: { fieldId: seeded.notesId, fieldName: "Notes" },
      content: notes.content,
    });
    const attemptId = (context as { attemptId: string }).attemptId;

    const result = await asAgent(requestId, started.agentThreadId, () =>
      createAiSuggestion.run(
        {
          attemptId,
          summary: "Changes the cat to a dog.",
          edits: [{ find: "cat", replace: "dog" }],
        },
        toolCtx,
      ),
    );
    expect(result).toMatchObject({ status: "suggested" });
    const suggestionId = present(
      result.result?.suggestionId,
      "the suggestion's id",
    );
    const suggestion = await as(() =>
      getSuggestion.run({ id: suggestionId }, ctx),
    );
    expect(suggestion).toMatchObject({
      adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
      baseRevision: blocksFieldSuggestionRevision(
        seeded.notesId,
        notes.revision,
      ),
      metadata: expect.objectContaining({
        commentAiRequestId: requestId,
        sourceThreadId: root.threadId,
      }),
      operations: [expect.objectContaining({ targetId: seeded.notesId })],
    });

    await as(() =>
      decideSuggestion.run(
        {
          id: suggestionId,
          decision: "accepted",
          idempotencyKey: `accept-${suggestionId}`,
          observedBase: suggestion.baseRevision,
          observedRevision: suggestion.revision,
        },
        ctx,
      ),
    );
    expect(
      (await fieldState(seeded.row, seeded.databaseId, seeded.notesId)).content,
    ).toBe(notes.content.replace("cat", "dog"));
    expect(await pageBody(seeded.row)).toContain("The body stays as it is.");
    expect(await storedComment(root.id)).toMatchObject({
      fieldId: seeded.notesId,
      quotedText: "dog",
    });
  });

  it("reads the tab again when it changes while the AI works on a reply", async () => {
    const seeded = await seedRow(
      "reply",
      "The body stays as it is.",
      "The cat sat on the mat.",
    );
    const root = await thread(seeded.row, "cat", seeded.notesId);
    const requestId = "22222222-2222-4222-8222-222222222222";
    const started = await start(requestId, root, seeded.row, "reply");
    const first = (await asAgent(requestId, started.agentThreadId, () =>
      getContext.run({}, toolCtx),
    )) as { attemptId: string };

    await as(() =>
      setDocumentProperty.run(
        {
          documentId: seeded.row,
          databaseId: seeded.databaseId,
          propertyId: seeded.notesId,
          value: "The cat sat on the new mat.",
        },
        ctx,
      ),
    );
    expect(
      await asAgent(requestId, started.agentThreadId, () =>
        replyRequest.run(
          { attemptId: first.attemptId, content: "A stale answer" },
          toolCtx,
        ),
      ),
    ).toMatchObject({ refreshRequired: true, errorCode: "page_changed" });

    const second = (await asAgent(requestId, started.agentThreadId, () =>
      getContext.run({}, toolCtx),
    )) as { attemptId: string; content: string };
    expect(second.content).toContain("the new mat");
    expect(
      await asAgent(requestId, started.agentThreadId, () =>
        replyRequest.run(
          { attemptId: second.attemptId, content: "A fresh answer" },
          toolCtx,
        ),
      ),
    ).toMatchObject({ status: "replied" });
  });

  it("doesn't apply changes in a tab: they're suggested", async () => {
    const seeded = await seedRow(
      "apply",
      "The body stays as it is.",
      "The cat sat on the mat.",
    );
    const root = await thread(seeded.row, "cat", seeded.notesId);
    const refused = "33333333-3333-4333-8333-333333333333";
    await expect(
      start(refused, root, seeded.row, "apply-resolve"),
    ).rejects.toMatchObject({ errorCode: "comment_ai_field_unsupported" });
    expect(await storedRequest(refused)).toBeUndefined();

    // Left to choose, a classifier's apply is taken as a suggestion.
    const requestId = "44444444-4444-4444-8444-444444444444";
    await as(() =>
      commentAi.startCommentAiRequest({
        requestId,
        documentId: seeded.row,
        threadId: root.threadId,
        rootCommentId: root.id,
        submittedMode: "auto",
        instructions: "Make it a dog",
      }),
    );
    const request = present(await storedRequest(requestId), "the request");
    await runWithRequestContext(
      {
        userEmail: OWNER,
        orgId: null,
        run: {
          actionScope: { kind: "content-comment-ai-classifier", requestId },
          threadId: present(
            request.classificationThreadId ?? undefined,
            "the classifier thread",
          ),
        },
      },
      () => commentAi.submitCommentAiClassification("apply-resolve"),
    );
    expect(await storedRequest(requestId)).toMatchObject({
      intent: "suggest",
      status: "classified",
    });
  });

  it("refuses an Ask AI suggestion on text its request isn't on", async () => {
    const seeded = await seedRow(
      "binding",
      "The body has a cat too.",
      "The cat sat on the mat.",
    );
    const notes = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    const bodyRoot = await thread(seeded.row, "cat");
    const requestId = "55555555-5555-4555-8555-555555555555";
    await start(requestId, bodyRoot, seeded.row, "suggest");
    const operation = markdownSuggestionOperation(
      notes.content,
      notes.content.replace("cat", "dog"),
    );
    if (!operation) throw new Error("The fixture edit changes nothing.");

    await expect(
      as(() =>
        createProposal.run(
          {
            resourceType: "document",
            resourceId: seeded.row,
            adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
            baseRevision: blocksFieldSuggestionRevision(
              seeded.notesId,
              notes.revision,
            ),
            summary: "Changes the cat to a dog.",
            idempotencyKey: `binding-${requestId}`,
            suggestions: [
              {
                summary: "Changes the cat to a dog.",
                operations: [{ ...operation, targetId: seeded.notesId }],
                metadata: {
                  commentAiRequestId: requestId,
                  sourceThreadId: bodyRoot.threadId,
                },
              },
            ],
          },
          ctx,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "comment_ai_thread_conflict" });
  });
});
