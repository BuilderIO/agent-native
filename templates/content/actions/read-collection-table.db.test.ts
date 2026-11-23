import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-read-collection-table-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let readCollectionTableAction: typeof import("./read-collection-table.js").default;

const OWNER = "owner@example.com";
const EMPTY_QUERY = {
  search: "",
  filters: [],
  sorts: [],
  filterMode: "and" as const,
};

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  readCollectionTableAction = (await import("./read-collection-table.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function documentValues(id: string, title: string, position = 0) {
  const now = new Date().toISOString();
  return {
    id,
    ownerEmail: OWNER,
    parentId: null,
    title,
    content: "",
    position,
    visibility: "private" as const,
    createdAt: now,
    updatedAt: now,
  };
}

async function createCollection(prefix: string, rowTitles: string[]) {
  const databaseId = `${prefix}-database`;
  const documentId = `${prefix}-page`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values(documentValues(documentId, "Reading list"));
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: databaseId,
      ownerEmail: OWNER,
      documentId,
      title: "Reading list",
      viewConfigJson: JSON.stringify({
        activeViewId: "primary",
        views: [{ id: "primary", name: "Table", type: "table" }],
      }),
    });
  const rows = rowTitles.map((title, index) => ({
    id: `${prefix}-row-${index}`,
    title,
    index,
  }));
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    await getDb()
      .insert(schema.documents)
      .values(batch.map((row) => documentValues(row.id, row.title, row.index)));
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values(
        batch.map((row) => ({
          id: `${row.id}-item`,
          ownerEmail: OWNER,
          databaseId,
          documentId: row.id,
          position: row.index,
          createdAt: now,
          updatedAt: now,
        })),
      );
  }
  return { databaseId, documentId, rowIds: rows.map((row) => row.id) };
}

async function addProperty(args: {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  position: number;
  optionsJson?: string;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentPropertyDefinitions)
    .values({
      ...args,
      ownerEmail: OWNER,
      visibility: "always_show",
      optionsJson: args.optionsJson ?? "{}",
      createdAt: now,
      updatedAt: now,
    });
}

async function setPropertyValue(
  documentId: string,
  propertyId: string,
  value: unknown,
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentPropertyValues)
    .values({
      id: `${documentId}-${propertyId}`,
      ownerEmail: OWNER,
      documentId,
      propertyId,
      valueJson: JSON.stringify(value),
      createdAt: now,
      updatedAt: now,
    });
}

describe("read-collection-table", () => {
  it("reads the rows a view shows as text, title first, then the given properties", async () => {
    const { databaseId, documentId, rowIds } = await createCollection("shown", [
      "Dune",
      "Emma",
      "Ulysses",
    ]);
    await addProperty({
      id: "shown-author",
      databaseId,
      name: "Author",
      type: "text",
      position: 0,
    });
    await addProperty({
      id: "shown-status",
      databaseId,
      name: "Status",
      type: "select",
      position: 1,
      optionsJson: JSON.stringify({
        options: [
          { id: "read", name: "Read", color: "green" },
          { id: "unread", name: "Unread", color: "gray" },
        ],
      }),
    });
    await setPropertyValue(rowIds[0], "shown-author", "Frank Herbert");
    await setPropertyValue(rowIds[0], "shown-status", "read");
    await setPropertyValue(rowIds[1], "shown-author", "Jane Austen");
    await setPropertyValue(rowIds[1], "shown-status", "unread");
    await setPropertyValue(rowIds[2], "shown-author", "James Joyce");
    await setPropertyValue(rowIds[2], "shown-status", "read");

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      readCollectionTableAction.run({
        documentId,
        viewId: "primary",
        tableQuery: {
          ...EMPTY_QUERY,
          filters: [
            {
              key: "shown-status",
              label: "Status",
              operator: "equals",
              value: "read",
            },
          ],
        },
        propertyIds: ["shown-status", "shown-author"],
      }),
    );

    expect(result).toEqual({
      fits: true,
      properties: ["Status", "Author"],
      rows: [
        ["Dune", "Read", "Frank Herbert"],
        ["Ulysses", "Read", "James Joyce"],
      ],
    });
  });

  it("reads the rows the view's own query shows, not the saved filters a personal view replaced", async () => {
    const { databaseId, documentId, rowIds } = await createCollection(
      "personal",
      ["Dune", "Emma", "Ulysses"],
    );
    await addProperty({
      id: "personal-status",
      databaseId,
      name: "Status",
      type: "text",
      position: 0,
    });
    await setPropertyValue(rowIds[0], "personal-status", "read");
    await setPropertyValue(rowIds[1], "personal-status", "unread");
    await setPropertyValue(rowIds[2], "personal-status", "read");
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          activeViewId: "primary",
          views: [
            {
              id: "primary",
              name: "Table",
              type: "table",
              filters: [
                {
                  key: "personal-status",
                  label: "Status",
                  operator: "equals",
                  value: "unread",
                },
              ],
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, databaseId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      readCollectionTableAction.run({
        documentId,
        viewId: "primary",
        tableQuery: {
          ...EMPTY_QUERY,
          filters: [
            {
              key: "personal-status",
              label: "Status",
              operator: "equals",
              value: "read",
            },
          ],
          sorts: [{ key: "name", label: "Name", direction: "desc" }],
        },
        propertyIds: ["personal-status"],
      }),
    );

    expect(result).toEqual({
      fits: true,
      properties: ["Status"],
      rows: [
        ["Ulysses", "read"],
        ["Dune", "read"],
      ],
    });
  });

  it("reports a view with more rows than a table holds instead of reading it", async () => {
    const { documentId } = await createCollection(
      "large",
      Array.from({ length: 501 }, (_, index) => `Row ${index + 1}`),
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      readCollectionTableAction.run({
        documentId,
        viewId: "primary",
        tableQuery: EMPTY_QUERY,
        propertyIds: [],
      }),
    );

    expect(result).toEqual({ fits: false, rowCount: 501 });
  });

  it("does not read a collection the caller can't open", async () => {
    const { documentId } = await createCollection("private", ["Secret"]);

    await expect(
      runWithRequestContext({ userEmail: "stranger@example.com" }, () =>
        readCollectionTableAction.run({
          documentId,
          viewId: "primary",
          tableQuery: EMPTY_QUERY,
          propertyIds: [],
        }),
      ),
    ).rejects.toThrow(/not found/);
  });
});
