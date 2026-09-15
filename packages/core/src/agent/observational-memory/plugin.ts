/**
 * Nitro plugin that applies the Observational Memory migrations under its own
 * bookkeeping table. Mirrors `context-xray/plugin.ts`.
 *
 * NOT YET registered in the default plugin set — registering it means editing
 * shared bootstrap files (server/framework-request-handler.ts,
 * deploy/route-discovery.ts), which is deferred to the same follow-up that
 * wires `buildObservationalContext` into production-agent.ts. Until then the
 * store's `ensureTable()` creates the table lazily on first use, so OM is fully
 * functional without the plugin.
 */

import { runMigrations } from "../../db/migrations.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
} from "../../server/framework-request-handler.js";
import { OBSERVATIONAL_MEMORY_MIGRATIONS } from "./migrations.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createObservationalMemoryPlugin(): NitroPluginDef {
  const migrate = runMigrations(OBSERVATIONAL_MEMORY_MIGRATIONS, {
    table: "_observational_memory_migrations",
  });

  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "observational-memory");
    await awaitBootstrap(nitroApp);
    await migrate(nitroApp);
  };
}

export const defaultObservationalMemoryPlugin: NitroPluginDef =
  createObservationalMemoryPlugin();
