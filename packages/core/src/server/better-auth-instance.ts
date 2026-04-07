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
import {
  getDialect,
  getDatabaseUrl,
  getDatabaseAuthToken,
} from "../db/client.js";

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
export function resetBetterAuth(): void {
  _auth = undefined;
  _initPromise = undefined;
}

// ---------------------------------------------------------------------------
// Instance creation
// ---------------------------------------------------------------------------

async function createBetterAuthInstance(
  config?: BetterAuthConfig,
): Promise<BetterAuthInstance> {
  const dialect = getDialect();
  const basePath = config?.basePath ?? "/_agent-native/auth/ba";

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
    "agent-native-dev-secret";

  const appUrl =
    process.env.APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000";

  const auth = betterAuth({
    basePath,
    baseURL: appUrl,
    database,
    secret,
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
    },
    socialProviders,
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
    // Use postgres.js — same driver as the framework
    const { default: postgres } = await import("postgres");
    const url = getDatabaseUrl();
    const sql = postgres(url);
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const db = drizzle(sql);
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    return drizzleAdapter(db, { provider: "pg" });
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
    const db = drizzle(sqlite);
    const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
    return drizzleAdapter(db, { provider: "sqlite" });
  }

  // Remote libsql (Turso)
  const { createClient } = await import("@libsql/client");
  const client = createClient({ url, authToken: getDatabaseAuthToken() });
  const { drizzle } = await import("drizzle-orm/libsql");
  const db = drizzle(client);
  const { drizzleAdapter } = await import("better-auth/adapters/drizzle");
  return drizzleAdapter(db, { provider: "sqlite" });
}
