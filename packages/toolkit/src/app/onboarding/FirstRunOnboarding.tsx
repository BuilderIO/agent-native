import { useFeatureFlagState } from "@agent-native/core/client/feature-flags/use-feature-flag";
import { useT } from "@agent-native/core/client/i18n";
import {
  listFirstRunOnboardingExtensions,
  type FirstRunOnboardingExtension,
} from "@agent-native/core/client/onboarding/first-run-registry";
import { saveFirstRunOnboardingRole } from "@agent-native/core/client/onboarding/first-run-status";
import {
  createOnboardingCorrelationId,
  setCustomKeyOnboardingAttempt,
  setOnboardingExperiment,
  trackOnboardingEvent,
  useOnboarding,
} from "@agent-native/core/client/onboarding/use-onboarding";
import {
  ONBOARDING_PREVIEW_QUERY_PARAM,
  ONBOARDING_PREVIEW_STEP_QUERY_PARAM,
  useOnboardingPreviewMode,
  useOnboardingPreviewStep,
} from "@agent-native/core/client/onboarding/use-preview-mode";
import { SETTINGS_REDESIGN_FLAG } from "@agent-native/core/feature-flags/registry";
import {
  buildSettingsRoute,
  SETTINGS_PAGE_IDS,
} from "@agent-native/core/navigation";
import type {
  OnboardingAppProfile,
  OnboardingCapability,
} from "@agent-native/core/onboarding/types";
import { Badge } from "@agent-native/toolkit/ui/badge";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { Skeleton } from "@agent-native/toolkit/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronUp,
  IconHelpCircle,
  IconKey,
  IconLoader2,
} from "@tabler/icons-react";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";

import { useBuilderConnectFlow } from "../settings/useBuilderStatus.js";
import {
  BuilderIncludedServices,
  CapabilityInfoButton,
  getBuilderIncludedCapabilities,
} from "./BuilderIncludedServices.js";
import {
  assignFirstRunSetupVariant,
  FIRST_RUN_SETUP_EXPERIMENT_ID,
  getPreviewFirstRunSetupVariant,
} from "./first-run-experiment.js";
import {
  ONBOARDING_PRIMARY_BUTTON_CLASS,
  OnboardingStepLayout,
} from "./OnboardingStepLayout.js";

type FirstRunScreen = "choice" | "role" | "connecting" | "extension";
type FirstRunExtensionPlacement = "before-setup" | "after-setup";
type FirstRunSetupMethodId =
  | "builder_create_account"
  | "builder_sign_in"
  | "custom_keys";

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

function firstRunStepProperties(
  screen: FirstRunScreen,
  beforeSetupExtensions: readonly FirstRunOnboardingExtension[],
  afterSetupExtensions: readonly FirstRunOnboardingExtension[],
  extensionPlacement: FirstRunExtensionPlacement,
  extensionIndex: number,
  extensionStepIndex: number,
  setupSkippable: boolean,
): Record<string, unknown> {
  // `optional` must match whether the screen offers a skip: Analytics funnels
  // read it to keep a skip from counting as drop-off.
  const beforeStepCount = beforeSetupExtensions.reduce(
    (count, extension) => count + (extension.stepCount ?? 1),
    0,
  );
  if (screen === "extension") {
    const extensions =
      extensionPlacement === "before-setup"
        ? beforeSetupExtensions
        : afterSetupExtensions;
    const extension = extensions[extensionIndex];
    const precedingSteps = extensions
      .slice(0, extensionIndex)
      .reduce((count, current) => count + (current.stepCount ?? 1), 0);
    const stepIndex =
      (extensionPlacement === "before-setup" ? 1 : 3 + beforeStepCount) +
      precedingSteps +
      extensionStepIndex;
    return {
      flow: "first_run",
      step_id: `extension:${extension?.id ?? "unknown"}:${extensionStepIndex + 1}`,
      step_index: stepIndex,
      optional: extension?.optional === true,
      ...(extension ? { extension_id: extension.id } : {}),
    };
  }
  const stepIndex =
    screen === "role"
      ? 0
      : screen === "choice"
        ? 1 + beforeStepCount
        : 2 + beforeStepCount;
  return {
    flow: "first_run",
    step_id: screen,
    step_index: stepIndex,
    optional: screen === "role" || (screen === "choice" && setupSkippable),
  };
}

const SETUP_EXPERIMENT_DECISION_TIMEOUT_MS = 4000;

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

/**
 * Where the custom-key choice lands: Agent › Model, whose empty state adds a
 * provider key in one click. API keys with the redesign off.
 */
export function manualSetupSettingsRoute({
  redesign,
}: {
  redesign: boolean;
}): string {
  return buildSettingsRoute(redesign ? SETTINGS_PAGE_IDS.model : "keys");
}

export interface FirstRunOnboardingProps {
  initialFirstRun?: boolean;
}

export function FirstRunOnboarding({
  initialFirstRun = false,
}: FirstRunOnboardingProps = {}) {
  const t = useT();
  const navigate = useNavigate();
  const previewMode = useOnboardingPreviewMode();
  const previewStep = useOnboardingPreviewStep();
  const {
    firstRun,
    loading,
    error,
    profile,
    completeFirstRun,
    completeFirstRunError,
  } = useOnboarding({
    preview: previewMode,
    initialFirstRun,
    firstRunSurface: true,
  });
  const [screen, setScreen] = useState<FirstRunScreen>(() =>
    previewStep === "references" ? "extension" : (previewStep ?? "role"),
  );
  const canRenderRoleWithoutProfile =
    initialFirstRun && screen === "role" && (loading || error != null);
  const canTrackOnboardingScreen =
    (!loading && profile !== null) || canRenderRoleWithoutProfile;
  const setupSkippable = profile?.appId === "clips";
  const [setupExperimentDecision, setSetupExperimentDecision] = useState<
    boolean | null
  >(null);
  const setupVariant = useMemo(
    () =>
      (previewMode && getPreviewFirstRunSetupVariant(window.location.search)) ||
      assignFirstRunSetupVariant(),
    [previewMode],
  );
  // The credits arm offers Skip in every app, so analytics must mark the choice step optional there too.
  const choiceSkippable =
    setupSkippable ||
    (setupVariant === "credits" &&
      (previewMode || setupExperimentDecision === true));
  const [extensionPlacement, setExtensionPlacement] =
    useState<FirstRunExtensionPlacement>("after-setup");
  const [extensionIndex, setExtensionIndex] = useState(0);
  const [extensionStepIndex, setExtensionStepIndex] = useState(0);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [customRole, setCustomRole] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaveError, setRoleSaveError] = useState<string | null>(null);
  const [retryingBuilderStatus, setRetryingBuilderStatus] = useState(false);
  const retryingBuilderStatusAtCountRef = useRef<number | null>(null);
  const [builderConnectionMode, setBuilderConnectionMode] = useState<
    "existing" | "provision"
  >("existing");
  const [builderCancelRequested, setBuilderCancelRequested] = useState(false);
  const extensions = useMemo(() => listFirstRunOnboardingExtensions(), []);
  const beforeSetupExtensions = useMemo(
    () =>
      extensions.filter((extension) => extension.placement === "before-setup"),
    [extensions],
  );
  const afterSetupExtensions = useMemo(
    () =>
      extensions.filter((extension) => extension.placement !== "before-setup"),
    [extensions],
  );
  const activeExtensions =
    extensionPlacement === "before-setup"
      ? beforeSetupExtensions
      : afterSetupExtensions;
  const beforeSetupStepCount = beforeSetupExtensions.reduce(
    (count, extension) => count + (extension.stepCount ?? 1),
    0,
  );
  const totalOnboardingStepCount =
    3 +
    beforeSetupStepCount +
    afterSetupExtensions.reduce(
      (count, extension) => count + (extension.stepCount ?? 1),
      0,
    );
  const currentStepIndex = Number(
    firstRunStepProperties(
      screen,
      beforeSetupExtensions,
      afterSetupExtensions,
      extensionPlacement,
      extensionIndex,
      extensionStepIndex,
      choiceSkippable,
    ).step_index ?? 0,
  );
  const progressWidth = `${Math.min(
    100,
    ((currentStepIndex + 1) / totalOnboardingStepCount) * 100,
  )}%`;
  const redesign = useFeatureFlagState(SETTINGS_REDESIGN_FLAG.key);
  const [moreInfoOpen, setMoreInfoOpen] = useState(false);
  const [skipConfirmOpen, setSkipConfirmOpen] = useState(false);
  const skipGoBackRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!previewMode || !previewStep) return;
    setScreen(previewStep === "references" ? "extension" : previewStep);
  }, [previewMode, previewStep]);
  const trackFirstRunStepCompleted = useCallback(
    (
      stepScreen: FirstRunScreen,
      stepExtensionIndex = extensionIndex,
      stepIndex = extensionStepIndex,
    ) => {
      if (previewMode) return;
      trackOnboardingEvent(
        "onboarding_step_completed",
        firstRunStepProperties(
          stepScreen,
          beforeSetupExtensions,
          afterSetupExtensions,
          extensionPlacement,
          stepExtensionIndex,
          stepIndex,
          choiceSkippable,
        ),
      );
    },
    [
      afterSetupExtensions,
      beforeSetupExtensions,
      extensionIndex,
      extensionPlacement,
      extensionStepIndex,
      previewMode,
      choiceSkippable,
    ],
  );
  const trackFirstRunStepSkipped = useCallback(
    (
      stepScreen: FirstRunScreen,
      reason = "user_action",
      stepExtensionIndex = extensionIndex,
      stepIndex = extensionStepIndex,
    ) => {
      if (previewMode) return;
      trackOnboardingEvent("onboarding_step_skipped", {
        ...firstRunStepProperties(
          stepScreen,
          beforeSetupExtensions,
          afterSetupExtensions,
          extensionPlacement,
          stepExtensionIndex,
          stepIndex,
          choiceSkippable,
        ),
        reason,
      });
    },
    [
      afterSetupExtensions,
      beforeSetupExtensions,
      extensionIndex,
      extensionPlacement,
      extensionStepIndex,
      previewMode,
      choiceSkippable,
    ],
  );
  const completionAttemptRef = useRef<{
    screen: FirstRunScreen | null;
    extensionIndex: number;
    redirect: string | null;
  } | null>(null);
  const completionInFlightRef = useRef(false);
  const completionRedirectRef = useRef<string | null>(null);
  const setupSkipStartedRef = useRef(false);
  const onboardingTerminalRef = useRef(false);
  const abandonmentTrackedRef = useRef(false);
  const onboardingStartedRef = useRef(false);
  const setupAttemptRef = useRef<FirstRunSetupAttempt | null>(null);
  const builderSetupAttemptRef = useRef<FirstRunSetupAttempt | null>(null);
  const stepViewRef = useRef<{ key: string; id: string } | null>(null);
  const startSetupMethod = useCallback(
    (methodId: FirstRunSetupMethodId, methodKind: "builder" | "manual") => {
      if (previewMode || typeof window === "undefined") return null;
      const attempt = {
        id: createOnboardingCorrelationId(),
        methodId,
        outcomeTracked: false,
      };
      setupAttemptRef.current = attempt;
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
    [previewMode],
  );
  const finishOnboarding = useCallback(
    async (
      completedScreen: FirstRunScreen | null,
      completedExtensionIndex = extensionIndex,
      retryRedirect: string | null = completionRedirectRef.current,
    ) => {
      completionRedirectRef.current = null;
      completionAttemptRef.current = {
        screen: completedScreen,
        extensionIndex: completedExtensionIndex,
        redirect: retryRedirect,
      };
      completionInFlightRef.current = true;
      try {
        await completeFirstRun();
        if (completedScreen) {
          trackFirstRunStepCompleted(completedScreen, completedExtensionIndex);
        }
        onboardingTerminalRef.current = true;
        completionAttemptRef.current = null;
        if (retryRedirect) {
          navigate(retryRedirect, { replace: true });
        }
        return true;
      } catch {
        // coercion-ok: completeFirstRun exposes this failure as the inline retry state.
        return false;
      } finally {
        completionInFlightRef.current = false;
      }
    },
    [completeFirstRun, extensionIndex, navigate, trackFirstRunStepCompleted],
  );
  useEffect(() => {
    if (
      !previewMode &&
      firstRun &&
      canTrackOnboardingScreen &&
      !onboardingStartedRef.current
    ) {
      onboardingStartedRef.current = true;
      trackOnboardingEvent("onboarding_started", { flow: "first_run" });
    }
  }, [canTrackOnboardingScreen, firstRun, previewMode]);
  // Both arms render a skeleton until the experiment decision is known, and the
  // credits arm's skip depends on it, so the choice view waits for the decision
  // and is sent once with its resolved optional flag. Without an assigned arm
  // no decision is ever made, and the choice UI renders as is.
  const choiceStepKnown =
    screen !== "choice" ||
    setupVariant === null ||
    setupExperimentDecision !== null;
  useEffect(() => {
    if (
      previewMode ||
      !firstRun ||
      !canTrackOnboardingScreen ||
      !choiceStepKnown
    ) {
      stepViewRef.current = null;
      return;
    }
    const step = firstRunStepProperties(
      screen,
      beforeSetupExtensions,
      afterSetupExtensions,
      extensionPlacement,
      extensionIndex,
      extensionStepIndex,
      choiceSkippable,
    );
    const key = [step.step_id, step.extension_id, step.step_index].join(":");
    if (stepViewRef.current?.key !== key) {
      stepViewRef.current = { key, id: createOnboardingCorrelationId() };
    }
    trackOnboardingEvent("onboarding_step_viewed", {
      ...step,
      step_view_id: stepViewRef.current.id,
    });
    // setupSkippable changes only when the profile loads; re-running here
    // would send this screen's view again. A screen change re-reads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    afterSetupExtensions,
    beforeSetupExtensions,
    extensionIndex,
    extensionPlacement,
    extensionStepIndex,
    firstRun,
    previewMode,
    canTrackOnboardingScreen,
    choiceStepKnown,
    screen,
  ]);
  useEffect(() => {
    if (previewMode || !firstRun || !canTrackOnboardingScreen) return;
    const handlePageHide = (event: PageTransitionEvent) => {
      if (event.persisted) return;
      if (
        onboardingTerminalRef.current ||
        abandonmentTrackedRef.current ||
        completionInFlightRef.current
      )
        return;
      abandonmentTrackedRef.current = true;
      trackOnboardingEvent("onboarding_abandoned", {
        ...firstRunStepProperties(
          screen,
          beforeSetupExtensions,
          afterSetupExtensions,
          extensionPlacement,
          extensionIndex,
          extensionStepIndex,
          choiceSkippable,
        ),
        reason: "page_exit",
      });
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [
    afterSetupExtensions,
    beforeSetupExtensions,
    extensionIndex,
    extensionPlacement,
    extensionStepIndex,
    firstRun,
    previewMode,
    canTrackOnboardingScreen,
    screen,
    choiceSkippable,
  ]);
  const beginBeforeSetup = useCallback(() => {
    if (beforeSetupExtensions.length === 0) {
      setScreen("choice");
      return;
    }
    setExtensionPlacement("before-setup");
    setExtensionIndex(0);
    setExtensionStepIndex(0);
    setScreen("extension");
  }, [beforeSetupExtensions.length]);
  const handleFinish = useCallback(
    (completedScreen: FirstRunScreen | null, track = true) => {
      if (afterSetupExtensions.length === 0) {
        void finishOnboarding(completedScreen);
        return;
      }
      if (completedScreen && track) trackFirstRunStepCompleted(completedScreen);
      setExtensionPlacement("after-setup");
      setExtensionIndex(0);
      setExtensionStepIndex(0);
      setScreen("extension");
    },
    [afterSetupExtensions.length, finishOnboarding, trackFirstRunStepCompleted],
  );
  const handleBuilderConnected = useCallback(() => {
    trackFirstRunSetupOutcome(builderSetupAttemptRef.current, "connected");
    builderSetupAttemptRef.current = null;
    setupAttemptRef.current = null;
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
  const builderStatusReadCount = connectFlow.statusReadSettledCount ?? 0;
  useEffect(() => {
    const startedAt = retryingBuilderStatusAtCountRef.current;
    if (startedAt !== null && builderStatusReadCount > startedAt) {
      retryingBuilderStatusAtCountRef.current = null;
      setRetryingBuilderStatus(false);
    }
  }, [builderStatusReadCount]);
  const retryBuilderStatus = useCallback(() => {
    retryingBuilderStatusAtCountRef.current = builderStatusReadCount;
    setRetryingBuilderStatus(true);
    if (!connectFlow.retry()) {
      retryingBuilderStatusAtCountRef.current = null;
      setRetryingBuilderStatus(false);
    }
  }, [builderStatusReadCount, connectFlow.retry]);
  useEffect(() => {
    const attempt = builderSetupAttemptRef.current;
    if (!attempt || connectFlow.connecting) return;
    if (connectFlow.accountExists) {
      trackFirstRunSetupOutcome(attempt, "failed", "account_exists");
      return;
    }
    if (connectFlow.terminalError) {
      trackFirstRunSetupOutcome(attempt, "failed", "connection_error");
    }
  }, [
    connectFlow.accountExists,
    connectFlow.connecting,
    connectFlow.terminalError,
  ]);
  // Preview never fetches status, so show the activation path it would offer.
  const canActivateBuilderFreeCredits =
    previewMode || connectFlow.agentNativeProvisioningEnabled;
  const setupStatusSettled =
    previewMode ||
    connectFlow.hasFetchedStatus ||
    connectFlow.statusUnavailable;
  // The experiment only counts users who could be shown the credits page: an
  // unavailable activation, or an already-connected user, gets the existing
  // page in both arms and stays out of the results.
  const setupExperimentEligible =
    setupStatusSettled &&
    canActivateBuilderFreeCredits &&
    !connectFlow.configured;
  useEffect(() => {
    if (
      previewMode ||
      !firstRun ||
      screen !== "choice" ||
      !setupVariant ||
      !setupStatusSettled ||
      setupExperimentDecision !== null
    ) {
      return;
    }
    if (setupExperimentEligible) {
      setOnboardingExperiment({
        id: FIRST_RUN_SETUP_EXPERIMENT_ID,
        variant: setupVariant,
      });
      trackOnboardingEvent("onboarding_experiment_exposed", {
        flow: "first_run",
        step_id: "choice",
      });
    }
    setSetupExperimentDecision(setupExperimentEligible);
  }, [
    firstRun,
    previewMode,
    screen,
    setupExperimentEligible,
    setupExperimentDecision,
    setupStatusSettled,
    setupVariant,
  ]);
  // A stalled Builder status read must not leave the setup screen blank. Past
  // the limit the person gets the existing page and stays out of the
  // experiment, identically in both arms, so exposure counts stay honest.
  useEffect(() => {
    if (
      previewMode ||
      !firstRun ||
      screen !== "choice" ||
      !setupVariant ||
      setupExperimentDecision !== null
    ) {
      return;
    }
    const timer = window.setTimeout(
      () => setSetupExperimentDecision((decision) => decision ?? false),
      SETUP_EXPERIMENT_DECISION_TIMEOUT_MS,
    );
    return () => window.clearTimeout(timer);
  }, [firstRun, previewMode, screen, setupExperimentDecision, setupVariant]);
  const retryOnboardingCompletion = useCallback(() => {
    const attempt = completionAttemptRef.current;
    void finishOnboarding(
      attempt?.screen ?? null,
      attempt?.extensionIndex ?? extensionIndex,
      attempt?.redirect ?? null,
    );
  }, [extensionIndex, finishOnboarding]);
  const completionErrorProps = {
    completionError: completeFirstRunError,
    onRetry: retryOnboardingCompletion,
  };

  if (!firstRun) return null;

  if (error && !canRenderRoleWithoutProfile) {
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
            className={ONBOARDING_PRIMARY_BUTTON_CLASS}
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        </div>
      </OnboardingShell>
    );
  }

  if ((loading || !profile) && !canRenderRoleWithoutProfile) {
    return <OnboardingSkeleton />;
  }

  const handleBuilder = (provisionAccount = canActivateBuilderFreeCredits) => {
    setBuilderCancelRequested(false);
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
      setupAttemptRef.current = null;
      trackFirstRunStepCompleted("choice");
      handleFinish(null);
      return;
    }
    setBuilderConnectionMode(provisionAccount ? "provision" : "existing");
    setScreen("connecting");
    connectFlow.start({
      trackingSource: "first_run_onboarding",
      trackingFlow: "connect_llm",
      provisionAccount,
    });
  };

  const handleOpenSettings = async () => {
    if (completionInFlightRef.current) return;
    const attempt = startSetupMethod("custom_keys", "manual");
    const completed = await finishOnboarding("choice");
    if (!completed) {
      trackFirstRunSetupOutcome(
        attempt,
        "handoff_failed",
        "onboarding_completion_error",
      );
      return;
    }
    const attemptStorage = attempt
      ? setCustomKeyOnboardingAttempt(attempt.id)
      : null;
    if (attempt && attemptStorage) {
      void attemptStorage.then((status) => {
        if (status !== "stored") {
          trackOnboardingEvent("onboarding_correlation_unavailable", {
            flow: "first_run",
            step_id: "choice",
            method_id: "custom_keys",
            onboarding_attempt_id: attempt.id,
            correlation_status: status,
          });
        }
      });
    }
    if (typeof window === "undefined") return;
    const search = new URLSearchParams(window.location.search);
    search.delete(ONBOARDING_PREVIEW_QUERY_PARAM);
    search.delete(ONBOARDING_PREVIEW_STEP_QUERY_PARAM);
    const query = search.toString();
    const path = manualSetupSettingsRoute({ redesign: redesign.enabled });
    await navigate(`${path}${query ? `?${query}` : ""}`);
    trackFirstRunSetupOutcome(attempt, "settings_opened");
  };

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
      beginBeforeSetup();
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
    const extension = activeExtensions[extensionIndex];
    if (!extension) {
      if (extensionPlacement === "before-setup") setScreen("choice");
      else void finishOnboarding(null);
      return null;
    }
    const Extension = extension.component;
    const advanceExtension = async () => {
      if (extensionPlacement === "before-setup") {
        trackFirstRunStepCompleted(
          "extension",
          extensionIndex,
          extensionStepIndex,
        );
      }
      if (extensionIndex < activeExtensions.length - 1) {
        setExtensionIndex((current) => current + 1);
        setExtensionStepIndex(0);
        return true;
      }
      if (extensionPlacement === "before-setup") {
        setExtensionStepIndex(0);
        setScreen("choice");
        return true;
      }
      return finishOnboarding("extension", extensionIndex);
    };
    return (
      <OnboardingShell
        profile={profile}
        screen="extension"
        progressWidth={progressWidth}
        {...completionErrorProps}
      >
        <Extension
          onComplete={advanceExtension}
          onStepChange={(stepIndex) => {
            const nextStepIndex = Math.min(
              Math.max(0, stepIndex),
              (extension.stepCount ?? 1) - 1,
            );
            for (
              let completedStepIndex = extensionStepIndex;
              completedStepIndex < nextStepIndex;
              completedStepIndex += 1
            ) {
              trackFirstRunStepCompleted(
                "extension",
                extensionIndex,
                completedStepIndex,
              );
            }
            setExtensionStepIndex(nextStepIndex);
          }}
          onSkip={() => {
            trackFirstRunStepSkipped(
              "extension",
              "user_action",
              extensionIndex,
              extensionStepIndex,
            );
            if (extensionPlacement === "before-setup") {
              if (extensionIndex < activeExtensions.length - 1) {
                setExtensionIndex((current) => current + 1);
                setExtensionStepIndex(0);
              } else {
                setExtensionStepIndex(0);
                setScreen("choice");
              }
              return;
            }
            void finishOnboarding(null);
          }}
        />
      </OnboardingShell>
    );
  }

  if (screen === "choice") {
    if (!profile) return <OnboardingSkeleton />;

    // Every shared service Builder.io powers, the same list Infrastructure
    // shows, plus the app's own headline capabilities it covers.
    const builderCapabilities = getBuilderIncludedCapabilities(
      profile.capabilities,
    );

    const inCreditsArm = setupVariant === "credits";
    // Both arms must wait: the control setup actions can be used as soon as
    // they render, so exposure has to be recorded before either arm is usable.
    if (!previewMode && setupVariant && setupExperimentDecision === null) {
      return <OnboardingSkeleton />;
    }
    const creditsEligible =
      inCreditsArm && (previewMode || setupExperimentDecision === true);

    const builderStatusError =
      connectFlow.error && connectFlow.errorKind === "status-read" ? (
        <div
          role="status"
          data-testid="first-run-builder-status-error"
          className="flex flex-col items-center gap-2 text-center text-xs text-destructive"
        >
          <p>{t("agentChat.settingsShell.builder.grantsFailed")}</p>
          <button
            type="button"
            data-testid="first-run-builder-retry-status"
            aria-busy={retryingBuilderStatus}
            disabled={retryingBuilderStatus}
            className="text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={retryBuilderStatus}
          >
            {retryingBuilderStatus ? (
              <IconLoader2
                className="mr-1 inline h-3 w-3 animate-spin"
                aria-hidden
              />
            ) : null}
            {t("agentChat.settingsShell.builder.retry")}
          </button>
        </div>
      ) : null;

    const skipSetup = () => {
      if (setupSkipStartedRef.current || completionInFlightRef.current) return;
      setupSkipStartedRef.current = true;
      trackFirstRunStepSkipped("choice");
      if (setupSkippable) completionRedirectRef.current = "/record";
      handleFinish(null);
    };

    const setupSkipButton = setupSkippable ? (
      <div className="flex justify-center">
        <button
          type="button"
          data-testid="first-run-setup-skip"
          className="inline-flex min-h-9 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={skipSetup}
        >
          {t("agentChat.onboarding.skipForNow")}
        </button>
      </div>
    ) : null;

    const setupCards = (
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
          </div>
          <div className="flex flex-col gap-1 rounded-[10px] bg-emerald-50 px-4 py-3 dark:bg-emerald-950/30">
            <p className="text-[13px] font-semibold text-foreground">
              {t("agentChat.onboarding.builderIncludedFreeWithAccount")}
            </p>
            <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
              {t("agentChat.onboarding.builderMonthlyCredits")}
            </p>
          </div>
          <BuilderIncludedServices
            capabilities={builderCapabilities}
            testId="first-run-builder-services"
          />
          <div className="flex flex-col gap-2">
            {canActivateBuilderFreeCredits && (
              <button
                type="button"
                data-testid="first-run-builder-create-account"
                className={cn(ONBOARDING_PRIMARY_BUTTON_CLASS, "w-full")}
                onClick={() => handleBuilder(true)}
                disabled={connectFlow.connecting}
              >
                {t("agentChat.onboarding.builderCreateAccount")}
              </button>
            )}
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
          {connectFlow.connecting && builderCancelRequested && (
            <p
              className="text-sm text-muted-foreground"
              data-testid="first-run-cancel-pending"
              role="status"
            >
              {t("agentChat.onboarding.builderCancelPending")}
            </p>
          )}
          {!creditsEligible && builderStatusError}
        </section>

        <section className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6">
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold text-foreground">
              {t("agentChat.composer.addOwnKeys")}
            </h2>
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
            {t("agentChat.onboarding.openAiKeySettings")}
          </button>
        </section>
      </div>
    );

    if (creditsEligible) {
      const MoreInfoChevron = moreInfoOpen ? IconChevronUp : IconChevronDown;
      const toggleMoreInfo = () => {
        if (!moreInfoOpen && !previewMode) {
          trackOnboardingEvent("onboarding_more_info_opened", {
            flow: "first_run",
            step_id: "choice",
          });
        }
        setMoreInfoOpen((open) => !open);
      };
      return (
        <OnboardingShell
          profile={profile}
          screen="choice"
          progressWidth={progressWidth}
          {...completionErrorProps}
        >
          <div
            data-testid="first-run-credits-offer"
            className="mx-auto flex w-full flex-col items-center gap-5 pt-[max(0rem,6vh)] text-center"
          >
            <h1
              className={cn(
                "text-balance text-[28px] font-bold leading-tight tracking-[-0.02em] text-foreground",
                profile.appId === "clips" ? "max-w-lg" : "max-w-sm",
              )}
            >
              {profile.appId === "clips"
                ? t("agentChat.onboarding.creditsTitleClips")
                : t("agentChat.onboarding.creditsTitle")}
            </h1>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              {t("agentChat.onboarding.creditsSubtitle")}{" "}
              <button
                type="button"
                data-testid="first-run-credits-learn-more"
                aria-expanded={moreInfoOpen}
                aria-controls={
                  moreInfoOpen ? "first-run-credits-details" : undefined
                }
                className="rounded-sm underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={toggleMoreInfo}
              >
                {t("agentChat.onboarding.creditsLearnMore")}
              </button>
            </p>
            <div className="flex w-full max-w-sm flex-col items-center gap-3">
              <button
                type="button"
                data-testid="first-run-credits-activate"
                className={cn(
                  ONBOARDING_PRIMARY_BUTTON_CLASS,
                  "min-h-11 w-full text-sm",
                )}
                onClick={() => handleBuilder(true)}
                disabled={connectFlow.connecting}
              >
                {t("agentChat.onboarding.creditsActivate")}
              </button>
              <button
                type="button"
                data-testid="first-run-credits-connect-existing"
                className={cn(mutedButtonClass, "min-h-11 w-full text-sm")}
                onClick={() => handleBuilder(false)}
                disabled={connectFlow.connecting}
              >
                {t("agentChat.onboarding.builderExistingAccount")}
              </button>
              <p className="text-xs leading-5 text-muted-foreground">
                {t("agentChat.onboarding.creditsFinePrint")}{" "}
                <a
                  href="https://www.builder.io/legal/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("agentChat.onboarding.builderTerms")}
                </a>{" "}
                {t("agentChat.onboarding.builderConsentAnd")}{" "}
                <a
                  href="https://www.builder.io/legal/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("agentChat.onboarding.builderPrivacy")}
                </a>
                .
              </p>
            </div>
            {builderStatusError}
            <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
              <button
                type="button"
                data-testid="first-run-credits-more-info"
                aria-expanded={moreInfoOpen}
                aria-controls={
                  moreInfoOpen ? "first-run-credits-details" : undefined
                }
                className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={toggleMoreInfo}
              >
                {t("agentChat.onboarding.creditsMoreInfo")}
                <MoreInfoChevron size={14} aria-hidden />
              </button>
            </div>
            {moreInfoOpen && (
              <div
                id="first-run-credits-details"
                data-testid="first-run-credits-details"
                className="mt-3 flex w-full max-w-3xl flex-col gap-6 text-left"
              >
                {setupCards}
                {setupSkippable && (
                  <div className="flex flex-col items-center gap-1 text-center">
                    <p className="text-xs text-muted-foreground">
                      {t("agentChat.onboarding.creditsSkipBody")}
                    </p>
                    {setupSkipButton}
                  </div>
                )}
              </div>
            )}
            <div className="fixed bottom-6 right-6 z-10">
              <Popover open={skipConfirmOpen} onOpenChange={setSkipConfirmOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    data-testid="first-run-credits-skip"
                    className="inline-flex min-h-6 items-center px-2 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("agentChat.onboarding.creditsSkip")}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="end"
                  portalled={false}
                  aria-labelledby="first-run-credits-skip-title"
                  aria-describedby="first-run-credits-skip-body"
                  className="w-96 max-w-[calc(100vw-2rem)] space-y-3 p-4 text-left"
                  onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    skipGoBackRef.current?.focus();
                  }}
                >
                  <div className="space-y-1">
                    <p
                      id="first-run-credits-skip-title"
                      className="text-sm font-semibold text-foreground"
                    >
                      {t("agentChat.onboarding.creditsSkipConfirmTitle")}
                    </p>
                    <p
                      id="first-run-credits-skip-body"
                      className="text-xs leading-5 text-muted-foreground"
                    >
                      {t("agentChat.onboarding.creditsSkipConfirmBody")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
                      onClick={() => void handleOpenSettings()}
                    >
                      {t("agentChat.onboarding.creditsUseCustomKeys")}
                    </Button>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        data-testid="first-run-credits-skip-confirm"
                        onClick={skipSetup}
                      >
                        {t("agentChat.onboarding.creditsSkipAnyway")}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        ref={skipGoBackRef}
                        onClick={() => setSkipConfirmOpen(false)}
                      >
                        {t("agentChat.onboarding.creditsSkipGoBack")}
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </OnboardingShell>
      );
    }

    return (
      <OnboardingShell
        profile={profile}
        screen="choice"
        progressWidth={progressWidth}
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
            {setupCards}
            {setupSkipButton}
          </div>
          <p className="text-center text-xs leading-5 text-muted-foreground">
            {t("agentChat.onboarding.builderConsentPrefix")}{" "}
            <a
              href="https://www.builder.io/legal/terms"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("agentChat.onboarding.builderTerms")}
            </a>{" "}
            {t("agentChat.onboarding.builderConsentAnd")}{" "}
            <a
              href="https://www.builder.io/legal/privacy"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        progressWidth={progressWidth}
        {...completionErrorProps}
      >
        <div data-testid="first-run-role">
          <OnboardingStepLayout
            title={t("agentChat.onboarding.roleQuestion")}
            description={t("agentChat.onboarding.roleHelperText")}
            footer={
              <>
                <button
                  type="button"
                  data-testid="first-run-role-skip"
                  className="inline-flex min-h-9 items-center justify-center rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => {
                    trackFirstRunStepSkipped("role");
                    beginBeforeSetup();
                  }}
                  disabled={savingRole}
                >
                  {t("agentChat.onboarding.skipForNow")}
                </button>
                <button
                  type="button"
                  className={ONBOARDING_PRIMARY_BUTTON_CLASS}
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
              </>
            }
          >
            <fieldset className="flex flex-col gap-3">
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
              <p
                className="mt-4 text-xs leading-5 text-destructive"
                role="alert"
              >
                {roleSaveError}
              </p>
            )}
          </OnboardingStepLayout>
        </div>
      </OnboardingShell>
    );
  }

  const accountExists = connectFlow.accountExists && !connectFlow.connecting;
  const provisioning = builderConnectionMode === "provision" && !accountExists;
  const returnToSetupChoice = () => setScreen("choice");
  return (
    <OnboardingShell
      profile={profile}
      screen="connecting"
      progressWidth={progressWidth}
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
              ? t("agentChat.onboarding.creditsActivating")
              : t("agentChat.onboarding.builderConnecting")}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {accountExists ? (
            t("agentChat.onboarding.builderAccountExistsDescription")
          ) : provisioning ? (
            <>
              {t("agentChat.onboarding.builderProvisioningDescription")}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("agentChat.onboarding.creditsAboutLabel")}
                      className="ml-0 inline-flex size-6 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <IconHelpCircle size={12} aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {t("agentChat.onboarding.creditsActivatingTooltip")}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </>
          ) : (
            t("agentChat.onboarding.builderConnectionDescription")
          )}
        </p>
        {accountExists ? (
          <button
            type="button"
            className={cn(ONBOARDING_PRIMARY_BUTTON_CLASS, "mt-7 w-full")}
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
            {connectFlow.connecting &&
              (builderCancelRequested ? (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="first-run-cancel-pending"
                  >
                    {t("agentChat.onboarding.builderCancelPending")}
                  </p>
                  <button
                    type="button"
                    data-testid="first-run-back-to-choice"
                    className={secondaryButtonClass}
                    onClick={returnToSetupChoice}
                  >
                    {t("agentChat.onboarding.back")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  data-testid="first-run-cancel-builder"
                  className="fixed bottom-6 left-6 inline-flex min-h-6 items-center px-2 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setBuilderCancelRequested(true);
                    connectFlow.cancel();
                  }}
                >
                  {t("common.cancel")}
                </button>
              ))}
            {connectFlow.statusUnavailable &&
              connectFlow.connecting &&
              !connectFlow.terminalError && (
                <p className="mt-4 text-xs text-destructive" role="alert">
                  {t(
                    "agentChat.settingsShell.integrations.builderStatusFailed",
                  )}
                </p>
              )}
            {connectFlow.terminalError && connectFlow.connecting && (
              <p className="mt-4 text-xs text-destructive" role="alert">
                {connectFlow.terminalError}
              </p>
            )}
            {!connectFlow.connecting &&
              (connectFlow.statusUnavailable || connectFlow.terminalError) && (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <p className="text-xs text-destructive" role="alert">
                    {connectFlow.terminalError ??
                      t(
                        "agentChat.settingsShell.integrations.builderStatusFailed",
                      )}
                  </p>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() =>
                      handleBuilder(builderConnectionMode === "provision")
                    }
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    data-testid="first-run-back-to-choice"
                    className={secondaryButtonClass}
                    onClick={returnToSetupChoice}
                  >
                    {t("agentChat.onboarding.back")}
                  </button>
                </div>
              )}
            {!connectFlow.connecting &&
              !connectFlow.statusUnavailable &&
              !connectFlow.terminalError && (
                <button
                  type="button"
                  data-testid="first-run-back-to-choice"
                  className="fixed bottom-6 left-6 inline-flex min-h-6 items-center px-2 rounded-sm text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={returnToSetupChoice}
                >
                  {t("agentChat.onboarding.back")}
                </button>
              )}
          </>
        )}
        {accountExists && !connectFlow.connecting && (
          <button
            type="button"
            data-testid="first-run-back-to-choice"
            className={cn(secondaryButtonClass, "mt-3")}
            onClick={returnToSetupChoice}
          >
            {t("agentChat.onboarding.back")}
          </button>
        )}
      </div>
    </OnboardingShell>
  );
}

function OnboardingShell({
  profile,
  screen,
  progressWidth,
  footer,
  completionError,
  onRetry,
  children,
}: {
  profile: OnboardingAppProfile | null;
  screen: FirstRunScreen;
  progressWidth?: string;
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
              progressWidth ??
              (screen === "role"
                ? "33.33%"
                : screen === "extension"
                  ? "100%"
                  : "66.66%"),
          }}
        />
      </div>
      <main
        className={cn(
          "flex min-h-0 flex-1 items-start overflow-y-auto px-5 pb-10 pt-[max(2.5rem,10vh)] sm:px-8",
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
  why: string | null;
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
      : null,
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
    const headline = capabilities.filter(
      (capability) =>
        !capability.satisfiedBySignIn &&
        !capability.builderOnly &&
        (capability.required || capability.suggested),
    );
    const required = headline.filter((capability) => capability.required);
    const suggested = headline.filter(
      (capability) => !capability.required && capability.suggested,
    );
    return [...required, ...suggested];
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

function CapabilityRow({ copy }: { copy: CapabilityCopy }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1">
      <IconKey className="shrink-0 text-muted-foreground" size={14} />
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground"
        title={copy.keySummary}
      >
        {copy.keySummary}
      </span>
      {copy.why ? (
        <CapabilityInfoButton label={copy.label} why={copy.why} />
      ) : null}
      <span className="shrink-0 text-xs text-muted-foreground">
        {copy.required ? "Required" : "Recommended"}
      </span>
    </div>
  );
}

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
