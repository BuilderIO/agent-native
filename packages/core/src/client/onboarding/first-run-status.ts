import { agentNativePath } from "../api-path.js";

export const FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT =
  "agent-native:first-run-status-resolved";

const FIRST_RUN_STATUS_TIMEOUT_MS = 10_000;

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
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error("first-run status timed out"));
    }, FIRST_RUN_STATUS_TIMEOUT_MS);
  });
  try {
    const response = await Promise.race([
      fetch(agentNativePath("/_agent-native/onboarding/first-run/status"), {
        cache: "no-store",
        credentials: "same-origin",
        ...(controller ? { signal: controller.signal } : {}),
      }),
      timeout,
    ]);
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
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

/** Save the optional role selected during the shared first-run flow. */
export async function saveFirstRunOnboardingRole(role: string): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/onboarding/first-run/role"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    },
  );
  if (!response.ok) {
    throw new Error(`first-run role save failed: ${response.status}`);
  }
}
