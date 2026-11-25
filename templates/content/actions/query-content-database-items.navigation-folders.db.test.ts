import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runWithRequestContext } from "@agent-native/core/server";
import { putUserSetting } from "@agent-native/core/settings";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
  type ContentDatabaseNavigationItem,
  type ContentDatabaseNavigationPageResponse,
  type ContentDatabaseNavigationSort,
  type ContentDatabaseSort,
} from "../shared/api.js";
import { localSourceDirectoryId } from "../shared/local-source-directory.js";

const TEST_DB_PATH = join(
  tmpdir(),
  `content-files-navigation-folders-${process.pid}-${Date.now()}.pglite`,
);
const OWNER = "folders-owner@example.com";
const OTHER = "folders-other@example.com";

type Schema = typeof import("../server/db/schema.js");
type Db = ReturnType<typeof import("../server/db/index.js").getDb>;
let getDb: () => Db;
let schema: Schema;
let action: typeof import("./query-content-database-items.js").default;
let navigationContextAction: typeof import("./get-content-navigation-context.js").default;

const TIMESTAMP = "2026-01-01T00:00:00.000Z";

async function addSpace(spaceId: string, databaseId: string) {
  await getDb()
    .insert(schema.documents)
    .values({
      id: `${databaseId}-document`,
      spaceId,
      ownerEmail: OWNER,
      title: "Files",
      content: "",
      visibility: "private",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
  await getDb().insert(schema.contentSpaces).values({
    id: spaceId,
    name: spaceId,
    kind: "personal",
    ownerEmail: OWNER,
    filesDatabaseId: databaseId,
    createdBy: OWNER,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  });
  await getDb()
    .insert(schema.contentDatabases)
    .values({
      id: databaseId,
      spaceId,
      ownerEmail: OWNER,
      documentId: `${databaseId}-document`,
      title: "Files",
      systemRole: "files",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
}

async function linkFolder(databaseId: string, folderId: string) {
  await getDb()
    .insert(schema.contentDatabaseSources)
    .values({
      id: `${databaseId}-source-${folderId}`,
      ownerEmail: OWNER,
      databaseId,
      sourceType: "local-folder",
      sourceName: folderId,
      sourceTable: folderId,
    });
}

async function addPage(args: {
  databaseId: string;
  spaceId: string;
  id: string;
  title?: string;
  parentId?: string | null;
  ownerEmail?: string;
  position?: number;
  createdAt?: string;
  linked?: { folderId: string; path: string; sourceRow?: boolean };
}) {
  const createdAt = args.createdAt ?? TIMESTAMP;
  await getDb()
    .insert(schema.documents)
    .values({
      id: args.id,
      spaceId: args.spaceId,
      parentId: args.parentId ?? null,
      ownerEmail: args.ownerEmail ?? OWNER,
      title: args.title ?? args.id,
      content: "",
      visibility: "private",
      position: args.position ?? 0,
      ...(args.linked
        ? {
            sourceMode: "local-files",
            sourceKind: "file",
            sourcePath: args.linked.path,
            sourceRootPath: args.linked.folderId,
          }
        : {}),
      createdAt,
      updatedAt: createdAt,
    });
  await getDb()
    .insert(schema.contentDatabaseItems)
    .values({
      id: `membership-${args.id}`,
      ownerEmail: OWNER,
      databaseId: args.databaseId,
      documentId: args.id,
      position: args.position ?? 0,
      createdAt,
      updatedAt: createdAt,
    });
  if (args.linked && args.linked.sourceRow !== false) {
    await getDb()
      .insert(schema.contentDatabaseSourceRows)
      .values({
        id: `source-row-${args.id}`,
        ownerEmail: OWNER,
        sourceId: `${args.databaseId}-source-${args.linked.folderId}`,
        databaseItemId: `membership-${args.id}`,
        documentId: args.id,
        sourceRowId: args.linked.path,
        sourceQualifiedId: `local-folder://${args.linked.folderId}/${encodeURIComponent(args.linked.path)}`,
        sourceDisplayKey: args.linked.path,
      });
  }
}

function navigate(
  databaseId: string,
  navigation: {
    parentId: string | null;
    sort?: ContentDatabaseNavigationSort | undefined;
    cursor?: string;
    expand?: string[];
    pagesOnly?: boolean | undefined;
    group?: string;
  },
  limit?: number,
) {
  return runWithRequestContext({ userEmail: OWNER }, () =>
    action.run({ databaseId, navigation, limit }, { userEmail: OWNER }),
  ) as Promise<ContentDatabaseNavigationPageResponse>;
}

async function readWholeBranch(
  databaseId: string,
  parentId: string | null,
  limit: number,
  sort?: ContentDatabaseNavigationSort,
  pagesOnly?: boolean,
) {
  const items: ContentDatabaseNavigationItem[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 50; pages += 1) {
    const page = await navigate(
      databaseId,
      { parentId, sort, pagesOnly, ...(cursor ? { cursor } : {}) },
      limit,
    );
    expect(page.items.length).toBeLessThanOrEqual(limit);
    items.push(...page.items);
    if (!page.pagination.nextCursor) return items;
    cursor = page.pagination.nextCursor;
  }
  throw new Error("The branch never ended.");
}

const folder = (folderId: string, path: string) =>
  localSourceDirectoryId({ rootPath: folderId, path });

const shown = (items: ContentDatabaseNavigationItem[]) =>
  items.map((item) =>
    item.type === "folder" ? `[${item.title}]` : item.documentId,
  );

async function statementsDuring(read: () => Promise<unknown>) {
  const statements: string[] = [];
  const client = getDb().$client;
  const prototype = Object.getPrototypeOf(client);
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
  await plugin(undefined);
}, 60_000);

afterAll(() => {
  rmSync(TEST_DB_PATH, { force: true, recursive: true });
});

describe("Files navigation of linked local folders", () => {
  const SPACE = "folders-space";
  const FILES = "folders-files";
  const page = (
    args: Omit<Parameters<typeof addPage>[0], "databaseId" | "spaceId">,
  ) => addPage({ ...args, databaseId: FILES, spaceId: SPACE });

  beforeAll(async () => {
    await addSpace(SPACE, FILES);
    await linkFolder(FILES, "vault");
    await linkFolder(FILES, "handbook");
    await page({ id: "plain-page", title: "Plain page", position: 0 });
    await page({
      id: "readme",
      title: "Readme",
      position: 1,
      linked: { folderId: "vault", path: "README.md" },
    });
    await page({
      id: "today",
      title: "Today",
      position: 2,
      linked: { folderId: "vault", path: "daily-notes/2026/today.md" },
    });
    await page({
      id: "yesterday",
      title: "Yesterday",
      position: 3,
      linked: { folderId: "vault", path: "daily-notes/2026/yesterday.md" },
    });
    await page({
      id: "index",
      title: "Index",
      position: 4,
      linked: { folderId: "vault", path: "daily-notes/index.md" },
    });
    await page({
      id: "old",
      title: "Old",
      position: 5,
      linked: { folderId: "vault", path: "archive/old.md" },
    });
    await page({
      id: "onboarding",
      title: "Onboarding",
      position: 6,
      linked: { folderId: "handbook", path: "daily-notes/onboarding.md" },
    });
    await page({
      id: "secret",
      title: "Secret",
      position: 7,
      ownerEmail: OTHER,
      linked: { folderId: "vault", path: "private/secret.md" },
    });
    await page({
      id: "child-of-today",
      title: "Child of today",
      parentId: "today",
    });
  });

  it("shows each top-level directory as a read-only folder, with the folder's top files beside them", async () => {
    const root = await navigate(FILES, { parentId: null });

    expect(shown(root.items)).toEqual([
      "[archive]",
      "[daily notes]",
      "[daily notes]",
      "plain-page",
      "readme",
    ]);
    expect(root.items[0]?.documentId).toBe(folder("vault", "archive"));
    expect(root.items[1]).toEqual({
      membershipId: folder("handbook", "daily-notes"),
      membershipPosition: 0,
      documentId: folder("handbook", "daily-notes"),
      parentId: null,
      title: "daily notes",
      icon: null,
      type: "folder",
      hasChildren: true,
      spaceId: SPACE,
      sourceKind: "folder",
      isFavorite: false,
      canEdit: false,
      canManage: false,
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    expect(root.items[2]?.documentId).toBe(folder("vault", "daily-notes"));
    expect(root.pagination).toEqual({
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
    expect(await readWholeBranch(FILES, null, 1)).toEqual(root.items);
  });

  it("opens a folder to its subfolders and its own files, at any depth", async () => {
    const dailyNotes = await navigate(FILES, {
      parentId: folder("vault", "daily-notes"),
    });
    expect(shown(dailyNotes.items)).toEqual(["[2026]", "index"]);
    expect(
      dailyNotes.items.every(
        (item) => item.parentId === folder("vault", "daily-notes"),
      ),
    ).toBe(true);
    expect(dailyNotes.items[0]).toMatchObject({
      documentId: folder("vault", "daily-notes/2026"),
      type: "folder",
      hasChildren: true,
    });

    const year = await navigate(FILES, {
      parentId: folder("vault", "daily-notes/2026"),
    });
    expect(shown(year.items)).toEqual(["today", "yesterday"]);
    expect(year.items[0]).toMatchObject({
      documentId: "today",
      parentId: folder("vault", "daily-notes/2026"),
      type: "page",
      hasChildren: true,
      canEdit: true,
    });

    const childPages = await navigate(FILES, { parentId: "today" });
    expect(shown(childPages.items)).toEqual(["child-of-today"]);
  });

  it("keeps each linked folder's directories apart", async () => {
    const handbook = await navigate(FILES, {
      parentId: folder("handbook", "daily-notes"),
    });
    expect(shown(handbook.items)).toEqual(["onboarding"]);
    const vault = await navigate(FILES, {
      parentId: folder("vault", "daily-notes"),
    });
    expect(shown(vault.items)).not.toContain("onboarding");
  });

  it("opens expanded folders in the same read as the tree", async () => {
    const tree = await navigate(FILES, {
      parentId: null,
      expand: [
        folder("vault", "daily-notes/2026"),
        folder("vault", "daily-notes"),
        "today",
        folder("vault", "archive/missing"),
      ],
    });
    expect(Object.keys(tree.branches ?? {}).sort()).toEqual(
      [
        folder("vault", "daily-notes"),
        folder("vault", "daily-notes/2026"),
        "today",
      ].sort(),
    );
    for (const [parentId, branch] of Object.entries(tree.branches ?? {})) {
      expect(branch).toEqual(await navigate(FILES, { parentId }));
    }
    expect(tree.branchesTruncated).toBe(false);
  });

  it("shows no folder for files the reader can't see", async () => {
    const root = await navigate(FILES, { parentId: null });
    expect(
      root.items.some((item) => item.documentId === folder("vault", "private")),
    ).toBe(false);
    expect(
      await navigate(FILES, { parentId: folder("vault", "private") }),
    ).toMatchObject({ items: [] });
  });

  it("shows only folders that hold files passing the view's filter", async () => {
    const { personalDatabaseViewSettingKey } =
      await import("./_content-database-personal-view.js");
    await putUserSetting(OWNER, personalDatabaseViewSettingKey(FILES), {
      version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
      activeViewId: "files",
      views: [
        {
          id: "files",
          sorts: [],
          filters: [
            {
              id: "title-filter",
              key: "name",
              label: "Name",
              operator: "contains",
              value: "day",
            },
          ],
          filterMode: "and",
        },
      ],
    });
    try {
      const root = await navigate(FILES, { parentId: null });
      expect(shown(root.items)).toEqual(["[daily notes]"]);
      expect(root.items[0]?.documentId).toBe(folder("vault", "daily-notes"));
      const dailyNotes = await navigate(FILES, {
        parentId: folder("vault", "daily-notes"),
      });
      expect(shown(dailyNotes.items)).toEqual(["[2026]"]);
    } finally {
      await putUserSetting(OWNER, personalDatabaseViewSettingKey(FILES), {
        version: CONTENT_DATABASE_PERSONAL_VIEW_OVERRIDES_VERSION,
        activeViewId: "files",
        views: [],
      });
    }
  });

  it("lists linked pages flat in a grouped view's groups, with no folder rows", async () => {
    await getDb()
      .insert(schema.documentPropertyDefinitions)
      .values({
        id: "folders-stage",
        ownerEmail: OWNER,
        databaseId: FILES,
        name: "Stage",
        type: "select",
        optionsJson: JSON.stringify({
          options: [{ id: "stage-draft", name: "Draft", color: "gray" }],
        }),
      });
    for (const documentId of ["readme", "today", "yesterday"]) {
      await getDb()
        .insert(schema.documentPropertyValues)
        .values({
          id: `folders-stage-${documentId}`,
          ownerEmail: OWNER,
          documentId,
          propertyId: "folders-stage",
          valueJson: JSON.stringify("stage-draft"),
        });
    }
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
              groupByPropertyId: "folders-stage",
            },
          ],
        }),
      })
      .where(eq(schema.contentDatabases.id, FILES));
    try {
      const root = await navigate(FILES, { parentId: null }, 2);
      const groupItems = (root.groups ?? []).flatMap(
        (group) => group.page.items,
      );
      expect(groupItems.length).toBeGreaterThan(0);
      expect(groupItems.filter((item) => item.type === "folder")).toEqual([]);
      const draft = root.groups?.find(
        (group) => group.id === "folders-stage:stage-draft",
      );
      expect(draft?.count).toBe(3);
      expect(shown(draft?.page.items ?? [])).toEqual(["readme", "today"]);
      expect(draft?.page.items[1]?.parentId).toBeNull();
      expect(draft?.page.items[0]).toMatchObject({ documentId: "readme" });
      expect(draft?.page.items[0]).not.toHaveProperty("canMove");
      expect(draft?.page.items[1]).toMatchObject({
        documentId: "today",
        canMove: false,
      });

      const nextCursor = draft?.page.pagination.nextCursor;
      expect(nextCursor).toBeTruthy();
      const rest = await navigate(
        FILES,
        {
          parentId: null,
          group: "folders-stage:stage-draft",
          ...(nextCursor ? { cursor: nextCursor } : {}),
        },
        2,
      );
      expect(shown(rest.items)).toEqual(["yesterday"]);
      expect(rest.items[0]).toMatchObject({ canMove: false });
      expect(rest.groups).toBeUndefined();

      await getDb()
        .update(schema.documents)
        .set({ parentId: "plain-page" })
        .where(eq(schema.documents.id, "today"));
      try {
        const movedGroup = await navigate(FILES, { parentId: null }, 2);
        const moved = movedGroup.groups
          ?.find((group) => group.id === "folders-stage:stage-draft")
          ?.page.items.find((item) => item.documentId === "today");
        expect(moved).toMatchObject({ parentId: "plain-page", canMove: false });
      } finally {
        await getDb()
          .update(schema.documents)
          .set({ parentId: null })
          .where(eq(schema.documents.id, "today"));
      }
    } finally {
      await getDb()
        .update(schema.contentDatabases)
        .set({ viewConfigJson: "{}" })
        .where(eq(schema.contentDatabases.id, FILES));
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, "folders-stage"));
      await getDb()
        .delete(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, "folders-stage"));
    }
  });

  it("reports move eligibility for Files path entries using their linked source rows", async () => {
    await page({
      id: "unlinked-nested",
      title: "Unlinked nested",
      linked: { folderId: "vault", path: "unlinked/note.md", sourceRow: false },
    });
    await page({
      id: "foreign-linked",
      linked: { folderId: "vault", path: "foreign/note.md", sourceRow: false },
    });
    await addSpace("foreign-free-space", "foreign-free-files");
    await addPage({
      id: "foreign-free-linked",
      spaceId: "foreign-free-space",
      databaseId: "foreign-free-files",
      linked: { folderId: "vault", path: "foreign/free.md", sourceRow: false },
    });
    await getDb().insert(schema.documents).values({
      id: "other-collection-document",
      spaceId: SPACE,
      ownerEmail: OWNER,
      title: "Other collection",
      content: "",
      visibility: "private",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await getDb().insert(schema.contentDatabases).values({
      id: "other-collection",
      spaceId: SPACE,
      ownerEmail: OWNER,
      documentId: "other-collection-document",
      title: "Other collection",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await linkFolder("other-collection", "vault");
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "other-unlinked-membership",
      ownerEmail: OWNER,
      databaseId: "other-collection",
      documentId: "foreign-linked",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await getDb().insert(schema.contentDatabaseSourceRows).values({
      id: "other-unlinked-source-row",
      ownerEmail: OWNER,
      sourceId: "other-collection-source-vault",
      databaseItemId: "other-unlinked-membership",
      documentId: "foreign-linked",
      sourceRowId: "foreign/note.md",
      sourceQualifiedId: "local-folder://vault/foreign%2Fnote.md",
      sourceDisplayKey: "foreign/note.md",
    });
    await getDb().insert(schema.contentDatabaseItems).values({
      id: "other-foreign-free-membership",
      ownerEmail: OWNER,
      databaseId: "other-collection",
      documentId: "foreign-free-linked",
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    });
    await getDb().insert(schema.contentDatabaseSourceRows).values({
      id: "other-foreign-free-source-row",
      ownerEmail: OWNER,
      sourceId: "other-collection-source-vault",
      databaseItemId: "other-foreign-free-membership",
      documentId: "foreign-free-linked",
      sourceRowId: "foreign/free.md",
      sourceQualifiedId: "local-folder://vault/foreign%2Ffree.md",
      sourceDisplayKey: "foreign/free.md",
    });
    const context = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "child-of-today" }),
    );
    expect(context.path.find((entry) => entry.id === "today")).toMatchObject({
      canMove: false,
    });
    expect(
      context.path.find((entry) => entry.id === "child-of-today"),
    ).not.toHaveProperty("canMove");

    const foreignContext = await runWithRequestContext(
      { userEmail: OWNER },
      () => navigationContextAction.run({ id: "foreign-linked" }),
    );
    expect(
      foreignContext.path.find((entry) => entry.id === "foreign-linked"),
    ).toMatchObject({ canMove: false });
    const root = await navigate(FILES, { parentId: null });
    expect(
      root.items.find((item) => item.documentId === "foreign-linked"),
    ).toMatchObject({ canMove: false });
    const rootWithoutFolder = await navigate("foreign-free-files", {
      parentId: null,
    });
    expect(
      rootWithoutFolder.items.find(
        (item) => item.documentId === "foreign-free-linked",
      ),
    ).toMatchObject({ canMove: false });
    await getDb()
      .delete(schema.contentDatabaseItems)
      .where(eq(schema.contentDatabaseItems.id, "membership-foreign-linked"));
    const outsideFiles = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "foreign-linked" }),
    );
    expect(
      outsideFiles.path.find((entry) => entry.id === "foreign-linked"),
    ).toMatchObject({ canMove: false });

    for (const id of ["readme", "unlinked-nested", "plain-page"]) {
      const result = await runWithRequestContext({ userEmail: OWNER }, () =>
        navigationContextAction.run({ id }),
      );
      expect(result.path.find((entry) => entry.id === id)).not.toHaveProperty(
        "canMove",
      );
    }
  });

  it("refuses a folder that isn't linked to the space as a parent", async () => {
    await expect(
      navigate(FILES, { parentId: folder("elsewhere", "daily-notes") }),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_parent" });
    await expect(
      navigate(FILES, { parentId: "local-source-directory:not-a-folder" }),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_parent" });
  });

  it("puts a page's folders on its path, above the page", async () => {
    const context = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "child-of-today" }),
    );
    expect(context.path.map((entry) => [entry.id, entry.parentId])).toEqual([
      [folder("vault", "daily-notes"), null],
      [folder("vault", "daily-notes/2026"), folder("vault", "daily-notes")],
      ["today", folder("vault", "daily-notes/2026")],
      ["child-of-today", "today"],
    ]);
    expect(context.path[0]).toMatchObject({
      title: "daily notes",
      databaseId: FILES,
      hasChildren: true,
      canEdit: false,
      canManage: false,
      source: {
        mode: "local-files",
        kind: "folder",
        path: "daily-notes",
        rootPath: "vault",
      },
    });
    expect(context.document.parentId).toBe("today");

    const readme = await runWithRequestContext({ userEmail: OWNER }, () =>
      navigationContextAction.run({ id: "readme" }),
    );
    expect(readme.path.map((entry) => [entry.id, entry.parentId])).toEqual([
      ["readme", null],
    ]);
  });
});

describe("Files navigation paging through linked folders", () => {
  const SPACE = "paging-space";
  const FILES = "paging-files";
  const page = (
    args: Omit<Parameters<typeof addPage>[0], "databaseId" | "spaceId">,
  ) => addPage({ ...args, databaseId: FILES, spaceId: SPACE });
  const directories = ["alpha", "bravo", "charlie", "delta", "echo"];

  beforeAll(async () => {
    await addSpace(SPACE, FILES);
    await linkFolder(FILES, "vault");
    for (const [index, directory] of directories.entries()) {
      await page({
        id: `${directory}-file`,
        position: index,
        createdAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        linked: { folderId: "vault", path: `${directory}/${directory}.md` },
      });
      await page({
        id: `${directory}-top`,
        title: `Top ${5 - index}`,
        position: 10 + index,
        createdAt: `2026-02-0${index + 1}T00:00:00.000Z`,
        linked: { folderId: "vault", path: `${directory}.md` },
      });
    }
    for (let index = 0; index < 5; index += 1) {
      await page({
        id: `inside-${index}`,
        position: index,
        linked: { folderId: "vault", path: `alpha/inner-${index}/note.md` },
      });
    }
  });

  it.each([
    ["custom", 2],
    ["custom", 5],
    ["name", 3],
    ["created", 4],
    ["last_edited", 6],
  ] as const)(
    "lists every row once across pages in %s order with %i per page",
    async (sort, limit) => {
      const everything = await navigate(FILES, { parentId: null, sort }, 20);
      expect(everything.pagination.hasMore).toBe(false);
      expect(shown(everything.items).slice(0, 5)).toEqual(
        directories.map((directory) => `[${directory}]`),
      );
      expect(everything.items).toHaveLength(10);

      const paged = await readWholeBranch(FILES, null, limit, sort);
      expect(paged).toEqual(everything.items);
    },
  );

  it("pages a folder's subfolders and files the same way", async () => {
    const alpha = folder("vault", "alpha");
    const everything = await navigate(FILES, { parentId: alpha }, 20);
    expect(shown(everything.items)).toEqual([
      "[inner 0]",
      "[inner 1]",
      "[inner 2]",
      "[inner 3]",
      "[inner 4]",
      "alpha-file",
    ]);
    for (const limit of [1, 2, 5]) {
      expect(await readWholeBranch(FILES, alpha, limit)).toEqual(
        everything.items,
      );
    }
  });

  it("lists every row once across pages when the view sorts on a property", async () => {
    const propertyId = "paging-rank";
    const ranks = [3, 1, 5, 2, 4];
    const [{ viewConfigJson }] = await getDb()
      .select({ viewConfigJson: schema.contentDatabases.viewConfigJson })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, FILES));
    const setViewConfig = (config: string) =>
      getDb()
        .update(schema.contentDatabases)
        .set({ viewConfigJson: config })
        .where(eq(schema.contentDatabases.id, FILES));
    await getDb().insert(schema.documentPropertyDefinitions).values({
      id: propertyId,
      ownerEmail: OWNER,
      databaseId: FILES,
      name: "Rank",
      type: "number",
    });
    await getDb()
      .insert(schema.documentPropertyValues)
      .values(
        directories.map((directory, index) => ({
          id: `paging-rank-${directory}`,
          ownerEmail: OWNER,
          documentId: `${directory}-top`,
          propertyId,
          valueJson: JSON.stringify(ranks[index]),
        })),
      );
    await setViewConfig(
      JSON.stringify({
        activeViewId: "files",
        views: [
          {
            id: "files",
            name: "Files",
            type: "table",
            sorts: [
              { key: propertyId, label: "Rank", direction: "asc" },
            ] satisfies ContentDatabaseSort[],
            filters: [],
            filterMode: "and",
            columnWidths: {},
          },
        ],
      }),
    );
    try {
      const everything = await navigate(FILES, { parentId: null }, 20);
      expect(shown(everything.items)).toEqual([
        ...directories.map((directory) => `[${directory}]`),
        "bravo-top",
        "delta-top",
        "alpha-top",
        "echo-top",
        "charlie-top",
      ]);
      for (const limit of [1, 3, 5]) {
        expect(await readWholeBranch(FILES, null, limit)).toEqual(
          everything.items,
        );
      }
      const alpha = folder("vault", "alpha");
      const inAlpha = await navigate(FILES, { parentId: alpha }, 20);
      expect(shown(inAlpha.items)).toEqual([
        "[inner 0]",
        "[inner 1]",
        "[inner 2]",
        "[inner 3]",
        "[inner 4]",
        "alpha-file",
      ]);
      expect(await readWholeBranch(FILES, alpha, 2)).toEqual(inAlpha.items);
    } finally {
      await setViewConfig(viewConfigJson);
      await getDb()
        .delete(schema.documentPropertyValues)
        .where(eq(schema.documentPropertyValues.propertyId, propertyId));
      await getDb()
        .delete(schema.documentPropertyDefinitions)
        .where(eq(schema.documentPropertyDefinitions.id, propertyId));
    }
  });

  it("asks for a fresh read when a folder appears before the cursor", async () => {
    const first = await navigate(FILES, { parentId: null }, 3);
    const cursor = first.pagination.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    await page({
      id: "aardvark-file",
      linked: { folderId: "vault", path: "aardvark/a.md" },
    });
    try {
      await expect(
        navigate(FILES, { parentId: null, cursor: cursor ?? undefined }, 3),
      ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    } finally {
      await getDb()
        .update(schema.documents)
        .set({ trashedAt: TIMESTAMP })
        .where(eq(schema.documents.id, "aardvark-file"));
    }
  });

  it("asks for a fresh read when a folder it listed changes its dates", async () => {
    const first = await navigate(FILES, { parentId: null }, 3);
    expect(shown(first.items)).toEqual(["[alpha]", "[bravo]", "[charlie]"]);
    const cursor = first.pagination.nextCursor;
    expect(cursor).toEqual(expect.any(String));
    await getDb()
      .update(schema.documents)
      .set({ updatedAt: "2026-03-01T00:00:00.000Z" })
      .where(eq(schema.documents.id, "bravo-file"));
    try {
      await expect(
        navigate(FILES, { parentId: null, cursor: cursor ?? undefined }, 3),
      ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
    } finally {
      await getDb()
        .update(schema.documents)
        .set({ updatedAt: "2026-01-02T00:00:00.000Z" })
        .where(eq(schema.documents.id, "bravo-file"));
    }
  });

  it("lists only pages for a picker that asks for them", async () => {
    const everything = await navigate(FILES, { parentId: null }, 20);
    const pages = await navigate(FILES, { parentId: null, pagesOnly: true }, 5);
    expect(pages.items).toEqual(everything.items.slice(5));
    expect(pages.pagination.hasMore).toBe(false);
    expect(await readWholeBranch(FILES, null, 2, "custom", true)).toEqual(
      pages.items,
    );

    const first = await navigate(FILES, { parentId: null, pagesOnly: true }, 2);
    await expect(
      navigate(
        FILES,
        { parentId: null, cursor: first.pagination.nextCursor ?? undefined },
        2,
      ),
    ).rejects.toMatchObject({ errorCode: "invalid_navigation_cursor" });
  });
});

describe("Files navigation of a space without a linked folder", () => {
  const SPACE = "unlinked-space";
  const FILES = "unlinked-files";
  const page = (
    args: Omit<Parameters<typeof addPage>[0], "databaseId" | "spaceId">,
  ) => addPage({ ...args, databaseId: FILES, spaceId: SPACE });

  beforeAll(async () => {
    await addSpace(SPACE, FILES);
    await page({ id: "unlinked-a", position: 0 });
    await page({
      id: "unlinked-b",
      position: 1,
      linked: { folderId: "gone", path: "notes/b.md", sourceRow: false },
    });
    await page({ id: "unlinked-c", position: 2, parentId: "unlinked-a" });
  });

  it("keeps every page where its parent puts it, with no folder rows", async () => {
    const root = await navigate(FILES, { parentId: null });
    expect(shown(root.items)).toEqual(["unlinked-a", "unlinked-b"]);
    expect(root.items.map((item) => item.type)).toEqual(["page", "page"]);
    expect(
      shown((await navigate(FILES, { parentId: "unlinked-a" })).items),
    ).toEqual(["unlinked-c"]);
  });

  it("checks source-backed pages without reading folder projections", async () => {
    const statements = await statementsDuring(() =>
      navigate(FILES, { parentId: null, expand: ["unlinked-a"] }),
    );
    expect(
      statements.filter((statement) => statement.includes("navigation_folder")),
    ).toEqual([]);
    expect(
      statements.filter((statement) =>
        statement.includes("content_database_source_rows"),
      ),
    ).toHaveLength(1);
    expect(
      statements.filter((statement) =>
        statement.includes("content_database_sources"),
      ),
    ).toHaveLength(2);

    const childStatements = await statementsDuring(() =>
      navigate(FILES, { parentId: "unlinked-a" }),
    );
    expect(
      childStatements.filter((statement) =>
        statement.includes("content_database_sources"),
      ),
    ).toEqual([]);
  });
});

describe("a new page's ID", () => {
  it("can't take the namespace of linked folder rows", async () => {
    const create = (await import("./create-document.js")).default;
    const idIssues = (id: string) =>
      create.schema
        .safeParse({ id, title: "Notes" })
        .error?.issues.filter((issue) => issue.path[0] === "id") ?? [];

    expect(idIssues(folder("vault", "notes"))).toHaveLength(1);
    expect(idIssues("page-1")).toEqual([]);
  });
});
