
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
