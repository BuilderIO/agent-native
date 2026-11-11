import { useT } from "@agent-native/core/client/i18n";
import {
  createOnboardingCorrelationId,
  trackOnboardingEvent,
} from "@agent-native/core/client/onboarding/use-onboarding";
import {
  hasBuilderOAuthCredential,
  useBuilderConnectFlow,
  type BuilderConnectionScope,
} from "@agent-native/toolkit/app/settings";
import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BuilderConsent } from "@/components/recorder/builder-consent";
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
import {
  fetchVideoStorageStatus,
  type VideoStorageStatus,
} from "@/hooks/use-video-storage-status";

// A cancelled account creation can still finish on the server, and its late
// success should finish this card's setup; a connection made long after the
// cancel belongs to something else.
const CANCELLED_SETUP_RECOVERY_MS = 60_000;

function trackStorageStep(
  name:
    | "onboarding_step_viewed"
    | "onboarding_step_completed"
    | "onboarding_step_skipped"
    | "onboarding_method_clicked",
  properties: Record<string, unknown>,
): void {
  try {
    trackOnboardingEvent(name, { step_id: "file-storage", ...properties });
  } catch (err) {
    console.warn(`[storage-setup] ${name} tracking failed:`, err);
  }
}

export interface StorageSetupCardProps {
  onConfigured: (status?: VideoStorageStatus) => void | Promise<void>;
  onSkip?: () => void;
  title?: string;
  description?: string;
  connectedDescription?: string;
  connectSource?: string;
  connectFlow?: string;
  /**
   * The recording waiting on storage, so each step event can be tied to it:
   * the local id of a copy recorded without storage, or the server id of a
   * row waiting to finish. Omit both where no recording exists yet.
   */
  recordingAttemptId?: string;
  outputId?: string;
  /** Why the host is showing the card, recorded on every step event. */
  setupReason?: string;
}

export function StorageSetupCard({
  onConfigured,
  onSkip,
  title,
  description,
  connectedDescription = "You're all set. Starting recorder...",
  connectSource = "clips_file_upload_storage_setup_card",
  connectFlow = "file_upload",
  recordingAttemptId,
  outputId,
  setupReason,
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
  const [stepViewId] = useState(createOnboardingCorrelationId);
  // Fixed for the showing: the host's status can change while the card is up,
  // and every event under one step_view_id must agree on why it showed.
  const [viewSetupReason] = useState(setupReason);
  const stepProperties = useMemo(
    () => ({
      flow: connectSource,
      step_view_id: stepViewId,
      ...(recordingAttemptId
        ? { recording_attempt_id: recordingAttemptId }
        : {}),
      ...(outputId ? { output_id: outputId } : {}),
      ...(viewSetupReason ? { setup_reason: viewSetupReason } : {}),
    }),
    [connectSource, stepViewId, recordingAttemptId, outputId, viewSetupReason],
  );
  const stepPropertiesRef = useRef(stepProperties);
  stepPropertiesRef.current = stepProperties;
  const builderHandedOffRef = useRef(false);
  const skippedRef = useRef(false);
  const completionTrackedRef = useRef(false);
  const storageBeforeSetupRef = useRef<Promise<
    { status: VideoStorageStatus } | { error: unknown }
  > | null>(null);
  const readStorageBeforeSetup = useCallback(() => {
    storageBeforeSetupRef.current ??= fetchVideoStorageStatus({
      timeoutMs: 10_000,
    }).then(
      (status) => ({ status }),
      (error: unknown) => ({ error }),
    );
  }, []);

  // The route hosting this card can unmount it the moment the shared storage
  // status reads configured, before this card's poll sees it, so the unmount
  // path below reads the status once more and records through this too.
  // Only a change to the workspace's own storage completes this step: free
  // hosted clips also read as configured, and own storage that was already
  // there at the showing's first setup click was not set up by this card.
  // The read of storage before setup must start before any setup request
  // can, since one-request account activation can finish before a read sent
  // with it.
  const trackCompletedIfConfigured = useCallback(
    (status: VideoStorageStatus) => {
      const before = storageBeforeSetupRef.current;
      if (status.mode !== "own" || !before || completionTrackedRef.current) {
        return;
      }
      // Claimed before the wait, so reads landing together record once.
      completionTrackedRef.current = true;
      void before.then((read) => {
        if ("error" in read) {
          console.warn(
            "[storage-setup] storage before setup could not be read:",
            read.error,
          );
          return;
        }
        if (read.status.mode === "own" || skippedRef.current) return;
        const methodId = status.activeProvider?.id;
        trackStorageStep("onboarding_step_completed", {
          ...stepPropertiesRef.current,
          ...(methodId ? { method_id: methodId } : {}),
        });
      });
    },
    [],
  );

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
        const status = await fetchVideoStorageStatus({
          signal: controller.signal,
          timeoutMs: 10_000,
        });
        if (!mountedRef.current) {
          stop();
          return;
        }
        if (status.configured) {
          stop();
          setConnecting(false);
          setConnected(true);
          trackCompletedIfConfigured(status);
          clearConfiguredTimeout();
          configuredTimeoutRef.current = setTimeout(() => {
            configuredTimeoutRef.current = null;
            if (mountedRef.current) void onConfigured(status);
          }, 800);
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
  }, [
    clearConfiguredTimeout,
    onConfigured,
    stopVisibilityHandler,
    t,
    trackCompletedIfConfigured,
  ]);

  const handleBuilderConnected = useCallback(() => {
    if (!connectRequestedRef.current) return;
    const expiresAt = connectIntentExpiresAtRef.current;
    connectRequestedRef.current = false;
    connectIntentExpiresAtRef.current = null;
    if (expiresAt !== null && Date.now() > expiresAt) return;
    builderHandedOffRef.current = true;
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
  // One button: it creates the account in place when this deployment can,
  // and otherwise, or for an email that already has one, signs in.
  const createsAccount =
    builderConnect.statusResolved &&
    builderConnect.agentNativeProvisioningEnabled &&
    !hasBuilderAccount;
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
      readStorageBeforeSetup();
      connectRequestedRef.current = true;
      connectIntentExpiresAtRef.current = null;
      setStatusIssue(null);
      trackStorageStep("onboarding_method_clicked", {
        ...stepProperties,
        method_id: "builder",
      });
      builderConnect.start({
        provisionAccount,
        scope: builderConnectionScope,
      });
    },
    [
      builderConnectionScope,
      builderConnect.start,
      readStorageBeforeSetup,
      stepProperties,
    ],
  );
  const handleBuilderCancel = useCallback(() => {
    connectIntentExpiresAtRef.current =
      Date.now() + CANCELLED_SETUP_RECOVERY_MS;
    builderConnect.cancel();
  }, [builderConnect.cancel]);
  const handleSkip = useCallback(() => {
    clearConfiguredTimeout();
    skippedRef.current = true;
    trackStorageStep("onboarding_step_skipped", {
      ...stepProperties,
    });
    onSkip?.();
  }, [clearConfiguredTimeout, onSkip, stepProperties]);
  const builderConnectErrorMessage = builderConnect.error
    ? builderConnect.errorKind === "launch"
      ? t("storageSetup.builderConnectPopupError")
      : builderConnect.errorKind === "status-read"
        ? t("storageSetup.builderStatusReadError")
        : t(
            storageSetupHref
              ? "freeClips.setupFailed"
              : "storageSetup.builderConnectErrorAskAdmin",
          )
    : null;
  const builderConnecting = builderConnect.connecting;
  const builderConnectingRef = useRef(builderConnecting);
  builderConnectingRef.current = builderConnecting;
  const actionConnecting = connecting || builderConnecting;

  useEffect(() => {
    trackStorageStep("onboarding_step_viewed", {
      ...stepProperties,
    });
  }, [stepProperties]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // The route can unmount this card mid-setup: while the connect flow is
      // still connecting, or after this card accepted the connect but before
      // its storage poll saw it. After a cancel the flow keeps connecting
      // through its popup-closed grace, so crediting then relies on that grace
      // staying shorter than CANCELLED_SETUP_RECOVERY_MS.
      const setupPending =
        !completionTrackedRef.current &&
        !skippedRef.current &&
        (builderHandedOffRef.current || builderConnectingRef.current);
      if (setupPending) {
        void fetchVideoStorageStatus({ timeoutMs: 10_000 })
          .then(trackCompletedIfConfigured)
          .catch((err) => {
            console.warn("[storage-setup] completion check failed:", err);
          });
      }
      clearConfiguredTimeout();
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      stopVisibilityHandler();
    };
  }, [
    clearConfiguredTimeout,
    stopVisibilityHandler,
    trackCompletedIfConfigured,
  ]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-lg">
      <div>
        <h2 className="text-lg font-semibold">
          {title ?? t("freeClips.storageTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {connected
            ? connectedDescription
            : (description ?? t("freeClips.storageDescription"))}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {hasBuilderAccount && !connected ? (
          <p className="text-[13px] leading-[18px] text-muted-foreground">
            {t("freeClips.accountExists")}
          </p>
        ) : null}
        <Button
          type="button"
          className="w-full"
          disabled={
            actionConnecting ||
            connected ||
            !builderConnectionScope ||
            // Where accounts can be created here, a click before the status
            // loads can't tell a new account from a sign-in. Elsewhere, or
            // when the status can't load, sign-in is the path.
            (builderConnect.agentNativeProvisioningEnabled &&
              !builderConnect.statusResolved &&
              !builderConnect.statusUnavailable)
          }
          aria-busy={actionConnecting}
          data-testid="storage-setup-builder-primary"
          onClick={() => {
            readStorageBeforeSetup();
            handleBuilderConnect(createsAccount);
          }}
        >
          {actionConnecting ? <Spinner aria-hidden /> : null}
          {connected
            ? t("storageSetup.builderConnected")
            : actionConnecting
              ? t("storageSetup.waitingForBuilder")
              : hasBuilderAccount
                ? t("freeClips.signIn")
                : t("freeClips.offerDialogAction")}
        </Button>
        {createsAccount && !connected && !actionConnecting ? (
          <BuilderConsent />
        ) : null}
        {!connected && !storageSetupHref ? (
          <p className="text-center text-xs text-muted-foreground">
            {t("clipsSettings.storageAskAdmin")}
          </p>
        ) : null}
      </div>
      {builderConnect.error && (
        <p
          className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          role="alert"
        >
          <IconAlertTriangle className="size-3.5 shrink-0" aria-hidden />
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
        <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
          {t("storageSetup.builderUploadGrantMissing")}
        </p>
      ) : null}
      {statusIssue === "connect-not-allowed" ? (
        <p className="text-xs text-amber-700 dark:text-amber-400" role="alert">
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
