
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
  userEmail?: string;
  orgId?: string;
  print: (
    rows: Record<string, unknown>[],
    sql: string,
    format?: string,
  ) => void;
}

export async function tryForwardDbQueryToDevServer(
  options: TryForwardDbQueryOptions,
): Promise<boolean> {
  const discovery = readDevActionDiscoveryFile(process.cwd());
  if (!discovery || !isProcessAlive(discovery.pid)) return false;
  if (!isLoopbackDevActionOrigin(discovery.origin)) return false;

  const runtimeUrl = getRuntimeDatabaseUrl("pglite:./data/pglite");
  if (!isPgliteUrl(runtimeUrl)) return false;
  const databaseKey = hashDatabaseKey(runtimeUrl);
  if (discovery.databaseKey !== databaseKey) return false;

  let response: Response;
  // so certificate bypass cannot send the dev token to a remote host. Same
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
