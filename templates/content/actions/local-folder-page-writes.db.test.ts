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
let addComment: typeof import("./add-comment.js").default;
let shareLocalFileDocument: typeof import("./share-local-file-document.js").default;
let documentRevisionToken: typeof import("./_document-edit-mutation.js").documentRevisionToken;

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
  addComment = (await import("./add-comment.js")).default;
  shareLocalFileDocument = (await import("./share-local-file-document.js"))
    .default;
  ({ documentRevisionToken } = await import("./_document-edit-mutation.js"));
}, 60000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function folderPage(
  connectionId: string,
  truthPolicy: "source_primary" | "database_primary" = "source_primary",
) {
  const connection = await asOwner(() =>
    connectLocalFolder.run({
      connectionId,
      label: "Field notes",
      createSourceBackedSpace: true,
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
  return { id, publish };
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

    await asOwner(() =>
      updateDocument.run(
        {
          id,
          title: "Field notes, renamed",
          localSourceRevision: bridgeRevision,
        },
        person,
      ),
    );
    await asOwner(async () =>
      updateDocument.run(
        {
          ...(await editorBodySave(
            id,
            "Saved by the editor after writing the file.",
          )),
          localSourceRevision: bridgeRevision,
        },
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
