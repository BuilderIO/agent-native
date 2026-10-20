import { Agent } from "undici";

import {
  DEV_ACTION_TOKEN_HEADER,
  DEV_DB_MIGRATE_ROUTE,
} from "../../server/dev-action-bridge.js";
import { discoverPgliteDevServer } from "./dev-server-discovery.js";

export interface TryForwardDbMigrateOptions {
  dataDir: string;
  migrationsFolder: string;
  migrationsTable?: string;
  migrationsSchema?: string;
}

export async function tryForwardDbMigrateToDevServer(
  options: TryForwardDbMigrateOptions,
): Promise<boolean> {
  const discovery = discoverPgliteDevServer();
  if (!discovery || discovery.dataDir !== options.dataDir) return false;
  const { dataDir: _dataDir, ...requestBody } = options;

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
      body: JSON.stringify(requestBody),
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

  if (
    response.status === 404 ||
    (response.status === 401 && typeof body?.ok !== "boolean")
  ) {
    throw new Error(
      `The running dev server (${discovery.origin}) predates \`agent-native db-migrate\` and can't apply migrations. Restart it, then rerun this command.`,
    );
  }
  if (!body?.ok) {
    throw new Error(
      body?.error ?? `Dev server migrate failed (HTTP ${response.status}).`,
    );
  }

  console.log(`[dev-db] applied migrations through ${discovery.origin}`);
  return true;
}
