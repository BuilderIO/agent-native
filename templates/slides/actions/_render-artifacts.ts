/**
 * Server half of the slide save boundary. Underscore-prefixed so action
 * discovery skips it — this module is not itself an action.
 */
import { fail } from "@agent-native/core/action";

import { renderArtifactGrowth } from "../app/lib/slide-source-map.js";

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
