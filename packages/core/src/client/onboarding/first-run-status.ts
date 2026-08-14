import { agentNativePath } from "../api-path.js";

export const FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT =
  "agent-native:first-run-status-resolved";

export interface FirstRunOnboardingStatusDetail {
  firstRun: boolean;
}

export function dispatchFirstRunOnboardingStatus(firstRun: boolean): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<FirstRunOnboardingStatusDetail>(
      FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT,
      { detail: { firstRun } },
    ),
  );
}

/** Fetch the server-owned first-run decision and notify other initial flows. */
export async function fetchFirstRunOnboardingStatus(): Promise<boolean> {
  try {
    const response = await fetch(
      agentNativePath("/_agent-native/onboarding/first-run/status"),
    );
    if (!response.ok) {
      throw new Error(`first-run status: ${response.status}`);
    }
    const data = (await response.json()) as { firstRun?: unknown };
    const firstRun = data.firstRun === true;
    dispatchFirstRunOnboardingStatus(firstRun);
    return firstRun;
  } catch (error) {
    // The safe UI behavior for an unavailable eligibility check is to show no
    // onboarding. Callers can still surface the error through their own path.
    dispatchFirstRunOnboardingStatus(false);
    throw error;
  }
}
