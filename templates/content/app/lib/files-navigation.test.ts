import { readdirSync, readFileSync } from "node:fs";

import type {
  ContentDatabaseNavigationItem,
  ContentDatabaseNavigationPageResponse,
  Document,
} from "@shared/api";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callActionWithRetry } = vi.hoisted(() => ({
  callActionWithRetry: vi.fn(),
}));

vi.mock("@agent-native/core/client/hooks", () => ({ callActionWithRetry }));

import {
  confirmCreatedFilesRow,
  filesNavigationPageParams,
  filesNavigationQueryKey,
  forgetCreatedFilesRows,
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
  { parentId = null, expanded = [] as string[] } = {},
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

  it("keep a new page when the read started before the create was confirmed", async () => {
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
    const read = readFilesNavigationPage(queryClient, params, []);
    await new Promise((resolve) => setTimeout(resolve, 2));
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
});
