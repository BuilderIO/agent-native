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
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { jwt } from "better-auth/plugins/jwt";
import { bearer } from "better-auth/plugins/bearer";
import { sendEmail, isEmailConfigured } from "./email.js";
import {
  renderResetPasswordEmail,
  renderVerifySignupEmail,
} from "./email-templates.js";
import { getAppProductionUrl } from "./app-url.js";
import { getDbExec, isPostgres } from "../db/client.js";
import { acceptPendingInvitationsForEmail } from "../org/accept-pending.js";
import { autoJoinDomainMatchingOrgs } from "../org/auto-join-domain.js";
import { saveOAuthTokens } from "../oauth-tokens/store.js";
import { identify, track } from "../tracking/index.js";
import {
  getDialect,
  getDatabaseUrl,
  getDatabaseAuthToken,
} from "../db/client.js";
import {
  pgTable,
  text as pgText,
  timestamp as pgTimestamp,
  boolean as pgBoolean,
} from "drizzle-orm/pg-core";
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
} from "drizzle-orm/sqlite-core";

// ---------------------------------------------------------------------------
// Persistent auth secret
// ---------------------------------------------------------------------------

/**
 * Resolve the Better Auth signing secret.
 *
 * Resolution order:
 *   1. `BETTER_AUTH_SECRET` env var — explicit, recommended for prod.
 *   2. `.env.local` in the template cwd — a per-workspace persistent secret
 *      that the framework writes once on first boot when no secret is set.
 *      Gitignored by convention (`.env*` in template .gitignore files), so
 *      it's safe to persist credentials here.
 *   3. Generate a new random 32-byte hex, write it to `.env.local`, and use
 *      it. Subsequent restarts re-read the same file — so session cookies
 *      signed by a previous boot remain valid across dev-server restarts.
 *
 * Why this matters: before this helper existed, missing `BETTER_AUTH_SECRET`
 * fell through to `GOOGLE_CLIENT_SECRET` / `ACCESS_TOKEN` / a hardcoded
 * string. If a template happened to have none of those, each dev-server
 * boot would re-fall back to the hardcoded value (still stable) — but
 * rotating Google credentials, toggling `ACCESS_TOKEN`, or churning the
 * fallback chain would invalidate every signed cookie and force everyone
 * to sign in again. Pinning the secret to `.env.local` on first boot
 * removes that footgun.
 */
function resolveAuthSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;

  // In production, never auto-generate or fall back. A regenerated/derived
  // secret invalidates every signed session cookie on the next cold start
  // (serverless filesystems aren't persistent), and the legacy hardcoded
  // fallback is identical across every deploy that hits it — both are
  // serious enough to fail the boot loudly so the deployer notices.
  if (process.env.NODE_ENV === "production") {
    const sample = crypto.randomBytes(32).toString("hex");
    throw new Error(
      "[agent-native] BETTER_AUTH_SECRET is not set. This is required in production " +
        "so signed session cookies stay valid across deploys. Set it as a deploy " +
        "environment variable (any 32-byte hex string), e.g.:\n\n" +
        `  BETTER_AUTH_SECRET=${sample}\n\n` +
        "Generate your own with `openssl rand -hex 32`. If you already have a " +
        "running deploy on the legacy hardcoded fallback and need to preserve " +
        "existing sessions, set BETTER_AUTH_SECRET=agent-native-local-dev-secret-k9x2m7q4w8 " +
        "first, then rotate to a real value.",
    );
  }

  // Dev: persist a generated secret to .env.local so sessions survive
  // dev-server restarts. Falls back to an in-memory random secret only if
  // the filesystem isn't writable (rare in dev, e.g. read-only mounts) —
  // sessions reset on every dev-process restart in that case, which is
  // fine.
  //
  // SECURITY (audit 09 LOW-2): the previous fallback chain
  // (`GOOGLE_CLIENT_SECRET || ACCESS_TOKEN || hardcoded`) reused
  // cross-purpose secrets and a public hardcoded literal as the cookie
  // HMAC. Dropped entirely — better to mint an ephemeral secret than to
  // re-use a Google client secret or a known string.
  try {
    const envLocalPath = path.resolve(process.cwd(), ".env.local");
    const existing = readEnvLocalSecret(envLocalPath);
    if (existing) {
      process.env.BETTER_AUTH_SECRET = existing; // guard:allow-env-mutation — boot-time secret resolution from .env.local, runs once at module init
      return existing;
    }

    const generated = crypto.randomBytes(32).toString("hex");
    appendEnvLocalSecret(envLocalPath, generated);
    process.env.BETTER_AUTH_SECRET = generated; // guard:allow-env-mutation — boot-time secret generation, runs once at module init before any request
    console.log(
      "[agent-native] Generated a persistent BETTER_AUTH_SECRET in .env.local. " +
        "Sessions will now survive dev-server restarts. " +
        "(Delete .env.local to rotate; set BETTER_AUTH_SECRET in .env to override.)",
    );
    return generated;
  } catch {
    // Filesystem unwritable (read-only mount, sandboxed test env, etc.).
    // Mint a per-process random secret so cookies stay unique per boot.
    // Sessions reset when the dev process restarts — acceptable for dev.
    const ephemeral = crypto.randomBytes(32).toString("hex");
    console.warn(
      "[agent-native] Could not persist BETTER_AUTH_SECRET to .env.local " +
        "(filesystem unwritable). Using an ephemeral in-memory secret. " +
        "Sessions will reset every time this process restarts. " +
        "Set BETTER_AUTH_SECRET in your environment to keep sessions valid across restarts.",
    );
    return ephemeral;
  }
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

function appendEnvLocalSecret(envLocalPath: string, secret: string): void {
  const header =
    "# Auto-generated by agent-native on first boot. Gitignored.\n" +
    "# Keeps signed session cookies valid across dev-server restarts.\n" +
    "# Delete this file (or this line) to rotate the secret.\n";
  const line = `BETTER_AUTH_SECRET=${secret}\n`;

  // If the file already exists, just append; otherwise create with header.
  if (fs.existsSync(envLocalPath)) {
    const existing = fs.readFileSync(envLocalPath, "utf8");
    const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
    fs.appendFileSync(
      envLocalPath,
      (needsLeadingNewline ? "\n" : "") + "\n" + header + line,
    );
  } else {
    fs.writeFileSync(envLocalPath, header + line, { mode: 0o600 });
  }
}

export function shouldSkipEmailVerification(): boolean {
  const value = process.env.AUTH_SKIP_EMAIL_VERIFICATION;
  if (value == null) {
    return (
      process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test"
    );
  }
  const normalized = value.trim().toLowerCase();
  return normalized !== "" && normalized !== "0" && normalized !== "false";
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
      user: { id: string; email: string; name: string };
      session: {
        id: string;
        token: string;
        expiresAt: Date;
        activeOrganizationId?: string;
      };
    } | null>;
    signInEmail: (opts: {
      body: { email: string; password: string };
    }) => Promise<{ token?: string; user?: any } | null>;
    signUpEmail: (opts: {
      body: {
        email: string;
        password: string;
        name: string;
        callbackURL?: string;
      };
    }) => Promise<any>;
    signOut: (opts: { headers: Headers }) => Promise<any>;
    listOrganizations: (opts: { headers: Headers }) => Promise<any[] | null>;
  };
}

export interface BetterAuthConfig {
  /** Base path for Better Auth routes. Default: "/_agent-native/auth/ba" */
  basePath?: string;
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
    image: pgText("image"),
    createdAt: pgTimestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: pgTimestamp("updated_at", { withTimezone: true }).notNull(),
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
  }),
};

const sqliteAuthSchema = {
  user: sqliteTable("user", {
    id: sqliteText("id").primaryKey(),
    name: sqliteText("name").notNull(),
    email: sqliteText("email").notNull().unique(),
    emailVerified: sqliteInteger("email_verified", { mode: "boolean" })
      .notNull()
      .default(false),
    image: sqliteText("image"),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
  }),
  session: sqliteTable("session", {
    id: sqliteText("id").primaryKey(),
    expiresAt: sqliteInteger("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: sqliteText("token").notNull().unique(),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
    ipAddress: sqliteText("ip_address"),
    userAgent: sqliteText("user_agent"),
    userId: sqliteText("user_id").notNull(),
    activeOrganizationId: sqliteText("active_organization_id"),
  }),
  account: sqliteTable("account", {
    id: sqliteText("id").primaryKey(),
    accountId: sqliteText("account_id").notNull(),
    providerId: sqliteText("provider_id").notNull(),
    userId: sqliteText("user_id").notNull(),
    accessToken: sqliteText("access_token"),
    refreshToken: sqliteText("refresh_token"),
    idToken: sqliteText("id_token"),
    accessTokenExpiresAt: sqliteInteger("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: sqliteInteger("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: sqliteText("scope"),
    password: sqliteText("password"),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
  }),
  verification: sqliteTable("verification", {
    id: sqliteText("id").primaryKey(),
    identifier: sqliteText("identifier").notNull(),
    value: sqliteText("value").notNull(),
    expiresAt: sqliteInteger("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
  }),
  organization: sqliteTable("organization", {
    id: sqliteText("id").primaryKey(),
    name: sqliteText("name").notNull(),
    slug: sqliteText("slug").notNull().unique(),
    logo: sqliteText("logo"),
    metadata: sqliteText("metadata"),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
  }),
  member: sqliteTable("member", {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    userId: sqliteText("user_id").notNull(),
    role: sqliteText("role").notNull().default("member"),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
  }),
  invitation: sqliteTable("invitation", {
    id: sqliteText("id").primaryKey(),
    organizationId: sqliteText("organization_id").notNull(),
    email: sqliteText("email").notNull(),
    role: sqliteText("role"),
    status: sqliteText("status").notNull().default("pending"),
    expiresAt: sqliteInteger("expires_at", { mode: "timestamp_ms" }).notNull(),
    inviterId: sqliteText("inviter_id").notNull(),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: sqliteInteger("updated_at", { mode: "timestamp_ms" }).notNull(),
  }),
  jwks: sqliteTable("jwks", {
    id: sqliteText("id").primaryKey(),
    publicKey: sqliteText("public_key").notNull(),
    privateKey: sqliteText("private_key").notNull(),
    createdAt: sqliteInteger("created_at", { mode: "timestamp_ms" }).notNull(),
    expiresAt: sqliteInteger("expires_at", { mode: "timestamp_ms" }),
  }),
};

function getBetterAuthSchema() {
  return isPostgres() ? pgAuthSchema : sqliteAuthSchema;
}

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
 * in Postgres; SQLite accepts the quotes too).
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

async function ensureBetterAuthTables(): Promise<void> {
  const db = getDbExec();
  const statements = isPostgres()
    ? [
        `CREATE TABLE IF NOT EXISTS "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified BOOLEAN NOT NULL DEFAULT FALSE, image TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS "session" (id TEXT PRIMARY KEY, expires_at TIMESTAMPTZ NOT NULL, token TEXT NOT NULL UNIQUE, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL, active_organization_id TEXT)`,
        `CREATE TABLE IF NOT EXISTS "account" (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at TIMESTAMPTZ, refresh_token_expires_at TIMESTAMPTZ, scope TEXT, password TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS "verification" (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS "organization" (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, logo TEXT, metadata TEXT, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS "member" (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS "invitation" (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'pending', expires_at TIMESTAMPTZ NOT NULL, inviter_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS "jwks" (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ)`,
      ]
    : [
        `CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL, active_organization_id TEXT)`,
        `CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS organization (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, logo TEXT, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS member (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS invitation (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL, inviter_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS jwks (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, private_key TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER)`,
      ];

  for (const sql of statements) await db.execute(sql);
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

  _initPromise = createBetterAuthInstance(config);
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

/** Reset for testing */
export async function resetBetterAuth(): Promise<void> {
  _auth = undefined;
  _initPromise = undefined;
  if (_neonAuthPool) {
    try {
      await _neonAuthPool.end();
    } catch {
      // Pool may have already closed (process exiting, etc.) — don't block reset.
    }
    _neonAuthPool = undefined;
  }
}

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

async function createBetterAuthInstance(
  config?: BetterAuthConfig,
): Promise<BetterAuthInstance> {
  const dialect = getDialect();
  const basePath = config?.basePath ?? "/_agent-native/auth/ba";
  await ensureBetterAuthTables();

  // Build social providers from env vars
  const socialProviders: BetterAuthOptions["socialProviders"] = {
    ...config?.socialProviders,
  };

  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    // When the template requests broader scopes (Gmail, Calendar, etc.)
    // ask for them on the primary sign-in flow so a separate "Connect
    // Google" round-trip isn't needed. `accessType: "offline"` plus
    // `prompt: "consent"` ensures we always receive a refresh token back —
    // Google only re-issues a refresh token on consent, so re-signing in
    // (e.g. after switching machines) would otherwise leave us with an
    // access token that can't be refreshed.
    const extraScopes = config?.googleScopes ?? [];
    const baseScopes = ["openid", "email", "profile"];
    const mergedScopes = Array.from(new Set([...baseScopes, ...extraScopes]));
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

  // Build database config
  const database = await buildDatabaseConfig(dialect);

  const secret = resolveAuthSecret();

  const appUrl = getAppProductionUrl();
  const requireEmailVerification =
    isEmailConfigured() && !shouldSkipEmailVerification();

  const auth = betterAuth({
    basePath,
    baseURL: appUrl,
    database,
    secret,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      // Only require email verification when an email provider is configured.
      // Without a provider, verification emails can't be sent, so requiring
      // verification would lock users out of signup entirely. Local dev/test
      // skip verification by default so +qa accounts can be created quickly;
      // hosted QA deployments can opt out with AUTH_SKIP_EMAIL_VERIFICATION=1.
      requireEmailVerification,
      sendResetPassword: async ({ user, token }) => {
        // APP_BASE_PATH lets this app mount under a prefix (e.g. /mail). The
        // reset link must include that prefix so the page resolves correctly.
        const appBasePath = (
          process.env.VITE_APP_BASE_PATH ||
          process.env.APP_BASE_PATH ||
          ""
        ).replace(/\/$/, "");
        const resetUrl = `${appUrl}${appBasePath}/_agent-native/auth/reset?token=${encodeURIComponent(token)}`;
        const { subject, html, text } = renderResetPasswordEmail({
          email: user.email,
          resetUrl,
        });
        await sendEmail({ to: user.email, subject, html, text });
      },
    },
    emailVerification: {
      // Fire verification email right after signup, before the user has a
      // session — pairs with requireEmailVerification above. Only enabled
      // when an email provider is configured.
      sendOnSignUp: requireEmailVerification,
      // Auto-create a session once the user clicks the link. Without this,
      // verified users would have to go back and sign in manually, which is
      // a confusing dead-end on the verify screen.
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
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
        const { subject, html, text } = renderVerifySignupEmail({
          email: user.email,
          verifyUrl,
        });
        await sendEmail({ to: user.email, subject, html, text });
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
      user: {
        create: {
          after: async (user: {
            id?: string;
            email?: string;
            name?: string | null;
          }) => {
            // When a newly-created user's email has pending org invitations
            // (common when someone is invited *before* they've signed up),
            // auto-accept them so the user lands in the org on their very
            // first page load instead of a blank-slate workspace.
            const email = user?.email;
            if (!email) return;
            identify(email, {
              email,
              name: user.name ?? undefined,
              authUserId: user.id,
            });
            track(
              "signup",
              {
                auth_provider: "better-auth",
                auth_user_id: user.id,
              },
              { userId: email },
            );
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
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 min cache
      },
    },
    advanced: {
      cookiePrefix: "an",
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
    },
    plugins: [
      // Organizations: many:many user:org, roles, invitations
      organization(),
      // JWT: issue tokens for A2A calls, JWKS endpoint for verification
      jwt({
        jwt: {
          issuer: appUrl,
          expirationTime: "15m",
        },
      }),
      // Bearer: accept Bearer tokens on API requests
      bearer(),
      ...(config?.plugins ?? []),
    ],
  });

  return auth as unknown as BetterAuthInstance;
}

async function buildDatabaseConfig(
  dialect: string,
): Promise<BetterAuthOptions["database"]> {
  if (dialect === "postgres") {
    const url = getDatabaseUrl();
    const { isNeonUrl } = await import("../db/create-get-db.js");

    // Neon via @neondatabase/serverless (WebSockets over HTTPS). postgres-js
    // opens a raw TCP connection on port 5432 which frequently times out on
    // Netlify Functions / Vercel / CF Workers when Neon's pooler is cold.
    if (isNeonUrl(url)) {
      const { Pool } = await import("@neondatabase/serverless");
      _neonAuthPool = new Pool({ connectionString: url });
      const { drizzle } = await import("drizzle-orm/neon-serverless");
      const db = drizzle(_neonAuthPool, { schema: pgAuthSchema });
      const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
      return drizzleAdapter(db, {
        provider: "pg",
        schema: pgAuthSchema,
      });
    }

    // Non-Neon Postgres (Supabase, self-hosted, etc.) → postgres-js
    const { default: postgres } = await import("postgres");
    const sql = postgres(url, {
      onnotice: () => {},
      idle_timeout: 240,
      max_lifetime: 60 * 30,
      connect_timeout: 10,
      ...(url.includes("supabase") ? { prepare: false } : {}),
    });
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const db = drizzle(sql, { schema: pgAuthSchema });
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    return drizzleAdapter(db, {
      provider: "pg",
      schema: pgAuthSchema,
    });
  }

  // SQLite / libsql
  const url = getDatabaseUrl("file:./data/app.db");

  if (url.startsWith("file:") || !url.includes("://")) {
    // Local SQLite via better-sqlite3
    const { default: Database } = await import("better-sqlite3");
    const filePath = url.replace(/^file:/, "");
    const sqlite = new Database(filePath);
    sqlite.pragma("journal_mode = WAL");
    const { drizzle } = await import("drizzle-orm/better-sqlite3");
    const db = drizzle(sqlite, { schema: sqliteAuthSchema });
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    return drizzleAdapter(db, {
      provider: "sqlite",
      schema: sqliteAuthSchema,
    });
  }

  // Remote libsql (Turso)
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  const { drizzle } = await import("drizzle-orm/libsql");
  const db = drizzle(client, { schema: sqliteAuthSchema });
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  return drizzleAdapter(db, {
    provider: "sqlite",
    schema: sqliteAuthSchema,
  });
}
