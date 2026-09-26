
export function resolveTabDropIndex(
  fromIndex: number,
  overIndex: number,
  dropOnRightHalf: boolean,
): number {
  let toIndex = dropOnRightHalf ? overIndex + 1 : overIndex;
  if (fromIndex < toIndex) toIndex -= 1;
  return toIndex;
}

export function isTabReorderNoop(fromIndex: number, toIndex: number): boolean {
  return fromIndex < 0 || toIndex < 0 || fromIndex === toIndex;
}
