import {
  registerActionChatRenderer,
  type ToolRendererProps,
} from "@agent-native/core/client/agentkit-chat";
import { ActionCard } from "@agent-native/core/client/chat";
import { useT } from "@agent-native/core/client/i18n";
import {
  projectSlidesDeckResult,
  SLIDES_DECK_RESULT_RENDERER,
} from "@shared/action-ui";
import { IconPresentation } from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export function SlidesDeckResultCard({ context }: ToolRendererProps) {
  const t = useT();
  const deck = projectSlidesDeckResult(context.resultJson);
  if (!deck) return null;

  return (
    <ActionCard
      icon={<IconPresentation aria-hidden="true" />}
      title={deck.title}
      detail={t("history.slideCount", { count: deck.slideCount })}
      status={t("deckResult.saved")}
      className="border-0 bg-transparent p-0 shadow-none"
      action={
        <Button
          asChild
          size="sm"
          variant="outline"
          className="transition-none active:scale-100"
        >
          <Link to={`/deck/${encodeURIComponent(deck.id)}`}>
            {t("deckEditor.accessApprovalOpenDeck")}
          </Link>
        </Button>
      }
    />
  );
}

registerActionChatRenderer({
  id: "slides.deck-result",
  renderer: SLIDES_DECK_RESULT_RENDERER,
  Component: SlidesDeckResultCard,
});
