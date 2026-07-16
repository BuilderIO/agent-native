import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializeContentSourceDocument } from "../shared/content-source.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `import-content-source-test-${process.pid}-${Date.now()}.sqlite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let importContentSourceAction: typeof import("./import-content-source.js").default;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;

const OWNER = "owner@example.com";
const VIEWER = "import-viewer@example.com";
const ORG_ID = "import-viewer-org";

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  importContentSourceAction = (await import("./import-content-source.js"))
    .default;
  provisionContentSpaces = (await import("./_content-spaces.js"))
    .provisionContentSpaces;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL
  )`);
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
  }
});

function sourceWithDescription(description: string) {
  return serializeContentSourceDocument({
    id: "doc_description_roundtrip",
    parentId: null,
    title: "Description round-trip",
    description,
    content: "Body",
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
  });
}

describe("import-content-source descriptions", () => {
  it("requires editor access before importing into an organization space", async () => {
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
      args: [ORG_ID, "Import viewer org", OWNER, Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: ["import-viewer-membership", ORG_ID, VIEWER, "member", Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES (?, ?, ?, ?, ?)",
      args: ["import-owner-membership", ORG_ID, OWNER, "owner", Date.now()],
    });
    await runWithRequestContext({ userEmail: OWNER, orgId: ORG_ID }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );

    await expect(
      runWithRequestContext({ userEmail: VIEWER, orgId: ORG_ID }, () =>
        importContentSourceAction.run({
          files: {
            "content/viewer-import.mdx": serializeContentSourceDocument({
              id: "viewer_import_document",
              parentId: null,
              title: "Viewer import",
              content: "Should not be written",
              icon: null,
              position: 0,
              isFavorite: false,
              hideFromSearch: false,
              visibility: "org",
            }),
          },
          dryRun: false,
        }),
      ),
    ).rejects.toThrow("Editor access is required");
    await expect(
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, "viewer_import_document")),
    ).resolves.toEqual([]);
  });

  it("persists exported descriptions when creating and updating documents", async () => {
    const path =
      "content/description-round-trip--doc_description_roundtrip.mdx";

    const created = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithDescription("Initial stable guidance") },
        dryRun: false,
      }),
    );

    expect(created.created).toEqual([
      expect.objectContaining({ id: "doc_description_roundtrip", path }),
    ]);
    await expect(
      getDb()
        .select({
          description: schema.documents.description,
          spaceId: schema.documents.spaceId,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_description_roundtrip")),
    ).resolves.toEqual([
      {
        description: "Initial stable guidance",
        spaceId: expect.stringMatching(/^content_space_personal_/),
      },
    ]);

    const updated = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithDescription("Revised stable guidance") },
        dryRun: false,
      }),
    );

    expect(updated.updated).toEqual([
      expect.objectContaining({ id: "doc_description_roundtrip", path }),
    ]);
    await expect(
      getDb()
        .select({ description: schema.documents.description })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_description_roundtrip")),
    ).resolves.toEqual([{ description: "Revised stable guidance" }]);

    const unchanged = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithDescription("Revised stable guidance") },
        dryRun: false,
      }),
    );

    expect(unchanged.unchanged).toEqual([
      expect.objectContaining({ id: "doc_description_roundtrip", path }),
    ]);
  });
});
