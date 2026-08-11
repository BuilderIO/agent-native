import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-list-databases-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listContentDatabasesAction: typeof import("./list-content-databases.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listContentDatabasesAction = (await import("./list-content-databases.js"))
    .default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

async function createDatabaseDocument(args: {
  documentId: string;
  databaseId: string;
  title: string;
  spaceId?: string;
  systemRole?: string;
  hideFromSearch?: number;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  await db.insert(schema.documents).values({
    id: args.documentId,
    ownerEmail: OWNER,
    parentId: null,
    title: args.title,
    content: "",
    position: 1,
    spaceId: args.spaceId,
    hideFromSearch: args.hideFromSearch ?? 0,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: args.databaseId,
    ownerEmail: OWNER,
    documentId: args.documentId,
    title: args.title,
    spaceId: args.spaceId,
    systemRole: args.systemRole,
  });
}

async function createPersonalSpace(args: {
  id: string;
  name: string;
  filesDatabaseId: string;
}) {
  const now = new Date().toISOString();
  await getDb().insert(schema.contentSpaces).values({
    id: args.id,
    name: args.name,
    kind: "personal",
    ownerEmail: OWNER,
    orgId: null,
    filesDatabaseId: args.filesDatabaseId,
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
}

describe("list-content-databases", () => {
  it("matches database document titles case-insensitively", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-cmdk",
      databaseId: "db-cmdk",
      title: "CmdK Database TestDB",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({ query: "cmdk", limit: 6 }),
      ).resolves.toEqual({
        databases: [
          {
            databaseId: "db-cmdk",
            documentId: "db-doc-cmdk",
            title: "CmdK Database TestDB",
          },
        ],
      });
    });
  });

  it("excludes a database when its document id is passed (no source attached yet)", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-self",
      databaseId: "db-self",
      title: "Self",
    });
    await createDatabaseDocument({
      documentId: "db-doc-other",
      databaseId: "db-other",
      title: "Other",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      const result = await listContentDatabasesAction.run({
        excludeDatabaseIds: ["db-doc-self"],
      });

      expect(
        result.databases.map((database) => database.databaseId),
      ).not.toContain("db-self");
      expect(result.databases.map((database) => database.databaseId)).toContain(
        "db-other",
      );
    });
  });

  it("excludes databases whose local-table source chain points back to the configured database", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-root",
      databaseId: "db-root",
      title: "Root",
    });
    await createDatabaseDocument({
      documentId: "db-doc-child",
      databaseId: "db-child",
      title: "Child",
    });
    await createDatabaseDocument({
      documentId: "db-doc-grandchild",
      databaseId: "db-grandchild",
      title: "Grandchild",
    });
    const now = new Date().toISOString();
    const db = getDb();
    await db.insert(schema.contentDatabaseSources).values([
      {
        id: "src-child-root",
        ownerEmail: OWNER,
        databaseId: "db-child",
        sourceType: "local-table",
        sourceName: "Root",
        sourceTable: "db-root",
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "src-grandchild-child",
        ownerEmail: OWNER,
        databaseId: "db-grandchild",
        sourceType: "local-table",
        sourceName: "Child",
        sourceTable: "db-child",
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      const result = await listContentDatabasesAction.run({
        excludeDatabaseIds: ["db-root"],
      });

      expect(
        result.databases.map((database) => database.databaseId),
      ).not.toContain("db-root");
      expect(
        result.databases.map((database) => database.databaseId),
      ).not.toContain("db-child");
      expect(
        result.databases.map((database) => database.databaseId),
      ).not.toContain("db-grandchild");
    });
  });

  it("finds an exact Personal database and classifies system collections without title or count assumptions", async () => {
    // These immutable IDs are the read-only regression anchors recovered from
    // Alice's Personal scope after the observed Slack DM returned other IDs.
    const spaceId = "content_space_personal_dd0c011c68137c2ae7baa4d672932070";
    const feedbackDatabaseId = "7uLr3ect3IIm";
    const feedbackDocumentId = "FJk2OZ1SWcZ9";
    await createPersonalSpace({
      id: spaceId,
      name: "Personal",
      filesDatabaseId: "system-files-exact",
    });
    await createDatabaseDocument({
      documentId: feedbackDocumentId,
      databaseId: feedbackDatabaseId,
      title: "Feedback",
      spaceId,
    });
    await createDatabaseDocument({
      documentId: "feedback-document-same-name",
      databaseId: "feedback-database-same-name",
      title: "Feedback",
      spaceId,
    });
    for (const systemRole of ["files", "favorites", "workspaces"]) {
      await createDatabaseDocument({
        documentId: `system-${systemRole}-document-exact`,
        databaseId: `system-${systemRole}-exact`,
        title: systemRole === "files" ? "Personal" : systemRole,
        spaceId,
        systemRole,
        hideFromSearch: 1,
      });
    }

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      const inventory = await listContentDatabasesAction.run({
        spaceId,
        includeSystemCollections: true,
      });
      expect(inventory.databases).toContainEqual({
        databaseId: feedbackDatabaseId,
        documentId: feedbackDocumentId,
        title: "Feedback",
        spaceId,
        spaceName: "Personal",
        spaceKind: "personal",
        systemRole: null,
      });
      expect(
        inventory.databases.some((database) => database.systemRole !== null),
      ).toBe(false);
      expect(
        new Set(
          inventory.systemCollections?.map(
            (collection) => collection.systemRole,
          ),
        ),
      ).toEqual(new Set(["files", "favorites", "workspaces"]));

      await expect(
        listContentDatabasesAction.run({
          spaceId,
          databaseId: feedbackDatabaseId,
        }),
      ).resolves.toEqual({
        databases: [
          {
            databaseId: feedbackDatabaseId,
            documentId: feedbackDocumentId,
            title: "Feedback",
            spaceId,
            spaceName: "Personal",
            spaceKind: "personal",
            systemRole: null,
          },
        ],
      });
    });

    await runWithRequestContext(
      { userEmail: "managed-channel@integration.local" },
      async () => {
        await expect(
          listContentDatabasesAction.run({
            spaceId,
            databaseId: feedbackDatabaseId,
          }),
        ).rejects.toThrow();
      },
    );
  });
});
