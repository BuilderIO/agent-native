function stringifyValue(value: unknown): string {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return String(value);
  return value == null ? "" : (JSON.stringify(value) ?? "");
}

/**
 * Internal Better Auth instance — lazily created, not exported to templates.
 *
 * Templates interact with auth via the existing `getSession()`, `autoMountAuth()`,
 * `createAuthPlugin()`, and `createGoogleAuthPlugin()` APIs. Better Auth is an
 * implementation detail behind those interfaces.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  betterAuth,
  type BetterAuthOptions,
  type BetterAuthPlugin,
} from "better-auth";
import { bearer } from "better-auth/plugins/bearer";
import { jwt } from "better-auth/plugins/jwt";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import {
  pgTable,
  text as pgText,
  timestamp as pgTimestamp,
  boolean as pgBoolean,
  bigint as pgBigint,
} from "drizzle-orm/pg-core";
import { setCookie } from "h3";
import type { H3Event } from "h3";

import {
  enterpriseAuthAdaptersBuilt,
  getAppConfig,
} from "../app-config/index.js";
import { TEMPLATES } from "../cli/templates-meta.js";
import { getDbExec } from "../db/client.js";
import {
  assertHostedRuntimeDatabase,
  getRuntimeDatabaseUrl,
  getPgliteClient,
  isPgliteUrl,
  loadPgliteDrizzle,
  pgliteDrizzleClient,
  pgPoolOptions,
  neonPoolOptions,
  guardNeonPool,
  sharedDbPool,
  onSharedDbPoolsClosed,
  onSharedDbPoolReplaced,
} from "../db/client.js";
import {
  CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID,
  CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID,
  CORE_MAGIC_LINK_EMAIL_ID,
  CORE_RESET_PASSWORD_EMAIL_ID,
  CORE_VERIFY_SIGNUP_EMAIL_ID,
} from "../email-catalog/system-emails.js";
import {
  executeIdentityRekey,
  rekeyIdentity,
  resumePendingIdentityRekeys,
  verifiedEmailChangeFromToken,
  type IdentityRekeyDb,
} from "../identity/rekey.js";
import { saveOAuthTokens } from "../oauth-tokens/store.js";
import { acceptPendingInvitationsForEmail } from "../org/accept-pending.js";
import {
  getAuthEmailForUserId,
  getRequiredAuthProviderForEmail,
} from "../org/auth-policy.js";
import { autoJoinDomainMatchingOrgs } from "../org/auto-join-domain.js";
import {
  createFrameworkSCIMIdentity,
  frameworkOrgBridgePlugin,
} from "../org/scim-provisioning.js";
import {
  enforceSignupAdmission,
  isBootstrapAdmin,
} from "../org/signup-admission.js";
import { isGoogleProfileImageUrl } from "../shared/google-profile-image.js";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "../shared/password-policy.js";
import {
  formatRuntimeConfigReport,
  getRuntimeConfigReport,
} from "../shared/runtime-config.js";
import { flushTracking, identify, track } from "../tracking/index.js";
import { isEmailDerivedName } from "../user-profile/shared.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import { getAppProductionUrl } from "./app-url.js";
import {
  type SignupOrigin,
  signupAttributionContextFromCookieHeader,
  signupAttributionContextFromHeaders,
} from "./attribution.js";
import { resolveAuthCookieNamespace } from "./cookie-namespace.js";
import {
  isExplicitLocalDeployEnvironment,
  resolveDeployEnvironment,
} from "./deploy-environment.js";
import { getWorkspaceA2ADerivedSecret } from "./derived-secret.js";
import {
  renderChangeEmailConfirmationEmail,
  renderChangeEmailVerificationEmail,
  renderMagicLinkEmail,
  renderResetPasswordEmail,
  renderVerifySignupEmail,
} from "./email-templates.js";
import {
  getDeploymentEmailReadiness,
  sendEmail,
  type EmailReadiness,
} from "./email.js";
import {
  canonicalFrameworkPathname,
  publicFrameworkPath,
} from "./framework-route-prefix.js";
import {
  recordActiveGoogleSignInCredentials,
  resolveGoogleSignInCredentials,
} from "./google-oauth-credentials.js";
import { IDENTITY_SSO_PROVIDER_ID } from "./identity-sso-provider.js";
import { withJwksRotationRecovery } from "./jwks-secret-rotation.js";
import { readMagicLinkSignupAttribution } from "./magic-link-attribution.js";
import {
  getConfiguredOriginAllowlist,
  requestForwardedOrigin,
} from "./origin-allowlist.js";
import {
  getRequestContext,
  hasContinuationLocalRequestContext,
} from "./request-context.js";
import { recordActiveSocialSignInProviders } from "./social-sign-in-providers.js";

function identityRekeyDbFromExec(
  exec: Awaited<ReturnType<typeof getDbExec>>,
): IdentityRekeyDb {
  const db: IdentityRekeyDb = {
    async unsafe(sql: string, args: unknown[] = []) {
      const result = await exec.execute({ sql, args });
      return Object.assign(result.rows as Array<Record<string, unknown>>, {
        count: result.rowsAffected,
      });
    },
  };
  if (exec.transaction) {
    db.transaction = <T>(fn: (tx: IdentityRekeyDb) => Promise<T>) =>
      exec.transaction!((tx) => fn(identityRekeyDbFromExec(tx)));
  }
  return db;
}

/** Retry a rekey whose Better Auth account update committed before framework rows did. */
export async function resumeIdentityRekeysForEmail(
  email: string,
): Promise<void> {
  await resumePendingIdentityRekeys(
    identityRekeyDbFromExec(getDbExec()),
    email,
    {
      ensureLedger: false,
    },
  );
}

async function preflightEmailIdentityRekey(
  oldEmail: string,
  newEmail: string,
): Promise<void> {
  await rekeyIdentity(
    identityRekeyDbFromExec(getDbExec()),
    oldEmail,
    newEmail,
    {
      dryRun: true,
      revokeSessions: false,
    },
  );
}

export {
  getAuthLoginMode,
  resolveAuthLoginMode,
  resolveAuthLoginModeFromReadiness,
  type AuthLoginMode,
} from "./auth-login-mode.js";

async function flushSignupTracking(): Promise<void> {
  try {
    await Promise.race([
      flushTracking(),
      new Promise<void>((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // Signup should never fail because analytics delivery did.
  }
}

export async function hasBetterAuthUserEmail(email: string): Promise<boolean> {
  const adapter = await getBetterAuthInternalAdapter().catch(() => undefined);
  if (!adapter) return false;
  const existing = await adapter
    .findUserByEmail(email, { includeAccounts: false })
    .catch(() => null);
  return !!existing?.user?.email;
}

/**
 * The canonical Better Auth user id for an email, or `undefined` when there
 * is no row (or the adapter is unavailable).
 *
 * Signup events must carry this id, not the identity provider's subject id:
 * the virality panels self-join `auth_user_id` against `referrer_user`, and
 * `referrer_user` is always a Better Auth id, so a Google profile id in that
 * column silently joins to nothing.
 */
export async function getBetterAuthUserIdForEmail(
  email: string,
): Promise<string | undefined> {
  try {
    const adapter = await getBetterAuthInternalAdapter();
    if (!adapter) return undefined;
    const existing = await adapter.findUserByEmail(email.trim().toLowerCase(), {
      includeAccounts: false,
    });
    return existing?.user?.id || undefined;
  } catch (error) {
    // coercion-ok: this is analytics enrichment on the sign-in path. Failing
    // the sign-in over it would be worse, and the only consequence is one
    // event missing `auth_user_id` — never a wrong id. Logged, not swallowed.
    console.error(
      "[auth] failed to resolve the canonical user id for a signup event",
      error,
    );
    return undefined;
  }
}

/**
 * The endpoint context Better Auth (1.6.x) hands to `user.create.after`. It is
 * `null` for any row created through `internalAdapter` outside an endpoint —
 * see `emitSignupEventForCreatedUser`.
 */
export interface BetterAuthUserCreateContext {
  headers?: Headers | null;
  request?: { headers?: Headers | null; url?: string } | null;
}

function signupMethodFromRequestUrl(
  url: string | undefined,
): "magic_link" | "password" {
  const normalized = url?.toLowerCase() ?? "";
  return normalized.includes("newusercallbackurl") ||
    normalized.includes("/magic-link")
    ? "magic_link"
    : "password";
}

/**
 * Emit the `signup` event for a freshly created Better Auth `user` row — but
 * only when that row is an actual person signing up.
 *
 * Better Auth runs its create hook on every `user` insert. Only inserts made
 * through one of its HTTP endpoints carry the originating request; everything
 * that reaches the row through `internalAdapter` directly gets a null context,
 * because `getCurrentAuthContext()` throws outside an endpoint. Two production
 * paths do exactly that, and neither is an acquisition:
 *
 *   - `ensureCanonicalUserForLegacySession` backfills a canonical row for
 *     someone who signed up long ago, on an ordinary authenticated request.
 *   - `ensureGoogleAuthIdentity` provisions the canonical row during the Google
 *     callback, whose own attributed event `createOAuthSession` emits.
 *
 * Emitting for those is what broke campaign reporting: they arrived with no
 * browser context and were recorded as `referral_source: "direct"`, so ~94% of
 * `better-auth` signups were unattributable rows that were never signups, and
 * one person provisioned across sibling apps counted as a dozen. A row insert
 * is not an acquisition, so a context-free insert emits nothing at all.
 */
export async function emitSignupEventForCreatedUser(
  user: { id?: string; email?: string; name?: string | null },
  context?: BetterAuthUserCreateContext | null,
): Promise<void> {
  const email = user?.email;
  if (!email) return;

  const requestHeaders = context?.headers ?? context?.request?.headers ?? null;
  if (!requestHeaders) return;

  const scoped = hasContinuationLocalRequestContext()
    ? getRequestContext()
    : undefined;
  let attribution: Record<string, string> | undefined;
  let anonymousId: string | undefined;
  try {
    const browser =
      // The signed magic-link token is the only source that survives the link
      // being opened in a different browser than the one that requested it.
      (context?.request?.url?.includes("newUserCallbackURL")
        ? readMagicLinkSignupAttribution(context.request.url, getAuthSecret())
        : undefined) ??
      scoped?.signupAttribution ??
      signupAttributionContextFromHeaders(requestHeaders) ??
      signupAttributionContextFromCookieHeader(requestHeaders.get("cookie"));
    attribution = browser?.attribution;
    anonymousId = browser?.anonymousId;
  } catch (err) {
    // Analytics must never block signup, but a parse failure is not "this
    // visitor came direct" — leave both unset so the event shows the gap
    // instead of inventing a source for it.
    console.error("[auth] failed to derive signup attribution", err);
  }

  await trackSignupEvent({
    authProvider: "better-auth",
    origin: scoped?.signupOrigin ?? "browser_signup",
    signupMethod: signupMethodFromRequestUrl(context?.request?.url),
    authUserId: user.id,
    email,
    name: user.name,
    attribution,
    anonymousId,
  });
}

/** Return whether the canonical user has a verified Google account link. */
export async function hasGoogleAuthIdentity(
  email: string,
): Promise<boolean | undefined> {
  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) return undefined;
  const existing = await adapter.findUserByEmail(email.trim().toLowerCase(), {
    includeAccounts: true,
  });
  return (
    existing?.accounts.some((account) => account.providerId === "google") ??
    false
  );
}

export async function trackSignupEvent({
  authProvider,
  origin,
  signupMethod,
  authUserId,
  email,
  name,
  attribution,
  anonymousId,
}: {
  authProvider: string;
  origin: SignupOrigin;
  signupMethod?: "google" | "magic_link" | "password";
  authUserId?: string;
  email: string;
  name?: string | null;
  /**
   * First-touch referral attribution derived from the visitor's `an_ft`
   * cookie (see `server/attribution.ts`). Snake_case keys such as
   * `referral_source`, `referrer_user`, and the UTM passthrough are merged
   * into the `signup` event so we can measure where new users came from.
   * `undefined` values are dropped; a missing object is a clean no-op — and
   * it must stay a no-op rather than defaulting to `direct`, so a signup we
   * could not attribute stays visibly different from an unattributed visit.
   */
  attribution?: Record<string, string | undefined>;
  anonymousId?: string;
}): Promise<void> {
  identify(email, {
    email,
    name: name ?? undefined,
    authUserId,
  });
  const cleanAttribution: Record<string, string> = {};
  if (attribution) {
    for (const [key, value] of Object.entries(attribution)) {
      if (typeof value === "string" && value.length > 0) {
        cleanAttribution[key] = value;
      }
    }
  }
  track(
    "signup",
    {
      ...resolveSignupTrackingProperties(),
      auth_provider: authProvider,
      signup_origin: origin,
      ...(signupMethod ? { signup_method: signupMethod } : {}),
      ...(authUserId ? { auth_user_id: authUserId } : {}),
      ...cleanAttribution,
    },
    {
      userId: email,
      authUserId,
      ...(anonymousId ? { anonymousId } : {}),
    },
  );
  await flushSignupTracking();
}

// ---------------------------------------------------------------------------
// Persistent auth secret
// ---------------------------------------------------------------------------

/** Persists the generated dev secret next to `dev-server.json`, gitignored. */
export const DEV_AUTH_SECRET_PATH = path.join(
  ".agent-native",
  "dev-auth-secret",
);

/**
 * A persisted dev auth secret exists but cannot be used, or cannot be
 * persisted. Deliberately not caught anywhere: a local dev runtime that
 * cannot keep a stable session-signing secret fails the boot loudly instead
 * of silently rotating sessions on every restart.
 */
export class DevAuthSecretFileError extends Error {
  constructor(
    message: string,
    readonly reason:
      | "unreadable"
      | "empty"
      | "unsafe"
      | "create-failed"
      | "race-unreadable",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "DevAuthSecretFileError";
  }
}

type DevAuthSecretFileRead =
  | { status: "absent" }
  | { status: "ok"; value: string };

function readDevAuthSecretFile(filePath: string): DevAuthSecretFileRead {
  let descriptor: number | undefined;
  let content: string;
  try {
    const pathStat = fs.lstatSync(filePath);
    if (pathStat.isSymbolicLink() || !pathStat.isFile()) {
      throw new DevAuthSecretFileError(
        `The persisted local dev auth secret at ${filePath} must be a regular file, not a symlink or special file. Delete it to generate a safe replacement.`,
        "unsafe",
      );
    }
    if (process.platform !== "win32" && (pathStat.mode & 0o077) !== 0) {
      throw new DevAuthSecretFileError(
        `The persisted local dev auth secret at ${filePath} is accessible to other users. Set its permissions to 0600 or delete it.`,
        "unsafe",
      );
    }
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
    );
    const openedStat = fs.fstatSync(descriptor);
    if (
      !openedStat.isFile() ||
      openedStat.dev !== pathStat.dev ||
      openedStat.ino !== pathStat.ino
    ) {
      throw new DevAuthSecretFileError(
        `The persisted local dev auth secret at ${filePath} changed while it was being opened. Delete it to generate a safe replacement.`,
        "unsafe",
      );
    }
    content = fs.readFileSync(descriptor, "utf8");
  } catch (error) {
    if (error instanceof DevAuthSecretFileError) throw error;
    const code = (error as NodeJS.ErrnoException)?.code;
    // ENOTDIR means no file can exist at this path — route it to the create
    // step, which fails loudly with the real cause.
    if (code === "ENOENT" || code === "ENOTDIR") {
      return { status: "absent" };
    }
    throw new DevAuthSecretFileError(
      `The persisted local dev auth secret at ${filePath} exists but could not be read. Fix its permissions or delete it.`,
      "unreadable",
      { cause: error },
    );
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  const value = content.trim();
  if (!value) {
    throw new DevAuthSecretFileError(
      `The persisted local dev auth secret at ${filePath} is empty. Delete the file to generate a fresh one.`,
      "empty",
    );
  }
  return { status: "ok", value };
}

/**
 * Read the persisted local dev secret from
 * `<appRoot>/.agent-native/dev-auth-secret` (gitignored), creating it
 * exclusively on first use. Existing files are reused verbatim and never
 * overwritten, and the secret value is never logged.
 *
 * Throws `DevAuthSecretFileError` — never degrades — when the file exists
 * but is unreadable or empty, when it cannot be created, or when the file a
 * concurrent creator left behind cannot be read back. Absence is the only
 * non-throwing "create it" outcome.
 */
export function resolvePersistedDevAuthSecret(
  appRoot: string,
  generateSecret: () => string,
): string {
  const filePath = path.join(appRoot, DEV_AUTH_SECRET_PATH);
  const existing = readDevAuthSecretFile(filePath);
  if (existing.status === "ok") return existing.value;

  const secret = generateSecret();
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
  );
  let createdTemp = false;
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // Stage the full value in an exclusive same-directory temp file, then
    // hard-link it into place: `link` fails with EEXIST instead of following
    // or overwriting whatever sits at the final path, and a reader of that
    // path only ever sees complete content.
    fs.writeFileSync(tempPath, `${secret}\n`, { flag: "wx", mode: 0o600 });
    createdTemp = true;
    try {
      fs.linkSync(tempPath, filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "EEXIST") {
        // Another process won the creation race — reuse its secret.
        const winner = readDevAuthSecretFile(filePath);
        if (winner.status === "ok") return winner.value;
        throw new DevAuthSecretFileError(
          `Another process created the dev auth secret at ${filePath} but it could not be read back.`,
          "race-unreadable",
          { cause: error },
        );
      }
      throw new DevAuthSecretFileError(
        `Could not persist the local dev auth secret at ${filePath}.`,
        "create-failed",
        { cause: error },
      );
    }
  } catch (error) {
    if (error instanceof DevAuthSecretFileError) throw error;
    throw new DevAuthSecretFileError(
      `Could not persist the local dev auth secret at ${filePath}.`,
      "create-failed",
      { cause: error },
    );
  } finally {
    if (createdTemp) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // coercion-ok: best-effort cleanup of only the temp file this
        // invocation created; the persisted secret is already in place.
      }
    }
  }
  return secret;
}

/**
 * Resolve the Better Auth signing secret.
 *
 * Resolution order:
 *   1. `BETTER_AUTH_SECRET` env var — explicit, recommended for prod.
 *   2. Hosted workspace deploys can derive a per-purpose secret from the
 *      already-required `A2A_SECRET` root. This keeps fresh workspace branches
 *      bootable without reusing the raw A2A key as a cookie-signing key.
 *   3. Existing `.env.local` values in the template cwd — read-only
 *      compatibility for projects that already configured this secret.
 *   4. Generate a random 32-byte hex secret in local development and persist
 *      it at `<cwd>/.agent-native/dev-auth-secret` (mode 0600, created
 *      exclusively) so sessions survive dev-server restarts. Persistence
 *      failures throw rather than degrade.
 *
 * Why this matters: before this helper existed, missing `BETTER_AUTH_SECRET`
 * fell through to `GOOGLE_CLIENT_SECRET` / `ACCESS_TOKEN` / a hardcoded
 * string. If a template happened to have none of those, each dev-server
 * boot would re-fall back to the hardcoded value (still stable) — but
 * rotating Google credentials, toggling `ACCESS_TOKEN`, or churning the
 * fallback chain would invalidate every signed cookie and force everyone
 * to sign in again. We still read explicit env configuration, but never
 * auto-write a generated secret into env files.
 */
function resolveAuthSecret(appRoot = process.cwd()): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const workspaceDerivedSecret = getWorkspaceA2ADerivedSecret("better-auth");
  if (workspaceDerivedSecret) return workspaceDerivedSecret;

  const deployEnvironment = resolveDeployEnvironment();
  const explicitlyLocal = isExplicitLocalDeployEnvironment();

  // In production, beyond the workspace A2A-derived fallback above, never
  // auto-generate or use legacy fallbacks. A generated secret invalidates every
  // signed session cookie on the next cold start (serverless filesystems
  // aren't persistent), and the legacy hardcoded fallback is identical across
  // every deploy that hits it — both are serious enough to fail the boot loudly
  // so the deployer notices.
  if (
    deployEnvironment !== "local" ||
    (process.env.NODE_ENV === "production" && !explicitlyLocal)
  ) {
    const report = getRuntimeConfigReport(
      process.env,
      { authEnabled: true, databaseRequired: false },
      {
        environment: "production",
        phase: "runtime",
        appName: process.env.APP_NAME,
      },
    );
    throw new Error(formatRuntimeConfigReport(report));
  }

  // SECURITY (audit 09 LOW-2): the previous fallback chain
  // (`GOOGLE_CLIENT_SECRET || ACCESS_TOKEN || hardcoded`) reused
  // cross-purpose secrets and a public hardcoded literal as the cookie
  // HMAC. Dropped entirely — local development gets a dedicated generated
  // secret rather than reusing a Google client secret or a known string.
  const existing = readEnvLocalSecret(path.resolve(appRoot, ".env.local"));
  if (existing) return existing;

  // The persisted file is the dev-session contract: a process-local secret
  // would silently sign everyone out on every restart. Persistence failures
  // throw (see DevAuthSecretFileError) rather than rotating the key.
  return resolvePersistedDevAuthSecret(appRoot, () =>
    crypto.randomBytes(32).toString("hex"),
  );
}

function readEnvLocalSecret(envLocalPath: string): string | undefined {
  try {
    const content = fs.readFileSync(envLocalPath, "utf8");
    // Match `BETTER_AUTH_SECRET=...` on its own line. Tolerate optional
    // quotes and leading `export `. Stop at the first newline or quote.
    const m = content.match(
      /^(?:export\s+)?BETTER_AUTH_SECRET\s*=\s*"?([^"\r\n]+)"?\s*$/m,
    );
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function normalizeTrackingSlug(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const unscoped = trimmed.startsWith("@")
    ? (trimmed.split("/").pop() ?? trimmed)
    : trimmed;
  const slug = unscoped
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || undefined;
}

function knownTemplateSlug(value: string | undefined): string | undefined {
  const slug = normalizeTrackingSlug(value);
  if (!slug) return undefined;
  const withoutPrefix = slug.startsWith("agent-native-")
    ? slug.slice("agent-native-".length)
    : slug;
  return TEMPLATES.some((template) => template.name === withoutPrefix)
    ? withoutPrefix
    : undefined;
}

function readPackageName(): string | undefined {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
      name?: string;
    };
    return pkg.name;
  } catch {
    return undefined;
  }
}

function appSlugFromUrl(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  try {
    const raw = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
      ? value
      : `https://${value}`;
    const hostname = new URL(raw).hostname.toLowerCase();
    if (hostname.endsWith(".agent-native.com")) {
      return normalizeTrackingSlug(
        hostname.slice(0, -".agent-native.com".length),
      );
    }
    return normalizeTrackingSlug(hostname.split(".")[0]);
  } catch {
    return undefined;
  }
}

/** @internal */
export function resolveSignupTrackingIdentity(): {
  app?: string;
  template?: string;
} {
  const explicitApp =
    normalizeTrackingSlug(process.env.AGENT_NATIVE_APP) ||
    normalizeTrackingSlug(process.env.VITE_AGENT_NATIVE_APP);
  const packageApp =
    normalizeTrackingSlug(process.env.npm_package_name) ||
    normalizeTrackingSlug(readPackageName());
  const urlApp =
    appSlugFromUrl(process.env.APP_URL) ||
    appSlugFromUrl(process.env.BETTER_AUTH_URL) ||
    appSlugFromUrl(process.env.URL) ||
    appSlugFromUrl(process.env.DEPLOY_URL) ||
    appSlugFromUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ||
    appSlugFromUrl(process.env.VERCEL_URL);
  const app =
    explicitApp ||
    urlApp ||
    packageApp ||
    normalizeTrackingSlug(process.env.APP_NAME);

  const template =
    knownTemplateSlug(process.env.AGENT_NATIVE_TEMPLATE) ||
    knownTemplateSlug(process.env.VITE_AGENT_NATIVE_TEMPLATE) ||
    knownTemplateSlug(process.env.APP_TEMPLATE) ||
    knownTemplateSlug(process.env.VITE_APP_TEMPLATE) ||
    knownTemplateSlug(app) ||
    knownTemplateSlug(packageApp) ||
    knownTemplateSlug(urlApp);

  return {
    ...(app ? { app } : {}),
    ...(template ? { template } : {}),
  };
}

/** @internal */
export function resolveSignupTrackingProperties(): Record<string, string> {
  const identity = resolveSignupTrackingIdentity();
  return {
    ...identity,
    ...(identity.app ? { agent_native_app: identity.app } : {}),
    ...(identity.template ? { agent_native_template: identity.template } : {}),
  };
}

export function shouldSkipEmailVerification(): boolean {
  const value = process.env.AUTH_SKIP_EMAIL_VERIFICATION;
  if (value == null) {
    const deployContext =
      process.env.AGENT_NATIVE_BUILD_DEPLOY_CONTEXT || process.env.CONTEXT;
    return (
      process.env.NODE_ENV === "development" ||
      process.env.NODE_ENV === "test" ||
      deployContext === "deploy-preview"
    );
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
}

export function isDeployPreview(): boolean {
  const deployContext =
    process.env.AGENT_NATIVE_BUILD_DEPLOY_CONTEXT || process.env.CONTEXT;
  return deployContext === "deploy-preview";
}

export function resolveEmailPasswordAuthPolicy(
  emailReadiness: EmailReadiness,
): {
  requireEmailVerification: boolean;
  disableSignUp: boolean;
} {
  const emailConfigured = emailReadiness.status === "ready";
  const emailProviderMissing = emailReadiness.status === "not-configured";
  const declared = getAppConfig().auth.requireEmailVerification;
  if (declared !== undefined) {
    // A declared policy is the verification policy — it outranks both the
    // hosted derivation below and AUTH_SKIP_EMAIL_VERIFICATION. The signup
    // lock still fails closed for a configured transport that cannot be read.
    return {
      requireEmailVerification: declared && emailConfigured,
      // Verification that no provider can deliver would strand every new
      // account on an unverifiable signup, so refuse the signup instead. An
      // explicitly absent provider is the documented password-only mode.
      disableSignUp: emailProviderMissing ? declared : !emailConfigured,
    };
  }
  const hosted = process.env.NODE_ENV === "production" || isDeployPreview();
  return {
    requireEmailVerification:
      emailConfigured && (hosted || !shouldSkipEmailVerification()),
    // Only an explicitly absent provider enables unverified password signup.
    // Misconfigured or unavailable transports fail closed instead.
    disableSignUp: !emailConfigured && !emailProviderMissing,
  };
}

/** Read-only accessor for the resolved auth secret. */
export function getAuthSecret(): string {
  return resolveAuthSecret();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The shape we need from a Better Auth instance (internal — not exported to templates). */
export interface BetterAuthInstance {
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (opts: { headers: Headers }) => Promise<{
      user: {
        id: string;
        email: string;
        name: string;
        emailVerified: boolean;
      };
      session: {
        id: string;
        token: string;
        expiresAt: Date;
      };
    } | null>;
    signInEmail: (opts: {
      body: { email: string; password: string };
      headers?: Headers;
      returnHeaders?: boolean;
    }) => Promise<any>;
    signInMagicLink: (opts: {
      body: {
        email: string;
        name?: string;
        callbackURL?: string;
        newUserCallbackURL?: string;
        errorCallbackURL?: string;
        metadata?: Record<string, unknown>;
      };
      headers: Headers;
    }) => Promise<{ status: boolean }>;
    listUserAccounts: (opts: {
      headers: Headers;
    }) => Promise<Array<{ providerId: string }>>;
    setPassword: (opts: {
      body: { newPassword: string };
      headers: Headers;
    }) => Promise<{ status: boolean }>;
    changePassword: (opts: {
      body: { currentPassword: string; newPassword: string };
      headers: Headers;
    }) => Promise<{ status: boolean }>;
    signUpEmail: (opts: {
      body: {
        email: string;
        password: string;
        name: string;
        callbackURL?: string;
      };
      headers?: Headers;
    }) => Promise<any>;
    signOut: (opts: {
      headers: Headers;
      returnHeaders?: boolean;
    }) => Promise<any>;
    enableTwoFactor: (opts: {
      body: { method: "totp"; password?: string };
      headers: Headers;
      returnHeaders?: boolean;
    }) => Promise<any>;
    disableTwoFactor: (opts: {
      body: { password?: string };
      headers: Headers;
      returnHeaders?: boolean;
    }) => Promise<any>;
    verifyTOTP: (opts: {
      body: { code: string; trustDevice?: boolean };
      headers: Headers;
      returnHeaders?: boolean;
    }) => Promise<any>;
  };
}

export interface BetterAuthConfig {
  /** Base path for Better Auth routes. Default: "/_agent-native/auth/ba" */
  basePath?: string;
  /** Session max age in seconds. Defaults to the framework's 30-day lifetime. */
  sessionMaxAge?: number;
  /** Additional social providers beyond what env vars auto-detect */
  socialProviders?: BetterAuthOptions["socialProviders"];
  /** Additional Better Auth plugins */
  plugins?: BetterAuthOptions["plugins"];
  /**
   * Additional Google OAuth scopes (Gmail, Calendar, etc.) to request
   * up front during the primary "Sign in with Google" flow, beyond the
   * default identity scopes (`openid`, `email`, `profile`).
   *
   * When set, the Google social provider also opts into:
   * - `accessType: "offline"` — so a refresh token is issued
   * - `prompt: "consent"` — so the refresh token is reissued every sign-in
   *
   * Tokens are mirrored into `oauth_tokens` via a databaseHooks.account
   * hook so existing template code that reads from `oauth_tokens` (mail's
   * Gmail client, calendar's events fetcher) works without any separate
   * "Connect Google" page.
   */
  googleScopes?: string[];
}

// ---------------------------------------------------------------------------
// Lazy instance
// ---------------------------------------------------------------------------

let _auth: BetterAuthInstance | undefined;
let _initPromise: Promise<BetterAuthInstance> | undefined;
// Track the Neon serverless Pool we open for Better Auth so closeBetterAuth()
// can release it. The Pool keeps WebSocket connections open; leaking them on
// hot-reload or process restart exhausts Neon's connection slot budget.
let _neonAuthPool: any;

const pgAuthSchema = {
  user: pgTable("user", {
    id: pgText("id").primaryKey(),
    name: pgText("name").notNull(),
    email: pgText("email").notNull().unique(),
    emailVerified: pgBoolean("email_verified").notNull().default(false),
    twoFactorEnabled: pgBoolean("two_factor_enabled").notNull().default(false),
    onboardingRole: pgText("onboarding_role"),
    image: pgText("image"),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  twoFactor: pgTable("twoFactor", {
    id: pgText("id").primaryKey(),
    secret: pgText("secret").notNull(),
    backupCodes: pgText("backup_codes").notNull(),
    // guard:allow-identity-column — immutable Better Auth user id owned by the auth plugin
    userId: pgText("user_id").notNull(),
    verified: pgBoolean("verified").notNull().default(true),
    failedVerificationCount: pgBigint("failed_verification_count", {
      mode: "number",
    })
      .notNull()
      .default(0),
    lockedUntil: pgTimestamp("locked_until", { withTimezone: true }),
  }),
  session: pgTable("session", {
    id: pgText("id").primaryKey(),
    expiresAt: pgTimestamp("expires_at", { withTimezone: true }).notNull(),
    token: pgText("token").notNull().unique(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: pgText("ip_address"),
    userAgent: pgText("user_agent"),
    userId: pgText("user_id").notNull(),
    activeOrganizationId: pgText("active_organization_id"),
  }),
  account: pgTable("account", {
    id: pgText("id").primaryKey(),
    accountId: pgText("account_id").notNull(),
    providerId: pgText("provider_id").notNull(),
    userId: pgText("user_id").notNull(),
    accessToken: pgText("access_token"),
    refreshToken: pgText("refresh_token"),
    idToken: pgText("id_token"),
    accessTokenExpiresAt: pgTimestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: pgTimestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: pgText("scope"),
    password: pgText("password"),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  verification: pgTable("verification", {
    id: pgText("id").primaryKey(),
    identifier: pgText("identifier").notNull(),
    value: pgText("value").notNull(),
    expiresAt: pgTimestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  organization: pgTable("organization", {
    id: pgText("id").primaryKey(),
    name: pgText("name").notNull(),
    slug: pgText("slug").notNull().unique(),
    logo: pgText("logo"),
    metadata: pgText("metadata"),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  member: pgTable("member", {
    id: pgText("id").primaryKey(),
    organizationId: pgText("organization_id").notNull(),
    userId: pgText("user_id").notNull(),
    role: pgText("role").notNull().default("member"),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  invitation: pgTable("invitation", {
    id: pgText("id").primaryKey(),
    organizationId: pgText("organization_id").notNull(),
    email: pgText("email").notNull(),
    role: pgText("role"),
    status: pgText("status").notNull().default("pending"),
    expiresAt: pgTimestamp("expires_at", { withTimezone: true }).notNull(),
    inviterId: pgText("inviter_id").notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  jwks: pgTable("jwks", {
    id: pgText("id").primaryKey(),
    publicKey: pgText("public_key").notNull(),
    privateKey: pgText("private_key").notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: pgTimestamp("expires_at", { withTimezone: true }),
    // Better Auth writes both on every minted key, and the Drizzle adapter
    // rejects a create whose fields are missing here: without them the app
    // cannot mint a signing key at all.
    alg: pgText("alg"),
    crv: pgText("crv"),
  }),
  // Better Auth's opt-in SSO/SCIM plugins use these model keys. Keep their
  // Drizzle schema here even when the plugins are disabled so enabling either
  // feature later does not require a generated-schema deployment.
  ssoProvider: pgTable("sso_provider", {
    id: pgText("id").primaryKey(),
    issuer: pgText("issuer").notNull(),
    oidcConfig: pgText("oidc_config"),
    samlConfig: pgText("saml_config"),
    userId: pgText("user_id"),
    providerId: pgText("provider_id").notNull().unique(),
    organizationId: pgText("organization_id"),
    domain: pgText("domain").notNull(),
    domainVerified: pgBoolean("domain_verified"),
  }),
  scimManagedConnection: pgTable("scim_managed_connection", {
    id: pgText("id").primaryKey(),
    creationRequestId: pgText("creation_request_id").notNull().unique(),
    connectionId: pgText("connection_id").notNull().unique(),
    provisioningDomainId: pgText("provisioning_domain_id").notNull(),
    status: pgText("status").notNull(),
    revision: pgBigint("revision", { mode: "number" }).notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    createdBy: pgText("created_by").notNull(),
    decommissionStartedAt: pgTimestamp("decommission_started_at", {
      withTimezone: true,
    }),
    decommissionStartedBy: pgText("decommission_started_by"),
    decommissionedAt: pgTimestamp("decommissioned_at", {
      withTimezone: true,
    }),
    decommissionedBy: pgText("decommissioned_by"),
  }),
  scimManagedCredential: pgTable("scim_managed_credential", {
    id: pgText("id").primaryKey(),
    connectionRecordId: pgText("connection_record_id").notNull(),
    credentialId: pgText("credential_id").notNull().unique(),
    tokenDigest: pgText("token_digest").notNull(),
    hashVersion: pgText("hash_version").notNull(),
    activeSlotKey: pgText("active_slot_key").notNull().unique(),
    status: pgText("status").notNull(),
    serializedScopes: pgText("serialized_scopes").notNull(),
    expiresAt: pgTimestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    createdBy: pgText("created_by").notNull(),
    lastUsedAt: pgTimestamp("last_used_at", { withTimezone: true }),
    revokedAt: pgTimestamp("revoked_at", { withTimezone: true }),
    revokedBy: pgText("revoked_by"),
    decommissionedAt: pgTimestamp("decommissioned_at", {
      withTimezone: true,
    }),
  }),
  scimManagedConnectionEvent: pgTable("scim_managed_connection_event", {
    id: pgText("id").primaryKey(),
    connectionRecordId: pgText("connection_record_id").notNull(),
    eventKey: pgText("event_key").notNull().unique(),
    sequence: pgBigint("sequence", { mode: "number" }).notNull(),
    type: pgText("type").notNull(),
    actorId: pgText("actor_id").notNull(),
    credentialId: pgText("credential_id"),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
  }),
  scimConnectionBinding: pgTable("scim_connection_binding", {
    id: pgText("id").primaryKey(),
    connectionId: pgText("connection_id").notNull(),
    connectionKey: pgText("connection_key").notNull().unique(),
    provisioningDomainId: pgText("provisioning_domain_id").notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    decommissionedAt: pgTimestamp("decommissioned_at", {
      withTimezone: true,
    }),
    decommissionStatus: pgText("decommission_status")
      .notNull()
      .default("active"),
    decommissionCursorUserId: pgText("decommission_cursor_user_id"),
    decommissionReconciledUserCount: pgBigint(
      "decommission_reconciled_user_count",
      { mode: "number" },
    )
      .notNull()
      .default(0),
    decommissionBatchCount: pgBigint("decommission_batch_count", {
      mode: "number",
    })
      .notNull()
      .default(0),
    decommissionRevision: pgBigint("decommission_revision", {
      mode: "number",
    })
      .notNull()
      .default(0),
    decommissionCompletedAt: pgTimestamp("decommission_completed_at", {
      withTimezone: true,
    }),
    decommissionLeaseId: pgText("decommission_lease_id"),
    decommissionLeaseExpiresAt: pgTimestamp("decommission_lease_expires_at", {
      withTimezone: true,
    }),
  }),
  scimIdentityTombstone: pgTable("scim_identity_tombstone", {
    id: pgText("id").primaryKey(),
    connectionId: pgText("connection_id").notNull(),
    provisioningDomainId: pgText("provisioning_domain_id").notNull(),
    externalId: pgText("external_id").notNull(),
    externalIdKey: pgText("external_id_key").notNull().unique(),
    userId: pgText("user_id").notNull(),
    profile: pgText("profile").notNull(),
    deletedAt: pgTimestamp("deleted_at", { withTimezone: true }).notNull(),
  }),
  scimSubject: pgTable("scim_subject", {
    id: pgText("id").primaryKey(),
    userId: pgText("user_id").notNull().unique(),
    profileSourceId: pgText("profile_source_id"),
    revision: pgBigint("revision", { mode: "number" }).notNull(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  scimUser: pgTable("scim_user", {
    id: pgText("id").primaryKey(),
    connectionId: pgText("connection_id").notNull(),
    provisioningDomainId: pgText("provisioning_domain_id").notNull(),
    userId: pgText("user_id").notNull(),
    connectionUserKey: pgText("connection_user_key").notNull().unique(),
    userName: pgText("user_name").notNull(),
    userNameKey: pgText("user_name_key").notNull().unique(),
    primaryEmail: pgText("primary_email").notNull(),
    workEmailValueIndex: pgText("work_email_value_index").notNull(),
    emailValueIndex: pgText("email_value_index").notNull(),
    displayName: pgText("display_name").notNull(),
    formattedName: pgText("formatted_name").notNull(),
    givenName: pgText("given_name"),
    familyName: pgText("family_name"),
    serializedEmails: pgText("serialized_emails").notNull(),
    serializedAttributes: pgText("serialized_attributes"),
    externalId: pgText("external_id"),
    externalIdKey: pgText("external_id_key").unique(),
    active: pgBoolean("active").notNull(),
    orderKey: pgText("order_key").notNull().unique(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  scimProjectionGrant: pgTable("scim_projection_grant", {
    id: pgText("id").primaryKey(),
    connectionId: pgText("connection_id").notNull(),
    provisioningDomainId: pgText("provisioning_domain_id").notNull(),
    scimUserId: pgText("scim_user_id").notNull(),
    userId: pgText("user_id").notNull(),
    sourceKind: pgText("source_kind").notNull(),
    sourceId: pgText("source_id").notNull(),
    sourceValue: pgText("source_value"),
    role: pgText("role").notNull(),
    grantKey: pgText("grant_key").notNull().unique(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  scimGroup: pgTable("scim_group", {
    id: pgText("id").primaryKey(),
    connectionId: pgText("connection_id").notNull(),
    provisioningDomainId: pgText("provisioning_domain_id").notNull(),
    revision: pgBigint("revision", { mode: "number" }).notNull().default(0),
    displayName: pgText("display_name").notNull(),
    displayNameKey: pgText("display_name_key").notNull().unique(),
    externalId: pgText("external_id"),
    externalIdKey: pgText("external_id_key").unique(),
    orderKey: pgText("order_key").notNull().unique(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
  }),
  scimGroupMember: pgTable("scim_group_member", {
    id: pgText("id").primaryKey(),
    connectionId: pgText("connection_id").notNull(),
    groupId: pgText("group_id").notNull(),
    scimUserId: pgText("scim_user_id").notNull(),
    membershipKey: pgText("membership_key").notNull().unique(),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
  }),
  // Application-owned bridge models used by the SCIM identity callback. They
  // are deliberately keyed by Better Auth userId, never by an email column.
  frameworkOrganization: pgTable("organizations", {
    id: pgText("id").primaryKey(),
    name: pgText("name").notNull(),
    createdBy: pgText("created_by").notNull(),
    createdAt: pgBigint("created_at", { mode: "number" }).notNull(),
    allowedDomain: pgText("allowed_domain"),
  }),
  orgMember: pgTable("org_members", {
    id: pgText("id").primaryKey(),
    orgId: pgText("org_id").notNull(),
    email: pgText("email").notNull(),
    role: pgText("role").notNull(),
    joinedAt: pgBigint("joined_at", { mode: "number" }).notNull(),
    federationRemovalPendingAt: pgBigint("federation_removal_pending_at", {
      mode: "number",
    }),
  }),
  agentAuditLog: pgTable("agent_audit_log", {
    id: pgText("id").primaryKey(),
    createdAt: pgBigint("created_at", { mode: "number" }).notNull(),
    action: pgText("action").notNull(),
    caller: pgText("caller").notNull(),
    actorKind: pgText("actor_kind").notNull(),
    actorEmail: pgText("actor_email"),
    orgId: pgText("org_id"),
    targetType: pgText("target_type"),
    targetId: pgText("target_id"),
    status: pgText("status").notNull(),
    summary: pgText("summary"),
    input: pgText("input"),
    ownerEmail: pgText("owner_email"),
    visibility: pgText("visibility").notNull().default("private"),
  }),
  orgScimMembership: pgTable("org_scim_memberships", {
    id: pgText("id").primaryKey(),
    orgId: pgText("org_id").notNull(),
    userId: pgText("user_id").notNull(),
    memberId: pgText("member_id"),
    createdMembership: pgBoolean("created_membership").notNull(),
    createdAt: pgBigint("created_at", { mode: "number" }).notNull(),
  }),
  appMemberRole: pgTable("app_member_roles", {
    id: pgText("id").primaryKey(),
    orgId: pgText("org_id").notNull(),
    appId: pgText("app_id").notNull(),
    email: pgText("email").notNull(),
    role: pgText("role").notNull(),
    updatedBy: pgText("updated_by").notNull(),
    updatedAt: pgBigint("updated_at", { mode: "number" }).notNull(),
  }),
};

/**
 * Mirror a Better Auth `account` row for Google into the `oauth_tokens`
 * table that template code (mail's Gmail client, calendar's events fetcher)
 * reads from. Called from the `databaseHooks.account.create.after` and
 * `.update.after` hooks so tokens captured during the primary "Sign in
 * with Google" flow flow straight to the apps that need them — no
 * separate "Connect Google" page required.
 *
 * Resolves `account.userId` to the user's email by querying the `user`
 * table (Better Auth always quotes "user" because it's a reserved word
 * in Postgres).
 *
 * The hook is fire-and-forget from the caller's perspective — every
 * failure is caught upstream so a flake in `oauth_tokens` never blocks
 * sign-in. We still no-op on missing fields here as a defense in depth.
 */
async function mirrorGoogleAccountToOAuthTokens(account: {
  providerId?: string;
  userId?: string;
  accountId?: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  accessTokenExpiresAt?: Date | string | number | null;
  scope?: string | null;
  idToken?: string | null;
}): Promise<void> {
  if (!account || account.providerId !== "google") return;
  if (!account.userId) return;

  const accessToken = account.accessToken ?? undefined;
  if (!accessToken) {
    // Better Auth sometimes upserts an account row before tokens are
    // attached (e.g. linking flows). Nothing to mirror yet — the next
    // update hook will run once the access token lands.
    return;
  }

  // Resolve user email from userId.
  const db = getDbExec();
  let email: string | undefined;
  try {
    const { rows } = await db.execute({
      sql: 'SELECT email FROM "user" WHERE id = ?',
      args: [account.userId],
    });
    email = (rows[0]?.email as string | undefined) ?? undefined;
  } catch (err) {
    console.error(
      "[auth] mirror Google tokens: failed to resolve user email from userId",
      err,
    );
    return;
  }
  if (!email) return;

  // Normalise expiry to epoch ms (Google's "expiry_date" convention used
  // throughout the templates).
  let expiryDate: number | undefined;
  const raw = account.accessTokenExpiresAt;
  if (raw instanceof Date) {
    expiryDate = raw.getTime();
  } else if (typeof raw === "number") {
    expiryDate = raw;
  } else if (typeof raw === "string") {
    const ms = Date.parse(raw);
    expiryDate = Number.isFinite(ms) ? ms : undefined;
  }

  const tokens: Record<string, unknown> = {
    access_token: accessToken,
    token_type: "Bearer",
  };
  if (account.refreshToken) tokens.refresh_token = account.refreshToken;
  if (expiryDate) tokens.expiry_date = expiryDate;
  if (account.scope) tokens.scope = account.scope;
  if (account.idToken) tokens.id_token = account.idToken;

  await saveOAuthTokens("google", email, tokens, email);
}

/**
 * Get or create the Better Auth instance.
 * Lazily initialized on first call — the database must be reachable by then.
 */
export async function getBetterAuth(
  config?: BetterAuthConfig,
): Promise<BetterAuthInstance> {
  if (_auth) return _auth;
  if (_initPromise) return _initPromise;

  // A failed boot must not be cached: every later request would replay the same
  // stale error with no way back short of restarting the process.
  _initPromise = createBetterAuthInstance(config).catch((error) => {
    _initPromise = undefined;
    throw error;
  });
  _auth = await _initPromise;
  return _auth;
}

/**
 * Synchronous getter — returns the instance if already initialized, else undefined.
 * Use this in hot paths where you know init has already happened.
 */
export function getBetterAuthSync(): BetterAuthInstance | undefined {
  return _auth;
}

const BETTER_AUTH_MAGIC_LINK_VERIFY_MARKER =
  "/_agent-native/auth/ba/magic-link/verify";
const DESKTOP_MAGIC_LINK_CALLBACK_MARKER =
  "/_agent-native/auth/magic-link/desktop-callback";
const DESKTOP_MAGIC_LINK_LANDING_MARKER =
  "/_agent-native/auth/magic-link/desktop-landing";

/**
 * Email security scanners commonly prefetch ordinary GET links. Better Auth
 * intentionally consumes a magic-link token on that first GET, so a scanner
 * can otherwise spend a desktop flow before the user ever clicks it. Keep the
 * normal web link unchanged and put only desktop flows behind an explicit
 * confirmation page that hands the original verification URL back after the
 * user acts.
 */
export function desktopMagicLinkLandingUrl(value: string): string | undefined {
  try {
    const verificationUrl = new URL(value);
    const callbackValue = verificationUrl.searchParams.get("callbackURL");
    if (!callbackValue) return undefined;
    const callbackUrl = new URL(callbackValue, verificationUrl.origin);
    if (callbackUrl.origin !== verificationUrl.origin) return undefined;
    // Better Auth issued these URLs in the public namespace; compare them in
    // the internal form the markers are written in.
    if (
      !canonicalFrameworkPathname(callbackUrl.pathname).endsWith(
        DESKTOP_MAGIC_LINK_CALLBACK_MARKER,
      )
    ) {
      return undefined;
    }

    const verificationPathname = canonicalFrameworkPathname(
      verificationUrl.pathname,
    );
    const verifyMarkerIndex = verificationPathname.lastIndexOf(
      BETTER_AUTH_MAGIC_LINK_VERIFY_MARKER,
    );
    if (verifyMarkerIndex < 0) return undefined;

    const landingUrl = new URL(verificationUrl.origin);
    landingUrl.pathname = publicFrameworkPath(
      verificationPathname.slice(0, verifyMarkerIndex) +
        DESKTOP_MAGIC_LINK_LANDING_MARKER,
    );
    for (const key of [
      "token",
      "callbackURL",
      "newUserCallbackURL",
      "errorCallbackURL",
    ]) {
      const queryValue = verificationUrl.searchParams.get(key);
      if (queryValue) landingUrl.searchParams.set(key, queryValue);
    }
    return landingUrl.toString();
  } catch {
    // coercion-ok: malformed provider URLs keep the original link unchanged.
    return undefined;
  }
}

/**
 * The subset of Better Auth's internal adapter we use for federated-SSO
 * JIT account linking. Better Auth owns these writes (id + timestamp +
 * schema handling), so callers never hand-roll SQL against `user`/`account`
 * for ordinary identity writes. The transactional claimant replacement uses
 * the shared database boundary so its delete, promotion, and link commit
 * together.
 */
export interface BetterAuthInternalAdapter {
  findUserByEmail: (
    email: string,
    options?: { includeAccounts: boolean },
  ) => Promise<{
    user: {
      id: string;
      email: string;
      name?: string;
      image?: string | null;
      emailVerified?: boolean;
      onboardingRole?: string | null;
    };
    accounts: Array<{ id: string; providerId: string; accountId: string }>;
  } | null>;
  listUsers?: (
    limit?: number,
    offset?: number,
    sortBy?: { field: string; direction: "asc" | "desc" },
    where?: Array<{
      field: string;
      value: string | number | boolean | string[] | number[] | Date | null;
      operator?:
        | "eq"
        | "ne"
        | "lt"
        | "lte"
        | "gt"
        | "gte"
        | "in"
        | "not_in"
        | "contains"
        | "starts_with"
        | "ends_with";
      connector?: "AND" | "OR";
      mode?: "sensitive" | "insensitive";
    }>,
  ) => Promise<
    Array<{
      id: string;
      email: string;
      name?: string;
      image?: string | null;
    }>
  >;
  linkAccount: (account: {
    userId: string;
    providerId: string;
    accountId: string;
  }) => Promise<unknown>;
  createUser: (user: {
    email: string;
    name: string;
    image?: string | null;
    emailVerified?: boolean;
  }) => Promise<{ id: string }>;
  createSession: (
    userId: string,
    dontRememberMe?: boolean,
    override?: { expiresAt?: Date },
    overrideAll?: boolean,
  ) => Promise<{ token: string }>;
  deleteSession: (token: string) => Promise<void>;
  createOAuthUser?: (
    user: {
      email: string;
      name: string;
      image?: string | null;
      emailVerified?: boolean;
    },
    account: { providerId: string; accountId: string },
  ) => Promise<{ user: { id: string }; account: unknown }>;
  findAccountByProviderId: (
    accountId: string,
    providerId: string,
  ) => Promise<{ id: string; userId: string } | null>;
  replaceUnverifiedCredentialWithGoogle: (input: {
    userId: string;
    email: string;
    accountId: string;
  }) => Promise<void>;
  updateUser?: (
    userId: string,
    data: {
      name?: string;
      image?: string | null;
      emailVerified?: boolean;
      onboardingRole?: string | null;
    },
  ) => Promise<unknown>;
}

type BetterAuthContextAdapter = Omit<
  BetterAuthInternalAdapter,
  "replaceUnverifiedCredentialWithGoogle" | "findAccountByProviderId"
> & {
  findAccountByProviderId?: BetterAuthInternalAdapter["findAccountByProviderId"];
  findAccountByKey?: (accountKey: {
    accountId: string;
    providerId: string;
  }) => Promise<{ id: string; userId: string } | null>;
};

export function normalizeBetterAuthInternalAdapter(
  adapter: BetterAuthContextAdapter,
): BetterAuthInternalAdapter | undefined {
  const findAccountByProviderId =
    adapter.findAccountByProviderId ??
    (typeof adapter.findAccountByKey === "function"
      ? (accountId: string, providerId: string) =>
          adapter.findAccountByKey!({ accountId, providerId })
      : undefined);

  if (
    typeof adapter.findUserByEmail !== "function" ||
    typeof adapter.linkAccount !== "function" ||
    typeof adapter.createUser !== "function" ||
    typeof adapter.createSession !== "function" ||
    typeof adapter.deleteSession !== "function" ||
    typeof findAccountByProviderId !== "function"
  ) {
    return undefined;
  }

  return {
    ...adapter,
    findAccountByProviderId,
    replaceUnverifiedCredentialWithGoogle,
  } as BetterAuthInternalAdapter;
}

/**
 * Replace the only unverified credential account and add Google in one
 * database transaction. The read in ensureGoogleAuthIdentityWithAdapter is
 * only a fast path check; this method revalidates the account set while the
 * transaction owns the user row so a stale lookup cannot delete a different
 * identity.
 */
export async function replaceUnverifiedCredentialWithGoogle(input: {
  userId: string;
  email: string;
  accountId: string;
}): Promise<void> {
  const db = getDbExec();
  if (!db.transaction) {
    throw new Error(
      "Cannot replace an unverified credential identity without a database transaction",
    );
  }

  const timestamp = new Date().toISOString();
  const unverified = false;

  await db.transaction(async (tx) => {
    await tx.execute({
      sql: "SELECT pg_advisory_xact_lock(hashtextextended(?, 0::bigint))",
      args: [`google:${input.accountId}`],
    });

    const currentUser = await tx.execute({
      sql: 'SELECT id FROM "user" WHERE id = ? AND email = ? AND email_verified = ? FOR UPDATE',
      args: [input.userId, input.email, unverified],
    });
    if (currentUser.rows.length !== 1) {
      throw new Error(
        "The unverified credential identity changed before Google linking",
      );
    }

    const linkedGoogle = await tx.execute({
      sql: 'SELECT user_id FROM "account" WHERE provider_id = ? AND account_id = ? FOR UPDATE',
      args: ["google", input.accountId],
    });
    const linkedUserId = linkedGoogle.rows[0]?.user_id;
    if (linkedUserId && linkedUserId !== input.userId) {
      throw new Error("Google account is already linked to another user");
    }
    if (linkedUserId === input.userId) return;

    const accounts = await tx.execute({
      sql: 'SELECT id, provider_id FROM "account" WHERE user_id = ?',
      args: [input.userId],
    });
    const credentialRows = accounts.rows.filter(
      (row) => row.provider_id === "credential",
    );
    const claimRows = accounts.rows.filter(
      (row) =>
        row.provider_id !== "credential" &&
        row.provider_id !== IDENTITY_SSO_PROVIDER_ID,
    );
    if (credentialRows.length !== 1 || claimRows.length > 0) {
      throw new Error("Cannot link Google to an ambiguous unverified identity");
    }

    const credentialId = credentialRows[0]?.id;
    const deleted = await tx.execute({
      sql: 'DELETE FROM "account" WHERE id = ? AND user_id = ? AND provider_id = ?',
      args: [credentialId, input.userId, "credential"],
    });
    if (deleted.rowsAffected !== 1) {
      throw new Error(
        "The unverified credential identity changed before Google linking",
      );
    }

    const updated = await tx.execute({
      sql: 'UPDATE "user" SET email_verified = ?, updated_at = ? WHERE id = ? AND email = ? AND email_verified = ?',
      args: [true, timestamp, input.userId, input.email, unverified],
    });
    if (updated.rowsAffected !== 1) {
      throw new Error(
        "The unverified credential identity changed before Google linking",
      );
    }

    await tx.execute({
      sql: 'INSERT INTO "account" (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      args: [
        crypto.randomUUID(),
        input.accountId,
        "google",
        input.userId,
        timestamp,
        timestamp,
      ],
    });
  });
}

/**
 * Resolve Better Auth's internal adapter via the live instance's
 * `$context`. The framework's narrowed `BetterAuthInstance` interface omits
 * `$context`, but the underlying object created by `betterAuth(...)` always
 * exposes it (see Better Auth's `Auth` type) — so this is a safe, typed
 * accessor for the federated-SSO client. Better Auth 1.7.x renamed the
 * provider lookup to `findAccountByKey`, so normalize both adapter shapes.
 */
export async function getBetterAuthInternalAdapter(
  config?: BetterAuthConfig,
): Promise<BetterAuthInternalAdapter | undefined> {
  const auth = (await getBetterAuth(config)) as unknown as {
    $context?: Promise<{
      internalAdapter?: BetterAuthContextAdapter;
    }>;
  };
  try {
    const ctx = await auth.$context;
    const ia = ctx?.internalAdapter;
    if (ia) return normalizeBetterAuthInternalAdapter(ia);
  } catch {
    // Context resolution failed — caller falls back to the signup path.
  }
  return undefined;
}

/**
 * Run a password action with a Better Auth session for the framework's legacy
 * session boundary, deleting a session created only for this operation.
 */
type BetterAuthActionSessionOverrides = {
  auth?: BetterAuthInstance;
  createSession?: typeof createBetterAuthSessionForEmail;
  adapter?: BetterAuthInternalAdapter;
};

const BRIDGED_SESSION_TTL_MS = 60_000;
const BRIDGED_SESSION_CLEANUP_TIMEOUT_MS = 5_000;
// ponytail: the short TTL bounds cleanup leaks; add a durable retry queue if failures need stronger guarantees.

export async function withBetterAuthActionSession<T>(
  email: string,
  requestHeaders: Headers,
  action: (headers: Headers) => Promise<T>,
  overrides?: BetterAuthActionSessionOverrides,
): Promise<T> {
  const auth = overrides?.auth ?? (await getBetterAuth());
  const existingSession = await auth.api.getSession({
    headers: requestHeaders,
  });
  if (existingSession) {
    if (
      existingSession.user.email.trim().toLowerCase() !==
      email.trim().toLowerCase()
    ) {
      throw new Error("Authenticated user mismatch.");
    }
    return action(new Headers(requestHeaders));
  }

  const createSession =
    overrides?.createSession ?? createBetterAuthSessionForEmail;
  const session = await createSession(email, undefined, {
    expiresAt: new Date(Date.now() + BRIDGED_SESSION_TTL_MS),
  });
  if (!session) throw new Error("Better Auth session is unavailable.");

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    const headers = new Headers(requestHeaders);
    const authContext = await (
      auth as unknown as {
        $context: Promise<{
          authCookies: {
            sessionToken: { name: string };
            sessionData?: { name: string };
            dontRememberToken: { name: string };
          };
          secret: string;
        }>;
      }
    ).$context;
    const signCookieValue = (value: string) =>
      crypto
        .createHmac("sha256", authContext.secret)
        .update(value)
        .digest("base64");
    const sessionCookieName = authContext.authCookies.sessionToken.name;
    const sessionDataCookieName = authContext.authCookies.sessionData?.name;
    const dontRememberTokenCookieName =
      authContext.authCookies.dontRememberToken.name;
    const sessionCookie = `${sessionCookieName}=${encodeURIComponent(`${session.token}.${signCookieValue(session.token)}`)}`;
    const dontRememberTokenCookie = `${dontRememberTokenCookieName}=${encodeURIComponent(`true.${signCookieValue("true")}`)}`;
    const existingCookies = (headers.get("cookie") ?? "")
      .split(";")
      .filter((part) => {
        const cookieName = part.split("=", 1)[0]?.trim() ?? "";
        return (
          cookieName !== sessionCookieName &&
          cookieName !== dontRememberTokenCookieName &&
          (!sessionDataCookieName ||
            (cookieName !== sessionDataCookieName &&
              !cookieName.startsWith(`${sessionDataCookieName}.`)))
        );
      })
      .filter(Boolean);
    headers.set(
      "cookie",
      [...existingCookies, sessionCookie, dontRememberTokenCookie].join("; "),
    );
    outcome = { ok: true, value: await action(headers) };
  } catch (error) {
    outcome = { ok: false, error };
  }

  try {
    const adapter =
      overrides?.adapter ?? (await getBetterAuthInternalAdapter());
    if (!adapter)
      throw new Error("Better Auth session cleanup is unavailable.");
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        adapter.deleteSession(session.token),
        new Promise<never>((_, reject) => {
          cleanupTimer = setTimeout(() => {
            reject(new Error("Better Auth session cleanup timed out."));
          }, BRIDGED_SESSION_CLEANUP_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (cleanupTimer) clearTimeout(cleanupTimer);
    }
  } catch (error) {
    console.error(
      "[auth] failed to delete temporary Better Auth session",
      error,
    );
  }

  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

/** Create a real Better Auth session for an existing user without credentials. */
export async function createBetterAuthSessionForEmail(
  email: string,
  config?: BetterAuthConfig,
  options?: { expiresAt?: Date },
): Promise<{ email: string; token: string; userId: string } | null> {
  // This helper is used by framework action bridges, but it still creates a
  // real Better Auth session. Do not let it mint a password-shaped session for
  // an organization that requires a provider-specific sign-in.
  if (await getRequiredAuthProviderForEmail(email)) return null;
  const adapter = await getBetterAuthInternalAdapter(config);
  if (!adapter) return null;
  const existing = await adapter.findUserByEmail(email, {
    includeAccounts: false,
  });
  if (!existing) return null;
  const session = options
    ? await adapter.createSession(existing.user.id, true, options, true)
    : await adapter.createSession(existing.user.id);
  return {
    email: existing.user.email,
    token: session.token,
    userId: existing.user.id,
  };
}

/** Set a Better Auth session cookie for a session created through the adapter. */
export async function setBetterAuthSessionCookie(
  event: H3Event,
  token: string,
): Promise<void> {
  const auth = (await getBetterAuth()) as unknown as {
    $context?: Promise<{
      authCookies: {
        sessionToken: {
          name: string;
          attributes: Record<string, unknown>;
        };
        sessionData: {
          name: string;
          attributes: Record<string, unknown>;
        };
        dontRememberToken: {
          name: string;
          attributes: Record<string, unknown>;
        };
      };
      secret: string;
      sessionConfig: { expiresIn: number };
    }>;
  };
  const context = await auth.$context;
  if (!context) throw new Error("Better Auth context is unavailable.");

  const signCookieValue = (value: string) =>
    crypto.createHmac("sha256", context.secret).update(value).digest("base64");
  const sessionCookie = context.authCookies.sessionToken;
  setCookie(event, sessionCookie.name, `${token}.${signCookieValue(token)}`, {
    ...sessionCookie.attributes,
    maxAge: context.sessionConfig.expiresIn,
  } as any);

  const incomingCookieNames = (event.headers.get("cookie") ?? "")
    .split(";")
    .map((part) => part.split("=", 1)[0]?.trim() ?? "")
    .filter(Boolean);
  const sessionDataCookie = context.authCookies.sessionData;
  const sessionDataNames = new Set([
    sessionDataCookie.name,
    ...incomingCookieNames.filter((name) =>
      name.startsWith(`${sessionDataCookie.name}.`),
    ),
  ]);
  for (const name of sessionDataNames) {
    setCookie(event, name, "", {
      ...sessionDataCookie.attributes,
      maxAge: 0,
    } as any);
  }
  setCookie(event, context.authCookies.dontRememberToken.name, "", {
    ...context.authCookies.dontRememberToken.attributes,
    maxAge: 0,
  } as any);
}

export interface GoogleAuthIdentity {
  email: string;
  accountId: string;
  name?: string;
  image?: string;
}

function googleProfileImage(identity: GoogleAuthIdentity): string | undefined {
  return isGoogleProfileImageUrl(identity.image)
    ? identity.image.trim()
    : undefined;
}

async function syncGoogleProfile(
  adapter: BetterAuthInternalAdapter,
  existing: NonNullable<
    Awaited<ReturnType<BetterAuthInternalAdapter["findUserByEmail"]>>
  >,
  email: string,
  identity: GoogleAuthIdentity,
): Promise<void> {
  if (!adapter.updateUser) return;

  const name = identity.name?.trim();
  const image = googleProfileImage(identity);
  const updates: {
    name?: string;
    image?: string;
  } = {};
  if (
    name &&
    isEmailDerivedName(existing.user.name, email) &&
    existing.user.name?.trim() !== name
  ) {
    updates.name = name;
  }
  if (image && existing.user.image !== image) updates.image = image;
  if (Object.keys(updates).length > 0) {
    await adapter.updateUser(existing.user.id, updates);
  }
}

/**
 * Ensure a verified Google identity has a canonical Better Auth user/account
 * before the legacy email-keyed session is issued. This prevents a later
 * password signup from becoming the first canonical identity for that email.
 * Returns whether this call created the canonical user.
 */
export async function ensureGoogleAuthIdentity(
  identity: GoogleAuthIdentity,
): Promise<boolean> {
  const adapter = await getBetterAuthInternalAdapter();
  if (!adapter) {
    throw new Error("Better Auth internal adapter is unavailable");
  }
  return ensureGoogleAuthIdentityWithAdapter(adapter, identity);
}

export async function ensureGoogleAuthIdentityWithAdapter(
  adapter: BetterAuthInternalAdapter,
  identity: GoogleAuthIdentity,
): Promise<boolean> {
  const email = identity.email.trim().toLowerCase();
  const accountId = identity.accountId.trim();
  if (!email || !accountId) {
    throw new Error("Google identity is missing an email or account id");
  }

  const reconcilePendingInvitations = async (): Promise<void> => {
    try {
      // Google verification can bypass Better Auth's user-create hook, so
      // reconcile invitations only after the verified identity is committed.
      await acceptPendingInvitationsForEmail(email);
    } catch (error) {
      console.error(
        "[auth] failed to reconcile pending invitations after Google verification",
        error,
      );
    }
  };

  const name = identity.name?.trim() || email.split("@")[0] || "User";
  const image = googleProfileImage(identity);
  const user = {
    email,
    name,
    emailVerified: true,
    ...(image ? { image } : {}),
  };
  const findExisting = () =>
    adapter.findUserByEmail(email, { includeAccounts: true });
  let existing = await findExisting();

  // The legacy Google bridge creates a Better Auth user through the internal
  // adapter, so keep the shared admission check here as defense in depth even
  // though normal Better Auth adapter creates run `databaseHooks.user.create.before`.
  if (!existing) await enforceSignupAdmission(user);

  let linkedAccount = await adapter.findAccountByProviderId(
    accountId,
    "google",
  );
  if (linkedAccount) {
    if (!existing || linkedAccount.userId !== existing.user.id) {
      throw new Error("Google account is already linked to another user");
    }
    await syncGoogleProfile(adapter, existing, email, identity);
    return false;
  }

  if (!existing) {
    if (adapter.createOAuthUser) {
      try {
        await adapter.createOAuthUser(user, {
          providerId: "google",
          accountId,
        });
        return true;
      } catch (error) {
        // A concurrent first sign-in may have won the unique-email race. Only
        // continue if the canonical row now exists; otherwise preserve the
        // real adapter error and do not issue a legacy session.
        existing = await findExisting();
        if (!existing) throw error;

        // The account may have been linked by the concurrent sign-in that won
        // the create race. Re-read it before falling through to the legacy
        // link path, which must never create a duplicate association.
        linkedAccount = await adapter.findAccountByProviderId(
          accountId,
          "google",
        );
        if (linkedAccount) {
          if (linkedAccount.userId !== existing.user.id) {
            throw new Error("Google account is already linked to another user");
          }
          await syncGoogleProfile(adapter, existing, email, identity);
          return false;
        }
      }
    } else {
      const created = await adapter.createUser(user);
      await adapter.linkAccount({
        userId: created.id,
        providerId: "google",
        accountId,
      });
      await reconcilePendingInvitations();
      return true;
    }
  }

  if (!existing) {
    throw new Error("Could not resolve the canonical Google user");
  }
  const alreadyLinked = existing.accounts.some(
    (account) =>
      account.providerId === "google" && account.accountId === accountId,
  );
  if (alreadyLinked) {
    await syncGoogleProfile(adapter, existing, email, identity);
    return false;
  }

  // A password signup reserves the email before verification. If that row is
  // credential-only, remove the unverified credential and promote the same
  // canonical user to the verified Google identity. A third-party account makes
  // the claimant ambiguous, so keep the account-claim protection. The
  // framework's own identity-SSO link is not a third party: cross-app JIT
  // provisioning writes it alongside an unusable password credential, so
  // counting it as a claim left federated users permanently unable to sign in
  // with Google against a password account they never knowingly created.
  if (existing.user.emailVerified !== true) {
    const credentialAccounts = existing.accounts.filter(
      (account) => account.providerId === "credential",
    );
    const hasOtherAccounts = existing.accounts.some(
      (account) =>
        account.providerId !== "credential" &&
        account.providerId !== IDENTITY_SSO_PROVIDER_ID,
    );
    if (credentialAccounts.length !== 1 || hasOtherAccounts) {
      throw new Error(
        "Cannot link Google to an unverified email/password identity",
      );
    }

    await adapter.replaceUnverifiedCredentialWithGoogle({
      userId: existing.user.id,
      email,
      accountId,
    });
    await syncGoogleProfile(adapter, existing, email, identity);
    await reconcilePendingInvitations();
    return false;
  }
  await adapter.linkAccount({
    userId: existing.user.id,
    providerId: "google",
    accountId,
  });
  await syncGoogleProfile(adapter, existing, email, identity);
  return false;
}

/** Reset for testing */
export async function resetBetterAuth(): Promise<void> {
  _auth = undefined;
  _initPromise = undefined;
  // The Postgres pool belongs to the process (see `sharedDbPool`), not to Better
  // Auth — ending it here would take the framework's and every store's database
  // access down with it. `closeDbExec()` owns that.
  _neonAuthPool = undefined;
}

// A `closeDbExec()` releases the pool this instance's adapter is bound to, so
// the next `getAuth()` must build a fresh one. Registered from the pooled
// branches rather than at module load: core's specs widely mock
// `db/client.js`, and an import-time call into the mock breaks every one of
// them that doesn't stub this export.
let _poolCloseHookRegistered = false;
function resetAuthOnPoolClose(driver?: string, url?: string): void {
  if (_poolCloseHookRegistered) return;
  _poolCloseHookRegistered = true;
  onSharedDbPoolsClosed(() => {
    _auth = undefined;
    _initPromise = undefined;
    _neonAuthPool = undefined;
  });
  if (driver && url) {
    onSharedDbPoolReplaced(driver, url, () => {
      _auth = undefined;
      _initPromise = undefined;
      _neonAuthPool = undefined;
    });
  }
}

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

async function createBetterAuthInstance(
  config?: BetterAuthConfig,
): Promise<BetterAuthInstance> {
  // Better Auth derives every URL it hands out — social-provider callbacks,
  // magic-link verification, password reset — from this base path, so it
  // must be the PUBLIC one. The framework still mounts the handler on the
  // internal path and passes Better Auth a request in public form.
  const basePath = publicFrameworkPath(
    `${getConfiguredAppBasePath()}${config?.basePath ?? "/_agent-native/auth/ba"}`,
  );
  const access = getAppConfig().access;

  // Build social providers from env vars
  const socialProviders: BetterAuthOptions["socialProviders"] = {
    ...config?.socialProviders,
  };

  const extraScopes = config?.googleScopes ?? [];
  const configuredGoogleProvider =
    typeof config?.socialProviders?.google === "function"
      ? await config.socialProviders.google()
      : config?.socialProviders?.google;
  const configuredGoogleCredentials =
    configuredGoogleProvider &&
    typeof configuredGoogleProvider.clientId === "string" &&
    typeof configuredGoogleProvider.clientSecret === "string"
      ? {
          clientId: configuredGoogleProvider.clientId,
          clientSecret: configuredGoogleProvider.clientSecret,
        }
      : null;
  const googleCredentials =
    extraScopes.length > 0
      ? process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          }
        : configuredGoogleCredentials
      : (resolveGoogleSignInCredentials() ?? configuredGoogleCredentials);
  // Publish the pair actually wired to the provider so the credential
  // self-check probes what the callback uses, not what it would prefer.
  recordActiveGoogleSignInCredentials(googleCredentials);
  if (googleCredentials) {
    // When the template requests broader scopes (Gmail, Calendar, etc.)
    // ask for them on the primary sign-in flow so a separate "Connect
    // Google" round-trip isn't needed. `accessType: "offline"` plus
    // `prompt: "consent"` ensures we always receive a refresh token back —
    // Google only re-issues a refresh token on consent, so re-signing in
    // (e.g. after switching machines) would otherwise leave us with an
    // access token that can't be refreshed.
    const baseScopes = ["openid", "email", "profile"];
    const mergedScopes = Array.from(new Set([...baseScopes, ...extraScopes]));
    socialProviders.google = {
      ...(configuredGoogleProvider ?? {}),
      clientId: googleCredentials.clientId,
      clientSecret: googleCredentials.clientSecret,
      ...(extraScopes.length > 0
        ? {
            scope: mergedScopes,
            accessType: "offline" as const,
            prompt: "consent" as const,
          }
        : {}),
    };
  }

  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    socialProviders.github = {
      clientId: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
    };
  }
  recordActiveSocialSignInProviders(
    Object.entries(socialProviders)
      .filter(([, provider]) => Boolean(provider))
      .map(([id]) => id),
  );

  // Build database config
  const database = await buildDatabaseConfig();

  const secret = resolveAuthSecret();

  const appUrl = getAppProductionUrl();
  const configuredOrigins = [...getConfiguredOriginAllowlist()];
  const cookieNamespace = resolveAuthCookieNamespace();
  const emailReadiness = getDeploymentEmailReadiness();
  const { requireEmailVerification, disableSignUp } =
    resolveEmailPasswordAuthPolicy(emailReadiness);

  const shouldMirrorGoogleAccountTokens =
    (config?.googleScopes?.length ?? 0) > 0;

  const configuredPlugins = config?.plugins ?? [];
  const hasConfiguredTwoFactor = configuredPlugins.some(
    (plugin) => plugin.id === "two-factor",
  );

  const enterprisePlugins: BetterAuthPlugin[] = [];
  if (enterpriseAuthAdaptersBuilt && access.sso.enabled) {
    const { sso } = await import("@better-auth/sso");
    enterprisePlugins.push(
      sso({
        domainVerification: { enabled: true },
        resolveUser: async ({ providerUser }, context) => {
          const existing = await context.database.findOne<{
            id: string;
          }>({
            model: "user",
            where: [
              {
                field: "email",
                value: providerUser.email.trim().toLowerCase(),
                mode: "insensitive",
              },
            ],
          });
          return existing
            ? { action: "link", userId: existing.id, profile: "preserve" }
            : { action: "continue" };
        },
        provisionUserOnEveryLogin: true,
        provisionUser: async ({ user }) => {
          await autoJoinDomainMatchingOrgs(user.email, {
            activateJoinedOrg: "if-missing",
          });
          await acceptPendingInvitationsForEmail(user.email);
        },
      }),
    );
  }
  if (!enterpriseAuthAdaptersBuilt && access.sso.enabled) {
    throw new Error(
      "Organization SSO is enabled, but this deployment was built without enterprise auth adapters. Rebuild with AUTH_SSO=true.",
    );
  }
  if (enterpriseAuthAdaptersBuilt && access.scim.enabled) {
    const { scim } = await import("@better-auth/scim");
    // Better Auth intentionally requires a separate 32-character HMAC secret
    // for managed SCIM credentials. Falling back to the deployment auth secret
    // keeps the opt-in feature usable for existing deployments while allowing
    // operators to rotate the SCIM boundary independently via app-config.
    const credentialHashSecret = access.scim.credentialHashSecret ?? secret;
    if (credentialHashSecret.length < 32) {
      throw new Error(
        "AUTH_SCIM_CREDENTIAL_HASH_SECRET (or BETTER_AUTH_SECRET) must contain at least 32 characters when SCIM is enabled",
      );
    }
    enterprisePlugins.push(
      frameworkOrgBridgePlugin as unknown as BetterAuthPlugin,
    );
    enterprisePlugins.push(
      scim({
        connections: [],
        managedConnections: { credentialHashSecret },
        identity: createFrameworkSCIMIdentity(),
      }),
    );
  }
  if (!enterpriseAuthAdaptersBuilt && access.scim.enabled) {
    throw new Error(
      "Organization SCIM is enabled, but this deployment was built without enterprise auth adapters. Rebuild with AUTH_SCIM=true.",
    );
  }

  const magicLinkPlugin = magicLink({
    expiresIn: 60 * 5,
    storeToken: "hashed",
    rateLimit: { window: 60, max: 5 },
    disableSignUp,
    sendMagicLink: async ({ email, url, token }) => {
      let urlPath: string | undefined;
      let urlQueryKeys: string[] | undefined;
      try {
        const parsedURL = new URL(url);
        urlPath = parsedURL.pathname;
        urlQueryKeys = [...parsedURL.searchParams.keys()].sort();
      } catch {
        // coercion-ok: diagnostics must never make email delivery fail.
        // Better Auth owns URL construction; keep diagnostics non-fatal.
      }
      if (typeof token === "string") {
        console.info("[agent-native][magic-link]", {
          phase: "issued",
          tokenDigest: crypto
            .createHash("sha256")
            .update(token)
            .digest("hex")
            .slice(0, 16),
          expectedStoredIdentifierPrefix: crypto
            .createHash("sha256")
            .update(token)
            .digest("base64url")
            .slice(0, 16),
          urlPath,
          urlQueryKeys,
        });
      }
      const deliveredMagicLinkUrl = desktopMagicLinkLandingUrl(url) ?? url;
      const { subject, html, text, appSender } = renderMagicLinkEmail({
        email,
        magicLinkUrl: deliveredMagicLinkUrl,
      });
      await sendEmail({
        to: email,
        subject,
        html,
        text,
        appSender,
        disableClickTracking: true,
        templateId: CORE_MAGIC_LINK_EMAIL_ID,
      });
    },
  });

  const auth = betterAuth({
    basePath,
    baseURL: appUrl,
    database,
    // With no https public URL configured (a cloud dev container behind an
    // https proxy), the proxied host's own same-origin POSTs would fail Better
    // Auth's origin check. Configured deployments keep the static allowlist.
    trustedOrigins: appUrl.startsWith("https://")
      ? configuredOrigins
      : (request) => [...configuredOrigins, requestForwardedOrigin(request)],
    secret,
    emailAndPassword: {
      enabled: true,
      disableSignUp,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      // Email verification is enabled only when a provider is ready. Without
      // one, hosted deployments keep password signup available.
      requireEmailVerification,
      sendResetPassword: async ({ user, token }) => {
        // APP_BASE_PATH lets this app mount under a prefix (e.g. /mail). The
        // reset link must include that prefix so the page resolves correctly.
        const appBasePath = (
          process.env.VITE_APP_BASE_PATH ||
          process.env.APP_BASE_PATH ||
          ""
        ).replace(/\/$/, "");
        const resetUrl = `${appUrl}${appBasePath}${publicFrameworkPath("/_agent-native/auth/reset")}?token=${encodeURIComponent(token)}`;
        const { subject, html, text, appSender } = renderResetPasswordEmail({
          email: user.email,
          resetUrl,
        });
        await sendEmail({
          to: user.email,
          subject,
          html,
          text,
          appSender,
          disableClickTracking: true,
          templateId: CORE_RESET_PASSWORD_EMAIL_ID,
        });
      },
    },
    emailVerification: {
      // Fire verification email right after signup, before the user has a
      // session — pairs with requireEmailVerification above.
      sendOnSignUp: requireEmailVerification,
      // Auto-create a session once the user clicks the link. Without this,
      // verified users would have to go back and sign in manually, which is
      // a confusing dead-end on the verify screen.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url, token }) => {
        // APP_BASE_PATH lets this app mount under a prefix (e.g. /mail). The
        // verification link must include that prefix so the page resolves correctly.
        const verifyBasePath = (
          process.env.VITE_APP_BASE_PATH ||
          process.env.APP_BASE_PATH ||
          ""
        ).replace(/\/$/, "");
        const verifyUrl = verifyBasePath
          ? url.replace(/(\/\/[^/]+)(\/)/, `$1${verifyBasePath}$2`)
          : url;
        const emailChange = await verifiedEmailChangeFromToken(
          token,
          secret,
          user.email,
        );
        if (emailChange)
          await preflightEmailIdentityRekey(
            emailChange.oldEmail,
            emailChange.newEmail,
          );
        const renderedEmail = emailChange
          ? renderChangeEmailVerificationEmail({ email: user.email, verifyUrl })
          : renderVerifySignupEmail({ email: user.email, verifyUrl });
        await sendEmail({
          to: user.email,
          ...renderedEmail,
          disableClickTracking: true,
          templateId: emailChange
            ? CORE_CHANGE_EMAIL_VERIFICATION_EMAIL_ID
            : CORE_VERIFY_SIGNUP_EMAIL_ID,
        });
      },
      afterEmailVerification: async (user, request) => {
        if (!request) return;
        const token = new URL(request.url).searchParams.get("token");
        if (!token) return;
        const db = getDbExec();
        const emailChange = await verifiedEmailChangeFromToken(
          token,
          secret,
          user.email,
        );
        if (!emailChange) return;
        try {
          await executeIdentityRekey(
            identityRekeyDbFromExec(db),
            emailChange.oldEmail,
            emailChange.newEmail,
            {
              accountAlreadyUpdated: true,
              actorEmail: user.email,
              caller: "email-verification",
            },
          );
        } catch (error) {
          // Better Auth has already committed the verified address. Keep the
          // callback successful and let the next authenticated session retry
          // the durable pending ledger row.
          console.error("[identity] email rekey deferred for retry", error);
        }
      },
    },
    user: {
      changeEmail: {
        enabled: emailReadiness.status === "ready",
        updateEmailWithoutVerification: false,
        sendChangeEmailConfirmation: async ({ user, newEmail, url }) => {
          await preflightEmailIdentityRekey(user.email, newEmail);
          const confirmationBasePath = getConfiguredAppBasePath();
          const confirmationUrl = confirmationBasePath
            ? url.replace(/(\/\/[^/]+)(\/)/, `$1${confirmationBasePath}$2`)
            : url;
          const renderedEmail = renderChangeEmailConfirmationEmail({
            email: user.email,
            newEmail,
            confirmationUrl,
          });
          await sendEmail({
            to: user.email,
            ...renderedEmail,
            disableClickTracking: true,
            templateId: CORE_CHANGE_EMAIL_CONFIRMATION_EMAIL_ID,
          });
        },
      },
      additionalFields: {
        // Keep this internal profile field in Better Auth's adapter reads and
        // writes without exposing it as a client-controlled auth field.
        onboardingRole: {
          type: "string",
          required: false,
          input: false,
        },
      },
    },
    socialProviders,
    account: {
      // Merge accounts when a user signs in with a social provider using an
      // email that already has a local email/password account (or vice versa).
      // Only providers listed in `trustedProviders` auto-link — these are the
      // ones that verify emails at the identity layer. Never add a provider
      // here that lets users claim an unverified email; that would be an
      // account-takeover vector.
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github"],
      },
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session, context) => {
            const email = await getAuthEmailForUserId(
              session.userId,
              context?.context.adapter,
            );
            const requiredProvider =
              await getRequiredAuthProviderForEmail(email);
            if (!requiredProvider) return;

            const path = stringifyValue(context?.path ?? "").toLowerCase();
            const requestUrl = context?.request?.url ?? "";
            const providerValues = [
              path,
              requestUrl,
              String(
                (context?.params as Record<string, unknown> | undefined)
                  ?.provider ?? "",
              ),
              String(
                (context?.params as Record<string, unknown> | undefined)?.id ??
                  "",
              ),
              String(
                (context?.params as Record<string, unknown> | undefined)
                  ?.providerId ?? "",
              ),
              String(
                (context?.body as Record<string, unknown> | undefined)
                  ?.provider ?? "",
              ),
              String(
                (context?.body as Record<string, unknown> | undefined)
                  ?.providerId ?? "",
              ),
            ].map((value) => value.toLowerCase());
            if (requiredProvider === "google") {
              if (!providerValues.some((value) => value.includes("google"))) {
                return false;
              }
              return;
            }

            const providerId = requiredProvider.slice(4).toLowerCase();
            const providerParams = context?.params as
              | Record<string, unknown>
              | undefined;
            const explicitProvider = [
              providerParams?.providerId,
              providerParams?.provider,
              providerParams?.id,
              (context?.body as Record<string, unknown> | undefined)
                ?.providerId,
            ]
              .map((value) => String(value ?? "").toLowerCase())
              .filter(Boolean);
            const pathMatchesProvider = providerValues.some((value) => {
              if (!value.includes("/sso/")) return false;
              try {
                const path = value.startsWith("http")
                  ? new URL(value).pathname
                  : value.split("?", 1)[0];
                return path
                  .split("/")
                  .some((part) => decodeURIComponent(part) === providerId);
              } catch (error) {
                console.warn(
                  "[auth] could not parse SSO provider callback path",
                  error,
                );
                return false;
              }
            });
            if (
              !explicitProvider.includes(providerId) &&
              !pathMatchesProvider
            ) {
              return false;
            }
          },
          after: async (session) => {
            const email = await getAuthEmailForUserId(session.userId);
            if (!isBootstrapAdmin(email)) return;
            const adapter = await getBetterAuthInternalAdapter();
            const existing = await adapter?.findUserByEmail(email, {
              includeAccounts: false,
            });
            if (existing?.user.emailVerified !== true) return;
            const { bootstrapAdminOrganization } =
              await import("../org/context.js");
            await bootstrapAdminOrganization(email);
          },
        },
      },
      user: {
        create: {
          before: async (user, context) => {
            await enforceSignupAdmission(user, context);
          },
          after: async (
            user: {
              id?: string;
              email?: string;
              name?: string | null;
              emailVerified?: boolean;
            },
            // Better Auth (1.6.x) passes the endpoint context as the 2nd arg.
            // It carries the originating request's headers (and on OAuth
            // signups the callback request's headers), which is where the
            // browser's `an_ft` first-touch cookie rides in.
            context?: {
              headers?: Headers | null;
              request?: { headers?: Headers | null; url?: string } | null;
            } | null,
          ) => {
            const email = user?.email;
            if (!email) return;

            await emitSignupEventForCreatedUser(user, context);

            // Email-based org access requires proof of control of the address.
            if (user.emailVerified !== true) return;

            try {
              await acceptPendingInvitationsForEmail(email);
            } catch (err) {
              // Never block signup on invite bookkeeping — log and continue.
              console.error(
                "[auth] failed to auto-accept pending invitations",
                err,
              );
            }
            try {
              // Auto-join orgs whose `allowed_domain` matches this email
              // domain. Lets a fresh `@builder.io` (or any org-domain)
              // signup land inside the company org on first page load
              // without going through the picker. No-ops when no match.
              await autoJoinDomainMatchingOrgs(email);
            } catch (err) {
              console.error(
                "[auth] failed to auto-join domain-matching orgs",
                err,
              );
            }
          },
        },
      },
      account: {
        // Mirror Google account tokens into `oauth_tokens` so existing
        // template code (mail's Gmail client, calendar's events fetcher)
        // can pick up Gmail/Calendar credentials from the primary sign-in
        // flow — no separate "Set up Google" page required.
        //
        // Better Auth fires `create` for first-time social sign-in and
        // `update` whenever a session re-issues tokens (e.g., the user
        // re-signs in to refresh the token). Both branches do the same
        // mirroring work; failures never block sign-in.
        create: {
          after: async (account: any) => {
            if (!shouldMirrorGoogleAccountTokens) return;
            await mirrorGoogleAccountToOAuthTokens(account).catch((err) => {
              console.error(
                "[auth] failed to mirror Google account tokens to oauth_tokens (create)",
                err,
              );
            });
          },
        },
        update: {
          after: async (account: any) => {
            if (!shouldMirrorGoogleAccountTokens) return;
            await mirrorGoogleAccountToOAuthTokens(account).catch((err) => {
              console.error(
                "[auth] failed to mirror Google account tokens to oauth_tokens (update)",
                err,
              );
            });
          },
        },
      },
    },
    session: {
      expiresIn: config?.sessionMaxAge ?? 60 * 60 * 24 * 30,
      updateAge: Math.min(
        60 * 60 * 24,
        config?.sessionMaxAge ?? 60 * 60 * 24 * 30,
      ), // refresh daily, or sooner for short custom sessions
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min cache
      },
    },
    advanced: {
      cookiePrefix: cookieNamespace.betterAuthCookiePrefix,
      // Emit `SameSite=None; Secure` when the app is served over HTTPS so
      // session cookies are delivered inside third-party iframes (e.g. the
      // Builder.io editor). Plain-HTTP dev keeps the default (Lax) because
      // `SameSite=None` requires Secure.
      ...(appUrl.startsWith("https://")
        ? {
            defaultCookieAttributes: {
              sameSite: "none" as const,
              secure: true,
              partitioned: true,
            },
          }
        : {}),
      // When an effective shared cookie domain is set, share Better Auth's
      // session cookie across that domain. First-party `*.agent-native.com`
      // apps intentionally do not use this path because their auth DBs are
      // separate; Dispatch identity federation handles cross-app sign-in.
      ...(cookieNamespace.betterAuthCookieDomain
        ? {
            crossSubDomainCookies: {
              enabled: true,
              domain: cookieNamespace.betterAuthCookieDomain,
            },
          }
        : {}),
    },
    plugins: [
      magicLinkPlugin,
      // JWT: issue tokens for A2A calls, JWKS endpoint for verification. The
      // optional response header signs on every session check; it must not
      // turn a valid cookie session into a 500 when a key is stale.
      withJwksRotationRecovery(
        jwt({
          jwt: {
            issuer: appUrl,
            expirationTime: "15m",
          },
          disableSettingJwtHeader: true,
        }),
      ),
      // Bearer: accept Bearer tokens on API requests
      bearer(),
      // TOTP is opt-in per account. The plugin adds no sign-in step until a
      // user enables it from account settings.
      ...(hasConfiguredTwoFactor
        ? []
        : [
            twoFactor({
              issuer: getAppConfig().app.name || "Agent-Native",
              allowPasswordless: true,
              accountLockout: { enabled: true },
            }),
          ]),
      ...enterprisePlugins,
      ...configuredPlugins,
    ],
  });

  return auth as unknown as BetterAuthInstance;
}

export async function buildDatabaseConfig(): Promise<
  BetterAuthOptions["database"]
> {
  // getDbExec() (client.ts's initClient) and createGetDb()'s Drizzle opener
  // both refuse a hosted invocation with no database URL before resolving
  // it. This adapter resolves the same runtime URL but used to skip the
  // refusal entirely, so signup/login reaching this opener first silently
  // opened the ephemeral per-instance PGlite file instead of failing loudly.
  assertHostedRuntimeDatabase();

  const url = getRuntimeDatabaseUrl("pglite:./data/pglite");
  const { buildResilientNeonPool, buildResilientPostgresJsClient, isNeonUrl } =
    await import("../db/create-get-db.js");

  if (isPgliteUrl(url)) {
    const { drizzle } = await loadPgliteDrizzle();
    const client = await getPgliteClient(url);
    const db = drizzle({
      client: pgliteDrizzleClient(url, client),
      schema: pgAuthSchema,
    });
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    return drizzleAdapter(db, {
      provider: "pg",
      schema: pgAuthSchema,
      // Better Auth's SSO and managed-SCIM plugins require native adapter
      // transactions for identity resolution and reconciliation. Keep this
      // enabled for every Postgres backend so opting into either plugin does
      // not fail at request time on PGlite, Neon, or postgres-js.
      transaction: true,
    });
  }

  // Neon via @neondatabase/serverless (WebSockets over HTTPS). postgres-js
  // opens a raw TCP connection on port 5432 which frequently times out on
  // Netlify Functions / Vercel / CF Workers when Neon's pooler is cold.
  if (isNeonUrl(url)) {
    const { Pool } = await import("@neondatabase/serverless");
    // Cap the auth pool the same way as the app pool. Better Auth runs a
    // session lookup on essentially every authenticated request, so an
    // un-capped pool here is a primary contributor to "Max client
    // connections reached" across concurrent serverless instances.
    resetAuthOnPoolClose("neon", url);
    _neonAuthPool = sharedDbPool(
      "neon",
      url,
      () => new Pool({ connectionString: url, ...neonPoolOptions() }),
    );
    guardNeonPool(_neonAuthPool, url, "db/neon-auth");
    const { drizzle } = await import("drizzle-orm/neon-serverless");
    const db = drizzle(buildResilientNeonPool(_neonAuthPool), {
      schema: pgAuthSchema,
    });
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    return drizzleAdapter(db, {
      provider: "pg",
      schema: pgAuthSchema,
      transaction: true,
    });
  }

  // Non-Neon Postgres (Supabase, self-hosted, etc.) → postgres-js.
  // pgPoolOptions caps this pool to a small size on serverless. Better Auth
  // runs a session lookup on essentially every authenticated request, so an
  // un-capped pool here is a primary contributor to "Max client connections
  // reached" across concurrent serverless instances.
  const { default: postgres } = await import("postgres");
  resetAuthOnPoolClose("postgres-js", url);
  const sql = sharedDbPool("postgres-js", url, () =>
    postgres(url, pgPoolOptions(url)),
  );
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const db = drizzle(buildResilientPostgresJsClient(sql), {
    schema: pgAuthSchema,
  });
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  return drizzleAdapter(db, {
    provider: "pg",
    schema: pgAuthSchema,
    transaction: true,
  });
}
