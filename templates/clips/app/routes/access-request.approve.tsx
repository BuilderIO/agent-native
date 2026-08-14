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
  const approvalToken = searchParams.get("token") ?? "";
  const [state, setState] = useState<ApprovalState>({ kind: "loading" });

  const signInReturnTo = useMemo(() => {
    const params = new URLSearchParams({
      recordingId,
      token: approvalToken,
    });
    return `/access-request/approve?${params.toString()}`;
  }, [approvalToken, recordingId]);

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
  }, [approvalToken, recordingId, session?.email, sessionLoading, t]);

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
                <a href={signInHref}>{t("sharePage.accessApprovalSignIn")}</a>
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
