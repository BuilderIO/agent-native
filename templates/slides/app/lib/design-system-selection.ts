import type { DesignSystemIndexingStatus } from "../../shared/design-system-validation";

export interface SelectableDesignSystem {
  id: string;
  indexingStatus?: DesignSystemIndexingStatus;
}

/** A design system with no usable tokens/components yet must not be picked for generation. */
export function isDesignSystemSelectable(
  designSystem: Pick<SelectableDesignSystem, "indexingStatus">,
): boolean {
  return (
    designSystem.indexingStatus !== "indexing" &&
    designSystem.indexingStatus !== "unavailable"
  );
}

/**
 * Drops a candidate default/last-used id when it now points at a design
 * system that isn't selectable, instead of silently pre-selecting one the
 * picker would immediately have to reject.
 */
export function resolveSelectableDesignSystemId(
  designSystems: SelectableDesignSystem[],
  candidateId: string | null | undefined,
): string | null {
  if (!candidateId) return null;
  const match = designSystems.find((ds) => ds.id === candidateId);
  if (!match) return null;
  return isDesignSystemSelectable(match) ? candidateId : null;
}
