import { createHash } from "node:crypto";

import { z } from "zod";

import {
  onboardingRoleSchema,
  type OnboardingRole,
} from "../user-profile/shared.js";

export const FIRST_RUN_ONBOARDING_COOKIE = "agent-native-first-run";
export const FIRST_RUN_ONBOARDING_MAX_AGE = 24 * 60 * 60;
export const SHARED_ONBOARDING_COOKIE = "an_onboarding";
export const SHARED_ONBOARDING_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
export const SHARED_ONBOARDING_EMAIL_HASH_SALT =
  "agent-native-shared-onboarding-v1";

const EMAIL_HASH_PATTERN = /^[A-Za-z0-9_-]{27}$/;

const sharedOnboardingPayloadSchema = z.object({
  /** Onboarding role, or absent. Validated leniently — see `readRole`. */
  r: z.unknown().optional(),
  /** Salted hash of the completing person's normalized email. */
  e: z.string().regex(EMAIL_HASH_PATTERN),
});

/**
 * An unrecognised role drops to `null` instead of rejecting the cookie. A
 * newer app may add a role this build has never heard of, and losing the role
 * is a far better outcome than discarding a valid completion.
 */
function readRole(value: unknown): OnboardingRole | null {
  const parsed = onboardingRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function hashOnboardingEmail(email: string): string {
  return createHash("sha256")
    .update(`${email.trim().toLowerCase()}${SHARED_ONBOARDING_EMAIL_HASH_SALT}`)
    .digest("base64url")
    .slice(0, 27);
}

export function encodeSharedOnboardingCookie(input: {
  role: OnboardingRole | null;
  email: string;
}): string {
  return Buffer.from(
    JSON.stringify({ r: input.role, e: hashOnboardingEmail(input.email) }),
    "utf8",
  ).toString("base64url");
}

export function decodeSharedOnboardingCookie(raw: string | undefined): {
  role: OnboardingRole | null;
  emailHash: string;
} | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    // coercion-ok: an unreadable cookie shows onboarding, the safe state. No
    // success value is fabricated — the person sees the flow either way.
    return null;
  }

  const result = sharedOnboardingPayloadSchema.safeParse(parsed);
  if (!result.success) return null;

  return { role: readRole(result.data.r), emailHash: result.data.e };
}

export const FIRST_RUN_ONBOARDING_COMPLETED_KEY =
  "onboarding:first-run-completed";
/**
 * Set only when the framework provisions the user's first default
 * organization. Membership in an existing organization must never qualify a
 * user for the first-run flow, even if an old signup cookie is still present.
 */
export const FIRST_RUN_ONBOARDING_ELIGIBLE_KEY =
  "onboarding:first-run-eligible";
