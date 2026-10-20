import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import type { ContentDatabase, ContentDatabaseSource } from "@shared/api";
import type {
  GitHubFolderPreview,
  GitHubLinkBlockedReason,
  GitHubSourceProblemCode,
} from "@shared/github-source";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";

import { documentQueryFilter } from "../lib/document-query";
import {
  contentPlacementTargets,
  contentSpaceFilesDatabaseId,
  invalidateContentQueries,
} from "./use-content-action-mutation";
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

export interface CreateGitHubCollectionRequest {
  url: string;
  spaceId: string;
  parentId?: string | null;
  dryRun?: boolean;
  idempotencyKey?: string;
}

export type CreateGitHubCollectionResponse =
  | {
      dryRun: true;
      preview: GitHubFolderPreview;
      title: string;
      summary: string;
    }
  | {
      dryRun: false;
      database: ContentDatabase;
      preview: GitHubFolderPreview;
      title: string;
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
 * so this tab refreshes the same queries that event would. It does so after a
 * failure too: a link can be saved before its first sync fails.
 */
function useGitHubFolderMutation<TData, TVariables>(
  actionName: GitHubFolderAction,
  changesRows: (variables: TVariables) => boolean,
) {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  return useActionMutation<TData, TVariables>(actionName, {
    skipActionQueryInvalidation: true,
    onSettled: (_data, _error, variables) => {
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

/**
 * Makes a collection from a GitHub folder. The new collection shows in the
 * sidebar and under its parent, so those lists refresh as a new collection's
 * would, and its rows refresh like a link's.
 */
export function useCreateGitHubCollection() {
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  return useActionMutation<
    CreateGitHubCollectionResponse,
    CreateGitHubCollectionRequest
  >("create-github-collection", {
    skipActionQueryInvalidation: true,
    onSuccess: (data, variables) => {
      if (data.dryRun) return;
      const parentId = variables.parentId ?? null;
      void queryClient.invalidateQueries(
        documentQueryFilter(data.database.documentId),
      );
      invalidateContentQueries(queryClient, [
        ...contentPlacementTargets(queryClient, {
          documentIds: [data.database.documentId],
          parentIds: [parentId],
          databaseId: parentId
            ? undefined
            : contentSpaceFilesDatabaseId(queryClient, variables.spaceId),
        }),
        ["action", "list-documents"],
        ["action", "list-content-databases"],
      ]);
      const spoiled = contentSyncInvalidatePredicate(queryClient, pathname);
      const events = [{ source: "action", key: "create-github-collection" }];
      void queryClient.invalidateQueries({
        predicate: (query) => spoiled(query, events),
      });
    },
  });
}

/** How long a connection answer holds before the Sources panel asks again. */
const CONNECTION_STALE_MS = 60_000;

/**
 * Whether the person has a GitHub connection Content can read through, so a
 * Collection's Sources can say "Connect your GitHub account first" before any
 * typing. `connected` is null when GitHub couldn't be asked.
 */
export function useGitHubConnection(enabled: boolean) {
  return useActionQuery<{ connected: boolean | null }>(
    "check-github-connection",
    {},
    {
      enabled,
      retry: false,
      staleTime: CONNECTION_STALE_MS,
      resources: [],
    },
  );
}
