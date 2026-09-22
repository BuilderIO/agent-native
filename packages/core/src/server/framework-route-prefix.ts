/**
 * The server's single reader of the public framework route prefix.
 *
 * `runtime.frameworkRoutePrefix` is resolved once, by the Vite plugin at dev
 * start or by the deploy build, and embedded into the server bundle as a
 * literal environment read of `AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX`
 * (Vite `define`, Nitro `replace`, and the deploy build's own replacement
 * map — the same channel `AGENT_NATIVE_DEPLOYMENT_ENVIRONMENT` uses). A
 * declared app-config field would be read through the env layer's dynamic
 * lookup, which the build-time replacement cannot reach, and a deployed
 * function would then disagree with the browser bundle it serves.
 *
 * Keep this the only environment read of that key.
 */
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
  // A build with the option unset embeds an empty string; that is the
  // default, not an invalid value.
  return trimmed === "" ? undefined : trimmed;
}

/** The validated public prefix. Throws on a malformed deployment value. */
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

/**
 * The public form of an internal framework path or URL of THIS deployment.
 * Apply it where the URL is built, never to a response body, and never to a
 * URL that targets another installation.
 */
export function publicFrameworkPath(path: string): string {
  return toPublicFrameworkPath(path, prefixOptions());
}

/**
 * The internal pathname for an incoming public request, or `null` when the
 * request is not under the public framework prefix.
 */
export function internalFrameworkPath(pathname: string): string | null {
  return toInternalFrameworkPath(pathname, prefixOptions());
}

/**
 * The internal form of a pathname that may carry the public prefix — for
 * validating a URL a client or provider handed back (an OAuth `redirect_uri`,
 * a magic-link callback) against the internal route names the code knows.
 */
export function canonicalFrameworkPathname(pathname: string): string {
  return internalFrameworkPath(pathname) ?? pathname;
}

/** True when a request names the internal prefix that a custom prefix retired. */
export function isRetiredInternalFrameworkPath(pathname: string): boolean {
  return isInternalFrameworkPathLeak(pathname, prefixOptions());
}
