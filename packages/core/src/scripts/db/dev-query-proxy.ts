/**
 * Forward `pnpm action db-query` to a running local dev server when the
 * discovery file says one is holding the same PGlite database open. Mirrors
 * `tryForwardToDevServer` in `../runner.js`, but targets the dedicated
 * `db-query` route instead of the app-action registry: `db-query` isn't a
 * registered action, so the generic route always 404s it (see
 * `dev-action-bridge.ts`).
 */

import { Agent } from "undici";

import {
  getRuntimeDatabaseUrl,
  isPgliteUrl,
  isProcessAlive,
} from "../../db/client.js";
import {
  DEV_ACTION_ORG_HEADER,
  DEV_ACTION_TOKEN_HEADER,
  DEV_ACTION_USER_HEADER,
  DEV_DB_QUERY_ROUTE,
  hashDatabaseKey,
  isLoopbackDevActionOrigin,
  readDevActionDiscoveryFile,
} from "../../server/dev-action-bridge.js";

export interface TryForwardDbQueryOptions {
  sql: string;
  params: unknown[];
  limit?: number;
  format?: string;
  /** The CLI's own resolved identity, forwarded so the server applies the
   * same row scoping the local path would instead of running unscoped. */
  userEmail?: string;
  orgId?: string;
  print: (
    rows: Record<string, unknown>[],
    sql: string,
    format?: string,
  ) => void;
}

/** Returns true when the query ran through the dev server. */
export async function tryForwardDbQueryToDevServer(
  options: TryForwardDbQueryOptions,
): Promise<boolean> {
  const discovery = readDevActionDiscoveryFile(process.cwd());
  if (!discovery || !isProcessAlive(discovery.pid)) return false;
  if (!isLoopbackDevActionOrigin(discovery.origin)) return false;

  // Same resolver the running server's request-time clients use, so an app
  // configured with a runtime/unpooled URL still produces a matching key.
  const runtimeUrl = getRuntimeDatabaseUrl("pglite:./data/pglite");
  if (!isPgliteUrl(runtimeUrl)) return false;
  const databaseKey = hashDatabaseKey(runtimeUrl);
  if (discovery.databaseKey !== databaseKey) return false;

  let response: Response;
  // Vite's local HTTPS mode commonly uses a self-signed certificate. This
  // dispatcher is created only after the strict loopback-origin check above,
  // so certificate bypass cannot send the dev token to a remote host. Same
  // pattern as `tryForwardToDevServer` (runner.ts).
  const tlsDispatcher = discovery.origin.startsWith("https:")
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  try {
    const request: RequestInit & { dispatcher?: Agent } = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEV_ACTION_TOKEN_HEADER]: discovery.token,
        ...(options.userEmail
          ? { [DEV_ACTION_USER_HEADER]: options.userEmail }
          : {}),
        ...(options.orgId ? { [DEV_ACTION_ORG_HEADER]: options.orgId } : {}),
      },
      body: JSON.stringify({
        sql: options.sql,
        ...(options.params.length > 0 ? { params: options.params } : {}),
        ...(options.limit ? { limit: options.limit } : {}),
      }),
      ...(tlsDispatcher ? { dispatcher: tlsDispatcher } : {}),
    };
    response = await fetch(`${discovery.origin}${DEV_DB_QUERY_ROUTE}`, request);
  } catch {
    await tlsDispatcher?.destroy();
    // coercion-ok: a network failure here isn't hidden — it routes to the
    // in-process path below, which has its own explicit success/failure
    // signaling (including PGlite's own loud lock error). Same reasoning as
    // the identical catch in `tryForwardToDevServer` (runner.ts).
    return false;
  }

  if (response.status === 404) {
    await tlsDispatcher?.close();
    return false;
  }

  if (response.status === 401 || response.status === 403) {
    const body = await response
      .json()
      .catch(() => ({ error: `HTTP ${response.status}` }));
    await tlsDispatcher?.close();
    throw new Error(
      (body as { error?: string })?.error ?? `HTTP ${response.status}`,
    );
  }

  // coercion-ok: an unparseable body isn't distinguished from a well-formed
  // one missing `ok` — both fail the explicit `!body?.ok` check right below
  // with a thrown, loud error, so collapsing to `null` here loses no
  // information the caller could otherwise act on.
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    rows?: Record<string, unknown>[];
    sql?: string;
  } | null;
  await tlsDispatcher?.close();

  if (!body?.ok) {
    throw new Error(body?.error ?? "Invalid response from dev server.");
  }

  console.log(`[dev-db] proxied query through ${discovery.origin}`);
  options.print(body.rows ?? [], body.sql ?? options.sql, options.format);
  return true;
}
