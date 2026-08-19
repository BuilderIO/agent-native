import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconAt,
  IconLock,
  IconLoader2,
  IconLogin2,
  IconRefresh,
  IconUserPlus,
  IconUsersGroup,
} from "@tabler/icons-react";
import type { FormEvent } from "react";

import { Button } from "@/components/ui/button";
import type { DeckAccessStatusResponse } from "@/hooks/use-deck-access";

import { RequestDeckAccessDialog } from "./RequestDeckAccessDialog";

export function MissingDeckAccessPane({
  accessStatus,
  accessStatusError,
  accessStatusLoading,
  hasTeamJoinOption,
  orgLoading,
  orgError,
  requestAccessPending,
  accessRequestSent,
  accessRequestNotified,
  requestAccessDialogOpen,
  requesterEmail,
  requestAccessDialogError,
  signedIn,
  signInHref,
  viewerEmail,
  refreshing,
  onRequestAccess,
  onRequestAccessDialogOpenChange,
  onRequesterEmailChange,
  onSubmitGuestAccessRequest,
  onSignIn,
  onRetry,
  onBack,
}: {
  accessStatus: DeckAccessStatusResponse | null;
  accessStatusError: boolean;
  accessStatusLoading: boolean;
  hasTeamJoinOption: boolean;
  orgLoading: boolean;
  orgError: boolean;
  requestAccessPending: boolean;
  accessRequestSent: boolean;
  accessRequestNotified: boolean;
  requestAccessDialogOpen: boolean;
  requesterEmail: string;
  requestAccessDialogError: string | null;
  signedIn: boolean;
  signInHref: string;
  viewerEmail: string | null;
  refreshing: boolean;
  onRequestAccess: () => void;
  onRequestAccessDialogOpenChange: (open: boolean) => void;
  onRequesterEmailChange: (email: string) => void;
  onSubmitGuestAccessRequest: (event: FormEvent<HTMLFormElement>) => void;
  onSignIn: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const privateDeck = Boolean(
    accessStatus?.exists &&
    !accessStatus.hasAccess &&
    accessStatus.visibility === "private",
  );
  const accessCheckFailed = accessStatusError || orgError;
  const noAccess = privateDeck || accessCheckFailed;
  const checkingAccess = !noAccess && (accessStatusLoading || orgLoading);
  const Icon =
    noAccess || (!hasTeamJoinOption && !checkingAccess)
      ? IconLock
      : IconUsersGroup;
  const title = checkingAccess
    ? t("deckEditor.lookingForDeck")
    : noAccess
      ? t("deckEditor.privateDeckTitle")
      : hasTeamJoinOption
        ? t("deckEditor.joinTeamToOpen")
        : t("deckEditor.deckUnavailable");
  const description = checkingAccess
    ? t("deckEditor.checkingSharedAccess")
    : noAccess
      ? t("deckEditor.privateDeckDescription")
      : hasTeamJoinOption
        ? t("deckEditor.joinTeamDescription")
        : t("deckEditor.deckUnavailableDescription");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-foreground">{title}</h1>
          </div>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
        {noAccess && viewerEmail ? (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
            <IconAt className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-muted-foreground">
              {t("deckEditor.signedInAs")}{" "}
              <span className="font-medium text-foreground">{viewerEmail}</span>
            </span>
          </div>
        ) : null}
        {noAccess && accessRequestSent ? (
          <div className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {t(
              accessRequestNotified
                ? "deckEditor.accessRequestSentDescription"
                : "deckEditor.accessRequestRecordedDescription",
            )}
          </div>
        ) : null}
        <div className="mt-5 flex flex-col gap-2">
          {noAccess && !signedIn ? (
            <>
              <Button type="button" onClick={onSignIn}>
                <IconLogin2 className="size-4" />
                {t("deckEditor.signInToRequestAccess")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onRequestAccessDialogOpenChange(true)}
                disabled={requestAccessPending || accessRequestSent}
              >
                <IconUserPlus className="size-4" />
                {accessRequestSent
                  ? t("deckEditor.accessRequestSent")
                  : t("deckEditor.requestAccess")}
              </Button>
            </>
          ) : noAccess ? (
            <Button
              type="button"
              onClick={onRequestAccess}
              disabled={requestAccessPending || accessRequestSent}
            >
              {requestAccessPending ? (
                <IconLoader2 className="size-4 animate-spin" />
              ) : (
                <IconUserPlus className="size-4" />
              )}
              {requestAccessPending
                ? t("deckEditor.requestAccessPending")
                : accessRequestSent
                  ? t("deckEditor.accessRequestSent")
                  : t("deckEditor.requestAccess")}
            </Button>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onBack}>
              <IconArrowLeft className="size-4" />
              {t("deckEditor.backToDecks")}
            </Button>
            <Button
              type="button"
              variant={noAccess ? "ghost" : "default"}
              onClick={onRetry}
              disabled={refreshing || checkingAccess}
            >
              <IconRefresh
                className={refreshing ? "size-4 animate-spin" : "size-4"}
              />
              {t("deckEditor.tryAgain")}
            </Button>
          </div>
        </div>
      </div>
      {noAccess && !signedIn ? (
        <RequestDeckAccessDialog
          open={requestAccessDialogOpen}
          onOpenChange={onRequestAccessDialogOpenChange}
          signInHref={signInHref}
          email={requesterEmail}
          onEmailChange={onRequesterEmailChange}
          onSubmit={onSubmitGuestAccessRequest}
          isSubmitting={requestAccessPending}
          error={requestAccessDialogError}
        />
      ) : null}
    </div>
  );
}
