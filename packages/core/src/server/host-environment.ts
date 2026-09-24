/**
 * Keys the running app reads only from its host environment — never from
 * `app_secrets` or any request-scoped resolver — plus the live status of
 * each host-environment concern for onboarding and Settings.
 *
 * A key belongs in {@link HOST_ENVIRONMENT_KEYS} only when it has been
 * verified to have no scoped reader. Each group below cites the reader (or
 * the absence of one) that justifies it; do not add a key without doing the
 * same, and never add one that also has a scoped `app_secrets`/`resolveSecret`
 * reader — that key belongs in the secrets registry instead.
 */

import { isLocalDatabase } from "../db/client.js";
import { getDatabaseRuntimeFingerprint } from "../db/runtime-diagnostics.js";
import type { HostEnvironmentStatus } from "../shared/host-environment.js";
import {
  hasPlatformRuntimeMarker,
  readDeployCredentialEnv,
} from "./credential-provider.js";
import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";
import { getDeploymentEmailReadiness, type EmailReadiness } from "./email.js";
import { hasGoogleSignInCredentials } from "./google-oauth-credentials.js";

const HOST_ENVIRONMENT_KEYS: ReadonlySet<string> = new Set([
  // db/client.ts getDatabaseUrl()/resolveRuntimeDatabase() read process.env
  // directly; the effective URL regex below covers every prefixed variant
  // (e.g. MAIL_DATABASE_URL) the same way getEffectiveDatabaseEnvStatus does.
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",

  // app-config/app.ts appConfig.name — env-only alias (APP_NAME), no scoped
  // reader anywhere in the app-config resolution chain.
  "APP_NAME",

  // better-auth-instance.ts resolveAuthSecret() ~601 reads
  // process.env.BETTER_AUTH_SECRET directly (falling back to a derived or
  // generated dev secret, never a scoped row).
  "BETTER_AUTH_SECRET",
  // app-config/app.ts appConfig.url aliases (APP_URL, BETTER_AUTH_URL) — both
  // env-only, no scoped reader.
  "APP_URL",
  "BETTER_AUTH_URL",

  // better-auth-instance.ts ~2215 wires these into Better Auth's GitHub
  // provider straight from process.env at instance construction time.
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",

  // google-oauth-credentials.ts resolveGoogleSignInCredentials() reads
  // GOOGLE_SIGN_IN_CLIENT_ID/SECRET from process.env only. Deliberately NOT
  // GOOGLE_CLIENT_ID/SECRET: those are also read from scoped app_secrets for
  // managed Calendar/Mail OAuth, so they must stay postable.
  "GOOGLE_SIGN_IN_CLIENT_ID",
  "GOOGLE_SIGN_IN_CLIENT_SECRET",

  // A2A signing root — read from process.env at the handful of call sites
  // that verify/sign A2A tokens; no scoped override exists.
  "A2A_SECRET",

  // shared/runtime-config.ts and the dev auth shim read these once at boot
  // from process.env to decide whether auth is disabled or magic-link only.
  "AUTH_DISABLED",
  "AUTH_MAGIC_LINK",
]);

/** Build-time client env, inlined into the bundle — never savable at runtime. */
const VITE_PREFIX = "VITE_";

/** Same regex `getEffectiveDatabaseEnvStatus` uses in db/runtime-diagnostics.ts. */
const DATABASE_URL_KEY_RE = /(?:^|_)DATABASE_URL(?:_UNPOOLED)?$/;

export function isHostEnvironmentKey(key: string): boolean {
  if (HOST_ENVIRONMENT_KEYS.has(key)) return true;
  if (key.startsWith(VITE_PREFIX)) return true;
  return DATABASE_URL_KEY_RE.test(key);
}

export function hostEnvironmentKeyError(key: string): string {
  return `${key} is read from the host environment. Set it there, then restart or redeploy the app.`;
}

function mapDeploymentEmailReadiness(
  readiness: EmailReadiness,
): HostEnvironmentStatus["email"] {
  switch (readiness.status) {
    case "ready":
      return { status: "ready", provider: readiness.provider };
    case "misconfigured":
      return {
        status: "misconfigured",
        provider:
          readiness.provider === "resend" || readiness.provider === "sendgrid"
            ? readiness.provider
            : null,
      };
    case "not-configured":
      return { status: "not-configured", provider: null };
    case "unavailable":
      // getDeploymentEmailReadiness() only reads process.env and never
      // throws, unlike getEmailReadiness() which can hit a credential-store
      // failure. Fail loudly instead of guessing a status if that changes.
      throw new Error(
        "getDeploymentEmailReadiness() returned an unexpected 'unavailable' status",
      );
  }
}

export function getHostEnvironmentStatus(): HostEnvironmentStatus {
  const database = getDatabaseRuntimeFingerprint();
  return {
    deployed: hasPlatformRuntimeMarker(),
    database: {
      envKey: database.configured ? database.source : null,
      local: isLocalDatabase(),
    },
    auth: {
      // A real host-env value only — the dev fallbacks in resolveAuthSecret()
      // (.env.local, a generated+persisted file) never set BETTER_AUTH_SECRET
      // itself. The workspace A2A-derived secret is also host-env-rooted.
      secretConfigured:
        Boolean(readDeployCredentialEnv("BETTER_AUTH_SECRET")) ||
        Boolean(getWorkspaceA2ADerivedSecret("better-auth")),
      google: hasGoogleSignInCredentials(),
      github: Boolean(
        readDeployCredentialEnv("GITHUB_CLIENT_ID") &&
          readDeployCredentialEnv("GITHUB_CLIENT_SECRET"),
      ),
    },
    email: mapDeploymentEmailReadiness(getDeploymentEmailReadiness()),
  };
}
