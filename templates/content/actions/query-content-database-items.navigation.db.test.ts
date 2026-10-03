import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabaseNavigationPageResponse,
} from "../shared/api.js";

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
    expand?: string[];
  },
  limit?: number,
) {
  return runWithRequestContext({ userEmail: OWNER }, () =>
    action.run({ databaseId: DATABASE_ID, navigation, limit }, {
      userEmail: OWNER,
    } as any),
  ) as Promise<ContentDatabaseNavigationPageResponse>;
}

async function saveCustomOrder(itemIds: string[]) {
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
        sidebarOrder: { mode: "custom", itemIds },
      },
    ],
  });
}

// Records the SQL the database client runs while `read` is in flight.
async function statementsDuring(read: () => Promise<unknown>) {
  const query = vi.spyOn(getDb().$client, "query");
  try {
    await read();
    return query.mock.calls.map(([text]) => String(text));
  } finally {
    query.mockRestore();
  }
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

  it("finds saved siblings that sit deep in a long saved order", async () => {
    await addFile({ id: "long-order-parent", position: 250 });
    for (let index = 0; index < 5; index += 1) {
      await addFile({
        id: `long-order-${index}`,
        parentId: "long-order-parent",
        position: index,
      });
    }
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
            itemIds: [
              ...Array.from(
                { length: 150 },
                (_, index) => `membership-elsewhere-${index}`,
              ),
              "membership-long-order-3",
              "membership-long-order-1",
            ],
          },
        },
      ],
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await navigate(
        { parentId: "long-order-parent", sort: "custom", cursor },
        2,
      );
      seen.push(...page.items.map((item) => item.documentId));
      cursor = page.pagination.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toEqual([
      "long-order-3",
      "long-order-1",
      "long-order-0",
      "long-order-2",
      "long-order-4",
    ]);
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

  it("invalidates custom-order cursors when a saved or unsaved sibling at or before them changes", async () => {
    await addFile({ id: "custom-cursor-parent", position: 260 });
    for (let index = 0; index < 4; index += 1) {
      await addFile({
        id: `custom-cursor-${index}`,
        parentId: "custom-cursor-parent",
        position: index,
      });
    }
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
            itemIds: [
              "membership-custom-cursor-3",
              "membership-custom-cursor-1",
            ],
          },
        },
      ],
    });
    // Saved siblings 3 and 1 come first, then 0 and 2 by position.
    const firstPage = (limit: number) =>
      navigate({ parentId: "custom-cursor-parent", sort: "custom" }, limit);
    const nextPage = (cursor: string) =>
      navigate({ parentId: "custom-cursor-parent", sort: "custom", cursor }, 4);
    const rename = (id: string, title: string) =>
      getDb()
        .update(schema.documents)
        .set({ title, updatedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, id));
    const invalid = { errorCode: "invalid_navigation_cursor" };

    const savedCursor = (await firstPage(1)).pagination.nextCursor!;
    await rename("custom-cursor-1", "after the saved cursor");
    await expect(nextPage(savedCursor)).resolves.toMatchObject({
      items: [
        { documentId: "custom-cursor-1", title: "after the saved cursor" },
        { documentId: "custom-cursor-0" },
        { documentId: "custom-cursor-2" },
      ],
    });
    await rename("custom-cursor-3", "saved sibling at the cursor");
    await expect(nextPage(savedCursor)).rejects.toMatchObject(invalid);

    const unsavedCursor = (await firstPage(3)).pagination.nextCursor!;
    await rename("custom-cursor-2", "after the unsaved cursor");
    await expect(nextPage(unsavedCursor)).resolves.toMatchObject({
      items: [{ documentId: "custom-cursor-2" }],
    });
    await rename("custom-cursor-1", "saved sibling before the cursor");
    await expect(nextPage(unsavedCursor)).rejects.toMatchObject(invalid);

    const atUnsavedCursor = (await firstPage(3)).pagination.nextCursor!;
    await rename("custom-cursor-0", "unsaved sibling at the cursor");
    await expect(nextPage(atUnsavedCursor)).rejects.toMatchObject(invalid);
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

  it("invalidates a cursor when a readable sibling at or before it changes and reads later siblings fresh", async () => {
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
    const firstPage = () =>
      navigate({ parentId: "revision-parent", sort: "name" }, 1);
    const nextPage = (cursor: string) =>
      navigate({ parentId: "revision-parent", sort: "name", cursor }, 1);
    const invalid = { errorCode: "invalid_navigation_cursor" };

    const first = await firstPage();
    expect(first.items.map((item) => item.documentId)).toEqual(["revision-a"]);
    await getDb()
      .update(schema.documents)
      .set({
        title: "revision-b renamed",
        updatedAt: "2026-03-01T00:00:00.000Z",
      })
      .where(eq(schema.documents.id, "revision-b"));
    await expect(nextPage(first.pagination.nextCursor!)).resolves.toMatchObject(
      {
        items: [{ documentId: "revision-b", title: "revision-b renamed" }],
      },
    );

    const beforeRename = await firstPage();
    await getDb()
      .update(schema.documents)
      .set({
        title: "revision-a renamed",
        updatedAt: "2026-03-01T00:00:00.000Z",
      })
      .where(eq(schema.documents.id, "revision-a"));
    await expect(
      nextPage(beforeRename.pagination.nextCursor!),
    ).rejects.toMatchObject(invalid);

    const beforeReparent = await firstPage();
    await getDb()
      .update(schema.documents)
      .set({ parentId: null })
      .where(eq(schema.documents.id, "revision-a"));
    await expect(
      nextPage(beforeReparent.pagination.nextCursor!),
    ).rejects.toMatchObject(invalid);
    await getDb()
      .update(schema.documents)
      .set({ parentId: "revision-parent" })
      .where(eq(schema.documents.id, "revision-a"));

    await addFile({
      id: "revision-shared",
      parentId: "revision-parent",
      ownerEmail: OTHER,
      position: -1,
      title: "revision-0-shared",
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
    const beforeRevoke = await firstPage();
    expect(beforeRevoke.items.map((item) => item.documentId)).toEqual([
      "revision-shared",
    ]);
    await getDb()
      .delete(schema.documentShares)
      .where(eq(schema.documentShares.id, "revision-shared-share"));
    await expect(
      nextPage(beforeRevoke.pagination.nextCursor!),
    ).rejects.toMatchObject(invalid);

    const beforeDelete = await firstPage();
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: "2026-03-03T00:00:00.000Z" })
      .where(eq(schema.documents.id, "revision-a"));
    await expect(
      nextPage(beforeDelete.pagination.nextCursor!),
    ).rejects.toMatchObject(invalid);
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: null })
      .where(eq(schema.documents.id, "revision-a"));

    await addFile({
      id: "revision-inaccessible",
      parentId: "revision-parent",
      ownerEmail: OTHER,
      position: -2,
      title: "revision-00-hidden",
    });
    const stable = await firstPage();
    expect(stable.items.map((item) => item.documentId)).toEqual(["revision-a"]);
    await getDb()
      .update(schema.documents)
      .set({ title: "still hidden", updatedAt: "2026-03-02T00:00:00.000Z" })
      .where(eq(schema.documents.id, "revision-inaccessible"));
    await expect(
      nextPage(stable.pagination.nextCursor!),
    ).resolves.toMatchObject({
      items: [{ documentId: "revision-b" }],
    });
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

  it("ends the path at the first unreadable or trashed ancestor even when a higher one is readable", async () => {
    const readContext = (id: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        navigationContextAction.run({ id }),
      );
    await addFile({ id: "gap-root", position: 800 });
    await addFile({
      id: "gap-middle",
      parentId: "gap-root",
      ownerEmail: OTHER,
    });
    await addFile({ id: "gap-leaf", parentId: "gap-middle" });
    await addFile({ id: "trashed-middle", parentId: "gap-root" });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: "2026-03-04T00:00:00.000Z" })
      .where(eq(schema.documents.id, "trashed-middle"));
    await addFile({ id: "trashed-leaf", parentId: "trashed-middle" });

    expect(
      (await readContext("gap-leaf")).path.map((entry) => entry.id),
    ).toEqual(["gap-leaf"]);
    expect(
      (await readContext("trashed-leaf")).path.map((entry) => entry.id),
    ).toEqual(["trashed-leaf"]);
  });

  it("rejects a readable ancestry cycle", async () => {
    await addFile({ id: "cycle-a", parentId: "cycle-b" });
    await addFile({ id: "cycle-b", parentId: "cycle-a" });

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        navigationContextAction.run({ id: "cycle-a" }),
      ),
    ).rejects.toThrow("Document ancestry contains a cycle");
  });

  it("reads a 100-level ancestry and rejects a deeper one", async () => {
    for (let depth = 0; depth <= 100; depth += 1) {
      await addFile({
        id: `depth-${depth}`,
        parentId: depth === 0 ? null : `depth-${depth - 1}`,
        position: 900,
      });
    }
    const readContext = (id: string) =>
      runWithRequestContext({ userEmail: OWNER }, () =>
        navigationContextAction.run({ id }),
      );

    const deepest = await readContext("depth-99");
    expect(deepest.path).toHaveLength(100);
    expect(deepest.path[0]?.id).toBe("depth-0");
    expect(deepest.path.at(-1)?.id).toBe("depth-99");
    await expect(readContext("depth-100")).rejects.toThrow(
      "Document ancestry exceeds the supported navigation depth",
    );
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

  it("ranks a child branch from its own siblings in one read", async () => {
    await addFile({ id: "sibling-rank-parent", position: 900 });
    for (let index = 0; index < 6; index += 1) {
      await addFile({
        id: `sibling-rank-${index}`,
        parentId: "sibling-rank-parent",
        position: index,
      });
    }
    await saveCustomOrder([
      ...Array.from(
        { length: 400 },
        (_, index) => `membership-elsewhere-${index}`,
      ),
      "membership-sibling-rank-4",
      "membership-sibling-rank-1",
    ]);

    let first: ContentDatabaseNavigationPageResponse | undefined;
    const statements = await statementsDuring(async () => {
      first = await navigate({ parentId: "sibling-rank-parent" }, 3);
    });
    expect(first!.items.map((item) => item.documentId)).toEqual([
      "sibling-rank-4",
      "sibling-rank-1",
      "sibling-rank-0",
    ]);
    // One read finds the siblings, ranks them, and returns their row flags;
    // the saved list is never expanded into rows to walk.
    expect(
      statements.filter((text) => text.includes('"documents"."parent_id" = $')),
    ).toHaveLength(1);
    expect(statements.join("\n")).not.toContain("jsonb_to_recordset");

    const rest = await navigate(
      {
        parentId: "sibling-rank-parent",
        cursor: first!.pagination.nextCursor!,
      },
      3,
    );
    expect(rest.items.map((item) => item.documentId)).toEqual([
      "sibling-rank-2",
      "sibling-rank-3",
      "sibling-rank-5",
    ]);
    expect(rest.pagination.hasMore).toBe(false);
  });

  it("returns each row's permissions and favorite state from the page read", async () => {
    for (const role of ["editor", "viewer", "admin"] as const) {
      await addFile({ id: `row-flags-${role}`, ownerEmail: OTHER });
      await getDb()
        .insert(schema.documentShares)
        .values({
          id: `row-flags-${role}-share`,
          resourceId: `row-flags-${role}`,
          principalType: "user",
          principalId: OWNER,
          role,
          createdBy: OTHER,
          createdAt: new Date().toISOString(),
        });
    }
    await addFile({ id: "row-flags-favorite" });
    const { setFavoriteMembership } = await import("./_content-favorites.js");
    await setFavoriteMembership({
      db: getDb(),
      userEmail: OWNER,
      documentId: "row-flags-favorite",
      favorite: true,
      now: new Date().toISOString(),
    });
    await saveCustomOrder([
      "membership-row-flags-editor",
      "membership-row-flags-viewer",
      "membership-row-flags-admin",
      "membership-row-flags-favorite",
    ]);

    const roots = await navigate({ parentId: null }, 4);
    expect(
      roots.items.map(({ documentId, canEdit, canManage, isFavorite }) => ({
        documentId,
        canEdit,
        canManage,
        isFavorite,
      })),
    ).toEqual([
      {
        documentId: "row-flags-editor",
        canEdit: true,
        canManage: false,
        isFavorite: false,
      },
      {
        documentId: "row-flags-viewer",
        canEdit: false,
        canManage: false,
        isFavorite: false,
      },
      {
        documentId: "row-flags-admin",
        canEdit: true,
        canManage: true,
        isFavorite: false,
      },
      {
        documentId: "row-flags-favorite",
        canEdit: true,
        canManage: true,
        isFavorite: true,
      },
    ]);
  });

  it("returns expanded folders' first pages with the tree", async () => {
    await addFile({ id: "expand-a", position: 1 });
    await addFile({ id: "expand-b", position: 2 });
    await addFile({ id: "expand-c", position: 3 });
    for (let index = 0; index < 3; index += 1) {
      await addFile({
        id: `expand-a-${index}`,
        parentId: "expand-a",
        position: index,
      });
    }
    await addFile({ id: "expand-a-1-x", parentId: "expand-a-1" });
    await addFile({ id: "expand-a-1-x-y", parentId: "expand-a-1-x" });
    await addFile({ id: "expand-b-trashed", parentId: "expand-b" });
    await getDb()
      .update(schema.documents)
      .set({ trashedAt: "2026-01-02T00:00:00.000Z" })
      .where(eq(schema.documents.id, "expand-b-trashed"));
    await addFile({ id: "expand-c-0", parentId: "expand-c" });
    await addFile({ id: "expand-c-0-x", parentId: "expand-c-0" });
    await addFile({
      id: "expand-hidden-child",
      parentId: "expand-a",
      ownerEmail: OTHER,
      position: -1,
    });
    await addFile({ id: "expand-hidden-x", parentId: "expand-hidden-child" });
    await saveCustomOrder([
      "membership-expand-a",
      "membership-expand-b",
      "membership-expand-c",
    ]);

    const tree = await navigate(
      {
        parentId: null,
        expand: [
          "expand-a",
          "expand-a-1",
          "expand-a-1-x",
          "expand-b",
          "expand-c-0",
          "expand-hidden-child",
          "expand-unknown",
        ],
      },
      3,
    );

    expect(tree.items.map((item) => item.documentId)).toEqual([
      "expand-a",
      "expand-b",
      "expand-c",
    ]);
    // Only expanded folders this read returned, with children the caller can
    // see, come back; a collapsed folder keeps its expanded descendants out.
    expect(Object.keys(tree.branches ?? {}).sort()).toEqual([
      "expand-a",
      "expand-a-1",
      "expand-a-1-x",
    ]);
    expect(tree.branchesTruncated).toBe(false);
    for (const [parentId, branch] of Object.entries(tree.branches!)) {
      expect(branch).toEqual(await navigate({ parentId }, 3));
    }
    expect(
      tree.branches!["expand-a"]!.items.map((item) => item.documentId),
    ).toEqual(["expand-a-0", "expand-a-1", "expand-a-2"]);

    const unexpanded = await navigate({ parentId: null }, 3);
    expect(unexpanded).not.toHaveProperty("branches");
    expect(unexpanded).not.toHaveProperty("branchesTruncated");
  });

  it("opens expanded folders past their parent's first page only from that first page", async () => {
    for (const [index, id] of [
      "past-a",
      "past-b",
      "past-c",
      "past-d",
    ].entries()) {
      await addFile({ id, position: index });
    }
    await addFile({ id: "past-d-1", parentId: "past-d" });
    await addFile({ id: "past-d-1-x", parentId: "past-d-1" });
    await saveCustomOrder([
      "membership-past-a",
      "membership-past-b",
      "membership-past-c",
      "membership-past-d",
    ]);
    const expand = ["past-d", "past-d-1"];

    const first = await navigate({ parentId: null, expand }, 2);
    expect(first.items.map((item) => item.documentId)).toEqual([
      "past-a",
      "past-b",
    ]);
    expect(Object.keys(first.branches ?? {}).sort()).toEqual([
      "past-d",
      "past-d-1",
    ]);
    expect(first.branches!["past-d-1"]).toEqual(
      await navigate({ parentId: "past-d-1" }, 2),
    );

    const rest = await navigate(
      { parentId: null, cursor: first.pagination.nextCursor!, expand },
      1,
    );
    expect(rest.items.map((item) => item.documentId)).toEqual(["past-c"]);
    expect(rest).not.toHaveProperty("branches");
  });

  it("caps how many expanded folders one read returns", async () => {
    const { MAX_NAVIGATION_EXPANDED_BRANCHES } =
      await import("./_database-navigation.js");
    const expand: string[] = [];
    for (const root of ["expand-cap-0", "expand-cap-1"]) {
      await addFile({ id: root });
      expand.push(root);
      for (let index = 0; index < 20; index += 1) {
        const child = `${root}-${String(index).padStart(2, "0")}`;
        await addFile({ id: child, parentId: root, position: index });
        await addFile({ id: `${child}-x`, parentId: child });
        expand.push(child);
      }
    }
    await saveCustomOrder([
      "membership-expand-cap-0",
      "membership-expand-cap-1",
    ]);

    const tree = await navigate({ parentId: null, expand }, 20);

    expect(Object.keys(tree.branches ?? {})).toHaveLength(
      MAX_NAVIGATION_EXPANDED_BRANCHES,
    );
    expect(tree.branches).toHaveProperty("expand-cap-0");
    expect(tree.branches).toHaveProperty("expand-cap-1");
    // The folders the cap left out are marked, not reported as empty.
    expect(tree.branchesTruncated).toBe(true);
  });

  it("keeps the folders asked for first, with the open folders above them, when the cap applies", async () => {
    const { MAX_NAVIGATION_EXPANDED_BRANCHES } =
      await import("./_database-navigation.js");
    const wide: string[] = [];
    for (let index = 0; index < 40; index += 1) {
      const id = `cap-wide-${String(index).padStart(2, "0")}`;
      await addFile({ id, position: index });
      await addFile({ id: `${id}-x`, parentId: id });
      wide.push(id);
    }
    const deep = ["cap-deep-0", "cap-deep-1", "cap-deep-2", "cap-deep-3"];
    for (const [index, id] of deep.entries()) {
      await addFile({ id, parentId: index === 0 ? null : deep[index - 1] });
    }
    await addFile({ id: "cap-deep-3-x", parentId: "cap-deep-3" });

    // The deepest open folder is asked for first, ahead of its ancestors.
    const tree = await navigate(
      { parentId: null, expand: ["cap-deep-3", ...wide, ...deep] },
      20,
    );

    expect(Object.keys(tree.branches ?? {})).toHaveLength(
      MAX_NAVIGATION_EXPANDED_BRANCHES,
    );
    for (const id of deep) expect(tree.branches).toHaveProperty(id);
    expect(tree.branches).toHaveProperty(wide[0]!);
    expect(tree.branches).not.toHaveProperty(wide[wide.length - 1]!);
    expect(tree.branchesTruncated).toBe(true);
  });

  it("returns a deleted database's typed response even when its saved view cannot be read", async () => {
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const now = new Date().toISOString();
    await getDb().insert(schema.documents).values({
      id: "deleted-files-document",
      ownerEmail: OWNER,
      title: "Deleted Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "deleted-files",
      ownerEmail: OWNER,
      documentId: "deleted-files-document",
      title: "Deleted Files",
      deletedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await putUserSetting(
      OWNER,
      personalDatabaseViewSettingKey("deleted-files"),
      { version: 0, views: "unreadable" },
    );

    await expect(
      runWithRequestContext({ userEmail: OWNER }, () =>
        action.run(
          { databaseId: "deleted-files", navigation: { parentId: null } },
          { userEmail: OWNER } as any,
        ),
      ),
    ).resolves.toMatchObject({
      available: false,
      reason: "deleted",
      databaseId: "deleted-files",
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
