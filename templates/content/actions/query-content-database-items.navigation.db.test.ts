import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION } from "../shared/api.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-files-navigation-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "navigation-owner@example.com";
const OTHER = "navigation-other@example.com";
const SPACE_ID = "navigation-space";
const DATABASE_ID = "navigation-files";
const ORGANIZATION_MEMBER = "navigation-member@example.com";
const ORGANIZATION_OTHER = "navigation-org-owner@example.com";
const ORGANIZATION_DENIED = "navigation-denied@example.com";
const ORGANIZATION_A_ID = "navigation-org-a";
const ORGANIZATION_B_ID = "navigation-org-b";
const ORGANIZATION_SPACE_ID = "navigation-org-space";
const ORGANIZATION_DATABASE_ID = "navigation-org-files";
const ORGANIZATION_FILES_DOCUMENT_ID = "navigation-org-files-document";

type Schema = typeof import("../server/db/schema.js");
let getDb: () => any;
let schema: Schema;
let action: typeof import("./query-content-database-items.js").default;
let navigationContextAction: typeof import("./get-content-navigation-context.js").default;

beforeAll(async () => {
  process.env.DATABASE_URL = `pglite:${TEST_DB_PATH}`;
  const dbModule = await import("../server/db/index.js");
  getDb = dbModule.getDb;
  schema = dbModule.schema;
  action = (await import("./query-content-database-items.js")).default;
  navigationContextAction = (
    await import("./get-content-navigation-context.js")
  ).default;
  const plugin = (await import("../server/plugins/db.js")).default;
  await plugin(undefined as any);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at BIGINT NOT NULL,
    identity_authority TEXT, identity_id TEXT
  )`);
  await getDbExec().execute(`CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL, joined_at BIGINT NOT NULL,
    federation_removal_pending_at BIGINT
  )`);

  const now = new Date().toISOString();
  await getDb().insert(schema.documents).values({
    id: "navigation-files-document",
    spaceId: SPACE_ID,
    ownerEmail: OWNER,
    title: "Files",
    content: "database body must not be read",
    visibility: "private",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentSpaces).values({
    id: SPACE_ID,
    name: "Navigation",
    kind: "personal",
    ownerEmail: OWNER,
    filesDatabaseId: DATABASE_ID,
    createdBy: OWNER,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabases).values({
    id: DATABASE_ID,
    spaceId: SPACE_ID,
    ownerEmail: OWNER,
    documentId: "navigation-files-document",
    title: "Files",
    systemRole: "files",
    createdAt: now,
    updatedAt: now,
  });

  for (const [id, name] of [
    [ORGANIZATION_A_ID, "Navigation Org A"],
    [ORGANIZATION_B_ID, "Navigation Org B"],
  ]) {
    await getDbExec().execute({
      sql: "INSERT INTO organizations (id, name, created_by, created_at) VALUES ($1, $2, $3, $4)",
      args: [id, name, ORGANIZATION_OTHER, Date.now()],
    });
  }
  for (const orgId of [ORGANIZATION_A_ID, ORGANIZATION_B_ID]) {
    await getDbExec().execute({
      sql: "INSERT INTO org_members (id, org_id, email, role, joined_at) VALUES ($1, $2, $3, $4, $5)",
      args: [
        `navigation-member-${orgId}`,
        orgId,
        ORGANIZATION_MEMBER,
        "member",
        Date.now(),
      ],
    });
  }
  await getDb().insert(schema.documents).values({
    id: ORGANIZATION_FILES_DOCUMENT_ID,
    spaceId: ORGANIZATION_SPACE_ID,
    ownerEmail: ORGANIZATION_OTHER,
    orgId: ORGANIZATION_B_ID,
    title: "Organization Files",
    content: "",
    visibility: "org",
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentSpaces).values({
    id: ORGANIZATION_SPACE_ID,
    name: "Organization Navigation",
    kind: "organization",
    ownerEmail: ORGANIZATION_OTHER,
    orgId: ORGANIZATION_B_ID,
    filesDatabaseId: ORGANIZATION_DATABASE_ID,
    createdBy: ORGANIZATION_OTHER,
    createdAt: now,
    updatedAt: now,
  });
  await getDb().insert(schema.contentDatabases).values({
    id: ORGANIZATION_DATABASE_ID,
    spaceId: ORGANIZATION_SPACE_ID,
    ownerEmail: ORGANIZATION_OTHER,
    orgId: ORGANIZATION_B_ID,
    documentId: ORGANIZATION_FILES_DOCUMENT_ID,
    title: "Organization Files",
    systemRole: "files",
    createdAt: now,
    updatedAt: now,
  });
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

async function addFile(args: {
  id: string;
  parentId?: string | null;
  ownerEmail?: string;
  position?: number;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  spaceId?: string | null;
}) {
  const timestamp = args.createdAt ?? "2026-01-01T00:00:00.000Z";
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      spaceId: args.spaceId === undefined ? SPACE_ID : args.spaceId,
      parentId: args.parentId ?? null,
      ownerEmail: args.ownerEmail ?? OWNER,
      title: args.title ?? args.id,
      content: `heavy body ${args.id}`,
      icon: "file",
      visibility: "private",
      createdAt: timestamp,
      updatedAt: args.updatedAt ?? timestamp,
    });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: `membership-${args.id}`,
      ownerEmail: OWNER,
      databaseId: DATABASE_ID,
      documentId: args.id,
      position: args.position ?? 0,
      createdAt: timestamp,
      updatedAt: args.updatedAt ?? timestamp,
    });
}

async function addOrganizationFile(args: {
  id: string;
  parentId?: string | null;
  visibility?: "private" | "org";
}) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      spaceId: ORGANIZATION_SPACE_ID,
      parentId: args.parentId ?? null,
      ownerEmail: ORGANIZATION_OTHER,
      orgId: ORGANIZATION_B_ID,
      title: args.id,
      content: "",
      visibility: args.visibility ?? "org",
      createdAt: now,
      updatedAt: now,
    });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: `membership-${args.id}`,
      ownerEmail: ORGANIZATION_OTHER,
      orgId: ORGANIZATION_B_ID,
      databaseId: ORGANIZATION_DATABASE_ID,
      documentId: args.id,
      position: 0,
      createdAt: now,
      updatedAt: now,
    });
}

async function navigate(
  navigation: {
    parentId: string | null;
    sort?: "custom" | "name" | "created" | "last_edited";
    viewId?: string;
    cursor?: string;
  },
  limit?: number,
) {
  return runWithRequestContext({ userEmail: OWNER }, () =>
    action.run({ databaseId: DATABASE_ID, navigation, limit }, {
      userEmail: OWNER,
    } as any),
  );
}

describe("query-content-database-items Files navigation", () => {
  it.each([50, 100, 500])(
    "keeps %i roots bounded to stable 20-row pages",
    async (rootCount) => {
      const prefix = `bounded-${rootCount}`;
      const ids = Array.from(
        { length: rootCount },
        (_, index) => `${prefix}-${String(index).padStart(3, "0")}`,
      );
      const timestamp = "2026-01-01T00:00:00.000Z";
      for (let offset = 0; offset < ids.length; offset += 100) {
        const batch = ids.slice(offset, offset + 100);
        await getDb()
          .insert(schema.documents)
          .values(
            batch.map((id, index) => ({
              id,
              spaceId: SPACE_ID,
              parentId: null,
              ownerEmail: OWNER,
              title: id,
              content: "",
              visibility: "private" as const,
              position: offset + index,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          );
        await getDb()
          .insert(schema.contentDatabaseItems)
          .values(
            batch.map((id, index) => ({
              id: `membership-${id}`,
              ownerEmail: OWNER,
              databaseId: DATABASE_ID,
              documentId: id,
              position: offset + index,
              createdAt: timestamp,
              updatedAt: timestamp,
            })),
          );
      }

      const first = await navigate({ parentId: null }, 20);
      expect(first.items.map((item) => item.documentId)).toEqual(
        ids.slice(0, 20),
      );
      expect(first.pagination.hasMore).toBe(true);

      const second = await navigate(
        { parentId: null, cursor: first.pagination.nextCursor! },
        20,
      );
      expect(second.items.map((item) => item.documentId)).toEqual(
        ids.slice(20, 40),
      );
      expect(second.pagination.hasMore).toBe(true);

      const repeatedSecond = await navigate(
        { parentId: null, cursor: first.pagination.nextCursor! },
        20,
      );
      expect(repeatedSecond).toEqual(second);

      await getDb()
        .delete(schema.contentDatabaseItems)
        .where(inArray(schema.contentDatabaseItems.documentId, ids));
      await getDb()
        .delete(schema.documents)
        .where(inArray(schema.documents.id, ids));
    },
    60_000,
  );

  it("pages roots and immediate children without cross-parent or inaccessible leakage", async () => {
    for (let index = 0; index < 22; index += 1) {
      await addFile({
        id: `root-${String(index).padStart(2, "0")}`,
        position: index,
      });
    }
    for (let index = 0; index < 22; index += 1) {
      await addFile({
        id: `child-a-${String(index).padStart(2, "0")}`,
        parentId: "root-00",
        position: index,
      });
    }
    await addFile({ id: "child-b", parentId: "root-01" });
    await addFile({ id: "private-foreign", ownerEmail: OTHER, position: -1 });

    const first = await navigate({ parentId: null }, 20);
    expect(first.items).toHaveLength(20);
    expect(first.items.every((item) => item.parentId === null)).toBe(true);
    expect(
      first.items.some((item) => item.documentId === "private-foreign"),
    ).toBe(false);
    expect(first.pagination.hasMore).toBe(true);
    expect(first.pagination.nextCursor).toEqual(expect.any(String));
    expect(first.items[0]).toEqual({
      membershipId: "membership-root-00",
      membershipPosition: 0,
      documentId: "root-00",
      parentId: null,
      title: "root-00",
      icon: "file",
      spaceId: SPACE_ID,
      sourceKind: null,
      isFavorite: false,
      canEdit: true,
      canManage: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      type: "page",
      hasChildren: true,
    });
    expect(first.items[0]).not.toHaveProperty("content");

    const second = await navigate({
      parentId: null,
      cursor: first.pagination.nextCursor!,
    });
    expect(second.items.map((item) => item.documentId)).toEqual([
      "root-20",
      "root-21",
    ]);

    const children = await navigate({ parentId: "root-00" });
    expect(children.items).toHaveLength(20);
    expect(children.items.every((item) => item.parentId === "root-00")).toBe(
      true,
    );
    expect(children.items.some((item) => item.documentId === "child-b")).toBe(
      false,
    );
    const remainingChildren = await navigate({
      parentId: "root-00",
      cursor: children.pagination.nextCursor!,
    });
    expect(remainingChildren.items).toHaveLength(2);
  });

  it("rejects parents outside the Files database or the caller's access", async () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    await getDb().insert(schema.documents).values({
      id: "outside-files-parent",
      spaceId: SPACE_ID,
      ownerEmail: OWNER,
      title: "Outside Files",
      content: "",
      visibility: "private",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await addFile({
      id: "inaccessible-files-parent",
      ownerEmail: OTHER,
    });

    await expect(
      navigate({ parentId: "outside-files-parent" }),
    ).rejects.toThrow("The Files navigation parent is unavailable.");
    await expect(
      navigate({ parentId: "inaccessible-files-parent" }),
    ).rejects.toThrow("The Files navigation parent is unavailable.");
  });

  it("uses stable tie IDs for every supported server sort", async () => {
    await addFile({ id: "ties-parent", position: 100 });
    for (const id of ["tie-c", "tie-a", "tie-b"]) {
      await addFile({
        id,
        parentId: "ties-parent",
        position: 0,
        title: "Same",
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-02T00:00:00.000Z",
      });
    }

    for (const sort of ["custom", "name", "created", "last_edited"] as const) {
      const first = await navigate({ parentId: "ties-parent", sort }, 2);
      const second = await navigate({
        parentId: "ties-parent",
        sort,
        cursor: first.pagination.nextCursor!,
      });
      expect(
        [...first.items, ...second.items].map((item) => item.documentId),
      ).toEqual(["tie-a", "tie-b", "tie-c"]);
    }
  });

  it("uses sidebar sort direction instead of an unrelated view direction", async () => {
    await addFile({
      id: "sidebar-sort-parent",
      position: 101,
    });
    await addFile({
      id: "sidebar-sort-alpha",
      parentId: "sidebar-sort-parent",
      title: "Alpha",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-03T00:00:00.000Z",
    });
    await addFile({
      id: "sidebar-sort-beta",
      parentId: "sidebar-sort-parent",
      title: "Beta",
      createdAt: "2026-03-02T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    await addFile({
      id: "sidebar-sort-gamma",
      parentId: "sidebar-sort-parent",
      title: "Gamma",
      createdAt: "2026-03-03T00:00:00.000Z",
      updatedAt: "2026-03-02T00:00:00.000Z",
    });
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const saveSidebarSort = (mode: "name" | "created" | "last_edited") =>
      putUserSetting(OWNER, personalDatabaseViewSettingKey(DATABASE_ID), {
        version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
        activeViewId: "files",
        views: [
          {
            id: "files",
            sorts: [{ key: "name", label: "Name", direction: "desc" }],
            filters: [],
            filterMode: "and",
            sidebarOrder: { mode, itemIds: [] },
          },
        ],
      });

    await saveSidebarSort("name");
    expect(
      (await navigate({ parentId: "sidebar-sort-parent" })).items.map(
        (item) => item.documentId,
      ),
    ).toEqual([
      "sidebar-sort-alpha",
      "sidebar-sort-beta",
      "sidebar-sort-gamma",
    ]);
    await saveSidebarSort("created");
    expect(
      (await navigate({ parentId: "sidebar-sort-parent" })).items.map(
        (item) => item.documentId,
      ),
    ).toEqual([
      "sidebar-sort-gamma",
      "sidebar-sort-beta",
      "sidebar-sort-alpha",
    ]);
    await saveSidebarSort("last_edited");
    expect(
      (await navigate({ parentId: "sidebar-sort-parent" })).items.map(
        (item) => item.documentId,
      ),
    ).toEqual([
      "sidebar-sort-alpha",
      "sidebar-sort-gamma",
      "sidebar-sort-beta",
    ]);
  });

  it("returns exactly 25 mixed ranked and unlisted siblings once across sequential pages", async () => {
    await addFile({ id: "exact-page-parent", position: 200 });
    const documentIds = Array.from(
      { length: 25 },
      (_, index) => `exact-page-${String(index + 1).padStart(2, "0")}`,
    );
    for (const [position, id] of documentIds.entries()) {
      await addFile({
        id,
        parentId: "exact-page-parent",
        position: (position * 7) % documentIds.length,
      });
    }
    const rankedDocumentIds = [
      "exact-page-07",
      "exact-page-02",
      "exact-page-19",
    ];
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    await putUserSetting(OWNER, personalDatabaseViewSettingKey(DATABASE_ID), {
      version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
      activeViewId: "files",
      views: [
        {
          id: "files",
          sorts: [],
          filters: [],
          filterMode: "and",
          sidebarOrder: {
            mode: "custom",
            itemIds: rankedDocumentIds.map((id) => `membership-${id}`),
          },
        },
      ],
    });

    const first = await navigate(
      { parentId: "exact-page-parent", sort: "custom" },
      20,
    );
    const second = await navigate({
      parentId: "exact-page-parent",
      sort: "custom",
      cursor: first.pagination.nextCursor!,
    });

    const expectedDocumentIds = [
      ...rankedDocumentIds,
      ...documentIds
        .filter((id) => !rankedDocumentIds.includes(id))
        .sort((left, right) => {
          const leftIndex = documentIds.indexOf(left);
          const rightIndex = documentIds.indexOf(right);
          return ((leftIndex * 7) % 25) - ((rightIndex * 7) % 25);
        }),
    ];
    expect(first.items.map((item) => item.documentId)).toEqual(
      expectedDocumentIds.slice(0, 20),
    );
    expect(second.items.map((item) => item.documentId)).toEqual(
      expectedDocumentIds.slice(20),
    );
    expect(
      new Set([...first.items, ...second.items].map((item) => item.documentId))
        .size,
    ).toBe(25);
    expect(second.pagination).toMatchObject({
      hasMore: false,
      nextCursor: null,
    });
  });

  it("applies personal custom order and invalidates cursors when it changes", async () => {
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const saveOrder = (itemIds: string[]) =>
      putUserSetting(OWNER, personalDatabaseViewSettingKey(DATABASE_ID), {
        version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
        activeViewId: "files",
        views: [
          {
            id: "files",
            sorts: [],
            filters: [],
            filterMode: "and",
            sidebarOrder: { mode: "custom", itemIds },
          },
        ],
      });
    await saveOrder([
      "membership-root-05",
      "membership-root-03",
      "membership-root-04",
    ]);

    const first = await navigate({ parentId: null }, 2);
    expect(first.items.map((item) => item.documentId)).toEqual([
      "root-05",
      "root-03",
    ]);
    await saveOrder([
      "membership-root-03",
      "membership-root-05",
      "membership-root-04",
    ]);
    await expect(
      navigate({ parentId: null, cursor: first.pagination.nextCursor! }, 2),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
  });

  it("rejects malformed and wrong-scope cursors instead of falling back", async () => {
    await expect(
      navigate({ parentId: null, cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });

    const first = await navigate({ parentId: null }, 1);
    await expect(
      navigate({
        parentId: "root-00",
        cursor: first.pagination.nextCursor!,
      }),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
  });

  it("invalidates a page cursor for accessible sibling edits but ignores inaccessible rows", async () => {
    await addFile({ id: "revision-parent", position: 400 });
    await addFile({
      id: "revision-a",
      parentId: "revision-parent",
      position: 0,
    });
    await addFile({
      id: "revision-b",
      parentId: "revision-parent",
      position: 1,
    });
    const first = await navigate(
      { parentId: "revision-parent", sort: "name" },
      1,
    );
    await getDb()
      .update(schema.documents)
      .set({ title: "renamed", updatedAt: "2026-03-01T00:00:00.000Z" })
      .where(eq(schema.documents.id, "revision-b"));
    await expect(
      navigate(
        {
          parentId: "revision-parent",
          sort: "name",
          cursor: first.pagination.nextCursor!,
        },
        1,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });

    const beforeReparent = await navigate(
      { parentId: "revision-parent", sort: "name" },
      1,
    );
    await getDb()
      .update(schema.documents)
      .set({ parentId: null })
      .where(eq(schema.documents.id, "revision-b"));
    await expect(
      navigate(
        {
          parentId: "revision-parent",
          sort: "name",
          cursor: beforeReparent.pagination.nextCursor!,
        },
        1,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    await getDb()
      .update(schema.documents)
      .set({ parentId: "revision-parent" })
      .where(eq(schema.documents.id, "revision-b"));

    await addFile({
      id: "revision-shared",
      parentId: "revision-parent",
      ownerEmail: OTHER,
      position: 3,
    });
    await getDb().insert(schema.documentShares).values({
      id: "revision-shared-share",
      resourceId: "revision-shared",
      principalType: "user",
      principalId: OWNER,
      role: "viewer",
      createdBy: OTHER,
      createdAt: new Date().toISOString(),
    });
    const beforeRevoke = await navigate(
      { parentId: "revision-parent", sort: "name" },
      1,
    );
    await getDb()
      .delete(schema.documentShares)
      .where(eq(schema.documentShares.id, "revision-shared-share"));
    await expect(
      navigate(
        {
          parentId: "revision-parent",
          sort: "name",
          cursor: beforeRevoke.pagination.nextCursor!,
        },
        1,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });

    const beforeDelete = await navigate(
      { parentId: "revision-parent", sort: "name" },
      1,
    );
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: "2026-03-03T00:00:00.000Z" })
      .where(eq(schema.documents.id, "revision-b"));
    await expect(
      navigate(
        {
          parentId: "revision-parent",
          sort: "name",
          cursor: beforeDelete.pagination.nextCursor!,
        },
        1,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: null })
      .where(eq(schema.documents.id, "revision-b"));

    await addFile({
      id: "revision-inaccessible",
      parentId: "revision-parent",
      ownerEmail: OTHER,
      position: 2,
    });
    const stable = await navigate(
      { parentId: "revision-parent", sort: "name" },
      1,
    );
    await getDb()
      .update(schema.documents)
      .set({ title: "still hidden", updatedAt: "2026-03-02T00:00:00.000Z" })
      .where(eq(schema.documents.id, "revision-inaccessible"));
    await expect(
      navigate(
        {
          parentId: "revision-parent",
          sort: "name",
          cursor: stable.pagination.nextCursor!,
        },
        1,
      ),
    ).resolves.toMatchObject({ items: expect.any(Array) });
  });

  it("applies effective view filters before paging and invalidates changed-filter cursors", async () => {
    await addFile({ id: "shared-view-parent", position: 500 });
    await addFile({
      id: "shared-view-a",
      parentId: "shared-view-parent",
      title: "A",
    });
    await addFile({
      id: "shared-view-z",
      parentId: "shared-view-parent",
      title: "Z",
    });
    await addFile({
      id: "shared-view-also-a",
      parentId: "shared-view-parent",
      title: "Also A",
    });
    const saveView = async (
      filters: unknown[] = [],
      direction = "desc",
      filterMode = "and",
    ) => {
      await getDb()
        .update(schema.contentDatabases)
        .set({
          viewConfigJson: JSON.stringify({
            activeViewId: "default",
            views: [
              {
                id: "default",
                name: "Table",
                type: "table",
                sorts: [{ key: "name", label: "Name", direction }],
                filters,
                filterMode,
                columnWidths: {},
              },
            ],
          }),
        })
        .where(eq(schema.contentDatabases.id, DATABASE_ID));
    };
    await saveView();
    const first = await navigate(
      { parentId: "shared-view-parent", viewId: "default" },
      1,
    );
    expect(first.items[0]?.documentId).toBe("shared-view-z");
    await saveView([], "asc");
    await expect(
      navigate(
        {
          parentId: "shared-view-parent",
          viewId: "default",
          cursor: first.pagination.nextCursor!,
        },
        1,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    await saveView([
      { key: "name", label: "Name", operator: "contains", value: "A" },
    ]);
    const filtered = await navigate(
      { parentId: "shared-view-parent", viewId: "default" },
      1,
    );
    expect(filtered.items.map((item) => item.documentId)).toEqual([
      "shared-view-also-a",
    ]);
    expect(filtered.pagination.hasMore).toBe(true);
    await saveView([
      { key: "name", label: "Name", operator: "equals", value: "Z" },
    ]);
    await expect(
      navigate(
        {
          parentId: "shared-view-parent",
          viewId: "default",
          cursor: filtered.pagination.nextCursor!,
        },
        1,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });

    await saveView(
      [
        { key: "name", label: "Name", operator: "equals", value: "A" },
        { key: "name", label: "Name", operator: "equals", value: "Z" },
      ],
      "asc",
      "and",
    );
    expect(
      (await navigate({ parentId: "shared-view-parent", viewId: "default" }))
        .items,
    ).toEqual([]);
    await saveView(
      [
        { key: "name", label: "Name", operator: "equals", value: "A" },
        { key: "name", label: "Name", operator: "equals", value: "Z" },
      ],
      "asc",
      "or",
    );
    expect(
      (
        await navigate({ parentId: "shared-view-parent", viewId: "default" })
      ).items.map((item) => item.title),
    ).toEqual(["A", "Z"]);
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: "{}" })
      .where(eq(schema.contentDatabases.id, DATABASE_ID));
  });

  it("uses personal filter mode, filters hasChildren, and scopes access before limit", async () => {
    await addFile({
      id: "filtered-parent",
      title: "Keep parent",
      position: 700,
    });
    await addFile({
      id: "filtered-child",
      parentId: "filtered-parent",
      title: "Keep child",
    });
    await addFile({
      id: "excluded-child",
      parentId: "filtered-parent",
      title: "Drop child",
    });
    await addFile({
      id: "empty-filtered-parent",
      title: "Keep empty",
      position: 701,
    });
    await addFile({
      id: "only-excluded-child",
      parentId: "empty-filtered-parent",
      title: "Drop only",
    });
    await addFile({
      id: "matching-inaccessible",
      title: "Keep hidden",
      ownerEmail: OTHER,
      position: -10,
    });
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    await putUserSetting(OWNER, personalDatabaseViewSettingKey(DATABASE_ID), {
      version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
      activeViewId: "files",
      views: [
        {
          id: "files",
          sorts: [{ key: "name", label: "Name", direction: "asc" }],
          filters: [
            { key: "name", label: "Name", operator: "contains", value: "Keep" },
            { key: "name", label: "Name", operator: "equals", value: "never" },
          ],
          filterMode: "or",
          sidebarOrder: { mode: "name", itemIds: [] },
        },
      ],
    });

    const roots = await navigate({ parentId: null }, 2);
    expect(roots.items.map((item) => item.documentId)).toEqual([
      "empty-filtered-parent",
      "filtered-parent",
    ]);
    expect(roots.pagination.hasMore).toBe(false);
    expect(roots.items.map((item) => item.hasChildren)).toEqual([false, true]);
    const children = await navigate({ parentId: "filtered-parent" });
    expect(children.items.map((item) => item.documentId)).toEqual([
      "filtered-child",
    ]);
  });

  it("uses the accessible authoritative space Files membership, not an arbitrary membership", async () => {
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "rogue-files-document",
      spaceId: "rogue-space",
      ownerEmail: OTHER,
      title: "Rogue Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentSpaces).values({
      id: "rogue-space",
      name: "Rogue",
      kind: "personal",
      ownerEmail: OTHER,
      filesDatabaseId: "rogue-files",
      createdBy: OTHER,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "rogue-files",
      spaceId: "rogue-space",
      ownerEmail: OTHER,
      documentId: "rogue-files-document",
      title: "Rogue Files",
      systemRole: "files",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "rogue-root-membership",
      ownerEmail: OTHER,
      databaseId: "rogue-files",
      documentId: "root-00",
      position: 0,
      createdAt: now,
      updatedAt: now,
    });

    const context = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "root-00" }),
    );
    expect(context.workspaceFilesDatabaseId).toBe(DATABASE_ID);
    expect(context.path.at(-1)).toMatchObject({ databaseId: DATABASE_ID });
  });

  it("returns the authoritative Files database for the Files document itself", async () => {
    const context = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "navigation-files-document" }),
    );

    expect(context.workspaceFilesDatabaseId).toBe(DATABASE_ID);
    expect(context.path).toHaveLength(1);
    expect(context.path[0]).toMatchObject({
      id: "navigation-files-document",
      databaseId: DATABASE_ID,
      databaseDocumentId: "navigation-files-document",
    });
  });

  it("resolves an authorized organization Files root and child independently of the active organization", async () => {
    await addOrganizationFile({ id: "organization-child" });

    for (const orgId of [ORGANIZATION_A_ID, undefined]) {
      const filesContext = await runWithRequestContext(
        { userEmail: ORGANIZATION_MEMBER, orgId },
        () =>
          navigationContextAction.run({ id: ORGANIZATION_FILES_DOCUMENT_ID }),
      );
      expect(filesContext.workspaceFilesDatabaseId).toBe(
        ORGANIZATION_DATABASE_ID,
      );
      expect(filesContext.path.map((entry) => entry.id)).toEqual([
        ORGANIZATION_FILES_DOCUMENT_ID,
      ]);

      const childContext = await runWithRequestContext(
        { userEmail: ORGANIZATION_MEMBER, orgId },
        () => navigationContextAction.run({ id: "organization-child" }),
      );
      expect(childContext.workspaceFilesDatabaseId).toBe(
        ORGANIZATION_DATABASE_ID,
      );
      expect(childContext.path.map((entry) => entry.id)).toEqual([
        "organization-child",
      ]);
    }
  });

  it("denies Files navigation without selected-space membership", async () => {
    await expect(
      runWithRequestContext({ userEmail: ORGANIZATION_DENIED }, () =>
        navigationContextAction.run({ id: "organization-child" }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not disclose a restricted ancestor from an authorized organization space", async () => {
    await addOrganizationFile({
      id: "restricted-organization-parent",
      visibility: "private",
    });
    await addOrganizationFile({
      id: "organization-child-with-restricted-parent",
      parentId: "restricted-organization-parent",
    });

    const context = await runWithRequestContext(
      { userEmail: ORGANIZATION_MEMBER, orgId: ORGANIZATION_A_ID },
      () =>
        navigationContextAction.run({
          id: "organization-child-with-restricted-parent",
        }),
    );

    expect(context.workspaceFilesDatabaseId).toBe(ORGANIZATION_DATABASE_ID);
    expect(context.path.map((entry) => entry.id)).toEqual([
      "organization-child-with-restricted-parent",
    ]);
  });

  it("associates a child without denormalized spaceId to its authoritative Files path", async () => {
    await addFile({ id: "space-less-parent", position: 300 });
    await addFile({
      id: "space-less-child",
      parentId: "space-less-parent",
      position: 0,
      spaceId: null,
    });

    const context = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "space-less-child" }),
    );

    expect(context.workspaceFilesDatabaseId).toBe(DATABASE_ID);
    expect(context.path.map((entry) => entry.id)).toEqual([
      "space-less-parent",
      "space-less-child",
    ]);
    expect(
      context.path.every((entry) => entry.databaseId === DATABASE_ID),
    ).toBe(true);
  });

  it("returns each path entry's own permissions and metadata", async () => {
    await addFile({
      id: "weak-parent",
      ownerEmail: OTHER,
      position: 600,
      title: "Weak parent",
    });
    await getDb()
      .update(schema.documents)
      .set({ visibility: "public", icon: "parent-icon" })
      .where(eq(schema.documents.id, "weak-parent"));
    await getDb().insert(schema.documentShares).values({
      id: "weak-parent-viewer-share",
      resourceId: "weak-parent",
      principalType: "user",
      principalId: OWNER,
      role: "viewer",
      createdBy: OTHER,
      createdAt: new Date().toISOString(),
    });
    await addFile({ id: "strong-child", parentId: "weak-parent", position: 0 });
    const context = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "strong-child" }),
    );
    expect(context.path[0]).toMatchObject({
      id: "weak-parent",
      title: "Weak parent",
      icon: "parent-icon",
      accessRole: "viewer",
      canEdit: false,
      canManage: false,
    });
    expect(context.path[1]).toMatchObject({
      id: "strong-child",
      accessRole: "owner",
      canEdit: true,
      canManage: true,
    });
  });

  it("requires an explicit parent and rejects unsupported pagination combinations", () => {
    expect(() =>
      action.schema.parse({ databaseId: DATABASE_ID, navigation: {} }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        databaseId: DATABASE_ID,
        navigation: { parentId: null },
        limit: 21,
      }),
    ).not.toThrow();
    return expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run(
          {
            databaseId: DATABASE_ID,
            navigation: { parentId: null },
            limit: 21,
          },
          { userEmail: OWNER } as any,
        ),
      ),
    ).rejects.toMatchObject({ errorCode: "navigation_limit_exceeded" });
  });
});
