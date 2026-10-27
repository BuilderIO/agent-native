import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import {
  deleteOrgSetting,
  deleteSetting,
  getSetting,
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
import { lockLegacyBodyWrites } from "../lib/document-body-revision.js";
import { firstRow } from "../lib/first-row.js";

vi.mock("@agent-native/creative-context/server", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@agent-native/creative-context/server")
  >()),
  getGenerationCreativeContext: vi.fn(async () => null),
}));

// The change events sent to open pages. `fail` makes the next one throw, as
// a broken event bus would.
const changes = vi.hoisted(() => ({
  events: [] as Array<Record<string, unknown>>,
  fail: false,
}));

vi.mock("@agent-native/core/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-native/core/server")>()),
  recordChange: (event: Record<string, unknown>) => {
    if (changes.fail) {
      changes.fail = false;
      throw new Error("Change events are down.");
    }
    changes.events.push(event);
  },
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

// Stands in for the Notion API. `midway` runs once, inside the first Notion
// request a link makes: after the link's own check, before it writes.
const notionApi = vi.hoisted(() => ({
  linkedPageId: "0123456789abcdef0123456789abcdef",
  createdPageId: "fedcba9876543210fedcba9876543210",
  remoteContent: "Notion's copy of the page.",
  remoteEditedAt: "2026-10-01T00:00:00.000Z",
  midway: undefined as (() => Promise<void>) | undefined,
}));

vi.mock("../lib/notion.js", async (importOriginal) => {
  const notion = await importOriginal<typeof import("../lib/notion.js")>();
  const midway = async () => {
    const run = notionApi.midway;
    notionApi.midway = undefined;
    await run?.();
  };
  return {
    ...notion,
    requireNotionConnectionForOwner: async () => ({
      accessToken: "notion-test-token",
    }),
    fetchNotionPage: async (_accessToken: string, pageId: string) => {
      await midway();
      return { id: pageId, last_edited_time: notionApi.remoteEditedAt };
    },
    createNotionPageWithMarkdown: async () => {
      await midway();
      return { id: notionApi.createdPageId };
    },
    readNotionPageAsDocument: async (_accessToken: string, pageId: string) => ({
      pageId,
      title: "Legacy page",
      icon: null,
      content: notionApi.remoteContent,
      lastEditedTime: notionApi.remoteEditedAt,
      warnings: [],
    }),
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
let convertAction: typeof import("../../actions/convert-page-to-live-copy-if-due.js").default;
let notionSync: typeof import("../lib/notion-sync.js");

const ownerEmail = "backfill-owner@example.com";
// Has both of the writer's flags, but not the backfill's.
const writerOnlyEmail = "backfill-writer-only@example.com";
// Has none of the flags, so its pages take every write as main does.
const gateOffEmail = "backfill-gate-off@example.com";
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
  convertAction = (
    await import("../../actions/convert-page-to-live-copy-if-due.js")
  ).default;
  notionSync = await import("../lib/notion-sync.js");
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
  const rows = await getDb()
    .select()
    .from(schema.documents)
    .where(eq(schema.documents.id, id));
  const row = firstRow(rows);
  if (!row) throw new Error(`Page ${id} is gone.`);
  return row;
}

async function collabVersion(id: string) {
  return (await collab.loadYDocVersion(id)) ?? undefined;
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
      ...nfmToDoc(content).content,
    ],
  });
  updateYFragment(doc, fragment, root, meta);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  await as(ownerEmail, () => collab.applyUpdate(id, update));
}

/**
 * A tab committed to switched page `id`'s live copy while the owner's writer
 * was off, typing a letter and deleting it, so its text reads as before.
 */
async function commitInTabWithWriterOff(id: string) {
  const writer = "feature-flag:content.live-body-writer";
  await putSetting(writer, rulesFor([writerOnlyEmail]));
  try {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, await collab.getState(id));
    const seen = Y.encodeStateVector(doc);
    const paragraph = doc.getXmlFragment("default").get(0);
    const text = paragraph instanceof Y.XmlElement ? paragraph.get(0) : null;
    if (!(text instanceof Y.XmlText)) {
      throw new Error(`Page ${id}'s live copy has no text to type in.`);
    }
    text.insert(0, "x");
    text.delete(0, 1);
    const update = Y.encodeStateAsUpdate(doc, seen);
    doc.destroy();
    await as(ownerEmail, () => collab.applyUpdate(id, update));
  } finally {
    await putSetting(writer, rulesFor([ownerEmail, writerOnlyEmail]));
  }
}

/** The editor's read of a page as it opens, as DocumentEditor asks for it. */
function readInEditor(id: string, email = ownerEmail) {
  return as(email, () =>
    getDocumentAction.run(
      { id, includePreviewDraft: true },
      { caller: "frontend", userEmail: email },
    ),
  );
}

/** What the editor asks once it has loaded a page it can edit. */
function convertOnOpen(id: string, email = ownerEmail) {
  return as(email, () =>
    convertAction.run({ id }, { caller: "frontend", userEmail: email }),
  );
}

/**
 * Someone switched page `id` on and back off, then left it idle, so only
 * that choice keeps the backfill off it.
 */
async function sendBackToLegacy(id: string) {
  await as(ownerEmail, () => setSwitch.run({ id, switched: true }, ctx));
  await as(ownerEmail, () => setSwitch.run({ id, switched: false }, ctx));
  await getDb()
    .update(schema.documents)
    .set({ updatedAt: LONG_AGO })
    .where(eq(schema.documents.id, id));
}

describe("an editor's open", () => {
  it("reads a due page without switching it: get-document commits nothing", async () => {
    const id = await insertPage(stored);

    const opened = await readInEditor(id);

    expect(opened).toMatchObject({ content: stored, writePath: "legacy" });
    expect(await page(id)).toMatchObject({
      content: stored,
      bodyRevision: 1,
      liveBodySwitchedAt: null,
    });
    expect(await collabVersion(id)).toBeUndefined();
    expect(await historyOperations(id)).toEqual([]);
  });

  it("switches the page when the editor asks, and its next read serves the body the live copy writes", async () => {
    const id = await insertPage(stored);
    await readInEditor(id);

    await expect(convertOnOpen(id)).resolves.toEqual({
      id,
      status: "converted",
    });

    const canonical = canonicalizeNfm(stored);
    expect(canonical).not.toBe(stored);
    await expect(readInEditor(id)).resolves.toMatchObject({
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
    await expect(convertOnOpen(id)).resolves.toEqual({
      id,
      status: "current",
    });
  });

  it("sends the sweep's change event for a page it switched, so other tabs read it again, and none when it switches nothing", async () => {
    const id = await insertPage(stored);
    await addToCollection(id, "files");
    changes.events.length = 0;

    await expect(convertOnOpen(id)).resolves.toMatchObject({
      status: "converted",
    });
    expect(
      changes.events.map((event) => [event.key, event.resourceId]),
    ).toEqual([
      ["update-document", id],
      ["update-document", `database-page-${id}`],
    ]);

    changes.events.length = 0;
    await expect(convertOnOpen(id)).resolves.toMatchObject({
      status: "current",
    });
    expect(changes.events).toEqual([]);
  });

  it("opens the page and reports a typed, logged failure when the switch throws", async () => {
    const orgId = "backfill-open-broken-org";
    await putOrgSetting(orgId, `feature-flag:${BACKFILL}`, { version: 99 });
    const id = await insertPage(stored, { orgId });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const refusal = await convertOnOpen(id).catch((error: unknown) => error);

      expect(refusal).toMatchObject({
        errorCode: "LIVE_BODY_BACKFILL_FAILED",
        statusCode: 500,
        details: { documentId: id },
      });
      expect(logged).toHaveBeenCalledWith(
        `[convert-page-to-live-copy-if-due] page ${id} failed:`,
        expect.any(Error),
      );
    } finally {
      logged.mockRestore();
    }
    await expect(readInEditor(id)).resolves.toMatchObject({
      id,
      content: stored,
      writePath: "legacy",
    });
    expect(await page(id)).toMatchObject({ liveBodySwitchedAt: null });
  });

  it("refuses someone who can't edit the page, and changes nothing", async () => {
    const id = await insertPage(stored);

    await expect(
      convertOnOpen(id, "backfill-stranger@example.com"),
    ).rejects.toThrow();
    expect(await page(id)).toMatchObject({
      bodyRevision: 1,
      liveBodySwitchedAt: null,
    });
  });

  it("leaves the page alone while its owner lacks the backfill flag, as main does (SF-11)", async () => {
    const id = await insertPage(stored, { ownerEmail: writerOnlyEmail });

    await expect(convertOnOpen(id, writerOnlyEmail)).resolves.toEqual({
      id,
      status: "skipped",
      reason: "flag_off",
    });
    expect(await page(id)).toMatchObject({
      content: stored,
      liveBodySwitchedAt: null,
    });
  });

  it("leaves a page some source owns on its writer", async () => {
    const id = await insertPage(stored, {
      sourceMode: "github",
      sourceRootPath: "github:example/docs@main",
      sourcePath: "docs/page.md",
    });

    await expect(convertOnOpen(id)).resolves.toEqual({
      id,
      status: "skipped",
      reason: "ineligible",
      blockers: ["source_owned"],
    });
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

  it("leaves a page linked to a local file to the switch's own local_file refusal, and commits nothing", async () => {
    const id = await insertPage(stored, {
      sourceMode: "local-files",
      sourceRootPath: "/docs",
      sourcePath: "page.md",
    });

    await expect(
      as(ownerEmail, () => backfill.convertPageToLiveCopyIfDue(id, { ctx })),
    ).resolves.toEqual({ status: "skipped", reason: "local_file" });
    const refusal = await as(ownerEmail, () =>
      setSwitch.run({ id, switched: true }, ctx),
    ).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      errorCode: "LIVE_BODY_SWITCH_LOCAL_FILE",
      statusCode: 409,
    });
    expect(await page(id)).toMatchObject({
      content: stored,
      bodyRevision: 1,
      liveBodySwitchedAt: null,
    });
    expect(await collabVersion(id)).toBeUndefined();
    expect(await historyOperations(id)).toEqual([]);
  });

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

  it("defers the page when a tab deleted all of its text, since that empty body is an edit", async () => {
    const id = await insertPage(stored);
    await openInTab(id, stored);
    // Select all and delete: the editor keeps one empty paragraph.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, await collab.getState(id));
    const fragment = doc.getXmlFragment("default");
    const { meta } = initProseMirrorDoc(fragment, editorSchema);
    const before = Y.encodeStateVector(doc);
    updateYFragment(
      doc,
      fragment,
      editorSchema.nodeFromJSON({
        type: "doc",
        content: [{ type: "paragraph" }],
      }),
      meta,
    );
    const update = Y.encodeStateAsUpdate(doc, before);
    doc.destroy();
    await as(ownerEmail, () => collab.applyUpdate(id, update));
    const version = await collabVersion(id);

    await expect(
      as(ownerEmail, () => backfill.convertPageToLiveCopyIfDue(id, { ctx })),
    ).resolves.toEqual({ status: "deferred", reason: "live_edits" });

    expect(await page(id)).toMatchObject({
      content: stored,
      liveBodySwitchedAt: null,
    });
    expect(await collabVersion(id)).toBe(version);
    const live = new Y.Doc();
    Y.applyUpdate(live, await collab.getState(id));
    expect(materializeLiveBody(live)).toMatchObject({ kind: "body" });
    live.destroy();
  });

  it("still lets a manual switch replace that text with the stored body, as before", async () => {
    const id = await insertPage(stored);
    await openInTab(id, stored, "A note typed in a tab.");

    await expect(
      as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx })),
    ).resolves.toEqual({ writePath: "live_copy" });
    expect((await page(id)).content).toBe(canonicalizeNfm(stored));
  });

  /**
   * Writes page `id`'s body the legacy way while the owner's writer is off,
   * as every legacy writer does, which leaves its live copy behind.
   */
  async function legacySaveWithWriterOff(id: string, content: string) {
    const writer = "feature-flag:content.live-body-writer";
    await putSetting(writer, rulesFor([writerOnlyEmail]));
    try {
      await getDb().transaction(async (tx) => {
        const legacy = await lockLegacyBodyWrites(tx, [id], {
          operation: "update-document",
          content,
        });
        await tx
          .update(schema.documents)
          .set({ content, bodyRevision: legacy.bodyRevision(content) })
          .where(eq(schema.documents.id, id));
      });
    } finally {
      await putSetting(writer, rulesFor([ownerEmail, writerOnlyEmail]));
    }
    const behind = await page(id);
    expect(behind.content).toBe(content);
    expect(behind.collabBodyRevision).not.toBe(behind.bodyRevision);
  }

  it("replaces a live copy that legacy saves left behind while the writer was off, since nothing edited it", async () => {
    const id = await insertPage(stored);
    await as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx }));
    const saved = "Saved while the writer was off.";
    await legacySaveWithWriterOff(id, saved);

    await expect(convertOnOpen(id)).resolves.toMatchObject({
      status: "converted",
    });

    const row = await page(id);
    expect(row.content).toBe(saved);
    expect(row.collabBodyRevision).toBe(row.bodyRevision);
    expect(row.liveCopyVersion).toBe(await collabVersion(id));
    const doc = new Y.Doc();
    Y.applyUpdate(doc, await collab.getState(id));
    expect(materializeLiveBody(doc)).toMatchObject({
      kind: "body",
      markdown: saved,
    });
    doc.destroy();
  });

  it("still defers that page when a tab edited its live copy after those saves", async () => {
    const id = await insertPage(stored);
    await as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx }));
    await legacySaveWithWriterOff(id, "Saved while the writer was off.");
    await openInTab(id, stored, "A note typed in a tab.");
    const version = await collabVersion(id);

    await expect(convertOnOpen(id)).resolves.toMatchObject({
      status: "deferred",
      reason: "live_edits",
    });
    expect(await collabVersion(id)).toBe(version);
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

describe("a Notion link racing a switch", () => {
  async function linkRow(id: string) {
    const [row] = await getDb()
      .select()
      .from(schema.documentSyncLinks)
      .where(eq(schema.documentSyncLinks.documentId, id));
    return row;
  }

  function switchMidway(id: string) {
    notionApi.midway = async () => {
      await switching.switchPageToLiveCopy(id, { ctx });
    };
  }

  it("refuses a link whose page switched after the link's own check, and installs no link", async () => {
    const id = await insertPage(stored);
    switchMidway(id);

    const refusal = await as(ownerEmail, () =>
      notionSync.linkDocumentToNotionPage(
        ownerEmail,
        id,
        notionApi.linkedPageId,
      ),
    ).catch((error: unknown) => error);

    expect(notionApi.midway).toBeUndefined();
    expect(refusal).toMatchObject({
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      statusCode: 409,
      details: { documentId: id, operation: "Notion link" },
    });
    expect(await linkRow(id)).toBeUndefined();
    expect((await page(id)).liveBodySwitchedAt).not.toBeNull();
  });

  it("keeps the link to the Notion page it made when its page switched meanwhile, and says so", async () => {
    const id = await insertPage(stored);
    switchMidway(id);

    const refusal = await as(ownerEmail, () =>
      notionSync.createAndLinkNotionPage(
        ownerEmail,
        id,
        notionApi.linkedPageId,
      ),
    ).catch((error: unknown) => error);

    expect(notionApi.midway).toBeUndefined();
    expect(refusal).toMatchObject({
      errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
      statusCode: 409,
      details: {
        documentId: id,
        operation: "Notion link",
        remotePageId: notionApi.createdPageId,
      },
      message: expect.stringContaining("and linked it"),
    });
    // A retry finds this link instead of making another Notion page.
    expect(await linkRow(id)).toMatchObject({
      remotePageId: notionApi.createdPageId,
    });
    const switched = await page(id);
    expect(switched.liveBodySwitchedAt).not.toBeNull();
    expect(switched.content).not.toBe(notionApi.remoteContent);
  });

  it("refuses the next pull and push, typed, on a switched page that has a link anyway", async () => {
    const id = await insertPage(stored);
    await as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx }));
    await getDb().insert(schema.documentSyncLinks).values({
      documentId: id,
      ownerEmail,
      remotePageId: notionApi.linkedPageId,
    });
    const switched = await page(id);

    for (const write of [
      () => notionSync.pullDocumentFromNotion(ownerEmail, id, true),
      () => notionSync.pushDocumentToNotion(ownerEmail, id, true),
    ]) {
      await expect(as(ownerEmail, write)).rejects.toMatchObject({
        errorCode: "LIVE_BODY_WRITER_UNSUPPORTED",
        statusCode: 409,
      });
    }
    expect(await page(id)).toMatchObject({
      content: switched.content,
      bodyRevision: switched.bodyRevision,
    });
  });

  it("links and pulls as before for an owner without the writer's flags", async () => {
    const id = await insertPage(stored, { ownerEmail: gateOffEmail });

    await as(gateOffEmail, () =>
      notionSync.linkDocumentToNotionPage(
        gateOffEmail,
        id,
        notionApi.linkedPageId,
      ),
    );

    expect(await linkRow(id)).toMatchObject({
      remotePageId: notionApi.linkedPageId,
    });
    expect((await page(id)).content).toBe(notionApi.remoteContent);
  });
});

describe("a page sent back to legacy", () => {
  it("stays there when an editor opens it", async () => {
    const id = await insertPage(stored);
    await sendBackToLegacy(id);
    const before = await page(id);
    expect(before.liveBodyOptedOutAt).not.toBeNull();

    await expect(convertOnOpen(id)).resolves.toEqual({
      id,
      status: "skipped",
      reason: "opted_out",
    });
    expect(await page(id)).toEqual(before);
  });

  it("is skipped before its owner's flags are read, so opening it never tries a switch", async () => {
    const id = await insertPage(stored);
    await sendBackToLegacy(id);
    const flagsOn = vi.fn(async () => true);

    await expect(
      as(ownerEmail, () =>
        backfill.convertPageToLiveCopyIfDue(id, { ctx, flagsOn }),
      ),
    ).resolves.toEqual({ status: "skipped", reason: "opted_out" });
    expect(flagsOn).not.toHaveBeenCalled();
  });

  it("is refused under the page lock when it went back after the backfill checked", async () => {
    const id = await insertPage(stored);
    await sendBackToLegacy(id);
    const before = await page(id);

    const refusal = await as(ownerEmail, () =>
      switching.switchPageToLiveCopy(id, {
        ctx,
        keepLiveEdits: true,
        unlessOptedOut: true,
      }),
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(persist.LiveBodyConversionError);
    expect(refusal).toMatchObject({ code: "opted_out" });
    expect(await page(id)).toEqual(before);
  });

  it("takes the backfill again once someone switches it on", async () => {
    const id = await insertPage(stored);
    await sendBackToLegacy(id);

    await as(ownerEmail, () => setSwitch.run({ id, switched: true }, ctx));

    const switched = await page(id);
    expect(switched.liveBodySwitchedAt).not.toBeNull();
    expect(switched.liveBodyOptedOutAt).toBeNull();
  });
});

describe("a primary Blocks value on a switched Files row", () => {
  // A Files row's primary Blocks field is the page's body, which the
  // collection bulk editor and agents write with set-document-property.
  async function switchedFilesRow() {
    const id = await insertPage(stored);
    await addToCollection(id, "files");
    await insertPage("", { id: `database-page-${id}` });
    const { seedDefaultBlocksField } =
      await import("../../actions/_property-utils.js");
    const propertyId = await seedDefaultBlocksField({
      databaseId: `database-${id}`,
      ownerEmail,
      orgId: null,
      now: new Date().toISOString(),
    });
    if (propertyId === null) {
      throw new Error(`Collection database-${id} got no primary Blocks field.`);
    }
    await as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx }));
    return { id, databaseId: `database-${id}`, propertyId };
  }

  async function setPrimary(
    row: Awaited<ReturnType<typeof switchedFilesRow>>,
    value: string,
    expectedBlocksFieldRevision?: number,
  ) {
    const setProperty = (await import("../../actions/set-document-property.js"))
      .default;
    return as(ownerEmail, () =>
      setProperty.run(
        {
          documentId: row.id,
          databaseId: row.databaseId,
          propertyId: row.propertyId,
          value,
          expectedBlocksFieldRevision,
        },
        ctx,
      ),
    );
  }

  async function fieldRevision(
    row: Awaited<ReturnType<typeof switchedFilesRow>>,
  ) {
    const { readBlocksFieldIdentity } =
      await import("../../actions/_blocks-field-identity.js");
    const identity = await readBlocksFieldIdentity({
      documentId: row.id,
      propertyId: row.propertyId,
      markdown: (await page(row.id)).content,
    });
    return identity.revision;
  }

  it("writes it through the page's live copy instead of refusing it", async () => {
    const row = await switchedFilesRow();
    const before = await page(row.id);
    const revision = await fieldRevision(row);

    await setPrimary(row, "The bulk editor wrote this.", revision);

    const after = await page(row.id);
    expect(after.content).toBe("The bulk editor wrote this.");
    expect(after.bodyRevision).toBeGreaterThan(before.bodyRevision);
    expect(after.collabBodyRevision).toBe(after.bodyRevision);
    expect(after.liveCopyVersion).toBe(await collabVersion(row.id));
    expect(before.liveCopyVersion).not.toBeNull();
    expect(after.liveCopyVersion).toBeGreaterThan(
      Number(before.liveCopyVersion),
    );
    expect(await fieldRevision(row)).toBeGreaterThan(revision);
  });

  it("refuses a value that gives two videos one id, as the legacy path does", async () => {
    const row = await switchedFilesRow();
    const before = await page(row.id);
    const copied = `Copied a video.\n<video src="https://example.com/a.mp4" id="video-copied01"></video>\n<video src="https://example.com/b.mp4" id="video-copied01"></video>`;

    await expect(setPrimary(row, copied)).rejects.toMatchObject({
      errorCode: "DOCUMENT_VIDEO_ID_SHARED",
    });

    const after = await page(row.id);
    expect(after.content).toBe(before.content);
    expect(after.bodyRevision).toBe(before.bodyRevision);
    expect(after.liveCopyVersion).toBe(before.liveCopyVersion);
  });

  it("answers with the body it stored, in the live copy's form, and that body's hash and blocks", async () => {
    const row = await switchedFilesRow();
    const input = "First line.\n\n\n\nSecond line.";

    const result = (await setPrimary(row, input, await fieldRevision(row))) as {
      properties: Array<{
        definition: { id: string };
        value: unknown;
        blocksField?: unknown;
      }>;
    };

    const { content } = await page(row.id);
    expect(content).not.toBe(input);
    const { readBlocksFieldIdentity } =
      await import("../../actions/_blocks-field-identity.js");
    const primary = result.properties.find(
      (property) => property.definition.id === row.propertyId,
    );
    expect(primary).toMatchObject({
      value: content,
      blocksField: await readBlocksFieldIdentity({
        documentId: row.id,
        propertyId: row.propertyId,
        markdown: content,
      }),
    });
  });

  it("refuses a write that names a stale field revision, and leaves the page as it was", async () => {
    const row = await switchedFilesRow();
    const before = await page(row.id);

    await expect(
      setPrimary(row, "A stale write.", (await fieldRevision(row)) + 1),
    ).rejects.toThrow(/Blocks field revision conflict/);

    expect(await page(row.id)).toEqual(before);
    expect(await collabVersion(row.id)).toBe(before.liveCopyVersion);
  });

  it("refuses, under the page lock, a write whose field revision moved while the body went back to the text it read", async () => {
    const row = await switchedFilesRow();
    const read = await page(row.id);
    const revision = await fieldRevision(row);
    await setPrimary(row, "Someone else's edit.");
    await setPrimary(row, read.content);
    const before = await page(row.id);
    expect(before.content).toBe(read.content);
    const { editContentLiveCopy } = await import("./write.js");
    const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");

    await expect(
      as(ownerEmail, () =>
        editContentLiveCopy(row.id, {
          cause: {
            ctx,
            operation: "set-document-property",
            lockCollections: [row.databaseId],
            expectedBlocksFieldRevision: {
              propertyId: row.propertyId,
              revision,
            },
          },
          edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: { content: "A stale write.", expected: read.content },
        }),
      ),
    ).rejects.toThrow(/Blocks field revision conflict/);
    expect(await page(row.id)).toEqual(before);
    expect(await collabVersion(row.id)).toBe(before.liveCopyVersion);
  });

  it("refuses it when a source owns the field, as the legacy path does, and leaves the page as it was", async () => {
    const row = await switchedFilesRow();
    const now = new Date().toISOString();
    await getDb()
      .insert(schema.contentDatabaseSources)
      .values({
        id: `source-${row.id}`,
        ownerEmail,
        databaseId: row.databaseId,
        sourceType: "local-table",
        sourceName: "Upstream",
        sourceTable: `upstream-${row.id}`,
        createdAt: now,
        updatedAt: now,
      });
    await getDb()
      .insert(schema.contentDatabaseSourceFields)
      .values({
        id: `source-field-${row.id}`,
        ownerEmail,
        sourceId: `source-${row.id}`,
        propertyId: row.propertyId,
        localFieldKey: row.propertyId,
        sourceFieldKey: "body",
        sourceFieldLabel: "Body",
        sourceFieldType: "text",
        writeOwner: "source",
        readOnly: 1,
        createdAt: now,
        updatedAt: now,
      });
    const before = await page(row.id);

    await expect(
      setPrimary(row, "A write the source owns.", await fieldRevision(row)),
    ).rejects.toMatchObject({ errorCode: "PROPERTY_NOT_WRITABLE" });

    expect(await page(row.id)).toEqual(before);
    expect(await collabVersion(row.id)).toBe(before.liveCopyVersion);
  });

  it("refuses a write whose collection is gone when its commit locks it, and commits nothing", async () => {
    const row = await switchedFilesRow();
    const before = await page(row.id);
    const { editContentLiveCopy } = await import("./write.js");
    const { CONTENT_LIVE_COPY_EDITS } = await import("./binding.js");

    await expect(
      as(ownerEmail, () =>
        editContentLiveCopy(row.id, {
          cause: {
            ctx,
            operation: "set-document-property",
            lockCollections: [`gone-${row.databaseId}`],
          },
          edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
          input: {
            content: "A write to a gone collection.",
            expected: before.content,
          },
        }),
      ),
    ).rejects.toMatchObject({ errorCode: "DOCUMENT_METADATA_SCOPE_CHANGED" });
    expect(await page(row.id)).toEqual(before);
    expect(await collabVersion(row.id)).toBe(before.liveCopyVersion);
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

  async function sweepState() {
    return (await getSetting("content-live-body-backfill-sweep")) as {
      after: string | null;
      inFlight: { documentId: string } | null;
      held: Record<
        string,
        { reason: string; attempts: number; retryAfter: string }
      >;
      overHoldLimit: { pages: number; lastDocumentId: string } | null;
    } | null;
  }

  it("resumes after the last page it finished when a sweep dies mid-batch, and holds the page it died on", async () => {
    const [first, second, dying, last] = [
      await insertPage(stored, { id: "interrupt-1" }),
      await insertPage(stored, { id: "interrupt-2" }),
      await insertPage(stored, { id: "interrupt-3" }),
      await insertPage(stored, { id: "interrupt-4" }),
    ];
    let reachedDying!: () => void;
    const dyingReached = new Promise<void>((resolve) => {
      reachedDying = resolve;
    });
    const tried: string[] = [];
    // Never awaited: this sweep's process is killed while it converts `dying`.
    void backfill.runLiveBodyBackfillSweep({
      deadlineAt: Date.now() + 90_000,
      convert: (id, options) => {
        tried.push(id);
        if (id !== dying)
          return backfill.convertPageToLiveCopyIfDue(id, options);
        reachedDying();
        return new Promise(() => {});
      },
    });
    await dyingReached;
    expect(await sweepState()).toMatchObject({
      after: second,
      inFlight: { documentId: dying },
    });

    // Its lease still runs, so another sweep stays off the pass.
    await expect(sweep()).resolves.toMatchObject({ status: "busy" });

    const later = Date.now() + 2 * 60_000;
    const report = await sweep(later);

    expect(report).toMatchObject({
      status: "ran",
      scanned: 2,
      held: 1,
      interrupted: dying,
      outcomes: { converted: 1 },
      failed: [],
      passComplete: true,
    });
    expect(tried).toEqual([first, second, dying]);
    for (const id of [first, second, last]) {
      expect((await page(id)).liveBodySwitchedAt).not.toBeNull();
    }
    expect(await page(dying)).toMatchObject({ liveBodySwitchedAt: null });
    expect((await sweepState())?.held).toEqual({
      [dying]: {
        reason: "interrupted",
        error: null,
        attempts: 1,
        retryAfter: new Date(later + 60 * 60_000).toISOString(),
      },
    });
  });

  it("doesn't hold a page it finished when a sweep dies before the next one", async () => {
    const [finished, next] = [
      await insertPage(stored, { id: "dies-between-1" }),
      await insertPage(stored, { id: "dies-between-2" }),
    ];
    let pagesStarted = 0;
    // The process dies as the sweep moves on to the second page.
    const dies = {
      get aborted() {
        pagesStarted += 1;
        if (pagesStarted === 2) throw new Error("killed");
        return false;
      },
    } as unknown as AbortSignal;
    await expect(
      backfill.runLiveBodyBackfillSweep({
        deadlineAt: Date.now() + 90_000,
        signal: dies,
      }),
    ).rejects.toThrow("killed");
    expect(await sweepState()).toMatchObject({
      after: finished,
      inFlight: null,
    });

    const report = await sweep(Date.now() + 2 * 60_000);

    expect(report).toMatchObject({
      status: "ran",
      scanned: 1,
      held: 0,
      interrupted: null,
      outcomes: { converted: 1 },
      passComplete: true,
    });
    for (const id of [finished, next]) {
      expect((await page(id)).liveBodySwitchedAt).not.toBeNull();
    }
    expect((await sweepState())?.held).toEqual({});
  });

  it("holds a page that keeps failing until its retry time, and the pass goes on without it", async () => {
    const failing = await insertPage(stored, { id: "keeps-failing-1" });
    const fine = await insertPage(stored, { id: "keeps-failing-2" });
    const tried: string[] = [];
    const convert: typeof backfill.convertPageToLiveCopyIfDue = (
      id,
      options,
    ) => {
      tried.push(id);
      if (id === failing) throw new Error("The conversion broke.");
      return backfill.convertPageToLiveCopyIfDue(id, options);
    };
    const run = (now: number) =>
      backfill.runLiveBodyBackfillSweep({
        deadlineAt: Date.now() + 90_000,
        now,
        convert,
      });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const start = Date.now();
      await expect(run(start)).resolves.toMatchObject({
        outcomes: { converted: 1 },
        failed: [{ documentId: failing, error: "The conversion broke." }],
        held: 0,
        passComplete: true,
      });
      expect((await sweepState())?.held[failing]).toEqual({
        reason: "failed",
        error: "The conversion broke.",
        attempts: 1,
        retryAfter: new Date(start + 60 * 60_000).toISOString(),
      });

      // Its hour is up by the next pass, so that pass tries it again, and
      // waits two hours after this failure.
      const nextPass = start + 61 * 60_000;
      await expect(run(nextPass)).resolves.toMatchObject({
        failed: [{ documentId: failing }],
        held: 0,
        passComplete: true,
      });
      expect((await sweepState())?.held[failing]).toMatchObject({
        attempts: 2,
        retryAfter: new Date(nextPass + 2 * 60 * 60_000).toISOString(),
      });

      // The pass after that passes over it.
      await expect(run(nextPass + 61 * 60_000)).resolves.toMatchObject({
        failed: [],
        held: 1,
        passComplete: true,
      });
      expect(tried).toEqual([failing, fine, failing]);
      expect(
        logged.mock.calls.filter(([message]) =>
          String(message).startsWith("[content-live-body-backfill] page"),
        ),
      ).toHaveLength(2);
    } finally {
      logged.mockRestore();
    }
    expect((await page(fine)).liveBodySwitchedAt).not.toBeNull();
    expect(await page(failing)).toMatchObject({ liveBodySwitchedAt: null });
  });

  it("goes past a page that fails once 100 pages are held, counts it, and still finishes the pass", async () => {
    const retryAfter = new Date(Date.now() + 60 * 60_000).toISOString();
    await putSetting("content-live-body-backfill-sweep", {
      version: 2,
      after: null,
      passCompletedAt: null,
      run: null,
      inFlight: null,
      // Pages held by earlier passes and deleted since.
      held: Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `deleted-held-${String(index).padStart(3, "0")}`,
          { reason: "failed", error: "It broke.", attempts: 1, retryAfter },
        ]),
      ),
    });
    const failing = await insertPage(stored, { id: "over-limit-1" });
    const fine = await insertPage(stored, { id: "over-limit-2" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const report = await backfill.runLiveBodyBackfillSweep({
        deadlineAt: Date.now() + 90_000,
        convert: (id, options) => {
          if (id === failing) throw new Error("The conversion broke.");
          return backfill.convertPageToLiveCopyIfDue(id, options);
        },
      });

      expect(report).toMatchObject({
        status: "ran",
        outcomes: { converted: 1, hold_limit: 1 },
        failed: [{ documentId: failing, error: "The conversion broke." }],
        after: null,
        passComplete: true,
        overHoldLimit: {
          pages: 1,
          lastDocumentId: failing,
          lastError: "The conversion broke.",
        },
        stoppedEarly: null,
      });
      expect(
        logged.mock.calls.filter(([message]) =>
          String(message).includes(
            `page ${failing} is passed without being held`,
          ),
        ),
      ).toHaveLength(1);
    } finally {
      logged.mockRestore();
    }
    // The pass finished, so it dropped the held pages that were deleted.
    expect(await sweepState()).toMatchObject({
      after: null,
      held: {},
      overHoldLimit: { pages: 1, lastDocumentId: failing },
    });
    expect((await page(fine)).liveBodySwitchedAt).not.toBeNull();
    expect(await page(failing)).toMatchObject({ liveBodySwitchedAt: null });

    // The next pass starts its own count, and switches the page.
    await expect(sweep(Date.now() + 61 * 60_000)).resolves.toMatchObject({
      outcomes: { converted: 1 },
      overHoldLimit: null,
    });
  });

  it("sends a switched page's change event to its readers and to the collections that list it, under the key a body save sends", async () => {
    const id = await insertPage(stored);
    await addToCollection(id, "files");
    changes.events.length = 0;

    await expect(sweep()).resolves.toMatchObject({
      outcomes: { converted: 1 },
    });

    const event = {
      source: "action",
      type: "change",
      key: "update-document",
      owner: ownerEmail,
      resourceType: "document",
    };
    expect(changes.events).toEqual([
      { ...event, resourceId: id },
      { ...event, resourceId: `database-page-${id}` },
    ]);
  });

  it("sends that change event for a page switched before its gate moved, too", async () => {
    const id = await insertPage(stored);
    await addToCollection(id, "files");
    changes.events.length = 0;

    await expect(
      backfill.runLiveBodyBackfillSweep({
        deadlineAt: Date.now() + 90_000,
        now: Date.now(),
        convert: async () => ({
          status: "deferred" as const,
          reason: "gate_moved" as const,
          gate: "flag_off" as const,
        }),
      }),
    ).resolves.toMatchObject({ outcomes: { "deferred:gate_moved": 1 } });

    expect(changes.events.map((event) => event.resourceId)).toEqual([
      id,
      `database-page-${id}`,
    ]);
  });

  it("counts and logs a change event that fails, and doesn't hold the page it switched", async () => {
    const id = await insertPage(stored);
    changes.fail = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      await expect(sweep()).resolves.toMatchObject({
        outcomes: { converted: 1, change_event_failed: 1 },
        failed: [],
        passComplete: true,
      });
      expect(
        logged.mock.calls.filter(([message]) =>
          String(message).includes(
            `page ${id} switched, but its change event failed`,
          ),
        ),
      ).toHaveLength(1);
    } finally {
      changes.fail = false;
      logged.mockRestore();
    }
    expect((await page(id)).liveBodySwitchedAt).not.toBeNull();
    expect((await sweepState())?.held).toEqual({});
  });

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
      held: 0,
      interrupted: null,
      outcomes: {
        converted: 1,
        "skipped:flag_off": 1,
        "deferred:live_edits": 1,
      },
      failed: [],
      after: null,
      passComplete: true,
      overHoldLimit: null,
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

  it("passes over a page sent back to legacy, so it stays there", async () => {
    const id = await insertPage(stored);
    await sendBackToLegacy(id);
    const before = await page(id);

    const report = await sweep();

    expect(report).toMatchObject({
      status: "ran",
      scanned: 1,
      passedOver: 1,
      outcomes: {},
      failed: [],
    });
    expect(await page(id)).toEqual(before);
  });

  it("switches again a page whose tab committed to its live copy while the writer was off, and passes over one in step", async () => {
    const committed = await insertPage(stored);
    const inStep = await insertPage(stored);
    for (const id of [committed, inStep]) {
      await as(ownerEmail, () => switching.switchPageToLiveCopy(id, { ctx }));
    }
    await commitInTabWithWriterOff(committed);
    const behind = await page(committed);
    expect(behind.collabBodyRevision).toBe(behind.bodyRevision);
    expect(behind.liveCopyVersion).not.toBe(await collabVersion(committed));
    const steady = await page(inStep);

    const report = await sweep(Date.now() + 11 * 60_000);

    expect(report).toMatchObject({
      status: "ran",
      scanned: 2,
      passedOver: 1,
      outcomes: { converted: 1 },
      failed: [],
    });
    const after = await page(committed);
    expect(after.content).toBe(behind.content);
    expect(after.collabBodyRevision).toBe(after.bodyRevision);
    expect(after.liveCopyVersion).toBe(await collabVersion(committed));
    expect(await page(inStep)).toEqual(steady);
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
    expect((await sweepState())?.held[broken]).toMatchObject({
      reason: "failed",
      attempts: 1,
    });
    expect((await page(fine)).liveBodySwitchedAt).not.toBeNull();
  });

  it("reads a scope's flags again after a read fails, so one failure doesn't fail its later pages", async () => {
    const orgId = "backfill-flaky-org";
    await putOrgSetting(orgId, `feature-flag:${BACKFILL}`, { version: 99 });
    const first = await insertPage(stored, { orgId });
    const between = await insertPage(stored);
    const second = await insertPage(stored, { orgId });

    const report = await backfill.runLiveBodyBackfillSweep({
      deadlineAt: Date.now() + 90_000,
      now: Date.now(),
      convert: async (id, options) => {
        // The org's flags read again once the first page's read has failed.
        if (id === between) {
          await deleteOrgSetting(orgId, `feature-flag:${BACKFILL}`);
        }
        return backfill.convertPageToLiveCopyIfDue(id, options);
      },
    });

    expect(report).toMatchObject({
      outcomes: { converted: 2 },
      failed: [{ documentId: first }],
    });
    expect((await page(second)).liveBodySwitchedAt).not.toBeNull();
  });

  it("throws on sweep state it can't read rather than starting the pass over", async () => {
    await putSetting("content-live-body-backfill-sweep", {
      version: 2,
      after: 42,
      passCompletedAt: null,
      run: null,
      inFlight: null,
      held: {},
    });

    await expect(sweep()).rejects.toThrow(/sweep state is unreadable/);
  });
});
