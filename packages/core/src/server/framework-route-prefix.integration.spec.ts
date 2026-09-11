/**
 * The public framework route prefix, exercised through the real request
 * boundary: the actual core-routes plugin, the actual action mounting, the
 * CSRF middleware `getH3App()` registers, and the middleware chain Nitro
 * dispatches. A unit test of the path helpers proves the arithmetic; this
 * proves a deployment configured with `/_platform` serves actions and the
 * event stream there, classifies CSRF on that namespace, and no longer
 * answers on `/_agent-native`.
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

// The event stream resolves its caller through Better Auth's cookie session.
// Minting a real one needs the auth plugin and an email round-trip that add
// nothing to what is under test here, so only the session lookup is stubbed:
// the boundary, the route, and the CSRF middleware stay real.
vi.mock("./auth.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth.js")>();
  return {
    ...actual,
    getSession: vi.fn(async (event: any) => {
      const cookie: string = event?.headers?.get?.("cookie") ?? "";
      return cookie.includes("an_session=member")
        ? { email: "member@example.com" }
        : null;
    }),
  };
});

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
    res: { status: 200, headers: responseHeaders },
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
    event,
  };
}

function createActionsPlugin(): (nitroApp: any) => void {
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

describe("public framework route prefix through the real request boundary", () => {
  let tempDir = "";
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPrefix =
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-native-route-prefix-"));
    process.env.DATABASE_URL = `pglite:${join(tempDir, "route-prefix")}`;
    process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
      "/_platform";
  });

  afterAll(async () => {
    await closeDbExec();
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    if (originalPrefix === undefined) {
      delete process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX;
    } else {
      process.env.AGENT_NATIVE_CONFIG_RUNTIME_FRAMEWORK_ROUTE_PREFIX =
        originalPrefix;
    }
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves actions, the event stream, and CSRF on the public prefix only", async () => {
    const nitroApp = createNitroApp();
    createActionsPlugin()(nitroApp);
    const corePluginDone = createCoreRoutesPlugin()(nitroApp);

    // A first-party JSON POST reaches the real action under the public name.
    await expect(
      dispatch(nitroApp, "/_platform/actions/host-echo", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: { value: "ok" },
      }),
    ).resolves.toMatchObject({
      status: 200,
      body: { ok: true, params: { value: "ok" } },
    });

    // The CSRF classifier sees the internal name after the boundary, so a
    // cookie-carrying simple request is still refused on the public prefix.
    await expect(
      dispatch(nitroApp, "/_platform/actions/host-echo", {
        method: "POST",
        headers: { "Content-Type": "text/plain", cookie: "an_session=abc" },
        body: { value: "attack" },
      }),
    ).resolves.toMatchObject({ status: 403 });

    // The internal name is retired: it neither serves nor falls through to
    // whatever the app mounts after the framework.
    await expect(
      dispatch(nitroApp, "/_agent-native/actions/host-echo", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: { value: "leak" },
      }),
    ).resolves.toMatchObject({ status: 404, body: { error: "Not found" } });

    // A framework document with a file extension reaches the handler rather
    // than a static-file layer: the speculation rules the SSR shell requests.
    const rules = await dispatch(nitroApp, "/_platform/speculation-rules.json");
    expect(rules.body).not.toEqual({ fellThrough: true });
    expect(rules.status).toBe(200);

    // Protected routes stay protected under the public prefix: the change
    // event stream refuses an anonymous request...
    await expect(
      dispatch(nitroApp, "/_platform/events", {
        headers: { accept: "text/event-stream" },
      }),
    ).resolves.toMatchObject({ status: 401 });

    // ...and streams for a member, through the same boundary.
    const events = await dispatch(nitroApp, "/_platform/events", {
      headers: { accept: "text/event-stream", cookie: "an_session=member" },
    });
    const stream = events.body;
    const contentType =
      stream instanceof Response
        ? stream.headers.get("content-type")
        : events.headers.get("content-type");
    expect({ status: events.status, contentType }).toEqual({
      status: 200,
      contentType: expect.stringContaining("text/event-stream"),
    });
    if (stream instanceof Response) await stream.body?.cancel();

    await corePluginDone;
  });
});
