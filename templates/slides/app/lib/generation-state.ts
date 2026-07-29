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
  generationStarted,
  slideCount,
}: {
  generating: boolean;
  generationStarted: boolean;
  slideCount?: number | null;
}): boolean {
  return (
    (slideCount ?? 0) > 0 || (generationStarted && !generating)
  );
}
