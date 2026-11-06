import { track } from "@agent-native/core/client/analytics";
import {
  activateBuilderSignupAssignment,
  hasPendingBuilderSignupAssignment,
} from "@agent-native/core/client/auth/builder-signup";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const attempts = new Map<string, Promise<unknown>>();

// Children stay mounted in the same tree position whether or not a session or
// a pending activation exists: swapping them for a skeleton, keying by user,
// or wrapping them only once a session arrives remounts every page and
// discards state the user already changed. Activation covers them instead,
// then refetches queries that ran before the Builder account was connected.
export function BuilderSignupActivation({
  userId,
  children,
}: {
  userId: string | undefined;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [settledUserId, setSettledUserId] = useState<string>();
  useEffect(() => {
    if (!userId || !hasPendingBuilderSignupAssignment()) return;
    let disposed = false;
    let attempt = attempts.get(userId);
    if (!attempt) {
      attempt = activateBuilderSignupAssignment();
      attempts.set(userId, attempt);
    }
    void attempt.then(
      () => {
        if (disposed) return;
        setSettledUserId(userId);
        void queryClient.invalidateQueries();
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
  const activating =
    userId !== undefined &&
    settledUserId !== userId &&
    hasPendingBuilderSignupAssignment();
  return (
    <>
      {children}
      {activating ? (
        <div
          className="fixed inset-0 z-50 flex gap-4 bg-background p-4"
          aria-busy="true"
        >
          <Skeleton className="h-full w-60" />
          <Skeleton className="h-full flex-1" />
        </div>
      ) : null}
    </>
  );
}
