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

/** The blank placeholder "New slide" inserted and handed to the agent to fill.
 *  While one is live the rail marks that existing row as AI-active; appending
 *  the synthetic generating row too would read as a second, duplicate slide.
 *  Returns null once the placeholder leaves the deck, so a run that outlives
 *  its target falls back to the generic generating row. */
export function slideBeingFilledInPlace({
  addSlideGenerating,
  addSlideTargetId,
  slideIds,
}: {
  addSlideGenerating: boolean;
  addSlideTargetId: string | null;
  slideIds: string[];
}): string | null {
  if (!addSlideGenerating || !addSlideTargetId) return null;
  return slideIds.includes(addSlideTargetId) ? addSlideTargetId : null;
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
