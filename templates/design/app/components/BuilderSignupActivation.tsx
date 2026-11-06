import { track } from "@agent-native/core/client/analytics";
import {
  activateBuilderSignupAssignment,
  hasPendingBuilderSignupAssignment,
} from "@agent-native/core/client/auth/builder-signup";
import { useEffect, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const attempts = new Map<string, Promise<unknown>>();

// Rendered around the whole app before and after the session resolves: keying
// it by user or mounting it only once a session exists remounts every page as
// soon as the session arrives, discarding state the user already changed.
export function BuilderSignupActivation({
  userId,
  children,
}: {
  userId: string | undefined;
  children: ReactNode;
}) {
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
  }, [userId]);
  if (userId && settledUserId !== userId && hasPendingBuilderSignupAssignment())
    return (
      <div className="flex h-screen gap-4 p-4" aria-busy="true">
        <Skeleton className="h-full w-60" />
        <Skeleton className="h-full flex-1" />
      </div>
    );
  return children;
}
