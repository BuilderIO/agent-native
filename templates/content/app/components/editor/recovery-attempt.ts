import { useEffect, useRef } from "react";

export interface RecoveryAttempt {
  isActive(): boolean;
  assertActive(): void;
  step<T>(operation: () => Promise<T>): Promise<T>;
}

class RecoveryAttemptEnded extends Error {
  constructor() {
    super("The recovery attempt's original scope ended.");
    this.name = "RecoveryAttemptEnded";
  }
}

export function useRecoveryAttemptOwner(scope: string | null) {
  const current = useRef({ scope, active: true });
  // Invalidate during render: a late promise can resume before effect cleanup.
  if (current.current.scope !== scope) {
    current.current.active = false;
    current.current = { scope, active: true };
  }
  useEffect(() => {
    if (!current.current.active) current.current = { scope, active: true };
    const epoch = current.current;
    return () => {
      epoch.active = false;
    };
  }, [scope]);
  const begin = () => {
    const epoch = current.current;
    const isActive = () => epoch.active && current.current === epoch;
    const assertActive = () => {
      if (!isActive()) throw new RecoveryAttemptEnded();
    };
    return {
      isActive,
      assertActive,
      async step<T>(operation: () => Promise<T>) {
        assertActive();
        const result = await operation();
        assertActive();
        return result;
      },
    } satisfies RecoveryAttempt;
  };
  return begin;
}
