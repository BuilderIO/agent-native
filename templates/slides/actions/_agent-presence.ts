/**
 * Shared agent-presence attribution for slide-editing actions.
 *
 * When the agent edits a slide, we upsert its awareness entry on the DECK
 * presence doc (`deck-<deckId>`, the same doc `use-deck-presence` reads) so the
 * editor UI lights up the agent on the exact slide it is editing:
 *   - `metadata.slide` places the agent on that slide (sidebar avatars +
 *     SameSlidePresenceIndicator).
 *   - the `edit` descriptor `{ kind: "paths", paths: ["slides.<id>"] }` feeds
 *     the lingering "AI edited" highlight over the slide thumbnail/canvas.
 *
 * All of this is best-effort: presence must NEVER fail the underlying write, so
 * callers wrap this in try/catch (and it also swallows its own errors).
 */
import { agentTouchDocument } from "@agent-native/core/collab";

/** Human-friendly label for a slide, used on the lingering edit tag. */
export function slideLabelFor(
  slide: { content?: unknown } | undefined,
  slideIndex: number,
): string {
  const content = typeof slide?.content === "string" ? slide.content : "";
  const match = content.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
  const title = match?.[1]?.trim();
  return title || `Slide ${slideIndex + 1}`;
}

/**
 * Record an agent slide edit on the deck presence doc. Safe to call from any
 * action — refcount-neutral (no enter/leave needed) and never throws.
 */
export function touchAgentSlidePresence(args: {
  deckId: string;
  slideId: string;
  label: string;
}): void {
  try {
    agentTouchDocument(`deck-${args.deckId}`, {
      metadata: { slide: args.slideId },
      edit: {
        descriptor: { kind: "paths", paths: [`slides.${args.slideId}`] },
        label: args.label,
      },
    });
  } catch {
    // Presence is best-effort — swallow so it never breaks the write.
  }
}
