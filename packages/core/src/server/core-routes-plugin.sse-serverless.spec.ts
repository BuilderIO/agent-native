import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { closeDbExec } from "../db/client.js";
import { REALTIME_POLL_LIVE_QUERY_PARAM } from "../realtime-protocol.js";
import { createCoreRoutesPlugin } from "./core-routes-plugin.js";

const SERVERLESS_ENV_KEYS = [
  "NETLIFY",
  "NETLIFY_FUNCTION_NAME",
  "NETLIFY_LOCAL",
  "VERCEL",
  "AWS_LAMBDA_FUNCTION_NAME",
  "LAMBDA_TASK_ROOT",
  "CF_PAGES",
] as const;

function createNitroApp() {
  return { h3: { "~middleware": [] as any[] } };
}

async function dispatchEvents(nitroApp: any, query = "") {
  const url = `https://host.test/_agent-native/events${query}`;
  const responseHeaders = new Headers();
  const event = {
    method: "GET",
    url: new URL(url),
    path: "/_agent-native/events",
    context: {},
    req: new Request(url, { headers: { accept: "text/event-stream" } }),
    headers: new Headers({ accept: "text/event-stream" }),
    res: { status: 200, headers: responseHeaders },
    node: {
      req: { method: "GET", url: "/_agent-native/events", headers: {} },
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

  const body = await next();
  const status = event.res.status ?? event.node.res.statusCode;
  const contentType =
    body instanceof Response
      ? body.headers.get("content-type")
      : responseHeaders.get("content-type");
  return { body, status, contentType };
}

describe("SSE mount on a serverless runtime", () => {
  let tempDir = "";
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "agent-native-sse-serverless-"));
    process.env.DATABASE_URL = `pglite:${join(tempDir, "sse-serverless")}`;
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

  afterEach(() => {
    for (const key of SERVERLESS_ENV_KEYS) delete process.env[key];
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("answers 204 for a poll-live-aware request on a production serverless runtime", async () => {
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "agent-native-test-fn";
    const nitroApp = createNitroApp();
    createCoreRoutesPlugin()(nitroApp);

    const { status, contentType } = await dispatchEvents(
      nitroApp,
      `?${REALTIME_POLL_LIVE_QUERY_PARAM}=1`,
    );

    expect(status).toBe(204);
    expect(contentType ?? "").not.toContain("text/event-stream");
  });

  it("keeps streaming on a production serverless runtime without poll_live (an older bundle)", async () => {
    process.env.NODE_ENV = "production";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "agent-native-test-fn";
    const nitroApp = createNitroApp();
    createCoreRoutesPlugin()(nitroApp);

    const { status, contentType, body } = await dispatchEvents(nitroApp);

    expect(status).toBe(401);
    expect(contentType).not.toBe("text/event-stream");

    const streamBody = body instanceof Response ? body.body : undefined;
    if (streamBody instanceof ReadableStream) await streamBody.cancel();
  });

  it("keeps streaming under `netlify dev` even with poll_live (NETLIFY_LOCAL is excluded)", async () => {
    process.env.NODE_ENV = "production";
    process.env.NETLIFY = "true";
    process.env.NETLIFY_LOCAL = "true";
    const nitroApp = createNitroApp();
    createCoreRoutesPlugin()(nitroApp);

    const { status, contentType, body } = await dispatchEvents(
      nitroApp,
      `?${REALTIME_POLL_LIVE_QUERY_PARAM}=1`,
    );

    expect(status).toBe(401);
    expect(contentType).not.toBe("text/event-stream");

    const streamBody = body instanceof Response ? body.body : undefined;
    if (streamBody instanceof ReadableStream) await streamBody.cancel();
  });

  it("keeps streaming on a long-lived (non-serverless) host", async () => {
    const nitroApp = createNitroApp();
    createCoreRoutesPlugin()(nitroApp);

    const { status, contentType, body } = await dispatchEvents(nitroApp);

    expect(status).toBe(401);
    expect(contentType).not.toBe("text/event-stream");

    const streamBody = body instanceof Response ? body.body : undefined;
    if (streamBody instanceof ReadableStream) await streamBody.cancel();
  });
});
