import { track } from "@agent-native/core/client/analytics";
import {
  activateBuilderSignupAssignment,
  hasPendingBuilderSignupAssignment,
} from "@agent-native/core/client/auth/builder-signup";
import { useEffect, useState, type ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";

const attempts = new Map<string, Promise<unknown>>();

export function BuilderSignupActivation({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [settled, setSettled] = useState(
    () => !hasPendingBuilderSignupAssignment(),
  );
  useEffect(() => {
    if (!hasPendingBuilderSignupAssignment()) {
      setSettled(true);
      return;
    }
    let disposed = false;
    let attempt = attempts.get(userId);
    if (!attempt) {
      attempt = activateBuilderSignupAssignment();
      attempts.set(userId, attempt);
    }
    void attempt.then(
      () => {
        if (!disposed) setSettled(true);
      },
      (error: unknown) => {
        if (attempts.get(userId) === attempt) attempts.delete(userId);
        void track("builder_signup_experiment_client_failed", {
          reason: error instanceof Error ? error.name : "unknown_error",
        });
        if (!disposed) setSettled(true);
      },
    );
    return () => {
      disposed = true;
    };
  }, [userId]);
  if (!settled)
    return (
      <div className="flex h-screen gap-4 p-4" aria-busy="true">
        <Skeleton className="h-full w-60" />
        <Skeleton className="h-full flex-1" />
      </div>
    );
  return children;
}
