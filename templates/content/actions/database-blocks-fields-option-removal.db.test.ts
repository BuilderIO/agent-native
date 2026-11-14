import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect exact rows.

const path = join(
  tmpdir(),
  `content-blocks-fields-options-${process.pid}-${Date.now()}.pglite`,
);
const owner = `blocks-options-owner-${Date.now()}@example.com`;
const outsider = `blocks-options-outsider-${Date.now()}@example.com`;
const asMcp = { caller: "mcp" } as ActionRunContext;

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/schema.js");
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let readDatabase: typeof import("./get-content-database.js").default;
let addItem: typeof import("./add-database-item.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let listBlocks: typeof import("./list-content-database-blocks.js").default;
let listSpaces: typeof import("./list-content-spaces.js").default;
let spaceId: string;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: owner }, run);
const asOutsider = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: outsider }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${path}`;
  const db = await import("../server/db/index.js");
  getDb = db.getDb;
  schema = db.schema;
  await (await import("../server/plugins/db.js")).default(undefined as never);
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  readDatabase = (await import("./get-content-database.js")).default;
  addItem = (await import("./add-database-item.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  listBlocks = (await import("./list-content-database-blocks.js")).default;
  listSpaces = (await import("./list-content-spaces.js")).default;
  for (const email of [owner, outsider]) {
    await runWithRequestContext({ userEmail: email }, () =>
      import("./_content-spaces.js").then((module) =>
        module.provisionContentSpaces(getDb(), email),
      ),
    );
  }
  const spaces = await asOwner(() => listSpaces.run({}));
  spaceId = defined(spaces.spaces[0]).id;
}, 120_000);

afterAll(() => rmSync(path, { recursive: true, force: true }));

async function read(databaseId: string) {
  const result = await asOwner(() => readDatabase.run({ databaseId }));
  if (!("mutationContract" in result) || !result.mutationContract) {
    throw new Error("Expected a database mutation contract");
  }
  return { ...result, mutationContract: result.mutationContract };
}

async function collection(title: string) {
  const created = await asOwner(() =>
    createDatabase.run({ spaceId, title, idempotencyKey: `create-${title}` }),
  );
  const target = {
    spaceId,
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
  };
  return { databaseId: created.database.id, target };
}

async function createProperty(
  state: Awaited<ReturnType<typeof collection>>,
  key: string,
  definition: Record<string, unknown>,
) {
  const current = await read(state.databaseId);
  const result = await asOwner(() =>
    configureProperty.run(
      {
        operation: "create",
        target: state.target,
        expectedSchemaRevision: current.mutationContract.schemaRevision,
        idempotencyKey: key,
        definition,
      } as never,
      asMcp,
    ),
  );
  return (result as { value: { id: string } }).value.id;
}

async function updateProperty(
  state: Awaited<ReturnType<typeof collection>>,
  key: string,
  propertyId: string,
  patch: Record<string, unknown>,
) {
  const current = await read(state.databaseId);
  return asOwner(() =>
    configureProperty.run(
      {
        operation: "update",
        target: state.target,
        expectedSchemaRevision: current.mutationContract.schemaRevision,
        idempotencyKey: key,
        propertyId,
        patch,
      } as never,
      asMcp,
    ),
  );
}

async function addRow(
  state: Awaited<ReturnType<typeof collection>>,
  title: string,
) {
  const current = await read(state.databaseId);
  const created = await asOwner(() =>
    addItem.run({
      target: current.mutationContract.target,
      expectedSchemaRevision: current.mutationContract.schemaRevision,
      idempotencyKey: `row-${title}`,
      title,
    } as never),
  );
  return (
    created as { receipt: { row: { itemId: string; documentId: string } } }
  ).receipt.row;
}

async function fieldBlocks(
  state: Awaited<ReturnType<typeof collection>>,
  row: { itemId: string; documentId: string },
  propertyId: string,
) {
  const current = await read(state.databaseId);
  return asOwner(() =>
    listBlocks.run({
      target: {
        ...current.mutationContract.target,
        itemId: row.itemId,
        rowDocumentId: row.documentId,
        propertyId,
      },
      limit: 100,
    }),
  );
}

function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Missing value");
  return value;
}

// A field nobody has written to reads as one empty paragraph.
const EMPTY_FIELD = ["<empty-block/>"];

// A top-level block's NFM includes its nested blocks, which the list also
// returns on their own, so a field's text is its top-level blocks.
function topLevel(listed: Awaited<ReturnType<typeof fieldBlocks>>) {
  return listed.blocks.filter((block) => block.parentId === null);
}

async function fieldNfm(
  state: Awaited<ReturnType<typeof collection>>,
  row: { itemId: string; documentId: string },
  propertyId: string,
) {
  return topLevel(await fieldBlocks(state, row, propertyId)).map(
    (block) => block.value.nfm,
  );
}

async function writeField(
  state: Awaited<ReturnType<typeof collection>>,
  row: { documentId: string },
  propertyId: string,
  value: string,
  guard?: { expectedBlocksFieldRevision: number } | { baseRevision: string },
) {
  return asOwner(() =>
    setProperty.run(
      {
        databaseId: state.databaseId,
        documentId: row.documentId,
        propertyId,
        value,
        ...guard,
      },
      asMcp,
    ),
  );
}

// The main field is the page's body, so an agent guards it with the page's
// revision rather than the field's.
async function bodyRevision(
  state: Awaited<ReturnType<typeof collection>>,
  row: { itemId: string; documentId: string },
  body: string,
) {
  return {
    baseRevision: defined((await fieldBlocks(state, row, body)).baseRevision),
  };
}

async function setValue(
  state: Awaited<ReturnType<typeof collection>>,
  row: { documentId: string },
  propertyId: string,
  value: unknown,
) {
  await asOwner(() =>
    setProperty.run({
      databaseId: state.databaseId,
      documentId: row.documentId,
      propertyId,
      value,
    }),
  );
}

function storedOptions(
  database: Awaited<ReturnType<typeof read>>,
  propertyId: string,
) {
  return database.properties
    .find((property) => property.definition.id === propertyId)
    ?.definition.options.options?.map((option) => option.id);
}

describe("agent-managed Blocks fields and option removal", () => {
  it("reorganizes an article collection into Notes, Proposal and Draft tabs and removes an unused status", async () => {
    const state = await collection("Article ideas");
    const statusId = await createProperty(state, "create-status", {
      name: "Status",
      type: "status",
      options: [
        { id: "idea", name: "Idea", color: "gray" },
        { id: "outline", name: "Outline", color: "yellow" },
        { id: "proposal", name: "Proposal", color: "blue" },
      ],
    });
    const priorityId = await createProperty(state, "create-priority", {
      name: "Priority",
      type: "select",
      options: [
        { id: "high", name: "High", color: "red" },
        { id: "low", name: "Low", color: "gray" },
      ],
    });
    const body = defined(
      (await read(state.databaseId)).properties.find(
        (property) => property.definition.type === "blocks",
      ),
    ).definition.id;

    const research = (topic: string) => [
      `Research: how teams ${topic}`,
      "- Transcript: *we read every diff*",
    ];
    const proposal = (topic: string) => [
      "## Proposal",
      `Lead with how teams **${topic}**, then show the receipts.`,
      "- Angle: trust comes from evidence",
    ];
    const topics = [
      "review agent output",
      "trust agent commits",
      "budget agent time",
      "hand work to agents",
      "test agent changes",
      "undo agent mistakes",
    ];
    const proposalRows = [];
    for (const [index, topic] of topics.entries()) {
      const row = await addRow(state, `Article ${index + 1}`);
      await writeField(
        state,
        row,
        body,
        [...research(topic), ...proposal(topic)].join("\n"),
        await bodyRevision(state, row, body),
      );
      await setValue(state, row, statusId, "proposal");
      await setValue(state, row, priorityId, index % 2 ? "low" : "high");
      proposalRows.push({ ...row, topic });
    }
    const researchOnly = await addRow(state, "Agent receipts");
    await writeField(
      state,
      researchOnly,
      body,
      research("keep receipts").join("\n"),
      await bodyRevision(state, researchOnly, body),
    );
    await setValue(state, researchOnly, statusId, "idea");
    await setValue(state, researchOnly, priorityId, "low");
    const before = await read(state.databaseId);

    // Rename the body tab to Notes and add Proposal and Draft tabs.
    await updateProperty(state, "rename-body", body, { name: "Notes" });
    const proposalField = await createProperty(state, "create-proposal", {
      name: "Proposal",
      type: "blocks",
    });
    const draftField = await createProperty(state, "create-draft", {
      name: "Draft",
      type: "blocks",
      visibility: "hide_when_empty",
    });
    const withTabs = await read(state.databaseId);
    expect(
      withTabs.properties
        .filter((property) => property.definition.type === "blocks")
        .map((property) => [
          property.definition.name,
          property.definition.options,
        ]),
    ).toEqual([
      ["Notes", { blocks: { primary: true } }],
      ["Proposal", { blocks: { primary: false } }],
      ["Draft", { blocks: { primary: false } }],
    ]);
    expect(withTabs.setupContract?.supportedPropertyTypes).toContain("blocks");

    // Move each proposal intact: write it to Proposal, then drop it from Notes.
    for (const row of proposalRows) {
      const notesBlocks = await fieldBlocks(state, row, body);
      const notesText = topLevel(notesBlocks).map((block) => block.value.nfm);
      const proposalStart = notesText.indexOf("## Proposal");
      const emptyProposal = await fieldBlocks(state, row, proposalField);
      expect(emptyProposal.blocks.map((block) => block.value.nfm)).toEqual(
        EMPTY_FIELD,
      );
      await writeField(
        state,
        row,
        proposalField,
        notesText.slice(proposalStart).join("\n"),
        { expectedBlocksFieldRevision: emptyProposal.fieldRevision },
      );
      await writeField(
        state,
        row,
        body,
        notesText.slice(0, proposalStart).join("\n"),
        { baseRevision: defined(notesBlocks.baseRevision) },
      );

      // A stale or unguarded write from an agent fails and changes nothing.
      await expect(
        writeField(state, row, proposalField, "Overwritten", {
          expectedBlocksFieldRevision: emptyProposal.fieldRevision,
        }),
      ).rejects.toMatchObject({
        name: "BlocksFieldRevisionConflictError",
        statusCode: 409,
      });
      await expect(
        writeField(state, row, proposalField, "Overwritten"),
      ).rejects.toMatchObject({ errorCode: "BLOCKS_FIELD_REVISION_REQUIRED" });
    }

    // The unused Outline status goes; no row or view used it.
    const removed = await updateProperty(state, "remove-outline", statusId, {
      optionEdits: [{ operation: "remove", optionId: "outline" }],
    });
    expect((removed as { receipt: { outcome: string } }).receipt.outcome).toBe(
      "updated",
    );

    const after = await read(state.databaseId);
    expect(storedOptions(after, statusId)).toEqual(["idea", "proposal"]);
    expect(after.configurationRevision).toBe(before.configurationRevision);
    expect(after.database.viewConfig).toEqual(before.database.viewConfig);
    expect(after.items.map((item) => item.id).sort()).toEqual(
      before.items.map((item) => item.id).sort(),
    );
    const valuesOf = (database: typeof before) =>
      Object.fromEntries(
        database.items.map((item) => [
          item.document.id,
          item.properties
            .filter((property) =>
              [statusId, priorityId].includes(property.definition.id),
            )
            .map((property) => property.value),
        ]),
      );
    expect(valuesOf(after)).toEqual(valuesOf(before));

    for (const row of proposalRows) {
      expect(await fieldNfm(state, row, proposalField)).toEqual(
        proposal(row.topic),
      );
      expect(await fieldNfm(state, row, body)).toEqual(research(row.topic));
    }
    expect(await fieldNfm(state, researchOnly, body)).toEqual(
      research("keep receipts"),
    );
    for (const row of [...proposalRows, researchOnly]) {
      expect(await fieldNfm(state, row, draftField)).toEqual(EMPTY_FIELD);
    }
    expect(await fieldNfm(state, researchOnly, proposalField)).toEqual(
      EMPTY_FIELD,
    );
  });

  it("refuses a stale or unauthorized Blocks field create", async () => {
    const state = await collection("Guarded tabs");
    const stale = await read(state.databaseId);
    await createProperty(state, "first-tab", { name: "Notes", type: "blocks" });
    await expect(
      asOwner(() =>
        configureProperty.run(
          {
            operation: "create",
            target: state.target,
            expectedSchemaRevision: stale.mutationContract.schemaRevision,
            idempotencyKey: "stale-tab",
            definition: { name: "Draft", type: "blocks" },
          },
          asMcp,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "SCHEMA_REVISION_CONFLICT" });
    const fresh = await read(state.databaseId);
    await expect(
      asOutsider(() =>
        configureProperty.run(
          {
            operation: "create",
            target: state.target,
            expectedSchemaRevision: fresh.mutationContract.schemaRevision,
            idempotencyKey: "outsider-tab",
            definition: { name: "Draft", type: "blocks" },
          },
          asMcp,
        ),
      ),
    ).rejects.toMatchObject({ name: "ForbiddenError" });
    expect(
      (await read(state.databaseId)).properties
        .filter((property) => property.definition.type === "blocks")
        .map((property) => property.definition.name),
    ).toEqual(["Content", "Notes"]);
  });

  it("refuses to remove an option a row or saved filter still uses, and writes nothing", async () => {
    const state = await collection("Options in use");
    const statusId = await createProperty(state, "status", {
      name: "Status",
      type: "status",
      options: [
        { id: "by-id", name: "By ID", color: "gray" },
        { id: "by-name", name: "By Name", color: "blue" },
        { id: "filtered", name: "Filtered", color: "green" },
        { id: "opt-cased", name: "Cased", color: "yellow" },
        { id: "unused", name: "Unused", color: "red" },
      ],
    });
    const tagsId = await createProperty(state, "tags", {
      name: "Tags",
      type: "multi_select",
      options: [
        { id: "tagged", name: "Tagged", color: "gray" },
        { id: "spare", name: "Spare", color: "gray" },
      ],
    });
    const first = await addRow(state, "First");
    const second = await addRow(state, "Second");
    await setValue(state, first, statusId, "by-id");
    await setValue(state, first, tagsId, ["tagged"]);
    // A value saved before options were matched names the option instead.
    await setValue(state, second, statusId, "by-id");
    await getDb()
      .update(schema.documentPropertyValues)
      .set({ valueJson: JSON.stringify("by name") })
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, second.documentId),
          eq(schema.documentPropertyValues.propertyId, statusId),
        ),
      );
    const [database] = await getDb()
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, state.databaseId));
    const viewConfig = JSON.parse(defined(database).viewConfigJson);
    const viewId = viewConfig.views[0].id;
    // Views match option IDs case-insensitively, and ignore the value of an
    // emptiness filter, so only the first two filters use an option.
    viewConfig.views[0].filters = [
      {
        key: statusId,
        label: "Status",
        operator: "equals",
        value: JSON.stringify(["Filtered"]),
      },
      {
        key: statusId,
        label: "Status",
        operator: "contains",
        value: "OPT-CASED",
      },
      { key: statusId, label: "Status", operator: "is_empty", value: "unused" },
    ];
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: JSON.stringify(viewConfig) })
      .where(eq(schema.contentDatabases.id, state.databaseId));

    const before = await read(state.databaseId);
    for (const [key, propertyId, optionId, details] of [
      ["remove-by-id", statusId, "by-id", { rowCount: 1, viewIds: [] }],
      ["remove-by-name", statusId, "by-name", { rowCount: 1, viewIds: [] }],
      [
        "remove-filtered",
        statusId,
        "filtered",
        { rowCount: 0, viewIds: [viewId] },
      ],
      [
        "remove-cased",
        statusId,
        "opt-cased",
        { rowCount: 0, viewIds: [viewId] },
      ],
      ["remove-tagged", tagsId, "tagged", { rowCount: 1, viewIds: [] }],
    ] as const) {
      await expect(
        updateProperty(state, key, propertyId, {
          optionEdits: [{ operation: "remove", optionId }],
        }),
      ).rejects.toMatchObject({
        errorCode: "OPTION_IN_USE",
        statusCode: 409,
        details: { propertyId, optionId, ...details },
      });
    }
    await expect(
      updateProperty(state, "remove-missing", statusId, {
        optionEdits: [{ operation: "remove", optionId: "missing" }],
      }),
    ).rejects.toMatchObject({ errorCode: "INVALID_INPUT" });
    const refused = await read(state.databaseId);
    expect(refused.mutationContract.schemaRevision).toBe(
      before.mutationContract.schemaRevision,
    );
    expect(storedOptions(refused, statusId)).toEqual([
      "by-id",
      "by-name",
      "filtered",
      "opt-cased",
      "unused",
    ]);

    // Unused options go, in one edit with the rest of the patch.
    await updateProperty(state, "remove-unused", statusId, {
      optionEdits: [
        { operation: "remove", optionId: "unused" },
        { operation: "update", optionId: "by-id", patch: { name: "First" } },
      ],
    });
    await updateProperty(state, "remove-spare", tagsId, {
      optionEdits: [{ operation: "remove", optionId: "spare" }],
    });
    const after = await read(state.databaseId);
    expect(storedOptions(after, statusId)).toEqual([
      "by-id",
      "by-name",
      "filtered",
      "opt-cased",
    ]);
    expect(
      after.properties
        .find((property) => property.definition.id === statusId)
        ?.definition.options.options?.find((option) => option.id === "by-id")
        ?.name,
    ).toBe("First");
    expect(storedOptions(after, tagsId)).toEqual(["tagged"]);
  });
});
