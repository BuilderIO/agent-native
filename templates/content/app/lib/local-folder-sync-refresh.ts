import type { QueryClient } from "@tanstack/react-query";

import {
  contentFilesCollectionFilter,
  contentLocalFolderBranchesFilter,
  contentNavigationBranchFilter,
  contentNavigationContextInDatabaseFilter,
  invalidateContentQueries,
  SEARCH_QUERY_KEYS,
  type ContentQueryTarget,
} from "../hooks/use-content-action-mutation";
import type { LiveLocalFolderSyncResult } from "./local-folder-live-sync";

export function localFolderSyncTreeTargets(
  sync: LiveLocalFolderSyncResult,
): ContentQueryTarget[] {
  const documentIds = [...sync.created, ...sync.updated, ...sync.removed].map(
    (file) => file.id,
  );
  if (documentIds.length === 0) return [];
  return [
    contentNavigationBranchFilter({
      documentIds,
      parentIds: [null],
      databaseId: sync.filesDatabaseId,
    }),
    contentLocalFolderBranchesFilter(sync.filesDatabaseId),
    contentNavigationContextInDatabaseFilter(sync.filesDatabaseId),
    contentFilesCollectionFilter(),
    ...SEARCH_QUERY_KEYS,
  ];
}

export function refreshFilesAfterLocalFolderDisconnect(
  queryClient: Pick<QueryClient, "getQueryCache" | "invalidateQueries">,
  filesDatabaseId: string,
) {
  void queryClient.invalidateQueries({
    ...contentLocalFolderBranchesFilter(filesDatabaseId),
    refetchType: "none",
  });
  invalidateContentQueries(queryClient, [
    contentNavigationBranchFilter({
      parentIds: [null],
      databaseId: filesDatabaseId,
    }),
    contentNavigationContextInDatabaseFilter(filesDatabaseId),
    contentFilesCollectionFilter(),
  ]);
}
