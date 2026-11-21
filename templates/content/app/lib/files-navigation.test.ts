import { readdirSync, readFileSync } from "node:fs";

import type {
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
  Document,
} from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callActionWithRetry } = vi.hoisted(() => ({
  callActionWithRetry: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callActionWithRetry }));

import {
  cachedFilesRootDocumentIds,
  cachedFilesSiblingDocumentIds,
  confirmCreatedFilesRow,
  filesNavigationPageParams,
  filesNavigationQueryKey,
  filesRowDocument,
  filesRowMove,
  forgetCreatedFilesRows,
  isFilesRowCreationPending,
  keepMovedFilesRow,
  moveCachedFilesRow,
  readFilesNavigationPage,
  removeCreatedFilesRows,
  showCreatedFilesRow,
} from "./files-navigation";
import { markDocumentCreationPending } from "./optimistic-document";

const FILES = "files-db";

function row(
  documentId: string,
  overrides: Partial<ContentDatabaseNavigationItem> = {},
): ContentDatabaseNavigationItem {
  return {
    membershipId: `membership-${documentId}`,
    membershipPosition: 0,
    documentId,
    parentId: null,
    title: documentId,
    icon: null,
    type: "page",
    hasChildren: false,
    spaceId: null,
    sourceKind: null,
    isFavorite: false,
    canEdit: true,
    canManage: true,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
    ...overrides,
  };
}

function page(
  items: ContentDatabaseNavigationItem[],
  hasMore = false,
): ContentDatabaseNavigationPageResponse {
  return {
    items,
    pagination: { limit: 20, hasMore, nextCursor: hasMore ? "next" : null },
  };
}

function created(id: string, parentId: string | null = null): Document {
  return {
    id,
    parentId,
    title: "",
    content: "",
    icon: null,
    position: 9999,
    isFavorite: false,
    canEdit: true,
    canManage: true,
    createdAt: "2026-11-09T00:00:00.000Z",
    updatedAt: "2026-11-09T00:00:00.000Z",
  } as Document;
}

function branchKey(parentId: string | null = null) {
  return filesNavigationQueryKey(
    filesNavigationPageParams({ databaseId: FILES, parentId }),
  );
}

function cachedRows(queryClient: QueryClient, parentId: string | null = null) {
  return (
    queryClient.getQueryData<ContentDatabaseNavigationPageResponse>(
      branchKey(parentId),
    )?.items ?? []
  );
}

function ids(queryClient: QueryClient, parentId: string | null = null) {
  return cachedRows(queryClient, parentId).map((item) => item.documentId);
}

/** One branch read as the query runs it: the server answers, the cache keeps it. */
async function reread(
  queryClient: QueryClient,
  answer: ContentDatabaseNavigationPageResponse,
  {
    parentId = null,
    expanded = [],
  }: { parentId?: string | null; expanded?: string[] } = {},
) {
  callActionWithRetry.mockResolvedValueOnce(answer);
  const params = filesNavigationPageParams({ databaseId: FILES, parentId });
  const result = await readFilesNavigationPage(queryClient, params, expanded);
  queryClient.setQueryData(filesNavigationQueryKey(params), result);
  return ids(queryClient, parentId);
}

function startCreate(queryClient: QueryClient, document: Document) {
  markDocumentCreationPending(queryClient, document);
  showCreatedFilesRow(queryClient, FILES, document);
}

describe("pages this tab created in the Files tree", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    callActionWithRetry.mockReset();
    queryClient = new QueryClient();
    queryClient.setQueryData(branchKey(), page([row("a"), row("b")]));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keep each new page through another create's reread of the branch", async () => {
    startCreate(queryClient, created("new-1"));
    startCreate(queryClient, created("new-2"));
    expect(ids(queryClient)).toEqual(["a", "b", "new-1", "new-2"]);

    // Neither create has committed when the branch rereads.
    expect(await reread(queryClient, page([row("a"), row("b")]))).toEqual([
      "a",
      "b",
      "new-1",
      "new-2",
    ]);

    confirmCreatedFilesRow(queryClient, "new-1");
    expect(
      await reread(queryClient, page([row("a"), row("b"), row("new-1")])),
    ).toEqual(["a", "b", "new-1", "new-2"]);
    expect(cachedRows(queryClient)[2]?.membershipId).toBe("membership-new-1");

    confirmCreatedFilesRow(queryClient, "new-2");
    expect(
      await reread(
        queryClient,
        page([row("a"), row("b"), row("new-1"), row("new-2")]),
      ),
    ).toEqual(["a", "b", "new-1", "new-2"]);
    // Both rows are the server's now; a later read is taken as it comes.
    expect(await reread(queryClient, page([row("a")]))).toEqual(["a"]);
  });

  it("keep a new page at the end of the first page of a branch longer than one page", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      row(`page-${index}`),
    );
    queryClient.setQueryData(branchKey(), page(firstPage, true));
    startCreate(queryClient, created("new"));
    confirmCreatedFilesRow(queryClient, "new");

    // The server lists the new page last, behind Show more.
    const shown = await reread(queryClient, page(firstPage, true));
    expect(shown).toHaveLength(21);
    expect(shown[shown.length - 1]).toBe("new");
    const again = await reread(queryClient, page(firstPage, true));
    expect(again[again.length - 1]).toBe("new");
  });

  it("drop a new page that a whole-branch read made after the create leaves out", async () => {
    startCreate(queryClient, created("new"));
    confirmCreatedFilesRow(queryClient, "new");

    expect(await reread(queryClient, page([row("a"), row("b")]))).toEqual([
      "a",
      "b",
    ]);
  });

  it("keep a new page when the read started before the create was confirmed, even in the same millisecond", async () => {
    startCreate(queryClient, created("new"));
    let answer!: (value: ContentDatabaseNavigationPageResponse) => void;
    callActionWithRetry.mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const params = filesNavigationPageParams({
      databaseId: FILES,
      parentId: null,
    });
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const read = readFilesNavigationPage(queryClient, params, []);
    confirmCreatedFilesRow(queryClient, "new");
    answer(page([row("a"), row("b")]));

    const answered = await read;
    if ("available" in answered) throw new Error("The Files read failed");
    expect(answered.items.map((item) => item.documentId)).toEqual([
      "a",
      "b",
      "new",
    ]);
  });

  it("show a folder as expandable while its first child is being created", async () => {
    queryClient.setQueryData(branchKey(), page([row("folder")]));
    startCreate(queryClient, created("child", "folder"));

    await reread(queryClient, page([row("folder")]));
    expect(cachedRows(queryClient)[0]?.hasChildren).toBe(true);
  });

  it("add a new page to a folder page that comes with its parent's read", async () => {
    queryClient.setQueryData(
      branchKey(),
      page([row("folder", { hasChildren: true })]),
    );
    startCreate(queryClient, created("child", "folder"));

    await reread(
      queryClient,
      {
        ...page([row("folder", { hasChildren: true })]),
        branches: { folder: page([row("older", { parentId: "folder" })]) },
      },
      { expanded: ["folder"] },
    );
    expect(ids(queryClient, "folder")).toEqual(["older", "child"]);
  });

  it("keep the title a shown row was given since it was added", async () => {
    startCreate(queryClient, created("new"));
    queryClient.setQueryData<ContentDatabaseNavigationPageResponse>(
      branchKey(),
      (current) =>
        current && {
          ...current,
          items: current.items.map((item) =>
            item.documentId === "new" ? { ...item, title: "Plans" } : item,
          ),
        },
    );

    await reread(queryClient, page([row("a"), row("b")]));
    const rows = cachedRows(queryClient);
    expect(rows[rows.length - 1]?.title).toBe("Plans");
  });

  it("stay at the end of the tree's first page when the Move picker's read lists them", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      row(`folder-${index}`, { type: "folder", sourceKind: "folder" }),
    );
    queryClient.setQueryData(branchKey(), page(firstPage, true));
    startCreate(queryClient, created("new"));
    confirmCreatedFilesRow(queryClient, "new");

    const pickerParams = filesNavigationPageParams({
      databaseId: FILES,
      parentId: null,
      pagesOnly: true,
    });
    callActionWithRetry.mockResolvedValueOnce(page([row("new")]));
    const picker = await readFilesNavigationPage(queryClient, pickerParams, [
      "folder-0",
    ]);
    expect(callActionWithRetry.mock.calls[0]?.[1]).toEqual(pickerParams);
    expect(
      "available" in picker ? [] : picker.items.map((item) => item.documentId),
    ).toEqual(["new"]);

    const shown = await reread(queryClient, page(firstPage, true));
    expect(shown[shown.length - 1]).toBe("new");
  });

  it("take out a failed create, and leave a deleted page to the write's reread", async () => {
    startCreate(queryClient, created("failed"));
    removeCreatedFilesRows(queryClient, ["failed"]);
    expect(ids(queryClient)).toEqual(["a", "b"]);
    expect(await reread(queryClient, page([row("a"), row("b")]))).toEqual([
      "a",
      "b",
    ]);

    queryClient.setQueryData(branchKey(), page([row("a"), row("b")], true));
    startCreate(queryClient, created("deleted"));
    forgetCreatedFilesRows(queryClient, ["deleted"]);
    expect(ids(queryClient)).toEqual(["a", "b", "deleted"]);
    expect(await reread(queryClient, page([row("a"), row("b")], true))).toEqual(
      ["a", "b"],
    );
  });

  it("count as being created until the server answers, so Move can't pick one as a destination yet", () => {
    startCreate(queryClient, created("new"));
    expect(isFilesRowCreationPending(queryClient, "new")).toBe(true);
    expect(isFilesRowCreationPending(queryClient, "a")).toBe(false);

    confirmCreatedFilesRow(queryClient, "new");
    expect(isFilesRowCreationPending(queryClient, "new")).toBe(false);
  });

  it("stay in a branch whatever reader mounted last, because every reader reads through one hook", () => {
    // A query refetches with the read function of the reader that mounted
    // last; a Files reader with its own would drop these rows on refetch.
    const appDir = new URL("../", import.meta.url);
    const readers = readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter(
        (file) => /\.tsx?$/.test(file) && !/\.(test|spec)\.tsx?$/.test(file),
      )
      .filter((file) =>
        /use(Action)?Query\b[^;]*?["']query-content-database-items["'][^;]*?filesNavigationPageParams\(/s.test(
          readFileSync(new URL(file.replace(/\\/g, "/"), appDir), "utf8"),
        ),
      );
    expect(readers).toEqual([]);
  });

  it("leave a branch marked for a reread marked", async () => {
    await queryClient.invalidateQueries({
      queryKey: branchKey(),
      refetchType: "none",
    });
    startCreate(queryClient, created("new"));

    expect(ids(queryClient)).toEqual(["a", "b", "new"]);
    expect(queryClient.getQueryState(branchKey())?.isInvalidated).toBe(true);
  });

  it("leave a branch's read time as it was, so it rereads when it would have", () => {
    queryClient.setQueryData(branchKey(), page([row("a")]), {
      updatedAt: 1_000,
    });
    startCreate(queryClient, created("new"));

    expect(ids(queryClient)).toEqual(["a", "new"]);
    expect(queryClient.getQueryState(branchKey())?.dataUpdatedAt).toBe(1_000);
  });
});

function rows(...documentIds: string[]) {
  return {
    items: documentIds.map((documentId) => ({ documentId })),
    pagination: { limit: 20, hasMore: false, nextCursor: null },
  };
}

describe("cachedFilesRootDocumentIds", () => {
  it("lists cached top-level rows, the tree holding the page first", () => {
    const queryClient = new QueryClient();
    const key = (
      databaseId: string,
      parentId: string | null,
      cursor?: string,
    ) =>
      filesNavigationQueryKey(
        filesNavigationPageParams({
          databaseId,
          parentId,
          ...(cursor ? { cursor } : {}),
        }),
      );
    queryClient.setQueryData(key("team", null), rows("roadmap", "hiring"));
    queryClient.setQueryData(key("personal", null), rows("journal", "draft"));
    queryClient.setQueryData(key("personal", "journal"), rows("monday"));
    queryClient.setQueryData(key("personal", null, "page-2"), rows("later"));
    queryClient.setQueryData(key("archive", null), { available: false });
    queryClient.setQueryData(
      filesNavigationQueryKey(
        filesNavigationPageParams({
          databaseId: "personal",
          parentId: null,
          pagesOnly: true,
        }),
      ),
      rows("journal", "draft"),
    );

    expect(cachedFilesRootDocumentIds(queryClient, "draft")).toEqual([
      "journal",
      "draft",
      "roadmap",
      "hiring",
    ]);
    expect(cachedFilesRootDocumentIds(new QueryClient(), "draft")).toEqual([]);
  });

  it("never offers a linked folder as a page to open", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      filesNavigationQueryKey(
        filesNavigationPageParams({ databaseId: "linked", parentId: null }),
      ),
      page([
        row("local-source-directory:vault:notes", {
          type: "folder",
          sourceKind: "folder",
        }),
        row("readme"),
      ]),
    );

    expect(cachedFilesRootDocumentIds(queryClient, "readme")).toEqual([
      "readme",
    ]);
  });
});

describe("cachedFilesSiblingDocumentIds", () => {
  it("lists the other pages of the folder the page is in now, from every cached page of its branch", () => {
    const queryClient = new QueryClient();
    const notes = "local-source-directory:vault:notes";
    const key = (
      parentId: string | null,
      extra: { cursor?: string; pagesOnly?: boolean } = {},
    ) =>
      filesNavigationQueryKey(
        filesNavigationPageParams({ databaseId: FILES, parentId, ...extra }),
      );
    queryClient.setQueryData(
      key(notes),
      page([
        row("local-source-directory:vault:notes%2Fold", {
          type: "folder",
          sourceKind: "folder",
        }),
        row("today"),
        row("yesterday"),
      ]),
    );
    queryClient.setQueryData(
      key(notes, { cursor: "next" }),
      page([row("later")]),
    );
    queryClient.setQueryData(
      key(null),
      page([
        row(notes, { type: "folder", sourceKind: "folder" }),
        row("inbox"),
      ]),
    );
    queryClient.setQueryData(
      key(null, { pagesOnly: true }),
      page([row("inbox"), row("picker-only")]),
    );
    queryClient.setQueryData(
      key("local-source-directory:vault:old"),
      page([row("today"), row("left-behind")]),
    );
    const pathTo = (documentId: string, parentId: string | null) => [
      ...(parentId
        ? [{ id: parentId, parentId: null, databaseId: FILES }]
        : []),
      { id: documentId, parentId, databaseId: FILES },
    ];

    expect(
      cachedFilesSiblingDocumentIds(
        queryClient,
        "today",
        pathTo("today", notes),
      ),
    ).toEqual(["yesterday", "later"]);
    expect(
      cachedFilesSiblingDocumentIds(
        queryClient,
        "later",
        pathTo("later", notes),
      ),
    ).toEqual(["today", "yesterday"]);
    expect(
      cachedFilesSiblingDocumentIds(
        queryClient,
        "inbox",
        pathTo("inbox", null),
      ),
    ).toEqual([]);
  });

  it("leaves out the same folder's pages cached for another space's Files", () => {
    const queryClient = new QueryClient();
    const notes = "local-source-directory:vault:notes";
    for (const [databaseId, rows] of [
      [FILES, ["today", "yesterday"]],
      ["other-files", ["elsewhere"]],
    ] as const) {
      queryClient.setQueryData(
        filesNavigationQueryKey(
          filesNavigationPageParams({ databaseId, parentId: notes }),
        ),
        page(rows.map((id) => row(id))),
      );
    }

    expect(
      cachedFilesSiblingDocumentIds(queryClient, "today", [
        { id: notes, parentId: null, databaseId: FILES },
        { id: "today", parentId: notes, databaseId: FILES },
      ]),
    ).toEqual(["yesterday"]);
    expect(
      cachedFilesSiblingDocumentIds(queryClient, "today", [
        { id: "today", parentId: notes, databaseId: null },
      ]),
    ).toEqual([]);
  });
});

describe("a linked folder's row", () => {
  it("stands for a read-only local folder, not a page", () => {
    const folder = filesRowDocument(
      row("local-source-directory:vault:notes", {
        title: "notes",
        type: "folder",
        sourceKind: "folder",
        hasChildren: true,
        canEdit: false,
        canManage: false,
      }),
    );

    expect(folder).toMatchObject({
      title: "notes",
      canEdit: false,
      canManage: false,
      source: { mode: "local-files", kind: "folder" },
    });
  });
});

describe("a page moved in the Files tree", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    callActionWithRetry.mockReset();
    queryClient = new QueryClient();
  });

  function plan(documentId: string, parentId: string | null) {
    const planned = filesRowMove(queryClient, { documentId, parentId });
    if (!planned) throw new Error(`${documentId} has no cached Files row`);
    return planned;
  }

  function move(documentId: string, parentId: string | null) {
    moveCachedFilesRow(queryClient, plan(documentId, parentId));
  }

  /** The server answered the move, as `useMoveDocument` handles it. */
  function moved(documentId: string, parentId: string | null) {
    const planned = plan(documentId, parentId);
    keepMovedFilesRow(queryClient, planned);
    moveCachedFilesRow(queryClient, planned);
  }

  function hasChildren(documentId: string, parentId: string | null = null) {
    return cachedRows(queryClient, parentId).find(
      (item) => item.documentId === documentId,
    )?.hasChildren;
  }

  it("leaves its old branch and joins the end of its new branch, whose parent gains children", () => {
    queryClient.setQueryData(
      branchKey(),
      page([row("folder"), row("a"), row("b")]),
    );
    queryClient.setQueryData(
      branchKey("folder"),
      page([row("child", { parentId: "folder" })]),
    );

    move("b", "folder");

    expect(ids(queryClient)).toEqual(["folder", "a"]);
    expect(ids(queryClient, "folder")).toEqual(["child", "b"]);
    expect(cachedRows(queryClient, "folder")[1]?.parentId).toBe("folder");
  });

  it("gives a folder without children its first one, and an emptied folder none", () => {
    queryClient.setQueryData(
      branchKey(),
      page([row("empty"), row("full", { hasChildren: true })]),
    );
    queryClient.setQueryData(
      branchKey("full"),
      page([row("only", { parentId: "full" })]),
    );

    move("only", "empty");

    expect(hasChildren("empty")).toBe(true);
    expect(hasChildren("full")).toBe(false);
    expect(ids(queryClient, "full")).toEqual([]);
  });

  it("keeps an old parent with children it hasn't read past", () => {
    queryClient.setQueryData(
      branchKey(),
      page([row("target"), row("long", { hasChildren: true })]),
    );
    queryClient.setQueryData(
      branchKey("long"),
      page([row("first", { parentId: "long" })], true),
    );

    move("first", "target");

    expect(hasChildren("long")).toBe(true);
  });

  it("moves to the top level without listing the page twice", () => {
    queryClient.setQueryData(
      branchKey(),
      page([row("folder", { hasChildren: true }), row("b")]),
    );
    queryClient.setQueryData(
      branchKey("folder"),
      page([row("nested", { parentId: "folder" })]),
    );

    move("nested", null);
    // The server's reread already lists it where it went.
    move("nested", null);

    expect(ids(queryClient)).toEqual(["folder", "b", "nested"]);
    expect(cachedRows(queryClient)[2]?.parentId).toBeNull();
  });

  it("keeps a branch marked for its reread marked", async () => {
    queryClient.setQueryData(branchKey(), page([row("folder"), row("b")]));
    await queryClient.invalidateQueries({
      queryKey: branchKey(),
      refetchType: "none",
    });

    move("b", "folder");

    expect(ids(queryClient)).toEqual(["folder"]);
    expect(
      queryClient.getQueryCache().find({ queryKey: branchKey(), exact: true })
        ?.state.isInvalidated,
    ).toBe(true);
  });

  it("stays in a folder that hadn't loaded when the folder's first read answers from before the move", async () => {
    queryClient.setQueryData(branchKey(), page([row("folder"), row("b")]));
    // The folder opens with the click and reads its children while the move
    // is still on its way.
    const answers: Array<
      (answer: ContentDatabaseNavigationPageResponse) => void
    > = [];
    callActionWithRetry.mockReturnValueOnce(
      new Promise((resolve) => answers.push(resolve)),
    );
    const read = readFilesNavigationPage(
      queryClient,
      filesNavigationPageParams({ databaseId: FILES, parentId: "folder" }),
      [],
    );

    moved("b", "folder");
    for (const answer of answers) answer(page([]));

    const answered = await read;
    if ("available" in answered) throw new Error("The Files read failed");
    expect(answered.items.map((item) => item.documentId)).toEqual(["b"]);
  });

  it("stays at the end of a long folder's first page while the server lists it further on", async () => {
    const children = Array.from({ length: 20 }, (_, index) =>
      row(`child-${index}`, { parentId: "folder" }),
    );
    queryClient.setQueryData(
      branchKey(),
      page([row("folder", { hasChildren: true }), row("b")]),
    );
    queryClient.setQueryData(branchKey("folder"), page(children, true));

    moved("b", "folder");
    const shown = await reread(queryClient, page(children, true), {
      parentId: "folder",
    });
    expect(shown).toHaveLength(21);
    expect(shown[20]).toBe("b");

    // A read of the whole folder without it, once it moved on, lets it go.
    expect(
      await reread(queryClient, page(children), { parentId: "folder" }),
    ).toHaveLength(20);
  });

  it("has no move to plan for a page no Files page lists", () => {
    queryClient.setQueryData(branchKey(), page([row("a")]));
    expect(
      filesRowMove(queryClient, { documentId: "elsewhere", parentId: "a" }),
    ).toBeUndefined();
  });
});
