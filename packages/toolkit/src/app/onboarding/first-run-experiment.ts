import {
  getAnalyticsAnonymousId,
  isAgentNativeAnalyticsConfigured,
} from "@agent-native/core/client/analytics";

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
 * not flip under a user who has already seen one. Returns null — outside the
 * experiment, existing page — whenever a stable, measurable arm cannot be
 * guaranteed: no analytics sink configured (nothing measurable) or storage blocked (the anonymous id is
 * regenerated per page load, so the arm could change on reload).
 */
export function assignFirstRunSetupVariant(): FirstRunSetupVariant | null {
  if (typeof window === "undefined") return null;
  // The anonymous id exists even with no analytics destination, so ask the
  // sink directly: an arm whose exposure and outcomes are never recorded would
  // leave unmeasured people in the test.
  if (!isAgentNativeAnalyticsConfigured()) return null;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isVariant(stored)) return stored;
    const anonymousId = getAnalyticsAnonymousId();
    if (!anonymousId) return null;
    const variant: FirstRunSetupVariant =
      hashToUnit(`${FIRST_RUN_SETUP_EXPERIMENT_ID}:${anonymousId}`) < 0.5
        ? "credits"
        : "control";
    window.localStorage.setItem(STORAGE_KEY, variant);
    return variant;
  } catch {
    // coercion-ok: null means "not in the experiment", and the caller renders the existing page for it.
    return null;
  }
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
