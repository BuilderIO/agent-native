import { isCreditsLimitErrorCode } from "./error-detail.js";

/**
 * Whether a chat for one (user, org) can reach a model, as one value. The
 * engine picker, the sidebar credit notice, the connect gate and the chat error
 * card each used to derive this on their own, so any one could disagree with
 * the rest: an org-connected Enterprise member was told their Builder credits
 * were used up while every chat ran fine.
 */
export type CredentialSubject = "provider" | "builder" | "agent";
export type CredentialFixer = "self" | "org_admin";
export type BuilderCreditPeriod = "daily" | "monthly";

export type CredentialState =
  | { kind: "usable" }
  | { kind: "missing"; credential: CredentialSubject }
  | { kind: "rejected"; credential: CredentialSubject }
  | { kind: "exhausted"; period?: BuilderCreditPeriod; plan?: "free" | "paid" }
  | { kind: "notPermitted"; whoCanFix: CredentialFixer };

export interface ChatCredentialInputs {
  /** The engine `resolveEngine` picks for this (user, org). */
  engine: string;
  /** Whether that engine holds a credential it can run on. */
  engineUsable: boolean;
  /** Live quota of the connected Builder credential; null when none is. */
  builderCredits: {
    plan: "free" | "paid";
    quota: { period: BuilderCreditPeriod; remaining: number };
  } | null;
}

export function describeChatCredentialState(
  input: ChatCredentialInputs,
): CredentialState {
  const onBuilder = input.engine === "builder";
  if (!input.engineUsable) {
    return { kind: "missing", credential: onBuilder ? "builder" : "provider" };
  }
  // A spent Builder quota only stops chats that run on Builder.
  if (onBuilder && input.builderCredits) {
    const { plan, quota } = input.builderCredits;
    if (quota.remaining <= 0) {
      return { kind: "exhausted", period: quota.period, plan };
    }
  }
  return { kind: "usable" };
}

/**
 * Typed wire codes for credential failures. Clients map on these; matching
 * English error text is a legacy fallback for failures that arrive without one.
 *
 * `unauthorized` is deliberately absent: the browser gives that code to every
 * 401 without a body code, which is usually this app's own signed-out session,
 * not a provider refusing a key.
 */
export const CREDENTIAL_ERROR_CODES = {
  missing_credentials: { kind: "missing", credential: "provider" },
  missing_api_key: { kind: "missing", credential: "provider" },
  authentication_error: { kind: "rejected", credential: "provider" },
  invalid_api_key: { kind: "rejected", credential: "provider" },
  http_401: { kind: "rejected", credential: "provider" },
  http_403: { kind: "rejected", credential: "provider" },
  builder_auth_error: { kind: "rejected", credential: "builder" },
  builder_oauth_reauthorization_required: {
    kind: "rejected",
    credential: "builder",
  },
  credential_missing: { kind: "missing", credential: "agent" },
  credential_rejected: { kind: "rejected", credential: "agent" },
  gateway_not_enabled: { kind: "notPermitted", whoCanFix: "org_admin" },
  personal_provider_keys_restricted: {
    kind: "notPermitted",
    whoCanFix: "org_admin",
  },
} as const satisfies Record<string, CredentialState>;

export type CredentialErrorCode = keyof typeof CREDENTIAL_ERROR_CODES;

/**
 * Codes that carry only an upstream HTTP status. Some upstreams answer a spent
 * quota or a rate limit with 403, so the failure's own text decides first.
 */
export const AMBIGUOUS_HTTP_CREDENTIAL_CODES: ReadonlySet<string> = new Set([
  "http_401",
  "http_403",
] satisfies CredentialErrorCode[]);

export function credentialStateForErrorCode(
  errorCode: string | null | undefined,
): CredentialState | null {
  const code = errorCode?.trim().toLowerCase();
  if (!code) return null;
  if (isCreditsLimitErrorCode(code)) {
    const period = code.match(/^credits-limit-(daily|monthly)$/)?.[1] as
      | BuilderCreditPeriod
      | undefined;
    return period ? { kind: "exhausted", period } : { kind: "exhausted" };
  }
  return Object.hasOwn(CREDENTIAL_ERROR_CODES, code)
    ? CREDENTIAL_ERROR_CODES[code as CredentialErrorCode]
    : null;
}

/**
 * The state as flat, bounded event properties, so a rate by kind, subject or
 * who can fix it is a GROUP BY. Carries no identifiers; the caller adds where
 * the state surfaced.
 */
export function credentialStateProperties(
  state: CredentialState,
): Record<string, string> {
  return {
    credential_state: state.kind,
    ...("credential" in state ? { credential_subject: state.credential } : {}),
    ...(state.kind === "exhausted" && state.period
      ? { credential_period: state.period }
      : {}),
    ...(state.kind === "notPermitted"
      ? { credential_fixer: state.whoCanFix }
      : {}),
  };
}

/** `credentialStateProperties` for a wire code; empty when it names no state. */
export function credentialStateTrackingProperties(
  errorCode: string | null | undefined,
): Record<string, string> {
  const state = credentialStateForErrorCode(errorCode);
  return state ? credentialStateProperties(state) : {};
}
