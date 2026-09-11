/**
 * Lets `pnpm action <name>` forward to an already-running local dev server
 * instead of opening the app database itself.
 *
 * The default local dev database is PGlite, which takes an exclusive
 * process-level lock on its data directory (see `db/client.ts`). Every CLI
 * action opens the database on its own, so running one while `pnpm dev` is
 * already holding that lock fails with "already owned by process N" before
 * the action even starts. When a dev server for the same database is
 * running, forward the call to it over loopback instead: the server already
 * holds the connection and the action registry, so the CLI never needs its
 * own.
 *
 * Protocol: the dev server writes `<appRoot>/.agent-native/dev-server.json`
 * (mode 0600) while listening, and the CLI reads it before touching the
 * database. The two sides only proceed when the file's `databaseKey` (a hash
 * of the resolved `DATABASE_URL`) matches the CLI's own — a stale file from a
 * different app/database in the same directory must never be trusted. The
 * bearer token in that file is also kept in the server's own process memory
 * (never persisted anywhere else) and compared with a timing-safe check on
 * every request.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { defineEventHandler, getHeader, readBody, setResponseStatus } from "h3";
import type { H3Event } from "h3";

import type { ActionRunContext } from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { resolveDevUserEmail } from "../scripts/dev-session.js";
import { actionCallIsReadOnly, notifyActionChange } from "./action-change.js";
import { isLoopbackRequest } from "./auth.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";
import { getH3App } from "./framework-request-handler.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "./request-context.js";

export const DEV_ACTION_ROUTE = "/_agent-native/dev/action";
export const DEV_ACTION_TOKEN_HEADER = "x-agent-native-dev-token";
export const DEV_ACTION_USER_HEADER = "x-agent-native-dev-user";
export const DEV_ACTION_ORG_HEADER = "x-agent-native-dev-org";

const DISCOVERY_PATH = path.join(".agent-native", "dev-server.json");

export interface DevActionDiscovery {
  origin: string;
  pid: number;
  token: string;
  databaseKey: string;
}

/** Hash a resolved `DATABASE_URL` so the discovery file never carries the raw connection string. */
export function hashDatabaseKey(databaseUrl: string): string {
  return crypto.createHash("sha256").update(databaseUrl).digest("hex");
}

// Module-level state must survive independent instances of this module: the
// Vite plugin that writes the token and the Nitro dev route that checks it
// run inside the same process but can load through different module
// realms (same reasoning as `_pgliteProcessLocks` in db/client.ts).
const devBridgeProcess = process as NodeJS.Process & {
  __agentNativeDevActionToken?: string;
};

export function getDevActionToken(): string | undefined {
  return devBridgeProcess.__agentNativeDevActionToken;
}

/**
 * Token the route compares against. The Vite plugin that mints it and the
 * Nitro dev server that serves the route are separate processes under
 * `agent-native dev`, so process memory only covers the single-process case;
 * otherwise the token comes back off the discovery file this process's app
 * root was published with (mode 0600, same user).
 */
function resolveExpectedDevActionToken(): string | undefined {
  return (
    getDevActionToken() ?? readDevActionDiscoveryFile(process.cwd())?.token
  );
}

/** Write the discovery file a running dev server publishes for the CLI to find. Call once the HTTP server is actually listening. */
export function writeDevActionDiscoveryFile(
  appRoot: string,
  origin: string,
  databaseKey: string,
): void {
  const token = crypto.randomBytes(32).toString("hex");
  devBridgeProcess.__agentNativeDevActionToken = token;
  const filePath = path.join(appRoot, DISCOVERY_PATH);
  const discovery: DevActionDiscovery = {
    origin,
    pid: process.pid,
    token,
    databaseKey,
  };
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(discovery), { mode: 0o600 });
  } catch (error) {
    // Absent, not silently ok: a write failure must not leave a stale or
    // half-written file that a CLI run could mistake for a live server.
    // Best-effort cleanup, then log and continue — the dev server itself
    // still works, only CLI forwarding is unavailable this run.
    console.warn(
      "[agent-native] could not write dev action discovery file:",
      error,
    );
    try {
      fs.unlinkSync(filePath);
    } catch {
      // coercion-ok: best-effort cleanup of a half-written file; the warn
      // above already reported the failure that matters.
    }
  }
}

/**
 * Remove the discovery file this process published. Safe to call multiple
 * times or when it was never written. A file that a newer dev server has
 * since replaced belongs to that server and is left alone — an overlapping
 * restart must not delete the live record.
 */
export function removeDevActionDiscoveryFile(appRoot: string): void {
  devBridgeProcess.__agentNativeDevActionToken = undefined;
  const current = readDevActionDiscoveryFile(appRoot);
  if (!current || current.pid !== process.pid) return;
  try {
    fs.unlinkSync(path.join(appRoot, DISCOVERY_PATH));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(
        "[agent-native] could not remove dev action discovery file:",
        error,
      );
    }
  }
}

/**
 * Read the discovery file for a CLI forward attempt. Returns `undefined`
 * ("no usable dev server") for every failure mode — missing file, unreadable
 * file, malformed JSON, wrong shape — logging unexpected ones so a broken
 * file doesn't look identical to "no dev server running" during debugging.
 */
export function readDevActionDiscoveryFile(
  appRoot: string,
): DevActionDiscovery | undefined {
  const filePath = path.join(appRoot, DISCOVERY_PATH);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(
        "[agent-native] could not read dev action discovery file:",
        error,
      );
    }
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(
      "[agent-native] dev action discovery file is not valid JSON:",
      error,
    );
    return undefined;
  }
  const candidate = parsed as Partial<DevActionDiscovery> | null;
  if (
    !candidate ||
    typeof candidate.origin !== "string" ||
    !Number.isInteger(candidate.pid) ||
    typeof candidate.token !== "string" ||
    typeof candidate.databaseKey !== "string"
  ) {
    console.warn(
      "[agent-native] dev action discovery file has an unexpected shape; ignoring it",
    );
    return undefined;
  }
  return candidate as DevActionDiscovery;
}

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export interface MountDevActionForwardRouteOptions {
  appId?: string;
}

/**
 * Mount `POST /_agent-native/dev/action`, the loopback-only endpoint
 * `pnpm action` forwards to. Response contract: `{ ok: true, result }` (200)
 * on success, `{ ok: false, error }` (500) when the action ran and threw,
 * 404 when `name` isn't in this server's action registry (the CLI falls
 * back to running in-process — e.g. a core script like `db-query` that was
 * never mounted here), and 401 for every auth/production/loopback failure.
 */
export function mountDevActionForwardRoute(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountDevActionForwardRouteOptions,
): void {
  getH3App(nitroApp).use(
    DEV_ACTION_ROUTE,
    defineEventHandler(async (event: H3Event) => {
      // No discovery token is ever generated outside a local dev server, so
      // this also fails closed in practice without the explicit check —
      // it's kept explicit so a production deploy never even compares tokens.
      if (resolveDeployEnvironment() === "production") {
        setResponseStatus(event, 401);
        return { ok: false, error: "Not available outside local development." };
      }
      if (!isLoopbackRequest(event)) {
        setResponseStatus(event, 401);
        return {
          ok: false,
          error: "This endpoint only accepts loopback requests.",
        };
      }
      const expectedToken = resolveExpectedDevActionToken();
      const providedToken = getHeader(event, DEV_ACTION_TOKEN_HEADER);
      if (
        !expectedToken ||
        !providedToken ||
        !timingSafeTokenEqual(providedToken, expectedToken)
      ) {
        setResponseStatus(event, 401);
        return { ok: false, error: "Invalid or missing dev token." };
      }

      // coercion-ok: an unparseable body isn't distinguished from a
      // well-formed one missing `name` — both fail the same explicit
      // "must include an action name" check right below with a 500, so
      // collapsing to `null` here loses no information the caller could
      // otherwise act on.
      const body = (await readBody(event).catch(() => null)) as {
        name?: unknown;
        input?: unknown;
      } | null;
      const name = body?.name;
      if (typeof name !== "string") {
        setResponseStatus(event, 500);
        return {
          ok: false,
          error: "Request body must include an action name.",
        };
      }
      const entry = actions[name];
      // A CLI wrapper entry runs `pnpm action <name>` in a child process,
      // which would read this same discovery file and forward straight back
      // here. 404 sends the CLI down its in-process path instead.
      if (!entry || entry.cliWrapper) {
        setResponseStatus(event, 404);
        return { ok: false, error: `Action "${name}" not found.` };
      }
      const params = (body?.input ?? {}) as Record<string, unknown>;
      const userEmail =
        getHeader(event, DEV_ACTION_USER_HEADER) ||
        (await resolveDevUserEmail());
      const orgId = getHeader(event, DEV_ACTION_ORG_HEADER) || undefined;

      return runWithRequestContext({ userEmail, orgId }, async () => {
        try {
          const ctx: ActionRunContext = {
            userEmail: getRequestUserEmail(),
            orgId: getRequestOrgId() ?? null,
            ...(options?.appId ? { appId: options.appId } : {}),
            caller: "cli",
            actionName: name,
          };
          const result = await entry.run(params, ctx);
          if (!actionCallIsReadOnly(entry, params, false)) {
            await notifyActionChange({ actionName: name }).catch(() => {});
          }
          return { ok: true, result };
        } catch (error: any) {
          setResponseStatus(event, 500);
          return { ok: false, error: error?.message ?? String(error) };
        }
      });
    }),
  );
}
