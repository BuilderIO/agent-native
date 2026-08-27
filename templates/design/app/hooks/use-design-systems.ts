import { useActionQuery } from "@agent-native/core/client/hooks";

export type DesignSystemSummary = {
  id: string;
  title: string;
  description: string | null;
  data: string;
  isDefault: boolean;
  visibility?: "private" | "org" | "public" | null;
  accessRole?: "owner" | "viewer" | "commenter" | "editor" | "admin";
  createdAt: string;
};

/**
 * The design-system list includes org-visible systems owned by other members,
 * and isDefault is scoped per (owner, org). Another member's flag is not this
 * viewer's default: it must not render as "Default", and it must not be picked
 * as the source for new designs.
 */
export function isViewerDefaultDesignSystem(
  ds: Pick<DesignSystemSummary, "isDefault" | "accessRole">,
): boolean {
  return ds.isDefault && ds.accessRole === "owner";
}

export function useDesignSystems(enabled = true) {
  const { data, isLoading, error, refetch } = useActionQuery<{
    designSystems: DesignSystemSummary[];
  }>("list-design-systems", undefined, { enabled });

  const designSystems: DesignSystemSummary[] = data?.designSystems ?? [];
  const defaultSystem = designSystems.find(isViewerDefaultDesignSystem);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
