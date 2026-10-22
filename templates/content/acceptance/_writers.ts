import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";

import {
  contentSourcePathForDocument,
  serializeContentSourceDocument,
} from "../shared/content-source.js";

// The stored-form writer map, and the page bodies the stored-form checks write
// through it. The named bodies carry the differences between what agents send
// and what the editor stores; the generated ones mix them, so a writer that
// handles each difference alone but not together still shows up.
//
// Drivers import the app lazily: a test file points DATABASE_URL at its own
// PGlite directory before the first import opens the database.

export interface StoredFormInput {
  name: string;
  body: string;
}

export const AGENT_FORM_INPUTS: readonly StoredFormInput[] = [
  {
    name: "blank lines between paragraphs",
    body: "Alpha paragraph.\n\nBravo paragraph.\n\n\nCharlie after two blank lines.",
  },
  { name: "escaped underscore", body: "Rename snake\\_case to camelCase." },
  { name: "underscore bold", body: "This is __bold__ and **also bold**." },
  { name: "bare dollar sign", body: "The plan costs $60 a month." },
  {
    name: "GFM table with edge spaces in cells",
    body: "| Name | Price |\n| --- | --- |\n|  Widget  | 60 |\n| Gadget |  10  |",
  },
  {
    name: "four-space nested list",
    body: "- Parent item\n    - Nested with four spaces\n- Sibling item",
  },
  { name: "trailing blank lines", body: "Closing paragraph.\n\n" },
];

export const CANONICAL_INPUTS: readonly StoredFormInput[] = [
  { name: "canonical paragraphs", body: "Alpha paragraph.\nBravo paragraph." },
  {
    name: "canonical heading, list and tab-nested item",
    body: "## Section\nIntro line.\n- one\n\t- nested with a tab\n- two",
  },
  {
    name: "canonical table",
    body: '<table header-row="true">\n<tr>\n<td>Name</td>\n<td>Price</td>\n</tr>\n<tr>\n<td>Widget</td>\n<td>\\$60</td>\n</tr>\n</table>',
  },
];

export const FIXED_INPUTS: readonly StoredFormInput[] = [
  ...AGENT_FORM_INPUTS,
  ...CANONICAL_INPUTS,
];

// mulberry32: a fixed seed gives the same bodies on every run and machine.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GENERATOR_SEED = 0x5f08;

/** Two to four fixed bodies joined by one newline or a blank line. */
export function generatedInputs(
  count: number,
  seed = GENERATOR_SEED,
): StoredFormInput[] {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(random() * items.length)];
  return Array.from({ length: count }, (_, index) => {
    const parts = Array.from({ length: 2 + Math.floor(random() * 3) }, () =>
      pick(FIXED_INPUTS),
    );
    const separator = pick(["\n", "\n\n"] as const);
    return {
      name: `generated ${index + 1}: ${parts.map((part) => part.name).join(" + ")} (joined by ${separator === "\n" ? "a newline" : "a blank line"})`,
      body: parts.map((part) => part.body).join(separator),
    };
  });
}

export const WRITER_OWNER = "stored-form-writer@example.com";

/** The canonical body the writers that change an existing page start from. */
const EXISTING_BODY = "Placeholder line.";

export interface StoredBody {
  content: string;
  bodyRevision: number;
  collabBodyRevision: number | null;
}

/** One body write: the page it landed on, as stored before and after. */
export interface BodyWrite {
  documentId: string;
  before: StoredBody | null;
  after: StoredBody;
}

export interface BodyWriter {
  name: string;
  write: (input: StoredFormInput) => Promise<BodyWrite>;
}

/** A writer in the map no PGlite test can drive yet, and what it lacks. */
export interface UndrivenWriter {
  name: string;
  missing: string;
}

async function asOwner<T>(run: () => T | Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: WRITER_OWNER }, run);
}

const agentCtx = { caller: "mcp" as const, userEmail: WRITER_OWNER };
const browserCtx = { caller: "frontend" as const, userEmail: WRITER_OWNER };

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

const app = () => import("../server/db/index.js");

async function revisionToken(body: StoredBody): Promise<string> {
  const { documentRevisionToken } =
    await import("../actions/_document-edit-mutation.js");
  return documentRevisionToken(body.bodyRevision, body.content);
}

/**
 * Creates the tables Content reads organization membership from. Core's org
 * migrations own them; Content's DB plugin, the one these tests run, does not.
 */
export async function createOrganizationTables(): Promise<void> {
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
}

export async function readStoredBody(documentId: string): Promise<StoredBody> {
  const { getDb, schema } = await app();
  const [row] = await getDb()
    .select({
      content: schema.documents.content,
      bodyRevision: schema.documents.bodyRevision,
      collabBodyRevision: schema.documents.collabBodyRevision,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId));
  if (!row) throw new Error(`Page ${documentId} is not in the database.`);
  return row;
}

/** A page whose body is already stored, the way any older page's is. */
async function seedPage(prefix: string, content: string): Promise<string> {
  const { getDb, schema } = await app();
  const id = nextId(prefix);
  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: WRITER_OWNER,
    title: "Stored form",
    content,
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function writeExistingPage(
  documentId: string,
  write: (before: StoredBody) => unknown,
): Promise<BodyWrite> {
  const before = await readStoredBody(documentId);
  await asOwner(() => write(before));
  return { documentId, before, after: await readStoredBody(documentId) };
}

async function writeNewPage(write: () => Promise<string>): Promise<BodyWrite> {
  const documentId = await asOwner(write);
  return { documentId, before: null, after: await readStoredBody(documentId) };
}

const createDocument: BodyWriter = {
  name: "create-document",
  write: async (input) => {
    const action = (await import("../actions/create-document.js")).default;
    return writeNewPage(async () => {
      const created = await action.run(
        { title: "Stored form", content: input.body, reuseLabels: [] },
        agentCtx,
      );
      return created.id;
    });
  },
};

const editDocumentInitialize: BodyWriter = {
  name: "edit-document initializeContent",
  write: async (input) => {
    const action = (await import("../actions/edit-document.js")).default;
    const id = await seedPage("edit-initialize", "");
    return writeExistingPage(id, async (before) =>
      action.run(
        {
          id,
          baseRevision: await revisionToken(before),
          idempotencyKey: nextId("edit-initialize-key"),
          initializeContent: input.body,
          reuseLabels: [],
        },
        agentCtx,
      ),
    );
  },
};

const editDocumentReplace: BodyWriter = {
  name: "edit-document find and replace",
  write: async (input) => {
    const action = (await import("../actions/edit-document.js")).default;
    const id = await seedPage("edit-replace", EXISTING_BODY);
    return writeExistingPage(id, async (before) =>
      action.run(
        {
          id,
          baseRevision: await revisionToken(before),
          idempotencyKey: nextId("edit-replace-key"),
          find: EXISTING_BODY,
          replace: input.body,
          reuseLabels: [],
        },
        agentCtx,
      ),
    );
  },
};

/** The edit-document path a browser caller takes without a revision. */
const editDocumentUnrevisioned: BodyWriter = {
  name: "edit-document find and replace without a revision",
  write: async (input) => {
    const action = (await import("../actions/edit-document.js")).default;
    const id = await seedPage("edit-unrevisioned", EXISTING_BODY);
    return writeExistingPage(id, () =>
      action.run(
        { id, find: EXISTING_BODY, replace: input.body, reuseLabels: [] },
        browserCtx,
      ),
    );
  },
};

const updateDocumentBrowser: BodyWriter = {
  name: "update-document browser full rewrite",
  write: async (input) => {
    const action = (await import("../actions/update-document.js")).default;
    const id = await seedPage("browser-rewrite", EXISTING_BODY);
    return writeExistingPage(id, async (before) => {
      const revision = await revisionToken(before);
      return action.run(
        {
          id,
          content: input.body,
          baseRevision: revision,
          authoredBaseRevision: revision,
          authoredBaseContent: before.content,
          authoredCandidateContent: input.body,
          editorSessionId: nextId("browser-session"),
          editorEditGeneration: 1,
          browserSaveAttemptId: nextId("browser-attempt"),
        },
        { ...browserCtx, actionName: "update-document" },
      );
    });
  },
};

/** Restores a saved version whose body is the input. */
const restoreDocumentVersion: BodyWriter = {
  name: "restore-document-version",
  write: async (input) => {
    const action = (await import("../actions/restore-document-version.js"))
      .default;
    const { getDb, schema } = await app();
    const id = await seedPage("version-restore", EXISTING_BODY);
    const versionId = nextId("version");
    await getDb()
      .insert(schema.documentVersions)
      .values({
        id: versionId,
        ownerEmail: WRITER_OWNER,
        documentId: id,
        title: "Stored form",
        content: input.body,
        bodyRevision: 0,
        createdAt: new Date(Date.now() - 60_000).toISOString(),
      });
    const [page] = await getDb()
      .select({ updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, id));
    return writeExistingPage(id, () =>
      action.run(
        { documentId: id, versionId, expectedUpdatedAt: page.updatedAt },
        browserCtx,
      ),
    );
  },
};

async function importPage(
  input: StoredFormInput,
): Promise<{ importId: string; documentId: string }> {
  const action = (await import("../actions/import-content.js")).default;
  const result = await asOwner(() =>
    action.run(
      {
        files: [{ name: "stored-form.md", text: input.body }],
        dryRun: false,
        idempotencyKey: nextId("import-key"),
      },
      agentCtx,
    ),
  );
  const ids = result.pages.flatMap((page) => (page.id ? [page.id] : []));
  if (ids.length !== 1)
    throw new Error(
      `import-content created ${ids.length} pages from one file: ${JSON.stringify(result)}`,
    );
  return { importId: result.importId, documentId: ids[0] };
}

const importContent: BodyWriter = {
  name: "import-content",
  write: async (input) =>
    writeNewPage(async () => (await importPage(input)).documentId),
};

/** Undo moves the imported page to Trash; it must keep the body import stored. */
const undoContentImport: BodyWriter = {
  name: "undo-content-import",
  write: async (input) => {
    const action = (await import("../actions/undo-content-import.js")).default;
    const { importId, documentId } = await importPage(input);
    return writeExistingPage(documentId, async () => {
      const undone = await action.run({ importId }, agentCtx);
      if (!undone.trashedIds.includes(documentId))
        throw new Error(
          `undo-content-import left ${documentId} out of Trash: ${JSON.stringify(undone)}`,
        );
    });
  },
};

async function importSourceFile(id: string, body: string) {
  const action = (await import("../actions/import-content-source.js")).default;
  const title = "Stored form";
  const result = await action.run({
    files: {
      [contentSourcePathForDocument({ id, title })]:
        serializeContentSourceDocument({
          id,
          parentId: null,
          title,
          content: body,
          icon: null,
          position: 0,
          isFavorite: false,
          hideFromSearch: false,
          visibility: "private",
        }),
    },
    dryRun: false,
  });
  if (result.errors.length > 0 || result.skipped.length > 0)
    throw new Error(
      `import-content-source did not write ${id}: ${JSON.stringify(result)}`,
    );
}

const importContentSourceNew: BodyWriter = {
  name: "local files: import-content-source new page",
  write: async (input) =>
    writeNewPage(async () => {
      const id = nextId("source-new");
      await importSourceFile(id, input.body);
      return id;
    }),
};

const importContentSourceExisting: BodyWriter = {
  name: "local files: import-content-source existing page",
  write: async (input) => {
    const id = nextId("source-existing");
    await asOwner(() => importSourceFile(id, EXISTING_BODY));
    return writeExistingPage(id, () => importSourceFile(id, input.body));
  },
};

let folderSource: Promise<string> | undefined;

/** One local folder connection every folder sync in a file shares. */
function connectedFolder(): Promise<string> {
  folderSource ??= (async () => {
    const action = (await import("../actions/connect-local-folder-source.js"))
      .default;
    const connection = await asOwner(() =>
      action.run({
        connectionId: "stored-form-folder",
        label: "Stored form folder",
        createSourceBackedSpace: true,
        truthPolicy: "source_primary",
      }),
    );
    if (!connection.sourceId)
      throw new Error(
        `connect-local-folder-source returned no source: ${JSON.stringify(connection)}`,
      );
    return connection.sourceId;
  })();
  return folderSource;
}

async function syncFolderFile(
  path: string,
  body: string,
): Promise<{ id: string; change: "created" | "updated" }> {
  const action = (await import("../actions/sync-local-folder-source.js"))
    .default;
  const sourceId = await connectedFolder();
  const result = await action.run({ sourceId, files: { [path]: body } });
  const created = result.created.find((file) => file.path === path);
  const updated = result.updated.find((file) => file.path === path);
  const change = created ? "created" : updated ? "updated" : null;
  if (!change)
    throw new Error(
      `sync-local-folder-source did not write ${path}: ${JSON.stringify(result)}`,
    );
  return { id: (created ?? updated)!.id, change };
}

const syncLocalFolderNew: BodyWriter = {
  name: "local files: sync-local-folder-source new file",
  write: async (input) =>
    writeNewPage(
      async () => (await syncFolderFile(`${nextId("new")}.md`, input.body)).id,
    ),
};

const syncLocalFolderChanged: BodyWriter = {
  name: "local files: sync-local-folder-source changed file",
  write: async (input) => {
    const path = `${nextId("changed")}.md`;
    const { id } = await asOwner(() => syncFolderFile(path, EXISTING_BODY));
    return writeExistingPage(id, async () => {
      const { change } = await syncFolderFile(path, input.body);
      if (change !== "updated")
        throw new Error(`Syncing a changed ${path} ${change} a page.`);
    });
  },
};

/** Sets a Collection row's primary Blocks property, which is its page body. */
const setDocumentProperty: BodyWriter = {
  name: "set-document-property primary Blocks field",
  write: async (input) => {
    const action = (await import("../actions/set-document-property.js"))
      .default;
    const { seedDefaultBlocksField } =
      await import("../actions/_property-utils.js");
    const { getDb, schema } = await app();
    const now = new Date().toISOString();
    const databaseId = nextId("collection");
    const databasePageId = await seedPage("collection-page", "");
    await getDb().insert(schema.contentDatabases).values({
      id: databaseId,
      ownerEmail: WRITER_OWNER,
      documentId: databasePageId,
      title: "Stored form collection",
      createdAt: now,
      updatedAt: now,
    });
    const propertyId = await seedDefaultBlocksField({
      databaseId,
      ownerEmail: WRITER_OWNER,
      orgId: null,
      now,
    });
    if (!propertyId)
      throw new Error(`No primary Blocks field was seeded for ${databaseId}.`);
    const rowId = await seedPage("collection-row", EXISTING_BODY);
    await getDb()
      .insert(schema.contentDatabaseItems)
      .values({
        id: nextId("collection-item"),
        ownerEmail: WRITER_OWNER,
        databaseId,
        documentId: rowId,
        position: 0,
        createdAt: now,
        updatedAt: now,
      });
    return writeExistingPage(rowId, () =>
      action.run({
        documentId: rowId,
        databaseId,
        propertyId,
        value: input.body,
      }),
    );
  },
};

const duplicatePage: BodyWriter = {
  name: "duplicate-page",
  write: async (input) => {
    const action = (await import("../actions/duplicate-page.js")).default;
    const sourceId = await seedPage("duplicate-source", input.body);
    return writeNewPage(
      async () => (await action.run({ documentId: sourceId }, browserCtx)).id,
    );
  },
};

const ALT_TEXT_IMAGE = "/uploads/stored-form-diagram.png";

/**
 * Sets the alt text of an image that follows the input body. The alt text has
 * a bare dollar sign, which the stored form escapes inside alt text too.
 */
const setImageAltText: BodyWriter = {
  name: "set-image-alt-text",
  write: async (input) => {
    const action = (await import("../actions/set-image-alt-text.js")).default;
    const id = await seedPage(
      "alt-text",
      `${input.body}\n![](${ALT_TEXT_IMAGE})`,
    );
    return writeExistingPage(id, () =>
      action.run(
        {
          documentId: id,
          imageUrl: ALT_TEXT_IMAGE,
          altText: "Price chart for the $60 plan",
        },
        agentCtx,
      ),
    );
  },
};

/** Every writer in the map a PGlite test can drive, in map order. */
export const BODY_WRITERS: readonly BodyWriter[] = [
  createDocument,
  editDocumentInitialize,
  editDocumentReplace,
  editDocumentUnrevisioned,
  updateDocumentBrowser,
  restoreDocumentVersion,
  importContent,
  undoContentImport,
  importContentSourceNew,
  importContentSourceExisting,
  syncLocalFolderNew,
  syncLocalFolderChanged,
  setDocumentProperty,
  duplicatePage,
  setImageAltText,
];

export const UNDRIVEN_WRITERS: readonly UndrivenWriter[] = [
  {
    name: "Notion pull-notion-page",
    missing:
      "a PGlite fixture that stubs the Notion API and the caller's Notion OAuth token; the L3 change that moves this writer onto the stored form adds it",
  },
  {
    name: "Builder pull-builder-doc and process-builder-body-hydration",
    missing:
      "a PGlite fixture that stubs Builder's CMS and the Builder private key; the L3 change that moves this writer onto the stored form adds it",
  },
  {
    name: "transcribe-media",
    missing:
      "a PGlite fixture that stubs media fetch, ffmpeg and the transcription provider; the L3 change that moves this writer onto the stored form adds it",
  },
];
