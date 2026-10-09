import {
  getRuntimeDatabaseUrl,
  isPgliteUrl,
  isProcessAlive,
} from "../../db/client.js";
import {
  hashDatabaseKey,
  isLoopbackDevActionOrigin,
  readDevActionDiscoveryFile,
} from "../../server/dev-action-bridge.js";

export interface PgliteDevServer {
  origin: string;
  token: string;
}

export function discoverPgliteDevServer(): PgliteDevServer | null {
  const discovery = readDevActionDiscoveryFile(process.cwd());
  if (!discovery || !isProcessAlive(discovery.pid)) return null;
  if (!isLoopbackDevActionOrigin(discovery.origin)) return null;

  const runtimeUrl = getRuntimeDatabaseUrl("pglite:./data/pglite");
  if (!isPgliteUrl(runtimeUrl)) return null;
  if (discovery.databaseKey !== hashDatabaseKey(runtimeUrl)) return null;
  return { origin: discovery.origin, token: discovery.token };
}
