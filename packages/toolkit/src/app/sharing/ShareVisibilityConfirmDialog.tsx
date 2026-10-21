import { useT } from "@agent-native/core/client/i18n";
import type { ShareVisibilityTransition } from "@agent-native/core/client/sharing/useShareVisibilityTransition";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@agent-native/toolkit/ui/alert-dialog";
import { Button } from "@agent-native/toolkit/ui/button";
import type { ReactNode, RefObject } from "react";

// ShareButton's nested overlays (the picker, member suggestions) sit at
// z-[100020] over the popover (z-[2000]) and ShareDialog (z-[2010]); the
// confirmation opens from the picker, so it goes just above them.
const CONFIRM_Z_INDEX = 100030;

export interface ShareVisibilityConfirmDialogProps {
  transition: ShareVisibilityTransition;
  /**
   * What is specific to this resource, already translated by the caller, such
   * as "Everyone will also see the conversation history." Shown under the
   * generic text, which already covers messages, files and other content.
   */
  detail?: ReactNode;
  /** Gets focus back when the confirmation closes (the visibility control). */
  returnFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Asks before a resource becomes visible to the whole organization. Pair it
 * with the `transition` of a share controller; it renders nothing until a
 * broadening change is waiting, and the change is saved only by Confirm.
 */
export function ShareVisibilityConfirmDialog({
  transition,
  detail,
  returnFocusRef,
}: ShareVisibilityConfirmDialogProps) {
  const t = useT();
  const { pending, organizationName, submitting, error } = transition;
  const named = organizationName !== null;
  const values = { organization: organizationName ?? "" };
  const title = named
    ? t("agentChat.share.confirmOrganizationTitleNamed", {
        ...values,
        defaultValue: "Share with {{organization}}?",
      })
    : t("agentChat.share.confirmOrganizationTitle", {
        defaultValue: "Share with your organization?",
      });
  const description = named
    ? t("agentChat.share.confirmOrganizationDescriptionNamed", {
        ...values,
        defaultValue:
          "Everyone in {{organization}}, including new members, will be able to open this and see everything in it, including any messages, files, and other content. You can change this later.",
      })
    : t("agentChat.share.confirmOrganizationDescription", {
        defaultValue:
          "Everyone in your organization, including new members, will be able to open this and see everything in it, including any messages, files, and other content. You can change this later.",
      });
  const actionLabel = submitting
    ? t("agentChat.share.confirmOrganizationSharing", {
        defaultValue: "Sharing...",
      })
    : error
      ? t("agentChat.common.retry", { defaultValue: "Retry" })
      : t("agentChat.share.confirmOrganizationAction", {
          defaultValue: "Share with organization",
        });

  return (
    <AlertDialog
      open={pending !== null}
      onOpenChange={(open) => {
        if (!open) transition.cancel();
      }}
    >
      <AlertDialogContent
        data-agent-native-share-overlay=""
        style={{ zIndex: CONFIRM_Z_INDEX + 1 }}
        overlayStyle={{ zIndex: CONFIRM_Z_INDEX }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef?.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
          {detail ? (
            <div className="text-sm text-muted-foreground">{detail}</div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-start text-xs text-destructive"
            >
              {error}
            </div>
          ) : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>
            {t("agentChat.common.cancel", { defaultValue: "Cancel" })}
          </AlertDialogCancel>
          <Button
            type="button"
            aria-disabled={submitting || undefined}
            onClick={() => {
              void transition.confirm();
            }}
          >
            {actionLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
