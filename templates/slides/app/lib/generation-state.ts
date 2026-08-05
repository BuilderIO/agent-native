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

export function shouldShowNewDeckGeneratingProgress({
  generating,
  isNewDeckCreation,
}: {
  generating: boolean;
  isNewDeckCreation: boolean;
}): boolean {
  return generating && isNewDeckCreation;
}

export function shouldClearNewDeckGeneratingState({
  generating,
  generationStarted,
}: {
  generating: boolean;
  generationStarted: boolean;
}): boolean {
  return generationStarted && !generating;
}
