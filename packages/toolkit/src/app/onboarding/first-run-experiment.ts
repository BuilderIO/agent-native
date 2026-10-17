import { getAnalyticsAnonymousId } from "@agent-native/core/client/analytics";

export const FIRST_RUN_SETUP_EXPERIMENT_ID = "first_run_builder_credits";
export const FIRST_RUN_SETUP_VARIANT_QUERY_PARAM = "variant";

export type FirstRunSetupVariant = "control" | "credits";

const STORAGE_KEY = `agent-native:experiment:${FIRST_RUN_SETUP_EXPERIMENT_ID}`;

function isVariant(value: unknown): value is FirstRunSetupVariant {
  return value === "control" || value === "credits";
}

// FNV-1a: stable across sessions and runtimes, no crypto dependency.
function hashToUnit(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) / 0x100000000;
}

/**
 * 50/50 split keyed on the anonymous analytics id, so the arm survives sign-in
 * and reloads. The arm is also stored: the id can be regenerated, the arm must
 * not flip under a user who has already seen one.
 */
export function assignFirstRunSetupVariant(): FirstRunSetupVariant {
  if (typeof window === "undefined") return "control";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isVariant(stored)) return stored;
  } catch {
    // coercion-ok: storage-blocked browsers re-derive the same arm from the anonymous id below.
  }
  // No anonymous id means analytics is off: nothing can be measured, so keep
  // the user on the existing page rather than exposing an unmeasurable arm.
  const anonymousId = getAnalyticsAnonymousId();
  if (!anonymousId) return "control";
  const variant: FirstRunSetupVariant =
    hashToUnit(`${FIRST_RUN_SETUP_EXPERIMENT_ID}:${anonymousId}`) < 0.5
      ? "credits"
      : "control";
  try {
    window.localStorage.setItem(STORAGE_KEY, variant);
  } catch {
    // coercion-ok: assignment is deterministic from the anonymous id, so a failed write only skips the cache.
  }
  return variant;
}

/** Preview links pin an arm (`?onboarding=preview&variant=credits`) without touching the stored assignment. */
export function getPreviewFirstRunSetupVariant(
  search: string,
): FirstRunSetupVariant | null {
  const value = new URLSearchParams(search).get(
    FIRST_RUN_SETUP_VARIANT_QUERY_PARAM,
  );
  return isVariant(value) ? value : null;
}
