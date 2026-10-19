import { appPath } from "@agent-native/core/client/api-path";
import { useActionMutation, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { withShareLinkAttribution } from "@agent-native/core/client/sharing";
import { ShareDialog as CoreShareDialog } from "@agent-native/toolkit/app/sharing";
import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import type { Deck } from "@/context/DeckContext";

interface ShareDialogProps {
  deck: Deck;
  children?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function ShareDialog({
  deck,
  children,
  open: requestedOpen,
  onOpenChange,
}: ShareDialogProps) {
  const t = useT();
  const { session } = useSession();
  const createShareLink = useActionMutation<
    { shareToken: string },
    { deckId: string }
  >("create-share-link");
  const [open, setOpen] = useState(false);
  const [shareLink, setShareLink] = useState<{
    deckId: string;
    token: string;
  } | null>(null);
  const [creatingLink, setCreatingLink] = useState(false);

  const setDialogOpen = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange],
  );

  const shareToken =
    shareLink?.deckId === deck.id ? shareLink.token : undefined;
  const primaryShareLink = shareToken
    ? withShareLinkAttribution(
        `${typeof window === "undefined" ? "" : window.location.origin}${appPath(`/share/${shareToken}`)}`,
        "deck_share",
        session?.userId,
      )
    : undefined;
  const openShareDialog = useCallback(async () => {
    if (shareToken) {
      setDialogOpen(true);
      return;
    }
    if (creatingLink) return;

    setCreatingLink(true);
    try {
      const payload = await createShareLink.mutateAsync({ deckId: deck.id });
      if (typeof payload.shareToken !== "string" || !payload.shareToken) {
        throw new Error(t("share.createFailed"));
      }
      setShareLink({ deckId: deck.id, token: payload.shareToken });
      setDialogOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("share.createFailed"),
      );
      if (requestedOpen !== undefined) setDialogOpen(false);
    } finally {
      setCreatingLink(false);
    }
  }, [creatingLink, createShareLink, deck.id, setDialogOpen, shareToken, t]);

  useEffect(() => {
    if (requestedOpen === undefined) return;
    if (!requestedOpen) {
      setOpen(false);
      return;
    }
    if (!open) void openShareDialog();
  }, [open, openShareDialog, requestedOpen]);

  const trigger =
    children && isValidElement(children)
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
      <CoreShareDialog
        open={open}
        onClose={() => setDialogOpen(false)}
        resourceType="deck"
        resourceId={deck.id}
        title={t("share.title")}
        resourceTitle={deck.title}
        shareUrl={primaryShareLink}
      />
    </>
  );
}
