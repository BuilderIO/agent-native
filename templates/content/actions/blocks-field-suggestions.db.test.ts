import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  `content-blocks-field-suggestions-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";
const ctx = { caller: "frontend" as const, userEmail: OWNER };

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let createContentDatabase: typeof import("./create-content-database.js").default;
let configureDocumentProperty: typeof import("./configure-document-property.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let addDatabaseItem: typeof import("./add-database-item.js").default;
let setDocumentProperty: typeof import("./set-document-property.js").default;
let listDocumentProperties: typeof import("./list-document-properties.js").default;
let createProposal: typeof import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal").default;
let decideSuggestion: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion").default;
let decideProposal: typeof import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal").default;
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
  createProposal = (
    await import("@agent-native/core/review/suggestions/actions/create-resource-suggestion-proposal")
  ).default;
  decideSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion")
  ).default;
  decideProposal = (
    await import("@agent-native/core/review/suggestions/actions/decide-resource-suggestion-proposal")
  ).default;
  getSuggestion = (
    await import("@agent-native/core/review/suggestions/actions/get-resource-suggestion")
  ).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
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

/** A Collection with its body field and a "Notes" field, and one row. */
async function seedRow(suffix: string, body: string, notes: string) {
  return as(async () => {
    const created = await createContentDatabase.run({
      title: `Board ${suffix}`,
    });
    const databaseId = created.database.id;
    const databaseDocumentId = created.database.documentId;
    const configured = await configureDocumentProperty.run({
      documentId: databaseDocumentId,
      databaseId,
      name: "Notes",
      type: "blocks",
    });
    const blocks = configured.properties.filter(
      (property) => property.definition.type === "blocks",
    );
    const primaryId = blocks.find(
      (property) => property.definition.options.blocks?.primary === true,
    )!.definition.id;
    const notesId = blocks.find(
      (property) => property.definition.name === "Notes",
    )!.definition.id;
    const read = await getContentDatabase.run({ databaseId });
    if (!("database" in read) || !read.mutationContract)
      throw new Error("Fixture Collection has no mutation contract.");
    const added = await addDatabaseItem.run({
      target: read.mutationContract.target,
      expectedSchemaRevision: read.mutationContract.schemaRevision,
      idempotencyKey: `blocks-field-suggestions-${suffix}`,
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
  const property = listed.properties.find(
    (candidate) => candidate.definition.id === fieldId,
  )!;
  const [stored] = await getDb()
    .select({ content: schema.documentBlockFieldContents.content })
    .from(schema.documentBlockFieldContents)
    .where(
      and(
        eq(schema.documentBlockFieldContents.documentId, row),
        eq(schema.documentBlockFieldContents.propertyId, fieldId),
      ),
    );
  return {
    content: stored?.content ?? "",
    revision: property.blocksField?.revision ?? 0,
  };
}

async function pageBody(row: string) {
  const [page] = await getDb()
    .select({ content: schema.documents.content })
    .from(schema.documents)
    .where(eq(schema.documents.id, row));
  return page?.content;
}

/** The edit from `before` to `after`, on the tab `fieldId`. */
function tabEdit(fieldId: string, before: string, after: string) {
  const operation = markdownSuggestionOperation(before, after);
  if (!operation) throw new Error("The fixture edit changes nothing.");
  return { ...operation, targetId: fieldId };
}

async function suggest(
  row: string,
  baseRevision: string,
  operations: Array<ReturnType<typeof tabEdit>>,
  key: string,
) {
  return as(() =>
    createProposal.run(
      {
        resourceType: "document",
        resourceId: row,
        adapterKind: CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
        baseRevision,
        summary: "Suggest edits",
        idempotencyKey: key,
        suggestions: operations.map((operation) => ({
          summary: "Suggest edits",
          operations: [operation],
        })),
      },
      ctx,
    ),
  );
}

async function accept(id: string) {
  return as(async () => {
    const suggestion = await getSuggestion.run({ id }, ctx);
    return decideSuggestion.run(
      {
        id,
        decision: "accepted",
        idempotencyKey: `accept-${id}`,
        observedBase: suggestion.baseRevision,
        observedRevision: suggestion.revision,
      },
      ctx,
    );
  });
}

describe("suggestions on a Blocks field tab", () => {
  it("accepting one changes only its field, at the field's next revision (CMT-2)", async () => {
    const seeded = await seedRow(
      "accept",
      "The body stays as it is.",
      "Notes about the draft.",
    );
    const before = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    const created = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(seeded.notesId, before.revision),
      [
        tabEdit(
          seeded.notesId,
          before.content,
          before.content.replace("draft", "second draft"),
        ),
      ],
      "accept-create",
    );
    const [suggestion] = created.suggestions;
    expect(suggestion.adapterKind).toBe(
      CONTENT_BLOCKS_FIELD_SUGGESTION_ADAPTER,
    );
    expect(suggestion.operations[0]?.targetId).toBe(seeded.notesId);

    const decided = await accept(suggestion.id);
    expect(decided.suggestion?.status).toBe("accepted");
    const after = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    expect(after.content).toBe("Notes about the second draft.");
    expect(after.revision).toBe(before.revision + 1);
    expect(await pageBody(seeded.row)).toBe("The body stays as it is.");
  });

  it("accepts a suggestion after someone else edited another part of the tab", async () => {
    const seeded = await seedRow(
      "elsewhere",
      "Body.",
      "First paragraph.\n\nSecond paragraph.",
    );
    const before = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    const created = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(seeded.notesId, before.revision),
      [
        tabEdit(
          seeded.notesId,
          before.content,
          "First paragraph, reworded.\n\nSecond paragraph.",
        ),
      ],
      "elsewhere-create",
    );
    await as(() =>
      setDocumentProperty.run(
        {
          documentId: seeded.row,
          databaseId: seeded.databaseId,
          propertyId: seeded.notesId,
          value: "First paragraph.\n\nSecond paragraph, typed meanwhile.",
          expectedBlocksFieldRevision: before.revision,
        },
        ctx,
      ),
    );

    await accept(created.suggestions[0]!.id);
    expect(
      (await fieldState(seeded.row, seeded.databaseId, seeded.notesId)).content,
    ).toBe("First paragraph, reworded.\n\nSecond paragraph, typed meanwhile.");
  });

  it("keeps a suggestion pending when the words it changes were edited first", async () => {
    const seeded = await seedRow("stale", "Body.", "Keep this sentence.");
    const before = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    const created = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(seeded.notesId, before.revision),
      [tabEdit(seeded.notesId, before.content, "Keep this better sentence.")],
      "stale-create",
    );
    await as(() =>
      setDocumentProperty.run(
        {
          documentId: seeded.row,
          databaseId: seeded.databaseId,
          propertyId: seeded.notesId,
          value: "Something else entirely.",
          expectedBlocksFieldRevision: before.revision,
        },
        ctx,
      ),
    );

    await expect(accept(created.suggestions[0]!.id)).rejects.toMatchObject({
      errorCode: "suggestion_stale",
    });
    const pending = await as(() =>
      getSuggestion.run({ id: created.suggestions[0]!.id }, ctx),
    );
    expect(pending.status).toBe("pending");
    expect(
      (await fieldState(seeded.row, seeded.databaseId, seeded.notesId)).content,
    ).toBe("Something else entirely.");
  });

  it("accepts every edit of a proposal into the same tab", async () => {
    const seeded = await seedRow(
      "proposal",
      "Body.",
      "Alpha line.\n\nBeta line.",
    );
    const before = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    const created = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(seeded.notesId, before.revision),
      [
        tabEdit(seeded.notesId, before.content, "Alpha line!\n\nBeta line."),
        tabEdit(seeded.notesId, before.content, "Alpha line.\n\nBeta line!"),
      ],
      "proposal-create",
    );
    await as(() =>
      decideProposal.run(
        {
          proposalId: created.proposal.id,
          decision: "accepted",
          idempotencyKey: `accept-${created.proposal.id}`,
          members: created.suggestions.map((suggestion) => ({
            id: suggestion.id,
            observedBase: suggestion.baseRevision,
            observedRevision: suggestion.revision,
          })),
        },
        ctx,
      ),
    );
    expect(
      (await fieldState(seeded.row, seeded.databaseId, seeded.notesId)).content,
    ).toBe("Alpha line!\n\nBeta line!");
    expect(await pageBody(seeded.row)).toBe("Body.");
  });

  it("saves a suggestion made before someone else edited the tab against its current text", async () => {
    const seeded = await seedRow(
      "older",
      "Body.",
      "Original notes.\n\nA second paragraph.",
    );
    const before = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    await as(() =>
      setDocumentProperty.run(
        {
          documentId: seeded.row,
          databaseId: seeded.databaseId,
          propertyId: seeded.notesId,
          value: "Original notes.\n\nA second paragraph, typed meanwhile.",
          expectedBlocksFieldRevision: before.revision,
        },
        ctx,
      ),
    );
    const created = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(seeded.notesId, before.revision),
      [
        tabEdit(
          seeded.notesId,
          before.content,
          "Original notes, revised.\n\nA second paragraph.",
        ),
      ],
      "older-create",
    );
    const saved = created.suggestions[0]!.operations[0]!;
    expect(saved.targetId).toBe(seeded.notesId);
    expect(saved.before).toMatchObject({
      markdown: "Original notes.\n\nA second paragraph, typed meanwhile.",
    });
    expect(saved.after).toMatchObject({
      markdown:
        "Original notes, revised.\n\nA second paragraph, typed meanwhile.",
    });

    await accept(created.suggestions[0]!.id);
    expect(
      (await fieldState(seeded.row, seeded.databaseId, seeded.notesId)).content,
    ).toBe("Original notes, revised.\n\nA second paragraph, typed meanwhile.");
  });

  it("refuses a suggestion whose words someone else rewrote first", async () => {
    const seeded = await seedRow("rewritten", "Body.", "Original notes.");
    const before = await fieldState(
      seeded.row,
      seeded.databaseId,
      seeded.notesId,
    );
    await as(() =>
      setDocumentProperty.run(
        {
          documentId: seeded.row,
          databaseId: seeded.databaseId,
          propertyId: seeded.notesId,
          value: "Newer notes.",
          expectedBlocksFieldRevision: before.revision,
        },
        ctx,
      ),
    );
    await expect(
      suggest(
        seeded.row,
        blocksFieldSuggestionRevision(seeded.notesId, before.revision),
        [tabEdit(seeded.notesId, before.content, "Revised notes.")],
        "rewritten-create",
      ),
    ).rejects.toMatchObject({ errorCode: "suggestion_conflict" });
  });

  it("refuses a tab suggestion on the body's field or a field the page doesn't have", async () => {
    const seeded = await seedRow("targets", "Body text.", "Notes.");
    const other = await seedRow("targets-other", "Other body.", "Other notes.");
    const onBody = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(seeded.primaryId, 0),
      [tabEdit(seeded.primaryId, "Body text.", "Body text, edited.")],
      "targets-body",
    ).catch((error) => error);
    expect(onBody).toMatchObject({ errorCode: "suggestion_field_unavailable" });

    const elsewhere = await fieldState(
      other.row,
      other.databaseId,
      other.notesId,
    );
    const onOther = await suggest(
      seeded.row,
      blocksFieldSuggestionRevision(other.notesId, elsewhere.revision),
      [tabEdit(other.notesId, elsewhere.content, "Other notes, edited.")],
      "targets-other",
    ).catch((error) => error);
    expect(onOther).toMatchObject({
      errorCode: "suggestion_field_unavailable",
    });
  });
});
