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
import { polyfillH3Event } from "./h3-polyfill.js";
import {
  DEFAULT_PLUGIN_REGISTRY,
  getMissingDefaultPlugins,
} from "../deploy/route-discovery.js";
import {
  defaultCoreRoutesPlugin,
  defaultResourcesPlugin,
  defaultAuthPlugin,
  defaultAgentChatPlugin,
} from "./index.js";
import { defaultTerminalPlugin } from "../terminal/terminal-plugin.js";
import { defaultIntegrationsPlugin } from "../integrations/plugin.js";

// Lazy getter to avoid circular dependency issues when bundled.
// Module-level constants referencing re-exported functions can fail
// if the bundler evaluates the object before the imports are initialized.
function getDefaultPluginImplementations(): Record<
  string,
  (nitroApp: any) => void | Promise<void>
> {
  return {
    "agent-chat": defaultAgentChatPlugin,
    auth: defaultAuthPlugin,
    "core-routes": defaultCoreRoutesPlugin,
    integrations: defaultIntegrationsPlugin,
    resources: defaultResourcesPlugin,
    terminal: defaultTerminalPlugin,
  };
}

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
  // Check for an existing H3 app reference on the nitroApp
  let h3 = nitroApp.h3App || nitroApp.h3 || nitroApp._h3;

  // If none exists, create a shim object and store it on nitroApp so
  // all plugins that call getH3App(nitroApp) get the same instance.
  if (!h3) {
    h3 = {};
    nitroApp._h3 = h3;
  }

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
    const missing = await getMissingDefaultPlugins(cwd);
    if (missing.length > 0) {
      console.log(
        `[agent-native] Auto-mounted ${missing.length} default plugin(s): ${missing.join(", ")}`,
      );
    }

    for (const stem of missing) {
      const impl = getDefaultPluginImplementations()[stem];
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
function matchRoute(requestPath: string): {
  handler: EventHandler;
  params: Record<string, string>;
  path: string;
} | null {
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
      return { handler: route.handler, params, path: route.path };
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

  // Polyfill v2 events with v1-compatible shape (event.node, event.web,
  // event._requestBody). The framework's handlers and h3 v1 helpers all
  // read from event.node.req which is undefined on web runtimes.
  await polyfillH3Event(event);

  const url =
    event.node?.req?.url ??
    event.req?.url ??
    event.path ??
    event.url?.href ??
    "";
  // event.node.req.url is already path+search; event.req.url may be a full URL.
  let pathOnly = url;
  try {
    if (pathOnly && /^https?:\/\//i.test(pathOnly)) {
      const u = new URL(pathOnly);
      pathOnly = u.pathname + u.search;
    }
  } catch {
    // leave as-is
  }
  const path = pathOnly.split("?")[0];

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
    // Emulate H3 v1's app.use() behavior: strip the matched base path from
    // event.path so handlers see a path relative to their mount point.
    // Without this, handlers that inspect event.path (e.g. routers, thread
    // handlers) would see the full URL and fail to route correctly.
    // In H3 >=1.15, event.path is a getter-only property on the prototype,
    // so we shadow it with an instance-level value property, then delete
    // the shadow to restore the prototype getter.
    // Preserve the query string so getQuery(event) still works in H3 v1
    // (which reads query params from event.path).
    const queryIdx = url.indexOf("?");
    const queryString = queryIdx !== -1 ? url.slice(queryIdx) : "";
    const remainder = (path.slice(match.path.length) || "/") + queryString;
    Object.defineProperty(event, "path", {
      value: remainder,
      configurable: true,
      writable: true,
    });
    try {
      return await match.handler(event);
    } finally {
      // Remove instance shadow to restore prototype getter
      delete (event as any).path;
    }
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
