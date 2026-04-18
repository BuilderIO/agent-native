import { useActionQuery, useActionMutation } from "@agent-native/core/client";

export interface RecordingSummary {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  animatedThumbnailUrl: string | null;
  durationMs: number;
  status: "uploading" | "processing" | "ready" | "failed";
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
    },
  );
}

export interface SearchHit {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string | null;
  durationMs: number;
  matchType: "title-description" | "title-transcript" | "transcript";
  snippet: string | null;
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
      organizationId: string;
      spaceId?: string;
      parentId?: string | null;
    }
  >("create-folder");
}

export function useRenameFolder() {
  return useActionMutation<any, { id: string; name: string }>("rename-folder");
}

export function useDeleteFolder() {
  return useActionMutation<any, { id: string }>("delete-folder");
}

export function useMoveRecording() {
  return useActionMutation<any, { id: string; folderId?: string | null }>(
    "move-recording",
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

export function useOrganizationState(organizationId?: string) {
  return useActionQuery<any>(
    "list-organization-state",
    organizationId ? { organizationId } : undefined,
  );
}

export function useFolders(
  args: { organizationId?: string; spaceId?: string | null } = {},
) {
  const { data, isLoading } = useOrganizationState(args.organizationId);
  const all = Array.isArray(data?.folders) ? (data.folders as any[]) : [];
  const folders =
    args.spaceId !== undefined
      ? all.filter((f) =>
          args.spaceId === null ? !f.spaceId : f.spaceId === args.spaceId,
        )
      : all;
  return { data: { folders }, isLoading };
}

export function useSpaces(organizationId?: string) {
  const { data, isLoading } = useOrganizationState(organizationId);
  const spaces = Array.isArray(data?.spaces) ? (data.spaces as any[]) : [];
  return { data: { spaces }, isLoading };
}

export function useOrganizations() {
  // list-organization-state only returns the current organization. We surface
  // it as a single-item list so the switcher has something to render; the
  // framework team will replace this with a proper `list-organizations` later.
  const { data, isLoading } = useOrganizationState();
  const organizations = data?.organization ? [data.organization] : [];
  return {
    data: { organizations, currentId: data?.organization?.id },
    isLoading,
  };
}
