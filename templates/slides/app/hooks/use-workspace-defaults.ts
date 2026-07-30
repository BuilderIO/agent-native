import { useActionQuery } from "@agent-native/core/client/hooks";

export type WorkspaceDefaultRef =
  | { id: string; title: string; unavailable?: false }
  | { id: string; title: null; unavailable: true }
  | null;

export interface WorkspaceDefaultsResult {
  referenceDeck: WorkspaceDefaultRef;
  designSystem: WorkspaceDefaultRef;
  canManage: boolean;
}

export function useWorkspaceDefaults() {
  const { data, isLoading, error, refetch } =
    useActionQuery<WorkspaceDefaultsResult>("get-workspace-defaults");

  return {
    referenceDeck: data?.referenceDeck ?? null,
    designSystem: data?.designSystem ?? null,
    canManage: data?.canManage ?? false,
    isLoading,
    error,
    refetch,
  };
}
