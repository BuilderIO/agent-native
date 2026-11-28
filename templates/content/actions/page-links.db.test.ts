// guard:allow-unscoped — isolated PGlite fixtures intentionally inspect rows directly.
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { registerLabs } from "@agent-native/core/labs/registry";
import { runWithRequestContext } from "@agent-native/core/server";
import { mutateSetting } from "@agent-native/core/settings";
import { CREATIVE_CONTEXT_LIBRARY_LAB } from "@agent-native/creative-context";
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
  `content-page-links-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "backlinks-owner@example.test";
const VIEWER = "backlinks-viewer@example.test";
const STRANGER = "backlinks-stranger@example.test";
const ORG_ID = "backlinks-org";
const NOTION_KEY = "fedcba9876543210fedcba9876543210";

type Schema = typeof import("../server/db/schema.js");
type Action = {
  run: (
    args: Record<string, unknown>,
    ctx?: Record<string, unknown>,
  ) => Promise<unknown>;
};
type Backlinks = {
  pages: Array<{
    id: string;
    title: string;
    icon: string | null;
    url: string;
    updatedAt: string;
  }>;
  count: number;
  more: boolean;
};
let getDb: typeof import("../server/db/index.js").getDb;
let schema: Schema;
let syncPrivateBodyReferences: typeof import("../server/lib/private-icon-references.js").syncPrivateBodyReferences;
let backfill: typeof import("../server/lib/page-links-backfill.js");
let deleteDocumentRecursive: typeof import("./delete-document.js").deleteDocumentRecursive;
let updateDocument: Action;
let editDocument: Action;
let listBacklinks: Action;
let count = 0;

beforeAll(async () => {
  registerLabs([CREATIVE_CONTEXT_LIBRARY_LAB]);
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  ({ syncPrivateBodyReferences } =
    await import("../server/lib/private-icon-references.js"));
  backfill = await import("../server/lib/page-links-backfill.js");
  ({ deleteDocumentRecursive } = await import("./delete-document.js"));
  updateDocument = (await import("./update-document.js")).default as Action;
  editDocument = (await import("./edit-document.js")).default as Action;
  listBacklinks = (await import("./list-backlinks.js")).default as Action;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as never);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

function linksTo(...ids: string[]): string {
  return [
    "# Notes",
    ...ids.map((id) => `See [page ${id}](/page/${id}).`),
    "The end.",
  ].join("\n\n");
}

async function page(
  options: {
    content?: string;
    ownerEmail?: string;
    parentId?: string;
    trashedAt?: string;
    updatedAt?: string;
    id?: string;
  } = {},
) {
  const id = options.id ?? `backlinks-doc-${++count}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      ownerEmail: options.ownerEmail ?? OWNER,
      orgId: ORG_ID,
      parentId: options.parentId ?? null,
      title: `Page ${count}`,
      content: options.content ?? "",
      position: count,
      visibility: "private",
      trashedAt: options.trashedAt ?? null,
      createdAt: now,
      updatedAt: options.updatedAt ?? now,
    });
  return id;
}

async function share(documentId: string, email: string) {
  await getDb()
    .insert(schema.documentShares)
    .values({
      id: `share-${crypto.randomUUID()}`,
      resourceId: documentId,
      principalType: "user",
      principalId: email,
      role: "viewer",
      createdBy: OWNER,
      createdAt: new Date().toISOString(),
    });
}

async function targetsOf(documentId: string): Promise<string[]> {
  const rows: Array<{ targetDocumentId: string }> = await getDb()
    .select({ targetDocumentId: schema.pageLinks.targetDocumentId })
    .from(schema.pageLinks)
    .where(eq(schema.pageLinks.sourceDocumentId, documentId));
  return rows.map((row) => row.targetDocumentId).sort();
}

function as<T>(email: string | undefined, run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: email, orgId: ORG_ID }, run);
}

function save(documentId: string, before: string, after: string) {
  return syncPrivateBodyReferences(getDb(), {
    documentId,
    before,
    after,
    userEmail: OWNER,
    ownerEmail: OWNER,
    orgId: ORG_ID,
  });
}

function list(email: string | undefined, documentId: string) {
  return as(
    email,
    () => listBacklinks.run({ documentId }) as Promise<Backlinks>,
  );
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return {
      errorCode: (error as { errorCode?: string }).errorCode,
      statusCode: (error as { statusCode?: number }).statusCode,
    };
  }
  throw new Error("expected the action to fail");
}

describe("recording a page's links as its body saves", () => {
  it("makes a page's links match the pages its saved body links to", async () => {
    const first = await page();
    const second = await page();
    const third = await page();
    const source = await page();

    const linked = linksTo(first, second, first);
    await save(source, "", linked);
    expect(await targetsOf(source)).toEqual([first, second].sort());

    const relinked = linksTo(second, third);
    await save(source, linked, relinked);
    expect(await targetsOf(source)).toEqual([second, third].sort());

    await save(source, relinked, "# Notes\n\nNo links now.");
    expect(await targetsOf(source)).toEqual([]);
  });

  it("records no link to the page itself or to a page that doesn't exist", async () => {
    const target = await page();
    const source = await page();

    await save(source, "", linksTo(source, "no-such-page", target));

    expect(await targetsOf(source)).toEqual([target]);
  });

  it("records the sub-page and link-to-page blocks and mentions a body holds", async () => {
    const child = await page();
    const linked = await page();
    const imported = await page();
    await getDb().insert(schema.documentSyncLinks).values({
      documentId: imported,
      ownerEmail: OWNER,
      remotePageId: NOTION_KEY,
    });
    const source = await page();
    const body = [
      `<page id="${child}">Child</page>`,
      `Mentions <mention-page url="https://content.example.test/page/${linked}">Linked</mention-page>`,
      `and <mention-page url="https://www.notion.so/Imported-${NOTION_KEY}">Imported</mention-page>.`,
    ].join("\n\n");

    await save(source, "", body);

    expect(await targetsOf(source)).toEqual([child, linked, imported].sort());
  });

  it("resolves an imported page only among the linking page's owner's imports", async () => {
    const strangersImport = await page({ ownerEmail: STRANGER });
    await getDb().insert(schema.documentSyncLinks).values({
      documentId: strangersImport,
      ownerEmail: STRANGER,
      remotePageId: "00112233445566778899aabbccddeeff",
    });
    const source = await page();

    await save(
      source,
      "",
      '<mention-page url="https://www.notion.so/00112233445566778899aabbccddeeff">Theirs</mention-page>',
    );

    expect(await targetsOf(source)).toEqual([]);
  });

  it("records the links update-document and edit-document save", async () => {
    const target = await page();
    const updated = await page({ content: "# Notes" });
    await as(OWNER, () =>
      updateDocument.run({ id: updated, content: linksTo(target) }),
    );
    expect(await targetsOf(updated)).toEqual([target]);

    const edited = await page({ content: linksTo(target) });
    expect(await targetsOf(edited)).toEqual([]);
    await as(OWNER, () =>
      editDocument.run({
        id: edited,
        find: "The end.",
        replace: "The very end.",
      }),
    );
    expect(await targetsOf(edited)).toEqual([target]);

    await as(OWNER, () =>
      updateDocument.run({ id: updated, content: "# Notes\n\nNone." }),
    );
    expect(await targetsOf(updated)).toEqual([]);
  });
});

describe("list-backlinks", () => {
  it("lists only the linking pages the caller can open, most recently edited first", async () => {
    const at = (minutes: number) =>
      new Date(Date.UTC(2026, 10, 1, 12, minutes)).toISOString();
    const target = await page();
    await share(target, VIEWER);
    await share(target, STRANGER);
    const own = await page({ content: linksTo(target), updatedAt: at(1) });
    const shared = await page({ content: linksTo(target), updatedAt: at(2) });
    await share(shared, VIEWER);
    const othersPrivate = await page({
      content: linksTo(target),
      ownerEmail: STRANGER,
      updatedAt: at(3),
    });
    for (const id of [own, shared, othersPrivate]) {
      await save(id, "", linksTo(target));
    }

    const forOwner = await list(OWNER, target);
    expect(forOwner.pages.map((linking) => linking.id)).toEqual([shared, own]);
    expect(forOwner.count).toBe(2);
    expect(forOwner.more).toBe(false);
    expect(forOwner.pages[0]).toEqual({
      id: shared,
      title: expect.stringMatching(/^Page /),
      icon: null,
      url: expect.stringMatching(new RegExp(`/page/${shared}$`)),
      updatedAt: at(2),
    });

    const forViewer = await list(VIEWER, target);
    expect(forViewer.pages.map((linking) => linking.id)).toEqual([shared]);
    expect(forViewer.count).toBe(1);

    const forStranger = await list(STRANGER, target);
    expect(forStranger.pages.map((linking) => linking.id)).toEqual([
      othersPrivate,
    ]);
  });

  it("leaves out a linking page while it's in Trash and lists it again once restored", async () => {
    const target = await page();
    const source = await page({ content: linksTo(target) });
    await save(source, "", linksTo(target));
    expect((await list(OWNER, target)).count).toBe(1);

    await getDb()
      .update(schema.documents)
      .set({ trashedAt: new Date().toISOString() })
      .where(eq(schema.documents.id, source));
    await expect(list(OWNER, target)).resolves.toEqual({
      pages: [],
      count: 0,
      more: false,
    });

    await getDb()
      .update(schema.documents)
      .set({ trashedAt: null })
      .where(eq(schema.documents.id, source));
    expect((await list(OWNER, target)).pages.map((p) => p.id)).toEqual([
      source,
    ]);
  });

  it("forgets a linking page's links once it's deleted for good", async () => {
    const target = await page();
    const source = await page({ content: linksTo(target) });
    await save(source, "", linksTo(target));
    expect(await targetsOf(source)).toEqual([target]);

    await as(OWNER, () => deleteDocumentRecursive(getDb(), source, OWNER));

    expect(await targetsOf(source)).toEqual([]);
    expect((await list(OWNER, target)).count).toBe(0);
  });

  it("shows a linking page's new title and icon, since links follow page ids", async () => {
    const target = await page();
    const source = await page({ content: linksTo(target) });
    await save(source, "", linksTo(target));

    await getDb()
      .update(schema.documents)
      .set({ title: "Renamed", icon: "🧭" })
      .where(eq(schema.documents.id, source));

    const [linking] = (await list(OWNER, target)).pages;
    expect(linking).toMatchObject({ id: source, title: "Renamed", icon: "🧭" });
  });

  it("leaves out the parent that holds the page as a sub-page", async () => {
    const parent = await page();
    const child = await page({ parentId: parent });
    await save(parent, "", `<page id="${child}">Child</page>`);
    const elsewhere = await page();
    await save(elsewhere, "", linksTo(child));

    expect((await list(OWNER, child)).pages.map((p) => p.id)).toEqual([
      elsewhere,
    ]);
  });

  it("asks a signed-in person, and says a page they can't open isn't there", async () => {
    const target = await page({ ownerEmail: STRANGER });

    await expect(failureOf(list(undefined, target))).resolves.toEqual({
      errorCode: "backlinks_signed_out",
      statusCode: 401,
    });
    await expect(failureOf(list(VIEWER, target))).resolves.toEqual({
      errorCode: "document_not_found",
      statusCode: 404,
    });
  });

  it("finds a page once a page linking to it is saved", async () => {
    const target = await page();
    const source = await page({ content: "# Notes" });
    expect((await list(OWNER, target)).count).toBe(0);

    await as(OWNER, () =>
      updateDocument.run({ id: source, content: linksTo(target) }),
    );

    expect((await list(OWNER, target)).pages.map((p) => p.id)).toEqual([
      source,
    ]);
  });
});

describe("the page-links backfill", () => {
  it("records the links in pages saved before the index, over several batches, then stops", async () => {
    const target = await page({ id: "zz-backfill-target" });
    const sources: string[] = [];
    for (let index = 0; index < 120; index += 1) {
      sources.push(
        await page({
          id: `zz-backfill-${String(index).padStart(3, "0")}`,
          content: index % 3 === 0 ? linksTo(target) : "# No links",
        }),
      );
    }
    const trashed = await page({
      id: "zz-backfill-trashed",
      content: linksTo(target),
      trashedAt: new Date().toISOString(),
    });

    expect(await backfill.nextPageLinksBackfillDueAt()).not.toBeNull();
    const report = await backfill.runPageLinksBackfillSweep({
      deadlineAt: Date.now() + 60_000,
    });

    expect(report).toMatchObject({ status: "ran", finished: true, failed: 0 });
    const linking = sources.filter((_, index) => index % 3 === 0);
    for (const id of [...linking, trashed]) {
      expect(await targetsOf(id)).toEqual([target]);
    }
    expect((await list(OWNER, target)).count).toBe(linking.length);
    await expect(
      backfill.runPageLinksBackfillSweep({ deadlineAt: Date.now() + 60_000 }),
    ).resolves.toEqual({ status: "done" });
    await expect(backfill.nextPageLinksBackfillDueAt()).resolves.toBeNull();
  }, 60_000);

  it("waits while another sweep holds the pass", async () => {
    const leaseUntil = new Date(Date.now() + 60_000).toISOString();
    await mutateSetting(backfill.PAGE_LINKS_BACKFILL_STATE_KEY, () => ({
      version: 1,
      after: null,
      doneAt: null,
      run: { id: "another-sweep", leaseUntil },
    }));

    await expect(
      backfill.runPageLinksBackfillSweep({ deadlineAt: Date.now() + 60_000 }),
    ).resolves.toEqual({ status: "busy", leaseUntil });
    await expect(backfill.nextPageLinksBackfillDueAt()).resolves.toBe(
      Date.parse(leaseUntil),
    );
  });
});
