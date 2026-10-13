export type PresentMessage =
  | {
      type: "state";
      index: number;
      /** Build step on that slide, as the audience shows it at the target. */
      buildStep: number;
    }
  | { type: "command"; command: "next" | "prev" }
  | { type: "hello" }
  /**
   * The audience is going away. The presenter stops treating it as connected
   * until a state message arrives again.
   */
  | { type: "bye" };

export function advancePresentIndex(
  index: number,
  command: "next" | "prev",
  slideCount: number,
): number {
  if (slideCount <= 0) return 0;
  const current = Math.max(0, Math.min(index, slideCount - 1));
  return command === "next"
    ? Math.min(slideCount - 1, current + 1)
    : Math.max(0, current - 1);
}

export function openPresentChannel(deckId: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(`slides-present:${deckId}`);
}
