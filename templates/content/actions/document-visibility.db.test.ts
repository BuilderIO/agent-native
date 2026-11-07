import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { MAX_PUBLIC_FOLLOWERS } from "@agent-native/core/sharing";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-document-visibility-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "visibility-owner@example.com";
const OTHER_OWNER = "visibility-other@example.com";
const ORG_ID = "visibility-org";

type Schema = typeof import("../server/db/schema.js");
type Visibility = "private" | "org" | "public";
type SharingAction = {
  run: (args: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
let getDb: () => any;
let schema: Schema;
let setResourceVisibility: SharingAction;
let listResourceShares: SharingAction;
let publicSubPageIds: typeof import("../server/lib/public-sub-pages.js").publicSubPageIds;
let count = 0;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  setResourceVisibility = (
    await import("@agent-native/core/sharing/actions/set-resource-visibility")
  ).default as SharingAction;
  listResourceShares = (
    await import("@agent-native/core/sharing/actions/list-resource-shares")
  ).default as SharingAction;
  ({ publicSubPageIds } = await import("../server/lib/public-sub-pages.js"));
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function page(
  options: {
    parentId?: string | null;
    visibility?: Visibility;
    ownerEmail?: string;
    trashedAt?: string;
  } = {},
) {
  const id = `visibility-doc-${++count}`;
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id,
      ownerEmail: options.ownerEmail ?? OWNER,
      orgId: ORG_ID,
      parentId: options.parentId ?? null,
      title: `Page ${count}`,
      content: "",
      position: count,
      visibility: options.visibility ?? "private",
      trashedAt: options.trashedAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
  return id;
}

async function visibilitiesOf(...ids: string[]) {
  const rows: Array<{ id: string; visibility: string }> = await getDb()
    .select({
      id: schema.documents.id,
      visibility: schema.documents.visibility,
    })
    .from(schema.documents)
    .where(inArray(schema.documents.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row.visibility]));
  return ids.map((id) => byId.get(id));
}

const setVisibility = (resourceId: string, visibility: Visibility) =>
  runWithRequestContext({ userEmail: OWNER, orgId: ORG_ID }, () =>
    setResourceVisibility.run({
      resourceType: "document",
      resourceId,
      visibility,
    }),
  );

describe("a page's sub-pages and public visibility", () => {
  it("go public with the page, at any depth", async () => {
    const parent = await page();
    const child = await page({ parentId: parent });
    const grandchild = await page({ parentId: child });

    const result = await setVisibility(parent, "public");

    expect(await visibilitiesOf(parent, child, grandchild)).toEqual([
      "public",
      "public",
      "public",
    ]);
    expect(result.followersChanged).toBe(2);
    const listed = await runWithRequestContext({ userEmail: OWNER }, () =>
      listResourceShares.run({ resourceType: "document", resourceId: parent }),
    );
    expect(listed.publicFollowers).toBe(2);
  });

  it("leave public with the page, wherever it goes", async () => {
    const parent = await page({ visibility: "public" });
    const child = await page({ parentId: parent, visibility: "public" });
    const keptOrg = await page({ parentId: parent, visibility: "org" });
    const grandchild = await page({ parentId: child, visibility: "public" });

    await setVisibility(parent, "private");

    expect(await visibilitiesOf(parent, child, keptOrg, grandchild)).toEqual([
      "private",
      "private",
      "org",
      "private",
    ]);
  });

  it("stay as they are when the page only opens to the organization", async () => {
    const parent = await page();
    const child = await page({ parentId: parent });

    await setVisibility(parent, "org");

    expect(await visibilitiesOf(parent, child)).toEqual(["org", "private"]);
  });

  it("don't include another owner's page or the pages under it", async () => {
    const parent = await page();
    const theirs = await page({ parentId: parent, ownerEmail: OTHER_OWNER });
    const underTheirs = await page({ parentId: theirs });
    const mine = await page({ parentId: parent });

    await setVisibility(parent, "public");

    expect(await visibilitiesOf(parent, theirs, underTheirs, mine)).toEqual([
      "public",
      "private",
      "private",
      "public",
    ]);
  });

  it("don't include pages in the trash or in a deleted database", async () => {
    const parent = await page();
    const trashed = await page({
      parentId: parent,
      trashedAt: new Date().toISOString(),
    });
    const tracker = await page({ parentId: parent });
    await getDb()
      .insert(schema.contentDatabases)
      .values({
        id: `visibility-database-${tracker}`,
        ownerEmail: OWNER,
        documentId: tracker,
        deletedAt: new Date().toISOString(),
      });
    const row = await page({ parentId: tracker });

    expect(
      await publicSubPageIds(
        { id: parent, ownerEmail: OWNER },
        { isPublic: false },
      ),
    ).toEqual([]);
    await setVisibility(parent, "public");
    expect(await visibilitiesOf(trashed, tracker, row)).toEqual([
      "private",
      "private",
      "private",
    ]);
  });

  it("are read once each when the page tree loops", async () => {
    const first = await page();
    const second = await page({ parentId: first });
    await getDb()
      .update(schema.documents)
      .set({ parentId: second })
      .where(eq(schema.documents.id, first));

    expect(
      await publicSubPageIds(
        { id: first, ownerEmail: OWNER },
        { isPublic: false },
      ),
    ).toEqual([second]);
  });

  it("are limited to the ones that need to change", async () => {
    const parent = await page();
    const now = new Date().toISOString();
    const children = Array.from(
      { length: MAX_PUBLIC_FOLLOWERS + 1 },
      (_, index) => ({
        id: `visibility-many-${index}`,
        ownerEmail: OWNER,
        orgId: ORG_ID,
        parentId: parent,
        title: `Many ${index}`,
        content: "",
        position: index,
        visibility: "private",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await getDb().insert(schema.documents).values(children);
    await page({ parentId: "visibility-many-0" });

    expect(
      await publicSubPageIds(
        { id: parent, ownerEmail: OWNER },
        { isPublic: false },
      ),
    ).toHaveLength(MAX_PUBLIC_FOLLOWERS + 1);
    await expect(setVisibility(parent, "public")).rejects.toThrow(
      `more than ${MAX_PUBLIC_FOLLOWERS} sub-pages`,
    );
    expect(await visibilitiesOf(parent)).toEqual(["private"]);

    // Public with one public sub-page among them, it can still leave public:
    // only that one has to follow.
    await getDb()
      .update(schema.documents)
      .set({ visibility: "public" })
      .where(eq(schema.documents.id, parent));
    const shared = await page({ parentId: parent, visibility: "public" });
    const result = await setVisibility(parent, "private");
    expect(result.followersChanged).toBe(1);
    expect(await visibilitiesOf(parent, shared)).toEqual([
      "private",
      "private",
    ]);

    // With all of them public, the listing says "more than" the limit.
    await getDb()
      .update(schema.documents)
      .set({ visibility: "public" })
      .where(
        inArray(schema.documents.id, [
          parent,
          ...children.map((child) => child.id),
        ]),
      );
    const listed = await runWithRequestContext({ userEmail: OWNER }, () =>
      listResourceShares.run({ resourceType: "document", resourceId: parent }),
    );
    expect(listed.publicFollowers).toBe(MAX_PUBLIC_FOLLOWERS);
    expect(listed.publicFollowersMore).toBe(true);
  });
});
