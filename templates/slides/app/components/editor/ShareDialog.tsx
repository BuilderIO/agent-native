import { appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useT } from "@agent-native/core/client/i18n";
import { ShareDialog as CoreShareDialog } from "@agent-native/core/client/sharing";
import { ShareCopyRow } from "@agent-native/toolkit/sharing";
import {
  cloneElement,
  isValidElement,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { CloudUpgrade } from "@/components/CloudUpgrade";
import type { Deck } from "@/context/DeckContext";
import { useDbStatus } from "@/hooks/use-db-status";
import { getDeckShareLinkOrder } from "@/lib/deck-share-links";

interface ShareDialogProps {
  deck: Deck;
  /** Trigger element rendered as the dialog anchor (usually the Share button). */
  children: ReactNode;
}

function getShareUrls(deckId: string) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  return {
    editor:
      typeof window === "undefined"
        ? `/deck/${deckId}`
        : `${origin}${appPath(`/deck/${deckId}`)}`,
    presentation:
      typeof window === "undefined"
        ? `/p/${deckId}`
        : `${origin}${appPath(`/p/${deckId}`)}`,
  };
}

export default function ShareDialog({ deck, children }: ShareDialogProps) {
  const t = useT();
  const { isLocal } = useDbStatus();
  const [open, setOpen] = useState(false);

  const shareUrls = getShareUrls(deck.id);
  const shareLinkOrder = getDeckShareLinkOrder(deck.visibility);
  const primaryShareLink = shareUrls[shareLinkOrder.primary];
  const secondaryShareLink = shareUrls[shareLinkOrder.secondary];

  const trigger = isValidElement(children)
    ? (() => {
        const triggerElement = children as ReactElement<{
          onClick?: (event: MouseEvent) => void;
        }>;
        return cloneElement(triggerElement, {
          onClick: (event) => {
            triggerElement.props.onClick?.(event);
            setOpen(true);
          },
        });
      })()
    : children;

  return (
    <>
      {trigger}
      {open && isLocal ? (
        <CloudUpgrade
          title={t("share.title")}
          description={t("share.cloudUpgradeDescription")}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <CoreShareDialog
        open={open && !isLocal}
        onClose={() => setOpen(false)}
        resourceType="deck"
        resourceId={deck.id}
        resourceTitle={deck.title}
        shareUrl={primaryShareLink}
        linkTabExtras={
          <ShareCopyRow
            label={t("editorToolbar.presentationLink")}
            description={t("editorToolbar.presentationLinkDescription")}
            value={secondaryShareLink}
            copyLabel={t("share.copyLink")}
            copiedLabel={t("share.copied")}
            onCopy={(value) => writeClipboardText(value)}
            className="mt-3"
          />
        }
      />
    </>
  );
}
