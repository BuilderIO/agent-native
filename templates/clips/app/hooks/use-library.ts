import {
  useActionQuery,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import type { RecordingKind } from "@shared/recording-kind";

import { isLiveRecordingUpload } from "@/lib/recording-status";

export interface RecordingSummary {
  id: string;
  /** Redaction boxes drawn but not yet burned into the file. */
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
      // Keep a short poll only while uploads/processors are active so the
      // library card does not get stuck if the global refresh signal is
      // missed. Generated titles arrive through the shared DB sync transport;
      // polling completed recordings forever is both redundant and expensive.
      refetchInterval: (q) => {
        const recs = (q.state.data as any)?.recordings as
          | RecordingSummary[]
          | undefined;
        return recordingsRefetchInterval(recs);
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

// ── Folders / spaces / organizations ──────────────────────────────────────────
// Derived from `list-organization-state` which ships with the template. All
// three hooks hit the same endpoint and slice.

export function useOrganizationState(
  organizationId?: string,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  // Callers usually pass the id they just read from the active-org result, so
  // an explicit `{ organizationId }` key would refetch the same org as a
  // second, serial request. Serve the active query unless a different org is
  // asked for.
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

/**
 * Walks `parentId` from `folderId` up to the root, returning ancestors first
 * and the folder itself last. Guards against a parentId cycle so a bad row
 * can't hang the breadcrumb in an infinite loop.
 */
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
