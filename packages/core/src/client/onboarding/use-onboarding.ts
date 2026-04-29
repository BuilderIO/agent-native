/**
 * `useOnboarding` — client hook for the framework onboarding system.
 *
 * Fetches `/_agent-native/onboarding/steps` on mount, after any user-initiated
 * mutation (complete / dismiss / reopen), and when the tab regains focus.
 * No polling — onboarding state changes are user-driven, so a poll loop just
 * burns the DB and amplifies transient network errors.
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

export function useOnboarding(
  options: { preview?: boolean } = {},
): UseOnboardingResult {
  const preview = options.preview === true;
  const [steps, setSteps] = useState<OnboardingStepStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const mountedRef = useRef(true);

  const fetchAll = useCallback(async () => {
    try {
      const stepsUrl = preview
        ? "/_agent-native/onboarding/steps?preview=1"
        : "/_agent-native/onboarding/steps";
      const [stepsRes, dismissRes] = await Promise.all([
        fetch(stepsUrl),
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
  }, [preview]);

  useEffect(() => {
    mountedRef.current = true;
    fetchAll();
    // Refetch when the tab regains focus — picks up any changes the agent
    // made while the user was away (or that another tab made).
    const onVisibility = () => {
      if (document.visibilityState === "visible") fetchAll();
    };
    const onFocus = () => fetchAll();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchAll]);

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
