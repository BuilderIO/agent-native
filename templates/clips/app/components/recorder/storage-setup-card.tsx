import { agentNativePath } from "@agent-native/core/client/api-path";
import { useT } from "@agent-native/core/client/i18n";
import {
  BuilderConnectPopover,
  hasBuilderOAuthCredential,
  useBuilderConnectFlow,
  type BuilderConnectionScope,
} from "@agent-native/toolkit/app/settings";
import { readFileUploadStatus } from "@shared/file-upload-status";
import { IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { StorageStatusRetry } from "@/components/recorder/storage-status-retry";
import { useStorageSetupHref } from "@/components/settings/settings-links";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// A cancelled account creation can still finish on the server, and its late
// success should finish this card's setup; a connection made long after the
// cancel belongs to something else.
const CANCELLED_SETUP_RECOVERY_MS = 60_000;

export interface StorageSetupCardProps {
  onConfigured: () => void | Promise<void>;
  onSkip?: () => void;
  title?: string;
  description?: string;
  connectedDescription?: string;
  connectSource?: string;
  connectFlow?: string;
  /**
   * Open the S3 settings form in a new tab so the page holding an unsaved
   * recording never navigates away.
   */
  openSettingsInNewTab?: boolean;
}

export function StorageSetupCard({
  onConfigured,
  onSkip,
  title = "Connect storage",
  description,
  connectedDescription = "You're all set. Starting recorder...",
  connectSource = "clips_file_upload_storage_setup_card",
  connectFlow = "file_upload",
  openSettingsInNewTab = false,
}: StorageSetupCardProps) {
  const t = useT();
  const storageSetupHref = useStorageSetupHref();
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [statusIssue, setStatusIssue] = useState<
    "unavailable" | "upload-grant-missing" | "connect-not-allowed" | null
  >(null);
  const [retryingBuilderStatus, setRetryingBuilderStatus] = useState(false);
  const retryingBuilderStatusAtCountRef = useRef<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const configuredTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const visibilityHandlerRef = useRef<(() => void) | null>(null);
  const connectRequestedRef = useRef(false);
  const connectIntentExpiresAtRef = useRef<number | null>(null);

  const clearConfiguredTimeout = useCallback(() => {
    if (configuredTimeoutRef.current !== null) {
      clearTimeout(configuredTimeoutRef.current);
      configuredTimeoutRef.current = null;
    }
  }, []);

  const stopVisibilityHandler = useCallback(() => {
    if (visibilityHandlerRef.current) {
      document.removeEventListener(
        "visibilitychange",
        visibilityHandlerRef.current,
      );
      visibilityHandlerRef.current = null;
    }
  }, []);

  const startFileUploadPoll = useCallback(() => {
    clearConfiguredTimeout();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    stopVisibilityHandler();
    inFlightRef.current = false;
    setConnecting(true);
    setErr(null);
    setStatusIssue(null);

    const start = Date.now();
    const timeoutMs = 5 * 60 * 1000;
    const stop = () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      stopVisibilityHandler();
    };
    const showTimeout = (): void => {
      if (!mountedRef.current || Date.now() - start <= timeoutMs) return;
      stop();
      setConnecting(false);
      setErr(t("storageSetup.builderTimeout"));
    };
    const tick = async () => {
      if (document.hidden || inFlightRef.current) return;
      inFlightRef.current = true;
      const controller = new AbortController();
      const abortTimer = setTimeout(
        () => controller.abort(),
        Math.max(10_000, 2000 * 4),
      );
      try {
        const r = await fetch(
          new URL(
            agentNativePath("/_agent-native/file-upload/status"),
            window.location.origin,
          ).toString(),
          { signal: controller.signal },
        );
        if (!r.ok) {
          stop();
          setConnecting(false);
          setStatusIssue("unavailable");
          return;
        }
        const status = await readFileUploadStatus(r);
        if (!mountedRef.current) {
          stop();
          return;
        }
        if (status.state === "configured") {
          stop();
          setConnecting(false);
          setConnected(true);
          clearConfiguredTimeout();
          configuredTimeoutRef.current = setTimeout(() => {
            configuredTimeoutRef.current = null;
            if (mountedRef.current) void onConfigured();
          }, 800);
        } else if (status.state === "unavailable") {
          stop();
          setConnecting(false);
          setStatusIssue("unavailable");
        } else if (status.builderReauthorizationRequired) {
          stop();
          setConnecting(false);
          setStatusIssue("upload-grant-missing");
        } else {
          showTimeout();
        }
      } catch {
        if (!mountedRef.current) return;
        stop();
        setConnecting(false);
        setStatusIssue("unavailable");
      } finally {
        clearTimeout(abortTimer);
        inFlightRef.current = false;
      }
    };
    pollRef.current = setInterval(() => void tick(), 2000);
    visibilityHandlerRef.current = () => {
      if (!document.hidden) void tick();
    };
    document.addEventListener("visibilitychange", visibilityHandlerRef.current);
  }, [clearConfiguredTimeout, onConfigured, stopVisibilityHandler, t]);

  const handleBuilderConnected = useCallback(() => {
    if (!connectRequestedRef.current) return;
    const expiresAt = connectIntentExpiresAtRef.current;
    connectRequestedRef.current = false;
    connectIntentExpiresAtRef.current = null;
    if (expiresAt !== null && Date.now() > expiresAt) return;
    startFileUploadPoll();
  }, [startFileUploadPoll]);

  const builderConnect = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: connectSource,
    trackingFlow: connectFlow,
    onConnected: handleBuilderConnected,
  });
  const hasBuilderAccount =
    builderConnect.accountExists || hasBuilderOAuthCredential(builderConnect);
  const builderConnectionScope: BuilderConnectionScope | null =
    builderConnect.effective === "org" && builderConnect.canConnect.org
      ? "org"
      : builderConnect.effective === "personal" &&
          builderConnect.canConnect.personal
        ? "personal"
        : builderConnect.canConnect.org
          ? "org"
          : builderConnect.canConnect.personal
            ? "personal"
            : null;
  useEffect(() => {
    const startedAt = retryingBuilderStatusAtCountRef.current;
    if (
      startedAt !== null &&
      builderConnect.statusReadSettledCount > startedAt
    ) {
      retryingBuilderStatusAtCountRef.current = null;
      setRetryingBuilderStatus(false);
    }
  }, [builderConnect.statusReadSettledCount]);
  const retryBuilderStatus = useCallback(() => {
    retryingBuilderStatusAtCountRef.current =
      builderConnect.statusReadSettledCount;
    setRetryingBuilderStatus(true);
    if (!builderConnect.retry()) {
      retryingBuilderStatusAtCountRef.current = null;
      setRetryingBuilderStatus(false);
    }
  }, [builderConnect.retry, builderConnect.statusReadSettledCount]);
  const handleBuilderConnect = useCallback(
    (provisionAccount: boolean) => {
      if (!builderConnectionScope) {
        setStatusIssue("connect-not-allowed");
        return;
      }
      connectRequestedRef.current = true;
      connectIntentExpiresAtRef.current = null;
      setStatusIssue(null);
      builderConnect.start({
        provisionAccount,
        scope: builderConnectionScope,
      });
    },
    [builderConnectionScope, builderConnect.start],
  );
  const handleBuilderCancel = useCallback(() => {
    connectIntentExpiresAtRef.current =
      Date.now() + CANCELLED_SETUP_RECOVERY_MS;
    builderConnect.cancel();
  }, [builderConnect.cancel]);
  const handleSkip = useCallback(() => {
    clearConfiguredTimeout();
    onSkip?.();
  }, [clearConfiguredTimeout, onSkip]);
  const builderConnectErrorMessage = builderConnect.error
    ? builderConnect.errorKind === "launch"
      ? t("storageSetup.builderConnectPopupError")
      : builderConnect.errorKind === "status-read"
        ? t("storageSetup.builderStatusReadError")
        : t(
            storageSetupHref
              ? "storageSetup.builderConnectError"
              : "storageSetup.builderConnectErrorAskAdmin",
          )
    : null;
  const builderConnecting = builderConnect.connecting;
  const actionConnecting = connecting || builderConnecting;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearConfiguredTimeout();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      stopVisibilityHandler();
    };
  }, [clearConfiguredTimeout, stopVisibilityHandler]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-lg">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {connected
            ? connectedDescription
            : (description ?? t("storageSetup.description"))}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {/* The consent popover is this card's only path to a new account.
            Its Cancel is left out because the card's own Cancel must also
            drop the pending connect before storage polling starts. */}
        <BuilderConnectPopover
          flow={{
            ...builderConnect,
            accountExists: hasBuilderAccount,
            cancel: undefined,
          }}
          onConnect={handleBuilderConnect}
        >
          <Button
            type="button"
            className="w-full"
            disabled={actionConnecting || connected || !builderConnectionScope}
            data-testid="storage-setup-builder-primary"
          >
            {actionConnecting ? <Spinner aria-hidden /> : null}
            {connected
              ? t("storageSetup.builderConnected")
              : actionConnecting
                ? t("storageSetup.waitingForBuilder")
                : t("agentChat.setup.connectBuilder")}
          </Button>
        </BuilderConnectPopover>
        {!connected && storageSetupHref ? (
          <>
            <Button asChild variant="secondary" className="w-full">
              <a
                href={storageSetupHref}
                {...(openSettingsInNewTab
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {t("settings.s3Title")}
              </a>
            </Button>
          </>
        ) : null}
        {!connected && !storageSetupHref ? (
          <p className="text-center text-xs text-muted-foreground">
            {t("clipsSettings.storageAskAdmin")}
          </p>
        ) : null}
      </div>
      {builderConnect.error && (
        <p className="text-xs text-destructive" role="alert">
          {builderConnectErrorMessage}
        </p>
      )}
      {builderConnect.statusResolved &&
      !builderConnectionScope &&
      !builderConnect.error ? (
        <p className="text-xs text-muted-foreground" role="alert">
          {t("storageSetup.builderGrantAskAdmin")}
        </p>
      ) : null}
      {builderConnect.errorKind === "status-read" && builderConnect.error && (
        <button
          type="button"
          aria-busy={retryingBuilderStatus}
          disabled={retryingBuilderStatus}
          className="text-xs text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={retryBuilderStatus}
        >
          {retryingBuilderStatus ? (
            <span className="inline-flex items-center gap-1.5">
              <IconLoader2 className="h-3 w-3 animate-spin" aria-hidden />
              {t("storageSetup.checkingBuilderConnection")}
            </span>
          ) : (
            t("meetingDetail.retry")
          )}
        </button>
      )}
      {builderConnecting && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="storage-setup-builder-cancel"
          className="self-end text-xs font-normal text-muted-foreground"
          onClick={handleBuilderCancel}
        >
          {t("common.cancel")}
        </Button>
      )}

      {err && <p className="text-xs text-muted-foreground">{err}</p>}
      {statusIssue === "unavailable" ? (
        <StorageStatusRetry onRetry={startFileUploadPoll} />
      ) : null}
      {statusIssue === "upload-grant-missing" ? (
        <p className="text-xs text-destructive" role="alert">
          {t("storageSetup.builderUploadGrantMissing")}
        </p>
      ) : null}
      {statusIssue === "connect-not-allowed" ? (
        <p className="text-xs text-destructive" role="alert">
          {t("storageSetup.builderGrantAskAdmin")}
        </p>
      ) : null}

      {onSkip ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-center text-muted-foreground"
          onClick={handleSkip}
        >
          {t("agentChat.onboarding.skipForNow")}
        </Button>
      ) : null}

      {!connected && (
        <TooltipProvider delayDuration={150}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="self-start text-xs text-muted-foreground underline decoration-muted-foreground/50 decoration-dotted underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                {t("storageSetup.whyPrompt")}
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-80 whitespace-normal text-xs leading-relaxed"
            >
              {t("storageSetup.whyDescription")}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
