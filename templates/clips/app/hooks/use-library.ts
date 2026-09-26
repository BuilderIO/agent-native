import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";

import { isLiveRecordingUpload } from "@/lib/recording-status";

export interface RecordingSummary {
  id: string;
  pendingRedactions?: number;
  title: string;
  titleSource?: "default" | "context" | "upload" | "ai" | "manual";
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  description: string;
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
  folderId?: string | null;
  spaceId?: string | null;
  tag?: string | null;
  search?: string | null;
  sort?: "recent" | "views" | "oldest";
  limit?: number;
  offset?: number;
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
      select: (data: any) => (typeof data?.total === "number" ? data.total : 0),
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


export function useOrganizationState(
  organizationId?: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const active = useActionQuery<any>("list-organization-state", undefined, {
    enabled,
  });
  const needsOtherOrganization =
    Boolean(organizationId) &&
    active.isFetched &&
    active.data?.organization?.id !== organizationId;
  const other = useActionQuery<any>(
    "list-organization-state",
    { organizationId },
    { enabled: enabled && needsOtherOrganization },
  );
  return needsOtherOrganization ? other : active;
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
