import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withMigrationRuntime } from "@agent-native/core/db";
import {
  loadActionsFromStaticRegistry,
  runFrameworkReleaseMigrations,
  runWithRequestContext,
} from "@agent-native/core/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createMCPServerForRequest,
  type MCPConfig,
} from "../../../packages/core/src/mcp/build-server.js";

const requireFromCore = createRequire(
  new URL("../../../packages/core/package.json", import.meta.url),
);
const [{ Client }, { InMemoryTransport }] = await Promise.all([
  import(requireFromCore.resolve("@modelcontextprotocol/client")),
  import(requireFromCore.resolve("@modelcontextprotocol/server")),
]);
type MCPClient = InstanceType<typeof Client>;

// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.

const TEST_DB_PATH = join(
  tmpdir(),
  `content-row-patches-${process.pid}-${Date.now()}.pglite`,
);
const TEST_DATABASE_URL =
  process.env.CONTENT_ROW_MUTATION_POSTGRES_URL ?? `pglite:${TEST_DB_PATH}`;
const OWNER = "owner@example.com";
const COLLABORATOR = "collaborator@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let createDatabase: typeof import("./create-content-database.js").default;
let configureProperty: typeof import("./configure-document-property.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let createRow: typeof import("./add-database-item.js").default;
let updateRow: typeof import("./update-database-item.js").default;
let patchRows: typeof import("./patch-database-items.js").default;
let searchRows: typeof import("./search-content-database-rows.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let addComment: typeof import("./add-comment.js").default;
let rowMutation: typeof import("./_database-row-mutation.js");

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER }, run);
const asCollaborator = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: COLLABORATOR }, run);

beforeAll(async () => {
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    const databaseName = new URL(TEST_DATABASE_URL).pathname.toLowerCase();
    if (!databaseName.includes("test")) {
      throw new Error(
        "CONTENT_ROW_MUTATION_POSTGRES_URL must name an isolated test database.",
      );
    }
  }
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createDatabase = (await import("./create-content-database.js")).default;
  configureProperty = (await import("./configure-document-property.js"))
    .default;
  getDatabase = (await import("./get-content-database.js")).default;
  createRow = (await import("./add-database-item.js")).default;
  updateRow = (await import("./update-database-item.js")).default;
  patchRows = (await import("./patch-database-items.js")).default;
  searchRows = (await import("./search-content-database-rows.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  addComment = (await import("./add-comment.js")).default;
  rowMutation = await import("./_database-row-mutation.js");
  if (TEST_DATABASE_URL.startsWith("postgres")) {
    await withMigrationRuntime(() => runFrameworkReleaseMigrations(undefined));
  }
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

type Contract = Awaited<ReturnType<typeof contract>>;
type SeededRow = { itemId: string; documentId: string; rowRevision: string };

async function fixture(title = "Ranked rows") {
  const created = await asOwner(() => createDatabase.run({ title }));
  const ids = {
    databaseId: created.database.id,
    databaseDocumentId: created.database.documentId,
  };
  const rank = await addProperty(ids, "Rank", "number");
  const notes = await addProperty(ids, "Notes", "text");
  const status = await addProperty(ids, "Stage", "select", {
    options: [
      { id: "next", name: "Next", color: "blue" },
      { id: "waiting", name: "Waiting", color: "gray" },
    ],
  });
  return { ...ids, properties: { rank, notes, status } };
}

async function addProperty(
  ids: { databaseId: string; databaseDocumentId: string },
  name: string,
  type: "text" | "number" | "select",
  options?: unknown,
  naturalKey?: boolean,
) {
  const response = await asOwner(() =>
    configureProperty.run({
      documentId: ids.databaseDocumentId,
      databaseId: ids.databaseId,
      name,
      type,
      options: options as any,
      naturalKey,
    }),
  );
  const property = response.properties.find(
    (candidate) => candidate.definition.name === name,
  );
  if (!property) throw new Error(`Property ${name} was not created.`);
  return property.definition.id;
}

async function contract(databaseId: string) {
  const response = await asOwner(() => getDatabase.run({ databaseId }));
  if (!("database" in response) || !response.mutationContract)
    throw new Error("Fixture database has no mutation contract.");
  return response.mutationContract;
}

function envelope(discovered: Contract, idempotencyKey: string) {
  return {
    target: {
      spaceId: discovered.target.spaceId,
      databaseId: discovered.target.databaseId,
      databaseDocumentId: discovered.target.databaseDocumentId,
    },
    expectedSchemaRevision: discovered.schemaRevision,
    idempotencyKey,
  };
}

async function seedRows(
  ids: Awaited<ReturnType<typeof fixture>>,
  count: number,
): Promise<SeededRow[]> {
  const discovered = await contract(ids.databaseId);
  const rows: SeededRow[] = [];
  for (let index = 0; index < count; index += 1) {
    const created = await asOwner(() =>
      createRow.run({
        ...envelope(discovered, `seed-${ids.databaseId}-${index}`),
        title: `Task ${index + 1}`,
        propertyValues: {
          [ids.properties.rank]: index + 1,
          [ids.properties.notes]: `note ${index + 1}`,
          [ids.properties.status]: "next",
        },
      }),
    );
    rows.push({
      itemId: created.receipt.row.itemId,
      documentId: created.receipt.row.documentId,
      rowRevision: created.receipt.row.rowRevision,
    });
  }
  return rows;
}

function rankPatch(
  ids: Awaited<ReturnType<typeof fixture>>,
  row: SeededRow,
  rank: number,
) {
  return {
    itemId: row.itemId,
    documentId: row.documentId,
    expectedRowRevision: row.rowRevision,
    propertyEntries: [
      {
        propertyId: ids.properties.rank,
        propertyType: "number" as const,
        value: rank,
      },
    ],
  };
}

async function storedValues(documentIds: string[], propertyId: string) {
  const rows = await getDb()
    .select({
      documentId: schema.documentPropertyValues.documentId,
      valueJson: schema.documentPropertyValues.valueJson,
    })
    .from(schema.documentPropertyValues)
    .where(
      and(
        inArray(schema.documentPropertyValues.documentId, documentIds),
        eq(schema.documentPropertyValues.propertyId, propertyId),
      ),
    );
  const byDocument = new Map<string, unknown>(
    rows.map((row: { documentId: string; valueJson: string }) => [
      row.documentId,
      JSON.parse(row.valueJson),
    ]),
  );
  return documentIds.map((documentId) => byDocument.get(documentId));
}

async function currentRevisions(databaseId: string) {
  const response = await asOwner(() =>
    getDatabase.run({ databaseId, limit: 500 }),
  );
  if (!("items" in response)) throw new Error("Collection has no rows.");
  return new Map(
    response.items.map((item) => [item.id, item.rowRevision as string]),
  );
}

describe("patch-database-items", () => {
  it("applies a different value to each row in one call and leaves everything else intact", async () => {
    const ids = await fixture();
    const rows = await seedRows(ids, 12);
    const documentIds = rows.map((row) => row.documentId);
    await getDb()
      .update(schema.documents)
      .set({ content: "Row body stays put" })
      .where(eq(schema.documents.id, rows[0].documentId));
    await asOwner(() =>
      addComment.run({ documentId: rows[0].documentId, content: "Keep me" }),
    );
    const refreshed = await currentRevisions(ids.databaseId);
    const seeded = rows.map((row) => ({
      ...row,
      rowRevision: refreshed.get(row.itemId)!,
    }));
    const [databaseBefore] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    const discovered = await contract(ids.databaseId);

    const patched = seeded.slice(0, 10).map((row, index) => {
      if (index === 0) return { ...rankPatch(ids, row, 1), title: "Renamed" };
      return rankPatch(ids, row, index === 9 ? 10 : 12 - index);
    });
    const result = await asOwner(() =>
      patchRows.run({
        ...envelope(discovered, "rank-refresh"),
        rows: patched,
      }),
    );

    expect(result.receipt.counts).toEqual({
      requested: 10,
      updated: 9,
      unchanged: 1,
    });
    expect(result.receipt.idempotency).toMatchObject({
      key: "rank-refresh",
      result: "applied",
    });
    expect(result.receipt.rows.map((row) => row.itemId)).toEqual(
      patched.map((row) => row.itemId),
    );
    expect(result.receipt.rows[0]).toMatchObject({
      outcome: "updated",
      affected: { title: true, propertyIds: [] },
      readback: {
        verified: true,
        title: "Renamed",
        propertyValues: { [ids.properties.rank]: 1 },
      },
    });
    expect(result.receipt.rows[1]).toMatchObject({
      outcome: "updated",
      affected: { title: false, propertyIds: [ids.properties.rank] },
      revisions: { before: seeded[1].rowRevision },
      readback: {
        verified: true,
        propertyValues: { [ids.properties.rank]: 11 },
      },
    });
    expect(result.receipt.rows[1].readback).not.toHaveProperty("title");
    expect(Object.keys(result.receipt.rows[1].readback.propertyValues)).toEqual(
      [ids.properties.rank],
    );
    expect(result.receipt.rows[9]).toMatchObject({
      outcome: "unchanged",
      affected: { title: false, propertyIds: [] },
      revisions: {
        before: seeded[9].rowRevision,
        after: seeded[9].rowRevision,
      },
    });

    expect(await storedValues(documentIds, ids.properties.rank)).toEqual([
      1, 11, 10, 9, 8, 7, 6, 5, 4, 10, 11, 12,
    ]);
    expect(await storedValues(documentIds, ids.properties.notes)).toEqual(
      rows.map((_, index) => `note ${index + 1}`),
    );
    expect(await storedValues(documentIds, ids.properties.status)).toEqual(
      rows.map(() => "next"),
    );
    const [body] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, rows[0].documentId));
    expect(body).toMatchObject({
      title: "Renamed",
      content: "Row body stays put",
    });
    const comments = await getDb()
      .select()
      .from(schema.documentComments)
      .where(eq(schema.documentComments.documentId, rows[0].documentId));
    expect(
      comments.map((comment: { content: string }) => comment.content),
    ).toEqual(["Keep me"]);
    const [databaseAfter] = await getDb()
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, ids.databaseId));
    expect(databaseAfter.viewConfigJson).toBe(databaseBefore.viewConfigJson);
    const after = await currentRevisions(ids.databaseId);
    expect(after.get(seeded[10].itemId)).toBe(seeded[10].rowRevision);
    expect(after.get(seeded[11].itemId)).toBe(seeded[11].rowRevision);
    for (const receipt of result.receipt.rows) {
      expect(after.get(receipt.itemId)).toBe(receipt.revisions.after);
    }
  });

  it("writes every row of a full 250-row batch across several value chunks", async () => {
    const ids = await fixture("Full batch");
    const rows = await seedRows(ids, 250);
    const discovered = await contract(ids.databaseId);
    const result = await asOwner(() =>
      patchRows.run({
        ...envelope(discovered, "full-batch"),
        rows: rows.map((row, index) => ({
          itemId: row.itemId,
          documentId: row.documentId,
          expectedRowRevision: row.rowRevision,
          ...(index % 3 === 0 ? { title: `Retitled ${index}` } : {}),
          propertyEntries: [
            {
              propertyId: ids.properties.rank,
              propertyType: "number" as const,
              value: 250 - index,
            },
            {
              propertyId: ids.properties.notes,
              propertyType: "text" as const,
              value: `rewritten ${index}`,
            },
            {
              propertyId: ids.properties.status,
              propertyType: "select" as const,
              value: index % 2 === 0 ? "Waiting" : null,
            },
          ],
        })),
      }),
    );

    expect(result.receipt.counts).toEqual({
      requested: 250,
      updated: 250,
      unchanged: 0,
    });
    const documentIds = rows.map((row) => row.documentId);
    expect(await storedValues(documentIds, ids.properties.rank)).toEqual(
      rows.map((_, index) => 250 - index),
    );
    expect(await storedValues(documentIds, ids.properties.notes)).toEqual(
      rows.map((_, index) => `rewritten ${index}`),
    );
    expect(await storedValues(documentIds, ids.properties.status)).toEqual(
      rows.map((_, index) => (index % 2 === 0 ? "waiting" : null)),
    );
    const titles = new Map(
      (
        await getDb()
          .select({ id: schema.documents.id, title: schema.documents.title })
          .from(schema.documents)
          .where(inArray(schema.documents.id, documentIds))
      ).map((document: { id: string; title: string }) => [
        document.id,
        document.title,
      ]),
    );
    expect(documentIds.map((id) => titles.get(id))).toEqual(
      rows.map((_, index) =>
        index % 3 === 0 ? `Retitled ${index}` : `Task ${index + 1}`,
      ),
    );
  }, 180_000);

  it("writes nothing when the schema or any row revision is stale and names every stale row", async () => {
    const ids = await fixture("Stale rows");
    const rows = await seedRows(ids, 4);
    const discovered = await contract(ids.databaseId);
    for (const row of [rows[1], rows[3]]) {
      await asOwner(() =>
        setProperty.run({
          documentId: row.documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.notes,
          value: "edited in the table",
        }),
      );
    }

    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "stale-rows"),
          rows: rows.map((row, index) => rankPatch(ids, row, 40 + index)),
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "ROW_REVISION_CONFLICT",
      details: {
        rows: [
          expect.objectContaining({
            index: 1,
            itemId: rows[1].itemId,
            expected: rows[1].rowRevision,
          }),
          expect.objectContaining({
            index: 3,
            itemId: rows[3].itemId,
            expected: rows[3].rowRevision,
          }),
        ],
      },
    });
    const documentIds = rows.map((row) => row.documentId);
    expect(await storedValues(documentIds, ids.properties.rank)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(await storedValues(documentIds, ids.properties.notes)).toEqual([
      "note 1",
      "edited in the table",
      "note 3",
      "edited in the table",
    ]);

    const fresh = await currentRevisions(ids.databaseId);
    await addProperty(ids, "Added later", "text");
    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "stale-schema"),
          rows: rows.map((row, index) =>
            rankPatch(
              ids,
              { ...row, rowRevision: fresh.get(row.itemId)! },
              40 + index,
            ),
          ),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "SCHEMA_REVISION_CONFLICT" });
    expect(await storedValues(documentIds, ids.properties.rank)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("rejects invalid, duplicate, foreign, empty, and oversized batches before writing", async () => {
    const ids = await fixture("Invalid rows");
    const rows = await seedRows(ids, 4);
    const discovered = await contract(ids.databaseId);
    const blocksProperty = discovered.properties.find(
      (property) => property.type === "blocks",
    );
    if (!blocksProperty) throw new Error("Fixture has no Blocks property.");
    const documentIds = rows.map((row) => row.documentId);

    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "invalid-rows"),
          rows: [
            {
              ...rankPatch(ids, rows[0], 9),
              propertyEntries: [
                {
                  propertyId: ids.properties.rank,
                  propertyType: "text" as const,
                  value: "nine",
                },
              ],
            },
            rankPatch(ids, rows[1], 8),
            {
              ...rankPatch(ids, rows[2], 7),
              propertyValues: { [blocksProperty.id]: "body" },
              propertyEntries: undefined,
            },
            {
              ...rankPatch(ids, rows[3], 6),
              propertyEntries: [
                {
                  propertyId: ids.properties.status,
                  propertyType: "select" as const,
                  value: "Someday",
                },
              ],
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "INVALID_ROW_PATCHES",
      details: {
        rows: [
          expect.objectContaining({
            index: 0,
            errorCode: "INVALID_PROPERTY_VALUE",
          }),
          expect.objectContaining({
            index: 2,
            errorCode: "PROPERTY_NOT_WRITABLE",
          }),
          expect.objectContaining({
            index: 3,
            errorCode: "INVALID_PROPERTY_VALUE",
          }),
        ],
      },
    });

    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "empty-row"),
          rows: [
            rankPatch(ids, rows[0], 9),
            {
              itemId: rows[1].itemId,
              documentId: rows[1].documentId,
              expectedRowRevision: rows[1].rowRevision,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "INVALID_ROW_PATCHES",
      details: {
        rows: [
          expect.objectContaining({ index: 1, errorCode: "EMPTY_ROW_PATCH" }),
        ],
      },
    });

    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "duplicate-row"),
          rows: [rankPatch(ids, rows[0], 9), rankPatch(ids, rows[0], 8)],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "DUPLICATE_ROW",
      details: { rows: [expect.objectContaining({ index: 1 })] },
    });

    const other = await fixture("Other collection");
    const [foreign] = await seedRows(other, 1);
    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "foreign-row"),
          rows: [
            rankPatch(ids, rows[0], 9),
            rankPatch(ids, foreign, 8),
            rankPatch(ids, { ...rows[2], rowRevision: "stale-revision" }, 7),
          ],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "ROW_NOT_FOUND",
      details: {
        rows: [
          expect.objectContaining({
            index: 1,
            itemId: foreign.itemId,
            reason: "not_found",
          }),
          expect.objectContaining({
            index: 2,
            itemId: rows[2].itemId,
            reason: "stale_revision",
            expected: "stale-revision",
            actual: rows[2].rowRevision,
          }),
        ],
      },
    });

    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "oversized"),
          rows: Array.from({ length: 251 }, (_, index) => ({
            ...rankPatch(ids, rows[0], index),
            itemId: `item-${index}`,
            documentId: `document-${index}`,
          })),
        }),
      ),
    ).rejects.toThrow("expected array to have <=250 items");

    expect(await storedValues(documentIds, ids.properties.rank)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("replays a retried batch, rejects a reused key, and accepts a corrected retry", async () => {
    const ids = await fixture("Idempotent rows");
    const rows = await seedRows(ids, 3);
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "rank-once"),
      rows: rows.map((row, index) => rankPatch(ids, row, 30 - index)),
    };
    const applied = await asOwner(() => patchRows.run(input));
    await asOwner(() =>
      setProperty.run({
        documentId: rows[0].documentId,
        databaseId: ids.databaseId,
        propertyId: ids.properties.rank,
        value: 99,
      }),
    );

    const replayed = await asOwner(() =>
      patchRows.run({ ...input, rows: [...input.rows].reverse() }),
    );
    expect(replayed.receipt).toMatchObject({
      receiptId: applied.receipt.receiptId,
      idempotency: { key: "rank-once", result: "replayed" },
      counts: applied.receipt.counts,
    });
    expect(replayed.receipt.rows).toEqual([...applied.receipt.rows].reverse());
    expect(applied.receipt.replay).toBeUndefined();
    expect(replayed.receipt.replay).toEqual({
      readback: "historical",
      recordedAt: expect.any(String),
      freshRead: { action: "get-content-database", databaseId: ids.databaseId },
    });
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([99, 29, 28]);

    await expect(
      asOwner(() =>
        patchRows.run({
          ...input,
          rows: rows.map((row, index) => rankPatch(ids, row, 60 - index)),
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      asOwner(() =>
        updateRow.run({
          ...envelope(discovered, "rank-once"),
          itemId: rows[1].itemId,
          documentId: rows[1].documentId,
          expectedRowRevision: applied.receipt.rows[1].revisions.after,
          propertyValues: { [ids.properties.rank]: 5 },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });

    const retry = {
      ...envelope(discovered, "rank-retry"),
      rows: rows.map((row, index) => rankPatch(ids, row, 70 + index)),
    };
    await expect(asOwner(() => patchRows.run(retry))).rejects.toMatchObject({
      errorCode: "ROW_REVISION_CONFLICT",
    });
    const fresh = await currentRevisions(ids.databaseId);
    const corrected = await asOwner(() =>
      patchRows.run({
        ...retry,
        rows: rows.map((row, index) =>
          rankPatch(
            ids,
            { ...row, rowRevision: fresh.get(row.itemId)! },
            70 + index,
          ),
        ),
      }),
    );
    expect(corrected.receipt.idempotency.result).toBe("applied");
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([70, 71, 72]);
  });

  it("accepts the write target a collection read or row search returns, copied unchanged over MCP, and replays a retry sent without its authority scope", async () => {
    const ids = await fixture("Copied targets");
    const [row] = await seedRows(ids, 1);
    const mcp = { caller: "mcp" as const, userEmail: OWNER };
    const read = await asOwner(() =>
      getDatabase.run({ databaseId: ids.databaseId }, mcp),
    );
    if (!("database" in read) || !read.mutationContract) {
      throw new Error("The collection read returned no mutation contract.");
    }
    const readContract = read.mutationContract;
    const patched = await asOwner(() =>
      patchRows.run(
        {
          target: readContract.target,
          expectedSchemaRevision: readContract.schemaRevision,
          idempotencyKey: "copied-read-target",
          rows: [rankPatch(ids, row, 7)],
        },
        mcp,
      ),
    );
    expect(patched.receipt.counts.updated).toBe(1);
    const patchedAgain = await asOwner(() =>
      patchRows.run(
        {
          ...envelope(readContract, "copied-read-target"),
          rows: [rankPatch(ids, row, 7)],
        },
        mcp,
      ),
    );
    expect(patchedAgain.receipt).toMatchObject({
      receiptId: patched.receipt.receiptId,
      idempotency: { result: "replayed" },
    });

    const search = await asOwner(() =>
      searchRows.run({ databaseId: ids.databaseId }, mcp),
    );
    const rowCreation = search.rowCreation;
    if (!rowCreation) {
      throw new Error("The row search offered no row creation target.");
    }
    expect(rowCreation.target).toEqual(readContract.target);
    const created = await asOwner(() =>
      createRow.run(
        {
          target: rowCreation.target,
          expectedSchemaRevision: rowCreation.schemaRevision,
          idempotencyKey: "copied-search-target",
          title: "Copied target row",
          propertyEntries: [
            {
              propertyId: ids.properties.rank,
              propertyType: "number",
              value: 8,
            },
          ],
        },
        mcp,
      ),
    );
    expect(created.receipt.outcome).toBe("created");
    expect(created.receipt.replay).toBeUndefined();
    const createdAgain = await asOwner(() =>
      createRow.run(
        {
          ...envelope(readContract, "copied-search-target"),
          title: "Copied target row",
          propertyEntries: [
            {
              propertyId: ids.properties.rank,
              propertyType: "number",
              value: 8,
            },
          ],
        },
        mcp,
      ),
    );
    expect(createdAgain.receipt).toMatchObject({
      receiptId: created.receipt.receiptId,
      idempotency: { result: "replayed" },
      replay: {
        readback: "historical",
        freshRead: {
          action: "get-content-database",
          databaseId: ids.databaseId,
        },
      },
    });

    await expect(
      asOwner(() =>
        patchRows.run(
          {
            target: {
              ...readContract.target,
              authorityScope: { kind: "personal", id: COLLABORATOR },
            },
            expectedSchemaRevision: readContract.schemaRevision,
            idempotencyKey: "foreign-authority",
            rows: [
              rankPatch(
                ids,
                {
                  ...row,
                  rowRevision: patched.receipt.rows[0].revisions.after,
                },
                9,
              ),
            ],
          },
          mcp,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "TARGET_MISMATCH" });
  });

  it("never loses a concurrent table edit to a row in the batch", async () => {
    const ids = await fixture("Concurrent rows");
    const rows = await seedRows(ids, 3);
    const discovered = await contract(ids.databaseId);
    const [batch] = await Promise.allSettled([
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "concurrent"),
          rows: rows.map((row, index) => rankPatch(ids, row, 50 + index)),
        }),
      ),
      asOwner(() =>
        setProperty.run({
          documentId: rows[1].documentId,
          databaseId: ids.databaseId,
          propertyId: ids.properties.notes,
          value: "typed while the batch ran",
        }),
      ),
    ]);
    const documentIds = rows.map((row) => row.documentId);
    expect((await storedValues(documentIds, ids.properties.notes))[1]).toBe(
      "typed while the batch ran",
    );
    const ranks = await storedValues(documentIds, ids.properties.rank);
    if (batch.status === "fulfilled") {
      expect(ranks).toEqual([50, 51, 52]);
    } else {
      expect(batch.reason).toMatchObject({
        errorCode: "ROW_REVISION_CONFLICT",
      });
      expect(ranks).toEqual([1, 2, 3]);
    }
  });

  it("requires editor access to every row page and names the rows that lack it", async () => {
    const ids = await fixture("Shared rows");
    const rows = await seedRows(ids, 3);
    await getDb()
      .insert(schema.documentShares)
      .values(
        [ids.databaseDocumentId, rows[0].documentId].map((resourceId) => ({
          id: `share-${crypto.randomUUID()}`,
          resourceId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "editor",
          createdBy: OWNER,
          createdAt: new Date().toISOString(),
        })),
      );
    const discovered = await contract(ids.databaseId);
    await expect(
      asCollaborator(() =>
        patchRows.run({
          ...envelope(discovered, "collaborator-batch"),
          rows: rows.map((row, index) => rankPatch(ids, row, 80 + index)),
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "ROW_ACCESS_DENIED",
      details: {
        rows: [
          expect.objectContaining({ index: 1, itemId: rows[1].itemId }),
          expect.objectContaining({ index: 2, itemId: rows[2].itemId }),
        ],
      },
    });
    const applied = await asCollaborator(() =>
      patchRows.run({
        ...envelope(discovered, "collaborator-single"),
        rows: [rankPatch(ids, rows[0], 80)],
      }),
    );
    expect(applied.receipt.counts.updated).toBe(1);
  });

  it("rechecks collection and row access after waiting for the collection lock", async () => {
    const { databaseItemsPositionScope, withPositionLock } =
      await import("./_position-utils.js");
    const ids = await fixture("Revoked rows");
    const rows = await seedRows(ids, 2);
    const shareIds = [
      ids.databaseDocumentId,
      ...rows.map((row) => row.documentId),
    ].map((resourceId) => ({ id: `share-${crypto.randomUUID()}`, resourceId }));
    await getDb()
      .insert(schema.documentShares)
      .values(
        shareIds.map(({ id, resourceId }) => ({
          id,
          resourceId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "editor",
          createdBy: OWNER,
          createdAt: new Date().toISOString(),
        })),
      );
    const discovered = await contract(ids.databaseId);
    const revokeWhileWaiting = async (
      shareId: string,
      key: string,
      patched: typeof rows,
    ) => {
      let release!: () => void;
      const held = withPositionLock(
        databaseItemsPositionScope(ids.databaseId),
        () => new Promise<void>((resolve) => (release = resolve)),
      );
      const batch = asCollaborator(() =>
        patchRows.run({
          ...envelope(discovered, key),
          rows: patched.map((row, index) => rankPatch(ids, row, 90 + index)),
        }),
      );
      batch.catch(() => {});
      // Let the batch pass its pre-lock access check and queue behind the lock.
      await new Promise((resolve) => setTimeout(resolve, 250));
      await getDb()
        .delete(schema.documentShares)
        .where(eq(schema.documentShares.id, shareId));
      release();
      await held;
      return batch;
    };

    await expect(
      revokeWhileWaiting(shareIds[2].id, "revoked-row", rows),
    ).rejects.toMatchObject({
      errorCode: "ROW_ACCESS_DENIED",
      details: {
        rows: [expect.objectContaining({ index: 1, itemId: rows[1].itemId })],
      },
    });
    await expect(
      revokeWhileWaiting(shareIds[0].id, "revoked-collection", [rows[0]]),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([1, 2]);
  });

  it("rolls back the whole batch when two rows claim the same natural key", async () => {
    const ids = await fixture("Keyed rows");
    const key = await addProperty(ids, "Task ID", "text", undefined, true);
    const rows = await seedRows(ids, 2);
    const discovered = await contract(ids.databaseId);
    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "duplicate-key"),
          rows: rows.map((row, index) => ({
            ...rankPatch(ids, row, 10 + index),
            propertyEntries: [
              ...rankPatch(ids, row, 10 + index).propertyEntries,
              { propertyId: key, propertyType: "text" as const, value: "T-1" },
            ],
          })),
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "NATURAL_KEY_CONFLICT",
      details: {
        rows: [
          expect.objectContaining({
            index: 1,
            itemId: rows[1].itemId,
            errorCode: "NATURAL_KEY_CONFLICT",
          }),
        ],
      },
    });
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([1, 2]);

    const keyPatch = (row: SeededRow, value: string) => ({
      itemId: row.itemId,
      documentId: row.documentId,
      expectedRowRevision: row.rowRevision,
      propertyEntries: [
        { propertyId: key, propertyType: "text" as const, value },
      ],
    });
    const claimed = await asOwner(() =>
      patchRows.run({
        ...envelope(discovered, "distinct-keys"),
        rows: [keyPatch(rows[0], "T-1"), keyPatch(rows[1], "T-2")],
      }),
    );
    expect(claimed.receipt.counts.updated).toBe(2);
    const after = new Map(
      claimed.receipt.rows.map((row) => [row.itemId, row.revisions.after]),
    );
    const revised = rows.map((row) => ({
      ...row,
      rowRevision: after.get(row.itemId)!,
    }));
    await expect(
      asOwner(() =>
        patchRows.run({
          ...envelope(discovered, "changed-key"),
          rows: [keyPatch(revised[0], "T-9"), keyPatch(revised[1], "T-2")],
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "NATURAL_KEY_CONFLICT",
      details: {
        rows: [
          expect.objectContaining({
            index: 0,
            itemId: rows[0].itemId,
            errorCode: "NATURAL_KEY_IMMUTABLE",
          }),
        ],
      },
    });
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        key,
      ),
    ).toEqual(["T-1", "T-2"]);
  });
});

describe("patch-database-items receipts for MCP script recovery", () => {
  async function recordsUnderKey(databaseId: string, idempotencyKey: string) {
    return getDb()
      .select({
        operation: schema.contentDatabaseRowMutationReceipts.operation,
      })
      .from(schema.contentDatabaseRowMutationReceipts)
      .where(
        and(
          eq(schema.contentDatabaseRowMutationReceipts.databaseId, databaseId),
          eq(
            schema.contentDatabaseRowMutationReceipts.idempotencyKey,
            idempotencyKey,
          ),
        ),
      );
  }

  it("finds a batch's receipt once it commits, and closing its key after changes nothing", async () => {
    const ids = await fixture("Recovered rows");
    const rows = await seedRows(ids, 2);
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "script-write"),
      rows: rows.map((row, index) => rankPatch(ids, row, 40 + index)),
    };
    const locator = rowMutation.rowPatchReceiptLocator(input);
    expect(locator).toMatchObject({
      scope: ids.databaseId,
      idempotencyKey: "script-write",
    });
    expect(
      await asOwner(() => rowMutation.reconcileRowPatchReceipt(locator)),
    ).toEqual({ status: "absent" });

    const applied = await asOwner(() => patchRows.run(input));
    expect(applied.receipt.idempotency.payloadDigest).toBe(
      locator.payloadDigest,
    );
    const committed = {
      status: "committed",
      receipt: { receiptId: applied.receipt.receiptId },
    };
    expect(
      await asOwner(() => rowMutation.reconcileRowPatchReceipt(locator)),
    ).toEqual(committed);
    expect(
      await asOwner(() => rowMutation.fenceRowPatchReceipt(locator)),
    ).toEqual(committed);
    expect(await recordsUnderKey(ids.databaseId, "script-write")).toEqual([
      { operation: "batch:patch" },
    ]);
    const replayed = await asOwner(() => patchRows.run(input));
    expect(replayed.receipt.idempotency.result).toBe("replayed");

    const otherPayload = { ...locator, payloadDigest: "sha256:other" };
    await expect(
      asOwner(() => rowMutation.reconcileRowPatchReceipt(otherPayload)),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
    await expect(
      asOwner(() => rowMutation.fenceRowPatchReceipt(otherPayload)),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("closes an unused key so no row write can take it, and changes no row", async () => {
    const ids = await fixture("Closed key rows");
    const rows = await seedRows(ids, 2);
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "lost-script-write"),
      rows: rows.map((row, index) => rankPatch(ids, row, 60 + index)),
    };
    const locator = rowMutation.rowPatchReceiptLocator(input);

    expect(
      await asOwner(() => rowMutation.fenceRowPatchReceipt(locator)),
    ).toEqual({ status: "fenced" });
    expect(
      await asOwner(() => rowMutation.fenceRowPatchReceipt(locator)),
    ).toEqual({ status: "fenced" });
    expect(
      await asOwner(() => rowMutation.reconcileRowPatchReceipt(locator)),
    ).toEqual({ status: "absent" });
    await expect(asOwner(() => patchRows.run(input))).rejects.toMatchObject({
      errorCode: "IDEMPOTENCY_KEY_CLOSED",
    });
    await expect(
      asOwner(() =>
        updateRow.run({
          ...envelope(discovered, "lost-script-write"),
          itemId: rows[0].itemId,
          documentId: rows[0].documentId,
          expectedRowRevision: rows[0].rowRevision,
          propertyValues: { [ids.properties.rank]: 5 },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_CLOSED" });
    await expect(
      asOwner(() =>
        createRow.run({
          ...envelope(discovered, "lost-script-write"),
          title: "Task 3",
          propertyValues: { [ids.properties.rank]: 3 },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_CLOSED" });
    await expect(
      asOwner(() =>
        rowMutation.fenceRowPatchReceipt({
          ...locator,
          payloadDigest: "sha256:other",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "IDEMPOTENCY_KEY_REUSED" });

    expect(await recordsUnderKey(ids.databaseId, "lost-script-write")).toEqual([
      { operation: "closed-key" },
    ]);
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([1, 2]);
  });

  it("lets a collection viewer check a key and only an editor close one", async () => {
    const ids = await fixture("Viewed rows");
    const locator = {
      scope: ids.databaseId,
      idempotencyKey: "viewer-script-write",
      payloadDigest: "sha256:viewer",
    };
    await expect(
      asCollaborator(() => rowMutation.reconcileRowPatchReceipt(locator)),
    ).rejects.toMatchObject({ statusCode: 403 });
    await getDb()
      .insert(schema.documentShares)
      .values({
        id: `share-${crypto.randomUUID()}`,
        resourceId: ids.databaseDocumentId,
        principalType: "user",
        principalId: COLLABORATOR,
        role: "viewer",
        createdBy: OWNER,
        createdAt: new Date().toISOString(),
      });
    expect(
      await asCollaborator(() => rowMutation.reconcileRowPatchReceipt(locator)),
    ).toEqual({ status: "absent" });
    await expect(
      asCollaborator(() => rowMutation.fenceRowPatchReceipt(locator)),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(
      await recordsUnderKey(ids.databaseId, "viewer-script-write"),
    ).toEqual([]);
  });

  it("refuses a batch that was waiting for the collection when its key closed", async () => {
    const { databaseItemsPositionScope, withPositionLock } =
      await import("./_position-utils.js");
    const ids = await fixture("Waiting rows");
    const rows = await seedRows(ids, 2);
    const discovered = await contract(ids.databaseId);
    const input = {
      ...envelope(discovered, "waiting-script-write"),
      rows: rows.map((row, index) => rankPatch(ids, row, 70 + index)),
    };
    const scope = databaseItemsPositionScope(ids.databaseId);
    let release!: () => void;
    const held = withPositionLock(
      scope,
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const batch = asOwner(() => patchRows.run(input));
    batch.catch(() => {});
    try {
      const locks = (
        globalThis as {
          __contentPositionLocks?: Map<string, Promise<unknown>>;
        }
      ).__contentPositionLocks;
      await expect.poll(() => locks?.get(scope) !== held).toBe(true);
      expect(
        await asOwner(() =>
          rowMutation.fenceRowPatchReceipt(
            rowMutation.rowPatchReceiptLocator(input),
          ),
        ),
      ).toEqual({ status: "fenced" });
    } finally {
      release();
      await held;
    }

    await expect(batch).rejects.toMatchObject({
      errorCode: "IDEMPOTENCY_KEY_CLOSED",
    });
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([1, 2]);
  });

  // oracle-change: new tests that need a second connection to wait on the collection lock, which PGlite lacks; CI runs this file on PostgreSQL.
  describe.runIf(TEST_DATABASE_URL.startsWith("postgres"))(
    "while another transaction holds the collection lock",
    () => {
      function firstRow(result: unknown) {
        const rows = Array.isArray(result)
          ? result
          : (result as { rows: unknown[] }).rows;
        return rows[0] as Record<string, unknown>;
      }

      async function holdCollectionLock(databaseId: string) {
        const { lockContentDatabaseMutation } =
          await import("./_content-database-mutation-lock.js");
        let release!: () => void;
        const released = new Promise<void>((resolve) => {
          release = resolve;
        });
        let held!: (pid: number) => void;
        const holding = new Promise<number>((resolve) => {
          held = resolve;
        });
        const done = getDb().transaction(
          async (tx: Parameters<typeof lockContentDatabaseMutation>[0]) => {
            const backend = firstRow(
              await tx.execute(sql`SELECT pg_backend_pid() AS pid`),
            );
            await lockContentDatabaseMutation(tx, databaseId);
            held(Number(backend.pid));
            await released;
          },
        );
        const pid = await Promise.race([
          holding,
          done.then(() => {
            throw new Error("The holder ended before it held the lock.");
          }),
        ]);
        return {
          pid,
          release: async () => {
            release();
            await done;
          },
        };
      }

      async function waitUntilWaitingOn(holderPid: number, sessions: number) {
        await expect
          .poll(
            async () =>
              firstRow(
                await getDb().execute(
                  sql`WITH RECURSIVE waiting(pid) AS (SELECT pid FROM pg_stat_activity WHERE ${holderPid} = ANY(pg_blocking_pids(pid)) UNION SELECT activity.pid FROM pg_stat_activity activity JOIN waiting ON waiting.pid = ANY(pg_blocking_pids(activity.pid))) SELECT count(*)::int AS waiting FROM waiting`,
                ),
              ).waiting,
            { timeout: 15_000 },
          )
          .toBe(sessions);
      }

      type Settled = { value?: unknown; error?: unknown };

      async function queueBehindLock(
        databaseId: string,
        first: () => Promise<unknown>,
        second: () => Promise<unknown>,
      ): Promise<Settled[]> {
        const settle = (run: () => Promise<unknown>): Promise<Settled> =>
          run().then(
            (value) => ({ value }),
            (error: unknown) => ({ error }),
          );
        const holder = await holdCollectionLock(databaseId);
        const queued: Promise<Settled>[] = [];
        try {
          queued.push(settle(first));
          await waitUntilWaitingOn(holder.pid, 1);
          queued.push(settle(second));
          await waitUntilWaitingOn(holder.pid, 2);
        } finally {
          await holder.release();
        }
        return Promise.all(queued);
      }

      it("reports a batch that reached the lock first as committed and closes nothing", async () => {
        const ids = await fixture("Batch-first rows");
        const rows = await seedRows(ids, 2);
        const discovered = await contract(ids.databaseId);
        const input = {
          ...envelope(discovered, "batch-first"),
          rows: rows.map((row, index) => rankPatch(ids, row, 80 + index)),
        };
        const locator = rowMutation.rowPatchReceiptLocator(input);
        const [batch, fenced] = await queueBehindLock(
          ids.databaseId,
          () => asOwner(() => patchRows.run(input)),
          () => asOwner(() => rowMutation.fenceRowPatchReceipt(locator)),
        );

        expect(batch.error).toBeUndefined();
        const applied = batch.value as Awaited<
          ReturnType<typeof patchRows.run>
        >;
        expect(fenced).toEqual({
          value: {
            status: "committed",
            receipt: { receiptId: applied.receipt.receiptId },
          },
        });
        expect(
          await storedValues(
            rows.map((row) => row.documentId),
            ids.properties.rank,
          ),
        ).toEqual([80, 81]);
      });

      it("refuses a batch that reached the lock after the fence, and writes nothing", async () => {
        const ids = await fixture("Fence-first rows");
        const rows = await seedRows(ids, 2);
        const discovered = await contract(ids.databaseId);
        const input = {
          ...envelope(discovered, "fence-first"),
          rows: rows.map((row, index) => rankPatch(ids, row, 90 + index)),
        };
        const locator = rowMutation.rowPatchReceiptLocator(input);
        const [fenced, batch] = await queueBehindLock(
          ids.databaseId,
          () => asOwner(() => rowMutation.fenceRowPatchReceipt(locator)),
          () => asOwner(() => patchRows.run(input)),
        );

        expect(fenced).toEqual({ value: { status: "fenced" } });
        expect(batch.error).toMatchObject({
          errorCode: "IDEMPOTENCY_KEY_CLOSED",
        });
        expect(
          await storedValues(
            rows.map((row) => row.documentId),
            ids.properties.rank,
          ),
        ).toEqual([1, 2]);
      });

      it("refuses a fence whose caller lost edit access while it waited", async () => {
        const ids = await fixture("Revoked fence rows");
        const shareId = `share-${crypto.randomUUID()}`;
        await getDb().insert(schema.documentShares).values({
          id: shareId,
          resourceId: ids.databaseDocumentId,
          principalType: "user",
          principalId: COLLABORATOR,
          role: "editor",
          createdBy: OWNER,
          createdAt: new Date().toISOString(),
        });
        const locator = {
          scope: ids.databaseId,
          idempotencyKey: "revoked-fence",
          payloadDigest: "sha256:revoked",
        };
        const holder = await holdCollectionLock(ids.databaseId);
        const fence = asCollaborator(() =>
          rowMutation.fenceRowPatchReceipt(locator),
        );
        fence.catch(() => {});
        try {
          await waitUntilWaitingOn(holder.pid, 1);
          await getDb()
            .delete(schema.documentShares)
            .where(eq(schema.documentShares.id, shareId));
        } finally {
          await holder.release();
        }

        await expect(fence).rejects.toMatchObject({ statusCode: 403 });
        expect(await recordsUnderKey(ids.databaseId, "revoked-fence")).toEqual(
          [],
        );
      });
    },
  );
});

describe("patch-database-items through the MCP script catalog", () => {
  const PILOT_ORG = "org-script-pilot";
  const sessions: Array<{ close(): Promise<void> }> = [];
  let actions: MCPConfig["actions"];

  beforeAll(async () => {
    const { default: actionModules } =
      await import("../.generated/actions-registry.js");
    actions = loadActionsFromStaticRegistry(actionModules);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(sessions.splice(0).map((session) => session.close()));
  });

  async function scriptClient(orgId: string): Promise<MCPClient> {
    const server = await createMCPServerForRequest(
      {
        name: "Content",
        appId: "content",
        description: "Agent-Native Content",
        version: "1.0.0-test",
        actions,
        productionActions: actions,
        builtinCrossAppTools: false,
        externalAgents: { writes: "allowlisted" },
      },
      {
        userEmail: OWNER,
        orgId,
        orgDomain: undefined,
        oauthScopes: ["mcp:read", "mcp:write"],
      },
      {
        origin: "http://content.test",
        transport: "http",
        inlineMcpApps: false,
        scriptCatalog: true,
      },
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "content-script-test", version: "1" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    sessions.push(client, server);
    return client;
  }

  async function runScript(client: MCPClient, code: string) {
    const result = await client.callTool({
      name: "run-script",
      arguments: { code },
    });
    const text = result.content
      .map((entry: { type: string; text?: string }) => entry.text ?? "")
      .join("\n");
    return { result, payload: JSON.parse(text) };
  }

  function rankScript(
    ids: Awaited<ReturnType<typeof fixture>>,
    idempotencyKey: string,
  ) {
    return `
      const read = await api.getContentDatabase({ databaseId: ${JSON.stringify(ids.databaseId)} });
      const contract = read.mutationContract;
      const written = await api.patchDatabaseItems({
        target: contract.target,
        expectedSchemaRevision: contract.schemaRevision,
        idempotencyKey: ${JSON.stringify(idempotencyKey)},
        rows: read.items.map((item, index) => ({
          itemId: item.id,
          documentId: item.document.id,
          expectedRowRevision: item.rowRevision,
          propertyEntries: [
            { propertyId: ${JSON.stringify(ids.properties.rank)}, propertyType: "number", value: 30 - index },
          ],
        })),
      });
      return written.receipt.counts;
    `;
  }

  it("lets an allowlisted organization read a collection and patch its rows from one script", async () => {
    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_TOOLS", "true");
    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_ORGS", PILOT_ORG);
    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_WRITES", "true");
    const ids = await fixture("Scripted ranks");
    const rows = await seedRows(ids, 3);
    const client = await scriptClient(PILOT_ORG);

    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    expect(listed).toEqual(
      expect.arrayContaining(["run-script", "search-actions"]),
    );
    expect(listed).not.toContain("patch-database-items");

    const reads = await runScript(
      client,
      `
        const collections = await api.listContentDatabases({});
        const found = await api.searchDocuments({ query: "Scripted", mode: "words" });
        const rows = await api.searchContentDatabaseRows({ databaseId: ${JSON.stringify(ids.databaseId)} });
        const page = await api.getDocument({ id: ${JSON.stringify(ids.databaseDocumentId)} });
        return [collections, found, rows, page].map((value) => typeof value);
      `,
    );
    expect(reads.payload).toMatchObject({
      ok: true,
      result: ["object", "object", "object", "object"],
    });

    const patched = await runScript(client, rankScript(ids, "scripted-ranks"));
    expect(patched.payload).toMatchObject({
      ok: true,
      result: { requested: 3, updated: 3 },
    });
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([30, 29, 28]);
  });

  it("refuses another organization's script before it reaches a row", async () => {
    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_TOOLS", "true");
    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_ORGS", PILOT_ORG);
    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_WRITES", "true");
    const ids = await fixture("Unlisted ranks");
    const rows = await seedRows(ids, 1);
    const client = await scriptClient("org-not-on-the-list");

    const listed = (await client.listTools()).tools.map((tool) => tool.name);
    expect(listed).not.toContain("run-script");
    expect(listed).toContain("patch-database-items");
    const refused = await client.callTool({
      name: "run-script",
      arguments: { code: rankScript(ids, "unlisted-ranks") },
    });
    expect(refused.isError).toBe(true);
    expect(
      await storedValues(
        rows.map((row) => row.documentId),
        ids.properties.rank,
      ),
    ).toEqual([1]);
  });
});
