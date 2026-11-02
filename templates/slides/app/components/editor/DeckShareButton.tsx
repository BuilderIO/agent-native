import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  ShareButton,
  type ShareButtonProps,
  type ShareSendTo,
} from "@agent-native/toolkit/app/sharing";

import type { Deck } from "@/context/DeckContext";
import { useDeckVisibility } from "@/hooks/use-deck-visibility";
import {
  getDeckShareLinkOrder,
  type DeckShareLinkKind,
} from "@/lib/deck-share-links";

import { useDeckShareSendTo } from "./use-deck-share-send-to";

interface DeckShareLink {
  url: string;
  label: string;
  copyLabel: string;
}

function absoluteAppUrl(path: string): string {
  return typeof window === "undefined"
    ? path
    : `${window.location.origin}${appPath(path)}`;
}

/**
 * The live editor and presentation links for a deck, primary first. Access is
 * whatever the deck's General access and grants allow, so the links never go
 * stale the way a copied snapshot would. `/p/:id` presents to anyone who can
 * open the deck, so the presentation link works in every visibility.
 */
export function useDeckShareLinks(
  deckId: string,
  visibility: Deck["visibility"],
  hasSlides: boolean,
): {
  primary: DeckShareLink | undefined;
  secondary: DeckShareLink | undefined;
} {
  const t = useT();
  const links: Record<DeckShareLinkKind, DeckShareLink> = {
    editor: {
      url: absoluteAppUrl(`/deck/${deckId}`),
      label: t("editorToolbar.editorLink"),
      copyLabel: t("editorToolbar.copyEditorLink"),
    },
    presentation: {
      url: absoluteAppUrl(`/p/${deckId}`),
      label: t("editorToolbar.presentationLink"),
      copyLabel: t("editorToolbar.copyPresentationLink"),
    },
  };
  const order = getDeckShareLinkOrder(visibility);
  // The presentation link has nothing to open until the deck has a slide.
  const visible = (kind: DeckShareLinkKind) =>
    kind === "editor" || hasSlides ? links[kind] : undefined;
  return {
    primary: visible(order.primary),
    secondary: visible(order.secondary),
  };
}

/**
 * The deck's share panel links: Copy link copies the primary link, and the
 * other one is a Send to item. The editor link stands in for a presentation
 * link the deck cannot open yet, so Copy link always has a link.
 */
export function useDeckShareProps(
  deckId: string,
  visibility: Deck["visibility"],
  hasSlides: boolean,
): { shareUrl?: string; shareUrlLabel?: string; sendTo: ShareSendTo } {
  const { primary, secondary } = useDeckShareLinks(
    deckId,
    visibility,
    hasSlides,
  );
  const copied = primary ?? secondary;
  const sendTo = useDeckShareSendTo(primary ? secondary : undefined);
  return {
    ...(copied ? { shareUrl: copied.url, shareUrlLabel: copied.label } : {}),
    sendTo,
  };
}

type DeckShareButtonProps = Omit<
  ShareButtonProps,
  "resourceType" | "resourceId" | "resourceTitle"
> & {
  deckId: string;
  deckTitle: string;
  deckVisibility: Deck["visibility"];
  hasSlides: boolean;
};

export function DeckShareButton({
  deckId,
  deckTitle,
  deckVisibility,
  hasSlides,
  ...props
}: DeckShareButtonProps) {
  const t = useT();
  const visibility = useDeckVisibility(deckId, deckVisibility);
  const shareProps = useDeckShareProps(deckId, visibility, hasSlides);
  return (
    <ShareButton
      resourceType="deck"
      resourceId={deckId}
      resourceTitle={deckTitle}
      panelTitle={t("share.title")}
      peopleAccessLabel={t("share.whoHasAccess")}
      {...shareProps}
      {...props}
    />
  );
}
