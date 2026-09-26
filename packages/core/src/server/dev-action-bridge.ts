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
import { getAppConfig } from "../app-config/index.js";
import { getRuntimeDatabaseUrl } from "../db/client.js";
import { resolveDevUserEmail } from "../scripts/dev-session.js";
import { actionCallIsReadOnly, notifyActionChange } from "./action-change.js";
import { resolveDeployEnvironment } from "./deploy-environment.js";
import {
  DEV_ACTION_DISCOVERY_PATH,
  type DevActionDiscovery,
  readDevActionDiscoveryFile,
} from "./dev-action-discovery.js";
import { getH3App } from "./framework-request-handler.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
  runWithRequestContext,
} from "./request-context.js";

export const DEV_ACTION_ROUTE = "/_agent-native/dev/action";
export const DEV_DB_QUERY_ROUTE = "/_agent-native/dev/db-query";
export const DEV_ACTION_TOKEN_HEADER = "x-agent-native-dev-token";
export const DEV_ACTION_USER_HEADER = "x-agent-native-dev-user";
export const DEV_ACTION_ORG_HEADER = "x-agent-native-dev-org";

export { readDevActionDiscoveryFile } from "./dev-action-discovery.js";

export function hashDatabaseKey(databaseUrl: string): string {
  return crypto.createHash("sha256").update(databaseUrl).digest("hex");
}

export function isLoopbackDevActionOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (url.hostname === "127.0.0.1" ||
        url.hostname === "localhost" ||
        url.hostname === "[::1]") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    // coercion-ok: an unparseable origin is simply not a dev server to trust.
    return false;
  }
}

const DEV_ACTION_HANDOFF_KEYS = ["embedStartUrl", "startUrl"] as const;
const DEV_ACTION_HANDOFF_PATH = "/_agent-native/embed/start";

function withoutDevActionHandoffSecrets(
  value: unknown,
  ancestors = new WeakSet<object>(),
): unknown {
  if (!value || typeof value !== "object") return value;
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((child) =>
        withoutDevActionHandoffSecrets(child, ancestors),
      );
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(
          ([key]) => !DEV_ACTION_HANDOFF_KEYS.some((name) => name === key),
        )
        .map(([key, child]) => [
          key,
          withoutDevActionHandoffSecrets(child, ancestors),
        ]),
    );
  } finally {
    ancestors.delete(value);
  }
}

function isLoopbackAppUrl(value: string): URL | undefined {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "::1" &&
      hostname !== "[::1]")
  ) {
    return undefined;
  }
  return url;
}

export function isValidDevActionHandoffUrl(
  value: unknown,
  loopbackAppUrl = getAppConfig().app.url,
): value is string {
  if (typeof value !== "string") return false;
  if (value.startsWith(`${DEV_ACTION_HANDOFF_PATH}?`)) return true;
  const appUrl = loopbackAppUrl ? isLoopbackAppUrl(loopbackAppUrl) : undefined;
  if (!appUrl) return false;
  if (!URL.canParse(value)) return false;
  const candidate = new URL(value);
  return (
    candidate.origin === appUrl.origin &&
    candidate.pathname === DEV_ACTION_HANDOFF_PATH &&
    candidate.search.length > 1
  );
}

export function devActionHandoffUrl(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  for (const key of DEV_ACTION_HANDOFF_KEYS) {
    const value = (result as Record<string, unknown>)[key];
    if (isValidDevActionHandoffUrl(value)) {
      return value;
    }
  }
  return undefined;
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

function resolveExpectedDevActionToken(): string | undefined {
  return (
    getDevActionToken() ?? readDevActionDiscoveryFile(process.cwd())?.token
  );
}

export function writeDevActionDiscoveryFile(
  appRoot: string,
  origin: string,
  databaseKey: string,
): void {
  const token = crypto.randomBytes(32).toString("hex");
  devBridgeProcess.__agentNativeDevActionToken = token;
  const filePath = path.join(appRoot, DEV_ACTION_DISCOVERY_PATH);
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

export function removeDevActionDiscoveryFile(appRoot: string): void {
  devBridgeProcess.__agentNativeDevActionToken = undefined;
  const current = readDevActionDiscoveryFile(appRoot);
  if (!current || current.pid !== process.pid) return;
  try {
    fs.unlinkSync(path.join(appRoot, DEV_ACTION_DISCOVERY_PATH));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
      console.warn(
        "[agent-native] could not remove dev action discovery file:",
        error,
      );
    }
  }
}

function timingSafeTokenEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

export interface MountDevActionForwardRouteOptions {
  appId?: string;
}

export function mountDevActionForwardRoute(
  nitroApp: any,
  actions: Record<string, ActionEntry>,
  options?: MountDevActionForwardRouteOptions,
): void {
  getH3App(nitroApp).use(
    DEV_ACTION_ROUTE,
    defineEventHandler(async (event: H3Event) => {
      const { isLoopbackRequest } = await import("./auth.js");
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
      if (!entry || entry.cliWrapper) {
        setResponseStatus(event, 404);
        return { ok: false, error: `Action "${name}" not found.` };
      }
      if (entry.uiOnly === true) {
        setResponseStatus(event, 403);
        return {
          ok: false,
          error: "This action can only be called from the signed-in app UI.",
        };
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
          const devHandoffUrl = devActionHandoffUrl(result);
          return {
            ok: true,
            result: withoutDevActionHandoffSecrets(result),
            ...(devHandoffUrl ? { devHandoffUrl } : {}),
          };
        } catch (error: any) {
          setResponseStatus(event, 500);
          return { ok: false, error: error?.message ?? String(error) };
        }
      });
    }),
  );
}

export function mountDevDbQueryForwardRoute(nitroApp: any): void {
  getH3App(nitroApp).use(
    DEV_DB_QUERY_ROUTE,
    defineEventHandler(async (event: H3Event) => {
      const { isLoopbackRequest } = await import("./auth.js");
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
      // well-formed one missing `sql` — both fail the same explicit
      // "must include SQL" check right below with a 500.
      const body = (await readBody(event).catch(() => null)) as {
        sql?: unknown;
        params?: unknown;
        limit?: unknown;
      } | null;
      const sql = body?.sql;
      if (typeof sql !== "string") {
        setResponseStatus(event, 500);
        return { ok: false, error: "Request body must include SQL." };
      }
      const sqlArgs = Array.isArray(body?.params) ? body.params : [];
      const limit = typeof body?.limit === "number" ? body.limit : undefined;
      const userEmail =
        getHeader(event, DEV_ACTION_USER_HEADER) ||
        (await resolveDevUserEmail());
      const orgId = getHeader(event, DEV_ACTION_ORG_HEADER) || undefined;

      return runWithRequestContext({ userEmail, orgId }, async () => {
        try {
          const { runDbQuery } = await import("../scripts/db/query.js");
          const databaseUrl = getRuntimeDatabaseUrl("pglite:./data/pglite");
          const result = await runDbQuery({ sql, sqlArgs, limit, databaseUrl });
          return { ok: true, rows: result.rows, sql: result.sql };
        } catch (error: any) {
          setResponseStatus(event, 500);
          return { ok: false, error: error?.message ?? String(error) };
        }
      });
    }),
  );
}
