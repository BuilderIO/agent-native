import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";

export interface DesignVersionChatContext {
  threadId?: string;
  runId?: string;
  turnId?: string;
  actionName?: string;
  surface?: "editor";
}

export interface DesignVersionListEntry {
  id: string;
  designId: string;
  label: string | null;
  createdAt: string | null;
  source: "chat" | "editor" | "legacy";
  fileCount: number;
  chatContext: DesignVersionChatContext | null;
  editable?: boolean;
}

export interface DesignVersionListResponse {
  designId: string;
  count: number;
  invalidCount: number;
  versions: DesignVersionListEntry[];
}

export interface DesignVersionFile {
  id: string | null;
  filename: string;
  fileType: string;
  content: string;
}

export interface DesignVersionDetail {
  id: string;
  designId: string;
  label: string | null;
  createdAt: string | null;
  source: "chat" | "editor" | "legacy";
  fileCount: number;
  chatContext: DesignVersionChatContext | null;
  editable?: boolean;
  designTitle: string | null;
  files: DesignVersionFile[];
}

export interface RestoreDesignVersionResult {
  id: string;
  restoredVersionId: string;
  beforeRestoreVersionId: string;
  restoredFileCount: number;
  removedFileCount: number;
  updatedAt: string;
  collaborationReconcilePending: string[];
}

export function useDesignVersions(designId: string | null) {
  return useActionQuery<DesignVersionListResponse>(
    "list-design-versions",
    designId ? { designId } : undefined,
    {
      enabled: !!designId,
      placeholderData: (prev: DesignVersionListResponse | undefined) =>
        prev && designId && prev.designId === designId ? prev : undefined,
    } as Record<string, unknown>,
  );
}

export function useDesignVersion(
  designId: string | null,
  versionId: string | null,
) {
  return useActionQuery<DesignVersionDetail>(
    "get-design-version",
    designId && versionId ? { designId, versionId } : undefined,
    {
      enabled: !!(designId && versionId),
      // Do not carry the previous checkpoint as placeholderData — selecting
      // version B must not render version A's preview/title while B loads.
    } as Record<string, unknown>,
  );
}

export function useRestoreDesignVersion() {
  return useActionMutation<
    RestoreDesignVersionResult,
    { designId: string; versionId: string }
  >("restore-design-version");
}
