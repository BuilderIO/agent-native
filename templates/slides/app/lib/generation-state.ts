export function shouldShowNewDeckGeneratingOverlay({
  generating,
  isNewDeckCreation,
  slideCount,
  generationStarted,
}: {
  generating: boolean;
  isNewDeckCreation: boolean;
  slideCount?: number | null;
  generationStarted: boolean;
}): boolean {
  return (
    isNewDeckCreation &&
    (slideCount ?? 0) === 0 &&
    (generating || !generationStarted)
  );
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
