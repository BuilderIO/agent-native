/**
 * Resolve the canonical URL of this app — used in transactional emails,
 * invite links, and anywhere we need an absolute URL that remains valid
 * outside the current request context.
 *
 * Resolution order:
 *   1. `APP_URL` env var — explicit override
 *   2. `BETTER_AUTH_URL` env var — Better Auth's canonical URL
 *   3. First-party template `prodUrl` from the registry (matched by
 *      package.json name) — lets deployed first-party apps (mail,
 *      calendar, analytics, …) use e.g. `analytics.agent-native.com`
 *      instead of their Netlify preview hostname.
 *   4. Incoming request's origin (when an H3Event is available)
 *   5. `http://localhost:3000`
 */
import { getRequestURL, type H3Event } from "h3";
import path from "node:path";
import fs from "node:fs";
import { TEMPLATES } from "../cli/templates-meta.js";
import { isLocalDatabase } from "../db/client.js";

let cachedPkgName: string | undefined | null = null;

function readPackageName(): string | undefined {
  if (cachedPkgName !== null) return cachedPkgName ?? undefined;
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    cachedPkgName = typeof pkg?.name === "string" ? pkg.name : undefined;
  } catch {
    cachedPkgName = undefined;
  }
  return cachedPkgName ?? undefined;
}

/** Strip trailing slashes for consistent URL concatenation. */
function stripTrailingSlash(u: string): string {
  return u.replace(/\/+$/, "");
}

/**
 * Look up the first-party template `prodUrl` for the current app based on
 * its `package.json` name. Returns undefined if the app isn't a known
 * first-party template or the template has no `prodUrl`.
 */
export function getFirstPartyProdUrl(): string | undefined {
  const name = readPackageName();
  if (!name) return undefined;
  const t = TEMPLATES.find((t) => t.name === name);
  return t?.prodUrl;
}

export function getAppProductionUrl(event?: H3Event): string {
  const envUrl = process.env.APP_URL || process.env.BETTER_AUTH_URL;
  if (envUrl) return stripTrailingSlash(envUrl);

  // Prefer the incoming request's origin when we have one — for local dev
  // this is `http://localhost:3000`, which keeps Better Auth from setting
  // `Secure` cookies on plain-HTTP dev servers.
  if (event) {
    try {
      const url = getRequestURL(event);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }

  // Fall back to a first-party template's hard-coded prod URL when we're
  // running in production OR on a remote database (Neon/Postgres/Turso).
  // A remote DB means we're deployed even if NODE_ENV isn't explicitly
  // "production" (e.g. Netlify Functions). In local dev with SQLite, skip
  // this — the hard-coded URL breaks auth via Secure cookies on HTTP.
  if (process.env.NODE_ENV === "production" || !isLocalDatabase()) {
    const firstParty = getFirstPartyProdUrl();
    if (firstParty) return stripTrailingSlash(firstParty);
  }

  return "http://localhost:3000";
}
