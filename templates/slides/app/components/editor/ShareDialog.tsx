import { appBasePath, appPath } from "@agent-native/core/client/api-path";
import { writeClipboardText } from "@agent-native/core/client/clipboard";
import { useT } from "@agent-native/core/client/i18n";
import { ShareDialog as CoreShareDialog } from "@agent-native/core/client/sharing";
import { ShareCopyRow } from "@agent-native/toolkit/sharing";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

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
  const [shareLink, setShareLink] = useState<{
    deckId: string;
    token: string;
  } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);

  const shareUrls = getShareUrls(deck.id);
  const shareLinkOrder = getDeckShareLinkOrder(deck.visibility);
  const shareToken =
    shareLink?.deckId === deck.id ? shareLink.token : undefined;
  const primaryShareLink = shareToken
    ? `${typeof window === "undefined" ? "" : window.location.origin}${appPath(`/share/${shareToken}`)}`
    : undefined;
  const secondaryShareLink = shareUrls[shareLinkOrder.secondary];

  const openShareDialog = useCallback(async () => {
    if (isLocal) {
      setOpen(true);
      return;
    }
    if (shareToken) {
      setOpen(true);
      return;
    }
    if (creatingLink) return;

    setCreatingLink(true);
    try {
      const response = await fetch(`${appBasePath()}/api/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deck }),
      });
      let payload: { error?: unknown; shareToken?: unknown };
      try {
        payload = (await response.json()) as {
          error?: unknown;
          shareToken?: unknown;
        };
      } catch {
        throw new Error(t("share.createFailed"));
      }
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : t("share.createFailed"),
        );
      }
      if (typeof payload.shareToken !== "string" || !payload.shareToken) {
        throw new Error(t("share.createFailed"));
      }
      setShareLink({ deckId: deck.id, token: payload.shareToken });
      setOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("share.createFailed"),
      );
    } finally {
      setCreatingLink(false);
    }
  }, [creatingLink, deck, isLocal, shareToken, t]);

  const trigger = isValidElement(children)
    ? (() => {
        const triggerElement = children as ReactElement<{
          onClick?: (event: MouseEvent) => void;
        }>;
        return cloneElement(triggerElement, {
          onClick: (event) => {
            triggerElement.props.onClick?.(event);
            if (!event.defaultPrevented) void openShareDialog();
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
