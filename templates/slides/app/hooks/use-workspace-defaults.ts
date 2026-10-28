import { useActionQuery } from "@agent-native/core/client/hooks";
import type { AgentDesignSystemContext } from "@agent-native/core/shared";

export type WorkspaceDefaultRef =
  | { id: string; title: string; unavailable?: false }
  | { id: string; title: null; unavailable: true }
  | null;

export interface WorkspaceDefaultsResult {
  referenceDeck: WorkspaceDefaultRef;
  designSystem: AgentDesignSystemContext | null;
  canManage: boolean;
}

export function useWorkspaceDefaults(enabled = true) {
  const { data, isLoading, error, refetch } =
    useActionQuery<WorkspaceDefaultsResult>(
      "get-workspace-defaults",
      undefined,
      { enabled },
    );

  return {
    referenceDeck: data?.referenceDeck ?? null,
    designSystem: data?.designSystem ?? null,
    canManage: data?.canManage ?? false,
    isLoading,
    error,
    refetch,
  };
}
