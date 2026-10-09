import { Agent } from "undici";

import {
  DEV_ACTION_TOKEN_HEADER,
  DEV_DB_MIGRATE_ROUTE,
} from "../../server/dev-action-bridge.js";
import { discoverPgliteDevServer } from "./dev-server-discovery.js";

export interface TryForwardDbMigrateOptions {
  migrationsFolder: string;
  migrationsTable?: string;
  migrationsSchema?: string;
}

export async function tryForwardDbMigrateToDevServer(
  options: TryForwardDbMigrateOptions,
): Promise<boolean> {
  const discovery = discoverPgliteDevServer();
  if (!discovery) return false;

  // Created only after the loopback-origin check in discovery, so the
  // certificate bypass cannot send the dev token to a remote host.
  const tlsDispatcher = discovery.origin.startsWith("https:")
    ? new Agent({ connect: { rejectUnauthorized: false } })
    : undefined;
  let response: Response;
  try {
    const request: RequestInit & { dispatcher?: Agent } = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DEV_ACTION_TOKEN_HEADER]: discovery.token,
      },
      body: JSON.stringify(options),
      ...(tlsDispatcher ? { dispatcher: tlsDispatcher } : {}),
    };
    response = await fetch(
      `${discovery.origin}${DEV_DB_MIGRATE_ROUTE}`,
      request,
    );
  } catch {
    await tlsDispatcher?.destroy();
    // coercion-ok: a network failure routes to the drizzle-kit fallback, which
    // the createDrizzleConfig guard blocks loudly if the dev server still
    // holds the PGlite directory.
    return false;
  }

  // coercion-ok: an unparseable body fails the explicit `!body?.ok` check
  // below with a thrown error.
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  await tlsDispatcher?.close();

  if (response.status === 404) return false;
  if (!body?.ok) {
    throw new Error(
      body?.error ?? `Dev server migrate failed (HTTP ${response.status}).`,
    );
  }

  console.log(`[dev-db] applied migrations through ${discovery.origin}`);
  return true;
}
