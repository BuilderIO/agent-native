/**
 * `useOnboardingPreviewMode` — toggle that the dev overlay flips to preview the
 * new-user onboarding flow without touching real setup state.
 *
 * Storage key matches the dev-overlay option id `framework-onboarding/show-as-new-user`
 * so toggling the option in the overlay automatically activates preview mode here.
 * The `?onboarding=preview` query also enables it for an existing account.
 */

import { useEffect, useState } from "react";

export const ONBOARDING_PREVIEW_STORAGE_KEY =
  "agent-native-dev-overlay-option-framework-onboarding-show-as-new-user";
export const ONBOARDING_PREVIEW_QUERY_PARAM = "onboarding";
export const ONBOARDING_PREVIEW_QUERY_VALUE = "preview";
export const ONBOARDING_PREVIEW_STEP_QUERY_PARAM = "step";

export const ONBOARDING_PREVIEW_STEPS = [
  "role",
  "choice",
  "connecting",
  "extension",
  "references",
] as const;

export type OnboardingPreviewStep = (typeof ONBOARDING_PREVIEW_STEPS)[number];

export function isOnboardingPreviewQuery(search: string): boolean {
  return (
    new URLSearchParams(search).get(ONBOARDING_PREVIEW_QUERY_PARAM) ===
    ONBOARDING_PREVIEW_QUERY_VALUE
  );
}

export function getOnboardingPreviewStep(
  search: string,
): OnboardingPreviewStep | null {
  if (!isOnboardingPreviewQuery(search)) return null;
  const step = new URLSearchParams(search).get(
    ONBOARDING_PREVIEW_STEP_QUERY_PARAM,
  );
  return ONBOARDING_PREVIEW_STEPS.includes(step as OnboardingPreviewStep)
    ? (step as OnboardingPreviewStep)
    : null;
}

function readPreview(): boolean {
  if (typeof window === "undefined") return false;
  if (isOnboardingPreviewQuery(window.location.search)) return true;
  try {
    return (
      JSON.parse(
        window.localStorage.getItem(ONBOARDING_PREVIEW_STORAGE_KEY) || "false",
      ) === true
    );
  } catch {
    return false;
  }
}

function readPreviewStep(): OnboardingPreviewStep | null {
  if (typeof window === "undefined") return null;
  return getOnboardingPreviewStep(window.location.search);
}

export function useOnboardingPreviewMode(): boolean {
  const [val, setVal] = useState(readPreview);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setVal(readPreview());
    // Leaving the preview URL (the first-run Settings handoff) ends preview.
    window.addEventListener("popstate", onChange);
    window.addEventListener("storage", onChange);
    window.addEventListener("agent-native-dev-overlay:changed", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener("agent-native-dev-overlay:changed", onChange);
    };
  }, []);
  return val;
}

export function useOnboardingPreviewStep(): OnboardingPreviewStep | null {
  const search = typeof window === "undefined" ? "" : window.location.search;
  const [step, setStep] = useState(() => getOnboardingPreviewStep(search));
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setStep(readPreviewStep());
    onChange();
    window.addEventListener("popstate", onChange);
    window.addEventListener("storage", onChange);
    window.addEventListener("agent-native-dev-overlay:changed", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("storage", onChange);
      window.removeEventListener("agent-native-dev-overlay:changed", onChange);
    };
  }, [search]);
  return step;
}
