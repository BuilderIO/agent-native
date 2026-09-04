import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { serializeContentSourceDocument } from "../shared/content-source.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `import-content-source-test-${process.pid}-${Date.now()}.pglite`,
);

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let importContentSourceAction: typeof import("./import-content-source.js").default;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;

const OWNER = "owner@example.com";
const EDITOR = "editor@example.com";
const VIEWER = "import-viewer@example.com";
const ORG_ID = "import-viewer-org";

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
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
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
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

function sourceWithFavorite(isFavorite: boolean) {
  return serializeContentSourceDocument({
    id: "doc_favorite_roundtrip",
    parentId: null,
    title: "Favorite round-trip",
    description: "",
    content: "Body",
    icon: null,
    position: 0,
    isFavorite,
    hideFromSearch: false,
    visibility: "private",
  });
}

describe("import-content-source descriptions", () => {
  it("creates and updates visibility while preserving it when omitted", async () => {
    const path = "content/visibility-round-trip--doc_visibility_roundtrip.mdx";
    const source = (visibility?: "private" | "org" | "public") =>
      [
        "---",
        'id: "doc_visibility_roundtrip"',
        'title: "Visibility round-trip"',
        ...(visibility ? [`visibility: "${visibility}"`] : []),
        "---",
        "",
        "Body",
      ].join("\n");

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: source("public") },
        dryRun: false,
      }),
    );
    await expect(
      getDb()
        .select({ visibility: schema.documents.visibility })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_visibility_roundtrip")),
    ).resolves.toEqual([{ visibility: "public" }]);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: source() },
        dryRun: false,
      }),
    );
    await expect(
      getDb()
        .select({ visibility: schema.documents.visibility })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_visibility_roundtrip")),
    ).resolves.toEqual([{ visibility: "public" }]);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: source("private") },
        dryRun: false,
      }),
    );
    await expect(
      getDb()
        .select({ visibility: schema.documents.visibility })
        .from(schema.documents)
        .where(eq(schema.documents.id, "doc_visibility_roundtrip")),
    ).resolves.toEqual([{ visibility: "private" }]);
  });

  it("does not let an editor change visibility through import", async () => {
    const id = "doc_editor_visibility_guard";
    const path = `content/editor-visibility--${id}.mdx`;
    const source = (visibility: "private" | "public", content: string) =>
      serializeContentSourceDocument({
        id,
        parentId: null,
        title: "Editor visibility guard",
        content,
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        visibility,
      });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: source("private", "Owner body") },
        dryRun: false,
      }),
    );
    await getDb().insert(schema.documentShares).values({
      id: "import-editor-visibility-share",
      resourceId: id,
      principalType: "user",
      principalId: EDITOR,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });

    const result = await runWithRequestContext({ userEmail: EDITOR }, () =>
      importContentSourceAction.run({
        files: { [path]: source("public", "Editor body") },
        dryRun: false,
      }),
    );

    expect(result.skipped).toEqual([
      {
        path,
        reason: `Requires admin access to change visibility on document "${id}".`,
      },
    ]);
    await expect(
      getDb()
        .select({
          content: schema.documents.content,
          visibility: schema.documents.visibility,
        })
        .from(schema.documents)
        .where(eq(schema.documents.id, id)),
    ).resolves.toEqual([{ content: "Owner body", visibility: "private" }]);
  });

  it("reports structural MDX transformations during a dry-run import", async () => {
    const path = "content/mixed-mdx.mdx";
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: {
          [path]: [
            '<Aside type="note">',
            "Keep this source.",
            "</Aside>",
            "",
            "| Component | Responsibility |",
            "| --- | --- |",
            "| Content | Preserve structure |",
            "",
            "```mermaid",
            "flowchart TD",
            "  Import --> Repair",
            "```",
            "",
            "Trailing content.",
          ].join("\n"),
        },
        dryRun: true,
      }),
    );

    expect(result.errors).toEqual([]);
    expect(result.fidelity[path]).toEqual({
      status: "transformed",
      normalizedChanged: true,
      conversions: [{ kind: "gfm-pipe-table-to-content-table", count: 1 }],
      unresolved: [],
    });
  });

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

  it("uses Favorites membership rather than the legacy document flag", async () => {
    const path = "content/favorite-round-trip--doc_favorite_roundtrip.mdx";
    const provisioned = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithFavorite(true) },
        dryRun: false,
      }),
    );
    await expect(
      getDb()
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(
              schema.contentDatabaseItems.databaseId,
              provisioned.favoritesDatabaseId,
            ),
            eq(
              schema.contentDatabaseItems.documentId,
              "doc_favorite_roundtrip",
            ),
          ),
        ),
    ).resolves.toHaveLength(1);

    await getDb()
      .update(schema.documents)
      .set({ isFavorite: 0 })
      .where(eq(schema.documents.id, "doc_favorite_roundtrip"));
    const removed = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: sourceWithFavorite(false) },
        dryRun: false,
      }),
    );

    expect(removed.updated).toEqual([
      expect.objectContaining({ id: "doc_favorite_roundtrip", path }),
    ]);
    await expect(
      getDb()
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(
              schema.contentDatabaseItems.databaseId,
              provisioned.favoritesDatabaseId,
            ),
            eq(
              schema.contentDatabaseItems.documentId,
              "doc_favorite_roundtrip",
            ),
          ),
        ),
    ).resolves.toEqual([]);
  });

  it("rejects oversized document bodies before writing them", async () => {
    const path = "content/oversized-import.mdx";
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: {
          [path]: serializeContentSourceDocument({
            id: "oversized_import_document",
            parentId: null,
            title: "Oversized import",
            content: "x".repeat(512 * 1024 + 1),
            icon: null,
            position: 0,
            isFavorite: false,
            hideFromSearch: false,
            visibility: "private",
          }),
        },
        dryRun: false,
      }),
    );

    expect(result.created).toEqual([]);
    expect(result.errors).toEqual([
      {
        path,
        reason: expect.stringContaining("Document body exceeds"),
      },
    ]);
    await expect(
      getDb()
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.id, "oversized_import_document")),
    ).resolves.toEqual([]);
  });
});
