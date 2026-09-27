/** "pending" covers both "about to start" and "waiting to start" — the two
 *  states a boolean `generationStarted` could never tell apart, which is why
 *  a run that died before its first event looked identical to one still
 *  warming up and stayed stuck forever. A late run can still revive an
 *  "abandoned" route while its editor remains mounted. */
export type NewDeckGenerationPhase = "pending" | "started" | "abandoned";

/** How long we wait, after `?generating=1` promises a run, for that run to
 *  actually start before treating it as abandoned instead of still warming
 *  up. Reload, a bookmark, a shared link, and a dead run all leave
 *  `generating` false forever; this bound is what tells them apart from a
 *  run that just hasn't sent its first event yet. */
export const NEW_DECK_GENERATION_START_TIMEOUT_MS = 20_000;

export function nextNewDeckGenerationPhase({
  phase,
  generating,
  waitingOnQuestions,
  waitExpired,
}: {
  phase: NewDeckGenerationPhase;
  generating: boolean;
  waitingOnQuestions: boolean;
  waitExpired: boolean;
}): NewDeckGenerationPhase {
  if (generating) return "started";
  if (phase !== "pending") return phase;
  // Pre-generation questions answered from the empty editor are a
  // legitimate reason nothing has started yet; never expire underneath them.
  if (waitingOnQuestions) return "pending";
  return waitExpired ? "abandoned" : "pending";
}

export function shouldShowNewDeckGeneratingOverlay({
  generating,
  isNewDeckCreation,
  slideCount,
  phase,
}: {
  generating: boolean;
  isNewDeckCreation: boolean;
  slideCount?: number | null;
  phase: NewDeckGenerationPhase;
}): boolean {
  return (
    isNewDeckCreation &&
    (slideCount ?? 0) === 0 &&
    (generating || phase === "pending")
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
  waitingOnQuestions,
  phase,
}: {
  generating: boolean;
  waitingOnQuestions: boolean;
  phase: NewDeckGenerationPhase;
}): boolean {
  return (
    !generating &&
    !waitingOnQuestions &&
    (phase === "started" || phase === "abandoned")
  );
}

export function shouldClearNewDeckGenerationRun({
  generating,
  waitingOnQuestions,
  phase,
}: {
  generating: boolean;
  waitingOnQuestions: boolean;
  phase: NewDeckGenerationPhase;
}): boolean {
  return !generating && !waitingOnQuestions && phase === "started";
}
