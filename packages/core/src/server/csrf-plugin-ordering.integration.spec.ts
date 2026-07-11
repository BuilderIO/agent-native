/**
 * Regression test for a CSRF-vs-action-routes registration race.
 *
 * Real deployments mount `core-routes-plugin.ts` (registers CSRF — see
 * `csrf.ts`) and `agent-chat-plugin.ts` (mounts action routes under
 * `/_agent-native/actions/*` via `mountActionRoutes`) as TWO SEPARATE,
 * independently-async-initialized Nitro plugin files (e.g.
 * `templates/content/server/plugins/core-routes.ts` and `agent-chat.ts`),
 * with no explicit ordering between them. Each plugin's own async init chain
 * (DB reads, dynamic imports, action discovery) resolves on its own
 * schedule, so which plugin's `getH3App(nitroApp).use(...)` call actually
 * lands in Nitro's h3 middleware array FIRST is not guaranteed by plugin
 * file order alone.
 *
 * `createCsrfMiddleware` is now registered synchronously inside
 * `getH3App()`'s own one-time bootstrap (framework-request-handler.ts) —
 * NOT inside `createCoreRoutesPlugin`'s async init — specifically so it is
 * always the first non-prepended middleware pushed onto the array for a
 * given nitroApp, regardless of which plugin happens to call `getH3App()`
 * first or how their async chains interleave. This test mounts a
 * core-routes-plugin-like CSRF registration and an agent-chat-plugin-like
 * action-route registration in the ADVERSARIAL order (the action-mounting
 * plugin invoked first, with core-routes-plugin's own async work — real DB
 * reads, dynamic imports — running after it) and asserts CSRF still wins:
 * a cookie-carrying "simple request" POST (no preflight, no first-party
 * marker) to a real, reachable action route is rejected with 403 rather
 * than reaching the action handler.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { ActionEntry } from "../agent/production-agent.js";
import { closeDbExec } from "../db/client.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";
import {
  awaitBootstrap,
  markDefaultPluginProvided,
  trackPluginInit,
} from "./framework-request-handler.js";

vi.mock("../deploy/route-discovery.js", () => ({
  getMissingDefaultPlugins: vi.fn(async () => []),
}));

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

interface DispatchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

// Copied from embedded.integration.spec.ts's dispatch() helper, per Task C's
// instructions — but callers here explicitly set Content-Type themselves for
// the adversarial "simple request" case, overriding the application/json
// default below.
async function dispatch(
  nitroApp: any,
  pathname: string,
  { method = "GET", body, headers = {} }: DispatchOptions = {},
) {
  const url = `https://host.test${pathname}`;
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }
  const req = new Request(url, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const responseHeaders = new Headers();
  const event = {
    method,
    url: new URL(url),
    path: pathname,
    context: {},
    req,
    headers: requestHeaders,
    res: {
      status: 200,
      headers: responseHeaders,
    },
    node: {
      req: {
        method,
        url: pathname,
        headers: Object.fromEntries(
          Array.from(requestHeaders.entries()).map(([key, value]) => [
            key.toLowerCase(),
            value,
          ]),
        ),
      },
      res: {
        statusCode: 200,
        setHeader(name: string, value: string) {
          responseHeaders.set(name, value);
        },
      },
    },
  };

  let index = 0;
  const next = async (): Promise<unknown> => {
    const middleware = nitroApp.h3["~middleware"][index++];
    if (!middleware) return { fellThrough: true };
    return middleware(event, next);
  };

  const result = await next();
  return {
    body: result,
    status: event.res.status ?? event.node.res.statusCode,
    headers: responseHeaders,
  };
}

/**
 * A minimal stand-in for `createAgentChatPlugin`'s own registration shape:
 * a SYNCHRONOUS Nitro plugin factory that immediately tracks its async init
 * (`trackPluginInit`, with `/_agent-native/actions` in its paths — exactly
 * like the real plugin, see agent-chat-plugin.ts) and only mounts its real
 * action route (via the SAME `mountActionRoutes` the real plugin calls)
 * after real async work. Using the actual `mountActionRoutes` keeps this a
 * genuine "route reachable" test rather than a stub.
 */
function createDelayedActionsPlugin(): (nitroApp: any) => void {
  return (nitroApp: any) => {
    markDefaultPluginProvided(nitroApp, "agent-chat");
    const initPromise = (async () => {
      await awaitBootstrap(nitroApp);
      const { mountActionRoutes } = await import("./action-routes.js");
      const actions: Record<string, ActionEntry> = {
        "host-echo": {
          tool: {
            description: "Echo params",
            parameters: { type: "object", properties: {} },
          },
          run: async (params: Record<string, unknown>) => ({
            ok: true,
            params,
          }),
        },
      };
      mountActionRoutes(nitroApp, actions);
    })();
    trackPluginInit(nitroApp, initPromise, {
      paths: ["/_agent-native/actions"],
    });
  };
}

describe("CSRF vs. independently-initialized action-route plugin (registration-order regression)", () => {
  let tempDir = "";
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-native-csrf-order-"));
    process.env.DATABASE_URL = `file:${join(tempDir, "csrf-order.db")}`;
  });

  afterAll(async () => {
    await closeDbExec();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("blocks a cookie-carrying simple-request POST to a real action route even when the action-mounting plugin is invoked BEFORE core-routes-plugin", async () => {
    const nitroApp = createNitroApp();

    // Adversarial order: the action-mounting plugin runs first; nothing here
    // awaits either plugin before we start dispatching, mirroring how Nitro
    // invokes (but does not sequentially await) separate plugin files.
    const actionsPlugin = createDelayedActionsPlugin();
    actionsPlugin(nitroApp);
    const corePluginDone = createCoreRoutesPlugin()(nitroApp);

    // Sanity check: a legitimate first-party JSON POST still reaches the
    // real action and succeeds once routes are up — proving the route is
    // genuinely reachable, not just absent (which would trivially "block"
    // everything regardless of CSRF).
    await expect(
      dispatch(nitroApp, "/_agent-native/actions/host-echo", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: { value: "ok" },
      }),
    ).resolves.toMatchObject({ status: 200, body: { ok: true } });

    // The regression check: a cookie-carrying "simple request" (no preflight,
    // no first-party marker) must be rejected by CSRF before it ever reaches
    // the action handler.
    await expect(
      dispatch(nitroApp, "/_agent-native/actions/host-echo", {
        method: "POST",
        headers: { "Content-Type": "text/plain", cookie: "an_session=abc" },
        body: { value: "attack" },
      }),
    ).resolves.toMatchObject({ status: 403 });

    await corePluginDone;
  });
});
