import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Browser, BrowserContext } from "@playwright/test";

import { type BetaSite, originFor } from "./fleet";

/**
 * Authenticated-session bootstrap for the beta fleet.
 *
 * Beta hosts accept exactly one interactive sign-in: Google OAuth. CI must
 * never drive a credential form, so an authenticated run replays an identity a
 * human established once, supplied through one of two secrets:
 *
 *   BETA_E2E_SESSION_TOKENS  a JSON map of app id -> framework session token,
 *                            replayed through `?_session=`, which the framework
 *                            promotes to a cookie. A session is a row in one
 *                            app's database, so this is per app; `"*"` is an
 *                            escape hatch for a single-app run, not a
 *                            fleet-wide credential.
 *
 *   BETA_E2E_STORAGE_STATE   a Playwright storageState JSON blob captured by
 *                            `pnpm e2e:beta:capture`. Use when a host issues
 *                            cookies the token path cannot reproduce.
 *
 * Both expire — the framework session is 30 days (`DEFAULT_MAX_AGE` in
 * packages/core/src/server/auth.ts). `pnpm e2e:beta:capture` re-mints them.
 *
 * Every failure here throws. An authenticated suite that quietly degrades to an
 * anonymous one reports green while testing nothing, which is the single
 * failure mode this repo's no-silent-coercion rule exists to prevent — and the
 * shape the existing template global-setups fall into today.
 */

const AUTH_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".auth",
);

export interface SessionIdentity {
  email: string;
  orgId?: string;
}

export function authStatePath(appId: string): string {
  return path.join(AUTH_DIR, `${appId}.json`);
}

/**
 * Marker written by global setup once the authenticated lane is fully ready.
 *
 * A file rather than an env var: Playwright runs specs in separate worker
 * processes, and `process.env` mutation is banned repo-wide because it is
 * process-scoped state that leaks across concurrent work. A file is the same
 * handoff without the footgun, and it is already gitignored alongside the
 * session state it accompanies.
 */
export function laneMarkerPath(): string {
  return path.join(AUTH_DIR, "lane-ready");
}

export function markAuthedLaneReady(): void {
  mkdirSync(AUTH_DIR, { recursive: true });
  writeFileSync(laneMarkerPath(), new Date().toISOString());
}

export function clearAuthedLaneMarker(): void {
  rmSync(laneMarkerPath(), { force: true });
}

export function authedLaneReady(): boolean {
  return existsSync(laneMarkerPath());
}

/** The identity every authenticated spec asserts it is running as. */
export function expectedEmail(): string {
  const email = process.env.BETA_E2E_EMAIL?.trim();
  if (!email) {
    throw new Error(
      "BETA_E2E_EMAIL is not set. Authenticated beta specs must assert which identity they are running as; without it a bootstrap that silently lands as the wrong user would pass.",
    );
  }
  return email;
}

function parseJsonEnv<T>(name: string): T | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${name} is set but is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sessionTokens(): Record<string, string> | undefined {
  return parseJsonEnv<Record<string, string>>("BETA_E2E_SESSION_TOKENS");
}

function sessionTokenFor(appId: string): string | undefined {
  const tokens = sessionTokens();
  if (!tokens) return undefined;
  return tokens[appId] ?? tokens["*"];
}

function storageStateBlob(): string | undefined {
  const inline = process.env.BETA_E2E_STORAGE_STATE?.trim();
  if (inline) return inline;
  const file = process.env.BETA_E2E_STORAGE_STATE_FILE?.trim();
  if (file) return readFileSync(path.resolve(file), "utf8");
  return undefined;
}

/** True when this run has been given something to authenticate with. */
export function hasSessionCredentials(): boolean {
  return Boolean(sessionTokens() || storageStateBlob());
}

/**
 * Explain, in the terms someone fixing it needs, why no authenticated run is
 * possible. Called at the one point where the run decides to stop.
 */
export function missingCredentialsMessage(): string {
  return [
    "No beta session credential was supplied, so no authenticated spec can run.",
    "Set one of these repository secrets and pass it through to the workflow:",
    '  BETA_E2E_SESSION_TOKENS  {"<app>":"<framework session token>", …}',
    "  BETA_E2E_STORAGE_STATE   a Playwright storageState JSON blob",
    "Mint either with `pnpm e2e:beta:capture` (opens a browser for a one-time Google sign-in).",
  ].join("\n");
}

/** Read the live session the way the app itself would, from inside the page. */
async function readSessionIdentity(
  context: BrowserContext,
  origin: string,
): Promise<{ identity?: SessionIdentity; status: number; body: string }> {
  const response = await context.request.get(
    `${origin}/_agent-native/auth/session`,
    {
      headers: { accept: "application/json" },
      timeout: 60_000,
    },
  );
  const body = await response.text();

  let identity: SessionIdentity | undefined;
  try {
    const parsed = JSON.parse(body) as { email?: string; orgId?: string };
    if (parsed?.email) {
      identity = {
        email: parsed.email,
        ...(parsed.orgId ? { orgId: parsed.orgId } : {}),
      };
    }
  } catch {
    identity = undefined;
  }

  return { identity, status: response.status(), body: body.slice(0, 400) };
}

/**
 * Produce a signed-in context for one beta app and persist its storage state.
 *
 * Throws unless the resulting session resolves to `BETA_E2E_EMAIL`.
 */
export async function bootstrapAppSession(
  browser: Browser,
  site: BetaSite,
): Promise<SessionIdentity> {
  const origin = originFor(site);
  const email = expectedEmail();
  const blob = storageStateBlob();
  const token = sessionTokenFor(site.id);

  if (!blob && !token) throw new Error(missingCredentialsMessage());

  const context = await browser.newContext(
    blob ? { storageState: JSON.parse(blob) } : {},
  );

  try {
    if (token) {
      // `promoteQuerySession` (packages/core/src/server/auth.ts) exchanges the
      // token for this host's own session cookie on any request carrying it.
      //
      // Use the browser context's API client so Set-Cookie is shared with the
      // stored browser state without navigating a page that may redirect an
      // authenticated user away from `/sign-in` while the check is running.
      let promoted;
      try {
        promoted = await context.request.get(
          `${origin}/_agent-native/auth/session?_session=${encodeURIComponent(token)}`,
          {
            headers: { accept: "application/json" },
            timeout: 60_000,
          },
        );
      } catch {
        // Keep the live query token out of Playwright's error and report text.
        throw new Error(`${origin} failed while exchanging the session token.`);
      }
      if (promoted.status() >= 500) {
        throw new Error(
          `${origin} answered HTTP ${promoted.status()} while exchanging the session token.`,
        );
      }
    }

    const { identity, status, body } = await readSessionIdentity(
      context,
      origin,
    );

    if (!identity) {
      throw new Error(
        [
          `Beta session bootstrap failed for ${site.id} (${origin}).`,
          `GET /_agent-native/auth/session returned HTTP ${status}: ${body}`,
          token
            ? "The supplied session token was rejected. Framework sessions expire after 30 days — re-run `pnpm e2e:beta:capture`."
            : "The supplied storage state carried no session cookie this host accepts.",
        ].join("\n"),
      );
    }

    if (identity.email.toLowerCase() !== email.toLowerCase()) {
      throw new Error(
        `Beta session bootstrap for ${site.id} resolved to ${identity.email}, not the expected ${email}. Refusing to run authenticated specs as an unexpected identity.`,
      );
    }

    mkdirSync(AUTH_DIR, { recursive: true });
    await context.storageState({ path: authStatePath(site.id) });
    return identity;
  } finally {
    await context.close();
  }
}

/** Persist a capture-time storage state for reuse as a secret. */
export function writeCapturedState(appId: string, state: string): string {
  mkdirSync(AUTH_DIR, { recursive: true });
  const file = authStatePath(appId);
  writeFileSync(file, state);
  return file;
}
