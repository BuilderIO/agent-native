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
import { getMissingDefaultPlugins } from "../deploy/route-discovery.js";

const BOOTSTRAPPED = new WeakSet<object>();
const IN_BOOTSTRAP = new WeakSet<object>();
const FRAMEWORK_PREFIX = "/_agent-native";
const APP_SHIM_KEY = "_agentNativeH3Shim";
const BOOTSTRAP_PROMISE_KEY = "_agentNativeBootstrapPromise";

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
      return result === undefined ? next() : result;
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

    const frameworkImpls: Record<
      string,
      ((nitroApp: any) => void | Promise<void>) | undefined
    > = {
      "agent-chat": (serverModule as any).defaultAgentChatPlugin,
      auth: (serverModule as any).defaultAuthPlugin,
      "core-routes": (serverModule as any).defaultCoreRoutesPlugin,
      integrations: (integrationsModule as any).defaultIntegrationsPlugin,
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
          const wsServerModule = await import(
            /* @vite-ignore */ `${ws.packageName}/server`
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
          console.warn(
            `[agent-native] Failed to load workspace core ${ws.packageName}/server:`,
            (e as Error).message,
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

export { FRAMEWORK_PREFIX };
