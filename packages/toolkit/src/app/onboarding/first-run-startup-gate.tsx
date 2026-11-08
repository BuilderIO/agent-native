import { useT } from "@agent-native/core/client/i18n";
import { isFirstRunOnboardingEnabled } from "@agent-native/core/client/onboarding/first-run-enabled";
import { fetchFirstRunOnboardingStatus } from "@agent-native/core/client/onboarding/first-run-status";
import { trackOnboardingEvent } from "@agent-native/core/client/onboarding/use-onboarding";
import { useOnboardingPreviewMode } from "@agent-native/core/client/onboarding/use-preview-mode";
import { useSessionPreloading } from "@agent-native/core/client/use-session";
import { FIRST_RUN_ONBOARDING_COOKIE } from "@agent-native/core/shared/first-run-onboarding";
import { Button } from "@agent-native/toolkit/ui/button";
import React, { Suspense, lazy, useEffect, useState } from "react";

import { FirstRunOnboardingGateContext } from "./first-run-startup-gate-context.js";

export { useFirstRunOnboardingGateOwnsSurface } from "./first-run-startup-gate-context.js";

const FirstRunOnboarding = lazy(() =>
  import("./FirstRunOnboarding.js").then((module) => ({
    default: module.FirstRunOnboarding,
  })),
);

type FirstRunDecision = "pending" | "eligible" | "ineligible" | "unavailable";
type FirstRunCookieState = "present" | "absent" | "unreadable";

const FIRST_RUN_STATUS_MAX_ATTEMPTS = 2;
const FIRST_RUN_STATUS_RETRY_DELAY_MS = 500;

// A standalone app's Vite dev server pre-bundles `app/chat` (the sidebar and
// panel) but serves `app/providers` (this gate) unbundled, so this module can
// load twice. One context per copy left the sidebar reading `false` and
// mounting a second questionnaire behind the gate, revealed at step 1 once
// the gate stepped aside. Every copy shares one context through globalThis.
function readFirstRunOnboardingCookieState(): FirstRunCookieState {
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

export function FirstRunOnboardingStartupGate({
  children,
  suppressSurface = false,
}: {
  children: React.ReactNode;
  suppressSurface?: boolean;
}) {
  const t = useT();
  const previewMode = useOnboardingPreviewMode();
  const preloading = useSessionPreloading();
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
  const [retryNumber, setRetryNumber] = useState(0);

  useEffect(() => {
    if (!shouldResolve) {
      setDecision("ineligible");
      return;
    }
    // Under a hinted preload the session is unknown; the status read and the
    // onboarding_started event it leads to would carry the anonymous identity.
    if (preloading) return;

    let cancelled = false;
    let retryTimeout: number | undefined;
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
    const resolveStatus = (attempt: number) => {
      void fetchFirstRunOnboardingStatus()
        .then((firstRun) => {
          if (!cancelled) setDecision(firstRun ? "eligible" : "ineligible");
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          if (attempt < FIRST_RUN_STATUS_MAX_ATTEMPTS) {
            retryTimeout = window.setTimeout(
              () => resolveStatus(attempt + 1),
              FIRST_RUN_STATUS_RETRY_DELAY_MS,
            );
            return;
          }
          console.warn(
            "[onboarding] first-run status remained unavailable after retry",
            error,
          );
          setDecision("unavailable");
        });
    };
    resolveStatus(1);

    return () => {
      cancelled = true;
      if (retryTimeout !== undefined) window.clearTimeout(retryTimeout);
      window.removeEventListener(
        "agent-native:first-run-completed",
        handleFirstRunCompleted,
      );
    };
  }, [retryNumber, shouldResolve, preloading]);

  const ownsSurface = !suppressSurface && decision === "eligible";
  const gateOwnsSurface = !suppressSurface && decision !== "ineligible";

  return (
    <FirstRunOnboardingGateContext.Provider value={gateOwnsSurface}>
      <div
        aria-hidden={gateOwnsSurface ? "true" : undefined}
        data-first-run-app-inert={gateOwnsSurface ? "true" : undefined}
        inert={gateOwnsSurface}
        style={{ display: "contents" }}
      >
        {children}
      </div>
      {!suppressSurface && decision === "unavailable" && (
        <div
          role="alert"
          data-first-run-status-error="true"
          className="fixed inset-x-4 bottom-4 z-[110] mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3 text-start shadow-lg"
        >
          <span className="text-sm text-muted-foreground">
            {t("agentChat.common.chunkLoadFailed")}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setRetryNumber((current) => current + 1)}
          >
            {t("agentChat.common.retry")}
          </Button>
        </div>
      )}
      {ownsSurface && (
        <Suspense fallback={null}>
          <FirstRunOnboarding initialFirstRun />
        </Suspense>
      )}
    </FirstRunOnboardingGateContext.Provider>
  );
}
