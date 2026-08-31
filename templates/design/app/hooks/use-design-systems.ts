import { useActionQuery } from "@agent-native/core/client/hooks";

import { isDesignSystemUsableForGeneration } from "@/lib/design-system-data";

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

/**
 * The source design system for a new design/template must be one the viewer
 * owns and can actually generate from, or explicitly shared as a default —
 * never picked because it happened to be first in an org-visible list, and
 * never a Builder-synced kit still mid-index (its placeholders would make
 * the generation unusable). `designSystems[0]` can be another member's
 * system, so callers resolving "the design system to use" fall back through
 * this instead of indexing the raw list directly.
 */
export function preferredOwnedDesignSystemId(
  designSystems: Pick<
    DesignSystemSummary,
    "id" | "isDefault" | "accessRole" | "data"
  >[],
  defaultSystem: Pick<DesignSystemSummary, "id" | "data"> | undefined,
): string | null {
  if (defaultSystem && isDesignSystemUsableForGeneration(defaultSystem.data)) {
    return defaultSystem.id;
  }
  return (
    designSystems.find(
      (ds) =>
        ds.accessRole === "owner" && isDesignSystemUsableForGeneration(ds.data),
    )?.id ?? null
  );
}

export function useDesignSystems(enabled = true) {
  const { data, isLoading, error, refetch } = useActionQuery<{
    designSystems: DesignSystemSummary[];
  }>("list-design-systems", undefined, { enabled });

  const designSystems: DesignSystemSummary[] = data?.designSystems ?? [];
  const defaultSystem = designSystems.find(isViewerDefaultDesignSystem);

  return { designSystems, defaultSystem, isLoading, error, refetch };
}
