/**
 * Server half of the slide save boundary. Underscore-prefixed so action
 * discovery skips it — this module is not itself an action.
 */
import { fail } from "@agent-native/core/action";

import {
  renderArtifactGrowth,
  SCOPED_STYLE_SELECTOR_MARKER,
} from "../app/lib/slide-source-map.js";

/**
 * Refuses a content write that adds markers only the editor's rendered DOM
 * carries. Such a write stored rendered markup (scoped `<style>` selectors,
 * source stamps, editor attributes) in place of the slide, which is how whole
 * slides were flattened. Content that already has them still saves.
 */
export function assertNoRenderArtifacts(
  previousContent: string,
  nextContent: string,
  slideId: string,
): void {
  const markers = renderArtifactGrowth(previousContent, nextContent);
  if (markers.length === 0) return;
  fail(
    `Slide ${slideId} content contains editor-rendered markup (${markers.join(", ")}). Write the slide's stored HTML, not the rendered editor DOM.`,
    {
      errorCode: "render_artifact_in_slide_content",
      details: { slideId, markers },
    },
  );
}

/**
 * The check for a slide with no stored predecessor (a new deck, a duplicate,
 * an undo-restored slide), whose history the server cannot see. An exact copy
 * of a slide the deck stores is a duplicate of stored content and passes as it
 * is. Otherwise, older saves stored the scoped stylesheet's selectors in
 * `<style>`, and the renderer heals them, so a copy of such a slide may carry
 * them; every other marker, the scope attribute included, is refused.
 */
export function assertNoRenderArtifactsInNewSlide(
  content: string,
  slideId: string,
  storedContents: readonly string[] = [],
): void {
  if (storedContents.includes(content)) return;
  const markers = renderArtifactGrowth("", content).filter(
    (marker) => marker !== SCOPED_STYLE_SELECTOR_MARKER,
  );
  if (markers.length === 0) return;
  fail(
    `Slide ${slideId} content contains editor-rendered markup (${markers.join(", ")}). Write the slide's stored HTML, not the rendered editor DOM.`,
    {
      errorCode: "render_artifact_in_slide_content",
      details: { slideId, markers },
    },
  );
}

/**
 * The full-payload write's half of the save boundary: a stored slide is checked
 * against its stored predecessor, a slide new to the deck (or a new deck's) as
 * a new slide.
 */
export function assertNoDeckRenderArtifacts(
  previousData: string | null | undefined,
  nextDeck: { slides?: unknown },
): void {
  const previousSlides = (
    previousData
      ? ((JSON.parse(previousData) as { slides?: unknown }).slides ?? [])
      : []
  ) as Array<Record<string, unknown>>;
  const nextSlides = Array.isArray(nextDeck.slides)
    ? (nextDeck.slides as Array<Record<string, unknown>>)
    : [];
  const storedContents = previousSlides
    .map((slide) => slide.content)
    .filter((content): content is string => typeof content === "string");
  for (const slide of nextSlides) {
    if (typeof slide.content !== "string") continue;
    const prior = previousSlides.find((candidate) => candidate.id === slide.id);
    if (prior) {
      assertNoRenderArtifacts(
        typeof prior.content === "string" ? prior.content : "",
        slide.content,
        String(slide.id),
      );
    } else {
      assertNoRenderArtifactsInNewSlide(
        slide.content,
        String(slide.id),
        storedContents,
      );
    }
  }
}
