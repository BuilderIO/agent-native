import { runMigrations } from "../../db/migrations.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
} from "../../server/framework-request-handler.js";
import { CONTEXT_XRAY_MIGRATIONS } from "./migrations.js";

type NitroPluginDef = (nitroApp: any) => void | Promise<void>;

export function createContextXrayPlugin(): NitroPluginDef {
  const migrate = runMigrations(CONTEXT_XRAY_MIGRATIONS, {
    table: "_context_xray_migrations",
  });

  return async (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "context-xray");
    await awaitBootstrap(nitroApp);
    await migrate(nitroApp);
  };
}

export const defaultContextXrayPlugin: NitroPluginDef =
  createContextXrayPlugin();
