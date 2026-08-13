import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-list-databases-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let listContentDatabasesAction: typeof import("./list-content-databases.js").default;
let describeContentDatabaseAction: typeof import("./describe-content-database.js").default;

const OWNER = "owner@example.com";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  listContentDatabasesAction = (await import("./list-content-databases.js"))
    .default;
  describeContentDatabaseAction = (
    await import("./describe-content-database.js")
  ).default;
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
  description?: string;
  spaceId?: string;
  systemRole?: string;
  hideFromSearch?: boolean;
  ownerEmail?: string;
}) {
  const db = getDb();
  const now = new Date().toISOString();
  const ownerEmail = args.ownerEmail ?? OWNER;
  await db.insert(schema.documents).values({
    id: args.documentId,
    ownerEmail,
    spaceId: args.spaceId,
    parentId: null,
    title: args.title,
    content: "",
    description: args.description ?? "",
    hideFromSearch: args.hideFromSearch ? 1 : 0,
    position: 1,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.contentDatabases).values({
    id: args.databaseId,
    ownerEmail,
    spaceId: args.spaceId,
    documentId: args.documentId,
    title: args.title,
    systemRole: args.systemRole,
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
            spaceId: null,
            title: "CmdK Database TestDB",
            description: "",
          },
        ],
      });
    });
  });

  it("searches user-authored descriptions and returns live identity metadata", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-described",
      databaseId: "db-described",
      title: "Intake Queue",
      description: "Collects requests for editorial design review",
      spaceId: "space-creative",
    });
    await getDb()
      .update(schema.contentDatabases)
      .set({ title: "Stale database title" })
      .where(eq(schema.contentDatabases.id, "db-described"));

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({ query: "EDITORIAL DESIGN" }),
      ).resolves.toEqual({
        databases: [
          {
            databaseId: "db-described",
            documentId: "db-doc-described",
            spaceId: "space-creative",
            title: "Intake Queue",
            description: "Collects requests for editorial design review",
          },
        ],
      });
    });
  });

  it("resolves exact IDs and titles within an exact space", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-exact",
      databaseId: "db-exact",
      title: "Product Feedback",
      description: "Captures product feedback",
      spaceId: "space-product",
    });
    await createDatabaseDocument({
      documentId: "db-doc-exact-other-space",
      databaseId: "db-exact-other-space",
      title: "Product Feedback",
      spaceId: "space-other",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      const expected = {
        databases: [
          {
            databaseId: "db-exact",
            documentId: "db-doc-exact",
            spaceId: "space-product",
            title: "Product Feedback",
            description: "Captures product feedback",
          },
        ],
      };
      await expect(
        listContentDatabasesAction.run({ databaseId: "db-exact" }),
      ).resolves.toEqual(expected);
      await expect(
        listContentDatabasesAction.run({ documentId: "db-doc-exact" }),
      ).resolves.toEqual(expected);
      await expect(
        listContentDatabasesAction.run({
          spaceId: "space-product",
          title: "product feedback",
        }),
      ).resolves.toEqual(expected);

      const description = await describeContentDatabaseAction.run({
        databaseId: "db-exact",
      });
      expect(description).toMatchObject({
        database: {
          id: "db-exact",
          documentId: "db-doc-exact",
          title: "Product Feedback",
          description: "Captures product feedback",
        },
        properties: [],
      });
      expect(description).not.toHaveProperty("items");
    });
  });

  it("fails closed when exact title resolution is missing or ambiguous", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-ambiguous-a",
      databaseId: "db-ambiguous-a",
      title: "Shared Intake",
    });
    await createDatabaseDocument({
      documentId: "db-doc-ambiguous-b",
      databaseId: "db-ambiguous-b",
      title: "Shared Intake",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({ title: "Missing Intake" }),
      ).rejects.toThrow(/No accessible Content database matched/);
      await expect(
        listContentDatabasesAction.run({ title: "Shared Intake", limit: 1 }),
      ).rejects.toThrow(/ambiguous across 2 accessible Content databases/);
      await expect(
        listContentDatabasesAction.run({ title: "   " }),
      ).rejects.toThrow();
    });
  });

  it("bounds ordinary discovery results", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-bounded-a",
      databaseId: "db-bounded-a",
      title: "Bounded Intake A",
    });
    await createDatabaseDocument({
      documentId: "db-doc-bounded-b",
      databaseId: "db-bounded-b",
      title: "Bounded Intake B",
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({ query: "Bounded Intake", limit: 1 }),
      ).resolves.toMatchObject({ databases: [{ databaseId: "db-bounded-a" }] });
    });
  });

  it("does not disclose system or inaccessible databases", async () => {
    await createDatabaseDocument({
      documentId: "db-doc-system",
      databaseId: "db-system",
      title: "System Files",
      systemRole: "files",
    });
    await createDatabaseDocument({
      documentId: "db-doc-private-other",
      databaseId: "db-private-other",
      title: "Private Other",
      ownerEmail: "other@example.com",
    });
    await createDatabaseDocument({
      documentId: "db-doc-hidden",
      databaseId: "db-hidden",
      title: "Hidden Intake",
      hideFromSearch: true,
    });

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        listContentDatabasesAction.run({ databaseId: "db-system" }),
      ).rejects.toThrow(/No accessible Content database matched/);
      await expect(
        listContentDatabasesAction.run({ databaseId: "db-private-other" }),
      ).rejects.toThrow(/No accessible Content database matched/);
      await expect(
        listContentDatabasesAction.run({ databaseId: "db-hidden" }),
      ).rejects.toThrow(/No accessible Content database matched/);
      await expect(
        describeContentDatabaseAction.run({ databaseId: "db-system" }),
      ).rejects.toThrow("Content database not found.");

      let inaccessibleError: unknown;
      try {
        await describeContentDatabaseAction.run({
          documentId: "db-doc-private-other",
        });
      } catch (error) {
        inaccessibleError = error;
      }
      expect(inaccessibleError).toBeInstanceOf(Error);
      expect((inaccessibleError as Error).message).toBe(
        "Content database not found.",
      );
      expect((inaccessibleError as Error).message).not.toContain(
        "db-private-other",
      );
    });
  });

  it("preserves unexpected database discovery failures", async () => {
    const discovery = vi
      .spyOn(listContentDatabasesAction, "run")
      .mockRejectedValueOnce(new Error("database unavailable"));

    await runWithRequestContext({ userEmail: OWNER }, async () => {
      await expect(
        describeContentDatabaseAction.run({ databaseId: "db-exact" }),
      ).rejects.toThrow("database unavailable");
    });
    discovery.mockRestore();
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
});
