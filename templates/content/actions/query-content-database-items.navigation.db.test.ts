import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ActionRunContext } from "@agent-native/core/action";
import { getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import {
  deleteUserSetting,
  getUserSetting,
  putUserSetting,
} from "@agent-native/core/settings";
import { eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { databaseBoardGroups } from "../app/components/editor/database/grouping.js";
import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabaseFilter,
  type ContentDatabaseFilterMode,
  type ContentDatabaseItem,
  type ContentDatabaseNavigationPageResponse,
  type ContentDatabaseSort,
  type ContentDatabaseView,
  type DocumentProperty,
} from "../shared/api.js";
import {
  applyContentDatabaseTableQuery,
  contentDatabaseFilterOperatorNeedsValue,
  contentDatabaseFilterOperatorsForType,
  contentDatabaseFilterToday,
} from "../shared/database-query.js";
import {
  parsePropertyValue,
  type DocumentPropertyType,
} from "../shared/properties.js";

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
  const statements: string[] = [];
  const prototype = Object.getPrototypeOf(getDb().$client);
  const transaction = prototype.transaction;
  const spy = vi.spyOn(prototype, "transaction").mockImplementation(function (
    this: unknown,
    run: (tx: { query: (...args: unknown[]) => unknown }) => Promise<unknown>,
  ) {
    return transaction.call(
      this,
      (tx: { query: (...args: unknown[]) => unknown }) => {
        const query = tx.query.bind(tx);
        tx.query = (...args: unknown[]) => {
          statements.push(String(args[0]));
          return query(...args);
        };
        return run(tx);
      },
    );
  });
  try {
    await read();
    return statements;
  } finally {
    spy.mockRestore();
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

  it("combines each filter group with its own mode", async () => {
    await addFile({ id: "group-mode-parent", position: 600 });
    for (const title of [
      "Alpha draft",
      "Alpha final",
      "Beta draft",
      "Beta final",
      "Gamma final",
    ]) {
      await addFile({
        id: `group-mode-${title.toLowerCase().replace(" ", "-")}`,
        parentId: "group-mode-parent",
        title,
      });
    }
    const name = (
      operator: string,
      value: string,
      group: Record<string, string> = {},
    ) => ({ key: "name", label: "Name", operator, value, ...group });
    const advanced = (mode: "and" | "or") => ({
      filterGroupId: "advanced",
      filterGroupMode: mode,
    });
    const nested = (mode: "and" | "or", parentMode: "and" | "or") => ({
      filterGroupId: "advanced-nested",
      parentFilterGroupId: "advanced",
      filterGroupMode: mode,
      parentFilterGroupMode: parentMode,
    });
    const titlesFor = async (filters: unknown[], filterMode: "and" | "or") => {
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
                sorts: [{ key: "name", label: "Name", direction: "asc" }],
                filters,
                filterMode,
                columnWidths: {},
              },
            ],
          }),
        })
        .where(eq(schema.contentDatabases.id, DATABASE_ID));
      const page = await navigate({
        parentId: "group-mode-parent",
        viewId: "default",
      });
      return page.items.map((item) => item.title);
    };

    expect(
      await titlesFor(
        [
          name("does_not_equal", "Gamma final"),
          name("contains", "Alpha", advanced("or")),
          name("contains", "Beta", nested("and", "or")),
          name("contains", "draft", nested("and", "or")),
        ],
        "and",
      ),
    ).toEqual(["Alpha draft", "Alpha final", "Beta draft"]);
    expect(
      await titlesFor(
        [
          name("equals", "Gamma final"),
          name("contains", "final", advanced("and")),
          name("contains", "Alpha", nested("or", "and")),
          name("contains", "Beta", nested("or", "and")),
        ],
        "or",
      ),
    ).toEqual(["Alpha final", "Beta final", "Gamma final"]);
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

  it("tells each path entry whether it has Files children, as its navigation row does", async () => {
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    const settingKey = personalDatabaseViewSettingKey(DATABASE_ID);
    const savedSetting = await getUserSetting(OWNER, settingKey);
    await putUserSetting(OWNER, settingKey, {
      version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
      activeViewId: "files",
      views: [
        {
          id: "files",
          sorts: [],
          filters: [
            {
              key: "name",
              label: "Name",
              operator: "contains",
              value: "Shown",
            },
          ],
          filterMode: "and",
          sidebarOrder: { mode: "name", itemIds: [] },
        },
      ],
    });
    try {
      await addFile({ id: "arrow-root", title: "Shown root", position: 950 });
      await addFile({
        id: "arrow-open",
        parentId: "arrow-root",
        title: "Shown open",
      });
      await addFile({
        id: "arrow-open-child",
        parentId: "arrow-open",
        title: "Shown open child",
      });
      // Every child of this page is one the Files tree leaves out.
      await addFile({
        id: "arrow-leaf",
        parentId: "arrow-root",
        title: "Shown leaf",
      });
      await addFile({
        id: "arrow-leaf-trashed",
        parentId: "arrow-leaf",
        title: "Shown trashed",
      });
      await getDb()
        .update(schema.documents)
        .set({ trashedAt: new Date().toISOString() })
        .where(eq(schema.documents.id, "arrow-leaf-trashed"));
      await addFile({
        id: "arrow-leaf-filtered",
        parentId: "arrow-leaf",
        title: "Hidden by the view",
      });
      await addFile({
        id: "arrow-leaf-unreadable",
        parentId: "arrow-leaf",
        title: "Shown but private",
        ownerEmail: OTHER,
      });
      await getDb().insert(schema.documents).values({
        id: "arrow-leaf-outside-files",
        spaceId: SPACE_ID,
        parentId: "arrow-leaf",
        ownerEmail: OWNER,
        title: "Shown outside Files",
        content: "",
        visibility: "private",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });

      const pathOf = async (id: string) =>
        (
          await runWithRequestContext({ userEmail: OWNER }, () =>
            navigationContextAction.run({ id }),
          )
        ).path.map((entry) => [entry.id, entry.hasChildren]);
      expect(await pathOf("arrow-open")).toEqual([
        ["arrow-root", true],
        ["arrow-open", true],
      ]);
      expect(await pathOf("arrow-leaf")).toEqual([
        ["arrow-root", true],
        ["arrow-leaf", false],
      ]);

      const branch = await navigate({ parentId: "arrow-root" });
      expect(
        branch.items.map((item) => [item.documentId, item.hasChildren]),
      ).toEqual([
        ["arrow-leaf", false],
        ["arrow-open", true],
      ]);
    } finally {
      if (savedSetting === null) await deleteUserSetting(OWNER, settingKey);
      else await putUserSetting(OWNER, settingKey, savedSetting);
    }
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
    for (const role of ["editor", "viewer", "admin", "owner"] as const) {
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
      "membership-row-flags-owner",
      "membership-row-flags-favorite",
    ]);

    const roots = await navigate({ parentId: null }, 5);
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
        documentId: "row-flags-owner",
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

describe("Files navigation text and date filters", () => {
  const CREATED_ID = "navigation-created-time";
  const PARENT_ID = "date-filter-parent";
  const createdDefinition = {
    id: CREATED_ID,
    databaseId: DATABASE_ID,
    name: "Created",
    type: "created_time",
    visibility: "always_show",
    options: {},
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } satisfies DocumentProperty["definition"];
  const files = [
    {
      id: "date-filter-oct-14",
      title: "Alpha Launch",
      createdAt: "2026-10-14T12:00:00.000Z",
    },
    {
      id: "date-filter-oct-21",
      title: "alpha notes",
      createdAt: "2026-10-21T23:30:00.000Z",
    },
    {
      id: "date-filter-oct-22-start",
      title: "Beta launch plan",
      createdAt: "2026-10-22T00:00:00.000Z",
    },
    {
      id: "date-filter-oct-22-evening",
      title: "Beta Recap",
      createdAt: "2026-10-22T18:00:00.000Z",
    },
    {
      id: "date-filter-oct-22-end",
      title: "\tGamma\n",
      createdAt: "2026-10-22T23:59:59.999Z",
    },
    {
      id: "date-filter-oct-23",
      title: "Gamma launch",
      createdAt: "2026-10-23T00:00:00.000Z",
    },
    {
      id: "date-filter-oct-29",
      title: "Delta\u00a0",
      createdAt: "2026-10-29T12:00:00.000Z",
    },
    {
      id: "date-filter-oct-30",
      title: "Epsilon LAUNCH",
      createdAt: "2026-10-30T00:00:00.000Z",
    },
  ];

  beforeAll(async () => {
    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: CREATED_ID,
      ownerEmail: OWNER,
      databaseId: DATABASE_ID,
      name: "Created",
      type: "created_time",
    });
    await addFile({ id: PARENT_ID, position: 700 });
    for (const file of files) {
      await addFile({ ...file, parentId: PARENT_ID });
    }
  });

  afterEach(async () => {
    vi.useRealTimers();
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: "{}" })
      .where(eq(schema.contentDatabases.id, DATABASE_ID));
  });

  // Each Files row as the shared evaluator sees it.
  const evaluatorItems: ContentDatabaseItem[] = files.map((file, position) => ({
    id: `membership-${file.id}`,
    databaseId: DATABASE_ID,
    position,
    document: {
      id: file.id,
      parentId: PARENT_ID,
      title: file.title,
      content: "",
      icon: null,
      position,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: file.createdAt,
      updatedAt: file.createdAt,
    },
    properties: [
      { definition: createdDefinition, value: file.createdAt, editable: false },
    ],
  }));

  async function navigatedIds(filter: ContentDatabaseFilter, timezone: string) {
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
              sorts: [],
              filters: [filter],
              filterMode: "and",
              columnWidths: {},
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, DATABASE_ID));
    const page = (await runWithRequestContext(
      { userEmail: OWNER, timezone },
      () =>
        action.run(
          {
            databaseId: DATABASE_ID,
            navigation: { parentId: PARENT_ID, viewId: "default" },
          },
          { userEmail: OWNER } as any,
        ),
    )) as ContentDatabaseNavigationPageResponse;
    return page.items.map((item) => item.documentId).sort();
  }

  function evaluatedIds(
    filter: ContentDatabaseFilter,
    today: string,
    timeZone?: string,
  ) {
    return applyContentDatabaseTableQuery(
      evaluatorItems,
      [evaluatorItems[0]!.properties[0]!],
      { search: "", filters: [filter], sorts: [] },
      { today, timeZone },
    )
      .map((item) => item.document.id)
      .sort();
  }

  const name = (
    operator: ContentDatabaseFilter["operator"],
    value: string,
  ): ContentDatabaseFilter => ({ key: "name", label: "Name", operator, value });
  const created = (
    operator: ContentDatabaseFilter["operator"],
    value: string,
  ): ContentDatabaseFilter => ({
    key: CREATED_ID,
    label: "Created",
    operator,
    value,
  });
  const ids = (...suffixes: string[]) =>
    suffixes.map((suffix) => `date-filter-${suffix}`).sort();

  it("matches the shared evaluator for the new text operators", async () => {
    const expected: Array<[ContentDatabaseFilter, string[]]> = [
      [
        name("does_not_contain", "LAUNCH"),
        ids("oct-21", "oct-22-evening", "oct-22-end", "oct-29"),
      ],
      [name("starts_with", "alpha"), ids("oct-14", "oct-21")],
      [name("starts_with", "BETA "), ids("oct-22-start", "oct-22-evening")],
      [name("ends_with", "launch"), ids("oct-14", "oct-23", "oct-30")],
      // Titles are trimmed of tabs, newlines and no-break spaces too.
      [name("starts_with", "gamma"), ids("oct-22-end", "oct-23")],
      [name("ends_with", "delta"), ids("oct-29")],
      [name("equals", "gamma"), ids("oct-22-end")],
    ];
    for (const [filter, rows] of expected) {
      expect(await navigatedIds(filter, "UTC")).toEqual(rows);
      expect(evaluatedIds(filter, "2026-10-22")).toEqual(rows);
    }
  });

  it("matches the shared evaluator on whole days and relative dates", async () => {
    // 02:30 UTC on 23 October is still 22 October in New York.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T02:30:00.000Z"));
    const today = "2026-10-22";
    const october22 = ["oct-22-start", "oct-22-evening", "oct-22-end"];
    const everyFile = files.map((file) => file.id.replace("date-filter-", ""));
    const expected: Array<[ContentDatabaseFilter, string[]]> = [
      [created("equals", "2026-10-22"), ids(...october22)],
      [
        created("does_not_equal", "2026-10-22"),
        ids("oct-14", "oct-21", "oct-23", "oct-29", "oct-30"),
      ],
      [created("before", "2026-10-22"), ids("oct-14", "oct-21")],
      [
        created("on_or_before", "2026-10-22"),
        ids("oct-14", "oct-21", ...october22),
      ],
      [created("after", "2026-10-22"), ids("oct-23", "oct-29", "oct-30")],
      [
        created("on_or_after", "2026-10-22"),
        ids(...october22, "oct-23", "oct-29", "oct-30"),
      ],
      [
        created("between", JSON.stringify(["2026-10-22", "2026-10-22"])),
        ids(...october22),
      ],
      [created("on_or_before", "today"), ids("oct-14", "oct-21", ...october22)],
      [created("equals", "tomorrow"), ids("oct-23")],
      [
        created("between", JSON.stringify(["yesterday", "today"])),
        ids("oct-21", ...october22),
      ],
      // 22 to 28 October.
      [created("is_within", "next_7_days"), ids(...october22, "oct-23")],
      [created("is_within", "past_7_days"), ids("oct-21", ...october22)],
      [
        created("is_within", "this_week"),
        ids("oct-21", ...october22, "oct-23"),
      ],
      [
        created("on_or_after", "2026-10-22T12:00:00.000Z"),
        ids("oct-22-evening", "oct-22-end", "oct-23", "oct-29", "oct-30"),
      ],
      // 17:00 UTC: as text, "…T19:00:00+02:00" sorts after the 18:00 UTC row.
      [
        created("on_or_after", "2026-10-22T19:00:00+02:00"),
        ids("oct-22-evening", "oct-22-end", "oct-23", "oct-29", "oct-30"),
      ],
      [created("equals", "2026-10-22T20:00:00+02:00"), ids("oct-22-evening")],
      [
        created("does_not_equal", "2026-10-22T18:00:00.000Z"),
        ids(
          "oct-14",
          "oct-21",
          "oct-22-start",
          "oct-22-end",
          "oct-23",
          "oct-29",
          "oct-30",
        ),
      ],
      [created("on_or_before", "2026-02-30"), []],
      [created("is_within", "next_fortnight"), []],
      // A range with a blank end is still being filled in, so it's skipped.
      [
        created("between", JSON.stringify(["2026-10-22", ""])),
        ids(...everyFile),
      ],
      [created("between", "2026-10-22"), ids(...everyFile)],
    ];
    for (const [filter, rows] of expected) {
      expect(await navigatedIds(filter, "America/New_York")).toEqual(rows);
      expect(evaluatedIds(filter, today, "America/New_York")).toEqual(rows);
    }
  });

  it("reads a time without an offset in the caller's time zone", async () => {
    // Both are 17:00 UTC on 22 October; this machine's zone plays no part.
    const rows = ids(
      "oct-22-evening",
      "oct-22-end",
      "oct-23",
      "oct-29",
      "oct-30",
    );
    for (const [timezone, value, today] of [
      ["America/New_York", "2026-10-22T13:00", "2026-10-22"],
      ["Asia/Tokyo", "2026-10-23T02:00", "2026-10-23"],
    ] as const) {
      const filter = created("on_or_after", value);
      expect(await navigatedIds(filter, timezone)).toEqual(rows);
      expect(evaluatedIds(filter, today, timezone)).toEqual(rows);
    }
  });

  it("reads a row's time to the millisecond in both readers", async () => {
    // The database's own timestamps keep microseconds; JavaScript dates don't.
    const evening = "date-filter-oct-22-evening";
    const precise = "2026-10-22 18:00:00.0004+00";
    const setCreated = (createdAt: string) =>
      getDb()
        .update(schema.documents)
        .set({ createdAt })
        .where(eq(schema.documents.id, evening));
    const items = evaluatorItems.map((item) =>
      item.document.id === evening
        ? {
            ...item,
            document: { ...item.document, createdAt: precise },
            properties: [{ ...item.properties[0]!, value: precise }],
          }
        : item,
    );
    await setCreated(precise);
    try {
      for (const [operator, rows] of [
        [
          "on_or_before",
          ids("oct-14", "oct-21", "oct-22-start", "oct-22-evening"),
        ],
        ["after", ids("oct-22-end", "oct-23", "oct-29", "oct-30")],
      ] as const) {
        const filter = created(operator, "2026-10-22T18:00:00.000Z");
        expect(await navigatedIds(filter, "UTC")).toEqual(rows);
        expect(
          applyContentDatabaseTableQuery(
            items,
            [items[0]!.properties[0]!],
            { search: "", filters: [filter], sorts: [] },
            { today: "2026-10-22", timeZone: "UTC" },
          )
            .map((item) => item.document.id)
            .sort(),
        ).toEqual(rows);
      }
    } finally {
      await setCreated("2026-10-22T18:00:00.000Z");
    }
  });

  it("ties a cursor under a time without an offset to the caller's time zone", async () => {
    await navigatedIds(created("on_or_after", "2026-10-22T13:00"), "UTC");
    const page = (timezone: string, cursor?: string) =>
      runWithRequestContext({ userEmail: OWNER, timezone }, () =>
        action.run(
          {
            databaseId: DATABASE_ID,
            navigation: { parentId: PARENT_ID, viewId: "default", cursor },
            limit: 2,
          },
          { userEmail: OWNER } as any,
        ),
      ) as Promise<ContentDatabaseNavigationPageResponse>;
    const first = await page("America/New_York");
    const cursor = first.pagination.nextCursor!;
    expect(cursor).toEqual(expect.any(String));
    await expect(page("America/New_York", cursor)).resolves.toMatchObject({
      items: expect.any(Array),
    });
    await expect(page("Asia/Tokyo", cursor)).rejects.toMatchObject({
      errorCode: "invalid_navigation_cursor",
    });
  });

  it("resolves relative dates in the caller's time zone when the view is read", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-23T02:30:00.000Z"));
    const isToday = created("equals", "today");
    expect(await navigatedIds(isToday, "America/New_York")).toEqual(
      ids("oct-22-start", "oct-22-evening", "oct-22-end"),
    );
    expect(await navigatedIds(isToday, "Asia/Tokyo")).toEqual(ids("oct-23"));

    vi.setSystemTime(new Date("2026-10-29T15:00:00.000Z"));
    expect(await navigatedIds(isToday, "America/New_York")).toEqual(
      ids("oct-29"),
    );
  });
});

describe("Files navigation filters on stored property values", () => {
  const PARENT_ID = "stored-filter-parent";
  const color = "gray";
  const definitions = {
    notes: { id: "stored-notes", name: "Notes", type: "text", options: {} },
    site: { id: "stored-site", name: "Site", type: "url", options: {} },
    points: {
      id: "stored-points",
      name: "Points",
      type: "number",
      options: {},
    },
    done: { id: "stored-done", name: "Done", type: "checkbox", options: {} },
    stage: {
      id: "stored-stage",
      name: "Stage",
      type: "select",
      options: {
        options: [
          { id: "stage-idea", name: "Idea", color },
          { id: "stage-draft", name: "Draft", color },
          { id: "stage-live", name: "Live", color },
        ],
      },
    },
    state: {
      id: "stored-state",
      name: "State",
      type: "status",
      options: {
        options: [
          { id: "state-todo", name: "Not started", color },
          { id: "state-doing", name: "In progress", color },
          { id: "state-done", name: "Done", color },
        ],
      },
    },
    tags: {
      id: "stored-tags",
      name: "Tags",
      type: "multi_select",
      options: {
        options: [
          { id: "tag-red", name: "Red", color },
          { id: "tag-blue", name: "Blue", color },
          { id: "tag-green", name: "Light green", color },
        ],
      },
    },
    owner: { id: "stored-owner", name: "Owner", type: "person", options: {} },
    due: { id: "stored-due", name: "Due", type: "date", options: {} },
    measure: {
      id: "stored-measure",
      name: "Measure",
      type: "number",
      options: {},
    },
    remark: { id: "stored-remark", name: "Remark", type: "text", options: {} },
  } satisfies Record<
    string,
    Pick<DocumentProperty["definition"], "id" | "name" | "type" | "options">
  >;
  type Key = keyof typeof definitions;
  const keys = Object.keys(definitions) as Key[];
  class SavedText {
    constructor(readonly text: string) {}
  }
  const savedJson = (value: unknown) =>
    value instanceof SavedText ? value.text : JSON.stringify(value);
  const files: Array<{ id: string; values: Partial<Record<Key, unknown>> }> = [
    {
      id: "launch",
      values: {
        notes: "Ship the launch plan",
        site: "https://example.com/Launch",
        points: 5,
        done: true,
        stage: "stage-draft",
        state: "state-doing",
        tags: ["tag-red", "tag-blue"],
        owner: ["alice@example.com"],
        due: { start: "2026-10-22", includeTime: false },
        measure: "1e200000",
        remark: new SavedText('{"note": "unfinished'),
      },
    },
    {
      id: "recap",
      values: {
        notes: "  Launch recap\t",
        site: "",
        points: "12",
        done: false,
        stage: "stage-live",
        state: "state-done",
        tags: ["tag-green"],
        owner: ["bo@example.com", "alice@example.com"],
        due: { start: "2026-10-22T09:30", includeTime: true },
        measure: new SavedText("1e400"),
        remark: "kept",
      },
    },
    {
      id: "retired",
      values: {
        notes: null,
        points: -3.5,
        stage: "Retired",
        state: null,
        tags: [],
        due: { start: "2026-10-23T03:30", includeTime: true },
        measure: "1e-20000",
      },
    },
    {
      id: "odd",
      values: {
        notes: "",
        points: 0,
        done: "yes",
        tags: ["tag-unknown"],
        owner: [],
        due: "2026-10-21",
        measure: "1.00000000000000001",
        remark: new SavedText(""),
      },
    },
    { id: "empty", values: {} },
    {
      id: "draft",
      values: {
        notes: "Draft",
        points: "abc",
        stage: "stage-idea",
        state: "state-todo",
        tags: ["tag-blue"],
        due: { start: "2026-10-22T20:00:00+02:00", includeTime: true },
        measure: new SavedText("[1, 2"),
        remark: new SavedText("not json"),
      },
    },
    {
      id: "range",
      values: {
        notes: "launch",
        points: " 7 ",
        tags: ["tag-red"],
        due: { start: "2026-10-20", end: "2026-10-25", includeTime: false },
        measure: "1e00005",
      },
    },
    {
      id: "bad-date",
      values: {
        points: 1e21,
        due: { start: "2026-02-30T10:00", includeTime: true },
        measure: "-1e309",
      },
    },
    {
      id: "gap",
      values: {
        due: { start: "2026-03-08T02:30", includeTime: true },
        measure: new SavedText("2.5e-324"),
      },
    },
    {
      id: "after-gap",
      values: {
        due: { start: "2026-03-08T03:15", includeTime: true },
        measure: "2e-324",
      },
    },
    {
      id: "overlap",
      values: {
        due: { start: "2026-11-01T01:30", includeTime: true },
        measure: "1.7976931348623158e308",
      },
    },
  ];
  const fileIds = files.map((file) => file.id);
  const computedTypes = [
    "formula",
    "rollup",
    "relation",
    "files_media",
    "blocks",
    "id",
  ] as const;

  beforeAll(async () => {
    for (const definition of Object.values(definitions)) {
      await getDb()
        .insert(schema.documentPropertyDefinitions)
        .values({
          id: definition.id,
          ownerEmail: OWNER,
          databaseId: DATABASE_ID,
          name: definition.name,
          type: definition.type,
          optionsJson: JSON.stringify(definition.options),
        });
    }
    for (const type of computedTypes) {
      await getDb()
        .insert(schema.documentPropertyDefinitions)
        .values({
          id: `stored-computed-${type}`,
          ownerEmail: OWNER,
          databaseId: DATABASE_ID,
          name: type,
          type,
        });
    }
    await addFile({ id: PARENT_ID, position: 800 });
    for (const [position, file] of files.entries()) {
      await addFile({
        id: `stored-${file.id}`,
        title: file.id,
        parentId: PARENT_ID,
        position,
      });
      for (const key of keys) {
        if (!(key in file.values)) continue;
        await getDb()
          .insert(schema.documentPropertyValues)
          .values({
            id: `stored-value-${file.id}-${key}`,
            ownerEmail: OWNER,
            documentId: `stored-${file.id}`,
            propertyId: definitions[key].id,
            valueJson: savedJson(file.values[key]),
          });
      }
    }
  });

  afterEach(async () => {
    vi.useRealTimers();
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: "{}" })
      .where(eq(schema.contentDatabases.id, DATABASE_ID));
  });

  const propertyByKey = keys.map((key, position) => ({
    key,
    property: {
      definition: {
        ...definitions[key],
        databaseId: DATABASE_ID,
        visibility: "always_show",
        position,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      value: null,
      editable: true,
    } satisfies DocumentProperty,
  }));
  const evaluatorProperties: DocumentProperty[] = propertyByKey.map(
    ({ property }) => property,
  );
  const evaluatorItems: ContentDatabaseItem[] = files.map((file, position) => ({
    id: `membership-stored-${file.id}`,
    databaseId: DATABASE_ID,
    position,
    document: {
      id: file.id,
      parentId: PARENT_ID,
      title: file.id,
      content: "",
      icon: null,
      position,
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    properties: propertyByKey.map(({ key, property }) => {
      const value = file.values[key];
      return {
        ...property,
        value:
          value === undefined ? null : parsePropertyValue(savedJson(value)),
      };
    }),
  }));

  async function setView(
    filters: ContentDatabaseFilter[],
    filterMode: ContentDatabaseFilterMode = "and",
    sorts: ContentDatabaseSort[] = [],
  ) {
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
              sorts,
              filters,
              filterMode,
              columnWidths: {},
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, DATABASE_ID));
  }

  const readPage = (
    timezone: string,
    options: { cursor?: string; limit?: number } = {},
  ) =>
    runWithRequestContext({ userEmail: OWNER, timezone }, () =>
      action.run(
        {
          databaseId: DATABASE_ID,
          navigation: {
            parentId: PARENT_ID,
            viewId: "default",
            cursor: options.cursor,
          },
          ...(options.limit ? { limit: options.limit } : {}),
        },
        { userEmail: OWNER } as ActionRunContext,
      ),
    ) as Promise<ContentDatabaseNavigationPageResponse>;

  async function navigatedIds(
    filters: ContentDatabaseFilter[],
    timezone: string,
    filterMode: ContentDatabaseFilterMode = "and",
  ) {
    await setView(filters, filterMode);
    const page = await readPage(timezone);
    return page.items
      .map((item) => item.documentId.replace(/^stored-/, ""))
      .sort();
  }

  function evaluatedIds(
    filters: ContentDatabaseFilter[],
    timeZone: string,
    filterMode: ContentDatabaseFilterMode = "and",
  ) {
    return applyContentDatabaseTableQuery(
      evaluatorItems,
      evaluatorProperties,
      { search: "", filters, sorts: [], filterMode },
      { today: contentDatabaseFilterToday(timeZone), timeZone },
    )
      .map((item) => item.document.id)
      .sort();
  }

  const on = (
    key: Key | "name",
    operator: ContentDatabaseFilter["operator"],
    value = "",
  ): ContentDatabaseFilter => ({
    key: key === "name" ? "name" : definitions[key].id,
    label: key,
    operator,
    value,
  });
  const except = (...excluded: string[]) =>
    fileIds.filter((id) => !excluded.includes(id)).sort();
  const rows = (...included: string[]) => [...included].sort();

  const NOW = new Date("2026-10-22T16:00:00.000Z");

  it("matches the shared evaluator on each property type", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const october22 = ["launch", "recap", "draft"];
    const expected: Array<[ContentDatabaseFilter, string[]]> = [
      [on("notes", "contains", "launch"), rows("launch", "recap", "range")],
      [on("notes", "equals", "Launch Recap"), rows("recap")],
      [on("notes", "starts_with", "ship"), rows("launch")],
      [on("notes", "ends_with", "RECAP"), rows("recap")],
      [
        on("notes", "does_not_contain", "launch"),
        except("launch", "recap", "range"),
      ],
      [on("notes", "is_empty"), except("launch", "recap", "draft", "range")],
      [on("site", "contains", "example.com/launch"), rows("launch")],
      [on("site", "is_not_empty"), rows("launch")],
      [
        on("points", "greater_than", "4"),
        rows("launch", "recap", "range", "bad-date"),
      ],
      [on("points", "less_than_or_equal", "0"), rows("retired", "odd")],
      [on("points", "equals", "12"), rows("recap")],
      [on("points", "greater_than", "many"), []],
      [on("points", "is_empty"), rows("empty", "gap", "after-gap", "overlap")],
      [on("done", "is_checked"), rows("launch")],
      [on("done", "is_unchecked"), except("launch")],
      [on("stage", "equals", "draft"), rows("launch")],
      [
        on("stage", "contains", JSON.stringify(["Idea", "stage-live"])),
        rows("draft", "recap"),
      ],
      [on("stage", "does_not_equal", "Draft"), except("launch")],
      [on("stage", "equals", "retired"), rows("retired")],
      [on("stage", "starts_with", "dr"), rows("launch")],
      [on("state", "equals", "In progress"), rows("launch")],
      [on("state", "is_empty"), except("launch", "recap", "draft")],
      [on("tags", "contains", "red"), rows("launch", "range")],
      [
        on("tags", "contains", JSON.stringify(["Light green", "tag-blue"])),
        rows("launch", "recap", "draft"),
      ],
      [on("tags", "does_not_equal", "Red"), except("launch", "range")],
      [
        on("tags", "is_empty"),
        rows("retired", "empty", "bad-date", "gap", "after-gap", "overlap"),
      ],
      [on("tags", "contains", "tag-unknown"), rows("odd")],
      [on("tags", "starts_with", "red b"), rows("launch")],
      [on("owner", "contains", "ALICE@example.com"), rows("launch", "recap")],
      [
        on("owner", "does_not_equal", "alice@example.com"),
        except("launch", "recap"),
      ],
      [on("due", "equals", "2026-10-22"), rows(...october22)],
      [
        on("due", "before", "today"),
        rows("odd", "range", "bad-date", "gap", "after-gap"),
      ],
      [on("due", "is_within", "next_7_days"), rows(...october22, "retired")],
      [
        on("due", "between", JSON.stringify(["2026-10-21", "2026-10-22"])),
        rows(...october22, "odd"),
      ],
      [
        on("due", "on_or_after", "2026-10-22T12:00"),
        rows("launch", "retired", "draft", "overlap"),
      ],
      [
        on("due", "does_not_equal", "2026-10-22T09:30"),
        except("launch", "recap"),
      ],
      [
        on("due", "after", "2026-10-22T17:59:00.000Z"),
        rows("retired", "draft", "overlap"),
      ],
      [on("due", "before", "2026-03-08T07:20:00.000Z"), rows("after-gap")],
      [on("due", "on_or_after", "2026-11-01T05:30:00.000Z"), rows("overlap")],
      [on("due", "on_or_after", "2026-11-01T05:31:00.000Z"), []],
    ];
    for (const [filter, ids] of expected) {
      const label = JSON.stringify(filter);
      expect({
        filter: label,
        ids: await navigatedIds([filter], "America/New_York"),
      }).toEqual({ filter: label, ids });
      expect({
        filter: label,
        ids: evaluatedIds([filter], "America/New_York"),
      }).toEqual({ filter: label, ids });
    }
  });

  it("matches the shared evaluator on every operator a property offers", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const dates = [
      "2026-10-22",
      "today",
      "yesterday",
      "2026-10-22T12:00",
      "2026-10-22T18:00:00.000Z",
      "2026-03-08T07:20:00.000Z",
      "2026-11-01T01:30",
      "2026-02-30",
    ];
    const valuesByType: Partial<Record<DocumentPropertyType, string[]>> = {
      text: ["launch", "Launch Recap", "draft", "ship the", "kept"],
      url: ["example.com/launch", "https://example.com/launch", "HTTPS"],
      number: ["5", "12", "-3.5", "0", "1", "100000", "1e21", "1e308", "abc"],
      select: [
        "Draft",
        "stage-live",
        JSON.stringify(["Idea", "stage-live"]),
        "Retired",
      ],
      status: ["In progress", "state-done", "Not started"],
      multi_select: [
        "Red",
        JSON.stringify(["Light green", "tag-blue"]),
        "tag-unknown",
      ],
      person: ["alice@example.com", JSON.stringify(["bo@example.com"])],
      date: dates,
    };
    const valuesFor = (
      type: DocumentPropertyType,
      operator: ContentDatabaseFilter["operator"],
    ) => {
      if (!contentDatabaseFilterOperatorNeedsValue(operator)) return [""];
      if (operator === "between") {
        return [
          JSON.stringify(["2026-10-21", "2026-10-22"]),
          JSON.stringify(["2026-10-22T09:00", "tomorrow"]),
        ];
      }
      if (operator === "is_within") {
        return ["next_7_days", "past_7_days", "this_week"];
      }
      return valuesByType[type] ?? [];
    };
    const sweep = keys.flatMap((key) =>
      contentDatabaseFilterOperatorsForType(definitions[key].type).flatMap(
        (operator) =>
          valuesFor(definitions[key].type, operator).map((value) => ({
            filter: on(key, operator, value),
            zones:
              key === "due"
                ? ["America/New_York", "Asia/Tokyo"]
                : ["America/New_York"],
          })),
      ),
    );
    let narrowing = 0;
    for (const { filter, zones } of sweep) {
      for (const zone of zones) {
        const label = `${JSON.stringify(filter)} in ${zone}`;
        const evaluated = evaluatedIds([filter], zone);
        expect({
          filter: label,
          ids: await navigatedIds([filter], zone),
        }).toEqual({ filter: label, ids: evaluated });
        if (evaluated.length > 0 && evaluated.length < files.length)
          narrowing++;
      }
    }
    expect(narrowing).toBeGreaterThan(sweep.length / 2);
  }, 120_000);

  it("reads a saved value Postgres can't hold as JSON as no value", async () => {
    const propertyId = "stored-nul";
    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: OWNER,
      databaseId: DATABASE_ID,
      name: "Nul",
      type: "text",
    });
    await getDb().insert(schema.documentPropertyValues).values({
      id: "stored-value-launch-nul",
      ownerEmail: OWNER,
      documentId: "stored-launch",
      propertyId,
      valueJson: '"a\\u0000b"',
    });
    const filter = (
      operator: ContentDatabaseFilter["operator"],
      value = "",
    ): ContentDatabaseFilter => ({
      key: propertyId,
      label: "Nul",
      operator,
      value,
    });
    try {
      expect(await navigatedIds([filter("is_empty")], "UTC")).toEqual(
        [...fileIds].sort(),
      );
      expect(await navigatedIds([filter("contains", "a")], "UTC")).toEqual([]);
    } finally {
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, propertyId));
      await getDb()
        .delete(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    }
  });
  it("leaves out an option Postgres can't hold, rather than failing", async () => {
    const propertyId = "stored-nul-option";
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: propertyId,
        ownerEmail: OWNER,
        databaseId: DATABASE_ID,
        name: "Phase",
        type: "select",
        optionsJson: JSON.stringify({
          options: [
            { id: "phase-live", name: "Li\u0000ve", color },
            { id: "phase\u0000odd", name: "Odd", color },
            { id: "phase-lone", name: "Lone \ud800", color },
            { id: "phase\udc00stray", name: "Stray", color },
            { id: "phase-idea", name: "Idea", color },
          ],
        }),
      });
    await getDb()
      .insert(schema.documentPropertyValues)
      .values([
        {
          id: "stored-value-launch-phase",
          ownerEmail: OWNER,
          documentId: "stored-launch",
          propertyId,
          valueJson: JSON.stringify("phase-live"),
        },
        {
          id: "stored-value-recap-phase",
          ownerEmail: OWNER,
          documentId: "stored-recap",
          propertyId,
          valueJson: JSON.stringify("phase-idea"),
        },
        {
          id: "stored-value-draft-phase",
          ownerEmail: OWNER,
          documentId: "stored-draft",
          propertyId,
          valueJson: JSON.stringify("phase-lone"),
        },
      ]);
    const filter = (
      operator: ContentDatabaseFilter["operator"],
      value = "",
    ): ContentDatabaseFilter => ({
      key: propertyId,
      label: "Phase",
      operator,
      value,
    });
    try {
      expect(
        await navigatedIds([filter("equals", "phase-live")], "UTC"),
      ).toEqual(["launch"]);
      expect(await navigatedIds([filter("equals", "Idea")], "UTC")).toEqual([
        "recap",
      ]);
      expect(
        await navigatedIds([filter("equals", "phase-lone")], "UTC"),
      ).toEqual(["draft"]);
      expect(await navigatedIds([filter("is_empty")], "UTC")).toEqual(
        except("launch", "recap", "draft"),
      );
    } finally {
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, propertyId));
      await getDb()
        .delete(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    }
  });

  it("combines stored-value filters with other filters and groups", async () => {
    const cases: Array<
      [ContentDatabaseFilter[], ContentDatabaseFilterMode, string[]]
    > = [
      [
        [on("stage", "equals", "Draft"), on("tags", "contains", "Light green")],
        "or",
        rows("launch", "recap"),
      ],
      [
        [on("name", "contains", "a"), on("tags", "is_not_empty")],
        "and",
        rows("launch", "recap", "draft", "range"),
      ],
      [
        [
          on("state", "equals", "Not started"),
          {
            ...on("points", "greater_than", "4"),
            filterGroupId: "high",
            filterGroupMode: "and",
          },
          {
            ...on("done", "is_unchecked"),
            filterGroupId: "high",
            filterGroupMode: "and",
          },
        ],
        "or",
        rows("recap", "range", "bad-date", "draft"),
      ],
    ];
    for (const [filters, mode, ids] of cases) {
      const label = JSON.stringify(filters);
      expect({
        filters: label,
        ids: await navigatedIds(filters, "UTC", mode),
      }).toEqual({ filters: label, ids });
      expect({
        filters: label,
        ids: evaluatedIds(filters, "UTC", mode),
      }).toEqual({ filters: label, ids });
    }
  });

  it("pages through rows a stored-value filter keeps", async () => {
    await setView([on("tags", "is_not_empty")]);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await readPage("UTC", { cursor, limit: 2 });
      seen.push(...page.items.map((item) => item.documentId));
      cursor = page.pagination.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen.map((id) => id.replace(/^stored-/, "")).sort()).toEqual(
      rows("launch", "recap", "odd", "draft", "range"),
    );
  });

  it("gives a row children only when a child passes the filter", async () => {
    await addFile({ id: "stored-launch-child", parentId: "stored-launch" });
    await addFile({ id: "stored-recap-child", parentId: "stored-recap" });
    await getDb()
      .insert(schema.documentPropertyValues)
      .values([
        {
          id: "stored-value-launch-child-notes",
          ownerEmail: OWNER,
          documentId: "stored-launch-child",
          propertyId: definitions.notes.id,
          valueJson: JSON.stringify("Launch notes"),
        },
        {
          id: "stored-value-recap-child-notes",
          ownerEmail: OWNER,
          documentId: "stored-recap-child",
          propertyId: definitions.notes.id,
          valueJson: JSON.stringify("Other notes"),
        },
      ]);
    await setView([on("notes", "contains", "launch")]);
    const page = await readPage("UTC");
    expect(
      Object.fromEntries(
        page.items.map((item) => [item.documentId, item.hasChildren]),
      ),
    ).toEqual({
      "stored-launch": true,
      "stored-recap": false,
      "stored-range": false,
    });
  });

  it("refuses filters on values worked out as a row is read", async () => {
    for (const type of computedTypes) {
      await setView([
        {
          key: `stored-computed-${type}`,
          label: type,
          operator: "is_not_empty",
          value: "",
        },
      ]);
      await expect(readPage("UTC")).rejects.toMatchObject({
        errorCode: "unsupported_navigation_filter_expression",
      });
    }
  });

  const by = (
    key: Key | "name",
    direction: ContentDatabaseSort["direction"] = "asc",
  ): ContentDatabaseSort => ({
    key: key === "name" ? "name" : definitions[key].id,
    label: `${key} ${direction}`,
    direction,
  });
  const computedSort = (
    type: (typeof computedTypes)[number],
  ): ContentDatabaseSort => ({
    key: `stored-computed-${type}`,
    label: `${type} asc`,
    direction: "asc",
  });

  async function sortedIds(
    sorts: ContentDatabaseSort[],
    filters: ContentDatabaseFilter[] = [],
  ) {
    await setView(filters, "and", sorts);
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await readPage("UTC", { cursor, limit: 3 });
      ids.push(
        ...page.items.map((item) => item.documentId.replace(/^stored-/, "")),
      );
      cursor = page.pagination.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  }

  function evaluatedOrder(
    sorts: ContentDatabaseSort[],
    filters: ContentDatabaseFilter[] = [],
  ) {
    return applyContentDatabaseTableQuery(
      evaluatorItems,
      evaluatorProperties,
      { search: "", filters, sorts, filterMode: "and" },
      { today: contentDatabaseFilterToday("UTC"), timeZone: "UTC" },
    ).map((item) => item.document.id);
  }

  it("sorts on each stored property type as the shared evaluator does", async () => {
    expect(await sortedIds([by("points")])).toEqual([
      "empty",
      "gap",
      "after-gap",
      "overlap",
      "retired",
      "odd",
      "launch",
      "range",
      "recap",
      "bad-date",
      "draft",
    ]);
    for (const key of keys) {
      for (const direction of ["asc", "desc"] as const) {
        const sort = by(key, direction);
        expect({ sort: sort.label, ids: await sortedIds([sort]) }).toEqual({
          sort: sort.label,
          ids: evaluatedOrder([sort]),
        });
      }
    }
  });

  it("breaks ties with the view's later sorts, then the row order", async () => {
    const cases = [
      [by("done"), by("name", "desc")],
      [by("stage", "desc"), by("points")],
      [by("tags"), by("owner", "desc"), by("name")],
      [by("state"), by("due", "desc")],
    ];
    for (const sorts of cases) {
      const label = sorts.map((sort) => sort.label).join(", ");
      expect({ sorts: label, ids: await sortedIds(sorts) }).toEqual({
        sorts: label,
        ids: evaluatedOrder(sorts),
      });
    }
  });

  it("stops at a sort on a value worked out as a row is read", async () => {
    expect(
      await sortedIds([
        by("done"),
        computedSort("formula"),
        by("name", "desc"),
      ]),
    ).toEqual(evaluatedOrder([by("done")]));
    const unsorted = await sortedIds([]);
    for (const type of computedTypes) {
      expect({ type, ids: await sortedIds([computedSort(type)]) }).toEqual({
        type,
        ids: unsorted,
      });
    }
  });

  it("filters and sorts together", async () => {
    const filters = [on("tags", "is_not_empty")];
    const sorts = [by("tags", "desc")];
    expect(await sortedIds(sorts, filters)).toEqual(
      evaluatedOrder(sorts, filters),
    );
  });

  async function withChildren(
    parentId: string,
    children: Array<{ id: string; title: string; notes?: string }>,
    check: () => Promise<void>,
  ) {
    const childIds = children.map((child) => `${parentId}-${child.id}`);
    try {
      for (const [position, child] of children.entries()) {
        await addFile({
          id: `${parentId}-${child.id}`,
          title: child.title,
          parentId,
          position,
        });
        if (child.notes) {
          await getDb()
            .insert(schema.documentPropertyValues)
            .values({
              id: `stored-value-${parentId}-${child.id}-notes`,
              ownerEmail: OWNER,
              documentId: `${parentId}-${child.id}`,
              propertyId: definitions.notes.id,
              valueJson: JSON.stringify(child.notes),
            });
        }
      }
      await check();
    } finally {
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(inArray(schema.documentPropertyValues.documentId, childIds));
      await getDb()
        .delete(schema.contentDatabaseItems)
        .where(inArray(schema.contentDatabaseItems.documentId, childIds));
      await getDb()
        .delete(schema.documents)
        .where(inArray(schema.documents.id, childIds));
    }
  }

  it("sorts an expanded folder's children the same way", async () => {
    const children = [
      { id: "z", title: "z" },
      { id: "y", title: "y", notes: "apple" },
      { id: "x", title: "x", notes: "Zebra" },
      { id: "w", title: "w", notes: "apple" },
    ];
    await withChildren("stored-odd", children, async () => {
      await setView([], "and", [by("notes", "desc"), by("name")]);
      const tree = await navigate({
        parentId: PARENT_ID,
        viewId: "default",
        expand: ["stored-odd"],
      });
      expect(
        tree.branches?.["stored-odd"]?.items.map((item) => item.documentId),
      ).toEqual([
        "stored-odd-x",
        "stored-odd-w",
        "stored-odd-y",
        "stored-odd-z",
      ]);
    });
  });

  it("keeps the view's later sorts after a sort on name", async () => {
    const children = [
      { id: "a", title: "Same", notes: "apple" },
      { id: "b", title: "Same", notes: "pear" },
      { id: "c", title: "Other" },
    ];
    await withChildren("stored-retired", children, async () => {
      await setView([], "and", [by("name"), by("notes", "desc")]);
      const page = await navigate({
        parentId: "stored-retired",
        viewId: "default",
      });
      expect(page.items.map((item) => item.documentId)).toEqual([
        "stored-retired-c",
        "stored-retired-b",
        "stored-retired-a",
      ]);
    });
    expect(await sortedIds([by("name", "desc"), by("points")])).toEqual(
      evaluatedOrder([by("name", "desc"), by("points")]),
    );
  });

  it("keeps a cursor until a row moves across it", async () => {
    await setView([], "and", [by("points")]);
    const first = await readPage("UTC", { limit: 3 });
    expect(first.items.map((item) => item.documentId)).toEqual([
      "stored-empty",
      "stored-gap",
      "stored-after-gap",
    ]);
    const cursor = first.pagination.nextCursor ?? undefined;
    expect(cursor).toEqual(expect.any(String));
    const draftPoints = eq(
      schema.documentPropertyValues.id,
      "stored-value-draft-points",
    );
    await getDb()
      .update(schema.documentPropertyValues)
      .set({ valueJson: JSON.stringify("abd") })
      .where(draftPoints);
    try {
      const second = await readPage("UTC", { cursor, limit: 3 });
      expect(second.items.map((item) => item.documentId)).toEqual([
        "stored-overlap",
        "stored-retired",
        "stored-odd",
      ]);
    } finally {
      await getDb()
        .update(schema.documentPropertyValues)
        .set({ valueJson: JSON.stringify("abc") })
        .where(draftPoints);
    }
    await getDb().insert(schema.documentPropertyValues).values({
      id: "stored-value-gap-points",
      ownerEmail: OWNER,
      documentId: "stored-gap",
      propertyId: definitions.points.id,
      valueJson: "100",
    });
    try {
      await expect(readPage("UTC", { cursor, limit: 3 })).rejects.toMatchObject(
        { errorCode: "invalid_navigation_cursor" },
      );
    } finally {
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.id, "stored-value-gap-points"));
    }
  });
});

describe("Files navigation groups", () => {
  const GROUP_SPACE_ID = "grouping-space";
  const GROUP_DATABASE_ID = "grouping-files";
  const color = "gray";
  const definitions = {
    stage: {
      id: "group-stage",
      name: "Stage",
      type: "select",
      options: {
        options: [
          { id: "stage-idea", name: "Idea", color },
          { id: "stage-draft", name: "Draft", color },
          { id: "stage-live", name: "Live", color },
        ],
      },
    },
    state: {
      id: "group-state",
      name: "State",
      type: "status",
      options: {
        options: [
          { id: "state-todo", name: "Not started", color },
          { id: "state-blocked", name: "Blocked", color },
          { id: "state-done", name: "Done", color },
        ],
      },
    },
    tags: {
      id: "group-tags",
      name: "Tags",
      type: "multi_select",
      options: {
        options: [
          { id: "tag-red", name: "Red", color },
          { id: "tag-blue", name: "Blue", color },
          { id: "tag-green", name: "Green", color },
        ],
      },
    },
    done: { id: "group-done", name: "Done", type: "checkbox", options: {} },
    notes: { id: "group-notes", name: "Notes", type: "text", options: {} },
  } satisfies Record<
    string,
    Pick<DocumentProperty["definition"], "id" | "name" | "type" | "options">
  >;
  type Key = keyof typeof definitions;
  const keys = Object.keys(definitions) as Key[];
  const groupable = ["stage", "state", "tags", "done"] as const;
  class SavedText {
    constructor(readonly text: string) {}
  }
  const savedJson = (value: unknown) =>
    value instanceof SavedText ? value.text : JSON.stringify(value);
  const files: Array<{
    id: string;
    parentId?: string;
    hidden?: boolean;
    trashed?: boolean;
    values: Partial<Record<Key, unknown>>;
  }> = [
    {
      id: "alpha",
      values: {
        stage: "stage-draft",
        state: "state-todo",
        tags: ["tag-red", "tag-blue"],
        done: true,
        notes: "first",
      },
    },
    {
      id: "beta",
      values: { stage: "stage-live", tags: ["tag-green"], done: false },
    },
    {
      id: "beta-child",
      parentId: "beta",
      values: {
        stage: "stage-draft",
        state: "state-done",
        tags: [],
        done: "yes",
      },
    },
    {
      id: "beta-grandchild",
      parentId: "beta-child",
      values: { stage: "Retired", state: "state-gone", tags: ["tag-unknown"] },
    },
    { id: "delta", values: {} },
    {
      id: "epsilon",
      values: {
        stage: "stage-idea",
        tags: ["tag-unknown", "tag-blue"],
        done: true,
        notes: "second",
      },
    },
    {
      id: "broken",
      values: {
        stage: new SavedText('"stage-draft'),
        tags: new SavedText("[tag-red"),
        done: new SavedText("tru"),
      },
    },
    {
      id: "hidden",
      hidden: true,
      values: { stage: "stage-draft", tags: ["tag-red"], done: true },
    },
    {
      id: "trashed",
      trashed: true,
      values: { stage: "stage-draft", tags: ["tag-red"], done: true },
    },
  ];
  const visibleFiles = files.filter((file) => !file.hidden && !file.trashed);

  beforeAll(async () => {
    const now = "2026-01-01T00:00:00.000Z";
    await getDb().insert(schema.documents).values({
      id: "grouping-files-document",
      spaceId: GROUP_SPACE_ID,
      ownerEmail: OWNER,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentSpaces).values({
      id: GROUP_SPACE_ID,
      name: "Grouping",
      kind: "personal",
      ownerEmail: OWNER,
      filesDatabaseId: GROUP_DATABASE_ID,
      createdBy: OWNER,
      createdAt: now,
      updatedAt: now,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: GROUP_DATABASE_ID,
      spaceId: GROUP_SPACE_ID,
      ownerEmail: OWNER,
      documentId: "grouping-files-document",
      title: "Files",
      systemRole: "files",
      createdAt: now,
      updatedAt: now,
    });
    for (const definition of Object.values(definitions)) {
      await getDb()
        .insert(schema.documentPropertyDefinitions)
        .values({
          id: definition.id,
          ownerEmail: OWNER,
          databaseId: GROUP_DATABASE_ID,
          name: definition.name,
          type: definition.type,
          optionsJson: JSON.stringify(definition.options),
        });
    }
    for (const [position, file] of files.entries()) {
      await getDb()
        .insert(schema.documents)
        .values({
          id: `group-${file.id}`,
          spaceId: GROUP_SPACE_ID,
          parentId: file.parentId ? `group-${file.parentId}` : null,
          ownerEmail: file.hidden ? OTHER : OWNER,
          title: file.id,
          content: "",
          visibility: "private",
          trashedAt: file.trashed ? now : null,
          createdAt: now,
          updatedAt: now,
        });
      await getDb()
        .insert(schema.contentDatabaseItems)
        .values({
          id: `membership-group-${file.id}`,
          ownerEmail: OWNER,
          databaseId: GROUP_DATABASE_ID,
          documentId: `group-${file.id}`,
          position,
          createdAt: now,
          updatedAt: now,
        });
      for (const key of keys) {
        if (!(key in file.values)) continue;
        await getDb()
          .insert(schema.documentPropertyValues)
          .values({
            id: `group-value-${file.id}-${key}`,
            ownerEmail: OWNER,
            documentId: `group-${file.id}`,
            propertyId: definitions[key].id,
            valueJson: savedJson(file.values[key]),
          });
      }
    }
  });

  afterEach(async () => {
    await getDb()
      .update(schema.contentDatabases)
      .set({ viewConfigJson: "{}" })
      .where(eq(schema.contentDatabases.id, GROUP_DATABASE_ID));
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    await deleteUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(GROUP_DATABASE_ID),
    );
  });

  const evaluatorProperty = (key: Key, position: number): DocumentProperty => ({
    definition: {
      ...definitions[key],
      databaseId: GROUP_DATABASE_ID,
      visibility: "always_show",
      position,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    value: null,
    editable: true,
  });
  const evaluatorProperties = keys.map(evaluatorProperty);
  const evaluatorItems: ContentDatabaseItem[] = visibleFiles.map((file) => ({
    id: `membership-group-${file.id}`,
    databaseId: GROUP_DATABASE_ID,
    position: files.indexOf(file),
    document: {
      id: `group-${file.id}`,
      parentId: file.parentId ? `group-${file.parentId}` : null,
      title: file.id,
      content: "",
      icon: null,
      position: files.indexOf(file),
      isFavorite: false,
      hideFromSearch: false,
      visibility: "private",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    properties: keys.map((key, position) => {
      const value = file.values[key];
      return {
        ...evaluatorProperty(key, position),
        value:
          value === undefined ? null : parsePropertyValue(savedJson(value)),
      };
    }),
  }));

  async function setView(view: Partial<ContentDatabaseView>) {
    await getDb()
      .update(schema.contentDatabases)
      .set({
        viewConfigJson: JSON.stringify({
          activeViewId: "grouped",
          views: [
            {
              id: "grouped",
              name: "Table",
              type: "table",
              sorts: [],
              filters: [],
              filterMode: "and",
              columnWidths: {},
              ...view,
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, GROUP_DATABASE_ID));
  }

  const read = (
    navigation: {
      parentId: string | null;
      cursor?: string;
      group?: string;
      locate?: string;
    },
    limit?: number,
  ) =>
    runWithRequestContext({ userEmail: OWNER, timezone: "UTC" }, () =>
      action.run(
        {
          databaseId: GROUP_DATABASE_ID,
          navigation,
          ...(limit ? { limit } : {}),
        },
        { userEmail: OWNER } as ActionRunContext,
      ),
    ) as Promise<ContentDatabaseNavigationPageResponse>;

  const shownGroups = (page: ContentDatabaseNavigationPageResponse) =>
    page.groups?.map((group) => ({
      id: group.id,
      label: group.label,
      count: group.count,
      ids: group.page.items.map((item) => item.documentId),
    }));

  function tableGroups(
    key: Key,
    options: {
      sorts?: ContentDatabaseSort[];
      filters?: ContentDatabaseFilter[];
    } = {},
  ) {
    const items = applyContentDatabaseTableQuery(
      evaluatorItems,
      evaluatorProperties,
      {
        search: "",
        filters: options.filters ?? [],
        sorts: options.sorts ?? [],
        filterMode: "and",
      },
      { timeZone: "UTC" },
    );
    return databaseBoardGroups(
      items,
      evaluatorProperties,
      definitions[key].id,
    ).map((group) => ({
      id: group.id,
      label: group.label,
      count: group.items.length,
      ids: group.items.map((item) => item.document.id),
    }));
  }

  const by = (
    key: Key | "name",
    direction: ContentDatabaseSort["direction"] = "asc",
  ): ContentDatabaseSort => ({
    key: key === "name" ? "name" : definitions[key].id,
    label: `${key} ${direction}`,
    direction,
  });

  it("groups pages flat, from every level, as the table groups them", async () => {
    for (const key of groupable) {
      await setView({ groupByPropertyId: definitions[key].id });
      const page = await read({ parentId: null });
      expect({ key, groups: shownGroups(page) }).toEqual({
        key,
        groups: tableGroups(key),
      });
      expect(page.items.map((item) => item.documentId)).toEqual([
        "group-alpha",
        "group-beta",
        "group-delta",
        "group-epsilon",
        "group-broken",
      ]);
    }
  });

  it("orders each group by the view's sorts", async () => {
    const cases = [
      [by("name", "desc")],
      [by("stage", "desc"), by("name")],
      [by("done"), by("notes", "desc")],
    ];
    for (const sorts of cases) {
      for (const key of groupable) {
        await setView({ groupByPropertyId: definitions[key].id, sorts });
        const label = `${key} by ${sorts.map((sort) => sort.label).join(", ")}`;
        expect({
          label,
          groups: shownGroups(await read({ parentId: null })),
        }).toEqual({ label, groups: tableGroups(key, { sorts }) });
      }
    }
  });

  it("orders each group by a saved sidebar order", async () => {
    await setView({ groupByPropertyId: definitions.tags.id });
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    await putUserSetting(
      OWNER,
      personalDatabaseViewSettingKey(GROUP_DATABASE_ID),
      {
        version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
        activeViewId: "grouped",
        views: [
          {
            id: "grouped",
            sorts: [],
            filters: [],
            filterMode: "and",
            sidebarOrder: {
              mode: "custom",
              itemIds: ["membership-group-epsilon", "membership-group-delta"],
            },
          },
        ],
      },
    );
    const groups = shownGroups(await read({ parentId: null }));
    expect(groups?.find((group) => group.label === "Blue")?.ids).toEqual([
      "group-epsilon",
      "group-alpha",
    ]);
    expect(groups?.find((group) => group.label === "No Tags")?.ids).toEqual([
      "group-delta",
      "group-beta-child",
      "group-beta-grandchild",
      "group-broken",
    ]);
  });

  it("filters before it groups", async () => {
    const filters: ContentDatabaseFilter[] = [
      {
        key: definitions.done.id,
        label: "Done",
        operator: "is_checked",
        value: "",
      },
    ];
    for (const key of groupable) {
      await setView({ groupByPropertyId: definitions[key].id, filters });
      expect({
        key,
        groups: shownGroups(await read({ parentId: null })),
      }).toEqual({ key, groups: tableGroups(key, { filters }) });
    }
  });

  it("leaves out empty groups only when the view hides them", async () => {
    await setView({ groupByPropertyId: definitions.state.id });
    const shown = await read({ parentId: null });
    expect(shown.groups?.find((group) => group.label === "Blocked")).toEqual({
      id: "group-state:state-blocked",
      label: "Blocked",
      unset: false,
      count: 0,
      page: {
        items: [],
        pagination: { limit: 20, hasMore: false, nextCursor: null },
      },
    });
    await setView({
      groupByPropertyId: definitions.state.id,
      hideEmptyGroups: true,
    });
    expect(shownGroups(await read({ parentId: null }))).toEqual(
      tableGroups("state").filter((group) => group.count > 0),
    );
  });

  it("marks the group that holds pages with no value", async () => {
    for (const key of groupable) {
      await setView({ groupByPropertyId: definitions[key].id });
      const page = await read({ parentId: null });
      expect({
        key,
        unset: page.groups
          ?.filter((group) => group.unset)
          .map((group) => group.id),
      }).toEqual({
        key,
        unset: [
          `${definitions[key].id}:${key === "done" ? "false" : "__ungrouped__"}`,
        ],
      });
    }
  });

  it("pages through each group on its own", async () => {
    for (const sorts of [[], [by("name", "desc")], [by("stage")]]) {
      await setView({ groupByPropertyId: definitions.tags.id, sorts });
      const first = await read({ parentId: null }, 1);
      const paged = [];
      for (const group of first.groups ?? []) {
        const ids = group.page.items.map((item) => item.documentId);
        let cursor = group.page.pagination.nextCursor ?? undefined;
        while (cursor) {
          const next = await read(
            { parentId: null, group: group.id, cursor },
            1,
          );
          expect(next.groups).toBeUndefined();
          ids.push(...next.items.map((item) => item.documentId));
          cursor = next.pagination.nextCursor ?? undefined;
        }
        paged.push({
          id: group.id,
          label: group.label,
          count: group.count,
          ids,
        });
      }
      expect(paged).toEqual(tableGroups("tags", { sorts }));
    }
  });

  it("keeps a group's cursor to that group and its options", async () => {
    await setView({ groupByPropertyId: definitions.tags.id });
    const first = await read({ parentId: null }, 1);
    const blue = first.groups?.find((group) => group.label === "Blue");
    const blueId = "group-tags:tag-blue";
    expect(blue?.id).toBe(blueId);
    const cursor = blue?.page.pagination.nextCursor ?? undefined;
    expect(cursor).toEqual(expect.any(String));
    await expect(read({ parentId: null, cursor }, 1)).rejects.toMatchObject({
      errorCode: "invalid_navigation_cursor",
    });
    await expect(
      read({ parentId: null, group: "group-tags:tag-red", cursor }, 1),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    await expect(
      read({ parentId: "group-beta", group: blueId, cursor }, 1),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_group" });
    await expect(
      read({ parentId: null, group: "group-tags:tag-missing" }, 1),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_group" });
    const tags = eq(schema.documentPropertyDefinitions.id, definitions.tags.id);
    await getDb()
      .update(schema.documentPropertyDefinitions)
      .set({
        optionsJson: JSON.stringify({
          options: [
            ...definitions.tags.options.options,
            { id: "tag-new", name: "New", color },
          ],
        }),
      })
      .where(tags);
    try {
      await expect(
        read({ parentId: null, group: blueId, cursor }, 1),
      ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    } finally {
      await getDb()
        .update(schema.documentPropertyDefinitions)
        .set({ optionsJson: JSON.stringify(definitions.tags.options) })
        .where(tags);
    }
    expect(
      (await read({ parentId: null, group: blueId, cursor }, 1)).items.map(
        (item) => item.documentId,
      ),
    ).toEqual(["group-epsilon"]);
  });

  it("keeps a group's cursor until a row moves across it", async () => {
    await setView({
      groupByPropertyId: definitions.tags.id,
      sorts: [by("notes")],
    });
    const blueId = "group-tags:tag-blue";
    const first = await read({ parentId: null }, 1);
    const blue = first.groups?.find((group) => group.id === blueId);
    expect(blue?.page.items.map((item) => item.documentId)).toEqual([
      "group-alpha",
    ]);
    const cursor = blue?.page.pagination.nextCursor ?? undefined;
    expect(cursor).toEqual(expect.any(String));
    const epsilonNotes = eq(
      schema.documentPropertyValues.id,
      "group-value-epsilon-notes",
    );
    const setEpsilonNotes = (notes: string) =>
      getDb()
        .update(schema.documentPropertyValues)
        .set({ valueJson: JSON.stringify(notes) })
        .where(epsilonNotes);
    try {
      await setEpsilonNotes("third");
      expect(
        (await read({ parentId: null, group: blueId, cursor }, 1)).items.map(
          (item) => item.documentId,
        ),
      ).toEqual(["group-epsilon"]);
      await setEpsilonNotes("a note");
      await expect(
        read({ parentId: null, group: blueId, cursor }, 1),
      ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    } finally {
      await setEpsilonNotes("second");
    }
  });

  it("locates a page in the groups that list it", async () => {
    await setView({ groupByPropertyId: definitions.tags.id });
    const groupsListing = (documentId: string) =>
      tableGroups("tags")
        .filter((group) => group.ids.includes(documentId))
        .map((group) => group.id);
    for (const documentId of ["group-alpha", "group-beta-grandchild"]) {
      const located = await read({ parentId: null, locate: documentId });
      expect(located.items).toEqual([]);
      expect(located.groups).toBeUndefined();
      expect(located.locatedGroupIds).toEqual(groupsListing(documentId));
    }
    expect(groupsListing("group-alpha")).toHaveLength(2);
    for (const documentId of ["group-hidden", "group-trashed", "missing"]) {
      expect(
        (await read({ parentId: null, locate: documentId })).locatedGroupIds,
      ).toEqual([]);
    }
    await setView({
      groupByPropertyId: definitions.tags.id,
      filters: [
        { key: "name", label: "Name", operator: "equals", value: "epsilon" },
      ],
    });
    expect(
      (await read({ parentId: null, locate: "group-alpha" })).locatedGroupIds,
    ).toEqual([]);
    await setView({});
    expect(
      (await read({ parentId: null, locate: "group-alpha" })).locatedGroupIds,
    ).toEqual([]);
    await setView({ groupByPropertyId: definitions.tags.id });
    const first = await read({ parentId: null }, 1);
    const cursor =
      first.groups?.find((group) => group.id === "group-tags:tag-blue")?.page
        .pagination.nextCursor ?? undefined;
    expect(cursor).toEqual(expect.any(String));
    for (const navigation of [
      { parentId: "group-beta", locate: "group-alpha" },
      { parentId: null, group: "group-tags:tag-blue", locate: "group-alpha" },
      { parentId: null, cursor, locate: "group-alpha" },
    ]) {
      await expect(read(navigation)).rejects.toMatchObject({
        errorCode: "invalid_navigation_group",
      });
    }
  });

  it("doesn't group on a property or view the sidebar can't group", async () => {
    for (const view of [
      { groupByPropertyId: definitions.notes.id },
      { groupByPropertyId: "group-missing" },
      { groupByPropertyId: definitions.tags.id, type: "board" as const },
      { groupByPropertyId: null },
    ]) {
      await setView(view);
      const page = await read({ parentId: null });
      expect(page.groups).toBeUndefined();
      expect(page.items).toHaveLength(5);
    }
  });

  it("reads groups only for the top level's first page", async () => {
    await setView({ groupByPropertyId: definitions.tags.id });
    const child = await read({ parentId: "group-beta" });
    expect(child.groups).toBeUndefined();
    expect(child.items.map((item) => item.documentId)).toEqual([
      "group-beta-child",
    ]);
    const first = await read({ parentId: null }, 2);
    const next = await read(
      { parentId: null, cursor: first.pagination.nextCursor ?? undefined },
      2,
    );
    expect(next.groups).toBeUndefined();
    expect(next.items.map((item) => item.documentId)).toEqual([
      "group-delta",
      "group-epsilon",
    ]);
  });
});
