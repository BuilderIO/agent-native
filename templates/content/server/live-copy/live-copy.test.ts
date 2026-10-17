import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec, type DbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { putSetting } from "@agent-native/core/settings";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import { and, asc, eq } from "drizzle-orm";
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

const { outcomeCounter } = vi.hoisted(() => ({ outcomeCounter: vi.fn() }));
vi.mock("@agent-native/core/tracking", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/tracking")>()),
  countOutcome: outcomeCounter,
}));
vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

// The live copy's worker bundles its own Yjs and serializer, so these record
// only what ran on this thread, and only while `recording` is set.
const { thisThread, recordedOnThisThread } = vi.hoisted(() => {
  const thisThread = { recording: false, calls: [] as string[] };
  function recordedOnThisThread<T extends object>(
    actual: T,
    names: readonly string[],
  ): T {
    const recorded = { ...actual } as Record<string, unknown>;
    for (const name of names) {
      const call = recorded[name] as (...args: unknown[]) => unknown;
      recorded[name] = (...args: unknown[]) => {
        if (thisThread.recording) thisThread.calls.push(name);
        return call(...args);
      };
    }
    return recorded as T;
  }
  return { thisThread, recordedOnThisThread };
});
vi.mock("yjs", async (importOriginal) =>
  recordedOnThisThread(await importOriginal<typeof import("yjs")>(), [
    "applyUpdate",
    "applyUpdateV2",
    "readUpdate",
    "readUpdateV2",
    "diffUpdate",
    "diffUpdateV2",
    "mergeUpdates",
    "mergeUpdatesV2",
    "decodeUpdate",
    "decodeUpdateV2",
    "decodeStateVector",
    "encodeStateVectorFromUpdate",
    "encodeStateVectorFromUpdateV2",
  ]),
);
vi.mock("../../shared/nfm.js", async (importOriginal) =>
  recordedOnThisThread(
    await importOriginal<typeof import("../../shared/nfm.js")>(),
    ["docToNfm", "nfmToDoc"],
  ),
);

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
        {
          ...(input as object),
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content },
        },
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

/** Moves a page's History rows past the typing interval. */
async function ageHistory(id: string) {
  const rows = await getDb()
    .select({
      id: schema.documentVersions.id,
      createdAt: schema.documentVersions.createdAt,
    })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id));
  for (const row of rows) {
    const earlier = new Date(Date.parse(row.createdAt) - 3_000).toISOString();
    await getDb()
      .update(schema.documentVersions)
      .set({ createdAt: earlier, updatedAt: earlier })
      .where(eq(schema.documentVersions.id, row.id));
  }
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

/**
 * Runs `run`, recording the tasks it handed the live copy's bounded runner and
 * the Yjs decodes and serializer calls it made on this thread.
 */
async function whereItRan(run: () => Promise<unknown>) {
  const runner = binding.contentLiveCopy.runner;
  const send = runner.run.bind(runner);
  const tasks: string[] = [];
  const spy = vi
    .spyOn(runner, "run")
    .mockImplementation(async (task, ...rest) => {
      tasks.push(task);
      return send(task, ...rest);
    });
  thisThread.calls.length = 0;
  thisThread.recording = true;
  try {
    const outcome = await run().then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    return { ...outcome, tasks, thisThread: [...thisThread.calls] };
  } finally {
    thisThread.recording = false;
    spy.mockRestore();
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

  it("refuses to switch a page whose stored body the parser would drop part of", async () => {
    const stored = "Hello\n<callout>\nOnly text\n</callout>";
    await insertPage("drops-on-switch", stored);

    await expect(
      switching.switchPageToLiveCopy("drops-on-switch"),
    ).rejects.toMatchObject({ code: "build_refused", reason: "lossy" });
    const row = await page("drops-on-switch");
    expect(row.content).toBe(stored);
    expect(row.liveBodySwitchedAt).toBeNull();
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

  it("derives the page from editor updates and writes History at most once per typing interval, never rewriting a row", async () => {
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
    // B landed inside A's interval: no row, and A's row still holds A.
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
        content: "Hello there\nA",
        bodyRevision: 4,
        groupKind: "human_session",
        actorEmail: OWNER,
      }),
    ]);

    // Past the interval, the session's next row records B, which it replaces.
    await ageHistory("editor");
    await type(OWNER, "C");
    // Another collaborator starts their own session; B and C stay the owner's.
    await type(OTHER, "D");

    live = (await history("editor")).filter(
      (r) => r.operation === "live-copy-update",
    );
    expect(
      live.map((r) => [
        r.checkpointKind,
        r.actorEmail,
        r.content,
        r.bodyRevision,
      ]),
    ).toEqual([
      ["before", OWNER, "Hello there", 3],
      ["after", OWNER, "Hello there\nA", 4],
      ["before", OWNER, "Hello there\nA\nB", 5],
      ["after", OWNER, "Hello there\nA\nB\nC", 6],
      ["after", OTHER, "Hello there\nA\nB\nC\nD", 7],
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
    const edit: string = binding.CONTENT_LIVE_COPY_EDITS.replaceBody;

    await expect(
      writer.editContentLiveCopy("no-base", {
        cause: { operation: "test-no-base" },
        edit,
        // @ts-expect-error An edit typed as any string still owes its base.
        input: { content: "After" },
      }),
    ).rejects.toThrow(/must name the body it was built from/);
    expect(await collabVersion("no-base")).toBe(version);
    expect((await page("no-base")).content).toBe("Before");
  });

  it("checks the base a replace names even when a structured clone would drop it", async () => {
    await switchedPage("hidden-base", "Same");
    const spy = peerCommitsAfterBuild("hidden-base", "Peer");
    const input = Object.defineProperty({ content: "Mine" }, "expected", {
      value: "Same",
      enumerable: false,
    }) as { content: string; expected: string };
    try {
      await expect(
        writer.editContentLiveCopy("hidden-base", {
          cause: { operation: "test-hidden-base" },
          edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
          input,
        }),
      ).rejects.toMatchObject({
        name: "LiveCopyError",
        reason: "base_changed",
      });
    } finally {
      spy.mockRestore();
    }

    expect((await page("hidden-base")).content).toBe("Peer");
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

describe("edit-document on a switched page", () => {
  /** An agent's revisioned edit of `base`, as an MCP client sends it. */
  async function agentEdit(
    id: string,
    base: { bodyRevision: number; content: string },
    edits: Array<{ find: string; replace: string }>,
    idempotencyKey = `${id}-edit`,
    userEmail = OWNER,
  ) {
    const action = (await import("../../actions/edit-document.js")).default;
    const { documentRevisionToken } =
      await import("../../actions/_document-edit-mutation.js");
    return runWithRequestContext({ userEmail }, async () =>
      action.run(
        {
          id,
          baseRevision: documentRevisionToken(base.bodyRevision, base.content),
          idempotencyKey,
          edits,
        } as never,
        { caller: "mcp", userEmail } as never,
      ),
    ) as Promise<{
      applied: number;
      preservationRequired?: unknown;
      receipt: {
        outcome: string;
        revisions: { before: string; after: string };
        idempotency: { result: string };
      };
    }>;
  }

  async function typeInTab(id: string, body: string) {
    await asOwner(async () =>
      collab.applyUpdate(id, await editorUpdate(id, markdownBlocks(body))),
    );
  }

  it("commits an agent's edit through the live copy, so the page stays switched", async () => {
    await switchedPage("agent-edit", "Hello there");
    const loaded = await page("agent-edit");

    const result = await agentEdit("agent-edit", loaded, [
      { find: "there", replace: "world" },
    ]);

    expect(result.receipt.outcome).toBe("applied");
    const after = await page("agent-edit");
    expect(after.content).toBe("Hello world");
    expect(after.bodyRevision).toBe(loaded.bodyRevision + 1);
    expect(await gateFor("agent-edit")).toEqual({ writePath: "live_copy" });
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "agent-edit"),
    ).resolves.toMatchObject({ kind: "live", text: "Hello world" });
    expect(
      (await history("agent-edit")).filter(
        (row) => row.operation === "edit-document",
      ),
    ).not.toHaveLength(0);
    expect(await bodyIntents("agent-edit")).toEqual([
      expect.objectContaining({
        operationId: "agent-edit-edit",
        authoredBaseRevision: loaded.bodyRevision,
        committedRevision: loaded.bodyRevision + 1,
      }),
    ]);
  });

  it("applies an edit whose base a tab typed past, keeping the tab's text", async () => {
    await switchedPage("typed-past", "First\n\nSecond");
    const loaded = await page("typed-past");
    // A tab's commits record no body intents.
    await typeInTab("typed-past", "First\n\nSecond B");
    const typed = (await page("typed-past")).content;
    expect(typed).toContain("Second B");

    const result = await agentEdit("typed-past", loaded, [
      { find: "First", replace: "First A" },
    ]);

    expect(result.preservationRequired).toBeUndefined();
    expect(result.receipt.outcome).toBe("applied");
    expect((await page("typed-past")).content).toBe(
      typed.replace("First", "First A"),
    );
    expect(await gateFor("typed-past")).toEqual({ writePath: "live_copy" });
    // The intent names the revision the edit was made on, not the one it
    // committed after.
    expect(await bodyIntents("typed-past")).toEqual([
      expect.objectContaining({
        operationId: "typed-past-edit",
        authoredBaseRevision: loaded.bodyRevision,
      }),
    ]);
  });

  it("refuses an insertion beside paragraphs that read the same after a tab removed one", async () => {
    await switchedPage("same-neighbors", "Same\n\nSame\n\nSame");
    const loaded = await page("same-neighbors");
    await typeInTab("same-neighbors", "Same\n\nSame");
    const typed = (await page("same-neighbors")).content;
    const version = await collabVersion("same-neighbors");

    await expect(
      agentEdit("same-neighbors", loaded, [
        {
          find: loaded.content,
          replace: loaded.content.replace("Same", "Same\nNew"),
        },
      ]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("same-neighbors")).content).toBe(typed);
    expect(await collabVersion("same-neighbors")).toBe(version);
  });

  it("refuses an edit whose find a tab changed, and commits nothing", async () => {
    await switchedPage("find-changed", "First\n\nSecond");
    const loaded = await page("find-changed");
    await typeInTab("find-changed", "Third\n\nSecond");
    const typed = (await page("find-changed")).content;
    const version = await collabVersion("find-changed");

    await expect(
      agentEdit("find-changed", loaded, [{ find: "First", replace: "One" }]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("find-changed")).content).toBe(typed);
    expect(await collabVersion("find-changed")).toBe(version);
  });

  it("refuses an edit whose find covered a paragraph a tab changed, though the edit kept that paragraph", async () => {
    await switchedPage(
      "find-kept",
      "Alpha\n\nBravo\n\nCharlie\n\nDelta\n\nEcho",
    );
    const loaded = await page("find-kept");
    await typeInTab(
      "find-kept",
      "Alpha\n\nBravo typed\n\nCharlie\n\nDelta\n\nEcho",
    );
    const typed = (await page("find-kept")).content;
    const version = await collabVersion("find-kept");
    const body = loaded.content;
    const find = body.slice(0, body.indexOf("Charlie") + "Charlie".length);
    const kept = find.slice(find.indexOf("Bravo"));
    const separator = body.slice(
      body.indexOf("Bravo") + 5,
      body.indexOf("Charlie"),
    );

    // The diff reads the replace as deleting Alpha and adding New.
    await expect(
      agentEdit("find-kept", loaded, [
        { find, replace: `${kept}${separator}New` },
      ]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("find-kept")).content).toBe(typed);
    expect(await collabVersion("find-kept")).toBe(version);
  });

  it("applies an edit beside a paragraph a tab added since its base", async () => {
    await switchedPage("added-beside", "First\n\nSecond");
    const loaded = await page("added-beside");
    await typeInTab("added-beside", "First\n\nSecond\n\nThird");
    const typed = (await page("added-beside")).content;

    const result = await agentEdit("added-beside", loaded, [
      { find: "First", replace: "First A" },
    ]);

    expect(result.receipt.outcome).toBe("applied");
    expect((await page("added-beside")).content).toBe(
      typed.replace("First", "First A"),
    );
  });

  it("keeps a peer server's text when the peer's commit overtakes the edit", async () => {
    await switchedPage("peer-overtakes", "First\n\nSecond");
    const loaded = await page("peer-overtakes");
    const spy = peerCommitsAfterBuild("peer-overtakes", "First\nSecond peer");
    try {
      const result = await agentEdit("peer-overtakes", loaded, [
        { find: "First", replace: "First agent" },
      ]);
      expect(result.receipt.outcome).toBe("applied");
    } finally {
      spy.mockRestore();
    }

    expect((await page("peer-overtakes")).content).toBe(
      "First agent\nSecond peer",
    );
  });

  it("answers the same edit sent twice at once with one applied and one replayed receipt", async () => {
    await switchedPage("resent-at-once", "Hello there");
    const loaded = await page("resent-at-once");
    const { getGenerationCreativeContext } =
      await import("@agent-native/creative-context/server");
    // Both calls read no receipt before either commits.
    let bothRead!: () => void;
    const read = new Promise<void>((resolve) => (bothRead = resolve));
    let calls = 0;
    vi.mocked(getGenerationCreativeContext).mockImplementation(async () => {
      calls += 1;
      if (calls === 2) bothRead();
      await read;
      return null;
    });
    let results: Awaited<ReturnType<typeof agentEdit>>[];
    try {
      results = await Promise.all(
        [0, 1].map(() =>
          agentEdit(
            "resent-at-once",
            loaded,
            [{ find: "there", replace: "world" }],
            "resent-at-once-key",
          ),
        ),
      );
    } finally {
      vi.mocked(getGenerationCreativeContext).mockImplementation(
        async () => null,
      );
    }

    expect(
      results.map((result) => result.receipt.idempotency.result).sort(),
    ).toEqual(["applied", "replayed"]);
    const after = await page("resent-at-once");
    expect(after.content).toBe("Hello world");
    expect(after.bodyRevision).toBe(loaded.bodyRevision + 1);
  });

  it("refuses an edit whose editor access was revoked before it committed", async () => {
    await switchedPage("access-revoked", "Hello there");
    await getDb().insert(schema.documentShares).values({
      id: "access-revoked-share",
      resourceId: "access-revoked",
      principalType: "user",
      principalId: OTHER,
      role: "editor",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
    const loaded = await page("access-revoked");
    const version = await collabVersion("access-revoked");
    const runner = binding.contentLiveCopy.runner;
    const run = runner.run.bind(runner);
    const spy = vi.spyOn(runner, "run").mockImplementation(async (...args) => {
      const result = await run(...args);
      await getDb()
        .delete(schema.documentShares)
        .where(eq(schema.documentShares.id, "access-revoked-share"));
      return result;
    });
    try {
      await expect(
        agentEdit(
          "access-revoked",
          loaded,
          [{ find: "there", replace: "world" }],
          "access-revoked-edit",
          OTHER,
        ),
      ).rejects.toThrow("No access to document access-revoked");
    } finally {
      spy.mockRestore();
    }

    expect((await page("access-revoked")).content).toBe("Hello there");
    expect(await collabVersion("access-revoked")).toBe(version);
  });

  it("refuses an edit whose find now reads the same in a passage a tab changed", async () => {
    await switchedPage("retarget", "Alice: approved\n\nBob: pending");
    const loaded = await page("retarget");
    // The tab moves "approved" from Alice's line to Bob's.
    await typeInTab("retarget", "Alice: denied\n\nBob: approved");
    const typed = (await page("retarget")).content;
    const version = await collabVersion("retarget");

    await expect(
      agentEdit("retarget", loaded, [{ find: "approved", replace: "revoked" }]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("retarget")).content).toBe(typed);
    expect(await collabVersion("retarget")).toBe(version);
  });

  /** Whether History holds the exact body `loaded` was read at. */
  async function historyHolds(
    id: string,
    loaded: { bodyRevision: number; content: string },
  ) {
    const { findDocumentBodyBase } =
      await import("../lib/document-body-intents.js");
    const { documentContentHash } =
      await import("../../actions/_document-edit-mutation.js");
    return (
      (await findDocumentBodyBase({
        db: getDb(),
        ownerEmail: OWNER,
        documentId: id,
        contentHash: documentContentHash(loaded.content),
        revision: loaded.bodyRevision,
      })) !== null
    );
  }

  it("applies an edit whose base a typing interval passed before History recorded it", async () => {
    await switchedPage("unrecorded", "First\n\nSecond");
    await typeInTab("unrecorded", "First\n\nSecond B");
    // Inside the interval: the base an agent reads gets no row.
    await typeInTab("unrecorded", "First\n\nSecond BC");
    const loaded = await page("unrecorded");
    await typeInTab("unrecorded", "First\n\nSecond BCD");
    expect(await historyHolds("unrecorded", loaded)).toBe(false);
    const typed = (await page("unrecorded")).content;

    const result = await agentEdit("unrecorded", loaded, [
      { find: "First", replace: "First A" },
    ]);

    expect(result.receipt.outcome).toBe("applied");
    expect((await page("unrecorded")).content).toBe(
      typed.replace("First", "First A"),
    );
    // The row the interval opened with still holds its own body.
    expect(
      (await history("unrecorded")).some(
        (row) => row.content === "First\nSecond B",
      ),
    ).toBe(true);
  });

  it("refuses an edit made on an unrecorded base where a tab has since changed the text it replaces", async () => {
    await switchedPage("unrecorded-typed", "First\n\nSecond");
    await typeInTab("unrecorded-typed", "First\n\nSecond B");
    await typeInTab("unrecorded-typed", "First\n\nSecond BC");
    const loaded = await page("unrecorded-typed");
    await typeInTab("unrecorded-typed", "First\n\nSecond BCD");
    expect(await historyHolds("unrecorded-typed", loaded)).toBe(false);
    const typed = (await page("unrecorded-typed")).content;
    const version = await collabVersion("unrecorded-typed");

    // The tab is typing in the paragraph the edit changes.
    await expect(
      agentEdit("unrecorded-typed", loaded, [
        { find: "Second", replace: "Next" },
      ]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });
    // Text only the unrecorded base had is placed on it exactly, and the
    // tab has changed it since.
    await expect(
      agentEdit(
        "unrecorded-typed",
        loaded,
        [{ find: "Second BC", replace: "Next" }],
        "unrecorded-typed-only-base",
      ),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("unrecorded-typed")).content).toBe(typed);
    expect(await collabVersion("unrecorded-typed")).toBe(version);
  });

  it("refuses an edit whose unrecorded base read its find in a line a tab has since changed", async () => {
    await switchedPage("approvals", "Alice: approved\n\nBob: pending\n\nNote");
    await typeInTab("approvals", "Alice: approved\n\nBob: pending\n\nNote x");
    // Inside the interval, the agent reads the only "approved" in Bob's line.
    await typeInTab("approvals", "Alice: denied\n\nBob: approved\n\nNote x");
    const loaded = await page("approvals");
    // The tab puts both lines back; the bodies History records either side
    // of the base both read "approved" in Alice's line.
    await typeInTab("approvals", "Alice: approved\n\nBob: pending\n\nNote xy");
    expect(await historyHolds("approvals", loaded)).toBe(false);
    const typed = (await page("approvals")).content;
    const version = await collabVersion("approvals");

    await expect(
      agentEdit("approvals", loaded, [
        { find: "approved", replace: "revoked" },
      ]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("approvals")).content).toBe(typed);
    expect(await collabVersion("approvals")).toBe(version);
  });

  it("places an edit on its exact unrecorded base, though a tab moved the text it replaces and put it back", async () => {
    await switchedPage("placed", "P: $10\n\nNote");
    await typeInTab("placed", "P: $10\n\nNote x");
    await typeInTab("placed", "P: $10\n\nNote xy");
    // The agent reads the only "$10" in P's line.
    const loaded = await page("placed");
    // Still inside the interval, the tab moves it to a new line.
    await typeInTab("placed", "Note xy\n\nC: $10");
    await ageHistory("placed");
    // Past it, the tab puts P's line back; History records the moved state.
    await typeInTab("placed", "P: $10\n\nNote xy\n\nC: $10");
    expect(await historyHolds("placed", loaded)).toBe(false);
    const typed = (await page("placed")).content;

    const result = await agentEdit("placed", loaded, [
      { find: "$10", replace: "$15" },
    ]);

    // Made on the later recorded body, it would have changed C's line.
    expect(result.receipt.outcome).toBe("applied");
    expect((await page("placed")).content).toBe(
      typed.replace("$10", () => "$15"),
    );
  });

  it("refuses an edit whose unrecorded base a commit with no body step passed", async () => {
    await switchedPage("no-step", "First\n\nSecond");
    await typeInTab("no-step", "First\n\nSecond B");
    await typeInTab("no-step", "First\n\nSecond BC");
    const loaded = await page("no-step");
    await typeInTab("no-step", "First\n\nSecond BCD");
    // A pruned step, or a commit too large to record one.
    await getDb()
      .delete(schema.documentBodySteps)
      .where(
        and(
          eq(schema.documentBodySteps.documentId, "no-step"),
          eq(schema.documentBodySteps.bodyRevision, loaded.bodyRevision),
        ),
      );
    const typed = (await page("no-step")).content;

    await expect(
      agentEdit("no-step", loaded, [{ find: "First", replace: "First A" }]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("no-step")).content).toBe(typed);
  });

  it("refuses an edit whose rebuilt base reads unlike the base it names", async () => {
    await switchedPage("bad-step", "First\n\nSecond");
    await typeInTab("bad-step", "First\n\nSecond B");
    await typeInTab("bad-step", "First\n\nSecond BC");
    const loaded = await page("bad-step");
    await typeInTab("bad-step", "First\n\nSecond BCD");
    expect(await historyHolds("bad-step", loaded)).toBe(false);
    // A step that doesn't turn its commit's body back into the one before.
    await getDb()
      .update(schema.documentBodySteps)
      .set({ text: "Z" })
      .where(
        and(
          eq(schema.documentBodySteps.documentId, "bad-step"),
          eq(schema.documentBodySteps.bodyRevision, loaded.bodyRevision),
        ),
      );
    const typed = (await page("bad-step")).content;

    await expect(
      agentEdit("bad-step", loaded, [{ find: "First", replace: "First A" }]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("bad-step")).content).toBe(typed);
  });

  it("rebuilds an unrecorded base across an emoji a tab changed", async () => {
    await switchedPage("emoji", "Mood 😀\n\nSecond");
    await typeInTab("emoji", "Mood 😀\n\nSecond B");
    await typeInTab("emoji", "Mood 😀\n\nSecond BC");
    const loaded = await page("emoji");
    // 😀 and 😃 share their first UTF-16 unit.
    await typeInTab("emoji", "Mood 😃\n\nSecond BC");
    expect(await historyHolds("emoji", loaded)).toBe(false);

    const result = await agentEdit("emoji", loaded, [
      { find: "Second", replace: "Next" },
    ]);

    expect(result.receipt.outcome).toBe("applied");
    expect((await page("emoji")).content).toBe(
      loaded.content.replace("😀", "😃").replace("Second", "Next"),
    );
  });

  it("refuses a rebase whose replaced ranges overlap, and commits nothing", async () => {
    await switchedPage("overlap", "Alpha\n\nBravo\n\nCharlie");
    const loaded = await page("overlap");
    const version = await collabVersion("overlap");

    await expect(
      writer.editContentLiveCopy("overlap", {
        cause: { operation: "test-rebase" },
        edit: binding.CONTENT_LIVE_COPY_EDITS.rebaseBody,
        input: {
          base: loaded.content,
          candidate: loaded.content.replace("Alpha", "New"),
          authored: [
            { start: 0, end: 5 },
            { start: 0, end: 11 },
          ],
        },
      }),
    ).rejects.toMatchObject({
      name: "LiveCopyError",
      code: "build_refused",
      reason: "invalid_input",
    });

    expect((await page("overlap")).content).toBe(loaded.content);
    expect(await collabVersion("overlap")).toBe(version);
  });

  it("refuses an edit whose revision History holds with another body", async () => {
    await switchedPage("other-body", "First\n\nSecond");
    const loaded = await page("other-body");
    await typeInTab("other-body", "First\n\nSecond B");
    const typed = (await page("other-body")).content;

    await expect(
      agentEdit("other-body", { ...loaded, content: "Forged" }, [
        { find: "First", replace: "First A" },
      ]),
    ).rejects.toMatchObject({ errorCode: "STALE_BASE_REVISION" });

    expect((await page("other-body")).content).toBe(typed);
  });

  it("refuses an edit whose Markdown the parser would drop part of", async () => {
    await switchedPage("drops-text", "Hello");
    const loaded = await page("drops-text");
    const version = await collabVersion("drops-text");
    // A callout's child must be indented; this one would be dropped.
    const replace = "Hello\n<callout>\nOnly text\n</callout>";

    await expect(
      agentEdit("drops-text", loaded, [{ find: "Hello", replace }]),
    ).rejects.toMatchObject({
      errorCode: "DOCUMENT_BODY_UNREPRESENTABLE",
      statusCode: 422,
    });
    const action = (await import("../../actions/edit-document.js")).default;
    await expect(
      asOwner(async () =>
        action.run(
          { id: "drops-text", find: "Hello", replace } as never,
          { caller: "frontend", userEmail: OWNER } as never,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_BODY_UNREPRESENTABLE" });

    expect((await page("drops-text")).content).toBe("Hello");
    expect(await collabVersion("drops-text")).toBe(version);
  });

  it("answers a resent edit from its receipt without applying it twice", async () => {
    await switchedPage("resent", "Hello there");
    const loaded = await page("resent");
    const edits = [{ find: "there", replace: "there again" }];

    const first = await agentEdit("resent", loaded, edits);
    const second = await agentEdit("resent", loaded, edits);

    expect(second.receipt.idempotency.result).toBe("replayed");
    expect(second.receipt.revisions).toEqual(first.receipt.revisions);
    expect((await page("resent")).content).toBe("Hello there again");
    expect(await gateFor("resent")).toEqual({ writePath: "live_copy" });
  });

  it("takes the legacy path when the page leaves its live copy mid-edit", async () => {
    await switchedPage("left-mid-edit", "Hello there");
    const loaded = await page("left-mid-edit");
    const spy = flagsOffAfterBuild();
    try {
      const result = await agentEdit("left-mid-edit", loaded, [
        { find: "there", replace: "world" },
      ]);
      expect(result.receipt.outcome).toBe("applied");
      // The edit was built on the live copy before the page left it.
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
    expect((await page("left-mid-edit")).content).toBe("Hello world");
    expect(await gateFor("left-mid-edit")).toMatchObject({
      writePath: "legacy",
    });
  });

  it("writes an edit without a revision through the live copy too", async () => {
    await switchedPage("no-revision", "Hello there");
    const action = (await import("../../actions/edit-document.js")).default;

    await asOwner(async () =>
      action.run(
        { id: "no-revision", find: "there", replace: "world" } as never,
        { caller: "frontend", userEmail: OWNER } as never,
      ),
    );

    expect((await page("no-revision")).content).toBe("Hello world");
    expect(await gateFor("no-revision")).toEqual({ writePath: "live_copy" });
  });
});

describe("a server rewrite of a switched page's body", () => {
  const IMAGE = "https://example.com/cat.png";

  async function setAltText(id: string, altText: string) {
    const action = (await import("../../actions/set-image-alt-text.js"))
      .default;
    return asOwner(async () =>
      action.run(
        { documentId: id, imageUrl: IMAGE, altText } as never,
        { caller: "tool", userEmail: OWNER } as never,
      ),
    );
  }

  it("writes alt text through the live copy, so the page stays switched", async () => {
    await switchedPage("alt-text", `Intro\n\n![](${IMAGE})`);
    const loaded = await page("alt-text");

    await setAltText("alt-text", "A cat");

    const after = await page("alt-text");
    expect(after.content).toContain(`![A cat](${IMAGE})`);
    expect(after.bodyRevision).toBe(loaded.bodyRevision + 1);
    expect(await gateFor("alt-text")).toEqual({ writePath: "live_copy" });
    await expect(
      collab.readLiveCopy(binding.contentLiveCopy, "alt-text"),
    ).resolves.toMatchObject({ kind: "live", text: after.content });
    expect((await history("alt-text")).map((row) => row.operation)).toContain(
      "set-image-alt-text",
    );
  });

  it("writes alt text on top of a commit made after it read the body", async () => {
    await switchedPage("alt-text-peer", `Intro\n\n![](${IMAGE})`);
    const spy = peerCommitsAfterBuild(
      "alt-text-peer",
      `Intro typed\n![](${IMAGE})`,
    );
    try {
      await setAltText("alt-text-peer", "A cat");
    } finally {
      spy.mockRestore();
    }

    const after = await page("alt-text-peer");
    expect(after.content).toContain("Intro typed");
    expect(after.content).toContain(`![A cat](${IMAGE})`);
  });

  it("writes alt text to the image it read, though a tab added one with the same URL before it", async () => {
    await switchedPage(
      "alt-text-same-url",
      `Original\n\n![original](${IMAGE})`,
    );
    const spy = peerCommitsAfterBuild(
      "alt-text-same-url",
      `Inserted\n\n![peer](${IMAGE})\n\nOriginal\n\n![original](${IMAGE})`,
    );
    try {
      await setAltText("alt-text-same-url", "A cat");
    } finally {
      spy.mockRestore();
    }

    const after = await page("alt-text-same-url");
    expect(after.content).toContain(`![peer](${IMAGE})`);
    expect(after.content).toContain(`Original\n![A cat](${IMAGE})`);
    expect(after.content).not.toContain("![original]");
  });

  it("writes alt text through update-document with the flags off, as on main", async () => {
    await setFlags(false);
    await insertPage("alt-text-off", `Intro\n\n![](${IMAGE})`);

    await setAltText("alt-text-off", "A cat");

    const after = await page("alt-text-off");
    expect(after.content).toBe(`Intro\n\n![A cat](${IMAGE})`);
    expect(after.liveBodySwitchedAt).toBeNull();
    expect(await collabVersion("alt-text-off")).toBeUndefined();
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

  /** The reason the last save's outcome was counted under. */
  async function countedReason() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return outcomeCounter.mock.lastCall?.[1]?.reason_code;
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

  /** A tab synced to the live copy edits its body into each of `bodies`. */
  async function typeInTab(id: string, bodies: string[]) {
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
    await typeInTab("two-tabs", ["Hello there B1", "Hello there B2"]);
    const before = await page("two-tabs");
    expect(before.bodyRevision).toBe(loaded.bodyRevision + 2);

    const saved = await browserSave("two-tabs", loaded, "Hello there A");

    expect(await countedReason()).toBe("live_copy_save_unheld");
    expect(saved).not.toHaveProperty("preservationRequired");
    expect(saved).not.toHaveProperty("conflict");
    expect(saved).not.toHaveProperty("bodyIntentOutcome");
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

  it("settles a save the live copy holds, though a peer committed after it", async () => {
    await switchedPage("held", "First\n\nSecond");
    const loaded = await page("held");
    // Tab A's own typing reaches the live copy over collab, then another
    // tab's commit lands before tab A's save.
    await typeInTab("held", ["First A\n\nSecond"]);
    const typed = (await page("held")).content;
    await typeInTab("held", ["First A\n\nSecond B"]);
    await keepDraft("held", typed);
    const before = await page("held");
    const save = () =>
      browserSave("held", loaded, typed, {
        editorSnapshotTitle: "held",
        editorSnapshotContent: typed,
      });

    const saved = await save();

    expect(await countedReason()).toBe("live_copy_save_held");
    expect(saved).not.toHaveProperty("preservationRequired");
    expect(saved).toMatchObject({
      content: before.content,
      bodyIntentOutcome: { status: "applied" },
      bodySave: { status: "live_copy", matchesLiveCopy: false },
      browserSaveAttempt: { result: "live_copy" },
    });
    expect(await page("held")).toEqual(before);
    expect(await drafts("held")).toEqual([]);
    expect(await receipts("held")).toEqual([{ attemptId: "held-attempt" }]);
    expect(await bodyIntents("held")).toEqual([]);

    // A resend of the same attempt is answered the same way from its receipt.
    await expect(save()).resolves.toMatchObject({
      bodyIntentOutcome: { status: "applied" },
      bodySave: { matchesLiveCopy: false },
      browserSaveAttempt: { result: "replayed" },
    });
  });

  it("compares a save's title heading as the editor wrote it", async () => {
    await switchedPage("headed", "# headed\n\nFirst\n\nSecond");
    const loaded = await page("headed");
    await typeInTab("headed", ["# headed\n\nFirst A\n\nSecond"]);
    const typed = (await page("headed")).content;
    await typeInTab("headed", ["# headed\n\nFirst A\n\nSecond B"]);
    await keepDraft("headed", typed);

    // update-document strips a heading that repeats the title from the body
    // it writes, and the live copy keeps it.
    await expect(
      browserSave("headed", loaded, typed, {
        editorSnapshotTitle: "headed",
        editorSnapshotContent: typed,
      }),
    ).resolves.toMatchObject({
      content: expect.stringMatching(/^# headed\n/),
      bodyIntentOutcome: { status: "applied" },
    });
    expect(await countedReason()).toBe("live_copy_save_held");
    expect(await drafts("headed")).toEqual([]);
  });

  it("keeps a tab's draft when only part of its typing reached the live copy", async () => {
    await switchedPage("partial", "Hello");
    const loaded = await page("partial");
    await typeInTab("partial", ["Hello w"]);
    await keepDraft("partial", "Hello world");

    const saved = await browserSave("partial", loaded, "Hello world", {
      editorSnapshotTitle: "partial",
      editorSnapshotContent: "Hello world",
    });

    expect(await countedReason()).toBe("live_copy_save_unheld");
    expect(saved).toMatchObject({
      content: "Hello w",
      bodySave: { matchesLiveCopy: false },
    });
    expect(saved).not.toHaveProperty("bodyIntentOutcome");
    expect(await drafts("partial")).toEqual([{ content: "Hello world" }]);
    expect(await receipts("partial")).toEqual([]);
  });

  it("keeps a tab's draft when its save is not its own serialization", async () => {
    await switchedPage("noncanonical", "Hello");
    const loaded = await page("noncanonical");
    await typeInTab("noncanonical", ["Hello\n<callout>\n</callout>"]);
    const stored = (await page("noncanonical")).content;
    // The parse drops the unindented callout child, so this compares as the
    // empty callout the live copy holds.
    const candidate = "Hello\n<callout>\nOnly text\n</callout>";
    expect(nfm.docToNfm(nfm.nfmToDoc(candidate))).toBe(stored);
    await keepDraft("noncanonical", candidate);

    const saved = await browserSave("noncanonical", loaded, candidate, {
      editorSnapshotTitle: "noncanonical",
      editorSnapshotContent: candidate,
    });

    expect(await countedReason()).toBe("live_copy_save_noncanonical");
    expect(saved).not.toHaveProperty("bodyIntentOutcome");
    expect(saved).not.toHaveProperty("browserSaveAttempt");
    expect(await drafts("noncanonical")).toEqual([{ content: candidate }]);
    expect(await receipts("noncanonical")).toEqual([]);
  });

  it("keeps a tab's draft when the live copy cannot compare its save in time", async () => {
    await switchedPage("unchecked", "Hello there");
    const loaded = await page("unchecked");
    await keepDraft("unchecked", "Hello there\nOnly in tab A");
    const { documentRevisionToken } =
      await import("../../actions/_document-edit-mutation.js");
    // Unclosed backtick runs, as in the SF-07 deadline test, under the
    // 500,000-character bound on an authored body.
    const base = Array.from({ length: 990 }, (_, index) =>
      "`".repeat(index + 1),
    ).join(" ");

    const saved = await browserSave(
      "unchecked",
      loaded,
      "Hello there\nOnly in tab A",
      {
        authoredBaseRevision: documentRevisionToken(loaded.bodyRevision, base),
        authoredBaseContent: base,
        editorSnapshotTitle: "unchecked",
        editorSnapshotContent: "Hello there\nOnly in tab A",
      },
    );

    expect(await countedReason()).toBe("live_copy_save_unchecked");
    expect(saved).toMatchObject({ bodySave: { matchesLiveCopy: false } });
    expect(saved).not.toHaveProperty("bodyIntentOutcome");
    expect(saved).not.toHaveProperty("browserSaveAttempt");
    expect(await drafts("unchecked")).toEqual([
      { content: "Hello there\nOnly in tab A" },
    ]);
    expect(await receipts("unchecked")).toEqual([]);
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
    await typeInTab("flags-off", ["Hello there B1", "Hello there B2"]);
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
  // or in a derived body, with the decode and serializer work in the worker.
  // These check where the work ran, not how long this thread stalled: a
  // stall bound fails on a busy machine.
  const hello = () => markdownBlocks("Hello there");
  // A derived body's persist parses it once on this thread, to reconcile the
  // page's inline databases.
  const PERSIST_PARSES = ["nfmToDoc"];

  async function expectRefused(
    id: string,
    run: () => Promise<unknown>,
    expected: { code: string; reason: string },
    tasks: string[],
  ) {
    const result = await whereItRan(run);
    expect(result).toMatchObject({
      error: { name: "LiveCopyError", ...expected },
    });
    expect(result.tasks).toEqual(tasks);
    expect(result.thisThread).toEqual([]);
    expect(await page(id)).toMatchObject({
      content: "Hello there",
      bodyRevision: 3,
    });
  }

  async function expectDerived(id: string, run: () => Promise<unknown>) {
    const result = await whereItRan(run);
    expect(result).toMatchObject({ value: { liveCopy: "derived" } });
    expect(result.tasks).toEqual(["liveCopy.apply"]);
    expect(result.thisThread).toEqual(PERSIST_PARSES);
    const row = await page(id);
    expect(row.bodyRevision).toBe(4);
    return row.content;
  }

  it("records the decode of an update to a page off its live copy on this thread", async () => {
    await insertPage("decoded-here", "Hello there");
    const doc = new Y.Doc();
    doc.getXmlFragment("default").insert(0, [new Y.XmlElement("paragraph")]);
    const update = Y.encodeStateAsUpdate(doc);
    doc.destroy();

    const result = await whereItRan(() =>
      asOwner(() => collab.applyUpdate("decoded-here", update)),
    );
    expect(result.tasks).toEqual([]);
    expect(result.thisThread).toContain("applyUpdate");
  });

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
      ["liveCopy.apply"],
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
      // The runner refuses an input this size before it posts it to a worker.
      { code: "derive_failed", reason: "input_too_large" },
      ["liveCopy.apply"],
    );
  });

  it("derives a table whose colMeta holds 3M tabs in the worker", async () => {
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
      // The runner refuses an input this size before it posts it to a worker.
      { code: "derive_failed", reason: "input_too_large" },
      ["liveCopy.apply"],
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
      ["liveCopy.apply"],
    );
  });

  it("derives a 200,000-line code block in the worker", async () => {
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

  it("stops building a body of 1,000 unmatched backtick runs at the deadline", async () => {
    await switchedPage("backticks", "Hello there");
    // Runs of 1 to 1,000 backticks, none closed. Building it takes over 20 s
    // with either NFM parser; 1M `[` stopped tripping once the parser got fast.
    const content = Array.from({ length: 1_000 }, (_, index) =>
      "`".repeat(index + 1),
    ).join(" ");

    await expectRefused(
      "backticks",
      () =>
        cause.withContentBodyWriteCause({ operation: "test-replace" }, () =>
          collab.mutateLiveCopy(binding.contentLiveCopy, "backticks", {
            edit: binding.CONTENT_LIVE_COPY_EDITS.replaceBody,
            input: { content },
          }),
        ),
      { code: "build_failed", reason: "deadline_exceeded" },
      ["liveCopy.edit"],
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
