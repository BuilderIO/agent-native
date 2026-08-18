import { callAction, useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { buildSignInReturnHref } from "@agent-native/core/client/ui";
import { IconAlertTriangle, IconCheck, IconLock } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import enMessages from "@/i18n/en-US";

import {
  recordingAccessApprovalContinuationPath,
  recordingAccessApprovalSessionKey,
} from "../../shared/recording-link";

interface ApprovalResult {
  ok: true;
  alreadyAllowed: boolean;
  requesterEmail: string;
  recordingId: string;
  recordingTitle: string;
  shareId: string;
  message: string;
}

type ApprovalState =
  | { kind: "loading" }
  | { kind: "sign-in" }
  | { kind: "success"; result: ApprovalResult }
  | { kind: "error"; message: string };

export function meta() {
  return [{ title: enMessages.sharePage.privateClip }];
}

export default function ApproveRecordingAccessRequestRoute() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const { session, isLoading: sessionLoading } = useSession();
  const recordingId = searchParams.get("recordingId") ?? "";
  const approvalTokenFromUrl = searchParams.get("token") ?? "";
  const approvalTokenStorageKey =
    recordingAccessApprovalSessionKey(recordingId);
  const [approvalToken, setApprovalToken] = useState(() => {
    if (approvalTokenFromUrl) return approvalTokenFromUrl;
    if (typeof window === "undefined" || !recordingId) return "";
    try {
      return sessionStorage.getItem(approvalTokenStorageKey) ?? "";
    } catch {
      // coercion-ok: unavailable tab storage is an absent continuation.
      return "";
    }
  });
  const [state, setState] = useState<ApprovalState>({ kind: "loading" });

  useEffect(() => {
    if (!recordingId) {
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

    // The email link must contain the capability, but it should not remain in
    // the address bar or be copied into the sign-in continuation URL.
    const params = new URLSearchParams(window.location.search);
    params.delete("token");
    const nextSearch = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`,
    );
  }, [approvalTokenFromUrl, approvalTokenStorageKey, recordingId]);

  const signInReturnTo = useMemo(() => {
    return recordingAccessApprovalContinuationPath(recordingId);
  }, [recordingId]);

  useEffect(() => {
    if (sessionLoading) return;

    let cancelled = false;
    if (!session?.email) {
      setState({ kind: "sign-in" });
      return () => {
        cancelled = true;
      };
    }
    if (!recordingId || !approvalToken) {
      setState({
        kind: "error",
        message: t("sharePage.accessApprovalInvalid"),
      });
      return () => {
        cancelled = true;
      };
    }

    setState({ kind: "loading" });
    void callAction<ApprovalResult>("approve-recording-access-request", {
      recordingId,
      approvalToken,
    })
      .then((result) => {
        try {
          sessionStorage.removeItem(approvalTokenStorageKey);
        } catch {
          // coercion-ok: cleanup failure cannot authorize or expose the token.
          // Session storage may be unavailable in hardened browser contexts.
        }
        if (!cancelled) setState({ kind: "success", result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : t("sharePage.accessApprovalInvalid"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    approvalToken,
    approvalTokenStorageKey,
    recordingId,
    session?.email,
    sessionLoading,
    t,
  ]);

  const signInHref = buildSignInReturnHref({ returnTo: signInReturnTo });

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
                ? t("sharePage.accessApprovalAlreadyTitle")
                : t("sharePage.accessApprovalTitle")
              : state.kind === "error"
                ? t("sharePage.accessApprovalErrorTitle")
                : state.kind === "sign-in"
                  ? t("sharePage.accessApprovalSignInTitle")
                  : t("sharePage.accessApprovalLoading")}
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
                {t("sharePage.accessApprovalSignInMessage")}
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
                  {t("sharePage.accessApprovalSignIn")}
                </a>
              </Button>
            </div>
          ) : state.kind === "error" ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <IconAlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{state.message}</span>
              </div>
              {recordingId ? (
                <Button asChild variant="outline">
                  <Link to={`/r/${encodeURIComponent(recordingId)}`}>
                    {t("sharePage.accessApprovalOpenClip")}
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
                    ? t("sharePage.accessApprovalAlreadyMessage", {
                        email: state.result.requesterEmail,
                      })
                    : t("sharePage.accessApprovalMessage", {
                        email: state.result.requesterEmail,
                      })}
                </span>
              </div>
              <Button asChild variant="outline">
                <Link to={`/r/${encodeURIComponent(state.result.recordingId)}`}>
                  {t("sharePage.accessApprovalOpenClip")}
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
