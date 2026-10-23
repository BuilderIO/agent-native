/**
 * How the editor starts a presentation. `fullscreen` is the default and asks
 * the browser for fullscreen on arrival, `window` presents inside the tab as
 * it is, and `presenter` addresses the speaker-notes window that syncs with
 * the audience view.
 */
export type PresentMode = "fullscreen" | "window" | "presenter";

export type PresentRequest = {
  preserveNativeNavigation?: true;
  mode?: PresentMode;
};

export const PRESENTER_WINDOW_FEATURES = "width=1200,height=760";

// One name per deck, so starting Presenter View again reuses an open window.
export function presenterWindowName(deckId: string): string {
  return `slides-presenter-${deckId}`;
}

export function buildPresentUrl(
  deckId: string,
  slideIndex: number,
  mode: PresentMode = "fullscreen",
): string {
  const params = new URLSearchParams({
    slide: String(Math.max(0, slideIndex) + 1),
  });
  if (mode === "window") params.set("fullscreen", "0");
  if (mode === "presenter") params.set("presenter", "1");
  return `/deck/${deckId}/present?${params}`;
}
