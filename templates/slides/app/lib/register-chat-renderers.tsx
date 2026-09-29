import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/agentkit-chat";
import {
  ActionCard,
  compactOutlineButtonClassName,
} from "@agent-native/core/client/chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  projectSlidesDeckResult,
  SLIDES_DECK_RESULT_RENDERER,
} from "@shared/action-ui";
import { IconPresentation } from "@tabler/icons-react";
import { Link } from "react-router";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { Button } from "@/components/ui/button";
import type { Slide } from "@/context/DeckContext";

export function SlidesDeckResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const deck = projectSlidesDeckResult(context.resultJson);
  if (!deck) return null;

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={deck.title}
        detail={t("history.slideCount", { count: deck.slideCount })}
        status={t("deckResult.saved")}
        className="rounded-none border-0 bg-transparent p-0 shadow-none"
        action={
          <Button
            asChild
            size="sm"
            variant="outline"
            className={`${compactOutlineButtonClassName} transition-none active:scale-100`}
          >
            <Link to={`/deck/${encodeURIComponent(deck.id)}`}>
              {t("deckEditor.accessApprovalOpenDeck")}
            </Link>
          </Button>
        }
      />
      {deck.previews.length > 0 ? (
        <div
          className="mt-3 grid grid-cols-3 gap-2 overflow-hidden"
          data-slides-deck-preview-strip
          inert
          aria-hidden="true"
        >
          {deck.previews.map((preview) => (
            <div
              key={preview.id}
              className="min-w-0 overflow-hidden rounded-md border border-border bg-muted"
            >
              <SlideRenderer
                slide={
                  {
                    id: preview.id,
                    content: preview.content,
                    notes: "",
                    layout: preview.layout,
                  } satisfies Slide
                }
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "slides.deck-result",
  renderer: SLIDES_DECK_RESULT_RENDERER,
  Component: SlidesDeckResultCard,
});
