import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import {
  deleteSetting,
  putOrgSetting,
  putSetting,
} from "@agent-native/core/settings";
import { initProseMirrorDoc, updateYFragment } from "@tiptap/y-tiptap";
import { eq } from "drizzle-orm";
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
import { materializeLiveBody } from "../../shared/live-body.js";
import { canonicalizeNfm, nfmToDoc } from "../../shared/nfm.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

// Lets a test land a link or membership after the switch's own check, as a
// concurrent writer would, by answering that check with no blockers.
const blockerRace = vi.hoisted(() => ({ cleanChecks: 0 }));

vi.mock("./eligibility.js", async (importOriginal) => {
  const eligibility = await importOriginal<typeof import("./eligibility.js")>();
  return {
    ...eligibility,
    liveBodySwitchBlockers: async (
      ...args: Parameters<typeof eligibility.liveBodySwitchBlockers>
    ) => {
      if (blockerRace.cleanChecks > 0) {
        blockerRace.cleanChecks -= 1;
        return [];
      }
      return eligibility.liveBodySwitchBlockers(...args);
    },
  };
});

const TEST_DB_PATH = join(
  tmpdir(),
  `content-live-body-backfill-${process.pid}-${Date.now()}.pglite`,
);

type DbModule = typeof import("../db/index.js");

let getDb: DbModule["getDb"];
let schema: DbModule["schema"];
let collab: typeof import("@agent-native/core/collab");
let backfill: typeof import("./backfill.js");
let switching: typeof import("./switch.js");
let persist: typeof import("./persist.js");
let setSwitch: typeof import("../../actions/set-live-body-switch.js").default;
let getDocumentAction: typeof import("../../actions/get-document.js").default;

const ownerEmail = "backfill-owner@example.com";
// Has both of the writer's flags, but not the backfill's.
const writerOnlyEmail = "backfill-writer-only@example.com";
const ctx = { caller: "frontend" as const, userEmail: ownerEmail };
const editorSchema = createContentEditorStructuralSchema();
const BACKFILL = "content.live-body-backfill";
const LONG_AGO = "2026-01-01T00:00:00.000Z";
let sequence = 0;

function rulesFor(emails: string[]) {
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

/**
 * Sets the backfill flag's rules. The rollout index core keeps beside them
 * is written only by the operator's action, so drop it and let core rebuild
 * it from the rules on its next read.
 */
async function setBackfillFlag(emails: string[]) {
  await putSetting(`feature-flag:${BACKFILL}`, rulesFor(emails));
  await deleteSetting(`feature-flag-rollout-index:${BACKFILL}`);
}

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  await (await import("../plugins/db.js")).default(undefined as never);
  await (await import("../plugins/suggested-edits.js")).default();
  const { registerFeatureFlags } =
    await import("@agent-native/core/feature-flags");
  registerFeatureFlags(
    (await import("../../shared/feature-flags.js")).CONTENT_FEATURE_FLAGS,
  );
  for (const flag of ["content.live-body-shadow", "content.live-body-writer"])
    await putSetting(
      `feature-flag:${flag}`,
      rulesFor([ownerEmail, writerOnlyEmail]),
    );
  await setBackfillFlag([ownerEmail]);
  collab = await import("@agent-native/core/collab");
  backfill = await import("./backfill.js");
  switching = await import("./switch.js");
  persist = await import("./persist.js");
  setSwitch = (await import("../../actions/set-live-body-switch.js")).default;
  getDocumentAction = (await import("../../actions/get-document.js")).default;
}, 120_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function as<T>(email: string, run: () => T): Promise<Awaited<T>> {
  return await runWithRequestContext(
    { userEmail: email },
    async () => await run(),
  );
}

// An agent wrote this page through the legacy writer: `$60` and the blank
// lines are not how the live copy writes it.
const stored = [
  "The first paragraph sets the scene.",
  "",
  "",
  "The budget is $60 for the team.",
].join("\n");

async function insertPage(
  content: string,
  extra: Partial<typeof schema.documents.$inferInsert> = {},
) {
  sequence += 1;
  const id = extra.id ?? `backfill-${String(sequence).padStart(4, "0")}`;
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      title: "Legacy page",
      content,
      ownerEmail,
      bodyRevision: 1,
      createdAt: LONG_AGO,
      updatedAt: LONG_AGO,
      ...extra,
    });
  return id;
}

/** Makes page `id` a row of a new collection, a system one when `systemRole` is given. */
async function addToCollection(id: string, systemRole?: string) {
  const databaseId = `database-${id}`;
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: databaseId,
      spaceId: `space-${id}`,
      ownerEmail,
      documentId: `database-page-${id}`,
      systemRole: systemRole ?? null,
    });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({ id: `item-${id}`, ownerEmail, databaseId, documentId: id });
}

async function page(id: string) {
  const [row] = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  return row!;
}

async function collabVersion(id: string) {
  const { rows } = await (
    await import("@agent-native/core/db")
  )
    .getDbExec()
    .execute({
      sql: "SELECT version FROM _collab_docs WHERE doc_id = ?",
      args: [id],
    });
  return rows[0] === undefined ? undefined : Number(rows[0].version);
}

async function historyOperations(id: string) {
  const rows = await getDb()
    .select({ operation: schema.documentVersions.operation })
    .from(schema.documentVersions)
    .where(eq(schema.documentVersions.documentId, id));
  return rows.map((row) => row.operation);
}

/**
 * A tab opened the legacy page and committed `content` to its live copy,
 * with `typed` above it when given: text whose save hasn't reached the stored
 * body.
 */
async function openInTab(id: string, content: string, typed?: string) {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const { meta } = initProseMirrorDoc(fragment, editorSchema);
  const root = editorSchema.nodeFromJSON({
    type: "doc",
    content: [
      ...(typed
        ? [{ type: "paragraph", content: [{ type: "text", text: typed }] }]
        : []),
      ...(nfmToDoc(content).content ?? []),
    ],
  });
  updateYFragment(doc, fragment, root, meta);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  await as(ownerEmail, () => collab.applyUpdate(id, update));
}

/** The editor's open of a page, as DocumentEditor asks for it. */
function openInEditor(id: string, email = ownerEmail) {
  return as(email, () =>
    getDocumentAction.run(
      { id, includePreviewDraft: true },
      { caller: "frontend", userEmail: email },
    ),
  );
}

describe("an editor's first open", () => {
  it("switches the page before the editor binds, and serves the body the live copy writes", async () => {
    const id = await insertPage(stored);

    const opened = await openInEditor(id);

    const canonical = canonicalizeNfm(stored);
    expect(canonical).not.toBe(stored);
    expect(opened).toMatchObject({
      content: canonical,
      writePath: "live_copy",
    });
    const row = await page(id);
    expect(row.liveBodySwitchedAt).not.toBeNull();
    expect(row.content).toBe(canonical);
    expect(row.bodyRevision).toBe(2);
    expect(row.collabBodyRevision).toBe(2);
    expect(row.liveCopyVersion).toBe(await collabVersion(id));
    expect(await historyOperations(id)).toContain("switch-live-body");
    // A second open finds it switched.
    await expect(
      backfill.convertPageToLiveCopyIfDue(id, { ctx }),
    ).resolves.toEqual({ status: "current" });
  });

  it("leaves the page alone on a read that isn't the editor's open", async () => {
    const id = await insertPage(stored);

    const read = await as(ownerEmail, () =>
      getDocumentAction.run({ id }, { caller: "mcp", userEmail: ownerEmail }),
    );

    expect(read).toMatchObject({ content: stored, writePath: "legacy" });
    expect(await page(id)).toMatchObject({
      content: stored,
      bodyRevision: 1,
      liveBodySwitchedAt: null,
    });
    expect(await collabVersion(id)).toBeUndefined();
  });

  it("leaves the page alone while its owner lacks the backfill flag, as main does (SF-11)", async () => {
    const id = await insertPage(stored, { ownerEmail: writerOnlyEmail });

    const opened = await openInEditor(id, writerOnlyEmail);

    expect(opened).toMatchObject({ content: stored, writePath: "legacy" });
    expect(await page(id)).toMatchObject({
      content: stored,
      liveBodySwitchedAt: null,
    });
    await expect(
      as(writerOnlyEmail, () => backfill.convertPageToLiveCopyIfDue(id)),
    ).resolves.toEqual({ status: "skipped", reason: "flag_off" });
  });

  it("opens a page some source owns as before, without trying to switch it", async () => {
    const id = await insertPage(stored, {
      sourceMode: "github",
      sourceRootPath: "github:example/docs@main",
      sourcePath: "docs/page.md",
    });

    const opened = await openInEditor(id);

    expect(opened).toMatchObject({ content: stored, writePath: "legacy" });
    expect(await page(id)).toMatchObject({ liveBodySwitchedAt: null });
  });
});

describe("which pages can be switched", () => {
  const cases: Array<{
    blocker: string;
    setUp: (id: string) => Promise<void> | void;
    page?: Partial<
      typeof import("../db/index.js").schema.documents.$inferInsert
    >;
  }> = [
    {
      blocker: "local_file",
      page: {
        sourceMode: "local-files",
        sourceRootPath: "/docs",
        sourcePath: "page.md",
      },
      setUp: () => {},
    },
    {
      blocker: "local_file_copy",
      page: { sourceMode: "database", sourceKind: "local-file-copy" },
      setUp: () => {},
    },
    {
      blocker: "source_owned",
      page: { sourceMode: "builder-mdx", sourceKind: "builder-doc" },
      setUp: () => {},
    },
    {
      blocker: "notion",
      setUp: async (id) => {
        await getDb()
          .insert(schema.documentSyncLinks)
          .values({
            documentId: id,
            ownerEmail,
            remotePageId: `notion-${id}`,
          });
      },
    },
    { blocker: "database_row", setUp: (id) => addToCollection(id) },
  ];

  for (const { blocker, setUp, page: columns } of cases) {
    it(`refuses a page a writer reaches without a live-copy route (${blocker}), and commits nothing`, async () => {
      const id = await insertPage(stored, columns);
      await setUp(id);

      await expect(
        as(ownerEmail, () => backfill.convertPageToLiveCopyIfDue(id, { ctx })),
      ).resolves.toEqual({
        status: "skipped",
        reason: "ineligible",
        blockers: [blocker],
      });
      if (blocker !== "source_owned") {
        const refusal = await as(ownerEmail, () =>
          setSwitch.run({ id, switched: true }, ctx),
        ).catch((error: unknown) => error);
        expect(refusal).toMatchObject({
          errorCode: "LIVE_BODY_SWITCH_INELIGIBLE",
          statusCode: 409,
          details: { blockers: [blocker] },
        });
      }
      expect(await page(id)).toMatchObject({
        content: stored,
        bodyRevision: 1,
        liveBodySwitchedAt: null,
      });
      expect(await collabVersion(id)).toBeUndefined();
      expect(await historyOperations(id)).toEqual([]);
    });
  }

  it("switches a page that is a row only of its space's Files collection, as every page is", async () => {
    const id = await insertPage(stored);
    await addToCollection(id, "files");

    await expect(
      as(ownerEmail, () => backfill.convertPageToLiveCopyIfDue(id, { ctx })),
    ).resolves.toEqual({ status: "converted" });
    expect((await page(id)).liveBodySwitchedAt).not.toBeNull();
  });

  it("refuses, under the page lock, a page that gained a Notion link after the switch checked", async () => {
    const id = await insertPage(stored);
    await getDb()
      .insert(schema.documentSyncLinks)
      .values({
        documentId: id,
        ownerEmail,
        remotePageId: `notion-${id}`,
      });
    blockerRace.cleanChecks = 1;

    const refusal = await as(ownerEmail, () =>
      switching.switchPageToLiveCopy(id, { ctx }),
    ).catch((error: unknown) => error);

    expect(blockerRace.cleanChecks).toBe(0);
    expect(refusal).toBeInstanceOf(persist.LiveBodyConversionError);
    expect(refusal).toMatchObject({ code: "ineligible", blockers: ["notion"] });
    expect(await page(id)).toMatchObject({
      content: stored,
      bodyRevision: 1,
      liveBodySwitchedAt: null,
    });
    expect(await collabVersion(id)).toBeUndefined();
  });
});

describe("a page whose live copy a tab already opened", () => {
  it("defers the page while its live copy holds text the stored body lacks, and changes neither", async () => {
    const id = await insertPage(stored);
    await openInTab(id, stored, "A note typed in a tab.");
    const version = await collabVersion(id);

    await expect(
      as(ownerEmail, () => backfill.convertPageToLiveCopyIfDue(id, { ctx })),
    ).resolves.toEqual({ status: "deferred", reason: "live_edits" });

    expect(await page(id)).toMatchObject({
      content: stored,
      bodyRevision: 1,
      liveBodySwitchedAt: null,
    });
    expect(await collabVersion(id)).toBe(version);
    const doc = new Y.Doc();
    Y.applyUpdate(doc, await collab.getState(id));
    const body = materializeLiveBody(doc);
    doc.destroy();
    expect(body).toMatchObject({ kind: "body" });
    expect(body.kind === "body" && body.markdown).toContain(
      "A note typed in a tab.",
    );
  });

  it("still lets a manual switch replace that text with the stored body, as before", async () => {
    const id = await insertPage(stored);
    await openInTab(id, stored, "A note typed in a tab.");

    await expect(
      as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx })),
    ).resolves.toEqual({ writePath: "live_copy" });
    expect((await page(id)).content).toBe(canonicalizeNfm(stored));
  });

  it("switches the page when its live copy already reads as the stored body does", async () => {
    const id = await insertPage(stored);
    await openInTab(id, stored);
    const version = await collabVersion(id);

    await expect(
      as(ownerEmail, () => backfill.convertPageToLiveCopyIfDue(id, { ctx })),
    ).resolves.toEqual({ status: "converted" });

    const row = await page(id);
    expect(row.content).toBe(canonicalizeNfm(stored));
    expect(row.liveBodySwitchedAt).not.toBeNull();
    // The copy already held that text, so it took no edit.
    expect(await collabVersion(id)).toBe(version);
    expect(row.liveCopyVersion).toBe(version);
  });
});

describe("the backfill sweep", () => {
  beforeEach(async () => {
    await getDb().delete(schema.documentSyncLinks);
    await getDb().delete(schema.contentDatabaseItems);
    await getDb().delete(schema.documents);
    await deleteSetting("content-live-body-backfill-sweep");
    await setBackfillFlag([ownerEmail]);
  });

  function sweep(now = Date.now()) {
    return backfill.runLiveBodyBackfillSweep({
      deadlineAt: Date.now() + 90_000,
      now,
    });
  }

  it("reads no pages while no one has the backfill flag on", async () => {
    const id = await insertPage(stored);
    await setBackfillFlag([]);

    await expect(sweep()).resolves.toEqual({ status: "off" });
    expect(await page(id)).toMatchObject({ liveBodySwitchedAt: null });
  });

  it("switches idle, eligible pages of owners with the flag, and passes over the rest", async () => {
    const idle = await insertPage(stored);
    const recent = await insertPage(stored, {
      updatedAt: new Date().toISOString(),
    });
    const linked = await insertPage(stored, {
      sourceMode: "local-files",
      sourceRootPath: "/docs",
      sourcePath: "linked.md",
    });
    const trashed = await insertPage(stored, { trashedAt: LONG_AGO });
    const unflagged = await insertPage(stored, { ownerEmail: writerOnlyEmail });
    const typedInTab = await insertPage(stored);
    await openInTab(typedInTab, stored, "A note typed in a tab.");

    const report = await sweep();

    expect(report).toEqual({
      status: "ran",
      scanned: 6,
      passedOver: 3,
      outcomes: {
        converted: 1,
        "skipped:flag_off": 1,
        "deferred:live_edits": 1,
      },
      failed: [],
      after: null,
      passComplete: true,
      stoppedEarly: null,
    });
    expect((await page(idle)).content).toBe(canonicalizeNfm(stored));
    for (const id of [recent, linked, trashed, unflagged, typedInTab]) {
      expect(await page(id)).toMatchObject({
        content: stored,
        liveBodySwitchedAt: null,
      });
    }
    // A full pass rests before the next.
    await expect(sweep()).resolves.toMatchObject({ status: "resting" });
    await expect(sweep(Date.now() + 61 * 60_000)).resolves.toMatchObject({
      status: "ran",
      scanned: 6,
    });
  });

  it("reads 200 pages a sweep and resumes after the last one it reached", async () => {
    await getDb()
      .insert(schema.documents)
      .values(
        Array.from({ length: 205 }, (_, index) => ({
          id: `bulk-${String(index).padStart(4, "0")}`,
          title: "Bulk page",
          content: "Short.",
          ownerEmail: writerOnlyEmail,
          bodyRevision: 1,
          createdAt: LONG_AGO,
          updatedAt: LONG_AGO,
        })),
      );

    await expect(sweep()).resolves.toMatchObject({
      scanned: 200,
      outcomes: { "skipped:flag_off": 200 },
      after: "bulk-0199",
      passComplete: false,
    });
    await expect(sweep()).resolves.toMatchObject({
      scanned: 5,
      outcomes: { "skipped:flag_off": 5 },
      after: null,
      passComplete: true,
    });
  });

  it("stops before its deadline and leaves the pages it didn't reach for the next sweep", async () => {
    const id = await insertPage(stored);

    const report = await backfill.runLiveBodyBackfillSweep({
      deadlineAt: Date.now() + 1_000,
    });

    expect(report).toMatchObject({
      status: "ran",
      scanned: 1,
      outcomes: {},
      after: null,
      passComplete: false,
      stoppedEarly: "deadline",
    });
    expect(await page(id)).toMatchObject({ liveBodySwitchedAt: null });
    await expect(sweep()).resolves.toMatchObject({
      outcomes: { converted: 1 },
      passComplete: true,
    });
  });

  it("lists a page whose flags can't be read in failed, and goes on to the next", async () => {
    const orgId = "backfill-broken-org";
    await putOrgSetting(orgId, `feature-flag:${BACKFILL}`, {
      version: 99,
    });
    const broken = await insertPage(stored, { orgId });
    const fine = await insertPage(stored);

    const report = await sweep();

    expect(report).toMatchObject({
      status: "ran",
      outcomes: { converted: 1 },
      failed: [{ documentId: broken }],
      passComplete: true,
    });
    expect(await page(broken)).toMatchObject({ liveBodySwitchedAt: null });
    expect((await page(fine)).liveBodySwitchedAt).not.toBeNull();
  });

  it("throws on sweep state it can't read rather than starting the pass over", async () => {
    await putSetting("content-live-body-backfill-sweep", {
      version: 1,
      after: 42,
      passCompletedAt: null,
    });

    await expect(sweep()).rejects.toThrow(/sweep state is unreadable/);
  });
});
