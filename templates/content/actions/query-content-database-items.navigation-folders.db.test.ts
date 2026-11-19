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
    sort?: ContentDatabaseNavigationSort;
    cursor?: string;
    expand?: string[];
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
) {
  const items: ContentDatabaseNavigationItem[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 50; pages += 1) {
    const page = await navigate(
      databaseId,
      { parentId, sort, ...(cursor ? { cursor } : {}) },
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
  const query = vi.spyOn(getDb().$client, "query");
  try {
    await read();
    return query.mock.calls.map(([text]) => String(text));
  } finally {
    query.mockRestore();
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
      "[daily notes]",
      "[archive]",
      "[daily notes]",
      "plain-page",
      "readme",
    ]);
    expect(root.items[0]).toEqual({
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
    expect(root.items[1]?.documentId).toBe(folder("vault", "archive"));
    expect(root.items[2]?.documentId).toBe(folder("vault", "daily-notes"));
    expect(root.pagination).toEqual({
      limit: 20,
      hasMore: false,
      nextCursor: null,
    });
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

  it("reads the tree without looking for linked files", async () => {
    const statements = await statementsDuring(() =>
      navigate(FILES, { parentId: null, expand: ["unlinked-a"] }),
    );
    const folderReads = statements.filter(
      (statement) =>
        statement.includes("content_database_source_rows") ||
        statement.includes("navigation_folder"),
    );
    expect(folderReads).toEqual([]);
    expect(
      statements.filter((statement) =>
        statement.includes("content_database_sources"),
      ),
    ).toHaveLength(1);

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
