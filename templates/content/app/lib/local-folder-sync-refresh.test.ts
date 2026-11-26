import {
  QueryClient,
  QueryObserver,
  type QueryKey,
} from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { localSourceDirectoryId } from "../../shared/local-source-directory";
import { invalidateContentQueries } from "../hooks/use-content-action-mutation";
import {
  localFolderSyncTreeTargets,
  refreshFilesAfterLocalFolderDisconnect,
} from "./local-folder-sync-refresh";

const FILES = "files-db";
const OTHER_FILES = "other-files-db";

function branch(databaseId: string, parentId: string | null): QueryKey {
  return [
    "action",
    "query-content-database-items",
    { databaseId, limit: 20, navigation: { parentId, sort: "custom" } },
  ];
}

const keys = {
  root: branch(FILES, null),
  section: branch(FILES, "section"),
  otherSection: branch(FILES, "other-section"),
  otherSpaceRoot: branch(OTHER_FILES, null),
  folder: branch(
    FILES,
    localSourceDirectoryId({ rootPath: "vault", path: "notes" }),
  ),
  otherSpaceFolder: branch(
    OTHER_FILES,
    localSourceDirectoryId({ rootPath: "vault", path: "notes" }),
  ),
  search: ["action", "search-documents", { query: "note" }],
  page: ["action", "get-document", { id: "open-page" }],
};

let queryClient: QueryClient;

function items(...documentIds: string[]) {
  return { items: documentIds.map((documentId) => ({ documentId })) };
}

function refreshed(key: QueryKey) {
  return queryClient.getQueryState(key)?.isInvalidated === true;
}

function sync(changes: {
  created?: string[];
  updated?: string[];
  removed?: string[];
}) {
  const files = (ids: string[] = []) =>
    ids.map((id) => ({ id, path: `${id}.md` }));
  invalidateContentQueries(
    queryClient,
    localFolderSyncTreeTargets({
      filesDatabaseId: FILES,
      created: files(changes.created),
      updated: files(changes.updated),
      removed: files(changes.removed),
    }),
  );
}

beforeEach(() => {
  queryClient = new QueryClient();
  queryClient.setQueryData(keys.root, items("kept", "section"));
  queryClient.setQueryData(keys.section, items("nested"));
  queryClient.setQueryData(keys.otherSection, items("elsewhere"));
  queryClient.setQueryData(keys.otherSpaceRoot, items("other-space-page"));
  queryClient.setQueryData(keys.folder, items("note"));
  queryClient.setQueryData(keys.otherSpaceFolder, items("other-note"));
  queryClient.setQueryData(keys.search, { results: [] });
  queryClient.setQueryData(keys.page, { id: "open-page" });
});

describe("localFolderSyncTreeTargets", () => {
  it("leaves the sidebar alone when the folder didn't change", () => {
    sync({});
    expect(Object.values(keys).filter(refreshed)).toEqual([]);
  });

  it("shows a file added outside Content at the top of that space's Files", () => {
    sync({ created: ["added"] });
    expect(refreshed(keys.root)).toBe(true);
    expect(refreshed(keys.search)).toBe(true);
    expect(refreshed(keys.otherSpaceRoot)).toBe(false);
    expect(refreshed(keys.otherSection)).toBe(false);
  });

  it("drops a file deleted outside Content from the branch that lists it", () => {
    sync({ removed: ["nested"] });
    expect(refreshed(keys.section)).toBe(true);
    expect(refreshed(keys.otherSection)).toBe(false);
  });

  it("rereads the space's open folders, which a file can join or leave on disk", () => {
    sync({ created: ["added"] });
    expect(refreshed(keys.folder)).toBe(true);
    expect(refreshed(keys.otherSpaceFolder)).toBe(false);
  });

  it("renames a file changed outside Content where it's listed", () => {
    sync({ updated: ["nested"] });
    expect(refreshed(keys.section)).toBe(true);
  });
});

describe("refreshFilesAfterLocalFolderDisconnect", () => {
  it("rereads that space's top level and leaves its folders unread, since the server no longer opens them", async () => {
    const reads: string[] = [];
    const unsubscribes = (
      [
        ["root", keys.root],
        ["folder", keys.folder],
      ] as const
    ).map(([name, key]) =>
      new QueryObserver(queryClient, {
        queryKey: key,
        queryFn: async () => {
          reads.push(name);
          return items();
        },
        staleTime: Infinity,
        retry: false,
      }).subscribe(() => {}),
    );

    refreshFilesAfterLocalFolderDisconnect(queryClient, FILES);
    await vi.waitFor(() => expect(reads).toContain("root"));
    await vi.waitFor(() => expect(queryClient.isFetching()).toBe(0));
    for (const unsubscribe of unsubscribes) unsubscribe();

    expect(reads).toEqual(["root"]);
    expect(refreshed(keys.folder)).toBe(true);
    expect(refreshed(keys.otherSpaceRoot)).toBe(false);
    expect(refreshed(keys.otherSpaceFolder)).toBe(false);
    expect(refreshed(keys.section)).toBe(false);
  });
});
