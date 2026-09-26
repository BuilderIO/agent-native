import { agentTouchDocument } from "@agent-native/core/collab";

export function slideLabelFor(
  slide: { content?: unknown } | undefined,
  slideIndex: number,
): string {
  const content = typeof slide?.content === "string" ? slide.content : "";
  const match = content.match(/<h[12][^>]*>([^<]+)<\/h[12]>/i);
  const title = match?.[1]?.trim();
  return title || `Slide ${slideIndex + 1}`;
}

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
