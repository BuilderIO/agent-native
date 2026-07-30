/**
 * Cross-window channel between the fullscreen presentation and the presenter
 * window. The presenter window never advances on its own — it sends commands
 * and renders whatever state the presentation echoes back, so build steps
 * (which move the step, not the slide) stay authoritative in one place.
 */
export type PresentMessage =
  | { type: "state"; index: number }
  | { type: "command"; command: "next" | "prev" }
  | { type: "hello" };

export function openPresentChannel(deckId: string): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  return new BroadcastChannel(`slides-present:${deckId}`);
}
