import type { SlidesAgentSelection } from "./slide-agent-context";

export function readRouteSlideSelection(
  search: string,
  deckId: string | null,
): SlidesAgentSelection | null {
  if (!deckId) return null;
  const params = new URLSearchParams(search);
  const rawSlideId = params.get("slideId")?.trim();
  const slideId = rawSlideId && rawSlideId.length <= 200 ? rawSlideId : null;
  const rawSlideNumber = params.get("slideNumber");
  const parsedSlideNumber = rawSlideNumber ? Number(rawSlideNumber) : NaN;
  const slideNumber =
    Number.isSafeInteger(parsedSlideNumber) && parsedSlideNumber >= 1
      ? parsedSlideNumber
      : undefined;

  return {
    deckId,
    ...(slideId ? { slideId } : {}),
    ...(slideNumber === undefined ? {} : { slideNumber }),
    items: [],
  };
}
