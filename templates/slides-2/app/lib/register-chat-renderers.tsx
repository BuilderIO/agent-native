import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { ActionCard } from "@agent-native/toolkit/app/chat";
import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/toolkit/app/chat/agentkit-chat/index";
import {
  projectSlidesAddedSlidePreview,
  projectSlidesAddedSlideResult,
  SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  projectSlidesDeckResult,
  SLIDES_DECK_RESULT_RENDERER,
} from "@shared/action-ui";
import { IconPresentation } from "@tabler/icons-react";
import { Link } from "react-router";

import SlideRenderer from "@/components/deck/SlideRenderer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
        action={
          <Button asChild size="sm" variant="outline">
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

export function SlidesAddedSlideResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const result = projectSlidesAddedSlideResult(context.resultJson);
  const { data, isPending } = useActionQuery(
    "get-deck",
    {
      id: result?.deckId ?? "",
      slideId: result?.slideId ?? "",
      compact: "false",
    },
    { enabled: result !== null },
  );

  if (!result) return null;

  const preview = projectSlidesAddedSlidePreview(data, result.slideId);
  const chatParams = new URLSearchParams({
    deckId: result.deckId,
    slideId: result.slideId,
    slideNumber: String(result.slideNumber),
  });

  return (
    <div className="space-y-3">
      <ActionCard
        icon={<IconPresentation aria-hidden="true" />}
        title={result.deckTitle}
        detail={t("agent.slideNumber", { number: result.slideNumber })}
        status={t("deckResult.saved")}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link
                to={`/deck/${encodeURIComponent(result.deckId)}?slide=${result.slideNumber}`}
              >
                {t("deckEditor.accessApprovalOpenDeck")}
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to={`/chat?${chatParams.toString()}`}>
                {t("deckEditor.continueInChat")}
              </Link>
            </Button>
          </div>
        }
      />
      {preview ? (
        <div
          className="aspect-video overflow-hidden rounded-md border border-border bg-muted"
          data-slides-added-slide-preview
          inert
          aria-hidden="true"
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
            thumbnail
          />
        </div>
      ) : isPending ? (
        <div className="aspect-video overflow-hidden rounded-md border border-border bg-muted p-2">
          <Skeleton className="size-full" />
        </div>
      ) : null}
    </div>
  );
}

registerActionChatRenderer({
  id: "slides.added-slide-result",
  renderer: SLIDES_ADDED_SLIDE_RESULT_RENDERER,
  Component: SlidesAddedSlideResultCard,
});
