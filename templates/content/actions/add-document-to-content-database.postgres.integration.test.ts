import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: vi.fn().mockResolvedValue(undefined),
}));

// PGlite runs every transaction on one connection, so the `.db.test.ts` suite
// cannot interleave two of them and cannot prove a row lock. This runs against
// a real PostgreSQL pool, where two adoptions genuinely overlap.
//
// Not in CI yet: the only place that invokes a Content Postgres suite is the
// root `test:content-db-postgres` script, and the root package.json is a
// FULL_CHECK_FILES entry (scripts/ci-change-scope.ts), so adding it there
// forces a full-tree lint that currently fails on unrelated formatting debt in
// main. Run it by hand until that is wired:
//
//   CONTENT_ROW_MUTATION_POSTGRES_URL=postgres://postgres@127.0.0.1:5432/content_test \
//     pnpm --filter content exec vitest --run \
//     actions/add-document-to-content-database.postgres.integration.test.ts \
//     --config vitest.config.ts
const POSTGRES_URL = process.env.CONTENT_ROW_MUTATION_POSTGRES_URL;
const OWNER = "synthetic-postgres-adopt-owner@example.test";

let getDb: () => any;
let schema: typeof import("../server/db/schema.js");
let addDocumentToContentDatabase: typeof import("./add-document-to-content-database.js").default;

beforeAll(async () => {
  if (!POSTGRES_URL) return;
  const databaseName = new URL(POSTGRES_URL).pathname.slice(1).toLowerCase();
  if (!databaseName.includes("test")) {
    throw new Error(
      "CONTENT_ROW_MUTATION_POSTGRES_URL must name an isolated test database.",
    );
  }
  process.env.DATABASE_URL = POSTGRES_URL;
  const database = await import("../server/db/index.js");
  getDb = database.getDb;
  schema = database.schema;
  addDocumentToContentDatabase = (
    await import("./add-document-to-content-database.js")
  ).default;
  await (await import("../server/plugins/db.js")).default(undefined as any);
}, 60_000);

afterAll(() => {
  delete process.env.DATABASE_URL;
});

async function fixture() {
  const db = getDb();
  const key = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const stamp = "2026-01-01T00:00:00.000Z";
  const spaceId = `postgres_adopt_space_${key}`;
  const filesDatabaseId = `postgres_adopt_files_db_${key}`;
  const filesDocumentId = `postgres_adopt_files_page_${key}`;
  const firstDatabaseId = `postgres_adopt_first_db_${key}`;
  const firstDocumentId = `postgres_adopt_first_page_${key}`;
  const secondDatabaseId = `postgres_adopt_second_db_${key}`;
  const secondDocumentId = `postgres_adopt_second_page_${key}`;
  const documentId = `postgres_adopt_row_${key}`;

  await db.insert(schema.documents).values([
    {
      id: filesDocumentId,
      ownerEmail: OWNER,
      spaceId,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: firstDocumentId,
      ownerEmail: OWNER,
      spaceId,
      title: "First collection",
      content: "",
      visibility: "private",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: secondDocumentId,
      ownerEmail: OWNER,
      spaceId,
      title: "Second collection",
      content: "",
      visibility: "private",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: documentId,
      ownerEmail: OWNER,
      spaceId,
      title: "Already written",
      content: "# Already written",
      visibility: "private",
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  await db.insert(schema.contentDatabases).values([
    {
      id: filesDatabaseId,
      ownerEmail: OWNER,
      spaceId,
      documentId: filesDocumentId,
      title: "Files",
      systemRole: "files",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: firstDatabaseId,
      ownerEmail: OWNER,
      spaceId,
      documentId: firstDocumentId,
      title: "First collection",
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: secondDatabaseId,
      ownerEmail: OWNER,
      spaceId,
      documentId: secondDocumentId,
      title: "Second collection",
      createdAt: stamp,
      updatedAt: stamp,
    },
  ]);
  await db.insert(schema.contentSpaces).values({
    id: spaceId,
    name: "Synthetic Postgres adopt space",
    kind: "personal",
    ownerEmail: OWNER,
    filesDatabaseId,
    createdBy: OWNER,
    createdAt: stamp,
    updatedAt: stamp,
  });
  return {
    spaceId,
    documentId,
    firstDatabaseId,
    firstDocumentId,
    secondDatabaseId,
    secondDocumentId,
  };
}

async function cleanupFixture(seed: Awaited<ReturnType<typeof fixture>>) {
  const db = getDb();
  await db
    .delete(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.documentId, seed.documentId));
  await db
    .delete(schema.contentDatabaseItems)
    .where(eq(schema.contentDatabaseItems.ownerEmail, OWNER));
  await db
    .delete(schema.contentDatabases)
    .where(eq(schema.contentDatabases.spaceId, seed.spaceId));
  await db
    .delete(schema.documents)
    .where(eq(schema.documents.spaceId, seed.spaceId));
  await db
    .delete(schema.contentSpaces)
    .where(eq(schema.contentSpaces.id, seed.spaceId));
}

const postgresSuite = POSTGRES_URL ? describe : describe.skip;

postgresSuite("add-document-to-content-database PostgreSQL locking", () => {
  it("keeps one ordinary membership when a page is adopted into two collections at once", async () => {
    const seed = await fixture();
    try {
      const adopt = (databaseId: string) =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          addDocumentToContentDatabase.run(
            { databaseId, documentId: seed.documentId },
            {} as any,
          ),
        );

      const outcomes = await Promise.allSettled([
        adopt(seed.firstDatabaseId),
        adopt(seed.secondDatabaseId),
      ]);

      // The collection-scoped locks are different for these two calls, so
      // only the page's own row lock can serialize them. Without it both
      // observe no other membership and the page becomes a row of two
      // ordinary collections at once.
      expect(
        outcomes.filter((outcome) => outcome.status === "fulfilled"),
      ).toHaveLength(1);

      const memberships = await getDb()
        .select({ databaseId: schema.contentDatabaseItems.databaseId })
        .from(schema.contentDatabaseItems)
        .innerJoin(
          schema.contentDatabases,
          eq(
            schema.contentDatabases.id,
            schema.contentDatabaseItems.databaseId,
          ),
        )
        .where(
          and(
            eq(schema.contentDatabaseItems.documentId, seed.documentId),
            isNull(schema.contentDatabases.systemRole),
          ),
        );
      expect(memberships).toHaveLength(1);

      const [document] = await getDb()
        .select({ parentId: schema.documents.parentId })
        .from(schema.documents)
        .where(eq(schema.documents.id, seed.documentId));
      expect(document.parentId).toBe(
        memberships[0].databaseId === seed.firstDatabaseId
          ? seed.firstDocumentId
          : seed.secondDocumentId,
      );
    } finally {
      await cleanupFixture(seed);
    }
  }, 60_000);
});
