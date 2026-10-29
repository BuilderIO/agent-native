import { appPath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  ShareButton,
  type ShareButtonProps,
} from "@agent-native/toolkit/app/sharing";

import type { Deck } from "@/context/DeckContext";
import { useDeckVisibility } from "@/hooks/use-deck-visibility";
import {
  getDeckShareLinkOrder,
  type DeckShareLinkKind,
} from "@/lib/deck-share-links";

import { DeckShareAgentTab } from "./DeckShareAgentTab";

interface DeckShareLink {
  url: string;
  label: string;
  description?: string;
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
      description: t("editorToolbar.editorLinkDescription"),
    },
    presentation: {
      url: absoluteAppUrl(`/p/${deckId}`),
      label: t("editorToolbar.presentationLink"),
      description: t("editorToolbar.presentationLinkDescription"),
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
  const { primary, secondary } = useDeckShareLinks(
    deckId,
    visibility,
    hasSlides,
  );
  return (
    <ShareButton
      resourceType="deck"
      resourceId={deckId}
      resourceTitle={deckTitle}
      panelTitle={t("share.title")}
      roleCopy={{
        commenter: {
          label: t("editorToolbar.commenterRoleLabel"),
          description: t("editorToolbar.commenterRoleDescription"),
        },
      }}
      {...(primary
        ? {
            shareUrl: primary.url,
            shareUrlLabel: primary.label,
            ...(primary.description
              ? { shareUrlDescription: primary.description }
              : {}),
          }
        : {})}
      {...(secondary
        ? {
            secondaryShareUrl: secondary.url,
            secondaryShareUrlLabel: secondary.label,
            ...(secondary.description
              ? { secondaryShareUrlDescription: secondary.description }
              : {}),
          }
        : {})}
      showShareLinks={Boolean(primary || secondary)}
      shareUrlPlacement="bottom"
      peopleAccessLabel={t("share.whoHasAccess")}
      agentTabContent={<DeckShareAgentTab deckId={deckId} />}
      {...props}
    />
  );
}
