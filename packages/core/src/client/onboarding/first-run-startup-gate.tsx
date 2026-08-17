import React, {
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useState,
} from "react";

import { DefaultSpinner } from "../DefaultSpinner.js";
import { isFirstRunOnboardingEnabled } from "./first-run-enabled.js";
import { fetchFirstRunOnboardingStatus } from "./first-run-status.js";
import { useOnboardingPreviewMode } from "./use-preview-mode.js";

const FirstRunOnboarding = lazy(() =>
  import("./FirstRunOnboarding.js").then((module) => ({
    default: module.FirstRunOnboarding,
  })),
);

type FirstRunDecision = "pending" | "eligible" | "ineligible";

const FirstRunOnboardingGateContext = createContext(false);

export function useFirstRunOnboardingGateOwnsSurface(): boolean {
  return useContext(FirstRunOnboardingGateContext);
}

export function FirstRunOnboardingStartupGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const previewMode = useOnboardingPreviewMode();
  const shouldResolve = isFirstRunOnboardingEnabled() && !previewMode;
  const [decision, setDecision] = useState<FirstRunDecision>(
    shouldResolve ? "pending" : "ineligible",
  );

  useEffect(() => {
    if (!shouldResolve) {
      setDecision("ineligible");
      return;
    }

    let cancelled = false;
    const handleFirstRunCompleted = () => {
      cancelled = true;
      setDecision("ineligible");
    };
    window.addEventListener(
      "agent-native:first-run-completed",
      handleFirstRunCompleted,
    );
    setDecision("pending");
    void fetchFirstRunOnboardingStatus()
      .then((firstRun) => {
        if (!cancelled) setDecision(firstRun ? "eligible" : "ineligible");
      })
      .catch(() => {
        if (!cancelled) setDecision("ineligible");
      });

    return () => {
      cancelled = true;
      window.removeEventListener(
        "agent-native:first-run-completed",
        handleFirstRunCompleted,
      );
    };
  }, [shouldResolve]);

  const ownsSurface = decision === "eligible";
  const hideApp = decision !== "ineligible";
  const app = hideApp ? (
    <div
      aria-hidden="true"
      data-first-run-app-hidden="true"
      style={{ display: "contents", visibility: "hidden" }}
    >
      {children}
    </div>
  ) : (
    children
  );

  return (
    <FirstRunOnboardingGateContext.Provider value={ownsSurface}>
      {app}
      {decision === "pending" && <FirstRunOnboardingStartupLoading />}
      {ownsSurface && (
        <Suspense fallback={<FirstRunOnboardingStartupLoading />}>
          <FirstRunOnboarding initialFirstRun />
        </Suspense>
      )}
    </FirstRunOnboardingGateContext.Provider>
  );
}

function FirstRunOnboardingStartupLoading() {
  return (
    <div
      data-first-run-startup-loading="true"
      aria-busy="true"
      className="fixed inset-0 z-[110] bg-background"
    >
      <DefaultSpinner />
    </div>
  );
}
