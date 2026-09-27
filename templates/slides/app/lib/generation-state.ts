export type NewDeckGenerationPhase = "pending" | "started" | "abandoned";

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
