import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

const notion = vi.hoisted(() => ({
  requireConnection: vi.fn(async () => ({ accessToken: "token" })),
  fetchPage: vi.fn(async (_token: string, id: string) => ({
    id,
    last_edited_time: "2026-11-02T12:00:00.000Z",
  })),
  readPage: vi.fn(async () => ({
    title: "Notion title",
    content: "Notion text",
    icon: null,
    lastEditedTime: "2026-11-02T12:00:00.000Z",
    warnings: [],
  })),
  owner: vi.fn(async () => "folder-writer@example.com"),
}));

vi.mock("../server/lib/notion.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/lib/notion.js")>()),
  getNotionConnectionForOwner: notion.requireConnection,
  requireNotionConnectionForOwner: notion.requireConnection,
  fetchNotionPage: notion.fetchPage,
  readNotionPageAsDocument: notion.readPage,
  getDocumentOwnerEmail: notion.owner,
}));

const saveLock = vi.hoisted(() => ({
  before: null as null | ((tx: unknown) => Promise<void>),
}));

vi.mock("./_document-save-locks.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./_document-save-locks.js")>();
  return {
    ...actual,
    lockDocumentForSave: async (
      ...args: Parameters<typeof actual.lockDocumentForSave>
    ) => {
      const before = saveLock.before;
      saveLock.before = null;
      await before?.(args[0]);
      return actual.lockDocumentForSave(...args);
    },
  };
});

const databaseLock = vi.hoisted(() => ({
  before: null as null | ((tx: unknown) => Promise<void>),
}));

vi.mock("./_content-database-mutation-lock.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./_content-database-mutation-lock.js")
    >();
  return {
    ...actual,
    lockContentDatabaseMutation: async (
      ...args: Parameters<typeof actual.lockContentDatabaseMutation>
    ) => {
      const before = databaseLock.before;
      databaseLock.before = null;
      await before?.(args[0]);
      return actual.lockContentDatabaseMutation(...args);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `local-folder-page-writes-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "folder-writer@example.com";
const person = { caller: "frontend" as const, userEmail: OWNER };
const outsideAgent = { caller: "mcp" as const, userEmail: OWNER };
const ownAgent = { caller: "tool" as const, userEmail: OWNER };
const bridgeRevision = "a".repeat(64);
const ownedByFolder = {
  errorCode: "SOURCE_READ_ONLY",
  statusCode: 409,
  message: expect.stringContaining(
    'owned by the folder "Field notes" on a device',
  ),
};

let getDb: typeof import("../server/db/index.js").getDb;
let schema: typeof import("../server/db/index.js").schema;
let connectLocalFolder: typeof import("./connect-local-folder-source.js").default;
let syncLocalFolder: typeof import("./sync-local-folder-source.js").default;
let createDocument: typeof import("./create-document.js").default;
let getDocument: typeof import("./get-document.js").default;
let updateDocument: typeof import("./update-document.js").default;
let editDocument: typeof import("./edit-document.js").default;
let appendToDocument: typeof import("./append-to-document.js").default;
let moveDocument: typeof import("./move-document.js").default;
let deleteDocument: typeof import("./delete-document.js").default;
let lockLifecycleGroup: typeof import("./delete-document.js").lockLifecycleGroup;
let trashDocumentSubtree: typeof import("./delete-document.js").trashDocumentSubtree;
let addComment: typeof import("./add-comment.js").default;
let shareLocalFileDocument: typeof import("./share-local-file-document.js").default;
let importContentSource: typeof import("./import-content-source.js").default;
let linkNotion: typeof import("./link-notion-page.js").default;
let pullNotion: typeof import("./pull-notion-page.js").default;
let createDatabase: typeof import("./create-content-database.js").default;
let getDatabase: typeof import("./get-content-database.js").default;
let addRow: typeof import("./add-database-item.js").default;
let patchRows: typeof import("./patch-database-items.js").default;
let deleteProperty: typeof import("./delete-document-property.js").default;
let setProperty: typeof import("./set-document-property.js").default;
let parseContentSourceFile: typeof import("../shared/content-source.js").parseContentSourceFile;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;
let writeDocumentToLinkedLocalSource: typeof import("../app/lib/local-content-source-files.js").writeDocumentToLinkedLocalSource;

const asOwner = <T>(run: () => Promise<T>) =>
  runWithRequestContext({ userEmail: OWNER, orgId: null }, run);

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
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
  createDocument = (await import("./create-document.js")).default;
  getDocument = (await import("./get-document.js")).default;
  updateDocument = (await import("./update-document.js")).default;
  editDocument = (await import("./edit-document.js")).default;
  appendToDocument = (await import("./append-to-document.js")).default;
  moveDocument = (await import("./move-document.js")).default;
  deleteDocument = (await import("./delete-document.js")).default;
  ({ lockLifecycleGroup, trashDocumentSubtree } =
    await import("./delete-document.js"));
  addComment = (await import("./add-comment.js")).default;
  shareLocalFileDocument = (await import("./share-local-file-document.js"))
    .default;
  importContentSource = (await import("./import-content-source.js")).default;
  linkNotion = (await import("./link-notion-page.js")).default;
  pullNotion = (await import("./pull-notion-page.js")).default;
  createDatabase = (await import("./create-content-database.js")).default;
  getDatabase = (await import("./get-content-database.js")).default;
  addRow = (await import("./add-database-item.js")).default;
  patchRows = (await import("./patch-database-items.js")).default;
  deleteProperty = (await import("./delete-document-property.js")).default;
  setProperty = (await import("./set-document-property.js")).default;
  ({ parseContentSourceFile } = await import("../shared/content-source.js"));
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
  ({ writeDocumentToLinkedLocalSource } =
    await import("../app/lib/local-content-source-files.js"));
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function folderPage(
  connectionId: string,
  truthPolicy: "source_primary" | "database_primary" = "source_primary",
  spaceId?: string,
) {
  const connection = await asOwner(() =>
    connectLocalFolder.run({
      connectionId,
      label: "Field notes",
      ...(spaceId ? { spaceId } : { createSourceBackedSpace: true }),
      truthPolicy,
    }),
  );
  const publish = (text: string) =>
    asOwner(() =>
      syncLocalFolder.run({
        sourceId: connection.sourceId,
        files: { "notes.md": text },
      }),
    );
  const synced = await publish("# Field notes\n\nFrom disk.\n");
  const id = synced.created.map((page) => page.id).join();
  return { id, publish, sourceId: connection.sourceId as string, connectionId };
}

async function setFolderSettings(
  sourceId: string,
  change: (metadata: Record<string, unknown>) => Record<string, unknown>,
  db: ReturnType<typeof getDb> = getDb(),
) {
  const [source] = await db
    .select({ metadataJson: schema.contentDatabaseSources.metadataJson })
    .from(schema.contentDatabaseSources)
    .where(eq(schema.contentDatabaseSources.id, sourceId));
  await db
    .update(schema.contentDatabaseSources)
    .set({
      metadataJson: JSON.stringify(change(JSON.parse(source.metadataJson))),
    })
    .where(eq(schema.contentDatabaseSources.id, sourceId));
}

async function collectionWithRows(titles: string[]) {
  const created = await asOwner(() =>
    createDatabase.run({ title: "Reading list" }),
  );
  const databaseId = created.database.id as string;
  const contract = async () => {
    const response = await asOwner(() => getDatabase.run({ databaseId }));
    if (!("database" in response) || !response.mutationContract)
      throw new Error("The collection has no mutation contract.");
    return response.mutationContract;
  };
  const envelope = async (idempotencyKey: string) => {
    const discovered = await contract();
    return {
      target: {
        spaceId: discovered.target.spaceId,
        databaseId: discovered.target.databaseId,
        databaseDocumentId: discovered.target.databaseDocumentId,
      },
      expectedSchemaRevision: discovered.schemaRevision,
      idempotencyKey,
    };
  };
  const rows = [];
  for (const title of titles) {
    const added = await asOwner(async () =>
      addRow.run({
        ...(await envelope(`${databaseId}-${title}`)),
        title,
      }),
    );
    rows.push(added.receipt.row);
  }
  return {
    databaseId,
    databaseDocumentId: created.database.documentId as string,
    spaceId: (await contract()).target.spaceId,
    rows,
    envelope,
  };
}

async function giveRowToFolder(
  row: { itemId: string; documentId: string },
  folder: { sourceId: string; connectionId: string },
) {
  await getDb()
    .update(schema.documents)
    .set({
      sourceMode: "local-files",
      sourceKind: "file",
      sourcePath: `${row.documentId}.md`,
      sourceRootPath: folder.connectionId,
      content: "From the folder.",
    })
    .where(eq(schema.documents.id, row.documentId));
  await getDb()
    .insert(schema.contentDatabaseSourceRows)
    .values({
      id: `folder-row-${row.documentId}`,
      ownerEmail: OWNER,
      sourceId: folder.sourceId,
      databaseItemId: row.itemId,
      documentId: row.documentId,
      sourceRowId: row.documentId,
      sourceQualifiedId: row.documentId,
      sourceDisplayKey: `${row.documentId}.md`,
    });
}

async function filesCollectionOf(id: string) {
  const memberships = await getDb()
    .select({
      databaseId: schema.contentDatabases.id,
      primaryBlocksPropertyId: schema.contentDatabases.primaryBlocksPropertyId,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .where(eq(schema.contentDatabaseItems.documentId, id));
  const files = memberships.find(
    (membership) => membership.primaryBlocksPropertyId,
  );
  if (!files?.primaryBlocksPropertyId)
    throw new Error("The folder's Files collection has no Blocks field.");
  return {
    databaseId: files.databaseId,
    propertyId: files.primaryBlocksPropertyId,
  };
}

async function readPage(id: string) {
  const [page] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return page;
}

let saveAttempt = 0;

async function editorBodySave(id: string, content: string) {
  const base = await readPage(id);
  const baseRevision = documentRevisionToken(base.bodyRevision, base.content);
  saveAttempt += 1;
  return {
    id,
    content,
    baseUpdatedAt: base.updatedAt,
    baseRevision,
    authoredBaseRevision: baseRevision,
    authoredBaseContent: base.content,
    authoredCandidateContent: content,
    editorSessionId: `local-folder-writes:${id}`,
    editorEditGeneration: saveAttempt,
    editorSnapshotTitle: base.title,
    editorSnapshotContent: content,
    browserSaveAttemptId: `local-folder-save-${saveAttempt}`,
    historySessionId: `local-folder-history:${id}`,
  };
}

async function desktopFileWrite(
  id: string,
  change: { title?: string; content?: string },
) {
  const page = await readPage(id);
  const path = page.sourcePath as string;
  const folder = { id: page.sourceRootPath as string, name: "Field notes" };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      agentNativeDesktop: {
        contentFiles: {
          getFolder: async () => ({ ok: true, folder, folders: [folder] }),
          readFiles: async () => ({
            ok: true,
            folder,
            sources: { [path]: "# Field notes\n\nFrom disk.\n" },
            revisions: { [path]: "f".repeat(64) },
          }),
          writeFile: async () => ({
            ok: true,
            folder,
            folders: [folder],
            files: [path],
            controlResources: {},
          }),
          writeFiles: vi.fn(),
          chooseFolder: vi.fn(),
          revealFile: vi.fn(),
          clearFolder: vi.fn(),
        },
      },
    },
  });
  try {
    const result = await writeDocumentToLinkedLocalSource(
      {
        id,
        title: change.title ?? page.title,
        content: change.content ?? page.content,
        description: page.description,
        icon: page.icon,
      } as never,
      {
        mode: "local-files",
        kind: "file",
        path,
        rootPath: folder.id,
      },
    );
    if (!result.ok || !result.revision)
      throw new Error("The Desktop write named no revision.");
    return result.revision;
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
  }
}

async function revisionOf(id: string) {
  return (
    (await asOwner(() => getDocument.run({ id }, person))) as {
      revision: string;
    }
  ).revision;
}

describe("pages a local folder owns", () => {
  it("refuses ordinary title, body and description writes from any caller", async () => {
    const { id } = await folderPage("h7-ordinary-writes");
    const before = await readPage(id);
    const baseRevision = await revisionOf(id);

    for (const change of [
      { title: "Injected title" },
      { content: "Injected body" },
      { description: "Injected description" },
    ]) {
      await expect(
        asOwner(() => updateDocument.run({ id, ...change }, person)),
      ).rejects.toMatchObject(ownedByFolder);
    }
    await expect(
      asOwner(() =>
        updateDocument.run(
          { id, content: "Injected body", baseRevision },
          { caller: "cli", userEmail: OWNER },
        ),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    for (const agent of [ownAgent, outsideAgent]) {
      await expect(
        asOwner(() =>
          updateDocument.run(
            {
              id,
              title: "Injected title",
              localSourceRevision: bridgeRevision,
            },
            agent,
          ),
        ),
      ).rejects.toMatchObject(ownedByFolder);
    }
    await expect(
      asOwner(() =>
        editDocument.run(
          {
            id,
            baseRevision,
            idempotencyKey: "h7-outside-edit",
            find: "From disk.",
            replace: "Injected.",
          },
          outsideAgent,
        ),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    await expect(
      asOwner(() =>
        appendToDocument.run(
          { documentId: id, content: "Injected paragraph." },
          person,
        ),
      ),
    ).rejects.toMatchObject(ownedByFolder);

    const after = await readPage(id);
    expect(after).toMatchObject({
      title: before.title,
      content: before.content,
      description: before.description,
      bodyRevision: before.bodyRevision,
      sourceUpdatedAt: before.sourceUpdatedAt,
    });
  });

  it("refuses moving the page or putting it in Trash", async () => {
    const { id } = await folderPage("h7-move-trash");
    const elsewhere = (await asOwner(() =>
      createDocument.run({ title: "Elsewhere" }, person),
    )) as { id: string };
    const before = await readPage(id);

    await expect(
      asOwner(() => moveDocument.run({ id, parentId: elsewhere.id }, person)),
    ).rejects.toMatchObject({
      errorCode: "SOURCE_READ_ONLY",
      message: expect.stringContaining("stays where its file is"),
    });
    await expect(
      asOwner(() => deleteDocument.run({ id }, person)),
    ).rejects.toMatchObject({
      errorCode: "SOURCE_READ_ONLY",
      message: expect.stringContaining("Delete its file in that folder"),
    });

    const after = await readPage(id);
    expect(after.parentId).toBe(before.parentId);
    expect(after.trashedAt).toBeNull();
  });

  it("takes the folder's copy from the folder publish and from the editor that wrote the file", async () => {
    const { id, publish } = await folderPage("h7-publish");

    const published = await publish("# Field notes\n\nEdited on disk.\n");
    expect(published.updated.map((page) => page.id)).toEqual([id]);
    expect((await readPage(id)).content).toBe(
      "# Field notes\n\nEdited on disk.\n",
    );

    const renamed = await desktopFileWrite(id, {
      title: "Field notes, renamed",
    });
    await asOwner(() =>
      updateDocument.run(
        {
          id,
          title: "Field notes, renamed",
          localSourceRevision: renamed,
        },
        person,
      ),
    );
    const body = "Saved by the editor after writing the file.";
    const saved = await desktopFileWrite(id, { content: body });
    await asOwner(async () =>
      updateDocument.run(
        { ...(await editorBodySave(id, body)), localSourceRevision: saved },
        person,
      ),
    );
    expect(await readPage(id)).toMatchObject({
      title: "Field notes, renamed",
      content: "Saved by the editor after writing the file.",
    });
  });

  it("keeps comments, favorites, icons and shareable copies available", async () => {
    const { id } = await folderPage("h7-companions");

    await asOwner(() =>
      addComment.run({ documentId: id, content: "Reviewed remotely." }, person),
    );
    await asOwner(() => updateDocument.run({ id, isFavorite: true }, person));
    await asOwner(() => updateDocument.run({ id, icon: "📁" }, person));
    expect((await readPage(id)).icon).toContain("📁");
    const copy = await asOwner(() => shareLocalFileDocument.run({ id }));
    expect(copy).toMatchObject({
      content: (await readPage(id)).content,
      source: { mode: "database", kind: "local-file-copy" },
    });
  });

  it("leaves a folder whose Content copy is primary editable in Content", async () => {
    const { id } = await folderPage("h7-content-primary", "database_primary");
    await asOwner(() =>
      updateDocument.run({ id, title: "Edited in Content" }, person),
    );
    expect((await readPage(id)).title).toBe("Edited in Content");
  });

  it("leaves ordinary pages editable", async () => {
    const page = (await asOwner(() =>
      createDocument.run({ title: "Ordinary", content: "Body" }, person),
    )) as { id: string };
    await asOwner(() =>
      updateDocument.run({ id: page.id, title: "Ordinary, renamed" }, person),
    );
    await asOwner(async () =>
      updateDocument.run(await editorBodySave(page.id, "New body"), person),
    );
    expect(await readPage(page.id)).toMatchObject({
      title: "Ordinary, renamed",
      content: "New body",
    });
    await asOwner(() =>
      appendToDocument.run(
        { documentId: page.id, content: "Appended." },
        person,
      ),
    );
    expect((await readPage(page.id)).content).toContain("Appended.");
  });
});

describe("every other writer of a folder's page", () => {
  it("checks the body an editor save would write, not only the body it sent", async () => {
    const { id } = await folderPage("h7-authored-body");
    const before = await readPage(id);
    const save = await editorBodySave(id, "Injected through the merge.");

    await expect(
      asOwner(() =>
        updateDocument.run({ ...save, content: before.content }, person),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    expect((await readPage(id)).content).toBe(before.content);
  });

  it("checks again under the page lock when the folder takes the page first", async () => {
    const { id, sourceId } = await folderPage(
      "h7-after-lock",
      "database_primary",
    );
    const before = await readPage(id);
    saveLock.before = (tx) =>
      setFolderSettings(
        sourceId,
        (metadata) => ({ ...metadata, truthPolicy: "source_primary" }),
        tx as ReturnType<typeof getDb>,
      );

    await expect(
      asOwner(() =>
        updateDocument.run({ id, title: "Renamed in Content" }, person),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    expect((await readPage(id)).title).toBe(before.title);
  });

  it("refuses a batch of row titles that includes a folder's page and changes none", async () => {
    const collection = await collectionWithRows(["Ordinary", "Folder's"]);
    const folder = await folderPage(
      "h7-row-batch",
      "source_primary",
      collection.spaceId,
    );
    const [ordinary, owned] = collection.rows;
    await giveRowToFolder(owned, folder);

    await expect(
      asOwner(async () =>
        patchRows.run(
          {
            ...(await collection.envelope("h7-row-batch-patch")),
            rows: collection.rows.map((row) => ({
              itemId: row.itemId,
              documentId: row.documentId,
              expectedRowRevision: row.rowRevision,
              title: `${row.documentId} renamed`,
            })),
          } as never,
          outsideAgent,
        ),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    expect((await readPage(ordinary.documentId)).title).toBe("Ordinary");
    expect((await readPage(owned.documentId)).title).toBe("Folder's");
  });

  it("keeps a collection's last Blocks field while a folder's page would lose its body", async () => {
    const { id } = await folderPage("h7-blocks-field");
    const before = await readPage(id);
    const files = await filesCollectionOf(id);

    await expect(
      asOwner(() => deleteProperty.run({ documentId: id, ...files }, person)),
    ).rejects.toMatchObject(ownedByFolder);
    expect((await readPage(id)).content).toBe(before.content);
  });

  it("checks again under the page lock before writing a page's main Blocks field", async () => {
    const { id, sourceId } = await folderPage(
      "h7-blocks-after-lock",
      "database_primary",
    );
    const before = await readPage(id);
    const baseRevision = await revisionOf(id);
    databaseLock.before = (tx) =>
      setFolderSettings(
        sourceId,
        (metadata) => ({ ...metadata, truthPolicy: "source_primary" }),
        tx as ReturnType<typeof getDb>,
      );

    await expect(
      asOwner(async () =>
        setProperty.run(
          {
            documentId: id,
            ...(await filesCollectionOf(id)),
            value: "Injected through the Blocks field.",
            baseRevision,
          },
          outsideAgent,
        ),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    expect(databaseLock.before).toBeNull();
    expect(await readPage(id)).toMatchObject({
      content: before.content,
      bodyRevision: before.bodyRevision,
    });
    expect(await revisionOf(id)).toBe(baseRevision);
  });

  it("skips importing Markdown over a folder's page by id or by path, and the folder still syncs", async () => {
    const { id, publish } = await folderPage("h7-import");
    const before = await readPage(id);

    const byId = await asOwner(() =>
      importContentSource.run(
        {
          files: {
            "elsewhere/notes.md": `---\nid: ${id}\ntitle: Imported\n---\n\nImported body.\n`,
          },
          dryRun: false,
        },
        outsideAgent,
      ),
    );
    const byPath = await asOwner(() =>
      importContentSource.run(
        {
          files: { [before.sourcePath as string]: "Imported body.\n" },
          dryRun: false,
        },
        outsideAgent,
      ),
    );
    for (const result of [byId, byPath]) {
      expect(result.updated).toEqual([]);
      expect(result.skipped).toEqual([
        expect.objectContaining({
          reason: expect.stringContaining(
            'owned by the folder "Field notes" on a device',
          ),
        }),
      ]);
    }
    expect(await readPage(id)).toMatchObject({
      title: before.title,
      content: before.content,
      description: before.description,
      sourcePath: before.sourcePath,
      sourceRootPath: before.sourceRootPath,
    });

    await publish("# Field notes\n\nStill synced.\n");
    expect((await readPage(id)).content).toBe(
      "# Field notes\n\nStill synced.\n",
    );
  });

  it("leaves a folder's page where it is when an unchanged import names another place for it", async () => {
    const { id } = await folderPage("h7-import-layout");
    const path = "field/notes.md";
    const text = `---\nid: ${id}\nposition: 7\n---\n\n# Field notes\n\nFrom disk.\n`;
    const file = parseContentSourceFile(path, text);
    await getDb()
      .update(schema.documents)
      .set({
        title: file.title,
        content: file.content,
        sourcePath: path,
        sourceRootPath: "field",
      })
      .where(eq(schema.documents.id, id));
    const before = await readPage(id);
    expect(before.position).not.toBe(7);

    const result = await asOwner(() =>
      importContentSource.run(
        { files: { [path]: text }, dryRun: false },
        outsideAgent,
      ),
    );

    expect(result.unchanged.map((page) => page.id)).toEqual([id]);
    expect(result.skipped).toEqual([
      expect.objectContaining({
        path,
        reason: expect.stringContaining("stays where its file is"),
      }),
    ]);
    expect(await readPage(id)).toMatchObject({
      parentId: before.parentId,
      position: before.position,
    });
  });

  it("refuses linking a folder's page to Notion, and pulling Notion into one already linked", async () => {
    const { id } = await folderPage("h7-notion");
    const before = await readPage(id);

    await expect(
      asOwner(() =>
        linkNotion.run({ documentId: id, pageId: "a".repeat(32) }, person),
      ),
    ).rejects.toMatchObject(ownedByFolder);
    expect(
      await getDb()
        .select()
        .from(schema.documentSyncLinks)
        .where(eq(schema.documentSyncLinks.documentId, id)),
    ).toEqual([]);

    await getDb()
      .insert(schema.documentSyncLinks)
      .values({
        documentId: id,
        ownerEmail: OWNER,
        remotePageId: "b".repeat(32),
        state: "linked",
        lastSyncedAt: "2026-11-01T12:00:00.000Z",
        lastPulledRemoteUpdatedAt: "2026-11-01T12:00:00.000Z",
        lastPushedLocalUpdatedAt: before.updatedAt,
        lastKnownRemoteUpdatedAt: "2026-11-01T12:00:00.000Z",
        hasConflict: 0,
        warningsJson: "[]",
      });
    await expect(
      asOwner(() => pullNotion.run({ documentId: id }, person)),
    ).rejects.toMatchObject(ownedByFolder);
    expect(await readPage(id)).toMatchObject({
      title: before.title,
      content: before.content,
    });
  });

  it("refuses moving a page to Trash while a folder's page sits inside it", async () => {
    const { id } = await folderPage("h7-subtree");
    const parent = (await asOwner(() =>
      createDocument.run({ title: "Holds a folder page" }, person),
    )) as { id: string };
    await getDb()
      .update(schema.documents)
      .set({ parentId: parent.id })
      .where(eq(schema.documents.id, id));

    await expect(
      asOwner(() => deleteDocument.run({ id: parent.id }, person)),
    ).rejects.toMatchObject({
      errorCode: "SOURCE_READ_ONLY",
      message: expect.stringContaining("Pages inside this one are owned by"),
    });
    expect((await readPage(parent.id)).trashedAt).toBeNull();
    expect((await readPage(id)).trashedAt).toBeNull();
  });

  it("still lets the folder's own sync move a page to Trash", async () => {
    const { id } = await folderPage("h7-sync-trash");
    const trash = (origin?: string) =>
      asOwner(() =>
        getDb().transaction(async (transaction) => {
          const tx = transaction as unknown as ReturnType<typeof getDb>;
          const locks = await lockLifecycleGroup(tx, {
            operation: "trash",
            roots: [{ id, ownerEmail: OWNER }],
          });
          return trashDocumentSubtree(tx, id, OWNER, undefined, locks, origin);
        }),
      );

    await expect(trash()).rejects.toMatchObject({
      errorCode: "SOURCE_READ_ONLY",
    });
    expect((await readPage(id)).trashedAt).toBeNull();

    await trash("local-folder");
    const after = await readPage(id);
    expect(after.trashedAt).not.toBeNull();
    expect(after).toMatchObject({
      trashRootId: id,
      trashOrigin: "local-folder",
    });
  });
});

describe("which pages a folder owns", () => {
  it("leaves a page editable when its folder stores no policy", async () => {
    const { id, sourceId } = await folderPage("h7-no-policy");
    await setFolderSettings(sourceId, ({ truthPolicy: _, ...rest }) => rest);

    await asOwner(() => updateDocument.run({ id, title: "Renamed" }, person));
    expect((await readPage(id)).title).toBe("Renamed");
  });

  it("goes by the page's folder link when its markers name another root", async () => {
    const { id } = await folderPage("h7-other-root");
    await getDb()
      .update(schema.documents)
      .set({ sourceRootPath: "another-folder" })
      .where(eq(schema.documents.id, id));

    await expect(
      asOwner(() => updateDocument.run({ id, title: "Renamed" }, person)),
    ).rejects.toMatchObject(ownedByFolder);
  });

  it("leaves a page editable once its folder's link is gone", async () => {
    const { id, sourceId } = await folderPage("h7-source-gone");
    await getDb()
      .delete(schema.contentDatabaseSources)
      .where(eq(schema.contentDatabaseSources.id, sourceId));

    await asOwner(() => updateDocument.run({ id, title: "Renamed" }, person));
    expect((await readPage(id)).title).toBe("Renamed");
  });

  it("refuses a write when its folder's settings can't be read", async () => {
    const { id, sourceId } = await folderPage("h7-unreadable");
    await getDb()
      .update(schema.contentDatabaseSources)
      .set({ metadataJson: "{" })
      .where(eq(schema.contentDatabaseSources.id, sourceId));
    const before = await readPage(id);

    await expect(
      asOwner(() => updateDocument.run({ id, title: "Renamed" }, person)),
    ).rejects.toMatchObject({ errorCode: "SOURCE_METADATA_UNREADABLE" });
    expect((await readPage(id)).title).toBe(before.title);
  });

  it("leaves a page imported from Markdown, with no folder, editable", async () => {
    const imported = await asOwner(() =>
      importContentSource.run(
        {
          files: { "notes/one-off.md": "# One-off\n\nBody.\n" },
          dryRun: false,
        },
        person,
      ),
    );
    const [page] = imported.created;
    expect((await readPage(page.id)).sourceMode).toBe("local-files");

    await asOwner(() =>
      updateDocument.run({ id: page.id, title: "Renamed one-off" }, person),
    );
    expect((await readPage(page.id)).title).toBe("Renamed one-off");
  });
});
