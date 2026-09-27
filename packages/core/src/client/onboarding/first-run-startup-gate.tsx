import React, {
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useState,
} from "react";

import { AppShellSkeleton } from "../AppShellSkeleton.js";
import { isFirstRunOnboardingEnabled } from "./first-run-enabled.js";
import {
  fetchFirstRunOnboardingStatus,
  readFirstRunOnboardingCookieState,
} from "./first-run-status.js";
import { trackOnboardingEvent } from "./use-onboarding.js";
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
  fallback = <AppShellSkeleton />,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const previewMode = useOnboardingPreviewMode();
  const [firstRunCookieState] = useState(readFirstRunOnboardingCookieState);
  useEffect(() => {
    if (firstRunCookieState === "unreadable") {
      console.warn(
        "[onboarding] first-run cookie is unreadable; skipping startup gate",
      );
    }
  }, [firstRunCookieState]);
  const shouldResolve =
    isFirstRunOnboardingEnabled() &&
    !previewMode &&
    firstRunCookieState === "present";
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
      trackOnboardingEvent("onboarding_app_entered", { flow: "first_run" });
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
  const app = shouldResolve ? (
    <div
      aria-hidden={hideApp ? "true" : undefined}
      data-first-run-app-hidden={hideApp ? "true" : undefined}
      style={{
        display: "contents",
        ...(hideApp ? { visibility: "hidden" } : {}),
      }}
    >
      {children}
    </div>
  ) : (
    children
  );

  return (
    <FirstRunOnboardingGateContext.Provider value={ownsSurface}>
      {app}
      {decision === "pending" && (
        <FirstRunOnboardingStartupLoading fallback={fallback} />
      )}
      {ownsSurface && (
        <Suspense
          fallback={<FirstRunOnboardingStartupLoading fallback={fallback} />}
        >
          <FirstRunOnboarding initialFirstRun />
        </Suspense>
      )}
    </FirstRunOnboardingGateContext.Provider>
  );
}

function FirstRunOnboardingStartupLoading({
  fallback,
}: {
  fallback: React.ReactNode;
}) {
  return (
    <div
      role="status"
      aria-label="Loading application"
      data-first-run-startup-loading="true"
      className="fixed inset-0 z-[110] bg-background"
    >
      <div inert>{fallback}</div>
    </div>
  );
}
