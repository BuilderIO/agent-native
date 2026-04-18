/**
 * Shared helpers for actions in this package.
 */
import { getSchedulingContext } from "../server/context.js";

export function currentUserEmail(): string {
  const email = getSchedulingContext().getCurrentUserEmail();
  if (!email) throw new Error("Not authenticated");
  return email;
}

export function currentUserEmailOrNull(): string | null {
  return getSchedulingContext().getCurrentUserEmail() ?? null;
}

export function currentOrgId(): string | undefined {
  return getSchedulingContext().getCurrentOrgId?.();
}
