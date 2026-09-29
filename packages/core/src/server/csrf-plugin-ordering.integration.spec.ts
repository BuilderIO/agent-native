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
    process.env.DATABASE_URL = `pglite:${join(tempDir, "csrf-order")}`;
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

    const actionsPlugin = createDelayedActionsPlugin();
    actionsPlugin(nitroApp);
    const corePluginDone = createCoreRoutesPlugin()(nitroApp);

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
