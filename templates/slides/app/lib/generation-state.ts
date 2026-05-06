export function shouldShowNewDeckGeneratingOverlay({
  generating,
  isNewDeckCreation,
  slideCount,
}: {
  generating: boolean;
  isNewDeckCreation: boolean;
  slideCount?: number | null;
}): boolean {
  return generating && isNewDeckCreation && (slideCount ?? 0) === 0;
}

export function shouldClearNewDeckGeneratingState({
  generating,
  slideCount,
}: {
  generating: boolean;
  slideCount?: number | null;
}): boolean {
  return !generating || (slideCount ?? 0) > 0;
}
