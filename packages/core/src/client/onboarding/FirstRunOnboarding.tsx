import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  IconArrowRight,
  IconCheck,
  IconInfoCircle,
  IconKey,
  IconLoader2,
  IconX,
} from "@tabler/icons-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router";

import {
  buildSettingsRoute,
  STANDARD_APP_ROUTES,
} from "../../navigation/index.js";
import type {
  OnboardingAppProfile,
  OnboardingCapability,
} from "../../onboarding/types.js";
import { appMountedPath } from "../api-path.js";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../components/ui/tooltip.js";
import { useT } from "../i18n.js";
import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import { cn } from "../utils.js";
import { resolveFirstRunOnboardingMode } from "./first-run-enabled.js";
import { listFirstRunOnboardingExtensions } from "./first-run-registry.js";
import { saveFirstRunOnboardingRole } from "./first-run-status.js";
import { trackOnboardingEvent, useOnboarding } from "./use-onboarding.js";
import {
  ONBOARDING_PREVIEW_QUERY_PARAM,
  ONBOARDING_PREVIEW_STEP_QUERY_PARAM,
  useOnboardingPreviewMode,
  useOnboardingPreviewStep,
} from "./use-preview-mode.js";

type FirstRunScreen = "choice" | "role" | "connecting" | "extension";
type FirstRunSetupMethodId =
  | "builder_create_account"
  | "builder_sign_in"
  | "custom_keys"
  | "skip_to_app";

interface FirstRunSetupAttempt {
  id: string;
  methodId: FirstRunSetupMethodId;
  outcomeTracked: boolean;
}

function trackFirstRunSetupOutcome(
  attempt: FirstRunSetupAttempt | null,
  outcome:
    | "connected"
    | "already_connected"
    | "failed"
    | "settings_opened"
    | "skipped_to_app"
    | "handoff_failed",
  errorType?: string,
) {
  if (!attempt || attempt.outcomeTracked) return;
  attempt.outcomeTracked = true;
  trackOnboardingEvent("onboarding_method_outcome", {
    flow: "first_run",
    step_id: "choice",
    method_id: attempt.methodId,
    onboarding_attempt_id: attempt.id,
    outcome,
    ...(errorType ? { error_type: errorType } : {}),
  });
}

const FIRST_RUN_SCREEN_ORDER: readonly Exclude<FirstRunScreen, "extension">[] =
  ["role", "choice", "connecting"];

function firstRunStepProperties(
  screen: FirstRunScreen,
  extensions: readonly { id: string }[],
  extensionIndex: number,
): Record<string, unknown> {
  if (screen === "extension") {
    return {
      flow: "first_run",
      step_id: `extension:${extensions[extensionIndex]?.id ?? "unknown"}`,
      step_index: FIRST_RUN_SCREEN_ORDER.length + extensionIndex,
      ...(extensions[extensionIndex]
        ? { extension_id: extensions[extensionIndex].id }
        : {}),
    };
  }
  return {
    flow: "first_run",
    step_id: screen,
    step_index: FIRST_RUN_SCREEN_ORDER.indexOf(screen),
  };
}

const FIRST_RUN_ROLE_OPTIONS = [
  { value: "design", labelKey: "agentChat.onboarding.roleDesign" },
  { value: "developer", labelKey: "agentChat.onboarding.roleDeveloper" },
  { value: "product", labelKey: "agentChat.onboarding.roleProduct" },
  { value: "marketing", labelKey: "agentChat.onboarding.roleMarketing" },
  { value: "sales", labelKey: "agentChat.onboarding.roleSales" },
  { value: "ops", labelKey: "agentChat.onboarding.roleOps" },
  {
    value: "individual",
    labelKey: "agentChat.onboarding.roleIndividual",
  },
  { value: "other", labelKey: "agentChat.onboarding.roleOther" },
] as const;

const BUILDER_MORE_SERVICES = [
  "Voice input",
  "Background agents",
  "Image generation",
  "Video generation",
  "Connected agents",
  "Hosting and deployment",
  "Browser automation",
  "Embeddings",
] as const;

export interface FirstRunOnboardingProps {
  /** The shared startup gate has already resolved this account as eligible. */
  initialFirstRun?: boolean;
}

export function FirstRunOnboarding({
  initialFirstRun = false,
}: FirstRunOnboardingProps = {}) {
  const t = useT();
  const connectFirstRun = resolveFirstRunOnboardingMode() === "connect";
  const { pathname } = useLocation();
  const previewMode = useOnboardingPreviewMode();
  const previewStep = useOnboardingPreviewStep();
  const {
    firstRun,
    loading,
    error,
    profile,
    completeFirstRun,
    completeFirstRunError,
  } = useOnboarding({ preview: previewMode, initialFirstRun });
  const [screen, setScreen] = useState<FirstRunScreen>(() =>
    previewStep === "references" ? "extension" : (previewStep ?? "role"),
  );
  const [extensionIndex, setExtensionIndex] = useState(0);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [customRole, setCustomRole] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaveError, setRoleSaveError] = useState<string | null>(null);
  const [builderConnectionMode, setBuilderConnectionMode] = useState<
    "existing" | "provision"
  >("existing");
  const extensions = useMemo(() => listFirstRunOnboardingExtensions(), []);
  useEffect(() => {
    if (!previewMode || !previewStep) return;
    setScreen(previewStep === "references" ? "extension" : previewStep);
  }, [previewMode, previewStep]);
  // completeFirstRun() rejects on failure — swallow it here so a Skip/
  // Continue click never becomes an unhandled rejection; completeFirstRunError
  // (rendered below) is the real signal, and the user stays on this screen
  // to retry instead of being bounced to an unrelated error screen.
  const trackFirstRunStepCompleted = useCallback(
    (stepScreen: FirstRunScreen, stepExtensionIndex = extensionIndex) => {
      if (previewMode) return;
      trackOnboardingEvent(
        "onboarding_step_completed",
        firstRunStepProperties(stepScreen, extensions, stepExtensionIndex),
      );
    },
    [extensionIndex, extensions, previewMode],
  );
  const trackFirstRunStepSkipped = useCallback(
    (
      stepScreen: FirstRunScreen,
      reason = "user_action",
      stepExtensionIndex = extensionIndex,
    ) => {
      if (previewMode) return;
      trackOnboardingEvent("onboarding_step_skipped", {
        ...firstRunStepProperties(stepScreen, extensions, stepExtensionIndex),
        reason,
      });
    },
    [extensionIndex, extensions, previewMode],
  );
  const completionAttemptRef = useRef<{
    screen: FirstRunScreen | null;
    extensionIndex: number;
    onSuccess?: () => void;
  } | null>(null);
  const completionInFlightRef = useRef(false);
  const onboardingTerminalRef = useRef(false);
  const abandonmentTrackedRef = useRef(false);
  const builderSetupAttemptRef = useRef<FirstRunSetupAttempt | null>(null);
  const pendingHandoffFailureRef = useRef<FirstRunSetupAttempt | null>(null);
  const flushPendingHandoffFailure = useCallback(() => {
    const attempt = pendingHandoffFailureRef.current;
    if (!attempt) return;
    pendingHandoffFailureRef.current = null;
    trackFirstRunSetupOutcome(
      attempt,
      "handoff_failed",
      "onboarding_completion_error",
    );
  }, []);
  const startSetupMethod = useCallback(
    (
      methodId: FirstRunSetupMethodId,
      methodKind: "builder" | "manual" | "skip",
    ) => {
      if (previewMode || typeof window === "undefined") return null;
      flushPendingHandoffFailure();
      const attempt = {
        id: window.crypto.randomUUID(),
        methodId,
        outcomeTracked: false,
      };
      if (methodKind !== "builder") {
        pendingHandoffFailureRef.current = attempt;
      }
      const properties = {
        flow: "first_run",
        step_id: "choice",
        method_id: methodId,
        method_kind: methodKind,
        onboarding_attempt_id: attempt.id,
      };
      trackOnboardingEvent("onboarding_method_clicked", properties);
      trackOnboardingEvent("onboarding_method_started", properties);
      return attempt;
    },
    [flushPendingHandoffFailure, previewMode],
  );
  const finishOnboarding = useCallback(
    async (
      completedScreen: FirstRunScreen | null,
      completedExtensionIndex = extensionIndex,
      onSuccess?: () => void,
    ) => {
      completionAttemptRef.current = {
        screen: completedScreen,
        extensionIndex: completedExtensionIndex,
        ...(onSuccess ? { onSuccess } : {}),
      };
      completionInFlightRef.current = true;
      let onSuccessAfterCompletion: (() => void) | undefined;
      try {
        await completeFirstRun();
        if (completedScreen) {
          trackFirstRunStepCompleted(completedScreen, completedExtensionIndex);
        }
        onboardingTerminalRef.current = true;
        onSuccessAfterCompletion = completionAttemptRef.current?.onSuccess;
        completionAttemptRef.current = null;
      } catch {
        // coercion-ok: completeFirstRun exposes this failure as the inline retry state.
        return false;
      } finally {
        completionInFlightRef.current = false;
      }
      onSuccessAfterCompletion?.();
      return true;
    },
    [completeFirstRun, extensionIndex, trackFirstRunStepCompleted],
  );
  useEffect(() => {
    if (!previewMode && firstRun && !loading && profile) {
      trackOnboardingEvent("onboarding_started", { flow: "first_run" });
    }
  }, [firstRun, loading, previewMode, profile]);
  useEffect(() => {
    if (previewMode || !firstRun || loading || !profile) return;
    const step = firstRunStepProperties(screen, extensions, extensionIndex);
    trackOnboardingEvent("onboarding_step_viewed", step);
  }, [
    extensionIndex,
    extensions,
    firstRun,
    loading,
    previewMode,
    profile,
    screen,
  ]);
  useEffect(() => {
    if (previewMode || !firstRun || loading || !profile) return;
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      if (
        onboardingTerminalRef.current ||
        abandonmentTrackedRef.current ||
        completionInFlightRef.current
      )
        return;
      abandonmentTrackedRef.current = true;
      flushPendingHandoffFailure();
      trackOnboardingEvent("onboarding_abandoned", {
        ...firstRunStepProperties(screen, extensions, extensionIndex),
        reason: "page_exit",
      });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [
    extensionIndex,
    extensions,
    firstRun,
    loading,
    previewMode,
    profile,
    screen,
    flushPendingHandoffFailure,
  ]);
  const handleFinish = useCallback(
    (completedScreen: FirstRunScreen | null, track = true) => {
      if (extensions.length === 0) {
        void finishOnboarding(completedScreen);
        return;
      }
      if (completedScreen && track) trackFirstRunStepCompleted(completedScreen);
      setExtensionIndex(0);
      setScreen("extension");
    },
    [extensions, finishOnboarding, trackFirstRunStepCompleted],
  );
  const handleBuilderConnected = useCallback(() => {
    trackFirstRunSetupOutcome(builderSetupAttemptRef.current, "connected");
    builderSetupAttemptRef.current = null;
    trackFirstRunStepCompleted("choice");
    trackFirstRunStepCompleted("connecting");
    handleFinish(null);
  }, [handleFinish, trackFirstRunStepCompleted]);
  const connectFlow = useBuilderConnectFlow({
    enabled: firstRun && !previewMode,
    provisionAccount: true,
    trackingSource: "first_run_onboarding",
    trackingFlow: "connect_llm",
    onConnected: handleBuilderConnected,
  });
  useEffect(() => {
    const attempt = builderSetupAttemptRef.current;
    if (!attempt || connectFlow.connecting) return;
    if (connectFlow.accountExists) {
      trackFirstRunSetupOutcome(attempt, "failed", "account_exists");
      return;
    }
    if (connectFlow.error) {
      trackFirstRunSetupOutcome(attempt, "failed", "connection_error");
    }
  }, [connectFlow.accountExists, connectFlow.connecting, connectFlow.error]);
  const canActivateBuilderFreeCredits =
    connectFlow.agentNativeProvisioningEnabled;
  const retryOnboardingCompletion = useCallback(() => {
    const attempt = completionAttemptRef.current;
    void finishOnboarding(
      attempt?.screen ?? null,
      attempt?.extensionIndex ?? extensionIndex,
      attempt?.onSuccess,
    );
  }, [extensionIndex, finishOnboarding]);
  const completionErrorProps = {
    completionError: completeFirstRunError,
    onRetry: retryOnboardingCompletion,
  };

  if (!firstRun) return null;

  if (error) {
    return (
      <OnboardingShell
        profile={profile}
        screen="choice"
        {...completionErrorProps}
      >
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 text-center">
          <h1 className="text-xl font-semibold tracking-[-0.03em]">
            Setup is almost ready.
          </h1>
          <p className="text-sm text-muted-foreground">
            We could not load the connection options yet.
          </p>
          <button
            type="button"
            className={primaryButtonClass}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </OnboardingShell>
    );
  }

  if (loading || !profile) {
    return <OnboardingSkeleton />;
  }

  const builderCapabilities = profile.capabilities.filter(
    (capability) =>
      capability.builderIncluded && isHeadlineCapability(capability),
  );

  const handleBuilder = (provisionAccount = canActivateBuilderFreeCredits) => {
    if (previewMode) {
      handleFinish(null);
      return;
    }
    const attempt = startSetupMethod(
      provisionAccount ? "builder_create_account" : "builder_sign_in",
      "builder",
    );
    builderSetupAttemptRef.current = attempt;
    if (connectFlow.hasFetchedStatus && connectFlow.configured) {
      trackFirstRunSetupOutcome(attempt, "already_connected");
      builderSetupAttemptRef.current = null;
      trackFirstRunStepCompleted("choice");
      handleFinish(null);
      return;
    }
    setBuilderConnectionMode(
      provisionAccount && canActivateBuilderFreeCredits
        ? "provision"
        : "existing",
    );
    setScreen("connecting");
    connectFlow.start({
      trackingSource: "first_run_onboarding",
      trackingFlow: "connect_llm",
      provisionAccount,
    });
  };

  const navigateToKeySettings = () => {
    if (typeof window === "undefined") return;
    // Drop the onboarding preview params — useOnboardingPreviewMode() reads
    // them live from the URL, so carrying them over would re-trigger the
    // preview overlay on the Settings page we're navigating to.
    const search = new URLSearchParams(window.location.search);
    search.delete(ONBOARDING_PREVIEW_QUERY_PARAM);
    search.delete(ONBOARDING_PREVIEW_STEP_QUERY_PARAM);
    const query = search.toString();
    window.history.pushState(
      null,
      "",
      `${appMountedPath(
        buildSettingsRoute("keys"),
        pathname || STANDARD_APP_ROUTES.home,
      )}${query ? `?${query}` : ""}`,
    );
    window.dispatchEvent(new Event("popstate"));
  };

  const handleOpenSettings = async () => {
    if (completionInFlightRef.current) return;
    const attempt = startSetupMethod("custom_keys", "manual");
    await finishOnboarding("choice", extensionIndex, () => {
      if (pendingHandoffFailureRef.current === attempt) {
        pendingHandoffFailureRef.current = null;
      }
      trackFirstRunSetupOutcome(attempt, "settings_opened");
      navigateToKeySettings();
    });
  };

  const handleSkipToApp = async () => {
    if (completionInFlightRef.current) return;
    const attempt = startSetupMethod("skip_to_app", "skip");
    await finishOnboarding(null, extensionIndex, () => {
      if (pendingHandoffFailureRef.current === attempt) {
        pendingHandoffFailureRef.current = null;
      }
      trackFirstRunStepSkipped("choice", "skip_to_app");
      trackFirstRunSetupOutcome(attempt, "skipped_to_app");
    });
  };

  const builderStatusPending = !previewMode && !connectFlow.statusResolved;

  const handleRoleContinue = async () => {
    const roleToSave =
      selectedRole === "other" ? customRole.trim() : selectedRole;
    if (!roleToSave || savingRole) return;
    setSavingRole(true);
    setRoleSaveError(null);
    if (!previewMode) {
      trackOnboardingEvent("onboarding_role_save_started", {
        flow: "first_run",
        step_id: "role",
        role: selectedRole === "other" ? "other" : selectedRole,
      });
    }
    try {
      if (!previewMode) await saveFirstRunOnboardingRole(roleToSave);
      trackFirstRunStepCompleted("role");
      setScreen("choice");
    } catch (error) {
      setRoleSaveError(
        error instanceof Error
          ? error.message
          : t("agentChat.onboarding.saveRoleError"),
      );
    } finally {
      setSavingRole(false);
    }
  };

  if (screen === "extension") {
    const extension = extensions[extensionIndex];
    if (!extension) {
      void finishOnboarding(null);
      return null;
    }
    const Extension = extension.component;
    const advanceExtension = () => {
      if (extensionIndex < extensions.length - 1) {
        trackFirstRunStepCompleted("extension", extensionIndex);
        setExtensionIndex((current) => current + 1);
        return;
      }
      void finishOnboarding("extension", extensionIndex);
    };
    return (
      <OnboardingShell
        profile={profile}
        screen="extension"
        {...completionErrorProps}
      >
        <Extension
          onComplete={advanceExtension}
          onSkip={() => {
            trackFirstRunStepSkipped(
              "extension",
              "user_action",
              extensionIndex,
            );
            void finishOnboarding(null);
          }}
        />
      </OnboardingShell>
    );
  }

  if (screen === "choice" && connectFirstRun) {
    return (
      <OnboardingShell
        profile={profile}
        screen="choice"
        {...completionErrorProps}
      >
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-6">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-foreground">
            {t("agentChat.setup.connectBuilder")}
          </h1>
          <div className="flex w-full flex-col items-center gap-3">
            <Button
              type="button"
              data-testid="first-run-builder-continue"
              className={cn(primaryButtonClass, "w-full")}
              onClick={() => handleBuilder(canActivateBuilderFreeCredits)}
              disabled={builderStatusPending || connectFlow.connecting}
            >
              {t("agentChat.common.continue")}
              {builderStatusPending || connectFlow.connecting ? (
                <IconLoader2 size={15} className="animate-spin" />
              ) : (
                <IconArrowRight size={15} />
              )}
            </Button>
            <p className="text-center text-xs leading-5 text-muted-foreground">
              {t("agentChat.onboarding.builderConsentPrefix")}{" "}
              <a
                href="https://www.builder.io/legal/terms"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("agentChat.onboarding.builderTerms")}
              </a>{" "}
              {t("agentChat.onboarding.builderConsentAnd")}{" "}
              <a
                href="https://www.builder.io/legal/privacy"
                target="_blank"
                rel="noreferrer"
                className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("agentChat.onboarding.builderPrivacy")}
              </a>
              .
            </p>
          </div>
          {connectFlow.error && !connectFlow.statusResolved && !previewMode && (
            <div className="flex flex-col items-center gap-2">
              <p
                role="status"
                data-testid="first-run-builder-status-error"
                className="text-center text-xs text-destructive"
              >
                {t("agentChat.setup.providerStatusUnavailable")}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => connectFlow.retry()}
              >
                {t("agentChat.common.retry")}
              </Button>
            </div>
          )}
          <div className="flex flex-col items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="first-run-open-key-settings"
              className="min-h-9 rounded-lg px-2.5 text-sm font-medium text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void handleOpenSettings()}
            >
              {t("agentChat.onboarding.useOwnApiKeys")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="first-run-skip-to-app"
              className="min-h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void handleSkipToApp()}
            >
              {t("agentChat.onboarding.skipForNow")}
            </Button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  if (screen === "choice") {
    return (
      <OnboardingShell
        profile={profile}
        screen="choice"
        {...completionErrorProps}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-9">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-foreground">
                Choose your setup
              </h1>
              <p className="text-sm text-muted-foreground">
                We recommend starting with Builder.io for the fastest setup.
              </p>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-foreground">
                      Use Builder.io
                    </h2>
                    <Badge variant="secondary" className="font-medium">
                      Recommended
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Configure using Builder.io and use your account credits to
                    power the app&rsquo;s services.
                  </p>
                </div>
                <div className="flex flex-col gap-1 rounded-[10px] bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
                  <p className="text-[13px] font-semibold text-foreground">
                    Included free with a Builder.io account
                  </p>
                  <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                    60 monthly Agent Credits
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <p className="text-sm text-muted-foreground/70">
                    What&rsquo;s included
                  </p>
                  {builderCapabilities.map((capability) => {
                    const copy = getCapabilityCopy(t, capability);
                    return (
                      <div
                        key={capability.id}
                        className="flex items-center gap-2 rounded-md px-2 py-1"
                      >
                        <IconCheck
                          className="shrink-0 text-muted-foreground"
                          size={15}
                        />
                        <span className="flex-1 text-xs text-foreground">
                          {copy.label}
                        </span>
                        {capability.id === "design-system-intelligence" && (
                          <CapabilityInfoButton
                            why={copy.why}
                            ariaLabel={t(
                              "agentChat.onboarding.capability.about",
                              {
                                defaultValue: "About {{label}}",
                                label: copy.label,
                              },
                            )}
                          />
                        )}
                      </div>
                    );
                  })}
                  {BUILDER_MORE_SERVICES.filter(
                    (service) =>
                      !builderCapabilities.some(
                        (capability) =>
                          getCapabilityCopy(
                            t,
                            capability,
                          ).label.toLowerCase() === service.toLowerCase(),
                      ),
                  ).map((service) => (
                    <div
                      key={service}
                      className="flex items-center gap-2 rounded-md px-2 py-1"
                    >
                      <IconCheck
                        className="shrink-0 text-muted-foreground"
                        size={15}
                      />
                      <span className="text-xs text-foreground">{service}</span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    data-testid="first-run-builder-create-account"
                    className={cn(primaryButtonClass, "w-full")}
                    onClick={() => handleBuilder(true)}
                    disabled={connectFlow.connecting}
                  >
                    {t("agentChat.onboarding.builderCreateAccount")}
                  </button>
                  <button
                    type="button"
                    data-testid="first-run-builder-sign-in"
                    className={cn(mutedButtonClass, "w-full")}
                    onClick={() => handleBuilder(false)}
                    disabled={connectFlow.connecting}
                  >
                    {t("agentChat.onboarding.builderSignInWithAccount")}
                  </button>
                </div>
                {connectFlow.error && !connectFlow.statusResolved && (
                  <p
                    role="status"
                    data-testid="first-run-builder-status-error"
                    className="text-center text-xs text-destructive"
                  >
                    {t("agentChat.setup.providerStatusUnavailable")}
                  </p>
                )}
              </section>

              <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
                <div className="flex flex-col gap-2">
                  <h2 className="text-lg font-bold text-foreground">
                    Configure manually
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    Configure your own API keys and credentials to power the
                    app&rsquo;s services.
                  </p>
                </div>
                <div className="flex flex-col gap-1 rounded-xl bg-muted px-4 py-3">
                  <p className="text-[13px] font-semibold text-foreground">
                    You configure and maintain everything
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Full control over your infrastructure
                  </p>
                </div>
                <CapabilityList
                  capabilities={profile.capabilities}
                  className="flex-1"
                />
                <button
                  type="button"
                  data-testid="first-run-open-key-settings"
                  className={cn(secondaryButtonClass, "w-full")}
                  onClick={() => void handleOpenSettings()}
                >
                  Skip and configure manually
                </button>
              </section>
            </div>
          </div>
          <p className="text-center text-xs leading-5 text-muted-foreground">
            {t("agentChat.onboarding.builderConsentPrefix")}{" "}
            <a
              href="https://www.builder.io/legal/terms"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("agentChat.onboarding.builderTerms")}
            </a>{" "}
            {t("agentChat.onboarding.builderConsentAnd")}{" "}
            <a
              href="https://www.builder.io/legal/privacy"
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("agentChat.onboarding.builderPrivacy")}
            </a>
            .
          </p>
        </div>
      </OnboardingShell>
    );
  }

  if (screen === "role") {
    return (
      <OnboardingShell
        profile={profile}
        screen="role"
        {...completionErrorProps}
      >
        <div
          className="mx-auto flex w-full max-w-2xl flex-col"
          data-testid="first-run-role"
        >
          <div className="flex flex-col gap-2 pt-2">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.02em] text-foreground">
              {t("agentChat.onboarding.roleQuestion")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("agentChat.onboarding.roleHelperText")}
            </p>
          </div>
          <fieldset className="mt-7 flex flex-col gap-3">
            <legend className="sr-only">
              {t("agentChat.onboarding.chooseRole")}
            </legend>
            {FIRST_RUN_ROLE_OPTIONS.map(({ value, labelKey }) => (
              <label
                key={value}
                data-testid={`first-run-role-${value}`}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-card p-3 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
                  selectedRole === value
                    ? "border-primary/40 ring-1 ring-primary/20"
                    : "hover:border-foreground/20",
                )}
              >
                <input
                  type="radio"
                  name="first-run-role"
                  value={value}
                  checked={selectedRole === value}
                  onChange={() => {
                    setSelectedRole(value);
                    trackOnboardingEvent("onboarding_role_option_selected", {
                      flow: "first_run",
                      step_id: "role",
                      role: value,
                    });
                  }}
                  className="size-4 shrink-0 accent-primary"
                />
                <span className="font-medium text-foreground">
                  {t(labelKey)}
                </span>
              </label>
            ))}
          </fieldset>
          {selectedRole === "other" && (
            <div className="mt-4 flex flex-col gap-2">
              <label
                htmlFor="first-run-role-other"
                className="text-sm font-medium text-foreground"
              >
                {t("agentChat.onboarding.roleOtherInputLabel")}
              </label>
              <input
                id="first-run-role-other"
                data-testid="first-run-role-other-input"
                type="text"
                value={customRole}
                maxLength={120}
                disabled={savingRole}
                onChange={(event) => setCustomRole(event.target.value)}
                className="min-h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/40 focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
          {roleSaveError && (
            <p className="mt-4 text-xs leading-5 text-destructive" role="alert">
              {roleSaveError}
            </p>
          )}
          <div className="mt-6 flex items-center justify-between gap-2">
            <button
              type="button"
              data-testid="first-run-role-skip"
              className="inline-flex min-h-9 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => {
                trackFirstRunStepSkipped("role");
                setScreen("choice");
              }}
              disabled={savingRole}
            >
              {t("agentChat.onboarding.skipForNow")}
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => void handleRoleContinue()}
              disabled={
                !selectedRole ||
                (selectedRole === "other" && !customRole.trim()) ||
                savingRole
              }
            >
              {savingRole
                ? t("agentChat.common.saving")
                : t("agentChat.common.continue")}
              {!savingRole && <IconArrowRight size={15} />}
            </button>
          </div>
        </div>
      </OnboardingShell>
    );
  }

  const accountExists = connectFlow.accountExists;
  const provisioning = builderConnectionMode === "provision" && !accountExists;
  return (
    <OnboardingShell
      profile={profile}
      screen="connecting"
      {...completionErrorProps}
    >
      <div
        className="mx-auto flex w-full max-w-md flex-col items-center text-center"
        role="status"
        aria-live="polite"
        aria-busy={connectFlow.connecting}
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
          {accountExists ? (
            <IconKey size={19} />
          ) : (
            <IconLoader2 className="animate-spin" size={19} />
          )}
        </div>
        <h1 className="mt-5 text-xl font-semibold tracking-[-0.04em]">
          {accountExists
            ? t("agentChat.onboarding.builderAccountExistsTitle")
            : provisioning
              ? t("agentChat.onboarding.builderActivating")
              : t("agentChat.onboarding.builderConnecting")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {accountExists
            ? t("agentChat.onboarding.builderAccountExistsDescription")
            : provisioning
              ? t("agentChat.onboarding.builderProvisioningDescription")
              : t("agentChat.onboarding.builderConnectionDescription")}
        </p>
        {accountExists ? (
          <button
            type="button"
            className={cn(primaryButtonClass, "mt-7 w-full")}
            onClick={() => handleBuilder(false)}
            disabled={connectFlow.connecting}
          >
            {t("agentChat.auth.logIn")}
            <IconArrowRight size={15} />
          </button>
        ) : (
          <>
            <div className="mt-7 w-full rounded-xl bg-muted/35 p-4 text-left">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="mt-4 h-8 w-full" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
                <Skeleton className="h-7 w-full" />
              </div>
            </div>
            {connectFlow.connecting && (
              <button
                type="button"
                data-testid="first-run-cancel-builder"
                className={cn(secondaryButtonClass, "mt-4")}
                onClick={connectFlow.cancel}
              >
                {t("common.cancel")}
              </button>
            )}
            {connectFlow.error && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <p className="text-xs text-destructive">{connectFlow.error}</p>
                <button
                  type="button"
                  className={secondaryButtonClass}
                  onClick={() => setScreen("choice")}
                >
                  Try again
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </OnboardingShell>
  );
}

function OnboardingShell({
  profile,
  screen,
  footer,
  completionError,
  onRetry,
  children,
}: {
  profile: OnboardingAppProfile | null;
  screen: FirstRunScreen;
  footer?: React.ReactNode;
  completionError?: string | null;
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background text-foreground"
      data-onboarding-screen={screen}
      role="dialog"
      aria-modal="true"
      aria-label={`${profile?.appName ?? "Your app"} setup`}
    >
      <div
        className="h-0.5 shrink-0 bg-muted"
        data-testid="onboarding-progress"
      >
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{
            width:
              screen === "role"
                ? "33.33%"
                : screen === "extension"
                  ? "100%"
                  : "66.66%",
          }}
        />
      </div>
      <main
        className={cn(
          "flex min-h-0 flex-1 items-center overflow-y-auto px-5 py-10 sm:px-8",
        )}
      >
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
      {footer && (
        <footer className="shrink-0 border-t border-border bg-background/95 px-5 py-3 backdrop-blur-sm sm:px-8">
          {footer}
        </footer>
      )}
      {completionError && onRetry ? (
        <FirstRunCompletionError message={completionError} onRetry={onRetry} />
      ) : null}
    </div>
  );
}

function OnboardingSkeleton() {
  return (
    <div
      className="fixed inset-0 z-[100] flex h-full min-h-0 flex-col bg-background"
      data-onboarding-loading="true"
      aria-busy="true"
    >
      <Skeleton className="h-0.5 w-full shrink-0" />
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-5 sm:px-8">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="mt-3 h-10 w-52" />
        <Skeleton className="mt-7 h-3 w-44" />
        <Skeleton className="mt-7 h-10 w-24 rounded-lg" />
      </div>
    </div>
  );
}

type CapabilityTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

type CapabilityCopy = Pick<
  OnboardingCapability,
  "id" | "required" | "suggested"
> & {
  label: string;
  keySummary: string;
  why: string;
};

function getCapabilityCopy(
  t: CapabilityTranslator,
  capability: OnboardingCapability,
): CapabilityCopy {
  return {
    id: capability.id,
    required: capability.required,
    suggested: capability.suggested,
    label: capability.labelKey
      ? t(capability.labelKey, { defaultValue: capability.label })
      : capability.label,
    keySummary: capability.keySummaryKey
      ? t(capability.keySummaryKey, { defaultValue: capability.keySummary })
      : capability.keySummary,
    why: capability.whyKey
      ? t(capability.whyKey, { defaultValue: capability.why })
      : capability.why,
  };
}

function CapabilityList({
  capabilities,
  className,
}: {
  capabilities: OnboardingCapability[];
  className?: string;
}) {
  const t = useT();
  const visibleCapabilities = useMemo(() => {
    const headline = capabilities.filter(isHeadlineCapability);
    const required = headline.filter((capability) => capability.required);
    const suggested = headline.filter(
      (capability) => !capability.required && capability.suggested,
    );
    const noManualPath = headline.filter(
      (capability) => !capability.required && !capability.suggested,
    );
    return [...required, ...suggested, ...noManualPath];
  }, [capabilities]);

  return (
    <div className={cn("grid content-start", className)}>
      <p className="mb-1 text-sm text-muted-foreground/70">
        What you&rsquo;ll need to configure
      </p>
      <div className="grid gap-1">
        {visibleCapabilities.map((capability) => (
          <CapabilityRow
            key={capability.id}
            copy={getCapabilityCopy(t, capability)}
          />
        ))}
      </div>
    </div>
  );
}

// Design system intelligence has no BYOK path — it's Builder-managed only, so
// the manual list shows it crossed out with no Required/Recommended tag
// instead of mislabeling it "Optional".
const NO_MANUAL_PATH_CAPABILITY_IDS = new Set(["design-system-intelligence"]);

/** The setup cards are a scannable comparison, not a capability inventory:
 *  they carry what the app needs (required), what we recommend (suggested),
 *  and the Builder-only rows that make the manual column honest. Per-app
 *  extras like an optional Figma token belong in Settings, where the user is
 *  actually choosing them. */
function isHeadlineCapability(capability: OnboardingCapability): boolean {
  return (
    capability.required ||
    !!capability.suggested ||
    NO_MANUAL_PATH_CAPABILITY_IDS.has(capability.id)
  );
}

function CapabilityRow({ copy }: { copy: CapabilityCopy }) {
  if (NO_MANUAL_PATH_CAPABILITY_IDS.has(copy.id)) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1">
        <IconX className="shrink-0 text-muted-foreground" size={14} />
        <span className="flex-1 text-xs text-foreground">{copy.label}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1">
      <IconKey className="shrink-0 text-muted-foreground" size={14} />
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground"
        title={copy.keySummary}
      >
        {copy.keySummary}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {copy.required ? "Required" : "Recommended"}
      </span>
    </div>
  );
}

function CapabilityInfoButton({
  why,
  ariaLabel,
}: {
  why: string;
  ariaLabel: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          className="inline-flex size-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <IconInfoCircle size={13} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        {why}
      </TooltipContent>
    </Tooltip>
  );
}

// `aria-disabled` (not `disabled`) is what BuilderConnectPopover sets while the
// Builder status is still in flight, so the `disabled:` styles never engage and
// a pending CTA is pixel-identical to a live one — which is why this class of
// dead button survives screenshot review.
const primaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-wait aria-disabled:opacity-60";

/** Inline failure signal for a failed completeFirstRun() call — keeps the
 *  user on their current screen with a way forward, instead of swapping to
 *  an unrelated full-screen error or leaving Skip/Continue looking like it
 *  did nothing. */
function FirstRunCompletionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-3 rounded-lg border border-destructive/30 bg-background px-4 py-2 text-xs shadow-lg">
      <span className="text-destructive">{message}</span>
      <button
        type="button"
        className="font-medium underline underline-offset-2 hover:no-underline"
        onClick={onRetry}
      >
        Try again
      </button>
    </div>
  );
}

const mutedButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg bg-muted px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";

const secondaryButtonClass =
  "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60";
