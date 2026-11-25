import type { DispatchConfig } from "../../config.js";

let activeConfig: DispatchConfig = {};

export function getDispatchConfig(): DispatchConfig {
  return activeConfig;
}

export function setDispatchConfig(config: DispatchConfig): void {
  activeConfig = Object.freeze({ ...config });
}

export function hostedCatalogEnabled(): boolean {
  return activeConfig.hostedCatalog !== false;
}
