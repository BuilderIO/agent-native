import { trackEvent } from "@agent-native/core/client/analytics";
import {
  createOnboardingCorrelationId,
  trackOnboardingEvent,
} from "@agent-native/core/client/onboarding/use-onboarding";
import {
  hasBuilderOAuthCredential,
  useBuilderConnectFlow,
  type BuilderConnectionScope,
} from "@agent-native/toolkit/app/settings";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchVideoStorageStatus,
  VIDEO_STORAGE_STATUS_KEY,
} from "@/hooks/use-video-storage-status";

const STORAGE_POLL_MS = 2000;
const STORAGE_POLL_TIMEOUT_MS = 2 * 60_000;

export type BuilderStorageActivationState =
  | "loading"
  | "idle"
  | "creating"
  | "finishing"
  | "connected"
  | "account-exists"
  | "failed"
  | "check-failed"
  | "not-allowed";

export type FreeClipsOfferSurface =
  | "sidebar_card"
  | "offer_dialog"
  | "record_limit_card"
  | "library_limit_popover"
  | "record_last_clip_prompt";

/**
 * Why the offer showed: one free clip left or none left (library milestones),
 * the first time the last clip would be used, the sidebar count opening the
 * dialog, or a connect link from the desktop app or extension.
 */
export type FreeClipsOfferMilestone =
  | "last_clip"
  | "used_up"
  | "last_clip_intent"
  | "count"
  | "connect_request";

/**
 * Impressions and dismissals of the free clips offer. Clicks and conversions
 * come from the Builder.io connect flow's own builder_connect_clicked,
 * builder_connect_succeeded and builder_connect_failed, keyed by the same
 * source and flow.
 */
export function trackFreeClipsOffer(
  name: "clips_free_clips_offer_viewed" | "clips_free_clips_offer_dismissed",
  properties: {
    surface: FreeClipsOfferSurface;
    milestone: FreeClipsOfferMilestone;
    remaining: number;
    limit: number;
    /** What the user was about to do, where the surface serves both. */
    action?: "record" | "upload";
  },
): void {
  try {
    trackEvent(name, properties);
  } catch (err) {
    console.warn(`[free-clips] ${name} tracking failed:`, err);
  }
}

function trackStorageStep(
  name:
    | "onboarding_step_viewed"
    | "onboarding_step_completed"
    | "onboarding_method_clicked",
  properties: Record<string, unknown>,
): void {
  try {
    trackOnboardingEvent(name, { step_id: "file-storage", ...properties });
  } catch (err) {
    console.warn(`[free-clips] ${name} tracking failed:`, err);
  }
}

/**
 * One click from "no Builder.io account" to Builder.io storage: creates the
 * account in place when the deployment can provision one, otherwise opens
 * Builder.io's own sign-in, then waits until Clips reads storage as its own.
 */
export function useBuilderStorageActivation({
  source,
  flow,
}: {
  /** Which surface the click came from, e.g. clips_sidebar_free_clips. */
  source: string;
  /** What prompted it, e.g. free_clips_last_clip or free_clips_used_up. */
  flow: string;
}) {
  const queryClient = useQueryClient();
  const [stepViewId] = useState(createOnboardingCorrelationId);
  // The same file-storage step events the storage setup card sends, so the
  // onboarding funnel counts storage connected from these surfaces too.
  const stepProperties = {
    flow: source,
    step_view_id: stepViewId,
    setup_reason: flow,
  };
  const stepPropertiesRef = useRef(stepProperties);
  stepPropertiesRef.current = stepProperties;
  const [finishing, setFinishing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [storageTimedOut, setStorageTimedOut] = useState(false);
  // Set when the wait ended because storage couldn't be read, not because
  // Builder.io setup failed; retrying then re-reads instead of setting up again.
  const [storageCheckFailed, setStorageCheckFailed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const isMounted = useCallback(() => mountedRef.current, []);

  const stopPoll = useCallback(() => {
    if (pollRef.current !== null) clearTimeout(pollRef.current);
    pollRef.current = null;
  }, []);

  const waitForStorage = useCallback(() => {
    stopPoll();
    setFinishing(true);
    setStorageTimedOut(false);
    setStorageCheckFailed(false);
    const startedAt = Date.now();
    let lastReadFailed = false;
    const tick = async () => {
      if (!mountedRef.current) return;
      try {
        const status = await fetchVideoStorageStatus({ timeoutMs: 10_000 });
        // The card can unmount while the read is in flight.
        if (!isMounted()) return;
        if (status.mode === "own") {
          trackStorageStep("onboarding_step_completed", {
            ...stepPropertiesRef.current,
            method_id: status.activeProvider?.id ?? "builder",
          });
          setFinishing(false);
          setConnected(true);
          queryClient.setQueryData(VIDEO_STORAGE_STATUS_KEY, status);
          return;
        }
        lastReadFailed = false;
      } catch (err) {
        if (!isMounted()) return;
        lastReadFailed = true;
        console.warn("[builder-storage] storage status read failed:", err);
      }
      if (Date.now() - startedAt > STORAGE_POLL_TIMEOUT_MS) {
        setFinishing(false);
        if (lastReadFailed) setStorageCheckFailed(true);
        else setStorageTimedOut(true);
        return;
      }
      pollRef.current = setTimeout(() => void tick(), STORAGE_POLL_MS);
    };
    void tick();
  }, [isMounted, queryClient, stopPoll]);

  useEffect(() => {
    trackStorageStep("onboarding_step_viewed", stepPropertiesRef.current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPoll();
    };
  }, [stopPoll]);

  const builder = useBuilderConnectFlow({
    provisionAccount: true,
    trackingSource: source,
    trackingFlow: flow,
    onConnected: waitForStorage,
  });
  const accountExists =
    builder.accountExists || hasBuilderOAuthCredential(builder);
  const scope: BuilderConnectionScope | null =
    builder.effective === "org" && builder.canConnect.org
      ? "org"
      : builder.effective === "personal" && builder.canConnect.personal
        ? "personal"
        : builder.canConnect.org
          ? "org"
          : builder.canConnect.personal
            ? "personal"
            : null;
  const canProvision =
    builder.statusResolved && builder.agentNativeProvisioningEnabled;

  const start = useCallback(
    (provisionAccount: boolean) => {
      if (!scope) return;
      trackStorageStep("onboarding_method_clicked", {
        ...stepPropertiesRef.current,
        method_id: "builder",
      });
      setStorageTimedOut(false);
      builder.start({ provisionAccount, scope });
    },
    [builder.start, scope],
  );

  const activate = useCallback(
    () => start(canProvision && !accountExists),
    [accountExists, canProvision, start],
  );
  const signIn = useCallback(() => start(false), [start]);

  const state: BuilderStorageActivationState = connected
    ? "connected"
    : finishing
      ? "finishing"
      : storageCheckFailed
        ? "check-failed"
        : builder.connecting
          ? "creating"
          : !builder.statusResolved
            ? "loading"
            : !scope
              ? "not-allowed"
              : accountExists
                ? "account-exists"
                : builder.error || storageTimedOut
                  ? "failed"
                  : "idle";

  return {
    state,
    /** Whether the next activate() creates a new account, so its terms apply. */
    createsAccount: canProvision && !accountExists,
    activate,
    signIn,
    /** After "check-failed": read storage again without starting setup over. */
    recheck: waitForStorage,
    cancel: builder.cancel,
  };
}
