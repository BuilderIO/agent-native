import { appPath } from "@agent-native/core/client/api-path";
import {
  useActionMutation,
  useActionQuery,
  useSession,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/sign-in-return";
import { IconAlertTriangle, IconCheck, IconLock } from "@tabler/icons-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import enMessages from "@/i18n/en-US";

import {
  DECK_ACCESS_REQUEST_ROLES,
  deckAccessApprovalContinuationPath,
  deckAccessApprovalSessionKey,
  type DeckAccessRequestRole,
} from "../../shared/deck-access";

interface AccessRequestReview {
  deckId: string;
  deckTitle: string;
  requesterEmail: string;
  requesterName: string | null;
  note: string | null;
  requestedRole: DeckAccessRequestRole;
  granted: boolean;
}

interface ApprovalResult {
  ok: true;
  alreadyAllowed: boolean;
  requesterEmail: string;
  deckId: string;
  deckTitle: string;
  shareId: string;
  role: string;
  /** `null` when no email provider is configured; absent on repeat approvals. */
  requesterNotified?: boolean | null;
  message: string;
}

type ApprovalState =
  | { kind: "loading" }
  | { kind: "sign-in" }
  | { kind: "review"; review: AccessRequestReview }
  | { kind: "granted"; review: AccessRequestReview }
  | { kind: "success"; result: ApprovalResult }
  | { kind: "error"; message: string };

export function meta() {
  return [{ title: enMessages.deckEditor.privateDeckTitle }];
}

export default function ApproveDeckAccessRequestRoute() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const { session, isLoading: sessionLoading } = useSession();
  const deckId = searchParams.get("deckId") ?? "";
  const approvalTokenFromUrl = searchParams.get("token") ?? "";
  const approvalTokenStorageKey = deckAccessApprovalSessionKey(deckId);
  const [approvalToken, setApprovalToken] = useState(
    () => approvalTokenFromUrl ?? "",
  );

  useEffect(() => {
    if (approvalTokenFromUrl || !deckId) return;
    try {
      const stored = sessionStorage.getItem(approvalTokenStorageKey);
      if (stored) setApprovalToken(stored);
      // Unavailable tab storage is an absent continuation: the page then asks
      // for the token rather than silently continuing without one.
      // coercion-ok: the absent case is visible to the user, not swallowed.
    } catch {}
  }, [approvalTokenFromUrl, deckId, approvalTokenStorageKey]);
  useEffect(() => {
    if (!deckId) {
      setApprovalToken("");
      return;
    }
    if (!approvalTokenFromUrl) {
      try {
        setApprovalToken(sessionStorage.getItem(approvalTokenStorageKey) ?? "");
      } catch {
        setApprovalToken("");
      }
      return;
    }
    try {
      sessionStorage.setItem(approvalTokenStorageKey, approvalTokenFromUrl);
    } catch {
      // coercion-ok: never fall back to putting the bearer token in the URL.
      // Session storage may be unavailable in hardened browser contexts.
    }
    setApprovalToken(approvalTokenFromUrl);

    const params = new URLSearchParams(window.location.search);
    params.delete("token");
    const nextSearch = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }, [approvalTokenFromUrl, approvalTokenStorageKey, deckId]);

  const signedIn = Boolean(session?.email);
  const reviewQuery = useActionQuery<AccessRequestReview>(
    "get-deck-access-request",
    { deckId, approvalToken },
    { enabled: signedIn && Boolean(deckId && approvalToken), retry: false },
  );
  const approve = useActionMutation<
    ApprovalResult,
    { deckId: string; approvalToken: string; role: DeckAccessRequestRole }
  >("approve-deck-access-request");
  const [pickedRole, setPickedRole] = useState<DeckAccessRequestRole | null>(
    null,
  );
  const review = reviewQuery.data;
  const role = pickedRole ?? review?.requestedRole ?? "viewer";

  const state: ApprovalState = sessionLoading
    ? { kind: "loading" }
    : !signedIn
      ? { kind: "sign-in" }
      : !deckId || !approvalToken
        ? { kind: "error", message: t("deckEditor.accessApprovalInvalid") }
        : approve.data
          ? { kind: "success", result: approve.data }
          : approve.error || reviewQuery.error
            ? {
                kind: "error",
                message:
                  (approve.error ?? reviewQuery.error)?.message ||
                  t("deckEditor.accessApprovalInvalid"),
              }
            : review?.granted
              ? { kind: "granted", review }
              : review
                ? { kind: "review", review }
                : { kind: "loading" };

  const allowAccess = () => {
    if (!review) return;
    approve.mutate(
      { deckId, approvalToken, role },
      {
        onSuccess: () => {
          try {
            sessionStorage.removeItem(approvalTokenStorageKey);
          } catch {
            // coercion-ok: cleanup failure cannot authorize or expose the token.
            // Session storage may be unavailable in hardened browser contexts.
          }
        },
      },
    );
  };

  const signInReturnTo = useMemo(
    () => deckAccessApprovalContinuationPath(deckId),
    [deckId],
  );
  const signInHref = buildSignInReturnHref({
    returnTo: appPath(signInReturnTo),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <IconLock
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
            {state.kind === "success"
              ? state.result.alreadyAllowed
                ? t("deckEditor.accessApprovalAlreadyTitle")
                : t("deckEditor.accessApprovalTitle")
              : state.kind === "granted"
                ? t("deckEditor.accessApprovalAlreadyTitle")
                : state.kind === "error"
                  ? t("deckEditor.accessApprovalErrorTitle")
                  : state.kind === "sign-in"
                    ? t("deckEditor.accessApprovalSignInTitle")
                    : t("deckEditor.accessApprovalReviewTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent aria-live="polite">
          {state.kind === "loading" ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ) : state.kind === "sign-in" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("deckEditor.accessApprovalSignInMessage")}
              </p>
              <Button asChild>
                <a
                  href={signInHref}
                  onClick={() => {
                    if (!approvalToken) return;
                    try {
                      sessionStorage.setItem(
                        approvalTokenStorageKey,
                        approvalToken,
                      );
                    } catch {
                      // coercion-ok: never fall back to putting the bearer token in the URL.
                      // Session storage may be unavailable in hardened browser contexts.
                    }
                  }}
                >
                  {t("deckEditor.accessApprovalSignIn")}
                </a>
              </Button>
            </div>
          ) : state.kind === "review" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t(
                  state.review.requestedRole === "editor"
                    ? "deckEditor.accessApprovalRequestedEdit"
                    : "deckEditor.accessApprovalRequestedView",
                  {
                    email: state.review.requesterEmail,
                    title: state.review.deckTitle,
                  },
                )}
              </p>
              {state.review.note ? (
                <blockquote className="whitespace-pre-wrap break-words border-s-2 border-border ps-3 text-sm text-foreground">
                  {state.review.note}
                </blockquote>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={role}
                  onValueChange={(value) => {
                    const next = DECK_ACCESS_REQUEST_ROLES.find(
                      (candidate) => candidate === value,
                    );
                    if (next) setPickedRole(next);
                  }}
                  disabled={approve.isPending}
                >
                  <SelectTrigger
                    className="w-auto"
                    aria-label={t("deckEditor.accessApprovalRoleLabel")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">
                      {t("deckEditor.accessApprovalRoleViewer")}
                    </SelectItem>
                    <SelectItem value="editor">
                      {t("deckEditor.accessApprovalRoleEditor")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button onClick={allowAccess} disabled={approve.isPending}>
                  {t("deckEditor.accessApprovalAllow")}
                </Button>
              </div>
            </div>
          ) : state.kind === "granted" ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("deckEditor.accessApprovalAlreadyMessage", {
                  email: state.review.requesterEmail,
                })}
              </p>
              <Button asChild variant="outline">
                <Link to={`/deck/${encodeURIComponent(state.review.deckId)}`}>
                  {t("deckEditor.accessApprovalOpenDeck")}
                </Link>
              </Button>
            </div>
          ) : state.kind === "error" ? (
            <div className="space-y-4">
              <ErrorNotice>{state.message}</ErrorNotice>
              {deckId ? (
                <Button asChild variant="outline">
                  <Link to={`/deck/${encodeURIComponent(deckId)}`}>
                    {t("deckEditor.accessApprovalOpenDeck")}
                  </Link>
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                <IconCheck
                  className="mt-0.5 size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span>
                  {state.result.alreadyAllowed
                    ? t("deckEditor.accessApprovalAlreadyMessage", {
                        email: state.result.requesterEmail,
                      })
                    : t(
                        state.result.role === "editor"
                          ? "deckEditor.accessApprovalEditorMessage"
                          : "deckEditor.accessApprovalViewerMessage",
                        { email: state.result.requesterEmail },
                      )}
                  {state.result.requesterNotified === true
                    ? ` ${t("deckEditor.accessApprovalRequesterEmailed")}`
                    : null}
                </span>
              </div>
              {state.result.requesterNotified === false ? (
                <ErrorNotice>
                  {t("deckEditor.accessApprovalRequesterEmailFailed", {
                    email: state.result.requesterEmail,
                  })}
                </ErrorNotice>
              ) : null}
              <Button asChild variant="outline">
                <Link to={`/deck/${encodeURIComponent(state.result.deckId)}`}>
                  {t("deckEditor.accessApprovalOpenDeck")}
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <IconAlertTriangle
        className="mt-0.5 size-4 shrink-0"
        aria-hidden="true"
      />
      <span>{children}</span>
    </div>
  );
}
