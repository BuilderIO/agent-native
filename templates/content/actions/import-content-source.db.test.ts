import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
let putPageOnLiveCopy: typeof import("../server/test-support/live-copy-page.js").putPageOnLiveCopy;
let liveCopyVersionOf: typeof import("../server/test-support/live-copy-page.js").liveCopyVersionOf;
let turnLiveCopyFlagsOff: typeof import("../server/test-support/live-copy-page.js").turnLiveCopyFlagsOff;

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
  ({ putPageOnLiveCopy, liveCopyVersionOf, turnLiveCopyFlagsOff } =
    await import("../server/test-support/live-copy-page.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
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

function liveCopySource(id: string, content: string) {
  return serializeContentSourceDocument({
    id,
    parentId: null,
    title: "Live copy import",
    content,
    icon: null,
    position: 0,
    isFavorite: false,
    hideFromSearch: false,
    visibility: "private",
  });
}

async function pageBodyState(documentId: string) {
  const [page] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  const history = await getDb()
    .select({ content: schema.documentVersions.content })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, documentId))
    .orderBy(asc(schema.documentVersions.createdAt));
  return {
    page,
    history: history.map((version: { content: string }) => version.content),
    liveCopyVersion: await liveCopyVersionOf(documentId),
  };
}

// A Content page an import file can name, not linked to any file yet.
async function insertUnlinkedPage(id: string, content: string) {
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    title: "Live copy import",
    content,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
}

const linkRefusal = (path: string) => ({
  path,
  reason: expect.stringContaining("can't be linked to a local file"),
});

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
  it("preserves each changed outgoing state across rapid repeated imports", async () => {
    const id = "doc_rapid_import_history";
    const path = `content/rapid-import-history--${id}.mdx`;
    const source = (content: string) =>
      serializeContentSourceDocument({
        id,
        parentId: null,
        title: "Rapid import history",
        content,
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        visibility: "private",
      });

    for (const content of ["state A", "state B", "state C"]) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        importContentSourceAction.run({
          files: { [path]: source(content) },
          dryRun: false,
        }),
      );
    }

    const checkpoints = await getDb()
      .select()
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id))
      .orderBy(asc(schema.documentVersions.createdAt));
    expect(checkpoints.map((checkpoint: any) => checkpoint.content)).toEqual([
      "state A",
      "state B",
    ]);
    expect(checkpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          groupKind: "operation",
          actorKind: "source",
          origin: "content-source-import",
          operation: "import-content-source",
          checkpointKind: "before",
        }),
      ]),
    );
  });

  it("atomically preserves both outgoing states from concurrent imports", async () => {
    const id = "doc_concurrent_import_history";
    const path = `content/concurrent-import-history--${id}.mdx`;
    const source = (content: string) =>
      serializeContentSourceDocument({
        id,
        parentId: null,
        title: "Concurrent import history",
        content,
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        visibility: "private",
      });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: source("state A") },
        dryRun: false,
      }),
    );
    const [initial] = await getDb()
      .select({ updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));

    const results = await Promise.all(
      ["state B", "state C"].map((content) =>
        runWithRequestContext({ userEmail: OWNER }, () =>
          importContentSourceAction.run({
            files: { [path]: source(content) },
            dryRun: false,
          }),
        ),
      ),
    );

    expect(results.map((result) => result.updated)).toEqual([
      [expect.objectContaining({ id, path })],
      [expect.objectContaining({ id, path })],
    ]);
    const [current] = await getDb()
      .select({
        content: schema.documents.content,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    const checkpoints = await getDb()
      .select({ content: schema.documentVersions.content })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, id));

    expect(
      [
        ...checkpoints.map((checkpoint: any) => checkpoint.content),
        current.content,
      ].sort(),
    ).toEqual(["state A", "state B", "state C"]);
    expect(new Date(current.updatedAt).getTime()).toBeGreaterThan(
      new Date(initial.updatedAt).getTime(),
    );
  });

  it("rolls back the history snapshot when the document replacement fails", async () => {
    const id = "doc_import_history_rollback";
    const path = `content/import-history-rollback--${id}.mdx`;
    const source = (content: string) =>
      serializeContentSourceDocument({
        id,
        parentId: null,
        title: "Import history rollback",
        content,
        icon: null,
        position: 0,
        isFavorite: false,
        hideFromSearch: false,
        visibility: "private",
      });

    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: source("stable state") },
        dryRun: false,
      }),
    );
    const triggerName = `force_import_rollback_${Date.now()}`;
    const functionName = `${triggerName}_fn`;
    await getDbExec().execute(
      `CREATE FUNCTION ${functionName}() RETURNS trigger
       LANGUAGE plpgsql AS $import$
       BEGIN
         IF NEW.id = '${id}' THEN
           RAISE EXCEPTION 'forced import rollback';
         END IF;
         RETURN NEW;
       END;
       $import$`,
    );
    await getDbExec().execute(
      `CREATE TRIGGER ${triggerName}
       BEFORE UPDATE ON documents
       FOR EACH ROW EXECUTE FUNCTION ${functionName}()`,
    );
    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          importContentSourceAction.run({
            files: { [path]: source("rejected state") },
            dryRun: false,
          }),
        ),
      ).rejects.toThrow(/forced import rollback|Failed query:/);
    } finally {
      await getDbExec().execute(
        `DROP TRIGGER IF EXISTS ${triggerName} ON documents`,
      );
      await getDbExec().execute(`DROP FUNCTION IF EXISTS ${functionName}()`);
    }

    await expect(
      getDb()
        .select({ content: schema.documents.content })
        .from(schema.documents)
        .where(eq(schema.documents.id, id)),
    ).resolves.toEqual([{ content: "stable state" }]);
    await expect(
      getDb()
        .select({ content: schema.documentVersions.content })
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.documentId, id)),
    ).resolves.toEqual([]);
  });

  it("takes an import's body change to a switched page on main's path, since the page is linked to its file", async () => {
    const id = "doc_import_live_copy";
    const path = `content/import-live-copy--${id}.mdx`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: liveCopySource(id, "state A") },
        dryRun: false,
      }),
    );
    await putPageOnLiveCopy(id);
    const before = await pageBodyState(id);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: liveCopySource(id, "state B") },
        dryRun: false,
      }),
    );

    expect(result.updated).toEqual([expect.objectContaining({ id, path })]);
    expect(await pageBodyState(id)).toEqual({
      page: expect.objectContaining({
        content: "state B",
        bodyRevision: before.page.bodyRevision + 1,
      }),
      history: [...before.history, "state A"],
      liveCopyVersion: before.liveCopyVersion,
    });
  });

  it("refuses the file that would link a page switched to its live copy, and imports the rest", async () => {
    const id = "doc_import_link_switched";
    const path = `content/import-link-switched--${id}.mdx`;
    const otherId = "doc_import_link_switched_other";
    const otherPath = `content/import-link-switched-other--${otherId}.mdx`;
    await insertUnlinkedPage(id, "state A");
    await putPageOnLiveCopy(id);
    const before = await pageBodyState(id);
    // The file holds the page's own body, so only the link would change.
    const files = {
      [path]: liveCopySource(id, "state A"),
      [otherPath]: liveCopySource(otherId, "other body"),
    };

    for (const dryRun of [true, false]) {
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        importContentSourceAction.run({ files, dryRun }),
      );

      expect(result.errors).toEqual([linkRefusal(path)]);
      expect(result.updated).toEqual([]);
      expect(result.created).toEqual([
        expect.objectContaining({ id: otherId, path: otherPath }),
      ]);
      expect(await pageBodyState(id)).toEqual(before);
    }
    expect(before.page.sourceMode).toBeNull();
    expect((await pageBodyState(otherId)).page.content).toBe("other body");
  });

  it("refuses the file when its page switches to its live copy after the import checked it", async () => {
    const id = "doc_import_link_switched_in_flight";
    const path = `content/import-link-switched-in-flight--${id}.mdx`;
    await insertUnlinkedPage(id, "state A");
    const liveBodyWriter = await import("../server/lib/live-body-writer.js");
    const linkCheck = vi
      .spyOn(liveBodyWriter, "assertLocalFileLinkable")
      // The unlocked check passes, then the page switches.
      .mockImplementationOnce(async () => {
        await putPageOnLiveCopy(id);
      });

    try {
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        importContentSourceAction.run({
          files: { [path]: liveCopySource(id, "state B") },
          dryRun: false,
        }),
      );

      expect(linkCheck).toHaveBeenCalledTimes(2);
      expect(linkCheck.mock.calls[1]?.[1]).toHaveProperty("transaction");
      expect(result.errors).toEqual([linkRefusal(path)]);
      expect(result.updated).toEqual([]);
      expect((await pageBodyState(id)).page).toMatchObject({
        content: "state A",
        sourceMode: null,
      });
    } finally {
      linkCheck.mockRestore();
    }
  });

  it("takes an import's body change to a switched page as before while the live-copy flags are off (SF-11)", async () => {
    const id = "doc_import_live_copy_flags_off";
    const path = `content/import-live-copy-flags-off--${id}.mdx`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: liveCopySource(id, "state A") },
        dryRun: false,
      }),
    );
    await putPageOnLiveCopy(id);
    await turnLiveCopyFlagsOff();
    const before = await pageBodyState(id);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      importContentSourceAction.run({
        files: { [path]: liveCopySource(id, "state B") },
        dryRun: false,
      }),
    );

    expect(result.updated).toEqual([expect.objectContaining({ id, path })]);
    expect(await pageBodyState(id)).toEqual({
      page: expect.objectContaining({
        content: "state B",
        bodyRevision: before.page.bodyRevision + 1,
      }),
      history: [...before.history, "state A"],
      liveCopyVersion: before.liveCopyVersion,
    });
  });

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
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: [ORG_ID, "Import viewer org", OWNER, Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: ["import-viewer-membership", ORG_ID, VIEWER, "member", Date.now()],
    });
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
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
