import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
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
const VIEWER = "viewer@example.com";

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

async function readPage(databaseId: string, limit?: number, userEmail = OWNER) {
  const response = await runWithRequestContext({ userEmail }, () =>
    getContentDatabaseAction.run(
      { databaseId, limit },
      { caller: "frontend", userEmail },
    ),
  );
  if (!("items" in response)) throw new Error("Fixture read was unavailable.");
  return response.items;
}

async function showPageTextInList(databaseId: string) {
  await getDb()
    .update(schema.contentDatabases)
    .set({
      viewConfigJson: JSON.stringify({
        activeViewId: "notes",
        views: [
          {
            id: "notes",
            name: "Notes",
            type: "list",
            itemLayout: {
              leading: { kind: "page_icon", propertyId: null },
              titleWeight: "bold",
              line2: { source: "page", propertyId: null, lines: 2 },
              line3: [],
              trailing: [],
            },
          },
        ],
      }),
    })
    .where(eq(schema.contentDatabases.id, databaseId));
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
        item.properties.find(
          (property) =>
            "propertyId" in property && property.propertyId === rollupId,
        )?.value,
      ]),
    );
    expect(rollupByTitle).toEqual({
      "Row rollups 0": 18,
      "Row rollups 1": 11,
      "Row rollups 2": null,
    });
  });

  it("adds each row's excerpt only while a List view shows page text", async () => {
    const fixture = await seedDatabase("excerpts");
    await asOwner(() =>
      setDocumentPropertyAction.run({
        documentId: fixture.rows[0]!.documentId,
        databaseId: fixture.databaseId,
        propertyId: fixture.primaryBlocksId,
        value: "## Plan\n\n**Ship** the [list read](https://example.com).\n",
      }),
    );

    for (const item of await readPage(fixture.databaseId, 100)) {
      expect(item).not.toHaveProperty("excerpt");
    }

    await showPageTextInList(fixture.databaseId);

    const items = await readPage(fixture.databaseId, 100);
    expect(
      Object.fromEntries(
        items.map((item) => [item.document.title, item.excerpt]),
      ),
    ).toEqual({
      "Row excerpts 0": "Ship the list read.",
      "Row excerpts 1": "",
      "Row excerpts 2": "",
    });
    // The rest of each body still stays out of row reads.
    for (const item of items) expect(item.document.content).toBe("");
    // Unpaged reads come from menus and pickers, which draw no rows.
    for (const item of await readPage(fixture.databaseId)) {
      expect(item).not.toHaveProperty("excerpt");
    }
  });

  it("marks an excerpt cut off, and drops its last word, only when the body goes on", async () => {
    const fixture = await seedDatabase("prefix");
    // The sprout is one character to the database but two UTF-16 units.
    const start = "Closing words \u{1F331}\n\n![](https://example.com/";
    const end = ".png)";
    const bodyOfLength = (length: number) =>
      `${start}${"a".repeat(length - Array.from(start).length - end.length)}${end}`;
    // A code block pads the body so the part read ends right after "words".
    const cutAfterWords = (tail: string) => {
      const kept = tail.slice(0, tail.indexOf("words") + "words".length);
      const pad = 1000 - "```\n\n```\n\n".length - kept.length;
      return `\`\`\`\n${"x".repeat(pad)}\n\`\`\`\n\n${tail}`;
    };
    for (const [index, content] of [
      bodyOfLength(1000),
      cutAfterWords("Short ending words, then more."),
      cutAfterWords("Short ending wordsmith here."),
    ].entries()) {
      await getDb()
        .update(schema.documents)
        .set({ content })
        .where(eq(schema.documents.id, fixture.rows[index]!.documentId));
    }
    await showPageTextInList(fixture.databaseId);

    const items = await readPage(fixture.databaseId, 100);
    expect(
      Object.fromEntries(
        items.map((item) => [item.document.title, item.excerpt]),
      ),
    ).toEqual({
      "Row prefix 0": "Closing words \u{1F331}",
      "Row prefix 1": "Short ending words...",
      "Row prefix 2": "Short ending...",
    });
  });

  it("leaves out the text of pages the reader can't open", async () => {
    const fixture = await seedDatabase("access");
    for (const row of fixture.rows) {
      await getDb()
        .update(schema.documents)
        .set({ content: `Notes for ${row.title}.` })
        .where(eq(schema.documents.id, row.documentId));
    }
    // The collection and its second row are shared; the other rows aren't.
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documentShares)
      .values(
        [fixture.documentId, fixture.rows[1]!.documentId].map(
          (resourceId, index) => ({
            id: `share-access-${index}`,
            resourceId,
            principalType: "user" as const,
            principalId: VIEWER,
            role: "viewer" as const,
            createdBy: OWNER,
            createdAt: now,
          }),
        ),
      );
    await showPageTextInList(fixture.databaseId);

    const items = await readPage(fixture.databaseId, 100, VIEWER);
    expect(
      items.map((item) => [
        item.document.title,
        item.document.canView,
        item.excerpt,
      ]),
    ).toEqual([
      ["Row access 0", false, ""],
      ["Row access 1", true, "Notes for Row access 1."],
      ["Row access 2", false, ""],
    ]);
  });

  it("adds excerpts to the rows a filtered, paged read returns", async () => {
    const fixture = await seedDatabase("paged");
    const [first, second, third] = fixture.rows;
    const now = new Date().toISOString();
    const rollupId = `rollup_${fixture.databaseId}`;
    // Sorting by a rollup makes the server filter and page after it reads.
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
      for (const [index, row] of fixture.rows.entries()) {
        await setDocumentPropertyAction.run({
          documentId: row.documentId,
          databaseId: fixture.databaseId,
          propertyId: fixture.primaryBlocksId,
          value: `Body of row ${index}.`,
        });
      }
    });
    await showPageTextInList(fixture.databaseId);

    const page = await asOwner(() =>
      queryContentDatabaseItemsAction.run({
        documentId: fixture.documentId,
        limit: 1,
        offset: 1,
        tableQuery: {
          search: "",
          filters: [],
          sorts: [{ key: rollupId, label: "Related score", direction: "desc" }],
          filterMode: "and",
        },
      }),
    );
    if (!("items" in page)) throw new Error("Fixture read was unavailable.");
    expect(
      page.items.map((item) => [item.document.title, item.excerpt]),
    ).toEqual([["Row paged 1", "Body of row 1."]]);
  });

  it("sends compact rows only to Content's frontend and callers that ask", async () => {
    const fixture = await seedDatabase("row-shape");
    const { contentDatabaseCompactRowsSchema, getContentDatabaseResponse } =
      await import("./_database-utils.js");
    const { hydrateContentDatabaseResponse } =
      await import("../shared/database-row-properties.js");
    const caller = (name: "mcp" | "http" | "frontend") => ({
      caller: name,
      userEmail: OWNER,
    });
    const read = (args: { compactRows?: boolean }, context = caller("mcp")) =>
      getContentDatabaseAction.run(
        { databaseId: fixture.databaseId, ...args },
        context,
      );
    const page = (args: { compactRows?: boolean }) =>
      queryContentDatabaseItemsAction.run(
        { databaseId: fixture.databaseId, ...args },
        caller("http"),
      );
    const [agentRead, frontendRead, optInRead, httpPage, optInPage, direct] =
      await asOwner(() =>
        Promise.all([
          read({}),
          read({}, caller("frontend")),
          read({ compactRows: true }),
          page({}),
          page({ compactRows: true }),
          getContentDatabaseResponse(fixture.databaseId),
        ]),
      );
    if (
      !("items" in agentRead) ||
      !("items" in frontendRead) ||
      !("items" in optInRead) ||
      !("items" in httpPage) ||
      !("items" in optInPage)
    ) {
      throw new Error("Fixture read was unavailable.");
    }
    const rowProperties = (items: ReadonlyArray<{ properties: object[] }>) =>
      items.flatMap((item) => item.properties);
    const carriesDefinitions = (
      items: ReadonlyArray<{ properties: object[] }>,
    ) =>
      rowProperties(items).length > 0 &&
      rowProperties(items).every(
        (property) => "definition" in property && !("propertyId" in property),
      );
    const namesPropertyIds = (items: ReadonlyArray<{ properties: object[] }>) =>
      rowProperties(items).length > 0 &&
      rowProperties(items).every(
        (property) => "propertyId" in property && !("definition" in property),
      );

    // Agents, MCP, HTTP and server-side readers (view-screen, source setup)
    // keep the full row shape by default.
    expect(carriesDefinitions(agentRead.items)).toBe(true);
    expect(carriesDefinitions(httpPage.items)).toBe(true);
    expect(httpPage).not.toHaveProperty("properties");
    expect(carriesDefinitions(direct.items)).toBe(true);

    expect(namesPropertyIds(frontendRead.items)).toBe(true);
    expect(namesPropertyIds(optInRead.items)).toBe(true);
    expect(namesPropertyIds(optInPage.items)).toBe(true);
    expect(
      optInPage.properties?.map((property) => property.definition.id),
    ).toContain(fixture.scoreId);
    // Putting the definitions back gives the agent's rows. (A top-level
    // definition also spells out `icon: null`, which a row's omits.)
    expect(hydrateContentDatabaseResponse(frontendRead).items).toMatchObject(
      agentRead.items,
    );

    // GET actions receive the opt-in as a query string.
    expect(contentDatabaseCompactRowsSchema.parse("true")).toBe(true);
    expect(contentDatabaseCompactRowsSchema.parse("false")).toBe(false);
    expect(contentDatabaseCompactRowsSchema.safeParse("ture").success).toBe(
      false,
    );
  });
});
