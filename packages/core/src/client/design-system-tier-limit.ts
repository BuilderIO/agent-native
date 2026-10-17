import { actionErrorMessage } from "./use-action.js";

export const DESIGN_SYSTEM_TIER_LIMIT_ERROR_CODE =
  "design_system_tier_limit_exceeded";

export interface DesignSystemTierLimit {
  status: "ok" | "unavailable";
  plan: string | null;
  current: number | null;
  max: number | null;
  atMax: boolean;
  codeIndexingAllowed: boolean;
  upgradeUrl: string | null;
}

export interface DesignSystemTierLimitFailure {
  message: string;
  plan: string | null;
  current: number | null;
  max: number | null;
  upgradeUrl: string | null;
}

export function readDesignSystemTierLimitFailure(
  error: unknown,
  fallbackMessage: string,
): DesignSystemTierLimitFailure | null {
  const source = error as
    | { errorCode?: unknown; details?: Record<string, unknown> }
    | undefined;
  if (source?.errorCode !== DESIGN_SYSTEM_TIER_LIMIT_ERROR_CODE) return null;

  const details = source.details ?? {};
  const text = (value: unknown) =>
    typeof value === "string" && value ? value : null;
  const num = (value: unknown) => (typeof value === "number" ? value : null);

  return {
    message:
      actionErrorMessage(error) ??
      (error instanceof Error ? error.message : undefined) ??
      fallbackMessage,
    plan: text(details.plan),
    current: num(details.current),
    max: num(details.max),
    upgradeUrl: text(details.upgradeUrl),
  };
}

export function isDesignSystemTierAtMax(
  limit: Pick<DesignSystemTierLimit, "status" | "atMax"> | null | undefined,
): boolean {
  return limit?.status === "ok" && limit.atMax === true;
}

export function isDesignSystemCodeIndexingAllowed(
  limit:
    | Pick<DesignSystemTierLimit, "status" | "codeIndexingAllowed">
    | null
    | undefined,
): boolean {
  return limit?.status === "ok" && limit.codeIndexingAllowed === true;
}
