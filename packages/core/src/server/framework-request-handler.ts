/**
 * Framework request handler for Nitro 3.
 *
 * Provides a compatibility layer so existing plugins can still call
 * `app.use(path, handler)` to register routes. The routes are stored
 * in a registry and dispatched by a single Nitro catch-all route file.
 *
 * This replaces devApiServer's programmatic H3 mounting with a pattern
 * that works with Nitro 3's file-based routing + H3 v2.
 */
import {
  createApp,
  createRouter,
  defineEventHandler,
  toNodeListener,
  getMethod,
} from "h3";
import type { EventHandler } from "h3";
import {
  DEFAULT_PLUGIN_REGISTRY,
  getMissingDefaultPlugins,
} from "../deploy/route-discovery.js";
import {
  defaultCoreRoutesPlugin,
  defaultResourcesPlugin,
  defaultFileSyncPlugin,
  defaultAuthPlugin,
  defaultAgentChatPlugin,
} from "./index.js";
import { defaultTerminalPlugin } from "../terminal/terminal-plugin.js";

const DEFAULT_PLUGIN_IMPLEMENTATIONS: Record<
  string,
  (nitroApp: any) => void | Promise<void>
> = {
  "agent-chat": defaultAgentChatPlugin,
  auth: defaultAuthPlugin,
  "core-routes": defaultCoreRoutesPlugin,
  "file-sync": defaultFileSyncPlugin,
  resources: defaultResourcesPlugin,
  terminal: defaultTerminalPlugin,
};

/**
 * A fake "app" object that plugins can call .use() on.
 * Instead of actually mounting on an H3 instance, it stores
 * the routes in a registry for the catch-all to dispatch.
 */
interface RouteEntry {
  path: string;
  handler: EventHandler;
}

let routes: RouteEntry[] = [];
let middlewares: EventHandler[] = [];
let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Get the H3 app from a nitroApp, adding a `.use()` compatibility shim
 * for H3 v2 (which removed `app.use()`). Routes registered via `.use()`
 * are stored in the framework registry and dispatched by the catch-all.
 *
 * This is the function ALL plugins should use to get the H3 instance.
 */
export function getH3App(nitroApp: any): any {
  const h3 = nitroApp.h3App || nitroApp.h3 || nitroApp._h3 || {};

  // If H3 v2 (no .use method), add our shim
  if (typeof h3.use !== "function") {
    h3.use = (pathOrHandler: string | EventHandler, handler?: EventHandler) => {
      if (typeof pathOrHandler === "function") {
        middlewares.push(pathOrHandler);
      } else if (handler) {
        routes.push({ path: pathOrHandler, handler });
      }
    };
  }

  return h3;
}

/**
 * Initialize default framework plugins that the template doesn't provide.
 * Called lazily on first framework request.
 *
 * Template-provided plugins (in server/plugins/) are loaded by Nitro directly.
 * This only handles defaults that are MISSING from the template.
 */
async function ensureInitialized() {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const cwd = process.cwd();

    // Create a fake nitroApp whose h3 routes to our registry
    const fakeNitroApp: any = {};
    // getH3App will add .use() shim since there's no real h3 instance
    getH3App(fakeNitroApp);

    // Auto-mount defaults for plugins the template doesn't provide
    const missing = getMissingDefaultPlugins(cwd);
    if (missing.length > 0) {
      console.log(
        `[agent-native] Auto-mounted ${missing.length} default plugin(s): ${missing.join(", ")}`,
      );
    }

    for (const stem of missing) {
      const impl = DEFAULT_PLUGIN_IMPLEMENTATIONS[stem];
      if (typeof impl === "function") {
        try {
          await impl(fakeNitroApp);
        } catch (e) {
          console.warn(
            `[agent-native] Failed to auto-mount default plugin ${stem}:`,
            (e as Error).message,
          );
        }
      }
    }

    initialized = true;
  })();

  return initPromise;
}

/**
 * Match a request path against the registered routes.
 * Uses prefix matching (like H3 v1's app.use behavior).
 */
function matchRoute(
  requestPath: string,
): { handler: EventHandler; params: Record<string, string> } | null {
  // Sort routes by specificity (longest path first)
  const sorted = [...routes].sort((a, b) => b.path.length - a.path.length);

  for (const route of sorted) {
    // Handle parameterized paths like /_agent-native/application-state/:key
    const routeParts = route.path.split("/");
    const requestParts = requestPath.split("?")[0].split("/");

    // Check if the route could match (prefix matching)
    if (requestParts.length < routeParts.length) continue;

    let matches = true;
    const params: Record<string, string> = {};

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(":")) {
        params[routeParts[i].slice(1)] = requestParts[i];
      } else if (routeParts[i] !== requestParts[i]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return { handler: route.handler, params };
    }
  }

  return null;
}

/**
 * Handle a framework request. Called by the catch-all route file.
 * This is the main entry point exported from @agent-native/core/server.
 */
export async function handleFrameworkRequest(event: any): Promise<any> {
  await ensureInitialized();

  const url = event.node?.req?.url ?? event.path ?? "";
  const path = url.split("?")[0];

  // Run middlewares first
  for (const mw of middlewares) {
    try {
      const result = await mw(event);
      if (result !== undefined) return result;
    } catch {
      // Middleware didn't handle, continue
    }
  }

  // Match and dispatch to handler
  const match = matchRoute(path);
  if (match) {
    // Set params on the event context
    if (event.context) {
      event.context.params = { ...event.context.params, ...match.params };
    }
    return match.handler(event);
  }

  // No match — return 404
  if (event.node?.res) {
    event.node.res.statusCode = 404;
    return { error: "Not found" };
  }
  return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
}

/**
 * Register a route programmatically (for template-level plugins).
 * Templates can call this from their server/plugins/ files.
 */
export function registerFrameworkRoute(
  path: string,
  handler: EventHandler,
): void {
  routes.push({ path, handler });
}

/**
 * Register middleware (runs before route matching).
 */
export function registerFrameworkMiddleware(handler: EventHandler): void {
  middlewares.push(handler);
}

/**
 * Reset the handler registry (for testing).
 */
export function resetFrameworkHandlers(): void {
  routes = [];
  middlewares = [];
  initialized = false;
  initPromise = null;
}
