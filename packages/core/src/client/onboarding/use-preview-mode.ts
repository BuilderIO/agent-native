/**
 * `useOnboardingPreviewMode` — toggle that the dev overlay flips to preview the
 * new-user onboarding flow without touching real setup state.
 *
 * Storage key matches the dev-overlay option id `framework-onboarding/show-as-new-user`
 * so toggling the option in the overlay automatically activates preview mode here.
 */

import { useEffect, useState } from "react";

export const ONBOARDING_PREVIEW_STORAGE_KEY =
  "agent-native-dev-overlay-option-framework-onboarding-show-as-new-user";

function readPreview(): boolean {
  if (typeof window === "undefined") return false;
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

export function useOnboardingPreviewMode(): boolean {
  const [val, setVal] = useState(readPreview);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => setVal(readPreview());
    window.addEventListener("storage", onChange);
    window.addEventListener("agent-native-dev-overlay:changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("agent-native-dev-overlay:changed", onChange);
    };
  }, []);
  return val;
}
