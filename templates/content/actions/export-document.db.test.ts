import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-export-document-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let exportDocumentAction: typeof import("./export-document.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  exportDocumentAction = (await import("./export-document.js")).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

let nextPosition = 0;

async function createDocument(args: {
  id: string;
  title: string;
  content?: string;
  ownerEmail?: string;
  visibility?: "private" | "org" | "public";
  trashedAt?: string;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      ownerEmail: args.ownerEmail ?? OWNER,
      parentId: null,
      title: args.title,
      content: args.content ?? "",
      position: nextPosition++,
      visibility: args.visibility ?? "private",
      trashedAt: args.trashedAt,
      createdAt: now,
      updatedAt: now,
    });
}

async function createDatabase(args: {
  id: string;
  documentId: string;
  title: string;
  viewType?: "table" | "list";
}) {
  await createDocument({
    id: args.documentId,
    title: args.title,
  });
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      documentId: args.documentId,
      title: args.title,
      viewConfigJson: JSON.stringify({
        activeViewId: "primary",
        views: [
          {
            id: "primary",
            name: args.viewType === "list" ? "List" : "Table",
            type: args.viewType ?? "table",
          },
        ],
      }),
    });
}

async function addDatabaseItem(args: {
  id: string;
  databaseId: string;
  documentId: string;
  position: number;
  bodyHydrationStatus?: "pending" | "hydrated" | "unavailable";
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      databaseId: args.databaseId,
      documentId: args.documentId,
      position: args.position,
      bodyHydrationStatus: args.bodyHydrationStatus ?? "hydrated",
      createdAt: now,
      updatedAt: now,
    });
}

async function shareDocumentWithOwner(documentId: string, id: string) {
  await getDb().insert(schema.documentShares).values({
    id,
    resourceId: documentId,
    principalType: "user",
    principalId: OWNER,
    role: "viewer",
    createdBy: "someone-else@example.com",
    createdAt: new Date().toISOString(),
  });
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
      id: args.id,
      ownerEmail: OWNER,
      databaseId: args.databaseId,
      name: args.name,
      type: args.type,
      visibility: "always_show",
      optionsJson: args.optionsJson ?? "{}",
      position: args.position,
      createdAt: now,
      updatedAt: now,
    });
}

async function setPropertyValue(args: {
  id: string;
  documentId: string;
  propertyId: string;
  value: unknown;
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documentPropertyValues)
    .values({
      id: args.id,
      ownerEmail: OWNER,
      documentId: args.documentId,
      propertyId: args.propertyId,
      valueJson: JSON.stringify(args.value),
      createdAt: now,
      updatedAt: now,
    });
}

async function setDatabaseViewFilters(
  databaseId: string,
  filters: Array<{
    key: string;
    label: string;
    operator: "equals";
    value: string;
  }>,
  sorts: Array<{
    key: string;
    label: string;
    direction: "asc" | "desc";
  }> = [],
) {
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
            filters,
            sorts,
            filterMode: "and",
          },
        ],
      }),
    })
    .where(eq(schema.contentDatabases.id, databaseId));
}

describe("export-document database collections", () => {
  it.each(["table", "list"] as const)(
    "exports immediate authorized members from a %s view in membership order for every format",
    async (viewType) => {
      const databaseId = `launch-library-${viewType}`;
      const databaseDocumentId = `launch-library-document-${viewType}`;
      const faqId = `faq-${viewType}`;
      const announcementId = `announcement-${viewType}`;
      const sharedRecordId = `shared-record-${viewType}`;
      const publicRecordId = `public-record-${viewType}`;
      const privateRecordId = `private-record-${viewType}`;

      await createDatabase({
        id: databaseId,
        documentId: databaseDocumentId,
        title: "Launch Library",
        viewType,
      });
      await createDocument({
        id: faqId,
        title: "FAQ",
        content: "Answers",
      });
      await createDocument({
        id: announcementId,
        title: "Announcement",
        content: "Launch copy",
      });
      await createDocument({
        id: sharedRecordId,
        title: "Shared record",
        content: "Shared body",
        ownerEmail: "someone-else@example.com",
      });
      await shareDocumentWithOwner(
        sharedRecordId,
        `shared-record-share-${viewType}`,
      );
      await createDocument({
        id: publicRecordId,
        title: "Public record",
        content: "Public body",
        ownerEmail: "someone-else@example.com",
        visibility: "public",
      });
      await createDocument({
        id: privateRecordId,
        title: "Private record",
        content: "Do not export",
        ownerEmail: "someone-else@example.com",
      });
      await addDatabaseItem({
        id: `faq-item-${viewType}`,
        databaseId,
        documentId: faqId,
        position: 2,
      });
      await addDatabaseItem({
        id: `announcement-item-${viewType}`,
        databaseId,
        documentId: announcementId,
        position: 1,
      });
      await addDatabaseItem({
        id: `shared-item-${viewType}`,
        databaseId,
        documentId: sharedRecordId,
        position: 3,
      });
      await addDatabaseItem({
        id: `private-item-${viewType}`,
        databaseId,
        documentId: privateRecordId,
        position: 0,
      });
      await addDatabaseItem({
        id: `public-item-${viewType}`,
        databaseId,
        documentId: publicRecordId,
        position: 4,
      });

      const [markdown, html, pdf, csv] = await runWithRequestContext(
        { userEmail: OWNER },
        () =>
          Promise.all([
            ...(["markdown", "html", "pdf"] as const).map((format) =>
              exportDocumentAction.run({
                id: databaseDocumentId,
                format,
                collection: {
                  scope: { kind: "all_members" },
                  propertyIds: [],
                  includePrimaryBody: true,
                  blockPropertyIds: [],
                },
              }),
            ),
            exportDocumentAction.run({
              id: databaseDocumentId,
              format: "csv",
              collection: {
                scope: { kind: "all_members" },
                propertyIds: [],
                includePrimaryBody: true,
                blockPropertyIds: [],
              },
            }),
          ]),
      );

      expect(markdown.filename).toBe("launch-library.zip");
      expect(markdown.archiveFiles?.[0]).toEqual({
        path: "index.md",
        content: expect.stringContaining("[Announcement](records/0001-"),
      });
      expect(markdown.archiveFiles?.map((file) => file.path)).toHaveLength(5);
      expect(markdown.archiveFiles?.[1]?.content).toContain(
        'id: "announcement-',
      );
      expect(markdown.archiveFiles?.[1]?.content).toContain("properties: {}");
      expect(markdown.archiveFiles?.[1]?.content).toContain(
        "## Content\n\nLaunch copy",
      );
      expect(
        markdown.archiveFiles?.some((file) =>
          file.content.includes("Private record"),
        ),
      ).toBe(false);
      for (const result of [html, pdf]) {
        expect(result.content).toContain("<h1>Launch Library</h1>");
        expect(result.content).toContain("<h2>Announcement</h2>");
        expect(result.content).toContain("<p>Launch copy</p>");
        expect(result.content).toContain("<h2>FAQ</h2>");
        expect(result.content).toContain("<p>Answers</p>");
        expect(result.content).toContain("<h2>Shared record</h2>");
        expect(result.content).toContain("<p>Shared body</p>");
        expect(result.content).toContain("<h2>Public record</h2>");
        expect(result.content).toContain("<p>Public body</p>");
        expect(result.content).not.toContain("Private record");
        expect(result.content.indexOf("<h2>Announcement</h2>")).toBeLessThan(
          result.content.indexOf("<h2>FAQ</h2>"),
        );
      }
      expect(csv.content).toBe(
        "Title,Content\r\nAnnouncement,Launch copy\r\nFAQ,Answers\r\nShared record,Shared body\r\nPublic record,Public body\r\n",
      );

      const currentViewCsv = await runWithRequestContext(
        { userEmail: OWNER },
        () =>
          exportDocumentAction.run({
            id: databaseDocumentId,
            format: "csv",
            collection: {
              scope: {
                kind: "current_view",
                viewId: "primary",
                query: {
                  search: "FAQ",
                  filters: [],
                  sorts: [],
                  filterMode: "and",
                },
              },
              propertyIds: [],
              includePrimaryBody: false,
              blockPropertyIds: [],
            },
          }),
      );
      expect(currentViewCsv.content).toBe("Title\r\nFAQ\r\n");
    },
  );

  it("makes an empty database export explicit", async () => {
    await createDatabase({
      id: "empty-database",
      documentId: "empty-database-document",
      title: "Empty Database",
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: "empty-database-document",
        format: "markdown",
      }),
    );

    expect(result.archiveFiles).toEqual([
      {
        path: "index.md",
        content: "# Empty Database\n\n_No accessible items._\n",
      },
    ]);
  });

  it("treats a database with only trashed members as having no accessible items", async () => {
    await createDatabase({
      id: "trashed-database",
      documentId: "trashed-database-document",
      title: "Trashed Database",
    });
    await createDocument({
      id: "trashed-page",
      title: "Trashed Page",
      content: "Do not export",
      trashedAt: new Date().toISOString(),
    });
    await addDatabaseItem({
      id: "trashed-item",
      databaseId: "trashed-database",
      documentId: "trashed-page",
      position: 0,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: "trashed-database-document",
        format: "markdown",
      }),
    );

    expect(result.archiveFiles).toEqual([
      {
        path: "index.md",
        content: "# Trashed Database\n\n_No accessible items._\n",
      },
    ]);
  });

  it("fails instead of silently omitting a member whose body is not ready", async () => {
    await createDatabase({
      id: "pending-database",
      documentId: "pending-database-document",
      title: "Pending Database",
    });
    await createDocument({
      id: "pending-page",
      title: "Pending Page",
    });
    await addDatabaseItem({
      id: "pending-item",
      databaseId: "pending-database",
      documentId: "pending-page",
      position: 0,
      bodyHydrationStatus: "pending",
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({
          id: "pending-database-document",
          format: "markdown",
        }),
      ),
    ).rejects.toThrow('Database item "pending-page" is not ready for export');
  });

  it("fails distinctly when a selected provider body is terminally unavailable", async () => {
    await createDatabase({
      id: "unavailable-database",
      documentId: "unavailable-database-document",
      title: "Unavailable Database",
    });
    await createDocument({
      id: "unavailable-page",
      title: "Unavailable Page",
    });
    await addDatabaseItem({
      id: "unavailable-item",
      databaseId: "unavailable-database",
      documentId: "unavailable-page",
      position: 0,
      bodyHydrationStatus: "unavailable",
    });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({
          id: "unavailable-database-document",
          format: "markdown",
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "collection_export_body_unavailable",
      message:
        'Database item "unavailable-page" body is unavailable for export.',
    });
  });

  it("intersects saved, personal, and transient filters so callers cannot remove, replace, or widen saved predicates", async () => {
    const databaseId = "trusted-view-database";
    const databaseDocumentId = "trusted-view-database-document";
    await createDatabase({
      id: databaseId,
      documentId: databaseDocumentId,
      title: "Trusted View",
    });
    await addProperty({
      id: "trusted-status",
      databaseId,
      name: "Status",
      type: "text",
      position: 0,
    });
    await addProperty({
      id: "trusted-cohort",
      databaseId,
      name: "Cohort",
      type: "text",
      position: 1,
    });
    await setDatabaseViewFilters(databaseId, [
      {
        key: "trusted-status",
        label: "Status",
        operator: "equals",
        value: "allowed",
      },
    ]);
    for (const [id, status, cohort, position] of [
      ["allowed-personal", "allowed", "personal", 0],
      ["allowed-other", "allowed", "other", 1],
      ["blocked-personal", "blocked", "personal", 2],
    ] as const) {
      await createDocument({ id, title: id });
      await addDatabaseItem({
        id: `${id}-item`,
        databaseId,
        documentId: id,
        position,
      });
      await setPropertyValue({
        id: `${id}-status-value`,
        documentId: id,
        propertyId: "trusted-status",
        value: status,
      });
      await setPropertyValue({
        id: `${id}-cohort-value`,
        documentId: id,
        propertyId: "trusted-cohort",
        value: cohort,
      });
    }
    await putUserSetting(
      OWNER,
      `content-database-personal-view:${databaseId}`,
      {
        version: 2,
        activeViewId: "primary",
        views: [
          {
            id: "primary",
            sorts: [],
            filters: [
              {
                key: "trusted-cohort",
                label: "Cohort",
                operator: "equals",
                value: "personal",
              },
            ],
            filterMode: "and",
          },
        ],
      },
    );

    const run = (filters: Array<any>, filterMode: "and" | "or" = "and") =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({
          id: databaseDocumentId,
          format: "csv",
          collection: {
            scope: {
              kind: "current_view",
              viewId: "primary",
              query: { search: "", filters, sorts: [], filterMode },
            },
            propertyIds: [],
            includePrimaryBody: false,
            blockPropertyIds: [],
          },
        }),
      );

    await expect(run([])).resolves.toMatchObject({
      content: "Title\r\nallowed-personal\r\n",
    });
    await expect(
      run([
        {
          key: "trusted-status",
          label: "Status",
          operator: "equals",
          value: "blocked",
        },
      ]),
    ).resolves.toMatchObject({ content: "Title\r\n" });
    await expect(
      run(
        [
          {
            key: "trusted-status",
            label: "Status",
            operator: "equals",
            value: "allowed",
          },
          {
            key: "trusted-status",
            label: "Status",
            operator: "equals",
            value: "blocked",
          },
        ],
        "or",
      ),
    ).resolves.toMatchObject({
      content: "Title\r\nallowed-personal\r\n",
    });
  });

  it("uses the server-resolved effective View order instead of caller-supplied sorts", async () => {
    const databaseId = "trusted-view-order-database";
    const databaseDocumentId = "trusted-view-order-document";
    await createDatabase({
      id: databaseId,
      documentId: databaseDocumentId,
      title: "Trusted View Order",
    });
    await setDatabaseViewFilters(
      databaseId,
      [],
      [{ key: "name", label: "Name", direction: "desc" }],
    );
    for (const [id, title, position] of [
      ["order-z", "Zulu", 0],
      ["order-a", "Alpha", 1],
    ] as const) {
      await createDocument({ id, title });
      await addDatabaseItem({
        id: `${id}-item`,
        databaseId,
        documentId: id,
        position,
      });
    }
    await putUserSetting(
      OWNER,
      `content-database-personal-view:${databaseId}`,
      {
        version: 2,
        activeViewId: "primary",
        views: [
          {
            id: "primary",
            sorts: [{ key: "name", label: "Name", direction: "asc" }],
            filters: [],
            filterMode: "and",
          },
        ],
      },
    );

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: databaseDocumentId,
        format: "csv",
        collection: {
          scope: {
            kind: "current_view",
            viewId: "primary",
            query: {
              search: "",
              filters: [],
              sorts: [{ key: "name", label: "Name", direction: "desc" }],
              filterMode: "and",
            },
          },
          propertyIds: [],
          includePrimaryBody: false,
          blockPropertyIds: [],
        },
      }),
    );

    expect(result.content).toBe("Title\r\nAlpha\r\nZulu\r\n");
  });

  it("checks body hydration after body-independent saved narrowing", async () => {
    const databaseId = "hydration-narrowing-database";
    const databaseDocumentId = "hydration-narrowing-document";
    await createDatabase({
      id: databaseId,
      documentId: databaseDocumentId,
      title: "Hydration Narrowing",
    });
    await addProperty({
      id: "hydration-status",
      databaseId,
      name: "Status",
      type: "text",
      position: 0,
    });
    await setDatabaseViewFilters(databaseId, [
      {
        key: "hydration-status",
        label: "Status",
        operator: "equals",
        value: "ready",
      },
    ]);
    for (const [id, status, hydration, position] of [
      ["ready-body", "ready", "hydrated", 0],
      ["pending-excluded", "blocked", "pending", 1],
    ] as const) {
      await createDocument({ id, title: id, content: `${id} content` });
      await addDatabaseItem({
        id: `${id}-item`,
        databaseId,
        documentId: id,
        position,
        bodyHydrationStatus: hydration,
      });
      await setPropertyValue({
        id: `${id}-status-value`,
        documentId: id,
        propertyId: "hydration-status",
        value: status,
      });
    }

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: databaseDocumentId,
        format: "html",
        collection: {
          scope: {
            kind: "current_view",
            viewId: "primary",
            query: { search: "", filters: [], sorts: [], filterMode: "and" },
          },
          propertyIds: [],
          includePrimaryBody: true,
          blockPropertyIds: [],
        },
      }),
    );
    expect(result.content).toContain("ready-body content");
    expect(result.content).not.toContain("pending-excluded");
  });

  it("evaluates selected formulas through their dependency closure and skips unrelated rollups", async () => {
    const databaseId = "computed-export-database";
    const databaseDocumentId = "computed-export-document";
    await createDatabase({
      id: databaseId,
      documentId: databaseDocumentId,
      title: "Computed Export",
    });
    await createDocument({ id: "computed-row", title: "Computed row" });
    await addDatabaseItem({
      id: "computed-row-item",
      databaseId,
      documentId: "computed-row",
      position: 0,
      bodyHydrationStatus: "pending",
    });
    await addProperty({
      id: "computed-base",
      databaseId,
      name: "Base",
      type: "number",
      position: 0,
    });
    await addProperty({
      id: "computed-formula",
      databaseId,
      name: "Doubled",
      type: "formula",
      position: 1,
      optionsJson: JSON.stringify({ formula: "{Base} * 2" }),
    });
    await addProperty({
      id: "unrelated-rollup",
      databaseId,
      name: "Unrelated",
      type: "rollup",
      position: 2,
      optionsJson: JSON.stringify({
        rollup: {
          relationPropertyId: "missing-relation",
          targetPropertyId: "computed-formula",
          aggregation: "sum",
        },
      }),
    });
    await setPropertyValue({
      id: "computed-base-value",
      documentId: "computed-row",
      propertyId: "computed-base",
      value: 3,
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: databaseDocumentId,
        format: "csv",
        collection: {
          scope: { kind: "all_members" },
          propertyIds: ["computed-formula"],
          includePrimaryBody: false,
          blockPropertyIds: [],
        },
      }),
    );
    expect(result.content).toBe("Title,Doubled\r\nComputed row,6\r\n");
  });

  it("exports selected scalar CSV columns without waiting for unselected Blocks", async () => {
    const databaseId = "csv-scalar-database";
    const databaseDocumentId = "csv-scalar-database-document";
    await createDatabase({
      id: databaseId,
      documentId: databaseDocumentId,
      title: "CSV Scalars",
    });
    await createDocument({ id: "csv-scalar-row", title: "=formula" });
    await addDatabaseItem({
      id: "csv-scalar-item",
      databaseId,
      documentId: "csv-scalar-row",
      position: 0,
      bodyHydrationStatus: "pending",
    });
    await addProperty({
      id: "csv-status",
      databaseId,
      name: "Status",
      type: "status",
      position: 0,
      optionsJson: JSON.stringify({
        options: [{ id: "ready", name: "Ready" }],
      }),
    });
    await addProperty({
      id: "csv-blocks",
      databaseId,
      name: "Content",
      type: "blocks",
      position: 1,
      optionsJson: JSON.stringify({ blocks: { primary: true } }),
    });
    await addProperty({
      id: "csv-extra-blocks",
      databaseId,
      name: "Notes",
      type: "blocks",
      position: 2,
      optionsJson: JSON.stringify({ blocks: { primary: false } }),
    });
    await getDb().insert(schema.documentBlockFieldContents).values({
      id: "csv-extra-blocks-content",
      ownerEmail: OWNER,
      documentId: "csv-scalar-row",
      propertyId: "csv-extra-blocks",
      content: "## Notes\nline",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await setPropertyValue({
      id: "csv-status-value",
      documentId: "csv-scalar-row",
      propertyId: "csv-status",
      value: "ready",
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: databaseDocumentId,
        format: "csv",
        collection: {
          scope: { kind: "all_members" },
          propertyIds: ["csv-status"],
          includePrimaryBody: false,
          blockPropertyIds: [],
        },
      }),
    );

    expect(result.content).toBe("Title,Status\r\n'=formula,Ready\r\n");
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({
          id: databaseDocumentId,
          format: "csv",
          collection: {
            scope: { kind: "all_members" },
            propertyIds: [],
            includePrimaryBody: true,
            blockPropertyIds: [],
          },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "collection_export_body_not_ready",
    });

    await getDb()
      .update(schema.contentDatabaseItems)
      .set({ bodyHydrationStatus: "hydrated" })
      .where(eq(schema.contentDatabaseItems.id, "csv-scalar-item"));
    const blocksResult = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: databaseDocumentId,
        format: "csv",
        collection: {
          scope: { kind: "all_members" },
          propertyIds: [],
          includePrimaryBody: false,
          blockPropertyIds: ["csv-extra-blocks"],
        },
      }),
    );
    expect(blocksResult.content).toBe(
      'Title,Notes\r\n\'=formula,"## Notes\nline"\r\n',
    );
  });

  it("fails explicitly when authorized candidates cross the 5,000-record synchronous boundary", async () => {
    const databaseId = "candidate-limit-database";
    const databaseDocumentId = "candidate-limit-document";
    await createDatabase({
      id: databaseId,
      documentId: databaseDocumentId,
      title: "Candidate Limit",
    });
    const now = new Date().toISOString();
    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      id: `candidate-limit-row-${index}`,
      itemId: `candidate-limit-item-${index}`,
    }));
    for (let offset = 0; offset < rows.length; offset += 40) {
      const batch = rows.slice(offset, offset + 40);
      await getDb()
        .insert(schema.documents)
        .values(
          batch.map((row, index) => ({
            id: row.id,
            ownerEmail: OWNER,
            parentId: null,
            title: row.id,
            content: "",
            position: offset + index,
            visibility: "private",
            createdAt: now,
            updatedAt: now,
          })),
        );
      await getDb()
        .insert(schema.contentDatabaseItems)
        .values(
          batch.map((row, index) => ({
            id: row.itemId,
            ownerEmail: OWNER,
            databaseId,
            documentId: row.id,
            position: offset + index,
            bodyHydrationStatus: "hydrated",
            createdAt: now,
            updatedAt: now,
          })),
        );
    }

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        exportDocumentAction.run({
          id: databaseDocumentId,
          format: "csv",
          collection: {
            scope: { kind: "all_members" },
            propertyIds: [],
            includePrimaryBody: false,
            blockPropertyIds: [],
          },
        }),
      ),
    ).rejects.toMatchObject({
      errorCode: "collection_export_limit_exceeded",
    });
  }, 60_000);

  it("keeps ordinary page exports unchanged", async () => {
    await createDocument({
      id: "ordinary-page",
      title: "Ordinary Page",
      content: "Page body",
    });

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      exportDocumentAction.run({
        id: "ordinary-page",
        format: "markdown",
      }),
    );

    expect(result.content).toBe("# Ordinary Page\n\nPage body\n");
  });
});
