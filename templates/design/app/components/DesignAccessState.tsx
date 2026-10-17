import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowLeft,
  IconCheck,
  IconLock,
  IconLogin2,
  IconRefresh,
} from "@tabler/icons-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";

export type DesignAccessStatus = {
  exists: boolean;
  hasAccess: boolean;
  signedIn: boolean;
  viewerEmail: string | null;
  viewerName: string | null;
  role: string | null;
  visibility: string | null;
};

type DesignAccessStateProps = {
  accessStatus?: DesignAccessStatus;
  accessStatusError?: boolean;
  accessRequestPending?: boolean;
  accessRequestSent?: boolean;
  signInHref: string;
  onRequestAccess: () => void;
  onRetryAccessCheck: () => void;
};

export function DesignAccessState({
  accessStatus,
  accessStatusError = false,
  accessRequestPending = false,
  accessRequestSent = false,
  signInHref,
  onRequestAccess,
  onRetryAccessCheck,
}: DesignAccessStateProps) {
  const t = useT();
  const requiresSignIn = Boolean(
    accessStatus && !accessStatus.signedIn && !accessStatus.hasAccess,
  );
  const signedIn = accessStatus?.signedIn ?? false;

  return (
    <div className="relative flex min-h-dvh flex-1 items-center justify-center overflow-hidden bg-[var(--design-editor-canvas-bg)] px-6 py-12">
      <div
        aria-hidden="true"
        className="design-editor-not-found-grid absolute inset-0 opacity-60"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-px bg-[var(--design-editor-panel-divider-color)]"
      />
      <div className="relative w-full max-w-md rounded-2xl border border-border/60 bg-card/90 p-8 text-center shadow-2xl backdrop-blur-sm">
        {accessStatusError ? (
          <>
            <h1 className="text-xl font-semibold text-foreground">
              {t("common.genericError")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("designEditor.accessCheckFailed")}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={onRetryAccessCheck}
              className="mt-6 cursor-pointer gap-2"
            >
              <IconRefresh className="size-4" />
              {t("designEditor.retryAccessCheck")}
            </Button>
          </>
        ) : requiresSignIn ||
          (accessStatus?.exists && !accessStatus.hasAccess) ? (
          <>
            <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconLock className="size-5" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">
              {signedIn
                ? t("designEditor.requestAccessTitle")
                : t("designEditor.signInToRequestAccessTitle")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {signedIn
                ? accessRequestSent
                  ? t("designEditor.accessRequestSentDescription")
                  : t("designEditor.requestAccessDescription")
                : t("designEditor.signInToRequestAccessDescription")}
            </p>
            {signedIn ? (
              <Button
                type="button"
                onClick={onRequestAccess}
                disabled={accessRequestPending || accessRequestSent}
                className="mt-6 cursor-pointer gap-2"
              >
                {accessRequestSent ? <IconCheck className="size-4" /> : null}
                {accessRequestSent
                  ? t("designEditor.accessRequested")
                  : t("designEditor.requestAccess")}
              </Button>
            ) : (
              <Button asChild className="mt-6 cursor-pointer gap-2">
                <a href={signInHref}>
                  <IconLogin2 className="size-4" />
                  {t("designEditor.signInOrSignUp")}
                </a>
              </Button>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-semibold text-foreground">
              {t("designEditor.notFound")}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("designEditor.designNotFoundDescription")}
            </p>
          </>
        )}

        <Button
          asChild
          variant="ghost"
          className="mt-7 cursor-pointer gap-2 text-muted-foreground hover:text-foreground"
        >
          <Link to="/home">
            <IconArrowLeft className="size-4 rtl:-scale-x-100" />
            {t("designEditor.backToDesigns")}
          </Link>
        </Button>
      </div>
    </div>
  );
}
