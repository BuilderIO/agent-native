import type { EventHandler, H3Event } from "h3";
import { getHeader, setResponseHeader, setResponseStatus } from "h3";

import { AppConfigurationError } from "../app-config/index.js";
import { markServerRuntimeStarted } from "../db/server-runtime.js";
import { getMissingDefaultPlugins } from "../deploy/route-discovery.js";
import { MCP_PUBLIC_ROUTE_PREFIX } from "../mcp/route-paths.js";
import {
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
} from "../shared/sign-in-journey.js";
import {
  SYNTHETIC_TRAFFIC_HEADER,
  isSyntheticTrafficValue,
} from "../shared/test-traffic.js";
import { getConfiguredAppBasePath } from "./app-base-path.js";
import { captureError } from "./capture-error.js";
import { createCsrfMiddleware } from "./csrf.js";
import { getDisabledDefaultPlugins } from "./default-plugins.js";
import { PUBLIC_PATHNAME_CONTEXT_KEY } from "./framework-request-context.js";
import {
  getFrameworkRoutePrefix,
  internalFrameworkPath,
  isRetiredInternalFrameworkPath,
} from "./framework-route-prefix.js";
import {
  getOrCreateHttpRequestTrackingScope,
  installHttpResponseTelemetryHooks,
  recordFrameworkReadyWait,
} from "./http-response-telemetry.js";
import {
  getRequestContext,
  markRequestBoundaryInstalled,
  runWithRequestContext,
} from "./request-context.js";

const BOOTSTRAPPED = new WeakSet<object>();
const IN_BOOTSTRAP = new WeakSet<object>();
const FRAMEWORK_PREFIX = "/_agent-native";
const WELL_KNOWN_PREFIX = "/.well-known";
const APP_SHIM_KEY = "_agentNativeH3Shim";
const BOOTSTRAP_PROMISE_KEY = "_agentNativeBootstrapPromise";
const PLUGIN_READY_KEY = "_agentNativePluginReadyPromise";
const PLUGIN_READY_PLACEHOLDERS_KEY = "_agentNativePluginReadyPlaceholders";
const PLUGIN_FAILED_KEY = "_agentNativePluginInitFailures";
const PROVIDED_PLUGIN_STEMS_KEY = "_agentNativeProvidedPluginStems";
const EARLY_FRAMEWORK_PATHS_KEY = "_agentNativeEarlyFrameworkPaths";
const MIDDLEWARE_DISPATCHER_PATCHED_KEY =
  "_agentNativeMiddlewareDispatcherPatched";
const REQUEST_CONTEXT_BOUNDARY_KEY = "_agentNativeRequestContextBoundary";
const RETIRED_PATH_CONTEXT_KEY = "_frameworkRetiredPathname";

const CANONICAL_AUTH_EARLY_PATHS = [
  "/",
  SIGN_IN_ENTRY_PATH,
  "/login",
  "/signup",
] as const;

export const FRAMEWORK_AUTH_EARLY_PATHS = [
  `${FRAMEWORK_PREFIX}/auth`,
  "/",
  SIGN_IN_ENTRY_PATH,
  SIGN_IN_LEGACY_ENTRY_PATH,
  `${FRAMEWORK_PREFIX}/login`,
  `${FRAMEWORK_PREFIX}/signup`,
  "/login",
  "/signup",
] as const;

interface PluginReadyEntry {
  promise: Promise<void>;
  paths?: string[];
  excludedPaths?: string[];
}

function getAppBasePath(): string {
  return getConfiguredAppBasePath();
}

function pathMatchesPrefix(reqPath: string, prefix: string): boolean {
  return reqPath === prefix || reqPath.startsWith(prefix + "/");
}

function supportsAppBasePathMount(path: string): boolean {
  return (
    pathMatchesPrefix(path, FRAMEWORK_PREFIX) ||
    pathMatchesPrefix(path, WELL_KNOWN_PREFIX) ||
    pathMatchesPrefix(path, MCP_PUBLIC_ROUTE_PREFIX) ||
    CANONICAL_AUTH_EARLY_PATHS.some((authPath) =>
      pathMatchesPrefix(path, authPath),
    )
  );
}

function resolveMountMatch(
  reqPath: string,
  path: string,
): { mountPath: string; strippedPath: string } | null {
  if (pathMatchesPrefix(reqPath, path)) {
    return { mountPath: path, strippedPath: reqPath.slice(path.length) || "/" };
  }

  const appBasePath = getAppBasePath();
  if (!appBasePath || !supportsAppBasePathMount(path)) return null;

  const prefixedPath = `${appBasePath}${path}`;
  if (
    path === "/"
      ? reqPath !== appBasePath && reqPath !== `${appBasePath}/`
      : !pathMatchesPrefix(reqPath, prefixedPath)
  ) {
    return null;
  }
  return {
    mountPath: prefixedPath,
    strippedPath:
      path === "/" ? "/" : reqPath.slice(prefixedPath.length) || "/",
  };
}

function translatePublicFrameworkRequest(event: H3Event): void {
  const eventAny = event as any;
  const context = (eventAny.context ??= {});
  if (
    context[PUBLIC_PATHNAME_CONTEXT_KEY] !== undefined ||
    context[RETIRED_PATH_CONTEXT_KEY] !== undefined
  ) {
    return;
  }
  const pathname = event.url?.pathname ?? "";
  const internal = internalFrameworkPath(pathname);
  if (internal !== null) {
    context[PUBLIC_PATHNAME_CONTEXT_KEY] = pathname;
    try {
      event.url.pathname = internal;
      eventAny.path = `${internal}${event.url.search || ""}`;
    } catch {
      // coercion-ok: event.url is read-only on some runtimes, the same case
      // registerMiddleware's mount stripping tolerates; the public pathname
      // stays recorded in context and no mount can match it, so the request
      // falls through to a 404 rather than being served under the wrong name.
    }
    return;
  }
  if (isRetiredInternalFrameworkPath(pathname)) {
    context[RETIRED_PATH_CONTEXT_KEY] = pathname;
  }
}

export { getPublicFrameworkPathname } from "./framework-request-context.js";

export interface H3AppShim {
  use(path: string, handler: EventHandler): void;
  use(handler: EventHandler): void;
}

export function markDefaultPluginProvided(nitroApp: any, stem: string): void {
  if (!nitroApp || !stem) return;
  const existing = nitroApp[PROVIDED_PLUGIN_STEMS_KEY] as
    | Set<string>
    | undefined;
  const provided = existing ?? new Set<string>();
  provided.add(stem);
  nitroApp[PROVIDED_PLUGIN_STEMS_KEY] = provided;
}

export function markFrameworkRoutesReadyBeforeBootstrap(
  nitroApp: any,
  paths: readonly string[],
): void {
  if (!nitroApp) return;
  const existing =
    (nitroApp[EARLY_FRAMEWORK_PATHS_KEY] as Set<string> | undefined) ??
    new Set<string>();
  for (const path of paths) {
    if (path) existing.add(path);
  }
  nitroApp[EARLY_FRAMEWORK_PATHS_KEY] = existing;
}

export function getH3App(nitroApp: any): H3AppShim {
  if (!nitroApp) throw new Error("getH3App: nitroApp is required");
  getFrameworkRoutePrefix();
  ensureGlobalMiddlewareDispatch(nitroApp);
  installHttpResponseTelemetryHooks(nitroApp);

  const cached = nitroApp[APP_SHIM_KEY] as H3AppShim | undefined;
  if (cached) return cached;

  const shim: H3AppShim = {
    use(arg1: string | EventHandler, arg2?: EventHandler) {
      const path = typeof arg1 === "string" ? arg1 : "";
      const handler = (typeof arg1 === "string" ? arg2 : arg1) as EventHandler;
      if (typeof handler !== "function") {
        throw new Error("getH3App.use: handler must be a function");
      }
      registerMiddleware(nitroApp, path, handler);
    },
  };

  nitroApp[APP_SHIM_KEY] = shim;

  if (!BOOTSTRAPPED.has(nitroApp)) {
    BOOTSTRAPPED.add(nitroApp);
    markServerRuntimeStarted();
    getDisabledDefaultPlugins();
    const bootstrap = Promise.resolve()
      .then(() => bootstrapDefaultPlugins(nitroApp))
      .catch((err) => {
        console.warn(
          "[agent-native] Failed to auto-mount default plugins:",
          (err as Error).message,
        );
        captureError(err, {
          route: "default-plugin-bootstrap",
          tags: { phase: "default-plugin-bootstrap" },
        });
        if (err instanceof AppConfigurationError) throw err;
      });
    bootstrap.catch(() => {});
    nitroApp[BOOTSTRAP_PROMISE_KEY] = bootstrap;

    const readinessGate = (async (event: H3Event) => {
      const eventAny = event as any;
      await awaitFrameworkRoutesReadyForRequest(
        nitroApp,
        eventAny.context?._mountedPathname ?? event.url?.pathname ?? "",
      );
      return undefined;
    }) as EventHandler;
    registerMiddleware(nitroApp, FRAMEWORK_PREFIX, readinessGate, {
      prepend: true,
    });
    registerMiddleware(nitroApp, WELL_KNOWN_PREFIX, readinessGate, {
      prepend: true,
    });
    registerMiddleware(nitroApp, MCP_PUBLIC_ROUTE_PREFIX, readinessGate, {
      prepend: true,
    });
    for (const path of CANONICAL_AUTH_EARLY_PATHS) {
      registerMiddleware(nitroApp, path, readinessGate, { prepend: true });
    }

    registerMiddleware(nitroApp, "", createCsrfMiddleware());

    registerRequestContextBoundary(nitroApp);

    nitroApp.hooks?.hook?.("request", async (event: H3Event) => {
      translatePublicFrameworkRequest(event);
      const reqPath = event.url?.pathname ?? "";
      if (
        resolveMountMatch(reqPath, FRAMEWORK_PREFIX) ||
        resolveMountMatch(reqPath, WELL_KNOWN_PREFIX) ||
        resolveMountMatch(reqPath, MCP_PUBLIC_ROUTE_PREFIX) ||
        FRAMEWORK_AUTH_EARLY_PATHS.some((path) =>
          resolveMountMatch(reqPath, path),
        )
      ) {
        const startedAt = Date.now();
        try {
          await awaitFrameworkRoutesReadyForRequest(nitroApp, reqPath);
        } finally {
          recordFrameworkReadyWait(event, Date.now() - startedAt);
        }
      }
    });
  }

  return shim;
}

/**
 * Establish a `RequestContext` for every inbound request, so no HTTP handler
 * ever asks a request-scoped question with no request in scope.
 *
 * Hand-written `/api/*` routes have no ALS store of their own, and
 * `getRequestUserEmail()` used to answer those with `AGENT_USER_EMAIL` — a
 * process-wide ambient identity standing in for the caller, which fails open
 * toward more privilege (an admin gate reading it admits whoever the deploy env
 * names). This store is deliberately identity-free: resolving the session here
 * would mean reading cookies on the SSR path, which must stay one impersonal
 * cached shell. Handlers that do know the caller still nest their own
 * `runWithRequestContext`, which shadows this one.
 *
 * h3 v2 hands middleware a `next()` that returns the result of the rest of the
 * chain (route handler included), so wrapping `next()` puts the whole request
 * inside the ALS scope. It must be `~middleware[0]`; going through
 * `registerMiddleware` is not an option because that adapter hides `next`.
 */
function registerRequestContextBoundary(nitroApp: any): void {
  const h3 = nitroApp?.h3;
  if (!h3 || !Array.isArray(h3["~middleware"])) return;
  if (h3[REQUEST_CONTEXT_BOUNDARY_KEY]) return;

  const middleware = (event: H3Event, next: () => unknown) => {
    translatePublicFrameworkRequest(event);
    if ((event as any).context?.[RETIRED_PATH_CONTEXT_KEY] !== undefined) {
      setResponseStatus(event, 404);
      setResponseHeader(event, "content-type", "application/json");
      return { error: "Not found" };
    }
    const inheritedContext = getRequestContext();
    const syntheticTraffic = isSyntheticTrafficValue(
      getHeader(event, SYNTHETIC_TRAFFIC_HEADER),
    );
    const trackingScope = getOrCreateHttpRequestTrackingScope(event);
    const requestContext = inheritedContext
      ? {
          ...inheritedContext,
          ...(syntheticTraffic === undefined
            ? {}
            : { isSyntheticTraffic: syntheticTraffic }),
          trackingScope,
        }
      : {
          isSyntheticTraffic: syntheticTraffic,
          trackingScope,
        };
    return runWithRequestContext(requestContext, () => next());
  };

  h3[REQUEST_CONTEXT_BOUNDARY_KEY] = middleware;
  h3["~middleware"].unshift(middleware);
  markRequestBoundaryInstalled();
}

function ensureGlobalMiddlewareDispatch(nitroApp: any): void {
  const h3 = nitroApp?.h3;
  if (!h3) return;
  const current = h3["~getMiddleware"];
  if (h3[MIDDLEWARE_DISPATCHER_PATCHED_KEY] === current) return;

  const original = typeof current === "function" ? current.bind(h3) : undefined;

  const wrappedGetMiddleware = (event: H3Event, route: unknown) => {
    const originalResult = original ? original(event, route) : [];
    const originalList = Array.isArray(originalResult)
      ? originalResult
      : originalResult
        ? [originalResult]
        : [];
    const globalMiddleware = Array.isArray(h3["~middleware"])
      ? h3["~middleware"]
      : [];
    if (globalMiddleware.length === 0) return originalList;

    const alreadyIncluded = new Set(originalList);
    const missingGlobal = globalMiddleware.filter(
      (middleware) => !alreadyIncluded.has(middleware),
    );
    return missingGlobal.length
      ? [...missingGlobal, ...originalList]
      : originalList;
  };

  h3["~getMiddleware"] = wrappedGetMiddleware;
  h3[MIDDLEWARE_DISPATCHER_PATCHED_KEY] = wrappedGetMiddleware;
}

/**
 * Wait for the framework's default-plugin bootstrap to complete.
 *
 * Called by user-facing plugin factories (`createAgentChatPlugin`, etc.) at
 * the top of their plugin function, so that by the time the function returns
 * — and Nitro starts accepting requests — all default plugins have finished
 * registering their middleware.
 *
 * No-op when called from inside the bootstrap itself (avoids deadlock when a
 * default plugin happens to be running as part of bootstrap).
 */
export async function awaitBootstrap(nitroApp: any): Promise<void> {
  if (!nitroApp || IN_BOOTSTRAP.has(nitroApp)) return;
  getH3App(nitroApp);
  const promise = nitroApp[BOOTSTRAP_PROMISE_KEY];
  if (promise) await promise;
}

async function awaitFrameworkRoutesReadyForRequest(
  nitroApp: any,
  reqPath: string,
): Promise<boolean> {
  if (!nitroApp) return true;
  if (
    resolveMountMatch(reqPath, `${FRAMEWORK_PREFIX}/speculation-rules.json`)
  ) {
    return true;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const bootstrapPromise = nitroApp[BOOTSTRAP_PROMISE_KEY];
        const earlyPaths = nitroApp[EARLY_FRAMEWORK_PATHS_KEY] as
          | Set<string>
          | undefined;
        const canDispatchBeforeBootstrap = Boolean(
          earlyPaths?.size &&
          Array.from(earlyPaths).some((path) =>
            resolveMountMatch(reqPath, path),
          ),
        );
        if (bootstrapPromise && !canDispatchBeforeBootstrap) {
          await bootstrapPromise;
        }
        await awaitPluginsReady(nitroApp, reqPath, {
          skipUnscoped: canDispatchBeforeBootstrap,
        });
        return true;
      })(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), frameworkReadyDeadlineMs());
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function frameworkReadyDeadlineMs(): number {
  const raw = Number(process.env.AGENT_NATIVE_ROUTE_READY_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 25_000;
}

export function trackPluginInit(
  nitroApp: any,
  promise: Promise<void>,
  options: { paths?: string[]; excludedPaths?: string[] } = {},
): void {
  if (!nitroApp) return;
  getH3App(nitroApp);
  const safe = promise.catch((err) => {
    console.error(
      "[agent-native] Plugin init failed:",
      (err as Error).message || err,
    );
    const failures = (nitroApp[PLUGIN_FAILED_KEY] ??= new Map<
      string,
      string
    >());
    const msg = (err as Error)?.message || String(err);
    for (const p of options.paths?.filter(Boolean) ?? []) failures.set(p, msg);
  });
  const entry: PluginReadyEntry = {
    promise: safe,
    paths: options.paths?.filter(Boolean),
    excludedPaths: options.excludedPaths?.filter(Boolean),
  };
  const existing = nitroApp[PLUGIN_READY_KEY] as PluginReadyEntry[] | undefined;
  if (existing) {
    existing.push(entry);
  } else {
    nitroApp[PLUGIN_READY_KEY] = [entry];
  }
  installPluginReadyPlaceholders(nitroApp, entry.paths, entry.excludedPaths);
}

function installPluginReadyPlaceholders(
  nitroApp: any,
  paths: string[] | undefined,
  excludedPaths: string[] | undefined,
): void {
  if (!paths?.length) return;
  const existing = nitroApp[PLUGIN_READY_PLACEHOLDERS_KEY] as
    | Set<string>
    | undefined;
  const installed = existing ?? new Set<string>();
  nitroApp[PLUGIN_READY_PLACEHOLDERS_KEY] = installed;

  for (const path of paths) {
    if (!path || installed.has(path)) continue;
    installed.add(path);
    registerMiddleware(
      nitroApp,
      path,
      (async (event: H3Event) => {
        const eventAny = event as any;
        const reqPath =
          eventAny.context?._mountedPathname ?? event.url?.pathname ?? path;
        if (
          excludedPaths?.some((excludedPath) =>
            resolveMountMatch(reqPath, excludedPath),
          )
        ) {
          return undefined;
        }
        const ready = await awaitFrameworkRoutesReadyForRequest(
          nitroApp,
          reqPath,
        );
        if (!ready) {
          setResponseStatus(event, 503);
          setResponseHeader(event, "retry-after", "5");
          return { error: "agent-native routes are still initializing" };
        }
        const failures = nitroApp[PLUGIN_FAILED_KEY] as
          | Map<string, string>
          | undefined;
        if (failures?.size) {
          for (const [failedPath, msg] of failures) {
            if (resolveMountMatch(reqPath, failedPath)) {
              setResponseStatus(event, 503);
              setResponseHeader(event, "retry-after", "5");
              return {
                error: `agent-native route is initializing or unavailable: ${msg}`,
              };
            }
          }
        }
        return undefined;
      }) as EventHandler,
      {
        prepend: true,
      },
    );
  }
}

function logFrameworkRouteError(args: {
  method: string | undefined;
  route: string;
  status: number;
  error: unknown;
}): void {
  const error = args.error as any;
  const message = error?.message || String(args.error);
  const prefix = `[agent-native] ${args.method ?? ""} ${args.route} failed (${args.status})`;
  if (process.env.NODE_ENV === "production") {
    console.error(`${prefix}: ${message}`);
    return;
  }
  console.error(`${prefix}: ${message}`, error?.stack || args.error);
}

function isClientAbortError(error: unknown, event: H3Event): boolean {
  const err = error as any;
  const message = typeof err?.message === "string" ? err.message : "";
  const code = typeof err?.code === "string" ? err.code : "";
  const node = (event as any).node;
  return (
    message === "aborted" ||
    code === "ECONNRESET" ||
    node?.req?.destroyed === true ||
    node?.res?.destroyed === true
  );
}

function debugClientAbort(args: {
  method: string | undefined;
  route: string;
  error: unknown;
}): void {
  if (process.env.NODE_ENV === "production") return;
  const err = args.error as any;
  const message = err?.message || String(args.error);
  console.debug?.(
    `[agent-native] ${args.method ?? ""} ${args.route} aborted by client: ${message}`,
  );
}

export async function awaitPluginsReady(
  nitroApp: any,
  reqPath?: string,
  options: { skipUnscoped?: boolean } = {},
): Promise<void> {
  const entries = nitroApp[PLUGIN_READY_KEY] as PluginReadyEntry[] | undefined;
  if (!entries?.length) return;

  const relevant = reqPath
    ? entries.filter(
        (entry) =>
          !(options.skipUnscoped && !entry.paths?.length) &&
          !entry.excludedPaths?.some((path) =>
            resolveMountMatch(reqPath, path),
          ) &&
          (entry.paths?.length
            ? entry.paths.some((path) => resolveMountMatch(reqPath, path))
            : true),
      )
    : entries;

  if (relevant.length) {
    await Promise.all(relevant.map((entry) => entry.promise));
    const completed = new Set(relevant);
    const latest =
      (nitroApp[PLUGIN_READY_KEY] as PluginReadyEntry[] | undefined) ?? [];
    nitroApp[PLUGIN_READY_KEY] = latest.filter(
      (entry) => !completed.has(entry),
    );
  }
}

function registerMiddleware(
  nitroApp: any,
  path: string,
  handler: EventHandler,
  options: { prepend?: boolean } = {},
) {
  const h3 = nitroApp.h3;
  if (!h3 || !Array.isArray(h3["~middleware"])) {
    throw new Error(
      "[agent-native] Cannot register route: nitroApp.h3 is not available. " +
        "Make sure you're calling getH3App() from inside a Nitro plugin.",
    );
  }

  const middleware = async (event: H3Event, next: () => any) => {
    let originalPathname: string | undefined;
    let originalEventPath: string | undefined;
    let hadEventPath = false;
    // sequence, e.g. security-headers + CORS + CSRF, would wipe event.path
    let didStripPath = false;
    const restoreOriginalPath = () => {
      if (!didStripPath) return;
      if (originalPathname !== undefined) {
        try {
          event.url.pathname = originalPathname;
        } catch {
          // ignore
        }
        originalPathname = undefined;
      }
      if (hadEventPath) {
        try {
          (event as any).path = originalEventPath;
        } catch {
          // ignore
        }
      } else {
        try {
          delete (event as any).path;
        } catch {
          // ignore
        }
      }
    };
    if (path) {
      const reqPath = event.url?.pathname ?? "";
      const match = resolveMountMatch(reqPath, path);
      if (!match) {
        return next();
      }
      const eventAny = event as any;
      hadEventPath = "path" in eventAny;
      originalEventPath = eventAny.path;
      didStripPath = true;
      try {
        originalPathname = event.url.pathname;
        eventAny.context = eventAny.context ?? {};
        eventAny.context._mountedPathname = originalPathname;
        eventAny.context._mountPrefix = match.mountPath;
        event.url.pathname = match.strippedPath;
        eventAny.path = `${match.strippedPath}${event.url.search || ""}`;
      } catch {
        // event.url is read-only on some runtimes — fall through. Handlers
        // that don't depend on prefix stripping (most of them) still work.
      }
    }
    try {
      const result = await handler(event);
      if (result === undefined) {
        restoreOriginalPath();
        return next();
      }
      return result;
    } catch (err) {
      const reqPath = originalPathname ?? event.url?.pathname ?? "";
      const e = err as any;
      const status =
        typeof e?.statusCode === "number"
          ? e.statusCode
          : typeof e?.status === "number"
            ? e.status
            : 500;
      if (isClientAbortError(err, event)) {
        debugClientAbort({ method: event.method, route: reqPath, error: err });
        return undefined;
      }
      logFrameworkRouteError({
        method: event.method,
        route: reqPath,
        status,
        error: err,
      });
      if (status >= 500) {
        captureError(err, {
          route: reqPath,
          method: event.method,
          tags: { status_code: String(status) },
          userAgent: (() => {
            try {
              return event.headers?.get("user-agent") ?? undefined;
            } catch {
              return undefined;
            }
          })(),
        });
      }
      try {
        setResponseStatus(event, status);
        setResponseHeader(event, "content-type", "application/json");
      } catch {
        // Response already sent — best effort.
      }
      return {
        error: e?.message || "Internal server error",
        ...(status >= 500 &&
        process.env.AGENT_NATIVE_DEBUG_ERRORS === "1" &&
        e?.stack
          ? { stack: e.stack }
          : {}),
      };
    } finally {
      restoreOriginalPath();
    }
  };

  if (options.prepend) {
    h3["~middleware"].unshift(middleware);
  } else {
    h3["~middleware"].push(middleware);
  }
}

async function bootstrapDefaultPlugins(nitroApp: any): Promise<void> {
  IN_BOOTSTRAP.add(nitroApp);
  try {
    const cwd = process.cwd();
    const discoveredMissing = await getMissingDefaultPlugins(cwd);
    const provided = nitroApp[PROVIDED_PLUGIN_STEMS_KEY] as
      | Set<string>
      | undefined;
    const undiscovered = provided
      ? discoveredMissing.filter((stem) => !provided.has(stem))
      : discoveredMissing;
    const disabled: readonly string[] = getDisabledDefaultPlugins();
    const missing = undiscovered.filter((stem) => !disabled.includes(stem));
    const refused = undiscovered.filter((stem) => disabled.includes(stem));
    if (missing.length === 0) return;

    const serverModule = await import("./index.js");
    const terminalModule = await import("../terminal/terminal-plugin.js");
    const integrationsModule = await import("../integrations/plugin.js");
    const contextXrayModule = await import("../agent/context-xray/plugin.js");
    const observationalMemoryModule =
      await import("../agent/observational-memory/plugin.js");
    const orgModule = await import("../org/plugin.js");
    const onboardingModule = await import("../onboarding/plugin.js");

    const frameworkImpls: Record<
      string,
      ((nitroApp: any) => void | Promise<void>) | undefined
    > = {
      "agent-chat": (serverModule as any).defaultAgentChatPlugin,
      auth: (serverModule as any).defaultAuthPlugin,
      "context-xray": (contextXrayModule as any).defaultContextXrayPlugin,
      "core-routes": (serverModule as any).defaultCoreRoutesPlugin,
      integrations: (integrationsModule as any).defaultIntegrationsPlugin,
      "observational-memory": (observationalMemoryModule as any)
        .defaultObservationalMemoryPlugin,
      onboarding: (onboardingModule as any).defaultOnboardingPlugin,
      org: (orgModule as any).defaultOrgPlugin,
      resources: (serverModule as any).defaultResourcesPlugin,
      sentry: (serverModule as any).defaultSentryPlugin,
      terminal: (terminalModule as any).defaultTerminalPlugin,
    };

    let workspaceImpls: Record<
      string,
      ((nitroApp: any) => void | Promise<void>) | undefined
    > = {};
    try {
      const { getWorkspaceCoreExports } =
        await import("../deploy/workspace-core.js");
      const ws = await getWorkspaceCoreExports(cwd);
      if (ws && Object.keys(ws.plugins).length > 0) {
        try {
          const wsServerModule = await loadWorkspaceCoreServer(
            ws.packageName,
            ws.packageDir,
          );
          for (const [slot, exportName] of Object.entries(ws.plugins)) {
            if (!exportName) continue;
            const impl = (wsServerModule as any)[exportName];
            if (typeof impl === "function") {
              workspaceImpls[slot] = impl;
            }
          }
          if (process.env.DEBUG) {
            console.log(
              `[agent-native] Workspace core ${ws.packageName} provides plugin slots: ${Object.keys(workspaceImpls).join(", ")}`,
            );
          }
        } catch (e) {
          const msg = (e as Error).message ?? "";
          const tsLoadHint = /\.js' imported from .*\.ts/.test(msg)
            ? " — workspace-core src is TypeScript but isn't being compiled. " +
              "Run `pnpm --filter " +
              ws.packageName +
              " build` and point its `./server` export at dist/server/index.js."
            : "";
          console.warn(
            `[agent-native] Failed to load workspace core ${ws.packageName}/server: ${msg}${tsLoadHint}`,
          );
        }
      }
    } catch {
      // Workspace shared package isn't available (e.g. running on an edge
      // runtime without fs). Silently fall through to framework defaults.
    }

    if (process.env.DEBUG)
      console.log(
        `[agent-native] Auto-mounting ${missing.length} default plugin(s): ${missing.join(", ")}` +
          (refused.length > 0
            ? ` (refused by plugins.disabled: ${refused.join(", ")})`
            : ""),
      );

    for (const stem of missing) {
      const impl = workspaceImpls[stem] ?? frameworkImpls[stem];
      if (typeof impl === "function") {
        try {
          await impl(nitroApp);
        } catch (e) {
          console.warn(
            `[agent-native] Failed to auto-mount default plugin ${stem}:`,
            (e as Error).message,
          );
          captureError(e, {
            route: "default-plugin-bootstrap",
            tags: { phase: "default-plugin-bootstrap", plugin: stem },
          });
          if (e instanceof AppConfigurationError) throw e;
        }
      }
    }
  } finally {
    IN_BOOTSTRAP.delete(nitroApp);
  }
}

export async function loadWorkspaceCoreServer(
  packageName: string,
  packageDir: string,
): Promise<any> {
  let firstErr: unknown;
  try {
    return await import(/* @vite-ignore */ `${packageName}/server`);
  } catch (e) {
    firstErr = e;
  }

  try {
    const { createJiti } = await import("jiti");
    const { pathToFileURL } = await import("node:url");
    const path = await import("node:path");
    const anchor = pathToFileURL(
      path.join(packageDir, "package.json"),
    ).toString();
    const jiti = createJiti(anchor, { interopDefault: true });
    return await jiti.import(`${packageName}/server`);
  } catch (jitiErr) {
    throw firstErr ?? jitiErr;
  }
}

export { FRAMEWORK_PREFIX };
