export function getActiveDescendantId(
  optionIdPrefix: string,
  expanded: boolean,
  selectedIndex: number,
  optionCount: number,
): string | undefined {
  if (
    !expanded ||
    !Number.isInteger(selectedIndex) ||
    selectedIndex < 0 ||
    selectedIndex >= optionCount
  ) {
    return undefined;
  }

  return `${optionIdPrefix}${selectedIndex}`;
}
