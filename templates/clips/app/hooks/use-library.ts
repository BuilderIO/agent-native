import {
  callAction,
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useOrg } from "@agent-native/core/client/org";
import type { RecordingKind } from "@shared/recording-kind";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

import { isLiveRecordingUpload } from "@/lib/recording-status";

export interface RecordingSummary {
  id: string;
  pendingRedactions?: number;
  title: string;
  titleSource?: "default" | "context" | "upload" | "ai" | "manual";
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  description: string;
  /** "image" rows are screenshots: no duration, no transcript, no player. */
  kind: RecordingKind;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  durationMs: number;
  effectiveDurationMs: number;
  status: "uploading" | "processing" | "ready" | "failed";
  uploadProgress?: number;
  failureReason?: string | null;
  visibility: "private" | "org" | "public";
  hasPassword: boolean;
  expiresAt: string | null;
  ownerEmail: string;
  ownerName?: string | null;
  folderId: string | null;
  spaceIds: string[];
  tags: string[];
  viewCount: number;
  agentViewCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  trashedAt: string | null;
  hasAudio: boolean;
  hasCamera: boolean;
  width: number;
  height: number;
  transcriptStatus?: "pending" | "streaming" | "ready" | "failed" | null;
  transcriptHasText?: boolean;
}

export interface ListRecordingsArgs {
  view?: "library" | "shared" | "space" | "archive" | "trash" | "all";
  /** "image" is the Screenshots view; omitted means clips and screenshots. */
  kind?: "video" | "image" | "all";
  folderId?: string | null;
  spaceId?: string | null;
  tag?: string | null;
  search?: string | null;
  sort?: "recent" | "views" | "oldest";
  limit?: number;
  offset?: number;
  recordingIds?: string[];
}

interface RecordingPage {
  recordings: RecordingSummary[];
}

interface InfiniteRecordingsData {
  pages: RecordingPage[];
  pageParams: unknown[];
}

const MAX_LIVE_RECORDING_STATUS_IDS = 100;

export function dedupeRecordingsById<T extends { id: string }>(
  recordings: readonly T[],
): T[] {
  const seen = new Set<string>();
  return recordings.filter((recording) => {
    if (seen.has(recording.id)) return false;
    seen.add(recording.id);
    return true;
  });
}

export function getLiveRecordingBatch(
  data: InfiniteRecordingsData | undefined,
): { recordingIds: string[]; recordings: RecordingSummary[] } {
  const recordings = dedupeRecordingsById(
    (data?.pages.flatMap((page) => page.recordings) ?? []).filter((recording) =>
      isLiveRecordingUpload(recording),
    ),
  ).slice(0, MAX_LIVE_RECORDING_STATUS_IDS);
  return {
    recordingIds: recordings.map((recording) => recording.id),
    recordings,
  };
}

export function patchRecordingTitleInListData(
  data: any,
  recordingId: string,
  title: string,
  updatedAt: string,
) {
  const patchRecordings = (recordings: any[]) =>
    recordings.map((recording) =>
      recording?.id === recordingId
        ? { ...recording, title, updatedAt }
        : recording,
    );

  if (Array.isArray(data?.recordings)) {
    return { ...data, recordings: patchRecordings(data.recordings) };
  }

  if (Array.isArray(data?.pages)) {
    return {
      ...data,
      pages: data.pages.map((page: any) =>
        Array.isArray(page?.recordings)
          ? { ...page, recordings: patchRecordings(page.recordings) }
          : page,
      ),
    };
  }

  return data;
}

export function recordingsRefetchInterval(
  recordings: readonly RecordingSummary[] | undefined,
): number | false {
  if (!recordings || recordings.length === 0) return false;
  return recordings.some((recording) => isLiveRecordingUpload(recording))
    ? 3000
    : false;
}

export function useRecordings(args: ListRecordingsArgs = {}) {
  return useActionQuery<{ recordings: RecordingSummary[] }>(
    "list-recordings",
    args as any,
    {
      select: (data: any) => {
        return {
          recordings: Array.isArray(data?.recordings) ? data.recordings : [],
        };
      },
      refetchInterval: (q) => {
        const recs = (q.state.data as any)?.recordings as
          | RecordingSummary[]
          | undefined;
        return recordingsRefetchInterval(recs);
      },
    },
  );
}

export function useInfiniteRecordings(
  args: ListRecordingsArgs,
  totalCount?: number,
) {
  const limit = args.limit ?? 20;
  const queryClient = useQueryClient();
  const queryKey = useMemo(
    () => ["action", "list-recordings", args, "infinite"] as const,
    [args],
  );
  const query = useInfiniteQuery<RecordingPage>({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      callAction<{ recordings: RecordingSummary[] }>(
        "list-recordings",
        { ...args, offset: pageParam },
        { method: "GET", signal },
      ),
    getNextPageParam: (lastPage, pages) => {
      const nextOffset = pages.length * limit;
      if (typeof totalCount === "number") {
        return nextOffset < totalCount ? nextOffset : undefined;
      }
      return lastPage.recordings.length >= limit ? nextOffset : undefined;
    },
  });

  const liveRecordingBatch = useMemo(
    () => getLiveRecordingBatch(query.data),
    [query.data],
  );
  const liveRecordingQuery = useQuery({
    queryKey: [
      "action",
      "list-recordings",
      args,
      "live-recordings",
      liveRecordingBatch.recordingIds,
    ],
    enabled: liveRecordingBatch.recordingIds.length > 0,
    queryFn: ({ signal }) =>
      callAction<{ recordings: RecordingSummary[] }>(
        "list-recordings",
        {
          ...args,
          offset: 0,
          limit: liveRecordingBatch.recordingIds.length,
          recordingIds: liveRecordingBatch.recordingIds,
        },
        { method: "GET", signal },
      ),
    initialData: liveRecordingBatch.recordingIds.length
      ? { recordings: liveRecordingBatch.recordings }
      : undefined,
    refetchInterval: (current) =>
      recordingsRefetchInterval(current.state.data?.recordings),
  });

  useEffect(() => {
    if (!liveRecordingQuery.isFetchedAfterMount) return;
    const recordingsById = new Map(
      (liveRecordingQuery.data?.recordings ?? []).map(
        (recording) => [recording.id, recording] as const,
      ),
    );
    if (recordingsById.size === 0) return;
    queryClient.setQueryData<InfiniteRecordingsData>(queryKey, (current) => {
      if (!current) return current;
      let changed = false;
      const pages = current.pages.map((page) => {
        let pageChanged = false;
        const recordings = page.recordings.map((recording) => {
          const updated = recordingsById.get(recording.id);
          if (!updated || updated === recording) return recording;
          pageChanged = true;
          return updated;
        });
        if (!pageChanged) return page;
        changed = true;
        return { ...page, recordings };
      });
      return changed ? { ...current, pages } : current;
    });
  }, [liveRecordingQuery, queryClient, queryKey]);

  return query;
}

export function useRecordingsCount(
  args: Omit<ListRecordingsArgs, "limit" | "offset"> = {},
) {
  const normalizedArgs = Object.fromEntries(
    Object.entries(args).filter(([, value]) => value != null),
  );
  return useActionQuery<number>(
    "list-recordings",
    { ...normalizedArgs, countOnly: true } as any,
    {
      select: (data: any) =>
        typeof data?.total === "number" ? data.total : undefined,
      retry: false,
      throwOnError: false,
    },
  );
}

export interface SearchHit {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  trashedAt: string | null;
  durationMs: number;
  matchType:
    | "title-description"
    | "title-transcript"
    | "title-comment"
    | "transcript"
    | "comment";
  snippet: string | null;
  matchMs: number | null;
  matchPanel: "transcript" | "comments" | null;
  createdAt: string;
  updatedAt: string;
}

export function useRecordingSearch(query: string) {
  return useActionQuery<{ query: string; results: SearchHit[] }>(
    "search-recordings",
    query ? { query } : undefined,
    {
      enabled: query.length >= 2,
    },
  );
}

export function useCreateFolder() {
  return useActionMutation<
    any,
    {
      name: string;
      organizationId?: string;
      spaceId?: string;
      parentId?: string | null;
    }
  >("create-folder");
}

export function useCreateSpace() {
  return useActionMutation<
    any,
    {
      name: string;
      organizationId?: string;
      color?: string;
      iconEmoji?: string | null;
    }
  >("create-space");
}

export function useCreateScreenshot() {
  return useActionMutation<
    { id: string; kind: "image"; imageUrl: string | null },
    {
      dataUrl: string;
      width: number;
      height: number;
      title?: string;
      sourceAppName?: string | null;
      sourceWindowTitle?: string | null;
      folderId?: string | null;
      spaceIds?: string[];
    }
  >("create-screenshot");
}

export function useRenameFolder() {
  return useActionMutation<any, { id: string; name: string }>("rename-folder");
}

export function useDeleteFolder() {
  return useActionMutation<any, { id: string }>("delete-folder");
}

export function useMoveRecording() {
  return useActionMutation<
    any,
    { id?: string; ids?: string[]; folderId?: string | null }
  >("move-recording");
}

export function useTrashRecording() {
  return useActionMutation<any, { id: string }>("trash-recording");
}

export function useArchiveRecording() {
  return useActionMutation<any, { id: string }>("archive-recording");
}

export function useRestoreRecording() {
  return useActionMutation<any, { id: string }>("restore-recording");
}

export function useRenameRecording() {
  return useActionMutation<any, { id: string; title: string }>(
    "update-recording",
  );
}

export function useAddRecordingToSpace() {
  return useActionMutation<
    any,
    { recordingId: string; spaceId: string; op?: "add" | "remove" }
  >("add-recording-to-space");
}

export function useTagRecording() {
  return useActionMutation<
    any,
    { recordingId: string; tag: string; op?: "add" | "remove" }
  >("tag-recording");
}

/**
 * Keyed by the org id, defaulting to the caller's active org, so every caller
 * shares one request per org. An unscoped key would keep serving the previous
 * org's cached state across an org switch or after the last org is left.
 */
export function useOrganizationState<T = any>(
  organizationId?: string,
  options: { enabled?: boolean } = {},
) {
  const { data: org } = useOrg();
  const scopedOrganizationId = organizationId ?? org?.orgId ?? undefined;
  return useActionQuery<T>(
    "list-organization-state",
    { organizationId: scopedOrganizationId },
    {
      enabled: (options.enabled ?? true) && Boolean(scopedOrganizationId),
    },
  );
}

export function useFolders(
  args: { organizationId?: string; spaceId?: string | null } = {},
  options: { enabled?: boolean } = {},
) {
  const { data, isLoading } = useOrganizationState(args.organizationId, {
    enabled: options.enabled ?? Boolean(args.organizationId),
  });
  const all = Array.isArray(data?.folders) ? (data.folders as any[]) : [];
  const folders =
    args.spaceId !== undefined
      ? all.filter((f) =>
          args.spaceId === null ? !f.spaceId : f.spaceId === args.spaceId,
        )
      : all;
  return { data: { folders }, isLoading };
}

export interface FolderPathEntry {
  id: string;
  name: string;
}

export function getFolderAncestorPath(
  folders: readonly { id: string; name: string; parentId?: string | null }[],
  folderId: string | undefined,
): FolderPathEntry[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderPathEntry[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function useSpaces(
  organizationId?: string,
  options: { enabled?: boolean } = {},
) {
  const { data, isLoading, refetch } = useOrganizationState(organizationId, {
    enabled: options.enabled ?? Boolean(organizationId),
  });
  const spaces = Array.isArray(data?.spaces) ? (data.spaces as any[]) : [];
  return { data: { spaces }, isLoading, refetch };
}

export function useOrganizations(options: { enabled?: boolean } = {}) {
  const { data, isLoading } = useOrganizationState(undefined, options);
  const organizations = data?.organization ? [data.organization] : [];
  return {
    data: { organizations, currentId: data?.organization?.id },
    isLoading,
  };
}
