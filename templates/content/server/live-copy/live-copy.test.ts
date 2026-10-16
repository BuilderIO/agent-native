import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec, type DbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import { asc, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as Y from "yjs";

import { createContentEditorStructuralSchema } from "../../shared/content-editor-structural-schema.js";
import * as nfm from "../../shared/nfm.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-live-copy-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "live-copy-owner@example.com";
const OTHER = "live-copy-collaborator@example.com";
const SHADOW = "feature-flag:content.live-body-shadow";
const WRITER = "feature-flag:content.live-body-writer";

let getDb: typeof import("../db/index.js").getDb;
let schema: typeof import("../db/schema.js");
let collab: typeof import("@agent-native/core/collab");
let binding: typeof import("./binding.js");
let persist: typeof import("./persist.js");
let switching: typeof import("./switch.js");
let cause: typeof import("./write-cause.js");
let execDb: typeof import("./exec-db.js");
let writer: typeof import("./write.js");
const editorSchema = createContentEditorStructuralSchema();

function rules(emails: string[]) {
  return {
    version: 1,
    mode: "rules",
    emails,
    orgIds: [],
    percentage: 0,
    updatedAt: null,
    updatedBy: null,
  };
}

async function setFlags(on: boolean) {
  await putSetting(SHADOW, rules(on ? [OWNER] : []));
  await putSetting(WRITER, rules(on ? [OWNER] : []));
}

async function insertPage(id: string, content: string) {
  const now = new Date(Date.now() - 60_000).toISOString();
  await getDb().insert(schema.documents).values({
    id,
    ownerEmail: OWNER,
    title: id,
    content,
    bodyRevision: 3,
    collabBodyRevision: null,
    createdAt: now,
    updatedAt: now,
  });
}

async function page(id: string) {
  const [row] = await getDb()
    .select({
      content: schema.documents.content,
      bodyRevision: schema.documents.bodyRevision,
      collabBodyRevision: schema.documents.collabBodyRevision,
      liveBodySwitchedAt: schema.documents.liveBodySwitchedAt,
      liveCopyVersion: schema.documents.liveCopyVersion,
      updatedBy: schema.documents.updatedBy,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row;
}

async function gateFor(id: string) {
  const { liveBodyWriterGate } = await import("../lib/live-body-writer.js");
  return liveBodyWriterGate(id);
}

async function bodyIntents(id: string) {
  return getDb()
    .select({
      operationId: schema.documentBodyIntents.operationId,
      authoredBaseRevision: schema.documentBodyIntents.authoredBaseRevision,
      committedRevision: schema.documentBodyIntents.committedRevision,
      canonicalChanged: schema.documentBodyIntents.canonicalChanged,
    })
    .from(schema.documentBodyIntents)
    .where(eq(schema.documentBodyIntents.documentId, id));
}

/** Turns the page's flags off once the worker has built the edit. */
function flagsOffAfterBuild() {
  const runner = binding.contentLiveCopy.runner;
  const run = runner.run.bind(runner);
  return vi.spyOn(runner, "run").mockImplementation(async (...args) => {
    const result = await run(...args);
    await setFlags(false);
    return result;
  });
}

/**
 * Once the worker has built the first edit, another server commits `content`
 * to the page: the live copy and the page row move together, outside this
 * process's per-document queue.
 */
function peerCommitsAfterBuild(id: string, content: string) {
  const runner = binding.contentLiveCopy.runner;
  const run = runner.run.bind(runner);
  let committed = false;
  return vi
    .spyOn(runner, "run")
    .mockImplementation(async (task, input, ...rest) => {
      const result = await run(task, input, ...rest);
      if (committed || task !== "liveCopy.edit") return result;
      committed = true;
      const peer = (await run(
        task,
        { ...(input as object), input: { content } },
        ...rest,
      )) as { state?: Uint8Array; text?: string };
      await inTransaction(async (tx) => {
        // A peer update that leaves the body as it was still moves the version.
        await tx.execute(
          peer.state
            ? {
                sql: "UPDATE _collab_docs SET yjs_state = ?, text_snapshot = ?, version = version + 1 WHERE doc_id = ?",
                args: [collab.uint8ArrayToBase64(peer.state), peer.text, id],
              }
            : {
                sql: "UPDATE _collab_docs SET version = version + 1 WHERE doc_id = ?",
                args: [id],
              },
        );
        await tx.execute({
          sql: "UPDATE documents SET content = COALESCE(?, content), body_revision = body_revision + 1, collab_body_revision = body_revision + 1, live_copy_version = live_copy_version + 1 WHERE id = ?",
          args: [peer.text ?? null, id],
        });
      });
      return result;
    });
}

async function history(id: string) {
  return getDb()
    .select({
      operation: schema.documentVersions.operation,
      content: schema.documentVersions.content,
      bodyRevision: schema.documentVersions.bodyRevision,
      groupKind: schema.documentVersions.groupKind,
      checkpointKind: schema.documentVersions.checkpointKind,
      actorEmail: schema.documentVersions.actorEmail,
    })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id))
    .orderBy(
      asc(schema.documentVersions.createdAt),
      asc(schema.documentVersions.id),
    );
}

async function collabVersion(id: string): Promise<number | undefined> {
  const { rows } = await getDbExec().execute({
    sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
    args: [id],
  });
  const row = rows[0] as { version: number | string } | undefined;
  return row === undefined ? undefined : Number(row.version);
}

/** A client that synced the live copy appends one paragraph. */
async function appendParagraphUpdate(id: string, text: string) {
  const live = await collab.readLiveCopy(binding.contentLiveCopy, id);
  if (live.kind !== "live") throw new Error(`${id} is ${live.kind}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, live.state);
  const before = Y.encodeStateVector(doc);
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  const fragment = doc.getXmlFragment("default");
  fragment.insert(fragment.length, [paragraph]);
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

/** What an editor synced to the live copy sends after its doc becomes `blocks`. */
async function editorUpdate(id: string, blocks: unknown[]) {
  const live = await collab.readLiveCopy(binding.contentLiveCopy, id);
  if (live.kind !== "live") throw new Error(`${id} is ${live.kind}`);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, live.state);
  const before = Y.encodeStateVector(doc);
  const fragment = doc.getXmlFragment("default");
  const { meta } = initProseMirrorDoc(fragment, editorSchema);
  const root = editorSchema.nodeFromJSON({ type: "doc", content: blocks });
  updateYFragment(doc, fragment, root, meta);
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

function markdownBlocks(markdown: string) {
  return nfm.nfmToDoc(markdown).content ?? [];
}

/** Runs `run`, recording the longest stretch this thread could not tick. */
async function longestStall(run: () => Promise<unknown>) {
  let last = performance.now();
  let stall = 0;
  const timer = setInterval(() => {
    const now = performance.now();
    stall = Math.max(stall, now - last);
    last = now;
  }, 10);
  try {
    const outcome = await run().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    return { ...outcome, stall: Math.max(stall, performance.now() - last) };
  } finally {
    clearInterval(timer);
  }
}

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

function inTransaction<T>(run: (tx: DbExec) => Promise<T>): Promise<T> {
  const exec = getDbExec();
  if (!exec.transaction)
    throw new Error("The test database has no transactions.");
  return exec.transaction(run);
}

async function switchedPage(id: string, content: string) {
  await insertPage(id, content);
  await expect(switching.switchPageToLiveCopy(id)).resolves.toEqual({
    writePath: "live_copy",
  });
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  const plugin = (await import("../plugins/db.js")).default;
  await plugin(undefined as never);
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  const { CONTENT_FEATURE_FLAGS } =
    await import("../../shared/feature-flags.js");
  registerFeatureFlags(CONTENT_FEATURE_FLAGS);
  collab = await import("@agent-native/core/collab");
  binding = await import("./binding.js");
  persist = await import("./persist.js");
  switching = await import("./switch.js");
  cause = await import("./write-cause.js");
  execDb = await import("./exec-db.js");
  writer = await import("./write.js");
}, 60_000);

beforeEach(async () => {
  await getDb().delete(schema.documents);
  await getDb().delete(schema.documentVersions);
  await getDb().delete(schema.contentDatabaseItems);
  await getDb().delete(schema.contentDatabases);
  await getDbExec()
    .execute("DELETE FROM _collab_docs")
    .catch((error) => {
      // The first test runs before core creates the table.
      if (!/_collab_docs" does not exist/.test(String(error))) throw error;
    });
  await getDb().delete(schema.documentBodyIntents);
  await setFlags(true);
});

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("switching a page to its live copy", () => {
  it("seeds the live copy from the stored body and marks the page switched in one commit", async () => {
    await switchedPage("seeded", "Hello there");

    const row = await page("seeded");
    expect(row.content).toBe("Hello there");
    expect(row.bodyRevision).toBe(3);
    expect(row.collabBodyRevision).toBe(3);
    expect(row.liveCopyVersion).toBe(await collabVersion("seeded"));
    expect(row.liveBodySwitchedAt).not.toBeNull();
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "seeded"),
    ).resolves.toMatchObject({ kind: "live", text: "Hello there" });
  });

  it("refuses with flag_off and leaves the page and its collab state alone", async () => {
    await setFlags(false);
    await insertPage("off", "Hello there");

    await expect(switching.switchPageToLiveCopy("off")).rejects.toMatchObject({
      name: "LiveBodyConversionError",
      code: "flag_off",
    });
    expect((await page("off")).liveBodySwitchedAt).toBeNull();
    expect(await collabVersion("off")).toBeUndefined();
  });

  it("converts again after a legacy write, and the stored body wins over the stale copy", async () => {
    await switchedPage("reconvert", "Hello there");
    await expect(switching.switchPageToLegacy("reconvert")).resolves.toEqual({
      writePath: "legacy",
      reason: "not_switched",
    });
    // A legacy writer moves the body; the live copy never sees it.
    await getDb()
      .update(schema.documents)
      .set({ content: "Written while legacy", bodyRevision: 4 })
      .where(eq(schema.documents.id, "reconvert"));

    await expect(switching.switchPageToLiveCopy("reconvert")).resolves.toEqual({
      writePath: "live_copy",
    });
    const row = await page("reconvert");
    expect(row.content).toBe("Written while legacy");
    expect(row.bodyRevision).toBe(4);
    expect(row.collabBodyRevision).toBe(4);
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "reconvert"),
    ).resolves.toMatchObject({ text: "Written while legacy" });
  });

  it("switches a page whose live copy already holds its body without committing a new copy", async () => {
    await switchedPage("unchanged", "Hello there");
    const version = await collabVersion("unchanged");
    await switching.switchPageToLegacy("unchanged");

    await expect(switching.switchPageToLiveCopy("unchanged")).resolves.toEqual({
      writePath: "live_copy",
    });
    expect(await collabVersion("unchanged")).toBe(version);
    const row = await page("unchanged");
    expect(row.liveBodySwitchedAt).not.toBeNull();
    expect(row.collabBodyRevision).toBe(row.bodyRevision);
  });

  it("refuses a conversion whose base revision moved", async () => {
    await insertPage("moved", "Hello there");
    await expect(
      inTransaction((tx) =>
        persist.persistLiveBodyConversion(
          tx,
          { documentId: "moved", baseRevision: 2 },
          "Hello there",
          1,
        ),
      ),
    ).rejects.toMatchObject({ code: "base_changed" });
    expect((await page("moved")).liveBodySwitchedAt).toBeNull();
  });
});

describe("writes through a switched page's live copy", () => {
  it("derives the page, its revision and History from a server edit, in the commit", async () => {
    await switchedPage("server", "Hello there");
    let readBack: unknown;

    const result = await cause.withContentBodyWriteCause(
      { operation: "test-replace", origin: "test" },
      () =>
        collab.mutateLiveCopy(binding.contentLiveCopy, "server", {
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "Hello again" },
          persist: async (tx) => {
            readBack = persist.persistedContentBodyCommit(tx);
          },
        }),
    );

    expect(result).toMatchObject({ changed: true, liveCopy: "derived" });
    const row = await page("server");
    expect(row).toMatchObject({
      content: "Hello again",
      bodyRevision: 4,
      collabBodyRevision: 4,
    });
    expect(readBack).toMatchObject({
      before: "Hello there",
      after: "Hello again",
      bodyRevision: 4,
      softDeletedDatabaseIds: [],
    });
    const rows = await history("server");
    expect(rows[rows.length - 1]).toMatchObject({
      operation: "test-replace",
      content: "Hello again",
      bodyRevision: 4,
    });
  });

  it("refuses a replace whose expected body is stale, and commits nothing", async () => {
    await switchedPage("stale", "Hello there");
    const version = await collabVersion("stale");

    await expect(
      cause.withContentBodyWriteCause({ operation: "test-replace" }, () =>
        collab.mutateLiveCopy(binding.contentLiveCopy, "stale", {
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "Hello again", expected: "Not the body" },
        }),
      ),
    ).rejects.toMatchObject({ name: "LiveCopyError", reason: "base_changed" });
    expect(await collabVersion("stale")).toBe(version);
    expect((await page("stale")).content).toBe("Hello there");
  });

  it("refuses a server edit with no cause, so no write skips History", async () => {
    await switchedPage("uncaused", "Hello there");

    await expect(
      collab.mutateLiveCopy(binding.contentLiveCopy, "uncaused", {
        edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
        input: { content: "Hello again" },
      }),
    ).rejects.toThrow(/has no cause/);
    expect((await page("uncaused")).content).toBe("Hello there");
  });

  it("derives the page from editor updates and keeps one History row per typing interval, holding its last state", async () => {
    await switchedPage("editor", "Hello there");
    const type = (email: string, text: string) =>
      runWithRequestContext({ userEmail: email }, async () =>
        collab.applyUpdate(
          "editor",
          await appendParagraphUpdate("editor", text),
        ),
      );

    await expect(type(OWNER, "A")).resolves.toEqual({ liveCopy: "derived" });
    await expect(type(OWNER, "B")).resolves.toEqual({ liveCopy: "derived" });

    const row = await page("editor");
    expect(row).toMatchObject({
      content: "Hello there\nA\nB",
      bodyRevision: 5,
      collabBodyRevision: 5,
      liveCopyVersion: await collabVersion("editor"),
    });
    // B landed inside A's interval: one row, now holding B.
    let live = (await history("editor")).filter(
      (r) => r.operation === "live-copy-update",
    );
    expect(live).toEqual([
      expect.objectContaining({
        checkpointKind: "before",
        content: "Hello there",
        actorEmail: OWNER,
      }),
      expect.objectContaining({
        checkpointKind: "after",
        content: "Hello there\nA\nB",
        bodyRevision: 5,
        groupKind: "human_session",
        actorEmail: OWNER,
      }),
    ]);

    // Past the interval, the session gets a new row and the old one keeps B.
    const rows = await getDb()
      .select({
        id: schema.documentVersions.id,
        createdAt: schema.documentVersions.createdAt,
      })
      .from(schema.documentVersions)
      .where(eq(schema.documentVersions.documentId, "editor"));
    for (const row of rows) {
      const earlier = new Date(Date.parse(row.createdAt) - 3_000).toISOString();
      await getDb()
        .update(schema.documentVersions)
        .set({ createdAt: earlier, updatedAt: earlier })
        .where(eq(schema.documentVersions.id, row.id));
    }
    await type(OWNER, "C");
    // Another collaborator starts their own session; B and C stay the owner's.
    await type(OTHER, "D");

    live = (await history("editor")).filter(
      (r) => r.operation === "live-copy-update",
    );
    expect(
      live.map((r) => [r.checkpointKind, r.actorEmail, r.content]),
    ).toEqual([
      ["before", OWNER, "Hello there"],
      ["after", OWNER, "Hello there\nA\nB"],
      ["after", OWNER, "Hello there\nA\nB\nC"],
      ["after", OTHER, "Hello there\nA\nB\nC\nD"],
    ]);
  });

  it("leaves a page that went back to its legacy writer alone, under the page lock", async () => {
    await switchedPage("recheck", "Hello there");
    await setFlags(false);
    const version = (await collabVersion("recheck")) as number;

    const outcome = await inTransaction((tx) =>
      persist.persistContentLiveCopy(tx, {
        docId: "recheck",
        origin: "update",
        previousVersion: version,
        version: version + 1,
        text: "Hello again",
        state: new Uint8Array(),
      }),
    );

    expect(outcome).toEqual({ derived: false, reason: "flag_off" });
    expect((await page("recheck")).content).toBe("Hello there");
  });

  it("refuses an editor update to a switched page in Trash, and commits nothing", async () => {
    await switchedPage("trashed", "Hello there");
    const update = await appendParagraphUpdate("trashed", "A");
    const version = await collabVersion("trashed");
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, "trashed"));

    await expect(
      asOwner(() => collab.applyUpdate("trashed", update)),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_NOT_FOUND" });
    expect((await page("trashed")).content).toBe("Hello there");
    expect(await collabVersion("trashed")).toBe(version);
  });

  it("locks collections, then memberships, then the page, and trashes an inline collection the body dropped", async () => {
    await switchedPage("ordered", "Hello there");
    await getDb().insert(schema.documents).values({
      id: "ordered-inline",
      ownerEmail: OWNER,
      parentId: "ordered",
      title: "Inline",
      content: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await getDb()
      .insert(schema.contentDatabases)
      .values([
        // The collection this page backs, and one inline in its body.
        { id: "db-b-backing", ownerEmail: OWNER, documentId: "ordered" },
        {
          id: "db-a-inline",
          ownerEmail: OWNER,
          documentId: "ordered-inline",
          ownerDocumentId: "ordered",
          ownerBlockId: "inline-block",
        },
        { id: "db-c-parent", ownerEmail: OWNER, documentId: "elsewhere" },
      ]);
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "ordered-row",
      ownerEmail: OWNER,
      databaseId: "db-c-parent",
      documentId: "ordered",
    });
    const locks: string[] = [];
    const lockedTable = (statement: string) => {
      const lower = statement.toLowerCase();
      const update = /^\s*update "([^"]+)"/.exec(lower);
      if (update) return update[1];
      if (!/ for update/.test(lower)) return undefined;
      return (/ for update of "([^"]+)"/.exec(lower) ??
        / from "([^"]+)"/.exec(lower))?.[1];
    };

    const version = (await collabVersion("ordered")) as number;

    const softDeleted = await cause.withContentBodyWriteCause(
      { operation: "test-order" },
      () =>
        inTransaction(async (tx) => {
          const spy: DbExec = {
            execute(input) {
              const table = lockedTable(
                typeof input === "string" ? input : input.sql,
              );
              if (table) locks.push(table);
              return tx.execute(input);
            },
          } as DbExec;
          await persist.persistContentLiveCopy(spy, {
            docId: "ordered",
            origin: "mutation",
            previousVersion: version,
            version: version + 1,
            text: "Hello again",
            state: new Uint8Array(),
          });
          return persist.persistedContentBodyCommit(spy)
            ?.softDeletedDatabaseIds;
        }),
    );

    // After the page lock, only writes to rows already locked.
    expect(locks).toEqual([
      "content_databases",
      "content_database_items",
      "documents",
      "documents",
      "content_databases",
    ]);
    expect(softDeleted).toEqual(["db-a-inline"]);
  });

  it("locks the page in Content's order from an unchanged edit's own persist, and refuses it in Trash", async () => {
    await switchedPage("unchanged", "Hello there");
    await getDb().insert(schema.contentDatabases).values({
      id: "db-unchanged-parent",
      ownerEmail: OWNER,
      documentId: "elsewhere",
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "unchanged-row",
      ownerEmail: OWNER,
      databaseId: "db-unchanged-parent",
      documentId: "unchanged",
    });
    const statements: string[] = [];
    const unchangedEdit = () =>
      cause.withContentBodyWriteCause({ operation: "test-unchanged" }, () =>
        collab.mutateLiveCopy(binding.contentLiveCopy, "unchanged", {
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "Hello there" },
          persist: async (tx, change) => {
            expect(change.changed).toBe(false);
            const spy: DbExec = {
              execute(input) {
                statements.push(
                  (typeof input === "string" ? input : input.sql).toLowerCase(),
                );
                return tx.execute(input);
              },
            } as DbExec;
            const locked = await persist.lockLiveCopyPage(spy, "unchanged");
            expect(locked?.page.content).toBe("Hello there");
          },
        }),
      );

    await expect(unchangedEdit()).resolves.toMatchObject({
      changed: false,
      liveCopy: "unchanged",
    });
    const locks = statements
      .filter((sql) => / for update|^\s*update /.test(sql))
      .map(
        (sql) =>
          (/^\s*update "([^"]+)"/.exec(sql) ??
            / for update of "([^"]+)"/.exec(sql) ??
            / from "([^"]+)"/.exec(sql))?.[1],
      );
    expect(locks).toEqual([
      "content_databases",
      "content_database_items",
      "documents",
    ]);

    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, "unchanged"));
    await expect(unchangedEdit()).rejects.toMatchObject({
      errorCode: "DOCUMENT_NOT_FOUND",
    });
  });

  it("refuses a body write when the page joined a collection after its memberships were locked", async () => {
    await switchedPage("joined", "Hello there");
    await getDb().insert(schema.contentDatabases).values({
      id: "db-joined-parent",
      ownerEmail: OWNER,
      documentId: "elsewhere",
    });
    const version = (await collabVersion("joined")) as number;

    await expect(
      cause.withContentBodyWriteCause({ operation: "test-joined" }, () =>
        inTransaction(async (tx) => {
          let joined = false;
          const spy: DbExec = {
            async execute(input) {
              const sql = (
                typeof input === "string" ? input : input.sql
              ).toLowerCase();
              // The page joins between the membership lock and the page lock.
              if (!joined && /from "documents" .* for update/.test(sql)) {
                joined = true;
                await execDb
                  .drizzleOverExec(tx)
                  .insert(schema.contentDatabaseItems)
                  .values({
                    id: "joined-row",
                    ownerEmail: OWNER,
                    databaseId: "db-joined-parent",
                    documentId: "joined",
                  });
              }
              return tx.execute(input);
            },
          } as DbExec;
          await persist.persistContentLiveCopy(spy, {
            docId: "joined",
            origin: "mutation",
            previousVersion: version,
            version: version + 1,
            text: "Hello again",
            state: new Uint8Array(),
          });
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED" });
    expect((await page("joined")).content).toBe("Hello there");
  });
});

describe("a page whose write path changes mid-write", () => {
  it("refuses a server edit whose page left its live copy after the edit was built, and commits nothing", async () => {
    await switchedPage("server-flip", "Before");
    const version = await collabVersion("server-flip");
    const spy = flagsOffAfterBuild();
    try {
      await expect(
        writer.editContentLiveCopy("server-flip", {
          cause: { operation: "test-flip" },
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "After", expected: "Before" },
        }),
      ).rejects.toMatchObject({
        errorCode: "LIVE_BODY_WRITE_PATH_CHANGED",
        details: { documentId: "server-flip", reason: "flag_off" },
      });
    } finally {
      spy.mockRestore();
    }

    expect(await collabVersion("server-flip")).toBe(version);
    expect((await page("server-flip")).content).toBe("Before");
    await setFlags(true);
    await expect(gateFor("server-flip")).resolves.toEqual({
      writePath: "live_copy",
    });
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "server-flip"),
    ).resolves.toMatchObject({ text: "Before" });
  });

  it("keeps a page legacy after an editor update commits while its flags turn off, until it is converted again", async () => {
    await switchedPage("editor-flip", "Before");
    const update = await appendParagraphUpdate("editor-flip", "Typed");
    const spy = flagsOffAfterBuild();
    try {
      await expect(
        asOwner(() => collab.applyUpdate("editor-flip", update)),
      ).resolves.toEqual({
        liveCopy: "not_derived",
        liveCopyReason: "flag_off",
      });
    } finally {
      spy.mockRestore();
    }
    // The update committed to Yjs, as on main; the stored body did not move.
    expect(await page("editor-flip")).toMatchObject({
      content: "Before",
      bodyRevision: 3,
      collabBodyRevision: 3,
    });

    await setFlags(true);
    await expect(gateFor("editor-flip")).resolves.toEqual({
      writePath: "legacy",
      reason: "stored_body_behind",
    });
    await expect(
      switching.switchPageToLiveCopy("editor-flip"),
    ).resolves.toEqual({ writePath: "live_copy" });
    // The stored body wins, and the two agree again.
    expect((await page("editor-flip")).content).toBe("Before");
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "editor-flip"),
    ).resolves.toMatchObject({ text: "Before" });
  });

  it("keeps a page legacy after an editor update takes main's path while its flags are off", async () => {
    await switchedPage("main-path", "Before");
    const update = await appendParagraphUpdate("main-path", "Typed");
    await setFlags(false);

    await expect(
      asOwner(() => collab.applyUpdate("main-path", update)),
    ).resolves.toEqual({
      liveCopy: "not_derived",
      liveCopyReason: "not_live_copy",
    });
    expect((await page("main-path")).content).toBe("Before");

    await setFlags(true);
    await expect(gateFor("main-path")).resolves.toEqual({
      writePath: "legacy",
      reason: "stored_body_behind",
    });
  });

  it("keeps a page on its live copy when another server commits between the gate's reads", async () => {
    const { liveBodyWriterGate } = await import("../lib/live-body-writer.js");
    await switchedPage("torn", "Hello there");
    // Another server's commit moves the page's markers and its collab doc's
    // version in one transaction, right after the gate reads the page row.
    const peerCommit = () =>
      inTransaction(async (tx) => {
        await tx.execute({
          sql: "UPDATE _collab_docs SET version = version + 1 WHERE doc_id = ?",
          args: ["torn"],
        });
        await tx.execute({
          sql: "UPDATE documents SET body_revision = body_revision + 1, collab_body_revision = body_revision + 1, live_copy_version = live_copy_version + 1 WHERE id = ?",
          args: ["torn"],
        });
      });
    const db = getDb();
    let reads = 0;
    const racing = {
      select: (fields: never) => ({
        from: (table: never) => ({
          where: (where: never) => ({
            limit: async (count: number) => {
              const rows = await db
                .select(fields)
                .from(table)
                .where(where)
                .limit(count);
              if (++reads === 1) await peerCommit();
              return rows;
            },
          }),
        }),
      }),
    } as unknown as NonNullable<Parameters<typeof liveBodyWriterGate>[1]>["db"];

    await expect(liveBodyWriterGate("torn", { db: racing })).resolves.toEqual({
      writePath: "live_copy",
    });
    await expect(gateFor("torn")).resolves.toEqual({ writePath: "live_copy" });
  });
});

describe("server writers through editContentLiveCopy", () => {
  const intent = (operationId: string, authoredBaseRevision?: number) => ({
    intent: {
      writerId: "test-writer",
      operationId,
      ...(authoredBaseRevision === undefined ? {} : { authoredBaseRevision }),
    },
    candidateHash: `hash-${operationId}`,
    changedBlockIndexes: [0],
  });

  it("records a changed edit's intent at the committed revision, based on the revision it was applied to", async () => {
    await switchedPage("intent", "Before");

    await writer.editContentLiveCopy("intent", {
      cause: { operation: "test-intent", intent: intent("op-changed") },
      edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: { content: "After", expected: "Before" },
    });

    expect(await bodyIntents("intent")).toEqual([
      {
        operationId: "op-changed",
        authoredBaseRevision: 3,
        committedRevision: 4,
        canonicalChanged: true,
      },
    ]);
  });

  it("records an unchanged edit's intent too, which core's binding persist never sees", async () => {
    await switchedPage("intent-same", "Same");
    const version = await collabVersion("intent-same");

    const result = await writer.editContentLiveCopy("intent-same", {
      cause: { operation: "test-intent", intent: intent("op-same", 2) },
      edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: { content: "Same", expected: "Same" },
    });

    expect(result).toMatchObject({ changed: false, liveCopy: "unchanged" });
    expect(await collabVersion("intent-same")).toBe(version);
    expect(await bodyIntents("intent-same")).toEqual([
      {
        operationId: "op-same",
        authoredBaseRevision: 2,
        committedRevision: 3,
        canonicalChanged: false,
      },
    ]);
  });

  for (const unchanged of [false, true]) {
    it(`retries ${unchanged ? "an unchanged" : "a changed"} edit a peer's commit overtook, rather than refusing it`, async () => {
      await switchedPage("overtaken", "Same");
      // The peer's commit leaves the body the edit was built from.
      const spy = peerCommitsAfterBuild("overtaken", "Same");
      try {
        await expect(
          writer.editContentLiveCopy("overtaken", {
            cause: { operation: "test-overtaken", intent: intent("op-mine") },
            edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
            input: { content: unchanged ? "Same" : "Mine", expected: "Same" },
          }),
        ).resolves.toMatchObject({
          attempts: 2,
          liveCopy: unchanged ? "unchanged" : "derived",
        });
      } finally {
        spy.mockRestore();
      }

      // An unchanged edit commits nothing past the peer's revision.
      const revision = unchanged ? 4 : 5;
      const row = await page("overtaken");
      expect(row).toMatchObject({
        content: unchanged ? "Same" : "Mine",
        bodyRevision: revision,
        collabBodyRevision: revision,
        liveCopyVersion: await collabVersion("overtaken"),
      });
      expect(await bodyIntents("overtaken")).toEqual([
        expect.objectContaining({
          operationId: "op-mine",
          authoredBaseRevision: 4,
          committedRevision: revision,
        }),
      ]);
      await expect(gateFor("overtaken")).resolves.toEqual({
        writePath: "live_copy",
      });
    });
  }

  it("refuses a replace whose base a peer's commit changed, and keeps the peer's text", async () => {
    await switchedPage("overtaken-changed", "Same");
    const spy = peerCommitsAfterBuild("overtaken-changed", "Peer");
    try {
      await expect(
        writer.editContentLiveCopy("overtaken-changed", {
          cause: { operation: "test-overtaken", intent: intent("op-mine") },
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "Mine", expected: "Same" },
        }),
      ).rejects.toMatchObject({
        name: "LiveCopyError",
        reason: "base_changed",
      });
    } finally {
      spy.mockRestore();
    }

    expect((await page("overtaken-changed")).content).toBe("Peer");
    expect(await bodyIntents("overtaken-changed")).toEqual([]);
    await expect(gateFor("overtaken-changed")).resolves.toEqual({
      writePath: "live_copy",
    });
  });

  it("refuses a replace that names no base body before it reaches the live copy", async () => {
    await switchedPage("no-base", "Before");
    const version = await collabVersion("no-base");

    await expect(
      writer.editContentLiveCopy("no-base", {
        cause: { operation: "test-no-base" },
        edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
        input: { content: "After" } as never,
      }),
    ).rejects.toThrow(/must name the body it was built from/);
    expect(await collabVersion("no-base")).toBe(version);
    expect((await page("no-base")).content).toBe("Before");
  });

  it("takes an intent's hash and changed blocks from the commit when the writer leaves them out", async () => {
    await switchedPage("derived-intent", "First\n\nSecond");
    const { documentContentHash } =
      await import("../../actions/_document-edit-mutation.js");

    await writer.editContentLiveCopy("derived-intent", {
      cause: {
        operation: "test-intent",
        intent: {
          intent: { writerId: "test-writer", operationId: "op-derived" },
        },
      },
      edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: {
        content: "First\n\nChanged",
        expected: (await page("derived-intent")).content,
      },
    });

    const { content } = await page("derived-intent");
    const [row] = await getDb()
      .select({
        candidateHash: schema.documentBodyIntents.candidateHash,
        affected: schema.documentBodyIntents.affectedBlockIndexesJson,
        canonicalChanged: schema.documentBodyIntents.canonicalChanged,
      })
      .from(schema.documentBodyIntents)
      .where(eq(schema.documentBodyIntents.documentId, "derived-intent"));
    expect(row).toEqual({
      candidateHash: documentContentHash(content),
      affected: "[1]",
      canonicalChanged: true,
    });
  });

  it("refuses an unchanged edit to a page that left its live copy after the edit was built", async () => {
    await switchedPage("same-flip", "Same");
    const spy = flagsOffAfterBuild();
    try {
      await expect(
        writer.editContentLiveCopy("same-flip", {
          cause: { operation: "test-intent", intent: intent("op-flip") },
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "Same", expected: "Same" },
        }),
      ).rejects.toMatchObject({
        errorCode: "LIVE_BODY_WRITE_PATH_CHANGED",
        details: { reason: "flag_off" },
      });
    } finally {
      spy.mockRestore();
    }
    expect(await bodyIntents("same-flip")).toEqual([]);
  });

  it("names the request's user in History when the cause carries no action context, as attribution does", async () => {
    await switchedPage("actor", "Before");

    await asOwner(() =>
      writer.editContentLiveCopy("actor", {
        cause: { operation: "test-actor" },
        edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
        input: { content: "After", expected: "Before" },
      }),
    );

    expect((await page("actor")).updatedBy).toBe(OWNER);
    const rows = (await history("actor")).filter(
      (row) => row.operation === "test-actor",
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.map((row) => row.actorEmail)).toEqual(rows.map(() => OWNER));
  });
});

describe("a browser save to a switched page's body", () => {
  /** What a tab that loaded `base` and typed `candidate` sends. */
  async function browserSave(
    id: string,
    base: { bodyRevision: number; content: string },
    candidate: string,
    extra: Record<string, unknown> = {},
  ) {
    const action = (await import("../../actions/update-document.js")).default;
    const { documentRevisionToken } =
      await import("../../actions/_document-edit-mutation.js");
    const revision = documentRevisionToken(base.bodyRevision, base.content);
    return asOwner(async () =>
      action.run(
        {
          id,
          content: candidate,
          baseRevision: revision,
          authoredBaseRevision: revision,
          authoredBaseContent: base.content,
          authoredCandidateContent: candidate,
          editorSessionId: "tab-a",
          editorEditGeneration: 1,
          browserSaveAttemptId: `${id}-attempt`,
          ...extra,
        } as never,
        { caller: "frontend", userEmail: OWNER } as never,
      ),
    );
  }

  async function receipts(id: string) {
    return getDb()
      .select({ attemptId: schema.documentBrowserSaveAttempts.attemptId })
      .from(schema.documentBrowserSaveAttempts)
      .where(eq(schema.documentBrowserSaveAttempts.documentId, id));
  }

  /** The recovery draft tab-a keeps on the server for `content`. */
  async function keepDraft(id: string, content: string) {
    await getDb()
      .insert(schema.documentPreviewDrafts)
      .values({
        id: `${id}-draft`,
        ownerEmail: OWNER,
        documentId: id,
        title: id,
        content,
        editorSessionId: "tab-a",
        editGeneration: 1,
      });
  }

  async function drafts(id: string) {
    return getDb()
      .select({ content: schema.documentPreviewDrafts.content })
      .from(schema.documentPreviewDrafts)
      .where(eq(schema.documentPreviewDrafts.documentId, id));
  }

  /** Another tab rewrites the page's one paragraph, keeping its structure. */
  async function typeInOtherTab(id: string, bodies: string[]) {
    for (const body of bodies) {
      await asOwner(async () =>
        collab.applyUpdate(id, await editorUpdate(id, markdownBlocks(body))),
      );
    }
  }

  it("answers a stale tab's body save with the live copy instead of diverting it to History", async () => {
    await switchedPage("two-tabs", "Hello there");
    const loaded = await page("two-tabs");
    // The other tab's commits record no body intents.
    await typeInOtherTab("two-tabs", ["Hello there B1", "Hello there B2"]);
    const before = await page("two-tabs");
    expect(before.bodyRevision).toBe(loaded.bodyRevision + 2);

    const saved = await browserSave("two-tabs", loaded, "Hello there A");

    expect(saved).not.toHaveProperty("preservationRequired");
    expect(saved).not.toHaveProperty("conflict");
    expect(saved).toMatchObject({
      content: "Hello there B2",
      bodySave: {
        status: "live_copy",
        matchesLiveCopy: false,
        bodyRevision: before.bodyRevision,
        collabVersion: await collabVersion("two-tabs"),
      },
    });
    expect(saved).not.toHaveProperty("browserSaveAttempt");
    expect(await page("two-tabs")).toEqual(before);
    expect(
      (await history("two-tabs")).filter((row) =>
        row.operation?.startsWith("update-document"),
      ),
    ).toEqual([]);
    expect(await bodyIntents("two-tabs")).toEqual([]);
    await expect(gateFor("two-tabs")).resolves.toEqual({
      writePath: "live_copy",
    });

    // A retry of a save the live copy does not hold is answered again.
    await expect(
      browserSave("two-tabs", loaded, "Hello there A"),
    ).resolves.toMatchObject({
      bodySave: { status: "live_copy", matchesLiveCopy: false },
    });
    expect(await receipts("two-tabs")).toEqual([]);
  });

  it("settles a tab's draft only once the live copy holds its body", async () => {
    await switchedPage("draft", "Hello there");
    const loaded = await page("draft");
    await keepDraft("draft", "Hello there\nOnly in tab A");
    const snapshot = (content: string) => ({
      editorSnapshotTitle: "draft",
      editorSnapshotContent: content,
    });

    // Tab A's updates never reached the live copy: its draft is the only
    // copy of its text on the server.
    await expect(
      browserSave(
        "draft",
        loaded,
        "Hello there\nOnly in tab A",
        snapshot("Hello there\nOnly in tab A"),
      ),
    ).resolves.toMatchObject({ bodySave: { matchesLiveCopy: false } });
    expect(await drafts("draft")).toEqual([
      { content: "Hello there\nOnly in tab A" },
    ]);
    expect(await receipts("draft")).toEqual([]);

    await expect(
      browserSave("draft", loaded, "Hello there", {
        ...snapshot("Hello there"),
        browserSaveAttemptId: "draft-matched",
      }),
    ).resolves.toMatchObject({
      bodySave: { matchesLiveCopy: true },
      browserSaveAttempt: { result: "live_copy" },
    });
    expect(await drafts("draft")).toEqual([]);
    expect(await receipts("draft")).toEqual([{ attemptId: "draft-matched" }]);
    await expect(
      browserSave("draft", loaded, "Hello there", {
        ...snapshot("Hello there"),
        browserSaveAttemptId: "draft-matched",
      }),
    ).resolves.toMatchObject({
      bodySave: { matchesLiveCopy: true },
      browserSaveAttempt: { result: "replayed" },
    });
  });

  it("applies a save's title and leaves its body to the live copy", async () => {
    await switchedPage("titled", "Hello there");
    const loaded = await page("titled");

    await expect(
      browserSave("titled", loaded, "Hello there", {
        title: "Renamed",
        baseTitle: "titled",
      }),
    ).resolves.toMatchObject({
      title: "Renamed",
      content: "Hello there",
      bodySave: { matchesLiveCopy: true, bodyRevision: loaded.bodyRevision },
    });
    expect(await page("titled")).toMatchObject({
      content: "Hello there",
      bodyRevision: loaded.bodyRevision,
    });
  });

  it("keeps a recovery replay's receipt only for a body the live copy holds", async () => {
    await switchedPage("recovery", "Hello there");
    const loaded = await page("recovery");
    const [{ updatedAt }] = await getDb()
      .select({ updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, "recovery"));

    await expect(
      browserSave("recovery", loaded, "Hello there\nDraft", {
        recoveryExpectedUpdatedAt: updatedAt,
        browserSaveAttemptId: "recovery-unmatched",
      }),
    ).resolves.toMatchObject({
      content: "Hello there",
      bodySave: { matchesLiveCopy: false },
    });
    expect(await receipts("recovery")).toEqual([]);

    await expect(
      browserSave("recovery", loaded, "Hello there", {
        recoveryExpectedUpdatedAt: updatedAt,
        browserSaveAttemptId: "recovery-matched",
        editorEditGeneration: 2,
      }),
    ).resolves.toMatchObject({
      bodySave: { matchesLiveCopy: true },
      browserSaveAttempt: { result: "live_copy" },
    });
    expect(await receipts("recovery")).toEqual([
      { attemptId: "recovery-matched" },
    ]);
  });

  it("leaves a stale empty or Builder-image body to the live copy, and refuses it with the flags off", async () => {
    await switchedPage("stale-empty", "Hello there");
    const empty = await page("stale-empty");
    const [{ updatedAt }] = await getDb()
      .select({ updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(eq(schema.documents.id, "stale-empty"));
    const emptySave = (attemptId: string) =>
      browserSave("stale-empty", empty, "", {
        loadedUpdatedAt: updatedAt,
        loadedContentWasEmpty: true,
        browserSaveAttemptId: attemptId,
      });

    const image = "Opening.\n\n![Diagram](https://example.test/image.png)";
    const staleImage =
      'Opening.\n\n<SourceComponent componentName="Image" previewUrl={"https://example.test/image.png"} />';
    await switchedPage("stale-image", image);
    const builder = await page("stale-image");
    await getDb().insert(schema.contentDatabaseSources).values({
      id: "stale-image-source",
      ownerEmail: OWNER,
      databaseId: "stale-image-db",
      sourceType: "builder-cms",
      sourceName: "Builder",
      sourceTable: "test",
    });
    await getDb()
      .insert(schema.contentDatabaseSourceRows)
      .values({
        id: "stale-image-row",
        ownerEmail: OWNER,
        sourceId: "stale-image-source",
        databaseItemId: "item",
        documentId: "stale-image",
        sourceRowId: "row",
        sourceQualifiedId: "row",
        sourceDisplayKey: "row",
        sourceValuesJson: JSON.stringify({ "__builder.body.content": image }),
      });
    const imageSave = (attemptId: string) =>
      browserSave("stale-image", builder, staleImage, {
        browserSaveAttemptId: attemptId,
      });

    for (const saved of [
      await emptySave("empty-on"),
      await imageSave("image-on"),
    ]) {
      expect(saved).not.toHaveProperty("conflict");
      expect(saved).toMatchObject({
        bodySave: { status: "live_copy", matchesLiveCopy: false },
      });
    }
    expect(await page("stale-empty")).toEqual(empty);
    expect(await page("stale-image")).toEqual(builder);

    await setFlags(false);
    await expect(emptySave("empty-off")).resolves.toMatchObject({
      conflict: true,
    });
    await expect(imageSave("image-off")).resolves.toMatchObject({
      conflict: true,
    });
    expect(await page("stale-empty")).toEqual(empty);
    expect(await page("stale-image")).toEqual(builder);
  });

  it("takes main's path for the same save once the page's flags are off (SF-11)", async () => {
    await switchedPage("flags-off", "Hello there");
    const loaded = await page("flags-off");
    await typeInOtherTab("flags-off", ["Hello there B1", "Hello there B2"]);
    await setFlags(false);

    // Main's comparator, which L7 saw divert the gate-on save to History.
    const saved = await browserSave("flags-off", loaded, "Hello there A");

    expect(saved).not.toHaveProperty("bodySave");
    expect(saved).toMatchObject({
      preservationRequired: true,
      reason: "provenance",
    });
  });
});

describe("with the gate off (SF-11)", () => {
  it("keeps an unswitched page on main's collab path", async () => {
    await insertPage("legacy", "Hello there");
    const doc = new Y.Doc();
    doc.getText("default").insert(0, "legacy text");
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    const outcome = await asOwner(() => collab.applyUpdate("legacy", update));

    // Additive: the collab client reads only the update's HTTP status.
    expect(outcome).toEqual({
      liveCopy: "not_derived",
      liveCopyReason: "not_live_copy",
    });
    await expect(collab.getText("legacy", "default")).resolves.toBe(
      "legacy text",
    );
    const row = await page("legacy");
    expect(row).toMatchObject({
      content: "Hello there",
      bodyRevision: 3,
      collabBodyRevision: null,
      liveBodySwitchedAt: null,
    });
  });

  it("sends a switched page down the legacy path once its flags are off", async () => {
    await switchedPage("flagged", "Hello there");
    await setFlags(false);

    // Main's readers see the page again, holding its body.
    const doc = await collab.getDoc("flagged");
    expect(doc.getXmlFragment("default").toString()).toContain("Hello there");
    await expect(
      collab.mutateLiveCopy(binding.contentLiveCopy, "flagged", {
        edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
        input: { content: "Hello again" },
      }),
    ).rejects.toMatchObject({ name: "LiveCopyError", code: "not_live_copy" });
  });

  it("has get-document report each page's write path", async () => {
    const getDocument = (await import("../../actions/get-document.js")).default;
    const read = (id: string) =>
      asOwner(async () =>
        getDocument.run({ id }, { userEmail: OWNER } as never),
      );
    await insertPage("unswitched", "Hello there");
    await switchedPage("switched", "Hello there");

    await expect(read("unswitched")).resolves.toMatchObject({
      writePath: "legacy",
    });
    await expect(read("switched")).resolves.toMatchObject({
      writePath: "live_copy",
    });
    await setFlags(false);
    await expect(read("switched")).resolves.toMatchObject({
      writePath: "legacy",
    });
  });
});

describe("the slash menu's page-insert save, on a switched page", () => {
  const reference = '<page id="child-page">Untitled</page>';
  const required = { requiredText: 'id="child-page"' };

  it("stores what the slash menu saves after inserting a page", async () => {
    await switchedPage("slash", "Hello there");
    const blocks = markdownBlocks(`Hello there\n${reference}\n<empty-block/>`);
    const saved = nfm.collapseExactRepeatedNfm(
      nfm.docToNfm({ type: "doc", content: blocks }),
      required,
    );

    await asOwner(async () =>
      collab.applyUpdate("slash", await editorUpdate("slash", blocks)),
    );

    expect((await page("slash")).content).toBe(saved);
  });

  it("stores a repeated body the slash menu would collapse, and a replace edit repairs it", async () => {
    await switchedPage("doubled", "Hello there");
    const once = `Hello there\n${reference}\n<empty-block/>\nGamma`;
    const blocks = markdownBlocks(`${once}\n${once}`);
    const raw = nfm.docToNfm({ type: "doc", content: blocks });
    const collapsed = nfm.collapseExactRepeatedNfm(raw, required);
    expect(collapsed).not.toBe(raw);

    await asOwner(async () =>
      collab.applyUpdate("doubled", await editorUpdate("doubled", blocks)),
    );
    // The stored body is what the live copy holds; the legacy save stored
    // `collapsed` while the editor kept showing both copies.
    expect((await page("doubled")).content).toBe(raw);

    await cause.withContentBodyWriteCause(
      { operation: "slash-page-collapse" },
      () =>
        collab.mutateLiveCopy(binding.contentLiveCopy, "doubled", {
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: collapsed, expected: raw },
        }),
    );
    expect((await page("doubled")).content).toBe(collapsed);
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "doubled"),
    ).resolves.toMatchObject({ text: collapsed });
  });

  it("keeps a leading H1 that matches the title, as the shadow match compared it", async () => {
    await switchedPage("plan", "Hello there");
    const blocks = markdownBlocks("# plan\nHello there");

    await asOwner(async () =>
      collab.applyUpdate("plan", await editorUpdate("plan", blocks)),
    );

    // update-document strips this heading from the bodies it is sent; a
    // live-copy commit stores the editor's own serialization.
    const { content } = await page("plan");
    expect(content).toBe(nfm.docToNfm({ type: "doc", content: blocks }));
    expect(content.startsWith("# plan\n")).toBe(true);
  });
});

describe("the SF-07 bound on Content's derive and build", () => {
  // The stored-form review's counterexamples, through Content's own schema
  // and serializer. Each ends in a typed refusal that leaves the page alone,
  // or in a derived body, and never stalls the request thread.
  const STALL_LIMIT_MS = 500;
  const hello = () => markdownBlocks("Hello there");

  async function expectRefused(
    id: string,
    run: () => Promise<unknown>,
    expected: { code: string; reason: string },
  ) {
    const result = await longestStall(run);
    expect(result).toMatchObject({
      error: { name: "LiveCopyError", ...expected },
    });
    expect(result.stall).toBeLessThan(STALL_LIMIT_MS);
    expect(await page(id)).toMatchObject({
      content: "Hello there",
      bodyRevision: 3,
    });
  }

  async function expectDerived(id: string, run: () => Promise<unknown>) {
    const result = await longestStall(run);
    expect(result).toMatchObject({ value: { liveCopy: "derived" } });
    expect(result.stall).toBeLessThan(STALL_LIMIT_MS);
    const row = await page(id);
    expect(row.bodyRevision).toBe(4);
    return row.content;
  }

  it("refuses indent feeding repeat() (about 100 MB) as output_too_large", async () => {
    await switchedPage("indent", "Hello there");
    const update = await editorUpdate("indent", [
      ...hello(),
      ...Array.from({ length: 1_000 }, () => ({
        type: "paragraph",
        attrs: { indent: 100_000 },
      })),
    ]);

    await expectRefused(
      "indent",
      () => asOwner(() => collab.applyUpdate("indent", update)),
      { code: "derive_failed", reason: "output_too_large" },
    );
  });

  it("refuses an equation of 5M tabs before any worker runs", async () => {
    await switchedPage("latex", "Hello there");
    const update = await editorUpdate("latex", [
      ...hello(),
      {
        type: "notionBlockAtom",
        attrs: {
          tagName: "equation",
          attrsJson: JSON.stringify({ latex: "\t".repeat(5_000_000) }),
        },
      },
    ]);

    await expectRefused(
      "latex",
      () => asOwner(() => collab.applyUpdate("latex", update)),
      { code: "derive_failed", reason: "input_too_large" },
    );
  });

  it("derives a table whose colMeta holds 3M tabs inside the bound", async () => {
    await switchedPage("colmeta", "Hello there");
    const update = await editorUpdate("colmeta", [
      ...hello(),
      {
        type: "table",
        attrs: {
          colMeta: Array.from({ length: 30_000 }, () => ({
            width: "\t".repeat(100),
          })),
        },
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableCell", content: [{ type: "paragraph" }] }],
          },
        ],
      },
    ]);

    const content = await expectDerived("colmeta", () =>
      asOwner(() => collab.applyUpdate("colmeta", update)),
    );
    expect(content).toContain("<colgroup>");
  });

  it("refuses repeated mark attributes (50M characters) before any worker runs", async () => {
    await switchedPage("marks", "Hello there");
    const href = `https://example.com/${"h".repeat(1_000)}`;
    const link = { type: "link", attrs: { href } };
    const update = await editorUpdate("marks", [
      ...hello(),
      {
        type: "paragraph",
        content: Array.from({ length: 50_000 }, (_, index) => ({
          type: "text",
          text: "a",
          marks: index % 2 ? [link, { type: "bold" }] : [link],
        })),
      },
    ]);

    await expectRefused(
      "marks",
      () => asOwner(() => collab.applyUpdate("marks", update)),
      { code: "derive_failed", reason: "input_too_large" },
    );
  });

  it("reports deep nesting as a typed failure instead of overflowing this thread's stack", async () => {
    await switchedPage("nesting", "Hello there");
    const live = await collab.readLiveCopy(binding.contentLiveCopy, "nesting");
    if (live.kind !== "live") throw new Error(live.kind);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, live.state);
    const before = Y.encodeStateVector(doc);
    doc.transact(() => {
      // One level at a time: a prelim tree this deep overflows Yjs here.
      let parent: Y.XmlFragment | Y.XmlElement = doc.getXmlFragment("default");
      for (let depth = 0; depth < 10_000; depth += 1) {
        const quote = new Y.XmlElement("blockquote");
        parent.insert(parent.length, [quote]);
        parent = quote;
      }
      const leaf = new Y.XmlElement("paragraph");
      parent.insert(0, [leaf]);
    });
    const update = Y.encodeStateAsUpdate(doc, before);
    doc.destroy();

    await expectRefused(
      "nesting",
      () => asOwner(() => collab.applyUpdate("nesting", update)),
      { code: "derive_failed", reason: "task_threw" },
    );
  });

  it("derives a 200,000-line code block inside the bound", async () => {
    await switchedPage("code", "Hello there");
    const code = Array.from({ length: 200_000 }, (_, i) => `v${i % 10}`);
    const update = await editorUpdate("code", [
      ...hello(),
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: code.join("\n") }],
      },
    ]);

    const content = await expectDerived("code", () =>
      asOwner(() => collab.applyUpdate("code", update)),
    );
    expect(content.split("\n")).toHaveLength(200_003);
  });

  it("stops building a body of 1M [ at the deadline", async () => {
    await switchedPage("brackets", "Hello there");

    await expectRefused(
      "brackets",
      () =>
        cause.withContentBodyWriteCause({ operation: "test-replace" }, () =>
          collab.mutateLiveCopy(binding.contentLiveCopy, "brackets", {
            edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
            input: { content: "[".repeat(1_000_000) },
          }),
        ),
      { code: "build_failed", reason: "deadline_exceeded" },
    );
  });
});

describe("drizzleOverExec", () => {
  it("refuses a select whose rows would collapse two same-named columns", async () => {
    const db = execDb.drizzleOverExec(getDbExec());
    const failure = await db
      .select({
        documentId: schema.documents.id,
        versionId: schema.documentVersions.id,
      })
      .from(schema.documents)
      .innerJoin(
        schema.documentVersions,
        eq(schema.documentVersions.documentId, schema.documents.id),
      )
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    // Drizzle wraps the guard's error as the failed query's cause.
    expect((failure as { cause?: unknown } | undefined)?.cause).toMatchObject({
      message: expect.stringMatching(/two columns named "id"/),
    });
  });
});
