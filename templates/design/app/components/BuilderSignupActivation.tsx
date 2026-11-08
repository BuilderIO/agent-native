import { track } from "@agent-native/core/client/analytics";
import {
  activateBuilderSignupAssignment,
  getBuilderSignupActivationStatus,
  hasPendingBuilderSignupAssignment,
} from "@agent-native/core/client/auth/builder-signup";
import { useT } from "@agent-native/core/client/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const attempts = new Map<string, Promise<unknown>>();

// Runs a pending Builder signup activation for the signed-in user and reports
// whether it is still in progress. Anything outside the cover that opens UI,
// such as a keyboard shortcut or a portaled menu, has to check this itself.
export function useBuilderSignupActivation(
  userId: string | undefined,
): boolean {
  const queryClient = useQueryClient();
  const eligibility = useQuery({
    queryKey: ["builder-signup-eligibility", userId],
    queryFn: getBuilderSignupActivationStatus,
    enabled: Boolean(userId),
    staleTime: Infinity,
    retry: 1,
  });
  useEffect(() => {
    if (eligibility.error && userId) {
      void track("builder_signup_experiment_client_failed", {
        experiment_id: "design_builder_signup_v1",
        auth_user_id: userId,
        stage: "eligibility",
        reason: eligibility.error.message,
      });
    }
  }, [eligibility.error, userId]);
  const [settledUserId, setSettledUserId] = useState<string>();
  useEffect(() => {
    if (!userId || eligibility.data !== "eligible") return;
    let disposed = false;
    let attempt = attempts.get(userId);
    if (!attempt) {
      // The server checks durable signup consent even when callback cookies
      // were lost. The shared promise survives StrictMode and page remounts.
      attempt = activateBuilderSignupAssignment().finally(() => {
        void queryClient.invalidateQueries();
      });
      attempts.set(userId, attempt);
    }
    void attempt.then(
      () => {
        if (!disposed) setSettledUserId(userId);
      },
      (error: unknown) => {
        if (attempts.get(userId) === attempt) attempts.delete(userId);
        void track("builder_signup_experiment_client_failed", {
          experiment_id: "design_builder_signup_v1",
          auth_user_id: userId,
          reason: error instanceof Error ? error.message : "unknown_error",
        });
        if (!disposed) setSettledUserId(userId);
      },
    );
    return () => {
      disposed = true;
    };
  }, [eligibility.data, queryClient, userId]);
  return (
    userId !== undefined &&
    settledUserId !== userId &&
    (eligibility.data === "eligible" ||
      (eligibility.isPending && hasPendingBuilderSignupAssignment()))
  );
}

// Children stay mounted in the same tree position whether or not a session or
// a pending activation exists: swapping them for a skeleton, keying by user,
// or wrapping them only once a session arrives remounts every page and
// discards state the user already changed. Activation makes them inert under
// a cover instead.
export function BuilderSignupActivationCover({
  activating,
  children,
}: {
  activating: boolean;
  children: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <div className="contents" inert={activating}>
        {children}
      </div>
      {activating ? (
        <div className="fixed inset-0 z-50 flex gap-4 bg-background p-4">
          <span role="status" className="sr-only">
            {t("common.loading")}
          </span>
          <Skeleton className="h-full w-60" />
          <Skeleton className="h-full flex-1" />
        </div>
      ) : null}
    </>
  );
}
