import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const readBlocksFieldIdentities = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock("./_blocks-field-identity.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_blocks-field-identity.js")>();
  readBlocksFieldIdentities.spy.mockImplementation(
    actual.readBlocksFieldIdentities,
  );
  return {
    ...actual,
    readBlocksFieldIdentities: readBlocksFieldIdentities.spy,
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-database-list-read-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "owner@example.com";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let createContentDatabaseAction: typeof import("./create-content-database.js").default;
let configureDocumentPropertyAction: typeof import("./configure-document-property.js").default;
let getContentDatabaseAction: typeof import("./get-content-database.js").default;
let queryContentDatabaseItemsAction: typeof import("./query-content-database-items.js").default;
let addDatabaseItemAction: typeof import("./add-database-item.js").default;
let setDocumentPropertyAction: typeof import("./set-document-property.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  createContentDatabaseAction = (await import("./create-content-database.js"))
    .default;
  configureDocumentPropertyAction = (
    await import("./configure-document-property.js")
  ).default;
  getContentDatabaseAction = (await import("./get-content-database.js"))
    .default;
  queryContentDatabaseItemsAction = (
    await import("./query-content-database-items.js")
  ).default;
  addDatabaseItemAction = (await import("./add-database-item.js")).default;
  setDocumentPropertyAction = (await import("./set-document-property.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  const { scheduleStartupMaintenance } =
    await import("../server/lib/startup-maintenance.js");
  await scheduleStartupMaintenance();
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

beforeEach(() => {
  readBlocksFieldIdentities.spy.mockClear();
});

function asOwner<T>(run: () => Promise<T>) {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

async function seedDatabase(suffix: string) {
  return asOwner(async () => {
    const created = await createContentDatabaseAction.run({
      title: `Tasks ${suffix}`,
    });
    const databaseId = created.database.id;
    const documentId = created.database.documentId;
    const score = await configureDocumentPropertyAction.run({
      documentId,
      databaseId,
      name: "Score",
      type: "number",
    });
    const related = await configureDocumentPropertyAction.run({
      documentId,
      databaseId,
      name: "Related",
      type: "relation",
      options: { relation: { databaseId } },
    });
    const propertyId = (
      response: {
        properties: Array<{ definition: { id: string; name: string } }>;
      },
      name: string,
    ) => {
      const found = response.properties.find(
        (property) => property.definition.name === name,
      );
      if (!found) throw new Error(`Missing property ${name}`);
      return found.definition.id;
    };
    const scoreId = propertyId(score, "Score");
    const relatedId = propertyId(related, "Related");
    const read = await getContentDatabaseAction.run({ databaseId });
    if (!("database" in read) || !read.mutationContract) {
      throw new Error("Fixture database has no mutation contract.");
    }
    const primaryBlocksId = read.properties.find(
      (property) =>
        property.definition.type === "blocks" &&
        property.definition.options.blocks?.primary === true,
    )?.definition.id;
    if (!primaryBlocksId) throw new Error("Missing primary Blocks field.");
    const rows: Array<{ documentId: string; title: string }> = [];
    for (const [index, value] of [5, 7, 11].entries()) {
      const title = `Row ${suffix} ${index}`;
      const row = await addDatabaseItemAction.run({
        target: read.mutationContract.target,
        expectedSchemaRevision: read.mutationContract.schemaRevision,
        idempotencyKey: `list-read-${suffix}-${index}`,
        title,
        propertyValues: { [scoreId]: value },
      });
      rows.push({ documentId: row.receipt.row.documentId, title });
    }
    return {
      databaseId,
      documentId,
      scoreId,
      relatedId,
      primaryBlocksId,
      rows,
    };
  });
}

describe("content database list reads", () => {
  it("returns rows without loading Blocks field identities", async () => {
    const fixture = await seedDatabase("identities");
    const bodyWrite = await asOwner(() =>
      setDocumentPropertyAction.run({
        documentId: fixture.rows[0]!.documentId,
        databaseId: fixture.databaseId,
        propertyId: fixture.primaryBlocksId,
        value: "## Plan\n\nShip the list read.\n",
      }),
    );
    expect(readBlocksFieldIdentities.spy).toHaveBeenCalled();
    expect(
      bodyWrite.properties.find(
        (property) => property.definition.id === fixture.primaryBlocksId,
      )?.blocksField?.revision,
    ).toEqual(expect.any(Number));

    readBlocksFieldIdentities.spy.mockClear();
    const [databaseRead, pageRead] = await asOwner(() =>
      Promise.all([
        getContentDatabaseAction.run(
          { documentId: fixture.documentId },
          { caller: "frontend", userEmail: OWNER },
        ),
        queryContentDatabaseItemsAction.run({
          documentId: fixture.documentId,
          limit: 100,
          tableQuery: {
            search: "",
            filters: [],
            sorts: [
              { key: fixture.scoreId, label: "Score", direction: "desc" },
            ],
            filterMode: "and",
          },
        }),
      ]),
    );

    expect(readBlocksFieldIdentities.spy).not.toHaveBeenCalled();
    if (!("items" in databaseRead) || !("items" in pageRead)) {
      throw new Error("Fixture database read was unavailable.");
    }
    expect(databaseRead.items).toHaveLength(3);
    expect(pageRead.items.map((item) => item.document.title)).toEqual([
      "Row identities 2",
      "Row identities 1",
      "Row identities 0",
    ]);
    for (const item of [...databaseRead.items, ...pageRead.items]) {
      for (const property of item.properties) {
        expect(property).not.toHaveProperty("blocksField");
      }
    }
    expect(databaseRead.mutationContract?.target.databaseId).toBe(
      fixture.databaseId,
    );
    expect(databaseRead.setupContract?.canEditSchema).toBe(true);
  });

  it("evaluates a rollup per row from one linked-value read", async () => {
    const fixture = await seedDatabase("rollups");
    const [first, second, third] = fixture.rows;
    const now = new Date().toISOString();
    const rollupId = `rollup_${fixture.databaseId}`;
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: rollupId,
        ownerEmail: OWNER,
        databaseId: fixture.databaseId,
        name: "Related score",
        type: "rollup",
        visibility: "always_show",
        optionsJson: JSON.stringify({
          rollup: {
            relationPropertyId: fixture.relatedId,
            targetPropertyId: fixture.scoreId,
            aggregation: "sum",
          },
        }),
        position: 99,
        createdAt: now,
        updatedAt: now,
      });
    await asOwner(async () => {
      await setDocumentPropertyAction.run({
        documentId: first!.documentId,
        databaseId: fixture.databaseId,
        propertyId: fixture.relatedId,
        value: [second!.documentId, third!.documentId],
      });
      await setDocumentPropertyAction.run({
        documentId: second!.documentId,
        databaseId: fixture.databaseId,
        propertyId: fixture.relatedId,
        value: [third!.documentId],
      });
    });

    const read = await asOwner(() =>
      getContentDatabaseAction.run(
        { databaseId: fixture.databaseId },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    if (!("items" in read)) throw new Error("Fixture read was unavailable.");
    const rollupByTitle = Object.fromEntries(
      read.items.map((item) => [
        item.document.title,
        item.properties.find((property) => property.definition.id === rollupId)
          ?.value,
      ]),
    );
    expect(rollupByTitle).toEqual({
      "Row rollups 0": 18,
      "Row rollups 1": 11,
      "Row rollups 2": null,
    });
  });
});
