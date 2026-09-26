export interface SelectableDesignSystem {
  id: string;
}

export function resolveSelectableDesignSystemId(
  designSystems: SelectableDesignSystem[],
  candidateId: string | null | undefined,
): string | null {
  if (!candidateId) return null;
  return designSystems.some((ds) => ds.id === candidateId) ? candidateId : null;
}
