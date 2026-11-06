import { track } from "@agent-native/core/client/analytics";
import {
  activateBuilderSignupAssignment,
  hasPendingBuilderSignupAssignment,
} from "@agent-native/core/client/auth/builder-signup";
import { useT } from "@agent-native/core/client/i18n";
import { useQueryClient } from "@tanstack/react-query";
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
  const [settledUserId, setSettledUserId] = useState<string>();
  useEffect(() => {
    if (!userId || !hasPendingBuilderSignupAssignment()) return;
    let disposed = false;
    let attempt = attempts.get(userId);
    if (!attempt) {
      // Activation clears the pending cookie, so a later effect never retries;
      // the refresh belongs to the attempt, not to whichever effect is mounted.
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
          reason: error instanceof Error ? error.name : "unknown_error",
        });
        if (!disposed) setSettledUserId(userId);
      },
    );
    return () => {
      disposed = true;
    };
  }, [queryClient, userId]);
  return (
    userId !== undefined &&
    settledUserId !== userId &&
    hasPendingBuilderSignupAssignment()
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
