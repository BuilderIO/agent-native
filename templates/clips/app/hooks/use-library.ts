import { useActionQuery, useActionMutation } from "@agent-native/core/client";

import { isLiveRecordingUpload } from "@/lib/recording-status";

export interface RecordingSummary {
  id: string;
  title: string;
  titleSource?: "default" | "context" | "upload" | "ai" | "manual";
  sourceAppName?: string | null;
  sourceWindowTitle?: string | null;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  durationMs: number;
  status: "uploading" | "processing" | "ready" | "failed";
  uploadProgress?: number;
  failureReason?: string | null;
  visibility: "private" | "org" | "public";
  ownerEmail: string;
  folderId: string | null;
  spaceIds: string[];
  tags: string[];
  viewCount: number;
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
  view?: "library" | "space" | "archive" | "trash" | "all";
  folderId?: string | null;
  spaceId?: string | null;
  tag?: string | null;
  search?: string | null;
  sort?: "recent" | "views" | "oldest";
  limit?: number;
  offset?: number;
}

function isAwaitingAutoTitle(recording: RecordingSummary): boolean {
  const title = (recording.title ?? "").trim();
  const titleIsReplaceable =
    title === "" ||
    title === "Untitled recording" ||
    recording.titleSource === "default" ||
    recording.titleSource === "context";
  if (!titleIsReplaceable) return false;

  if (recording.transcriptStatus === "failed") return false;
  if (recording.transcriptStatus === "ready") {
    return recording.transcriptHasText === true;
  }

  return (
    recording.transcriptStatus === "pending" ||
    recording.transcriptStatus === "streaming"
  );
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
      // Keep a short poll while uploads/processors are active so the library
      // card does not get stuck if the global refresh signal is missed.
      // Also poll for replaceable seed titles so the card upgrades promptly.
      refetchInterval: (q) => {
        const recs = (q.state.data as any)?.recordings as
          | RecordingSummary[]
          | undefined;
        if (!recs || recs.length === 0) return false;
        const pendingUpload = recs.some((rec) => isLiveRecordingUpload(rec));
        const pendingTitle = recs.some(isAwaitingAutoTitle);
        return pendingUpload || pendingTitle ? 3000 : false;
      },
    },
  );
}

/**
 * Count-only variant for surfaces like the sidebar badge that need a total but
 * not the rows. Hits `list-recordings` with `countOnly`, so it skips the row
 * payload server-side and doesn't share (or pay for) the full-list query or its
 * title polling.
 */
export function useRecordingsCount(
  args: Omit<ListRecordingsArgs, "limit" | "offset"> = {},
) {
  return useActionQuery<number>(
    "list-recordings",
    { ...args, countOnly: true } as any,
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

// ── Folders / spaces / organizations ──────────────────────────────────────────
// Derived from `list-organization-state` which ships with the template. All
// three hooks hit the same endpoint and slice — React Query dedupes identical
// keys.

export function useOrganizationState(
  organizationId?: string,
  options: { enabled?: boolean } = {},
) {
  return useActionQuery<any>(
    "list-organization-state",
    organizationId ? { organizationId } : undefined,
    {
      enabled: options.enabled ?? true,
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

export function useSpaces(
  organizationId?: string,
  options: { enabled?: boolean } = {},
) {
  const { data, isLoading } = useOrganizationState(organizationId, {
    enabled: options.enabled ?? Boolean(organizationId),
  });
  const spaces = Array.isArray(data?.spaces) ? (data.spaces as any[]) : [];
  return { data: { spaces }, isLoading };
}

export function useOrganizations(options: { enabled?: boolean } = {}) {
  // list-organization-state only returns the current organization. We surface
  // it as a single-item list so the switcher has something to render; the
  // framework team will replace this with a proper `list-organizations` later.
  const { data, isLoading } = useOrganizationState(undefined, options);
  const organizations = data?.organization ? [data.organization] : [];
  return {
    data: { organizations, currentId: data?.organization?.id },
    isLoading,
  };
}
