import { getAppConfig } from "../app-config/index.js";
import type { DefaultPluginSlot } from "../app-config/plugins.js";

export function getDisabledDefaultPlugins(): readonly DefaultPluginSlot[] {
  return getAppConfig().plugins.disabled;
}

export function isDefaultPluginDisabled(slot: string): boolean {
  return (getDisabledDefaultPlugins() as readonly string[]).includes(slot);
}
