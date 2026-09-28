import { getOrCreateAnalyticsSessionId } from "../analytics-session.js";
import { agentNativePath } from "../api-path.js";

export const FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT =
  "agent-native:first-run-status-resolved";

const FIRST_RUN_STATUS_TIMEOUT_MS = 10_000;

let firstRunStatusRequest: Promise<boolean> | null = null;

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

async function requestFirstRunOnboardingStatus(): Promise<boolean> {
  const controller =
    typeof AbortController === "undefined" ? null : new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort();
      reject(new Error("first-run status timed out"));
    }, FIRST_RUN_STATUS_TIMEOUT_MS);
  });
  try {
    const firstRun = await Promise.race([
      (async () => {
        const response = await fetch(
          agentNativePath("/_agent-native/onboarding/first-run/status"),
          {
            cache: "no-store",
            credentials: "same-origin",
            ...(controller ? { signal: controller.signal } : {}),
          },
        );
        if (!response.ok) {
          throw new Error(`first-run status: ${response.status}`);
        }
        const data = (await response.json()) as { firstRun?: unknown };
        return data.firstRun === true;
      })(),
      timeout,
    ]);
    dispatchFirstRunOnboardingStatus(firstRun);
    return firstRun;
  } catch (error) {
    dispatchFirstRunOnboardingStatus(false);
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function saveFirstRunOnboardingRole(role: string): Promise<void> {
  const browserSessionId = getOrCreateAnalyticsSessionId();
  const response = await fetch(
    agentNativePath("/_agent-native/onboarding/first-run/role"),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(browserSessionId
          ? { "X-Agent-Native-Session-Id": browserSessionId }
          : {}),
      },
      credentials: "same-origin",
      body: JSON.stringify({ role }),
    },
  );
  if (!response.ok) {
    throw new Error(`first-run role save failed: ${response.status}`);
  }
}

export function fetchFirstRunOnboardingStatus(): Promise<boolean> {
  if (firstRunStatusRequest) return firstRunStatusRequest;
  firstRunStatusRequest = requestFirstRunOnboardingStatus().finally(() => {
    firstRunStatusRequest = null;
  });
  return firstRunStatusRequest;
}
