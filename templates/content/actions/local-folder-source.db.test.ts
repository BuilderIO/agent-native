import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `local-folder-source-${process.pid}-${Date.now()}.sqlite`,
);
const OWNER = "folder-owner@example.com";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let connectLocalFolder: typeof import("./connect-local-folder-source.js").default;
let syncLocalFolder: typeof import("./sync-local-folder-source.js").default;
let disconnectLocalFolder: typeof import("./disconnect-local-folder-source.js").default;
let resolveLocalFolderConflict: typeof import("./resolve-local-folder-conflict.js").default;
let syncManifestLocalFolder: typeof import("./sync-manifest-local-folder-source.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL
  )`);
  connectLocalFolder = (await import("./connect-local-folder-source.js"))
    .default;
  syncLocalFolder = (await import("./sync-local-folder-source.js")).default;
  disconnectLocalFolder = (await import("./disconnect-local-folder-source.js"))
    .default;
  resolveLocalFolderConflict = (
    await import("./resolve-local-folder-conflict.js")
  ).default;
  syncManifestLocalFolder = (
    await import("./sync-manifest-local-folder-source.js")
  ).default;
}, 60000);

afterAll(() => {
  for (const suffix of ["", "-shm", "-wal"])
    rmSync(`${TEST_DB_PATH}${suffix}`, { force: true });
});

describe("local-folder Content source", () => {
  it("previews a new connection without creating durable rows", async () => {
    const beforeSpaces = await getDb().select().from(schema.contentSpaces);
    const beforeSources = await getDb()
      .select()
      .from(schema.contentDatabaseSources);
    const preview = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-preview-only",
        label: "Preview only",
        createSourceBackedSpace: true,
        truthPolicy: "database_primary",
        dryRun: true,
      }),
    );
    expect(preview).toMatchObject({ connected: false, sourceId: null });
    await expect(
      getDb().select().from(schema.contentSpaces),
    ).resolves.toHaveLength(beforeSpaces.length);
    await expect(
      getDb().select().from(schema.contentDatabaseSources),
    ).resolves.toHaveLength(beforeSources.length);
  });

  it("creates an opaque source-backed space and materializes files in canonical Files", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-1",
        label: "Product docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    expect(connection).toMatchObject({
      sourceType: "local-folder",
      label: "Product docs",
      truthPolicy: "source_primary",
    });
    const [storedSource] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, connection.sourceId));
    expect(storedSource.sourceTable).toBe("desktop-folder-1");
    expect(storedSource.metadataJson).not.toContain("/Users/");

    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "guide.md": "# Guide\n\nFirst body." },
      }),
    );
    expect(first.created).toHaveLength(1);
    expect(first.conflicts).toHaveLength(0);
    const documentId = first.created[0]!.id;
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    expect(document).toMatchObject({
      spaceId: connection.spaceId,
      sourceMode: "local-files",
      sourcePath: "guide.md",
    });
    const memberships = await getDb()
      .select()
      .from(schema.contentDatabaseItems)
      .where(
        and(
          eq(
            schema.contentDatabaseItems.databaseId,
            connection.filesDatabaseId,
          ),
          eq(schema.contentDatabaseItems.documentId, documentId),
        ),
      );
    expect(memberships).toHaveLength(1);
    const sourceRows = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId),
      );
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.sourceValuesJson).not.toContain("First body");

    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "guide.md": "# Guide\n\nFirst body." },
      }),
    );
    expect(second.unchanged).toHaveLength(1);
    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(
              schema.contentDatabaseItems.databaseId,
              connection.filesDatabaseId,
            ),
            eq(schema.contentDatabaseItems.documentId, documentId),
          ),
        ),
    ).resolves.toHaveLength(1);
  });

  it("records concurrent source-primary changes for review without overwriting Content", async () => {
    const [source] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.sourceTable, "desktop-folder-1"));
    const [row] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
    await getDb()
      .update(schema.documents)
      .set({
        content: "Content-side edit",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.documents.id, row.documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: source.id,
        files: { "guide.md": "# Guide\n\nFolder-side edit." },
      }),
    );
    expect(result.conflicts).toHaveLength(1);
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, row.documentId));
    expect(document.content).toBe("Content-side edit");
    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.sourceId, source.id));
    expect(changeSet).toMatchObject({
      documentId: row.documentId,
      direction: "incoming",
      state: "proposed",
    });
    expect(changeSet.bodyChangeJson).not.toContain("Folder-side edit.");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      resolveLocalFolderConflict.run({
        changeSetId: changeSet.id,
        decision: "accept_source",
        sourceContent: "# Guide\n\nFolder-side edit.",
      }),
    );
    const [resolvedDocument] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, row.documentId));
    expect(resolvedDocument.content).toBe("# Guide\n\nFolder-side edit.");
    const [resolvedChangeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSet.id));
    expect(resolvedChangeSet.state).toBe("applied");
  });

  it("records concurrent metadata-only edits as a conflict", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-metadata-conflict",
        label: "Metadata conflict docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const baseline = `---\ntitle: Baseline title\ndescription: Baseline description\n---\nBody.`;
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "metadata.md": baseline },
      }),
    );
    const documentId = first.created[0]!.id;
    await getDb()
      .update(schema.documents)
      .set({
        title: "Content title",
        description: "Content description",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.documents.id, documentId));

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: {
          "metadata.md": `---\ntitle: Folder title\ndescription: Folder description\n---\nBody.`,
        },
      }),
    );

    expect(result.conflicts).toEqual([
      expect.objectContaining({ id: documentId, path: "metadata.md" }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId)),
    ).resolves.toEqual([
      expect.objectContaining({
        title: "Content title",
        description: "Content description",
        content: "Body.",
      }),
    ]);
    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(
            schema.contentDatabaseSourceChangeSets.sourceId,
            connection.sourceId,
          ),
          eq(schema.contentDatabaseSourceChangeSets.documentId, documentId),
        ),
      );
    expect(changeSet.kind).toBe("metadata_update");
    expect(JSON.parse(changeSet.fieldChangesJson)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "title",
          currentValue: "Content title",
          proposedValue: "Folder title",
        }),
        expect.objectContaining({
          field: "description",
          currentValue: "Content description",
          proposedValue: "Folder description",
        }),
      ]),
    );
  });

  it("replans inside the write transaction so a just-committed edit is not overwritten", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-transaction-race",
        label: "Transaction race docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "race.md": "Baseline body." },
      }),
    );
    const documentId = first.created[0]!.id;
    const db = getDb();
    const originalTransaction = db.transaction;
    let injectedEdit = false;
    db.transaction = async function (...args: any[]) {
      if (!injectedEdit) {
        injectedEdit = true;
        await db
          .update(schema.documents)
          .set({
            content: "Content edit committed after planning.",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.documents.id, documentId));
      }
      return originalTransaction.apply(this, args);
    };

    try {
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: connection.sourceId,
          files: { "race.md": "Incoming folder edit." },
        }),
      );
      expect(injectedEdit).toBe(true);
      expect(result.conflicts).toEqual([
        expect.objectContaining({ id: documentId, path: "race.md" }),
      ]);
      await expect(
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId)),
      ).resolves.toEqual([
        expect.objectContaining({
          content: "Content edit committed after planning.",
        }),
      ]);
    } finally {
      db.transaction = originalTransaction;
    }
  });

  it("tracks stable-id renames and reviews source deletions without deleting the global page", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-rename",
        label: "Renamed docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const source = `---\nid: stable-local-page\n---\n# Stable page\n\nBody.`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "old-name.md": source },
      }),
    );
    const renamed = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "new-name.md": source },
      }),
    );
    expect(renamed.created).toHaveLength(0);
    expect(renamed.updated).toEqual([
      expect.objectContaining({ id: "stable-local-page", path: "new-name.md" }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "stable-local-page")),
    ).resolves.toEqual([
      expect.objectContaining({ sourcePath: "new-name.md" }),
    ]);

    const deletion = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({ sourceId: connection.sourceId, files: {} }),
    );
    expect(deletion.conflicts).toEqual([
      expect.objectContaining({ id: "stable-local-page", path: "new-name.md" }),
    ]);
    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(
            schema.contentDatabaseSourceChangeSets.sourceId,
            connection.sourceId,
          ),
          eq(
            schema.contentDatabaseSourceChangeSets.documentId,
            "stable-local-page",
          ),
        ),
      );
    expect(changeSet).toMatchObject({
      kind: "metadata_update",
      direction: "incoming",
      state: "proposed",
    });
    await runWithRequestContext({ userEmail: OWNER }, () =>
      resolveLocalFolderConflict.run({
        changeSetId: changeSet.id,
        decision: "accept_source",
      }),
    );
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "stable-local-page")),
    ).resolves.toEqual([
      expect.objectContaining({ sourceMode: null, sourcePath: null }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(
          and(
            eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId),
            eq(
              schema.contentDatabaseSourceRows.documentId,
              "stable-local-page",
            ),
          ),
        ),
    ).resolves.toHaveLength(0);
  });

  it("keeps database-primary edits and stages them for export", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-database-primary",
        label: "Database-owned docs",
        createSourceBackedSpace: true,
        truthPolicy: "database_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "owned.md": "# Owned\n\nFolder revision." },
      }),
    );
    const documentId = first.created[0]!.id;
    await getDb()
      .update(schema.documents)
      .set({
        title: "Content-owned title",
        content: "# Owned\n\nContent revision.",
      })
      .where(eq(schema.documents.id, documentId));
    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "owned.md": "# Owned\n\nFolder revision." },
      }),
    );
    expect(second.conflicts).toHaveLength(0);
    expect(second.outbound).toEqual([
      expect.objectContaining({ id: documentId, path: "owned.md" }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId)),
    ).resolves.toEqual([
      expect.objectContaining({
        title: "Content-owned title",
        content: "# Owned\n\nContent revision.",
      }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseSourceChangeSets)
        .where(
          and(
            eq(
              schema.contentDatabaseSourceChangeSets.sourceId,
              connection.sourceId,
            ),
            eq(schema.contentDatabaseSourceChangeSets.documentId, documentId),
          ),
        ),
    ).resolves.toEqual([
      expect.objectContaining({ direction: "outbound", state: "proposed" }),
    ]);
  });

  it("bootstraps a manifest-declared folder without enabling local-file mode", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "content-manifest-folder-"));
    const manifestPath = join(workspace, "agent-native.json");
    mkdirSync(join(workspace, "docs"));
    writeFileSync(join(workspace, "docs", "hello.md"), "# Hello\n\nFrom disk.");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        version: 1,
        apps: {
          content: {
            roots: [
              {
                name: "CLI docs",
                path: "docs",
                extensions: [".md", ".mdx"],
                source: {
                  type: "local-folder",
                  connectionId: "local-folder:cli-test",
                  truthPolicy: "source_primary",
                },
              },
            ],
          },
        },
      }),
    );
    const previousManifest = process.env.AGENT_NATIVE_MANIFEST_PATH;
    process.env.AGENT_NATIVE_MANIFEST_PATH = manifestPath;
    try {
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        syncManifestLocalFolder.run({
          connectionId: "local-folder:cli-test",
          file: "docs/hello.md",
          dryRun: false,
        }),
      );
      expect(result.requestedDocumentId).toBe(result.created[0]!.id);
      await expect(
        getDb()
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, result.requestedDocumentId!)),
      ).resolves.toEqual([
        expect.objectContaining({
          spaceId: result.spaceId,
          content: "# Hello\n\nFrom disk.",
        }),
      ]);
    } finally {
      if (previousManifest === undefined) {
        delete process.env.AGENT_NATIVE_MANIFEST_PATH;
      } else {
        process.env.AGENT_NATIVE_MANIFEST_PATH = previousManifest;
      }
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("disconnects the adapter without deleting local files or Content pages", async () => {
    const [source] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.sourceTable, "desktop-folder-1"));
    const [row] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, source.id));
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      disconnectLocalFolder.run({ sourceId: source.id }),
    );
    expect(result).toMatchObject({
      success: true,
      disconnectedDocuments: 1,
      localFilesDeleted: 0,
    });
    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseSources)
        .where(eq(schema.contentDatabaseSources.id, source.id)),
    ).resolves.toHaveLength(0);
    const [document] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, row.documentId));
    expect(document).toMatchObject({
      id: row.documentId,
      sourceMode: "database",
      sourcePath: null,
    });
  });

  it("preserves document source metadata when another folder source remains", async () => {
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-shared-a",
        label: "Shared folder A",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-shared-b",
        label: "Shared folder B",
        spaceId: first.spaceId,
        truthPolicy: "source_primary",
      }),
    );
    const sharedDocument = `---\nid: shared-folder-page\n---\n# Shared page\n\nBody.`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: first.sourceId,
        files: { "from-a.md": sharedDocument },
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: second.sourceId,
        files: { "from-b.md": sharedDocument },
      }),
    );

    await runWithRequestContext({ userEmail: OWNER }, () =>
      disconnectLocalFolder.run({ sourceId: first.sourceId }),
    );

    await expect(
      getDb()
        .select()
        .from(schema.contentDatabaseSourceRows)
        .where(
          and(
            eq(schema.contentDatabaseSourceRows.sourceId, second.sourceId),
            eq(
              schema.contentDatabaseSourceRows.documentId,
              "shared-folder-page",
            ),
          ),
        ),
    ).resolves.toHaveLength(1);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "shared-folder-page")),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceMode: "local-files",
        sourceKind: "file",
        sourcePath: "from-b.md",
        sourceRootPath: "Shared folder B",
      }),
    ]);
  });
});
