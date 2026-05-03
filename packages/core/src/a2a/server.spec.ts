import * as jose from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { A2AConfig } from "./types.js";

const handleJsonRpcH3Mock = vi.hoisted(() =>
  vi.fn(async () => ({ jsonrpc: "2.0", id: 1, result: { ok: true } })),
);
const getA2ASecretByDomainMock = vi.hoisted(() => vi.fn());
const setResponseStatusMock = vi.hoisted(() =>
  vi.fn((event: any, code: number) => {
    event._status = code;
  }),
);

vi.mock("h3", () => ({
  defineEventHandler: (handler: any) => handler,
  getMethod: (event: any) => event.method ?? "POST",
  getRequestHeader: (event: any, name: string) =>
    event.headers?.[name.toLowerCase()] ?? event.headers?.[name],
  setResponseHeader: vi.fn(),
  setResponseStatus: setResponseStatusMock,
}));

vi.mock("../server/framework-request-handler.js", () => ({
  getH3App: (app: any) => ({
    use: (path: string, handler: any) => {
      app.routes.push({ path, handler });
    },
  }),
}));

vi.mock("./handlers.js", () => ({
  handleJsonRpcH3: handleJsonRpcH3Mock,
  processA2ATaskFromQueue: vi.fn(async () => undefined),
}));

vi.mock("../server/h3-helpers.js", () => ({
  readBody: vi.fn(async (event: any) => event.body ?? {}),
}));

vi.mock("../org/context.js", () => ({
  getA2ASecretByDomain: getA2ASecretByDomainMock,
}));

const config: A2AConfig = {
  name: "QA Agent",
  description: "Test agent",
  skills: [],
};

describe("mountA2A auth", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    handleJsonRpcH3Mock.mockClear();
    getA2ASecretByDomainMock.mockReset();
    setResponseStatusMock.mockClear();
    process.env = { ...originalEnv, NODE_ENV: "production" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("advertises the mounted JSON-RPC endpoint in the agent card", async () => {
    process.env.APP_BASE_PATH = "/dispatch";
    const handler = await mountedAgentCardHandler(config);

    const response = await handler({
      method: "GET",
      headers: {
        host: "agent-workspace.builder.io",
        "x-forwarded-proto": "https",
      },
      path: "/",
      context: {},
    });

    expect(response.url).toBe(
      "https://agent-workspace.builder.io/dispatch/_agent-native/a2a",
    );
  });

  it("advertises custom mounted A2A route prefixes in the agent card", async () => {
    process.env.APP_BASE_PATH = "/workspace";
    const handler = await mountedAgentCardHandler(config, "/rpc");

    const response = await handler({
      method: "GET",
      headers: {
        host: "agent.example",
        "x-forwarded-proto": "https",
      },
      path: "/",
      context: {},
    });

    expect(response.url).toBe("https://agent.example/workspace/rpc/a2a");
  });

  it("allows legacy apiKeyEnv bearer auth even when A2A_SECRET is configured", async () => {
    process.env.A2A_SECRET = "jwt-secret";
    process.env.LEGACY_A2A_KEY = "legacy-key";
    const handler = await mountedA2AHandler({
      ...config,
      apiKeyEnv: "LEGACY_A2A_KEY",
    });

    const event = postEvent({ authorization: "Bearer legacy-key" });
    const response = await handler(event);

    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(event._status).toBeUndefined();
    expect(handleJsonRpcH3Mock).toHaveBeenCalledOnce();
  });

  it("verifies org-secret JWTs before deciding production auth is unconfigured", async () => {
    delete process.env.A2A_SECRET;
    getA2ASecretByDomainMock.mockResolvedValueOnce("org-a2a-secret");
    const token = await new jose.SignJWT({
      sub: "alice+qa@builder.io",
      org_domain: "builder.io",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://dispatch.agent-native.test")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("org-a2a-secret"));
    const handler = await mountedA2AHandler(config);

    const event = postEvent({ authorization: `Bearer ${token}` });
    const response = await handler(event);

    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(event.context.__a2aVerifiedEmail).toBe("alice+qa@builder.io");
    expect(event.context.__a2aOrgDomain).toBe("builder.io");
    expect(event._status).toBeUndefined();
    expect(handleJsonRpcH3Mock).toHaveBeenCalledOnce();
  });

  it("falls back to the shared A2A_SECRET when the receiver org secret differs", async () => {
    process.env.A2A_SECRET = "shared-global-secret";
    getA2ASecretByDomainMock.mockResolvedValueOnce("receiver-local-org-secret");
    const token = await new jose.SignJWT({
      sub: "alice+qa@builder.io",
      org_domain: "builder.io",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("https://dispatch.agent-native.test")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(new TextEncoder().encode("shared-global-secret"));
    const handler = await mountedA2AHandler(config);

    const event = postEvent({ authorization: `Bearer ${token}` });
    const response = await handler(event);

    expect(response).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
    expect(event.context.__a2aVerifiedEmail).toBe("alice+qa@builder.io");
    expect(event.context.__a2aOrgDomain).toBe("builder.io");
    expect(event._status).toBeUndefined();
    expect(handleJsonRpcH3Mock).toHaveBeenCalledOnce();
  });

  it("requires a bearer token on hosted runtimes when A2A_SECRET is configured", async () => {
    process.env.A2A_SECRET = "shared-global-secret";
    process.env.NODE_ENV = "development";
    process.env.NETLIFY = "true";
    const handler = await mountedA2AHandler(config);

    const event = postEvent({});
    const response = await handler(event);

    expect(event._status).toBe(401);
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message: "Authentication required",
      },
    });
    expect(handleJsonRpcH3Mock).not.toHaveBeenCalled();
  });

  it("rejects invalid bearer tokens before tasks/get can report a lookup miss", async () => {
    delete process.env.A2A_SECRET;
    process.env.NODE_ENV = "development";
    const handler = await mountedA2AHandler(config);

    const event = postEvent({ authorization: "Bearer not-a-valid-token" });
    const response = await handler(event);

    expect(event._status).toBe(401);
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message: "Invalid or expired A2A token",
      },
    });
    expect(handleJsonRpcH3Mock).not.toHaveBeenCalled();
  });

  it("treats hosted Netlify runtime as production for missing A2A auth", async () => {
    delete process.env.A2A_SECRET;
    process.env.NODE_ENV = "development";
    process.env.NETLIFY = "true";
    const handler = await mountedA2AHandler(config);

    const event = postEvent({});
    const response = await handler(event);

    expect(event._status).toBe(503);
    expect(response).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32001,
        message:
          "A2A authentication not configured. Set A2A_SECRET (preferred) or configure apiKeyEnv to accept inbound A2A traffic.",
      },
    });
    expect(handleJsonRpcH3Mock).not.toHaveBeenCalled();
  });

  it("treats hosted Netlify runtime as production for unsigned async processors", async () => {
    delete process.env.A2A_SECRET;
    process.env.NODE_ENV = "development";
    process.env.NETLIFY = "true";
    const handler = await mountedA2AProcessorHandler(config);

    const event = {
      method: "POST",
      headers: {},
      path: "/",
      context: {},
      body: { taskId: "task-1" },
    };
    const response = await handler(event);

    expect(event._status).toBe(503);
    expect(response).toEqual({
      error:
        "A2A processor not configured — set A2A_SECRET on this deployment to enable async A2A.",
    });
  });
});

async function mountedAgentCardHandler(
  config: A2AConfig,
  routePrefix?: string,
): Promise<(event: any) => any> {
  const { mountA2A } = await import("./server.js");
  const app = { routes: [] as Array<{ path: string; handler: any }> };
  mountA2A(app, config, routePrefix);
  const route = app.routes.find(
    (entry) => entry.path === "/.well-known/agent-card.json",
  );
  if (!route) throw new Error("A2A agent card route was not mounted");
  return route.handler;
}

async function mountedA2AHandler(
  config: A2AConfig,
): Promise<(event: any) => any> {
  const { mountA2A } = await import("./server.js");
  const app = { routes: [] as Array<{ path: string; handler: any }> };
  mountA2A(app, config);
  const route = app.routes.find((entry) => entry.path === "/_agent-native/a2a");
  if (!route) throw new Error("A2A route was not mounted");
  return route.handler;
}

async function mountedA2AProcessorHandler(
  config: A2AConfig,
): Promise<(event: any) => any> {
  const { mountA2A } = await import("./server.js");
  const app = { routes: [] as Array<{ path: string; handler: any }> };
  mountA2A(app, config);
  const route = app.routes.find(
    (entry) => entry.path === "/_agent-native/a2a/_process-task",
  );
  if (!route) throw new Error("A2A processor route was not mounted");
  return route.handler;
}

function postEvent(headers: Record<string, string>): any {
  return {
    method: "POST",
    headers,
    path: "/",
    context: {},
    body: { jsonrpc: "2.0", id: 1, method: "tasks/get", params: {} },
  };
}
