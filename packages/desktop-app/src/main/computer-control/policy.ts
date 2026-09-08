import type {
  AgentExecutionMode,
  ComputerOperation,
  MutationOperation,
} from "./types";

export class ComputerControlPolicyError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MUTATION_BLOCKED_IN_PLAN_MODE"
      | "LEASE_REQUIRED"
      | "LEASE_EXPIRED"
      | "LEASE_SCOPE_VIOLATION"
      | "STALE_TARGET"
      | "CONTROL_BUSY"
      | "CONTROL_CANCELLED",
  ) {
    super(message);
    this.name = "ComputerControlPolicyError";
  }
}

export function isMutationOperation(
  operation: ComputerOperation,
): operation is MutationOperation {
  return operation.kind.startsWith("input.");
}

export function assertModeAllowsOperation(
  mode: AgentExecutionMode,
  operation: ComputerOperation,
): void {
  if (mode === "plan" && isMutationOperation(operation)) {
    throw new ComputerControlPolicyError(
      "Computer mutations are disabled while the agent is in Plan mode.",
      "MUTATION_BLOCKED_IN_PLAN_MODE",
    );
  }
}

export function normalizeOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

export function normalizeScope(scope: {
  bundleIds: readonly string[];
  origins: readonly string[];
}): { bundleIds: string[]; origins: string[] } {
  return {
    bundleIds: [
      ...new Set(scope.bundleIds.map((value) => value.trim()).filter(Boolean)),
    ],
    origins: [
      ...new Set(
        scope.origins
          .map((value) => normalizeOrigin(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ],
  };
}

export function scopeAllowsTarget(
  scope: { bundleIds: readonly string[]; origins: readonly string[] },
  target: { bundleId: string; origin?: string },
): boolean {
  if (!scope.bundleIds.includes(target.bundleId)) return false;
  if (!target.origin) return scope.origins.length === 0;
  const origin = normalizeOrigin(target.origin);
  return Boolean(origin && scope.origins.includes(origin));
}
