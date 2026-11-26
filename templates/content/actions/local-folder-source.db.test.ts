import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const TEST_DB_PATH = join(
  tmpdir(),
  `local-folder-source-${process.pid}-${Date.now()}.pglite`,
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
let getContentDatabaseSource: typeof import("./get-content-database-source.js").default;
let getContentDatabase: typeof import("./get-content-database.js").default;
let provisionContentSpaces: typeof import("./_content-spaces.js").provisionContentSpaces;
let organizationContentSpaceId: typeof import("./_content-spaces.js").organizationContentSpaceId;
let shareLocalFileDocument: typeof import("./share-local-file-document.js").default;
let editDocument: typeof import("./edit-document.js").default;
let setLiveBodySwitch: typeof import("./set-live-body-switch.js").default;
let putPageOnLiveCopy: typeof import("../server/test-support/live-copy-page.js").putPageOnLiveCopy;
let liveCopyVersionOf: typeof import("../server/test-support/live-copy-page.js").liveCopyVersionOf;
let turnLiveCopyFlagsOff: typeof import("../server/test-support/live-copy-page.js").turnLiveCopyFlagsOff;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL,
    federation_removal_pending_at INTEGER
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
  getContentDatabaseSource = (await import("./get-content-database-source.js"))
    .default;
  getContentDatabase = (await import("./get-content-database.js")).default;
  ({ provisionContentSpaces, organizationContentSpaceId } =
    await import("./_content-spaces.js"));
  shareLocalFileDocument = (await import("./share-local-file-document.js"))
    .default;
  editDocument = (await import("./edit-document.js")).default;
  setLiveBodySwitch = (await import("./set-live-body-switch.js")).default;
  ({ putPageOnLiveCopy, liveCopyVersionOf, turnLiveCopyFlagsOff } =
    await import("../server/test-support/live-copy-page.js"));
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

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

async function folderSourceState(connection: {
  sourceId: string;
  spaceId: string;
}) {
  const db = getDb();
  return {
    source: await db
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, connection.sourceId)),
    rows: await db
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId))
      .orderBy(asc(schema.contentDatabaseSourceRows.id)),
    changeSets: await db
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(
          schema.contentDatabaseSourceChangeSets.sourceId,
          connection.sourceId,
        ),
      )
      .orderBy(asc(schema.contentDatabaseSourceChangeSets.id)),
    pageIds: (
      await db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(eq(schema.documents.spaceId, connection.spaceId))
        .orderBy(asc(schema.documents.id))
    ).map((page: { id: string }) => page.id),
  };
}

describe("local-folder Content source", () => {
  it("creates a shareable copy of a synced local-folder file for its owner", async () => {
    const id = "content_local_file_share_qa";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id,
      ownerEmail: OWNER,
      title: "Synced note",
      content: "Original body",
      sourceMode: "local-files",
      sourceKind: "file",
      sourcePath: "notes/synced.md",
      sourceRootPath: "qa-folder-source",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      runWithRequestContext({ userEmail: "another-user@example.com" }, () =>
        shareLocalFileDocument.run({ id }),
      ),
    ).rejects.toThrow("Only local file documents");

    const copy = await runWithRequestContext({ userEmail: OWNER }, () =>
      shareLocalFileDocument.run({ id }),
    );
    expect(copy).toMatchObject({
      title: "Synced note",
      content: "Original body",
      visibility: "private",
      source: {
        mode: "database",
        kind: "local-file-copy",
        path: "notes/synced.md",
        rootPath: "qa-folder-source",
      },
    });
    expect(copy.id).not.toBe(id);

    await getDb()
      .update(schema.documents)
      .set({ content: "Updated body" })
      .where(eq(schema.documents.id, id));
    const refreshed = await runWithRequestContext({ userEmail: OWNER }, () =>
      shareLocalFileDocument.run({ id }),
    );
    expect(refreshed.id).toBe(copy.id);
    expect(refreshed.content).toBe("Updated body");
  });

  it("does not copy a same-owner source from another organization", async () => {
    const sourceOrgId = "share-source-org-a";
    const activeOrgId = "share-source-org-b";
    const sourceId = "content_local_file_cross_org_share_qa";
    const joinedAt = Math.floor(Date.now() / 1000);
    for (const orgId of [sourceOrgId, activeOrgId]) {
      await getDbExec().execute({
        sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
        args: [orgId, orgId, OWNER, joinedAt],
      });
      await getDbExec().execute({
        sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
        args: [`${orgId}-owner`, orgId, OWNER, "owner", joinedAt],
      });
    }
    await runWithRequestContext({ userEmail: OWNER, orgId: sourceOrgId }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.documents)
      .values({
        id: sourceId,
        ownerEmail: OWNER,
        orgId: sourceOrgId,
        spaceId: organizationContentSpaceId(sourceOrgId),
        title: "Source org note",
        content: "Only source org can copy this",
        sourceMode: "local-files",
        sourceKind: "file",
        sourcePath: "notes/cross-org.md",
        sourceRootPath: "qa-cross-org-folder",
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      runWithRequestContext({ userEmail: OWNER, orgId: activeOrgId }, () =>
        shareLocalFileDocument.run({ id: sourceId }),
      ),
    ).rejects.toThrow("Only local file documents");
    const copy = await runWithRequestContext(
      { userEmail: OWNER, orgId: sourceOrgId },
      () => shareLocalFileDocument.run({ id: sourceId }),
    );
    const [storedCopy] = await getDb()
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, copy.id));
    expect(storedCopy).toMatchObject({
      orgId: sourceOrgId,
      spaceId: organizationContentSpaceId(sourceOrgId),
      content: "Only source org can copy this",
    });
  });

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
    const provisioned = await runWithRequestContext({ userEmail: OWNER }, () =>
      provisionContentSpaces(getDb(), OWNER),
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: "source-workspace-focus-property",
      ownerEmail: OWNER,
      orgId: null,
      databaseId: provisioned.catalogDatabaseId,
      name: "Focus",
      type: "text",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-1",
        label: "Product docs",
        connectionMetadata: {
          repository: {
            localId: "repository-teenylilthoughts",
            providerBinding: {
              provider: "github",
              repositoryId: "github-repository-123",
            },
          },
          workingCopy: {
            id: "working-copy-main",
            repositoryId: "repository-teenylilthoughts",
            kind: "persistent",
            name: "Product docs",
            branch: "main",
            commit: "abc123",
            deviceId: "desktop-alice",
          },
          liveBridgeEnabled: true,
        },
        createSourceBackedSpace: true,
        propertyValues: {
          "source-workspace-focus-property": "Imported",
        },
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
    expect(storedSource.metadataJson).not.toContain("working-copy-main/");
    expect(JSON.parse(storedSource.capabilitiesJson)).toMatchObject({
      liveWritesEnabled: true,
    });
    expect(JSON.parse(storedSource.metadataJson)).toMatchObject({
      syncPolicy: "keep_in_sync",
      localIdentity: {
        repository: { localId: "repository-teenylilthoughts" },
        workingCopy: {
          id: "working-copy-main",
          kind: "persistent",
          localOnly: false,
          shareable: true,
        },
      },
    });
    const sourceStatus = await runWithRequestContext({ userEmail: OWNER }, () =>
      getContentDatabaseSource.run({ databaseId: connection.filesDatabaseId }),
    );
    expect(sourceStatus.source).toMatchObject({
      capabilities: { liveWritesEnabled: true },
      metadata: {
        writeMode: "stage_only",
        syncPolicy: "keep_in_sync",
        liveBridgeEnabled: true,
        localIdentity: {
          workingCopy: {
            id: "working-copy-main",
            localOnly: false,
            shareable: true,
          },
        },
      },
    });
    const [catalogMapping] = await getDb()
      .select({ documentId: schema.contentSpaceCatalogItems.documentId })
      .from(schema.contentSpaceCatalogItems)
      .where(eq(schema.contentSpaceCatalogItems.spaceId, connection.spaceId));
    const [workspacePropertyValue] = await getDb()
      .select()
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(
            schema.documentPropertyValues.documentId,
            catalogMapping.documentId,
          ),
          eq(
            schema.documentPropertyValues.propertyId,
            "source-workspace-focus-property",
          ),
        ),
      );
    expect(JSON.parse(workspacePropertyValue.valueJson)).toBe("Imported");

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
    const filesDatabase = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        getContentDatabase.run({
          databaseId: connection.filesDatabaseId,
        }),
    );
    expect(filesDatabase.items).toHaveLength(1);
    expect(filesDatabase.items[0]!.document.source).toMatchObject({
      mode: "local-files",
      kind: "file",
      path: "guide.md",
      rootPath: "desktop-folder-1",
    });
    const sourceRows = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId),
      );
    expect(sourceRows).toHaveLength(1);
    expect(sourceRows[0]!.sourceValuesJson).not.toContain("First body");
    const firstSourceValues = JSON.parse(sourceRows[0]!.sourceValuesJson);
    expect(firstSourceValues).toMatchObject({
      observedRevision: expect.stringMatching(/^sha256:/),
      sourceFileIdentity: {
        workingCopyId: "working-copy-main",
        relativePath: "guide.md",
      },
    });

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
    const [secondSourceRow] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceRows)
      .where(
        eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId),
      );
    expect(JSON.parse(secondSourceRow.sourceValuesJson)).toMatchObject({
      observedRevision: firstSourceValues.observedRevision,
      sourceFileIdentity: firstSourceValues.sourceFileIdentity,
    });
  });

  it("rejects raw paths and marks temporary working copies local-only", async () => {
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        connectLocalFolder.run({
          connectionId: "desktop-folder-invalid-path",
          label: "Unsafe folder",
          connectionMetadata: {
            workingCopy: {
              id: "/Users/alice/worktree",
              kind: "temporary",
              name: "Fix local sync",
              deviceId: "desktop-alice",
            },
          },
          truthPolicy: "source_primary",
        }),
      ),
    ).rejects.toThrow("opaque IDs, not paths");

    const temporary = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-temporary",
        label: "Fix local sync",
        connectionMetadata: {
          workingCopy: {
            id: "working-copy-fix-local-sync",
            kind: "temporary",
            name: "Fix local sync",
            deviceId: "desktop-alice",
          },
        },
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const [source] = await getDb()
      .select()
      .from(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, temporary.sourceId));
    expect(JSON.parse(source.metadataJson)).toMatchObject({
      syncPolicy: "manual",
      localIdentity: {
        workingCopy: {
          kind: "temporary",
          localOnly: true,
          shareable: false,
        },
      },
    });
    expect(JSON.parse(source.capabilitiesJson)).toMatchObject({
      liveWritesEnabled: false,
    });
    const temporaryStatus = await runWithRequestContext(
      { userEmail: OWNER },
      () =>
        getContentDatabaseSource.run({
          databaseId: temporary.filesDatabaseId,
        }),
    );
    expect(temporaryStatus.source).toMatchObject({
      capabilities: { liveWritesEnabled: false },
      metadata: {
        writeMode: "stage_only",
        syncPolicy: "manual",
        liveBridgeEnabled: false,
        localIdentity: {
          workingCopy: { localOnly: true, shareable: false },
        },
      },
    });
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

  it("keeps a page and its file in step when they spell the same text differently", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-file-spelling",
        label: "File spelling",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const sync = (text: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: connection.sourceId,
          files: { "notes.md": text },
        }),
      );
    const file = "# Field notes\n\n* one\n* two\n\nClosing.\n";
    const page = "# Field notes\n- one\n- two\nClosing.";
    const first = await sync(file);
    const documentId = first.created.map(({ id }) => id).join();
    const stored = async () => {
      const [document] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId));
      return document;
    };
    const save = (content: string) =>
      getDb()
        .update(schema.documents)
        .set({ content, updatedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, documentId));
    expect((await stored()).content).toBe(file);

    const editedPage = page.replace("Closing.", "Closing words.");
    const editedFile = file.replace("Closing.", "Closing words.");
    await save(editedPage);
    const before = await stored();
    const afterSave = await sync(editedFile);
    expect(afterSave.conflicts).toHaveLength(0);
    expect(await stored()).toMatchObject({
      content: editedPage,
      bodyRevision: before.bodyRevision,
    });

    const outsideFile = editedFile.replace("* two", "* two outside");
    const outsidePage = editedPage.replace("- two", "- two outside");
    const afterOutsideEdit = await sync(outsideFile);
    expect(afterOutsideEdit.conflicts).toHaveLength(0);
    expect((await stored()).content).toBe(outsideFile);

    const respelled = outsideFile.replace("* one", "- one");
    const afterRespelling = await sync(respelled);
    expect(afterRespelling.conflicts).toHaveLength(0);
    expect((await stored()).content).toBe(outsideFile);

    const contentPage = outsidePage.replace(
      "Closing words.",
      "Closing in Content.",
    );
    await save(contentPage);
    const overlappingFile = respelled.replace(
      "Closing words.",
      "Closing outside.",
    );
    const overlapping = await sync(overlappingFile);
    expect(overlapping.conflicts).toEqual([
      expect.objectContaining({ id: documentId, path: "notes.md" }),
    ]);
    expect((await stored()).content).toBe(contentPage);

    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(
            schema.contentDatabaseSourceChangeSets.sourceId,
            connection.sourceId,
          ),
          eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
        ),
      );
    expect(changeSet.kind).toBe("body_update");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      resolveLocalFolderConflict.run({
        changeSetId: changeSet.id,
        decision: "accept_source",
        sourceContent: overlappingFile,
      }),
    );
    const laterFile = overlappingFile.replace(
      "Closing outside.",
      "Closing again.",
    );
    const afterResolution = await sync(laterFile);
    expect(afterResolution.conflicts).toHaveLength(0);
    expect((await stored()).content).toBe(laterFile);
  });

  it("reviews a metadata conflict on a page that spells its file differently", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-spelled-metadata",
        label: "Spelled metadata",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const body = "* one\n* two\n";
    const sync = (title: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: connection.sourceId,
          files: {
            "notes.md": ["---", "title: " + title, "---", "", body].join("\n"),
          },
        }),
      );
    const first = await sync("Baseline");
    const documentId = first.created.map(({ id }) => id).join();
    await getDb()
      .update(schema.documents)
      .set({
        title: "Content title",
        content: "- one\n- two",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.documents.id, documentId));
    expect((await sync("Folder title")).conflicts).toHaveLength(1);
    const [changeSet] = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        eq(
          schema.contentDatabaseSourceChangeSets.sourceId,
          connection.sourceId,
        ),
      );
    expect(changeSet.kind).toBe("metadata_update");
    await runWithRequestContext({ userEmail: OWNER }, () =>
      resolveLocalFolderConflict.run({
        changeSetId: changeSet.id,
        decision: "accept_source",
        sourceContent: body,
      }),
    );
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId)),
    ).resolves.toEqual([expect.objectContaining({ title: "Folder title" })]);
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

    const nextResult = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: {
          "metadata.md": `---\ntitle: Newer folder title\ndescription: Newer folder description\n---\nBody.`,
        },
      }),
    );
    expect(nextResult.conflicts).toHaveLength(1);
    const proposals = await getDb()
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
    expect(proposals).toHaveLength(2);
    expect(new Set(proposals.map((proposal) => proposal.id)).size).toBe(2);
    expect(
      proposals.map((proposal) => JSON.parse(proposal.fieldChangesJson)),
    ).toEqual(
      expect.arrayContaining([
        expect.arrayContaining([
          expect.objectContaining({ proposedValue: "Folder title" }),
        ]),
        expect.arrayContaining([
          expect.objectContaining({ proposedValue: "Newer folder title" }),
        ]),
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

  it("rechecks explicit ids inside the transaction before updating a document", async () => {
    const target = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-explicit-id-race-target",
        label: "Explicit ID race target",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const other = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-explicit-id-race-other",
        label: "Explicit ID race other",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const documentId = "explicit-id-created-after-planning";
    const db = getDb();
    const originalTransaction = db.transaction;
    let injectedDocument = false;
    db.transaction = async function (...args: any[]) {
      if (!injectedDocument) {
        injectedDocument = true;
        const now = new Date().toISOString();
        await db.insert(schema.documents).values({
          id: documentId,
          spaceId: other.spaceId,
          ownerEmail: OWNER,
          orgId: null,
          visibility: "private",
          title: "Other workspace document",
          content: "Must remain untouched.",
          createdAt: now,
          updatedAt: now,
        });
      }
      return originalTransaction.apply(this, args);
    };

    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          syncLocalFolder.run({
            sourceId: target.sourceId,
            files: {
              "race.md": `---\nid: ${documentId}\n---\nIncoming body.`,
            },
          }),
        ),
      ).rejects.toThrow("belongs to another Content space");
      expect(injectedDocument).toBe(true);
      await expect(
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId)),
      ).resolves.toEqual([
        expect.objectContaining({
          spaceId: other.spaceId,
          content: "Must remain untouched.",
        }),
      ]);
      await expect(
        db
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(
            and(
              eq(schema.contentDatabaseSourceRows.sourceId, target.sourceId),
              eq(schema.contentDatabaseSourceRows.documentId, documentId),
            ),
          ),
      ).resolves.toHaveLength(0);
    } finally {
      db.transaction = originalTransaction;
    }
  });

  it("rejects a malformed linked row that points into another Content space", async () => {
    const target = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-linked-cross-space-target",
        label: "Linked cross-space target",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const other = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-linked-cross-space-other",
        label: "Linked cross-space other",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "malformed-linked-other-space-page",
      spaceId: other.spaceId,
      ownerEmail: OWNER,
      orgId: null,
      visibility: "private",
      title: "Other space page",
      content: "Must remain untouched.",
      createdAt: now,
      updatedAt: now,
    });
    await getDb()
      .insert(schema.contentDatabaseSourceRows)
      .values({
        id: "malformed-linked-cross-space-row",
        ownerEmail: OWNER,
        sourceId: target.sourceId,
        databaseItemId: "malformed-linked-cross-space-item",
        documentId: "malformed-linked-other-space-page",
        sourceRowId: "linked.md",
        sourceQualifiedId: "local-folder://example/linked.md",
        sourceDisplayKey: "linked.md",
        sourceValuesJson: JSON.stringify({ relativePath: "linked.md" }),
        provenance: "test corruption",
        syncState: "linked",
        freshness: "fresh",
        createdAt: now,
        updatedAt: now,
      });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: target.sourceId,
          files: { "linked.md": "Incoming body." },
        }),
      ),
    ).rejects.toThrow("belongs to another Content space");
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "malformed-linked-other-space-page")),
    ).resolves.toEqual([
      expect.objectContaining({
        spaceId: other.spaceId,
        content: "Must remain untouched.",
      }),
    ]);
  });

  it("aborts sync if the source is disconnected after planning", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-sync-disconnect-race",
        label: "Sync disconnect race",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const db = getDb();
    const originalTransaction = db.transaction;
    let disconnected = false;
    db.transaction = async function (...args: any[]) {
      if (!disconnected) {
        disconnected = true;
        await db
          .delete(schema.contentDatabaseSources)
          .where(eq(schema.contentDatabaseSources.id, connection.sourceId));
      }
      return originalTransaction.apply(this, args);
    };

    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          syncLocalFolder.run({
            sourceId: connection.sourceId,
            files: {
              "race.md": "---\nid: sync-after-disconnect-page\n---\nBody.",
            },
          }),
        ),
      ).rejects.toThrow("was disconnected before sync");
      expect(disconnected).toBe(true);
      await expect(
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, "sync-after-disconnect-page")),
      ).resolves.toHaveLength(0);
      await expect(
        db
          .select()
          .from(schema.contentDatabaseSourceRows)
          .where(
            eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId),
          ),
      ).resolves.toHaveLength(0);
    } finally {
      db.transaction = originalTransaction;
    }
  });

  it("refuses to accept a staged folder revision after Content changes again", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-resolution-race",
        label: "Resolution race docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve-race.md": "Baseline body." },
      }),
    );
    const documentId = first.created[0]!.id;
    await getDb()
      .update(schema.documents)
      .set({
        title: "Content title at review",
        content: "Content body at review.",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.documents.id, documentId));
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve-race.md": "Folder body under review." },
      }),
    );
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

    const db = getDb();
    const originalTransaction = db.transaction;
    let injectedEdit = false;
    db.transaction = async function (...args: any[]) {
      if (!injectedEdit) {
        injectedEdit = true;
        await db
          .update(schema.documents)
          .set({
            title: "Content title after review",
            content: "Content body committed after review.",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.documents.id, documentId));
      }
      return originalTransaction.apply(this, args);
    };

    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          resolveLocalFolderConflict.run({
            changeSetId: changeSet.id,
            decision: "accept_source",
            sourceContent: "Folder body under review.",
          }),
        ),
      ).rejects.toThrow("Content changed after this conflict was reviewed");
      expect(injectedEdit).toBe(true);
      await expect(
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId)),
      ).resolves.toEqual([
        expect.objectContaining({
          title: "Content title after review",
          content: "Content body committed after review.",
        }),
      ]);
      await expect(
        db
          .select()
          .from(schema.contentDatabaseSourceChangeSets)
          .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSet.id)),
      ).resolves.toEqual([expect.objectContaining({ state: "proposed" })]);
    } finally {
      db.transaction = originalTransaction;
    }

    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve-race.md": "Folder body under review." },
      }),
    );
    const proposed = await getDb()
      .select()
      .from(schema.contentDatabaseSourceChangeSets)
      .where(
        and(
          eq(
            schema.contentDatabaseSourceChangeSets.sourceId,
            connection.sourceId,
          ),
          eq(schema.contentDatabaseSourceChangeSets.documentId, documentId),
          eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
        ),
      );
    expect(proposed).toHaveLength(2);
    const refreshed = proposed.find(
      (candidate) => candidate.id !== changeSet.id,
    );
    expect(refreshed).toBeDefined();
    await runWithRequestContext({ userEmail: OWNER }, () =>
      resolveLocalFolderConflict.run({
        changeSetId: refreshed!.id,
        decision: "accept_source",
        sourceContent: "Folder body under review.",
      }),
    );
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId)),
    ).resolves.toEqual([
      expect.objectContaining({ content: "Folder body under review." }),
    ]);
  });

  it("aborts resolution if the source is disconnected after review", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-resolve-disconnect-race",
        label: "Resolve disconnect race",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve.md": "Baseline." },
      }),
    );
    const documentId = first.created[0]!.id;
    await getDb()
      .update(schema.documents)
      .set({ content: "Content edit.", updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, documentId));
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve.md": "Folder edit." },
      }),
    );
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
    const db = getDb();
    const originalTransaction = db.transaction;
    let disconnected = false;
    db.transaction = async function (...args: any[]) {
      if (!disconnected) {
        disconnected = true;
        await db
          .delete(schema.contentDatabaseSources)
          .where(eq(schema.contentDatabaseSources.id, connection.sourceId));
      }
      return originalTransaction.apply(this, args);
    };

    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          resolveLocalFolderConflict.run({
            changeSetId: changeSet.id,
            decision: "accept_source",
            sourceContent: "Folder edit.",
          }),
        ),
      ).rejects.toThrow("was disconnected before resolution");
      expect(disconnected).toBe(true);
      await expect(
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId)),
      ).resolves.toEqual([
        expect.objectContaining({ content: "Content edit." }),
      ]);
    } finally {
      db.transaction = originalTransaction;
    }
  });

  it("allows only one decision to claim an open folder conflict", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-resolve-decision-race",
        label: "Resolve decision race",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve.md": "Baseline." },
      }),
    );
    const documentId = first.created[0]!.id;
    await getDb()
      .update(schema.documents)
      .set({ content: "Content edit.", updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, documentId));
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve.md": "Folder edit." },
      }),
    );
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
    const db = getDb();
    const originalTransaction = db.transaction;
    let decided = false;
    db.transaction = async function (...args: any[]) {
      if (!decided) {
        decided = true;
        await db
          .update(schema.contentDatabaseSourceChangeSets)
          .set({ state: "rejected", updatedAt: new Date().toISOString() })
          .where(eq(schema.contentDatabaseSourceChangeSets.id, changeSet.id));
      }
      return originalTransaction.apply(this, args);
    };

    try {
      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          resolveLocalFolderConflict.run({
            changeSetId: changeSet.id,
            decision: "accept_source",
            sourceContent: "Folder edit.",
          }),
        ),
      ).rejects.toThrow("changed before resolution");
      expect(decided).toBe(true);
      await expect(
        db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId)),
      ).resolves.toEqual([
        expect.objectContaining({ content: "Content edit." }),
      ]);
    } finally {
      db.transaction = originalTransaction;
    }
  });

  it("retires a file deletion once the folder has the file again, so accepting it can't unlink the page", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-deletion-superseded",
        label: "Deletion superseded",
        createSourceBackedSpace: true,
        truthPolicy: "database_primary",
      }),
    );
    const sync = (files: Record<string, string>) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({ sourceId: connection.sourceId, files }),
      );
    const first = await sync({ "back.md": "Body." });
    const documentId = first.created[0]!.id;
    const openDeletions = () =>
      getDb()
        .select({ id: schema.contentDatabaseSourceChangeSets.id })
        .from(schema.contentDatabaseSourceChangeSets)
        .where(
          and(
            eq(
              schema.contentDatabaseSourceChangeSets.sourceId,
              connection.sourceId,
            ),
            eq(schema.contentDatabaseSourceChangeSets.documentId, documentId),
            eq(schema.contentDatabaseSourceChangeSets.state, "proposed"),
          ),
        );
    await sync({});
    const [deletion] = await openDeletions();
    expect(deletion).toBeDefined();

    await sync({ "back.md": "Body." });
    await expect(openDeletions()).resolves.toEqual([]);
    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        resolveLocalFolderConflict.run({
          changeSetId: deletion!.id,
          decision: "accept_source",
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "LOCAL_FOLDER_CONFLICT_NOT_FOUND" });
    await expect(
      getDb()
        .select({ id: schema.contentDatabaseSourceRows.id })
        .from(schema.contentDatabaseSourceRows)
        .where(
          eq(schema.contentDatabaseSourceRows.sourceId, connection.sourceId),
        ),
    ).resolves.toHaveLength(1);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId)),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceMode: "local-files",
        sourcePath: "back.md",
      }),
    ]);

    // The same file gone again is proposed again.
    await sync({});
    await expect(openDeletions()).resolves.toEqual([{ id: deletion!.id }]);
  });

  it("tracks stable-id renames and removes source-primary deletions from Files without deleting the cached page", async () => {
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
    expect(renamed.removed).toEqual([]);
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
    expect(deletion.conflicts).toHaveLength(0);
    expect(deletion.removed).toEqual([
      { id: "stable-local-page", path: "new-name.md" },
    ]);
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
        .from(schema.contentDatabaseItems)
        .where(eq(schema.contentDatabaseItems.documentId, "stable-local-page")),
    ).resolves.toHaveLength(0);
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

  it("recognizes an unchanged path-only file move without creating a deletion conflict", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-path-move",
        label: "Moved docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const source = "# Moved page\n\nUnchanged body.";
    const initial = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "temporary/only/new.md": source },
      }),
    );
    const documentId = initial.created[0]?.id;

    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "temporary/only/new.md": source },
        fileIdentities: { "temporary/only/new.md": "bridge-file-one" },
      }),
    );

    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "temporary/only/new.md": source },
      }),
    );

    const moved = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "notes/new.md": source },
        fileIdentities: { "notes/new.md": "bridge-file-one" },
      }),
    );

    expect(moved.created).toHaveLength(0);
    expect(moved.conflicts).toHaveLength(0);
    expect(moved.updated).toEqual([
      expect.objectContaining({ id: documentId, path: "notes/new.md" }),
    ]);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId!)),
    ).resolves.toEqual([
      expect.objectContaining({ sourcePath: "notes/new.md" }),
    ]);
  });

  it("does not infer a rename from byte-identical files with different bridge identities", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-identical-files",
        label: "Identical docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const source = "# Same bytes";
    const initial = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "old.md": source },
        fileIdentities: { "old.md": "bridge-old" },
      }),
    );

    const replaced = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "new.md": source },
        fileIdentities: { "new.md": "bridge-new" },
      }),
    );

    expect(replaced.created).toHaveLength(1);
    expect(replaced.created[0]?.id).not.toBe(initial.created[0]?.id);
    expect(replaced.conflicts).toHaveLength(0);
  });

  it("follows a file that is renamed before the folder syncs a save", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-save-then-rename",
        label: "Saved docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const sync = (files: Record<string, { text: string; identity: string }>) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: connection.sourceId,
          files: Object.fromEntries(
            Object.entries(files).map(([path, { text }]) => [path, text]),
          ),
          fileIdentities: Object.fromEntries(
            Object.entries(files).map(([path, { identity }]) => [
              path,
              identity,
            ]),
          ),
        }),
      );
    const before = "# Trip\n\n* pack\n* leave\n";
    const initial = await sync({
      "trip.md": { text: before, identity: "trip-one" },
      "other.md": { text: "Other", identity: "other-one" },
    });
    const documentId = initial.created.find(
      ({ path }) => path === "trip.md",
    )?.id;
    if (!documentId) throw new Error("The folder's page was not created.");
    await getDb()
      .update(schema.documents)
      .set({
        content: "# Trip\n- pack\n- leave early",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.documents.id, documentId));

    const moved = await sync({
      "notes/travel.md": {
        text: "# Trip\n\n* pack\n* leave early\n",
        identity: "trip-two",
      },
      "other.md": { text: "Other", identity: "other-one" },
    });
    expect(moved.created).toEqual([]);
    expect(moved.conflicts).toEqual([]);
    expect(moved.updated).toEqual([
      expect.objectContaining({ id: documentId, path: "notes/travel.md" }),
    ]);
  });

  it("follows a renamed file that has no identity only when its page was saved since the last sync and one file reads the same", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "browser-folder-rename",
        label: "Browser docs",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const sync = (files: Record<string, string>) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({ sourceId: connection.sourceId, files }),
      );
    const initial = await sync({
      "saved.md": "* one",
      "unsaved.md": "Unsaved",
      "copied.md": "Copied",
      "marked.md": "---\nid: rename-marked-page\n---\nMarked",
    });
    const save = async (path: string, content: string) => {
      const id = initial.created.find((page) => page.path === path)?.id;
      if (!id) throw new Error(`${path} has no page.`);
      await getDb()
        .update(schema.documents)
        .set({ content, updatedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, id));
      return id;
    };
    const savedId = await save("saved.md", "- one more");
    await save("copied.md", "Copied more");
    await save("marked.md", "Marked more");

    const moved = await sync({
      "saved-moved.md": "* one more",
      "unsaved-moved.md": "Unsaved",
      "copied-a.md": "Copied more",
      "copied-b.md": "Copied more",
      "marked-moved.md": "Marked more",
    });
    expect(moved.updated).toEqual([
      expect.objectContaining({ id: savedId, path: "saved-moved.md" }),
    ]);
    expect(moved.created.map(({ path }) => path).sort()).toEqual([
      "copied-a.md",
      "copied-b.md",
      "marked-moved.md",
      "unsaved-moved.md",
    ]);
    const initialIds = initial.created.map(({ id }) => id);
    for (const { id } of moved.created) expect(initialIds).not.toContain(id);
  });

  it("keeps a remaining folder link when another source deletes the same page", async () => {
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-delete-shared-a",
        label: "Delete shared A",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-delete-shared-b",
        label: "Delete shared B",
        spaceId: first.spaceId,
        truthPolicy: "source_primary",
      }),
    );
    const source = `---\nid: shared-delete-page\n---\nBody.`;
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: first.sourceId,
        files: { "from-a.md": source },
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: second.sourceId,
        files: { "from-b.md": source },
      }),
    );
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({ sourceId: first.sourceId, files: {} }),
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
              "shared-delete-page",
            ),
          ),
        ),
    ).resolves.toHaveLength(1);
    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "shared-delete-page")),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceMode: "local-files",
        sourceKind: "file",
        sourcePath: "from-b.md",
        sourceRootPath: "desktop-folder-delete-shared-b",
      }),
    ]);
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

  // oracle-change(templates/content/actions/split-mode-retirement.test.ts): its checks that canonical document actions and the local-file cache never name the process mode were source-text absence greps; this test runs those actions with the process in local-file mode and sees them read and write SQL, not the folder. Whether the explicit local-file cache serves reads is decided by core (it lists nothing in database mode today), so the cache file not naming the mode guarded nothing observable
  it("keeps document actions on SQL while the process asks for local-file mode", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "content-local-mode-"));
    const manifestPath = join(workspace, "agent-native.json");
    mkdirSync(join(workspace, "docs"));
    writeFileSync(
      join(workspace, "docs", "on-disk.md"),
      "# On disk\n\nFrom disk.",
    );
    const manifest = JSON.stringify({
      version: 1,
      mode: "local-files",
      apps: {
        content: {
          mode: "local-files",
          roots: [{ name: "Docs", path: "docs", extensions: [".md", ".mdx"] }],
        },
      },
    });
    writeFileSync(manifestPath, manifest);
    const modeEnv = [
      "AGENT_NATIVE_MANIFEST_PATH",
      "AGENT_NATIVE_MODE",
      "AGENT_NATIVE_DATA_MODE",
    ] as const;
    const previousEnv = modeEnv.map((key) => process.env[key]);
    process.env.AGENT_NATIVE_MANIFEST_PATH = manifestPath;
    process.env.AGENT_NATIVE_MODE = "local-files";
    process.env.AGENT_NATIVE_DATA_MODE = "local-files";
    const asOwner = <T>(run: () => Promise<T>) =>
      runWithRequestContext({ userEmail: OWNER }, run);
    const pageRow = async (id: string) => {
      const [page] = await getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, id));
      return page;
    };
    try {
      const localFiles = await import("./_local-file-documents.js");
      const createDocument = (await import("./create-document.js")).default;
      const updateDocument = (await import("./update-document.js")).default;
      const getDocument = (await import("./get-document.js")).default;
      const listDocuments = (await import("./list-documents.js")).default;
      const searchDocuments = (await import("./search-documents.js")).default;
      const pullDocument = (await import("./pull-document.js")).default;
      const moveDocument = (await import("./move-document.js")).default;
      const deleteDocument = (await import("./delete-document.js")).default;
      const viewScreen = (await import("./view-screen.js")).default;
      const revealLocalSourceFile = (
        await import("./reveal-local-source-file.js")
      ).default;
      const removeLocalFileSource = (
        await import("./remove-local-file-source.js")
      ).default;

      localFiles.invalidateLocalFileDocumentsCache();
      const diskDocuments = await localFiles.listLocalFileDocuments();
      expect(JSON.stringify(diskDocuments)).toContain("on-disk.md");
      const diskIds = diskDocuments
        .map((document) => document.id)
        .filter((documentId) => localFiles.isLocalFileDocumentId(documentId));
      expect(diskIds).toHaveLength(1);

      const { id } = (await asOwner(() =>
        createDocument.run({ title: "Mode probe", content: "SQL body." }),
      )) as { id: string };
      const { id: homeId } = (await asOwner(() =>
        createDocument.run({ title: "Mode probe home", content: "Home." }),
      )) as { id: string };
      await asOwner(() =>
        updateDocument.run({ id, title: "Mode probe renamed" }),
      );

      expect(await pageRow(id)).toEqual(
        expect.objectContaining({
          title: "Mode probe renamed",
          content: "SQL body.",
        }),
      );
      await expect(asOwner(() => getDocument.run({ id }))).resolves.toEqual(
        expect.objectContaining({ id, title: "Mode probe renamed" }),
      );
      const listed = (await asOwner(() =>
        listDocuments.run({ exactTitle: "Mode probe renamed" }),
      )) as { documents: Array<{ id: string }> };
      expect(listed.documents.map((document) => document.id)).toEqual([id]);
      const searched = (await asOwner(() =>
        searchDocuments.run({ query: "Mode probe", mode: "words" }),
      )) as { documents: Array<{ id: string }> };
      expect(searched.documents.map((document) => document.id).sort()).toEqual(
        [id, homeId].sort(),
      );

      await asOwner(() =>
        editDocument.run(
          {
            id,
            find: "SQL body.",
            replace: "SQL body, edited.",
            reuseLabels: [],
          },
          { caller: "frontend", userEmail: OWNER },
        ),
      );
      expect((await pageRow(id)).content).toBe("SQL body, edited.");
      await expect(asOwner(() => pullDocument.run({ id }))).resolves.toEqual(
        expect.objectContaining({ content: "SQL body, edited." }),
      );
      for (const diskId of diskIds) {
        await expect(
          asOwner(() => getDocument.run({ id: diskId })),
        ).rejects.toThrow(`Document "${diskId}" not found`);
        await expect(
          asOwner(() => pullDocument.run({ id: diskId })),
        ).rejects.toThrow(`Document "${diskId}" not found`);
      }

      await asOwner(() => moveDocument.run({ id, parentId: homeId }));
      expect((await pageRow(id)).parentId).toBe(homeId);

      const screen = await asOwner(() => viewScreen.run({}));
      expect(JSON.stringify(screen)).not.toContain("on-disk");
      await expect(
        asOwner(() => revealLocalSourceFile.run({ id })),
      ).rejects.toThrow("does not expose an absolute path");
      await expect(
        asOwner(() => removeLocalFileSource.run({ sourceRootPath: "docs" })),
      ).rejects.toThrow("No matching local file source was found.");

      await asOwner(() => deleteDocument.run({ id }));
      expect((await pageRow(id)).trashedAt).toEqual(expect.any(String));

      expect(readdirSync(join(workspace, "docs"))).toEqual(["on-disk.md"]);
      expect(readFileSync(join(workspace, "docs", "on-disk.md"), "utf8")).toBe(
        "# On disk\n\nFrom disk.",
      );
      expect(readFileSync(manifestPath, "utf8")).toBe(manifest);
    } finally {
      modeEnv.forEach((key, index) => {
        const value = previousEnv[index];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      });
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
        sourceRootPath: "desktop-folder-shared-b",
      }),
    ]);
  });

  it("relinks a page two remaining folders name to the first by id, as conflict resolution does", async () => {
    const connect = async (connectionId: string, spaceId?: string) => ({
      connectionId,
      ...(await runWithRequestContext({ userEmail: OWNER }, () =>
        connectLocalFolder.run({
          connectionId,
          label: connectionId,
          ...(spaceId ? { spaceId } : { createSourceBackedSpace: true }),
          truthPolicy: "source_primary",
        }),
      )),
    });
    const disconnected = await connect("desktop-folder-relink-order-a");
    const remaining = [
      await connect("desktop-folder-relink-order-b", disconnected.spaceId),
      await connect("desktop-folder-relink-order-c", disconnected.spaceId),
    ];
    const [firstById, secondById] = remaining.sort((left, right) =>
      left.sourceId < right.sourceId ? -1 : 1,
    );
    const sharedDocument = `---\nid: relink-order-page\n---\nBody.`;
    // The later folder's row last, so rows read in insertion order end on it.
    for (const [connection, path] of [
      [disconnected, "from-a.md"],
      [firstById!, "from-first.md"],
      [secondById!, "from-second.md"],
    ] as const) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: connection.sourceId,
          files: { [path]: sharedDocument },
        }),
      );
    }

    await runWithRequestContext({ userEmail: OWNER }, () =>
      disconnectLocalFolder.run({ sourceId: disconnected.sourceId }),
    );

    await expect(
      getDb()
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "relink-order-page")),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceMode: "local-files",
        sourcePath: "from-first.md",
        sourceRootPath: firstById!.connectionId,
      }),
    ]);
  });

  it("rechecks remaining folder links inside the disconnect transaction", async () => {
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-disconnect-race-a",
        label: "Disconnect race A",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const second = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-disconnect-race-b",
        label: "Disconnect race B",
        spaceId: first.spaceId,
        truthPolicy: "source_primary",
      }),
    );
    const sharedDocument = `---\nid: disconnect-race-page\n---\nBody.`;
    for (const [sourceId, path] of [
      [first.sourceId, "a.md"],
      [second.sourceId, "b.md"],
    ] as const) {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId,
          files: { [path]: sharedDocument },
        }),
      );
    }

    const db = getDb();
    const originalTransaction = db.transaction;
    let removedCompetingSource = false;
    db.transaction = async function (...args: any[]) {
      if (!removedCompetingSource) {
        removedCompetingSource = true;
        await db
          .delete(schema.contentDatabaseSourceRows)
          .where(
            eq(schema.contentDatabaseSourceRows.sourceId, second.sourceId),
          );
        await db
          .delete(schema.contentDatabaseSources)
          .where(eq(schema.contentDatabaseSources.id, second.sourceId));
      }
      return originalTransaction.apply(this, args);
    };
    try {
      await runWithRequestContext({ userEmail: OWNER }, () =>
        disconnectLocalFolder.run({ sourceId: first.sourceId }),
      );
    } finally {
      db.transaction = originalTransaction;
    }

    expect(removedCompetingSource).toBe(true);
    await expect(
      db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, "disconnect-race-page")),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceMode: "database",
        sourceKind: null,
        sourcePath: null,
        sourceRootPath: null,
      }),
    ]);
  });

  it("takes a sync's body write to a switched page on main's path, since the page is linked to its file", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-live-copy-sync",
        label: "Live copy sync",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "live.md": "Baseline body." },
      }),
    );
    const documentId = first.created[0]!.id;
    await putPageOnLiveCopy(documentId);
    const before = await pageBodyState(documentId);
    const files = { "live.md": "Incoming folder edit." };

    const preview = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        dryRun: true,
        files,
      }),
    );
    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({ sourceId: connection.sourceId, files }),
    );

    for (const run of [preview, result]) {
      expect(run.updated).toEqual([
        expect.objectContaining({ id: documentId }),
      ]);
    }
    expect(await pageBodyState(documentId)).toEqual({
      page: expect.objectContaining({
        content: "Incoming folder edit.",
        bodyRevision: before.page.bodyRevision + 1,
      }),
      history: [...before.history, "Baseline body."],
      liveCopyVersion: before.liveCopyVersion,
    });
  });

  it("refuses to link a page switched to its live copy to a file that names it, until the page is switched back", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-link-switched-page",
        label: "Link switched page",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const documentId = "content_page_switched_before_link";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: documentId,
      spaceId: connection.spaceId,
      ownerEmail: OWNER,
      orgId: null,
      visibility: "private",
      title: "Content page",
      content: "Content body.",
      createdAt: now,
      updatedAt: now,
    });
    await putPageOnLiveCopy(documentId);
    const before = await pageBodyState(documentId);
    const sourceBefore = await folderSourceState(connection);
    const sync = (dryRun: boolean) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({
          sourceId: connection.sourceId,
          dryRun,
          // Sync applies files in path order, so this page is created in the
          // transaction before named.md is refused.
          files: {
            "another.md": "A page the refused sync would create.",
            "named.md": `---\nid: ${documentId}\n---\nFolder body.`,
          },
        }),
      );

    for (const dryRun of [true, false]) {
      await expect(sync(dryRun)).rejects.toMatchObject({
        errorCode: "LOCAL_FILE_LINK_SWITCHED_PAGE",
        statusCode: 409,
        details: { documentId },
      });
    }
    expect(await pageBodyState(documentId)).toEqual(before);
    expect(before.page.sourceMode).toBeNull();
    expect(await folderSourceState(connection)).toEqual(sourceBefore);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      setLiveBodySwitch.run(
        { id: documentId, switched: false },
        { caller: "frontend", userEmail: OWNER },
      ),
    );
    const linked = await sync(false);

    expect(linked.updated).toEqual([
      expect.objectContaining({ id: documentId }),
    ]);
    expect((await pageBodyState(documentId)).page).toMatchObject({
      content: "Folder body.",
      sourceMode: "local-files",
      liveBodySwitchedAt: null,
    });
  });

  describe("a switched page whose link a Builder pull reset, with two folders' files naming it", () => {
    // A Builder pull sets the page's source mode and leaves both folders'
    // rows, so a remaining row no longer means the page is linked.
    async function switchedPageNamedByTwoFolders(name: string) {
      const first = await runWithRequestContext({ userEmail: OWNER }, () =>
        connectLocalFolder.run({
          connectionId: `desktop-folder-${name}-a`,
          label: `${name} A`,
          createSourceBackedSpace: true,
          truthPolicy: "reviewed_bidirectional",
        }),
      );
      const second = await runWithRequestContext({ userEmail: OWNER }, () =>
        connectLocalFolder.run({
          connectionId: `desktop-folder-${name}-b`,
          label: `${name} B`,
          spaceId: first.spaceId,
          truthPolicy: "source_primary",
        }),
      );
      const documentId = `${name}-page`;
      const file = `---
id: ${documentId}
---
Body.`;
      for (const [sourceId, path] of [
        [first.sourceId, "a.md"],
        [second.sourceId, "b.md"],
      ] as const) {
        await runWithRequestContext({ userEmail: OWNER }, () =>
          syncLocalFolder.run({ sourceId, files: { [path]: file } }),
        );
      }
      await getDb()
        .update(schema.documents)
        .set({
          sourceMode: "builder-mdx",
          sourceKind: null,
          sourcePath: null,
          sourceRootPath: null,
        })
        .where(eq(schema.documents.id, documentId));
      await putPageOnLiveCopy(documentId);
      return { first, documentId };
    }

    it("refuses a disconnect that would relink it to the other folder's file", async () => {
      const { first, documentId } =
        await switchedPageNamedByTwoFolders("relink-disconnect");
      const before = await pageBodyState(documentId);
      const sourceBefore = await folderSourceState(first);

      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          disconnectLocalFolder.run({ sourceId: first.sourceId }),
        ),
      ).rejects.toMatchObject({
        errorCode: "LOCAL_FILE_LINK_SWITCHED_PAGE",
        statusCode: 409,
        details: { documentId },
      });
      expect(await pageBodyState(documentId)).toEqual(before);
      expect(before.page.sourceMode).toBe("builder-mdx");
      expect(await folderSourceState(first)).toEqual(sourceBefore);
    });

    it("refuses to accept a file deletion that would relink it to the other folder's file", async () => {
      const { first, documentId } = await switchedPageNamedByTwoFolders(
        "relink-accept-deletion",
      );
      await runWithRequestContext({ userEmail: OWNER }, () =>
        syncLocalFolder.run({ sourceId: first.sourceId, files: {} }),
      );
      const [changeSet] = await getDb()
        .select()
        .from(schema.contentDatabaseSourceChangeSets)
        .where(
          and(
            eq(schema.contentDatabaseSourceChangeSets.sourceId, first.sourceId),
            eq(schema.contentDatabaseSourceChangeSets.documentId, documentId),
          ),
        );
      expect(changeSet).toMatchObject({ state: "proposed" });
      const before = await pageBodyState(documentId);
      const sourceBefore = await folderSourceState(first);

      await expect(
        runWithRequestContext({ userEmail: OWNER }, () =>
          resolveLocalFolderConflict.run({
            changeSetId: changeSet.id,
            decision: "accept_source",
          }),
        ),
      ).rejects.toMatchObject({
        errorCode: "LOCAL_FILE_LINK_SWITCHED_PAGE",
        statusCode: 409,
        details: { documentId },
      });
      expect(await pageBodyState(documentId)).toEqual(before);
      expect(await folderSourceState(first)).toEqual(sourceBefore);
    });
  });

  it("links a switched page to a file that names it, as main does, while the live-copy flags are off (SF-11)", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-link-switched-flags-off",
        label: "Link switched page, flags off",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const documentId = "content_page_switched_flags_off";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: documentId,
      spaceId: connection.spaceId,
      ownerEmail: OWNER,
      orgId: null,
      visibility: "private",
      title: "Content page",
      content: "Content body.",
      createdAt: now,
      updatedAt: now,
    });
    await putPageOnLiveCopy(documentId);
    await turnLiveCopyFlagsOff();

    const linked = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: {
          "named.md": `---
id: ${documentId}
---
Folder body.`,
        },
      }),
    );

    expect(linked.updated).toEqual([
      expect.objectContaining({ id: documentId }),
    ]);
    expect((await pageBodyState(documentId)).page).toMatchObject({
      content: "Folder body.",
      sourceMode: "local-files",
    });
  });

  it("takes a sync's body write to a switched page as before while the live-copy flags are off (SF-11)", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-live-copy-flags-off",
        label: "Live copy flags off",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "live.md": "Baseline body." },
      }),
    );
    const documentId = first.created[0]!.id;
    await putPageOnLiveCopy(documentId);
    await turnLiveCopyFlagsOff();
    const before = await pageBodyState(documentId);

    const result = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "live.md": "Incoming folder edit." },
      }),
    );

    expect(result.updated).toEqual([
      expect.objectContaining({ id: documentId, path: "live.md" }),
    ]);
    expect(await pageBodyState(documentId)).toEqual({
      page: expect.objectContaining({
        content: "Incoming folder edit.",
        bodyRevision: before.page.bodyRevision + 1,
      }),
      history: [...before.history, "Baseline body."],
      liveCopyVersion: before.liveCopyVersion,
    });
  });

  it("accepts a folder revision onto a switched page on main's path, since the page is linked to its file", async () => {
    const connection = await runWithRequestContext({ userEmail: OWNER }, () =>
      connectLocalFolder.run({
        connectionId: "desktop-folder-live-copy-resolve",
        label: "Live copy resolve",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    const first = await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve.md": "Baseline." },
      }),
    );
    const documentId = first.created[0]!.id;
    await getDb()
      .update(schema.documents)
      .set({ content: "Content edit.", updatedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, documentId));
    await runWithRequestContext({ userEmail: OWNER }, () =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "resolve.md": "Folder edit." },
      }),
    );
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
    await putPageOnLiveCopy(documentId);
    const before = await pageBodyState(documentId);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      resolveLocalFolderConflict.run({
        changeSetId: changeSet.id,
        decision: "accept_source",
        sourceContent: "Folder edit.",
      }),
    );

    const after = await pageBodyState(documentId);
    expect(after.page).toMatchObject({
      content: "Folder edit.",
      bodyRevision: before.page.bodyRevision + 1,
    });
    expect(after.liveCopyVersion).toBe(before.liveCopyVersion);
    expect((await folderSourceState(connection)).changeSets).toEqual([
      expect.objectContaining({ id: changeSet.id, state: "applied" }),
    ]);
  });

  it("refuses re-sharing over a copy that takes body writes through its live copy", async () => {
    const id = "content_local_file_share_live_copy";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id,
      ownerEmail: OWNER,
      title: "Synced note on a live copy",
      content: "Original body",
      sourceMode: "local-files",
      sourceKind: "file",
      sourcePath: "notes/live-copy.md",
      sourceRootPath: "qa-live-copy-folder-source",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    const copy = await runWithRequestContext({ userEmail: OWNER }, () =>
      shareLocalFileDocument.run({ id }),
    );
    await putPageOnLiveCopy(copy.id);
    await getDb()
      .update(schema.documents)
      .set({ content: "Updated body" })
      .where(eq(schema.documents.id, id));
    const before = await pageBodyState(copy.id);

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        shareLocalFileDocument.run({ id }),
      ),
    ).rejects.toMatchObject({
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      statusCode: 409,
      details: { documentId: copy.id, operation: "share-local-file-document" },
    });
    expect(await pageBodyState(copy.id)).toEqual(before);
    expect(before.page.content).toBe("Original body");
  });

  it("re-shares a renamed file over a copy that takes body writes through its live copy when the body is the same", async () => {
    const id = "content_local_file_share_live_copy_title";
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id,
      ownerEmail: OWNER,
      title: "Synced note on a live copy",
      content: "Original body",
      sourceMode: "local-files",
      sourceKind: "file",
      sourcePath: "notes/live-copy-title.md",
      sourceRootPath: "qa-live-copy-folder-source",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    const copy = await runWithRequestContext({ userEmail: OWNER }, () =>
      shareLocalFileDocument.run({ id }),
    );
    await putPageOnLiveCopy(copy.id);
    await getDb()
      .update(schema.documents)
      .set({ title: "Renamed note" })
      .where(eq(schema.documents.id, id));
    const before = await pageBodyState(copy.id);

    await runWithRequestContext({ userEmail: OWNER }, () =>
      shareLocalFileDocument.run({ id }),
    );

    const after = await pageBodyState(copy.id);
    expect(after.page).toMatchObject({
      title: "Renamed note",
      content: "Original body",
      bodyRevision: before.page.bodyRevision,
    });
    expect(after.liveCopyVersion).toBe(before.liveCopyVersion);
  });

  describe("an edit to a linked file on a switched page", () => {
    async function linkedFilePage(id: string) {
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.documents)
        .values({
          id,
          ownerEmail: OWNER,
          title: "Linked note",
          content: "alpha beta",
          sourceMode: "local-files",
          sourceKind: "file",
          sourcePath: `notes/${id}.md`,
          visibility: "private",
          createdAt: now,
          updatedAt: now,
        });
    }
    const edit = (id: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        editDocument.run(
          { id, find: "alpha", replace: "omega", reuseLabels: [] },
          { caller: "frontend", userEmail: OWNER },
        ),
      );

    it("writes the file and the page on main's path, since the page is linked to its file", async () => {
      const id = "linked_file_edit_live_copy";
      await linkedFilePage(id);
      await putPageOnLiveCopy(id);
      const before = await pageBodyState(id);
      const linkedLocal = await import("./_linked-local-document-edit.js");
      const sourceWrite = vi
        .spyOn(linkedLocal, "editLinkedLocalDocumentThroughBrowser")
        .mockImplementationOnce(async () => ({
          status: "persisted",
          content: "omega beta",
          title: "Linked note",
          path: `notes/${id}.md`,
          runtime: "browser",
        }));
      try {
        await expect(edit(id)).resolves.toMatchObject({ applied: 1 });
        expect(sourceWrite).toHaveBeenCalledTimes(1);
        const after = await pageBodyState(id);
        expect(after.page).toMatchObject({
          content: "omega beta",
          bodyRevision: before.page.bodyRevision + 1,
        });
        expect(after.liveCopyVersion).toBe(before.liveCopyVersion);
      } finally {
        sourceWrite.mockRestore();
      }
    });

    it("refuses, and names the file that took the edit, when the page leaves its file and takes its live copy while the file is written", async () => {
      const id = "linked_file_edit_live_copy_mid_write";
      await linkedFilePage(id);
      const linkedLocal = await import("./_linked-local-document-edit.js");
      let before: Awaited<ReturnType<typeof pageBodyState>> | undefined;
      const sourceWrite = vi
        .spyOn(linkedLocal, "editLinkedLocalDocumentThroughBrowser")
        .mockImplementationOnce(async () => {
          // As disconnecting its folder leaves it.
          await getDb()
            .update(schema.documents)
            .set({ sourceMode: "database", sourceKind: null, sourcePath: null })
            .where(eq(schema.documents.id, id));
          await putPageOnLiveCopy(id);
          before = await pageBodyState(id);
          return {
            status: "persisted",
            content: "omega beta",
            title: "Linked note",
            path: `notes/${id}.md`,
            runtime: "browser",
          };
        });
      try {
        await expect(edit(id)).rejects.toMatchObject({
          errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
          statusCode: 409,
          details: {
            documentId: id,
            operation: "edit-document",
            sourcePath: `notes/${id}.md`,
          },
        });
        expect(sourceWrite).toHaveBeenCalledTimes(1);
        expect(before?.page.content).toBe("alpha beta");
        expect(await pageBodyState(id)).toEqual(before);
      } finally {
        sourceWrite.mockRestore();
      }
    });
  });
});
