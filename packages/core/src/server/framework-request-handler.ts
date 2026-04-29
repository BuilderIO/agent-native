/**
 * Framework request handler — registers framework routes on Nitro's h3 instance.
 *
 * Nitro 3 exposes its h3 app as `nitroApp.h3`. We register framework routes
 * directly on it as middleware (`nitroApp.h3["~middleware"]`), giving each
 * plugin a path-prefix-matched handler that runs before any file-based route.
 *
 * Plugins call `getH3App(nitroApp).use(path, handler)` exactly like h3 v1's
 * `app.use()` — the wrapper translates that into v2 middleware registration.
 *
 * Default plugins that the template doesn't provide are auto-mounted on the
 * first call to `getH3App()` per nitroApp instance.
 */
import type { EventHandler, H3Event } from "h3";
import { setResponseHeader, setResponseStatus } from "h3";
import { getMissingDefaultPlugins } from "../deploy/route-discovery.js";

const BOOTSTRAPPED = new WeakSet<object>();
const IN_BOOTSTRAP = new WeakSet<object>();
const FRAMEWORK_PREFIX = "/_agent-native";
const APP_SHIM_KEY = "_agentNativeH3Shim";
const BOOTSTRAP_PROMISE_KEY = "_agentNativeBootstrapPromise";
const PLUGIN_READY_KEY = "_agentNativePluginReadyPromise";

/**
 * Wrapper around Nitro's h3 instance that exposes a v1-style `.use()` API
 * for registering path-prefix middleware.
 */
export interface H3AppShim {
  use(path: string, handler: EventHandler): void;
  use(handler: EventHandler): void;
}

/**
 * Get (or create) the shared H3 app wrapper for a nitroApp. Plugins use this
 * to register routes via `.use(path, handler)`.
 *
 * On the first call per nitroApp, we kick off auto-mounting any missing
 * default plugins. User-facing plugin factories (createAgentChatPlugin,
 * createAuthPlugin, etc.) await this bootstrap via `awaitBootstrap()` so the
 * default plugins finish registering middleware before requests arrive.
 */
export function getH3App(nitroApp: any): H3AppShim {
  if (!nitroApp) throw new Error("getH3App: nitroApp is required");

  // Reuse the cached shim if we've wrapped this nitroApp before
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
    nitroApp[BOOTSTRAP_PROMISE_KEY] = bootstrapDefaultPlugins(nitroApp).catch(
      (err) => {
        console.warn(
          "[agent-native] Failed to auto-mount default plugins:",
          (err as Error).message,
        );
      },
    );

    // Readiness gate: Nitro v3 doesn't await async plugins, so routes
    // registered inside an async plugin may not exist when the first
    // request arrives. This middleware holds /_agent-native requests
    // until all tracked plugin inits complete.
    registerMiddleware(nitroApp, FRAMEWORK_PREFIX, (async (event: H3Event) => {
      await awaitPluginsReady(nitroApp);
      // Fall through — the actual route handler runs next.
      return undefined;
    }) as EventHandler);
  }

  return shim;
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
  // Trigger bootstrap if it hasn't been already (idempotent — getH3App
  // creates the shim and kicks off bootstrap on first call).
  getH3App(nitroApp);
  const promise = nitroApp[BOOTSTRAP_PROMISE_KEY];
  if (promise) await promise;
}

/**
 * Track an async plugin's initialization promise. Nitro v3 calls plugins
 * synchronously and doesn't await async return values, so routes registered
 * inside an async plugin may not be ready when the first request arrives.
 *
 * Call this from the TOP of any async plugin so that the readiness gate
 * (installed by getH3App) can hold /_agent-native requests until the plugin
 * finishes mounting its routes.
 */
export function trackPluginInit(nitroApp: any, promise: Promise<void>): void {
  if (!nitroApp) return;
  // Attach a no-op catch so the promise doesn't surface as an unhandled
  // rejection when Nitro v3 drops the async return value. The actual error
  // is still observable when awaitPluginsReady() re-awaits the promise.
  const safe = promise.catch((err) => {
    console.error(
      "[agent-native] Plugin init failed:",
      (err as Error).message || err,
    );
  });
  const existing = nitroApp[PLUGIN_READY_KEY] as Promise<void>[] | undefined;
  if (existing) {
    existing.push(safe);
  } else {
    nitroApp[PLUGIN_READY_KEY] = [safe];
  }
}

/**
 * Await all tracked plugin initializations. Called by the readiness gate
 * middleware before dispatching framework routes.
 */
export async function awaitPluginsReady(nitroApp: any): Promise<void> {
  const promises = nitroApp[PLUGIN_READY_KEY] as Promise<void>[] | undefined;
  if (promises?.length) {
    await Promise.all(promises);
    nitroApp[PLUGIN_READY_KEY] = [];
  }
}

/**
 * Register a path-prefix middleware on Nitro's h3 instance.
 *
 * The middleware:
 *   - Returns `next()` (continues) if the request path doesn't match.
 *   - Otherwise dispatches to the handler. If the handler returns a value,
 *     it short-circuits the request. If it returns undefined, next() runs.
 *
 * Path matching emulates h3 v1's `app.use(path, ...)` behavior:
 *   - Exact-match prefix: `/foo` matches `/foo`, `/foo/bar`, but not `/foobar`
 *   - Empty path: middleware runs on every request
 */
function registerMiddleware(
  nitroApp: any,
  path: string,
  handler: EventHandler,
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
    if (path) {
      const reqPath = event.url?.pathname ?? "";
      if (reqPath !== path && !reqPath.startsWith(path + "/")) {
        return next();
      }
      // Strip the mount prefix from event.url.pathname so handlers that
      // dispatch sub-routes can read `event.path` (or `event.url.pathname`)
      // and see the path RELATIVE to their mount point — matching h3 v1's
      // `app.use(path, handler)` semantics.
      try {
        originalPathname = event.url.pathname;
        const stripped = originalPathname.slice(path.length) || "/";
        event.url.pathname = stripped;
      } catch {
        // event.url is read-only on some runtimes — fall through. Handlers
        // that don't depend on prefix stripping (most of them) still work.
      }
    }
    try {
      const result = await handler(event);
      if (result === undefined) {
        // Restore the original pathname BEFORE calling next() so downstream
        // middleware sees the full URL — not the stripped mount-relative path.
        // Matches h3 v2's own sub-app middleware pattern where the restore
        // happens inside the next() callback, not after it returns.
        if (originalPathname !== undefined) {
          try {
            event.url.pathname = originalPathname;
          } catch {
            // ignore
          }
          originalPathname = undefined;
        }
        return next();
      }
      return result;
    } catch (err) {
      // Log 500s to the server console so they're debuggable, and respond
      // with JSON instead of the default HTML error page so clients can
      // surface error messages. This only applies to routes mounted under
      // the framework prefix (or middleware mounted at `/`, for which we
      // still want visibility).
      const reqPath = originalPathname ?? event.url?.pathname ?? "";
      const e = err as any;
      const status =
        typeof e?.statusCode === "number"
          ? e.statusCode
          : typeof e?.status === "number"
            ? e.status
            : 500;
      console.error(
        `[agent-native] ${event.method ?? ""} ${reqPath} failed (${status}):`,
        e?.stack || e?.message || e,
      );
      try {
        setResponseStatus(event, status);
        setResponseHeader(event, "content-type", "application/json");
      } catch {
        // Response already sent — best effort.
      }
      return {
        error: e?.message || "Internal server error",
        ...(status >= 500 && process.env.NODE_ENV !== "production" && e?.stack
          ? { stack: e.stack }
          : {}),
      };
    } finally {
      // Restore the original pathname so downstream middleware sees the
      // full URL.
      if (originalPathname !== undefined) {
        try {
          event.url.pathname = originalPathname;
        } catch {
          // ignore
        }
      }
    }
  };

  h3["~middleware"].push(middleware);
}

/**
 * Auto-mount any default framework plugins that the template doesn't provide.
 *
 * Runs once per nitroApp on the first `getH3App()` call. Uses route-discovery
 * to find which default plugin stems are missing from `server/plugins/`, then
 * dynamically imports and mounts them. If a workspace core is present in the
 * ancestor chain, plugin slots the workspace core exports are mounted from
 * there instead of from @agent-native/core — this is the middle layer of the
 * three-layer inheritance model (app local > workspace core > framework).
 */
async function bootstrapDefaultPlugins(nitroApp: any): Promise<void> {
  IN_BOOTSTRAP.add(nitroApp);
  try {
    const cwd = process.cwd();
    const missing = await getMissingDefaultPlugins(cwd);
    if (missing.length === 0) return;

    // Lazy import to avoid circular dependency at module load time
    const serverModule = await import("./index.js");
    const terminalModule = await import("../terminal/terminal-plugin.js");
    const integrationsModule = await import("../integrations/plugin.js");
    const orgModule = await import("../org/plugin.js");
    const onboardingModule = await import("../onboarding/plugin.js");

    const frameworkImpls: Record<
      string,
      ((nitroApp: any) => void | Promise<void>) | undefined
    > = {
      "agent-chat": (serverModule as any).defaultAgentChatPlugin,
      auth: (serverModule as any).defaultAuthPlugin,
      "core-routes": (serverModule as any).defaultCoreRoutesPlugin,
      integrations: (integrationsModule as any).defaultIntegrationsPlugin,
      onboarding: (onboardingModule as any).defaultOnboardingPlugin,
      org: (orgModule as any).defaultOrgPlugin,
      resources: (serverModule as any).defaultResourcesPlugin,
      terminal: (terminalModule as any).defaultTerminalPlugin,
    };

    // Workspace core layer: if the app is inside an enterprise monorepo with
    // `agent-native.workspaceCore` configured, pull in any plugin slots the
    // workspace core exports from its server entry. We dynamically import the
    // workspace core package at runtime.
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
          // Common cause: workspace-core's package.json points "./server"
          // at a TS source file (the scaffold default), but Node can't
          // resolve relative `.js` imports inside it without a TS loader.
          // Tell the user to compile to dist/ rather than just dumping the
          // raw resolution error.
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
      // Workspace core module isn't available (e.g. running on an edge
      // runtime without fs). Silently fall through to framework defaults.
    }

    if (process.env.DEBUG)
      console.log(
        `[agent-native] Auto-mounting ${missing.length} default plugin(s): ${missing.join(", ")}`,
      );

    for (const stem of missing) {
      // Prefer workspace-core impl over framework default when both exist.
      const impl = workspaceImpls[stem] ?? frameworkImpls[stem];
      if (typeof impl === "function") {
        try {
          await impl(nitroApp);
        } catch (e) {
          console.warn(
            `[agent-native] Failed to auto-mount default plugin ${stem}:`,
            (e as Error).message,
          );
        }
      }
    }
  } finally {
    IN_BOOTSTRAP.delete(nitroApp);
  }
}

/**
 * Load a workspace-core's `/server` entry, transparently handling TS source.
 *
 * The scaffolded workspace-core template ships TS sources without a build
 * step (exports point at `./src/server/index.ts`), so plain `await import()`
 * blows up the moment Node hits a relative `.js` import inside (the standard
 * TS ESM convention). Try Node's plain `import()` first — fastest path when
 * the user has compiled to dist/ — then fall back to jiti, which handles TS
 * source files and re-maps the `.js` ESM extension convention back to `.ts`
 * at resolve time.
 *
 * Edge runtimes without `fs` won't be able to load jiti at all; the outer
 * try/catch silently falls through to framework defaults in that case.
 */
async function loadWorkspaceCoreServer(
  packageName: string,
  packageDir: string,
): Promise<any> {
  try {
    return await import(/* @vite-ignore */ `${packageName}/server`);
  } catch (firstErr) {
    const msg = (firstErr as Error)?.message ?? "";
    const looksLikeTsResolution =
      /\.js' imported from .*\.ts/.test(msg) ||
      /Cannot find module .*\.js' imported/.test(msg) ||
      /Unknown file extension "\.ts"/.test(msg);
    if (!looksLikeTsResolution) throw firstErr;

    const { createJiti } = await import("jiti");
    const { pathToFileURL } = await import("node:url");
    const path = await import("node:path");
    // Anchor jiti to a real file inside the workspace-core package so its
    // module resolution starts in the right node_modules tree (handles pnpm
    // hoisting and linked workspaces).
    const anchor = pathToFileURL(
      path.join(packageDir, "package.json"),
    ).toString();
    const jiti = createJiti(anchor, { interopDefault: true });
    return await jiti.import(`${packageName}/server`);
  }
}

export { FRAMEWORK_PREFIX };
