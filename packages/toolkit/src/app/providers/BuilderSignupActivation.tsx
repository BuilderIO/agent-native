import { track } from "@agent-native/core/client/analytics";
import {
  activateBuilderSignupAssignment,
  startBuilderSignupActivation,
} from "@agent-native/core/client/auth/builder-signup";
import { useT } from "@agent-native/core/client/i18n";
import { useSession } from "@agent-native/core/client/use-session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "../../ui/button.js";
import { Skeleton } from "../../ui/skeleton.js";
import {
  StartupInteractionContext,
  useStartupInteractionBlocked,
} from "../onboarding/first-run-startup-gate-context.js";
import { FirstRunOnboardingStartupGate } from "../onboarding/first-run-startup-gate.js";

const attempts = new Map<string, Promise<unknown>>();

// Runs a pending Builder signup activation for the signed-in user and reports
// whether it is still in progress. Anything outside the cover that opens UI,
// such as a keyboard shortcut or a portaled menu, has to check this itself.
export function useBuilderSignupActivation(
  userId: string | undefined,
  experimentId: string,
): {
  activating: boolean;
  resolving: boolean;
  statusError: boolean;
  retryStatus: () => void;
} {
  const queryClient = useQueryClient();
  const attemptKey = `${experimentId}:${userId}`;
  const recoveryAttempts = useRef(new Map<string, number>());
  const [activation, setActivation] = useState<{
    userId: string;
    status: "running" | "checking" | "paused" | "settled";
    failedAt?: number;
  }>();
  const eligibility = useQuery({
    queryKey: ["builder-signup-eligibility", experimentId, userId],
    queryFn: startBuilderSignupActivation,
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: 1,
    refetchInterval:
      activation?.status === "checking" && activation.userId === userId
        ? 2000
        : false,
  });
  useEffect(() => {
    if (eligibility.error && userId) {
      void track("builder_signup_experiment_client_failed", {
        experiment_id: experimentId,
        auth_user_id: userId,
        stage: "eligibility",
        reason: eligibility.error.message,
      });
    }
  }, [eligibility.error, userId, experimentId]);
  useEffect(() => {
    if (
      !userId ||
      eligibility.data !== "eligible" ||
      activation?.userId === userId
    )
      return;
    setActivation({ userId, status: "running" });
    let attempt = attempts.get(attemptKey);
    if (!attempt) {
      // The server checks durable signup consent even when callback cookies
      // were lost. The shared promise survives StrictMode and page remounts.
      attempt = activateBuilderSignupAssignment().finally(() => {
        void queryClient.invalidateQueries();
      });
      attempts.set(attemptKey, attempt);
    }
    const settle = () =>
      setActivation((current) =>
        current?.userId === userId ? { userId, status: "settled" } : current,
      );
    void attempt.then(settle, (error: unknown) => {
      if (attempts.get(attemptKey) === attempt) attempts.delete(attemptKey);
      void track("builder_signup_experiment_client_failed", {
        experiment_id: experimentId,
        auth_user_id: userId,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      setActivation((current) =>
        current?.userId === userId
          ? {
              userId,
              status:
                (recoveryAttempts.current.get(attemptKey) ?? 0) >= 2
                  ? "paused"
                  : "checking",
              failedAt: Date.now(),
            }
          : current,
      );
    });
  }, [
    activation?.userId,
    eligibility.data,
    queryClient,
    userId,
    experimentId,
    attemptKey,
  ]);
  useEffect(() => {
    if (
      (activation?.status === "checking" || activation?.status === "paused") &&
      activation.userId === userId &&
      eligibility.data === "disabled"
    ) {
      setActivation({ userId, status: "settled" });
      void queryClient.invalidateQueries();
    } else if (
      activation?.status === "checking" &&
      activation.userId === userId &&
      activation.failedAt !== undefined &&
      eligibility.isSuccess &&
      eligibility.data === "eligible" &&
      eligibility.dataUpdatedAt > activation.failedAt
    ) {
      // A fresh start/status read can still be eligible on a host without
      // background execution. Re-enter activate; the server reservation owns
      // idempotency and never repeats an uncertain provider creation.
      const retries = recoveryAttempts.current.get(attemptKey) ?? 0;
      if (retries < 2) {
        recoveryAttempts.current.set(attemptKey, retries + 1);
        setActivation(undefined);
      }
    }
  }, [
    activation,
    userId,
    eligibility.data,
    eligibility.dataUpdatedAt,
    eligibility.isSuccess,
    attemptKey,
    queryClient,
  ]);
  // React Query retains confirmed data when a background refetch fails.
  // Only an initial failure leaves eligibility unknown.
  const initialStatusError =
    eligibility.isError && eligibility.data === undefined;
  return {
    activating:
      userId !== undefined &&
      (activation?.userId === userId
        ? activation.status !== "settled"
        : eligibility.data === "eligible"),
    resolving:
      Boolean(userId) &&
      (eligibility.isPending ||
        (initialStatusError && activation?.userId !== userId)),
    statusError:
      initialStatusError ||
      activation?.status === "checking" ||
      activation?.status === "paused",
    retryStatus: () => {
      recoveryAttempts.current.set(attemptKey, 0);
      attempts.delete(attemptKey);
      setActivation(undefined);
      void eligibility.refetch();
    },
  };
}

// Children stay mounted in the same tree position whether or not a session or
// a pending activation exists: swapping them for a skeleton, keying by user,
// or wrapping them only once a session arrives remounts every page and
// discards state the user already changed. Activation makes them inert under
// a cover instead.
export function BuilderSignupActivationCover({
  activating,
  children,
  statusError = false,
  retryStatus,
}: {
  activating: boolean;
  statusError?: boolean;
  retryStatus?: () => void;
  children: ReactNode;
}) {
  const t = useT();
  const inheritedInteractionBlock = useStartupInteractionBlocked();
  const retryContent = (
    <>
      <span>{t("agentChat.onboarding.builderActivationCheckFailed")}</span>
      <Button onClick={retryStatus}>{t("agentChat.common.retry")}</Button>
    </>
  );
  return (
    <StartupInteractionContext.Provider
      value={inheritedInteractionBlock || activating}
    >
      <div className="contents" inert={activating}>
        {children}
      </div>
      {activating ? (
        <div className="fixed inset-0 z-50 flex gap-4 bg-background p-4">
          <span role="status" className="sr-only">
            {t("agentChat.common.loading")}
          </span>
          {statusError ? (
            <div
              role="alert"
              className="m-auto flex flex-col items-center gap-3"
            >
              {retryContent}
            </div>
          ) : (
            <>
              <Skeleton className="h-full w-60" />
              <Skeleton className="h-full flex-1" />
            </>
          )}
        </div>
      ) : statusError ? (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col items-start gap-3 rounded-lg border bg-background p-4 shadow-lg"
        >
          {retryContent}
        </div>
      ) : null}
    </StartupInteractionContext.Provider>
  );
}

export function BuilderSignupStartupGate({
  experimentId,
  suppressSurface,
  children,
}: {
  experimentId?: string;
  suppressSurface: boolean;
  children: ReactNode;
}) {
  const { session } = useSession();
  const { activating, resolving, statusError, retryStatus } =
    useBuilderSignupActivation(
      experimentId && session?.emailVerified === true
        ? session.userId
        : undefined,
      experimentId ?? "disabled",
    );
  return (
    <BuilderSignupActivationCover
      activating={activating}
      statusError={statusError}
      retryStatus={retryStatus}
    >
      <FirstRunOnboardingStartupGate
        suppressSurface={suppressSurface}
        deferSurface={resolving || activating}
      >
        {children}
      </FirstRunOnboardingStartupGate>
    </BuilderSignupActivationCover>
  );
}
