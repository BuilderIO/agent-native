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

    await expect(
      dispatch(nitroApp, "/_platform/actions/host-echo", {
        method: "POST",
        headers: { "Content-Type": "text/plain", cookie: "an_session=abc" },
        body: { value: "attack" },
      }),
    ).resolves.toMatchObject({ status: 403 });

    await expect(
      dispatch(nitroApp, "/_agent-native/actions/host-echo", {
        method: "POST",
        headers: { "X-Agent-Native-CSRF": "1" },
        body: { value: "leak" },
      }),
    ).resolves.toMatchObject({ status: 404, body: { error: "Not found" } });

    const rules = await dispatch(nitroApp, "/_platform/speculation-rules.json");
    expect(rules.body).not.toEqual({ fellThrough: true });
    expect(rules.status).toBe(200);

    await expect(
      dispatch(nitroApp, "/_platform/events", {
        headers: { accept: "text/event-stream" },
      }),
    ).resolves.toMatchObject({ status: 401 });

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
    const streamBody = stream instanceof Response ? stream.body : stream;
    if (streamBody instanceof ReadableStream) await streamBody.cancel();

    await corePluginDone;
  });
});
