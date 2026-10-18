import { useActionMutation } from "@agent-native/core/client/hooks";
import type { ContentDatabase, ContentDatabaseSource } from "@shared/api";
import type {
  GitHubFolderPreview,
  GitHubLinkBlockedReason,
  GitHubSourceProblemCode,
} from "@shared/github-source";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";

import { contentSyncInvalidatePredicate } from "./use-db-sync";

type GitHubFolderAction = "link-github-folder" | "sync-github-folder";

/** What a sync did, as the link and sync actions report it. */
export interface GitHubFolderSyncSummary {
  state: "unchanged" | "synced" | "partial" | "busy" | "error";
  commitSha: string | null;
  created: number;
  updated: number;
  renamed: number;
  trashed: number;
  remaining: number;
  problem: { code: GitHubSourceProblemCode; message: string } | null;
}

export interface LinkGitHubFolderRequest {
  databaseId: string;
  url: string;
  dryRun?: boolean;
}

export type LinkGitHubFolderResponse =
  | {
      dryRun: true;
      database: ContentDatabase;
      preview: GitHubFolderPreview;
      canLink: boolean;
      blocked: string | null;
      blockedReason: GitHubLinkBlockedReason | null;
      summary: string;
    }
  | {
      dryRun: false;
      database: ContentDatabase;
      preview: GitHubFolderPreview;
      sync: GitHubFolderSyncSummary;
      source: ContentDatabaseSource | null;
      summary: string;
    };

export interface SyncGitHubFolderResponse {
  database: ContentDatabase;
  sync: GitHubFolderSyncSummary;
  source: ContentDatabaseSource | null;
  summary: string;
}

/**
 * Linking or syncing a folder changes rows, Page lists and Trash. Other tabs
 * refresh from the action's change event, but a tab ignores its own events,
 * so this tab refreshes the same queries that event would.
 */
function useGitHubFolderMutation<TData, TVariables>(
  actionName: GitHubFolderAction,
  changesRows: (variables: TVariables) => boolean,
) {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  return useActionMutation<TData, TVariables>(actionName, {
    skipActionQueryInvalidation: true,
    onSuccess: (_data, variables) => {
      if (!changesRows(variables as TVariables)) return;
      const spoiled = contentSyncInvalidatePredicate(queryClient, pathname);
      const events = [{ source: "action", key: actionName }];
      void queryClient.invalidateQueries({
        predicate: (query) => spoiled(query, events),
      });
    },
  });
}

export function useLinkGitHubFolder() {
  return useGitHubFolderMutation<
    LinkGitHubFolderResponse,
    LinkGitHubFolderRequest
  >("link-github-folder", (variables) => !variables.dryRun);
}

export function useSyncGitHubFolder() {
  return useGitHubFolderMutation<
    SyncGitHubFolderResponse,
    { databaseId: string }
  >("sync-github-folder", () => true);
}
