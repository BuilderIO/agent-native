import {
  FRAMEWORK_INTERNAL_ROUTE_PREFIX,
  FRAMEWORK_ROUTE_PREFIX_ENV,
  isInternalFrameworkPathLeak,
  normalizeFrameworkRoutePrefix,
  toInternalFrameworkPath,
  toPublicFrameworkPath,
} from "../shared/framework-route-prefix.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";

export { FRAMEWORK_INTERNAL_ROUTE_PREFIX } from "../shared/framework-route-prefix.js";

function readConfiguredPrefix(): string | undefined {
  // config-ok: embedded at build time by literal replacement, which the app-config env layer's dynamic lookup cannot see (see module comment)
  const raw = process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX;
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function getFrameworkRoutePrefix(): string {
  return normalizeFrameworkRoutePrefix(
    readConfiguredPrefix(),
    FRAMEWORK_ROUTE_PREFIX_ENV,
  );
}

export function hasCustomFrameworkRoutePrefix(): boolean {
  return getFrameworkRoutePrefix() !== FRAMEWORK_INTERNAL_ROUTE_PREFIX;
}

function prefixOptions() {
  return {
    publicPrefix: getFrameworkRoutePrefix(),
    basePath: getConfiguredAppBasePath(),
  };
}

export function publicFrameworkPath(path: string): string {
  return toPublicFrameworkPath(path, prefixOptions());
}

export function internalFrameworkPath(pathname: string): string | null {
  return toInternalFrameworkPath(pathname, prefixOptions());
}

export function canonicalFrameworkPathname(pathname: string): string {
  return internalFrameworkPath(pathname) ?? pathname;
}

export function isRetiredInternalFrameworkPath(pathname: string): boolean {
  return isInternalFrameworkPathLeak(pathname, prefixOptions());
}
