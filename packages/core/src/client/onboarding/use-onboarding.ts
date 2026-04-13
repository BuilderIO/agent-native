/**
 * `useOnboarding` — client hook for the framework onboarding system.
 *
 * Polls `/_agent-native/onboarding/steps` every ~3s (matching the existing
 * poll cadence used by `useDbSync`) and exposes completion helpers.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OnboardingMethod,
  OnboardingStepStatus,
} from "../../onboarding/types.js";

export interface UseOnboardingResult {
  steps: OnboardingStepStatus[];
  loading: boolean;
  error: string | null;
  /** Active step = first required+incomplete, else first incomplete. */
  currentStepId: string | null;
  completeCount: number;
  totalCount: number;
  /** True when every required step is complete. */
  allComplete: boolean;
  /** User dismissed the banner via the X button. */
  dismissed: boolean;
  /** Refetch steps immediately. */
  refresh: () => Promise<void>;
  /** Mark a step complete via the server-side override. */
  complete: (id: string) => Promise<void>;
  /** Dismiss the banner permanently (until server-side reset). */
  dismiss: () => Promise<void>;
  /** Re-open the panel after dismissal. */
  reopen: () => Promise<void>;
}

const DEFAULT_POLL_MS = 3000;

export function useOnboarding(
  options: { intervalMs?: number } = {},
): UseOnboardingResult {
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_MS;
  const [steps, setSteps] = useState<OnboardingStepStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const [stepsRes, dismissRes] = await Promise.all([
        fetch("/_agent-native/onboarding/steps"),
        fetch("/_agent-native/onboarding/dismissed"),
      ]);
      if (!mountedRef.current) return;
      if (!stepsRes.ok) {
        throw new Error(`steps: ${stepsRes.status}`);
      }
      const stepsData: OnboardingStepStatus[] = await stepsRes.json();
      setSteps(stepsData);

      if (dismissRes.ok) {
        const d = (await dismissRes.json()) as {
          dismissed?: boolean;
          allComplete?: boolean;
        };
        setDismissed(!!d.dismissed);
      }
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load onboarding");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    const t = setInterval(fetchAll, intervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(t);
    };
  }, [fetchAll, intervalMs]);

  const complete = useCallback(
    async (id: string) => {
      await fetch(
        `/_agent-native/onboarding/steps/${encodeURIComponent(id)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      await fetchAll();
    },
    [fetchAll],
  );

  const dismiss = useCallback(async () => {
    setDismissed(true); // optimistic
    await fetch("/_agent-native/onboarding/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetchAll();
  }, [fetchAll]);

  const reopen = useCallback(async () => {
    setDismissed(false); // optimistic
    await fetch("/_agent-native/onboarding/reopen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetchAll();
  }, [fetchAll]);

  const totalCount = steps.length;
  const completeCount = steps.filter((s) => s.complete).length;
  const allComplete = steps.filter((s) => s.required).every((s) => s.complete);

  const currentStepId =
    steps.find((s) => s.required && !s.complete)?.id ??
    steps.find((s) => !s.complete)?.id ??
    null;

  return {
    steps,
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
  };
}

/** Re-export type for convenience. */
export type { OnboardingMethod, OnboardingStepStatus };
