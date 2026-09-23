export interface SelectableDesignSystem {
  id: string;
}

/**
 * Drops a candidate default/last-used id when it no longer points at a
 * design system in the current list, instead of silently pre-selecting one
 * the picker would immediately have to reject.
 */
export function resolveSelectableDesignSystemId(
  designSystems: SelectableDesignSystem[],
  candidateId: string | null | undefined,
): string | null {
  if (!candidateId) return null;
  return designSystems.some((ds) => ds.id === candidateId) ? candidateId : null;
}
