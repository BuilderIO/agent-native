/**
 * Internal Better Auth instance — lazily created, not exported to templates.
 *
 * Templates interact with auth via the existing `getSession()`, `autoMountAuth()`,
 * `createAuthPlugin()`, and `createGoogleAuthPlugin()` APIs. Better Auth is an
 * implementation detail behind those interfaces.
 */

import { betterAuth, type BetterAuthOptions } from "better-auth";
import { organization } from "better-auth/plugins/organization";
import { jwt } from "better-auth/plugins/jwt";
import { bearer } from "better-auth/plugins/bearer";
import { sendEmail } from "./email.js";
import { renderEmail } from "./email-template.js";
import { getAppProductionUrl } from "./app-url.js";
import { getDbExec, isPostgres } from "../db/client.js";
import { acceptPendingInvitationsForEmail } from "../org/accept-pending.js";
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
      body: { email: string; password: string; name: string };
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
};

function getBetterAuthSchema() {
  return isPostgres() ? pgAuthSchema : sqliteAuthSchema;
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
      ]
    : [
        `CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, email_verified INTEGER NOT NULL DEFAULT 0, image TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, token TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip_address TEXT, user_agent TEXT, user_id TEXT NOT NULL, active_organization_id TEXT)`,
        `CREATE TABLE IF NOT EXISTS account (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, provider_id TEXT NOT NULL, user_id TEXT NOT NULL, access_token TEXT, refresh_token TEXT, id_token TEXT, access_token_expires_at INTEGER, refresh_token_expires_at INTEGER, scope TEXT, password TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS verification (id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS organization (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, logo TEXT, metadata TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS member (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'member', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
        `CREATE TABLE IF NOT EXISTS invitation (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT, status TEXT NOT NULL DEFAULT 'pending', expires_at INTEGER NOT NULL, inviter_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
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
    socialProviders.google = {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
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

  const secret =
    process.env.BETTER_AUTH_SECRET ||
    process.env.GOOGLE_CLIENT_SECRET ||
    process.env.ACCESS_TOKEN ||
    "agent-native-local-dev-secret-k9x2m7q4w8";

  const appUrl = getAppProductionUrl();

  const auth = betterAuth({
    basePath,
    baseURL: appUrl,
    database,
    secret,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      sendResetPassword: async ({ user, token }) => {
        // APP_BASE_PATH lets this app mount under a prefix (e.g. /mail). The
        // reset link must include that prefix so the page resolves correctly.
        const appBasePath = (
          process.env.VITE_APP_BASE_PATH ||
          process.env.APP_BASE_PATH ||
          ""
        ).replace(/\/$/, "");
        const resetUrl = `${appUrl}${appBasePath}/_agent-native/auth/reset?token=${encodeURIComponent(token)}`;
        const { html, text } = renderEmail({
          preheader: "Reset your password. This link expires in 1 hour.",
          heading: "Reset your password",
          paragraphs: [
            "Someone requested a password reset for your account. Click the button below to choose a new password.",
            "This link expires in 1 hour.",
          ],
          cta: { label: "Reset password", url: resetUrl },
          footer:
            "If you didn't request this, you can safely ignore this email.",
        });
        await sendEmail({
          to: user.email,
          subject: "Reset your password",
          html,
          text,
        });
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
          after: async (user: { email?: string }) => {
            // When a newly-created user's email has pending org invitations
            // (common when someone is invited *before* they've signed up),
            // auto-accept them so the user lands in the org on their very
            // first page load instead of a blank-slate workspace.
            const email = user?.email;
            if (!email) return;
            try {
              await acceptPendingInvitationsForEmail(email);
            } catch (err) {
              // Never block signup on invite bookkeeping — log and continue.
              console.error(
                "[auth] failed to auto-accept pending invitations",
                err,
              );
            }
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
