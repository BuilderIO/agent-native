import { FIRST_RUN_ONBOARDING_COOKIE } from "../../shared/first-run-onboarding.js";
import { getOrCreateAnalyticsSessionId } from "../analytics-session.js";
import { agentNativePath } from "../api-path.js";

export const FIRST_RUN_ONBOARDING_STATUS_RESOLVED_EVENT =
  "agent-native:first-run-status-resolved";

const FIRST_RUN_STATUS_TIMEOUT_MS = 5_000;

let firstRunStatusRequest: Promise<boolean> | null = null;

export type FirstRunCookieState = "present" | "absent" | "unreadable";

export function readFirstRunOnboardingCookieState(): FirstRunCookieState {
  if (typeof document === "undefined") return "present";
  const prefix = `${FIRST_RUN_ONBOARDING_COOKIE}=`;
  try {
    const present = document.cookie.split(";").some((cookie) => {
      const entry = cookie.trim();
      return entry.startsWith(prefix) && entry.slice(prefix.length) === "1";
    });
    return present ? "present" : "absent";
  } catch (error) {
    if (error instanceof DOMException && error.name === "SecurityError") {
      return "unreadable";
    }
    throw error;
  }
}

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

/** Complete an app-owned first-run surface only after its native saves succeed. */
export interface FirstRunCompletionScope {
  expectedUserEmail: string;
  expectedOrgId: string;
}

export async function completeFirstRunOnboarding(
  scope?: FirstRunCompletionScope,
): Promise<void> {
  const response = await fetch(
    agentNativePath("/_agent-native/onboarding/first-run/complete"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(scope ?? {}),
    },
  );
  if (!response.ok) {
    throw new Error(`first-run completion failed: ${response.status}`);
  }
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== "object" ||
    !("ok" in result) ||
    result.ok !== true
  ) {
    throw new Error("First-run completion was not acknowledged.");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("agent-native:first-run-completed"));
  }
}
