import { useCallback, useEffect, useRef, useState } from "react";

import type {
  OnboardingAppProfile,
  OnboardingMethod,
  OnboardingStepStatus,
  OnboardingSummary,
} from "../../onboarding/types.js";
import { getAnalyticsIdentityKey, trackEvent } from "../analytics.js";
import { agentNativePath } from "../api-path.js";
import { scheduleAfterPaint } from "../use-after-paint.js";
import {
  dispatchFirstRunOnboardingStatus,
  fetchFirstRunOnboardingStatus,
} from "./first-run-status.js";

const seenOnboardingEvents = new Set<string>();
const ONBOARDING_SUMMARY_TIMEOUT_MS = 15_000;

export function trackOnboardingEvent(
  name: string,
  properties: Record<string, unknown>,
): void {
  if (typeof window === "undefined") return;
  const identityKey = getAnalyticsIdentityKey() ?? "anonymous";
  const key = [
    identityKey,
    name,
    properties.flow,
    properties.step_id,
    properties.extension_id,
    properties.integration_id,
    properties.role,
  ]
    .map((value) => String(value ?? ""))
    .join(":");
  const isRepeatableInteraction =
    name.startsWith("integration_") ||
    name === "onboarding_role_save_started" ||
    name === "onboarding_method_clicked" ||
    name === "onboarding_method_started" ||
    name === "onboarding_method_outcome" ||
    name === "onboarding_dismissed" ||
    name === "onboarding_reopened" ||
    name === "onboarding_abandoned";
  if (!isRepeatableInteraction && seenOnboardingEvents.has(key)) return;
  if (!isRepeatableInteraction) seenOnboardingEvents.add(key);
  trackEvent(name, properties);
}

export interface UseOnboardingResult {
  steps: OnboardingStepStatus[];
  profile: OnboardingAppProfile | null;
  loading: boolean;
  error: string | null;
  currentStepId: string | null;
  completeCount: number;
  totalCount: number;
  allComplete: boolean;
  dismissed: boolean;
  refresh: () => Promise<void>;
  complete: (id: string) => Promise<void>;
  dismiss: () => Promise<void>;
  reopen: () => Promise<void>;
  firstRun: boolean;
  completeFirstRun: () => Promise<void>;
  completeFirstRunError: string | null;
}

export function useOnboarding(
  options: { preview?: boolean; initialFirstRun?: boolean } = {},
): UseOnboardingResult {
  const preview = options.preview === true;
  const initialFirstRun = options.initialFirstRun === true;
  const [steps, setSteps] = useState<OnboardingStepStatus[]>([]);
  const [profile, setProfile] = useState<OnboardingAppProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [firstRun, setFirstRun] = useState(preview || initialFirstRun);
  const [completeFirstRunError, setCompleteFirstRunError] = useState<
    string | null
  >(null);
  const stepsRef = useRef<OnboardingStepStatus[]>([]);
  const mountedRef = useRef(true);
  const fetchGenerationRef = useRef(0);

  useEffect(() => {
    setFirstRun(preview || initialFirstRun);
  }, [initialFirstRun, preview]);

  const fetchAll = useCallback(async () => {
    const fetchGeneration = ++fetchGenerationRef.current;
    try {
      const summaryUrl = agentNativePath(
        preview
          ? "/_agent-native/onboarding/summary?preview=1"
          : "/_agent-native/onboarding/summary",
      );
      const firstRunPromise = preview
        ? Promise.resolve(true).then((value) => {
            dispatchFirstRunOnboardingStatus(value);
            return value;
          })
        : initialFirstRun
          ? Promise.resolve(true)
          : fetchFirstRunOnboardingStatus();
      const summaryController =
        typeof AbortController === "undefined" ? null : new AbortController();
      let summaryTimeoutId: ReturnType<typeof setTimeout> | undefined;
      const summaryTimeout = new Promise<never>((_resolve, reject) => {
        summaryTimeoutId = setTimeout(() => {
          summaryController?.abort();
          reject(new Error("onboarding summary timed out"));
        }, ONBOARDING_SUMMARY_TIMEOUT_MS);
      });
      const summaryRequest = (async () => {
        const response = await fetch(summaryUrl, {
          ...(summaryController ? { signal: summaryController.signal } : {}),
        });
        if (!response.ok) {
          throw new Error(`summary: ${response.status}`);
        }
        return (await response.json()) as OnboardingSummary;
      })();
      const [summary, firstRunRes] = await Promise.all([
        Promise.race([summaryRequest, summaryTimeout]),
        firstRunPromise,
      ]).finally(() => {
        if (summaryTimeoutId !== undefined) clearTimeout(summaryTimeoutId);
        summaryController?.abort();
      });
      if (
        !mountedRef.current ||
        fetchGeneration !== fetchGenerationRef.current
      ) {
        return;
      }
      const previousSteps = stepsRef.current;
      if (previousSteps.length > 0) {
        for (const [stepIndex, step] of summary.steps.entries()) {
          const previousStep = previousSteps.find(
            (previous) => previous.id === step.id,
          );
          if (step.complete && !previousStep?.complete) {
            trackOnboardingEvent("onboarding_step_completed", {
              flow: "checklist",
              step_id: step.id,
              step_index: stepIndex,
            });
          }
        }
      }
      stepsRef.current = summary.steps;
      setSteps(summary.steps);

      setProfile(summary.profile);

      if (preview) {
        setFirstRun(true);
      } else if (!initialFirstRun) {
        setFirstRun(firstRunRes === true);
      }

      setDismissed(!!summary.dismissed);
      setError(null);
    } catch (e) {
      if (
        !mountedRef.current ||
        fetchGeneration !== fetchGenerationRef.current
      ) {
        return;
      }
      setError(e instanceof Error ? e.message : "Failed to load onboarding");
    } finally {
      if (
        mountedRef.current &&
        fetchGeneration === fetchGenerationRef.current
      ) {
        setLoading(false);
      }
    }
  }, [preview]);

  useEffect(() => {
    mountedRef.current = true;
    let initialFetchRan = false;
    const cancelInitialFetch = scheduleAfterPaint(() => {
      initialFetchRan = true;
      if (mountedRef.current) void fetchAll();
    });
    const refetchOnFocus = () => {
      if (!initialFetchRan) {
        initialFetchRan = true;
        cancelInitialFetch();
      }
      void fetchAll();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refetchOnFocus();
    };
    const onFocus = () => refetchOnFocus();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      fetchGenerationRef.current += 1;
      cancelInitialFetch();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchAll]);

  const complete = useCallback(
    async (id: string) => {
      const response = await fetch(
        agentNativePath(
          `/_agent-native/onboarding/steps/${encodeURIComponent(id)}/complete`,
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (!response.ok)
        throw new Error(`onboarding step failed: ${response.status}`);
      trackOnboardingEvent("onboarding_step_completed", {
        flow: "checklist",
        step_id: id,
      });
      await fetchAll();
    },
    [fetchAll],
  );

  const dismiss = useCallback(async () => {
    setDismissed(true);
    const currentStepIndex = steps.findIndex((step) => !step.complete);
    const currentStep = steps[currentStepIndex];
    trackOnboardingEvent("onboarding_dismissed", {
      flow: "checklist",
      ...(currentStepIndex >= 0
        ? {
            step_id: currentStep?.id,
            step_index: currentStepIndex,
          }
        : {}),
      reason: "user_action",
    });
    await fetch(agentNativePath("/_agent-native/onboarding/dismiss"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetchAll();
  }, [fetchAll, steps]);

  const reopen = useCallback(async () => {
    setDismissed(false);
    trackOnboardingEvent("onboarding_reopened", {
      flow: "checklist",
      reason: "user_action",
    });
    await fetch(agentNativePath("/_agent-native/onboarding/reopen"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetchAll();
  }, [fetchAll]);

  const completeFirstRun = useCallback(async () => {
    if (preview) {
      setFirstRun(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("agent-native:first-run-completed"),
        );
      }
      return;
    }
    setCompleteFirstRunError(null);
    let response: Response;
    try {
      response = await fetch(
        agentNativePath("/_agent-native/onboarding/first-run/complete"),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "first-run completion request failed";
      trackEvent("onboarding_failed", {
        flow: "first_run",
        stage: "complete",
        reason: "network_error",
      });
      setCompleteFirstRunError(message);
      throw e instanceof Error ? e : new Error(message);
    }
    if (!response.ok) {
      const message = `first-run completion failed: ${response.status}`;
      trackEvent("onboarding_failed", {
        flow: "first_run",
        stage: "complete",
        reason: "http_error",
        status_code: response.status,
      });
      setCompleteFirstRunError(message);
      throw new Error(message);
    }
    trackOnboardingEvent("onboarding_completed", { flow: "first_run" });
    setFirstRun(false);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("agent-native:first-run-completed"));
    }
    await fetchAll();
  }, [fetchAll, preview]);

  const totalCount = steps.length;
  const completeCount = steps.filter((s) => s.complete).length;
  const allComplete = steps.filter((s) => s.required).every((s) => s.complete);

  const currentStepId =
    steps.find((s) => s.required && !s.complete)?.id ??
    steps.find((s) => !s.complete)?.id ??
    null;

  return {
    steps,
    profile,
    loading,
    error,
    currentStepId,
    completeCount,
    totalCount,
    allComplete,
    dismissed,
    refresh: fetchAll,
    complete,
    dismiss,
    reopen,
    firstRun,
    completeFirstRun,
    completeFirstRunError,
  };
}

export type { OnboardingMethod, OnboardingStepStatus };
