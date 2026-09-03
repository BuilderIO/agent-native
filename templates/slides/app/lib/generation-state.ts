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
 *  Returns null once the placeholder leaves the deck, or once its content is
 *  no longer the blank stand-in: the fill is done, presence/recent-edit
 *  tracking picks up that slide's own marker from there, and if the same run
 *  goes on to `add-slide` more slides (a multi-slide request), those are
 *  genuinely new and should get the trailing generating row again. */
export function slideBeingFilledInPlace({
  addSlideGenerating,
  addSlideTargetId,
  slides,
  blankContent,
}: {
  addSlideGenerating: boolean;
  addSlideTargetId: string | null;
  slides: { id: string; content: string }[];
  blankContent: string;
}): string | null {
  if (!addSlideGenerating || !addSlideTargetId) return null;
  const target = slides.find((slide) => slide.id === addSlideTargetId);
  if (!target || target.content !== blankContent) return null;
  return addSlideTargetId;
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
