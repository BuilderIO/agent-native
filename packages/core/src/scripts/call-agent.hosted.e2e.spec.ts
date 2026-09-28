import { createServer, type Server } from "node:http";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { clearA2ACardCache } from "../a2a/client.js";
import { _resetCapabilityCacheForTests } from "../server/agent-capabilities.js";

const findAgentMock = vi.hoisted(() => vi.fn());
const discoverAgentsMock = vi.hoisted(() => vi.fn(async () => []));
const resolveCredentialMock = vi.hoisted(() => vi.fn());

vi.mock("../server/agent-discovery.js", () => ({
  findAgent: (...args: unknown[]) => findAgentMock(...args),
  discoverAgents: (...args: unknown[]) => discoverAgentsMock(...args),
}));
vi.mock("../credentials/index.js", () => ({
  resolveCredential: (...args: unknown[]) => resolveCredentialMock(...args),
}));
vi.mock("../server/request-context.js", () => ({
  getRequestUserEmail: () => "alice@example.test",
  getRequestOrgId: () => undefined,
  getRequestRunContext: () => undefined,
  isIntegrationCallerRequest: () => false,
  getIntegrationRequestContext: () => null,
  getRequestContext: () => ({ userEmail: "alice@example.test" }),
}));
vi.mock("../org/context.js", () => ({
  getOrgDomain: vi.fn(async () => undefined),
  getOrgA2ASecret: vi.fn(async () => undefined),
}));
vi.mock("../tracking/registry.js", () => ({ track: vi.fn() }));

describe("call-agent hosted A2A fixture", () => {
  let server: Server;
  let origin = "";
  let cardMode: "jsonrpc" | "rest" = "jsonrpc";
  const requests: Array<{
    path: string;
    method?: string;
    authorization?: string;
  }> = [];
  const wireMessages: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = request.url ?? "/";
      const authorization = request.headers.authorization;
      requests.push({ path, method: request.method, authorization });

      if (path === "/custom-card") {
        if (authorization !== "Bearer fixture-token") {
          response.writeHead(401).end("card rejected");
          return;
        }
        const card =
          cardMode === "jsonrpc"
            ? {
                name: "Fixture Hosted Agent",
                description: "A bearer-protected v1 fixture",
                version: "1",
                capabilities: { streaming: false },
                skills: [],
                supportedInterfaces: [
                  {
                    url: `${origin}/rpc`,
                    protocolBinding: "JSONRPC",
                    protocolVersion: "1.0",
                  },
                ],
              }
            : {
                name: "Fixture REST Agent",
                description: "A v1 card without JSON-RPC",
                version: "1",
                protocolVersion: "1.0",
                capabilities: { streaming: false },
                skills: [],
                supportedInterfaces: [
                  {
                    url: `${origin}/rest`,
                    protocolBinding: "REST",
                    protocolVersion: "1.0",
                  },
                ],
              };
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify(card));
        return;
      }

      if (path === "/rpc" && request.method === "POST") {
        if (authorization !== "Bearer fixture-token") {
          response.writeHead(401).end("rpc rejected");
          return;
        }
        let body = "";
        request.on("data", (chunk) => (body += String(chunk)));
        request.on("end", () => {
          const parsed = JSON.parse(body) as {
            id: string | number;
            method: string;
            params?: {
              message?: {
                messageId?: string;
                role?: string;
                parts?: Array<{ text?: string }>;
              };
            };
          };
          wireMessages.push(parsed as unknown as Record<string, unknown>);
          if (parsed.method === "GetTask") {
            response.writeHead(200, { "content-type": "application/json" }).end(
              JSON.stringify({
                jsonrpc: "2.0",
                id: parsed.id,
                error: { code: -32001, message: "Task not found" },
              }),
            );
            return;
          }
          expect(parsed.method).toBe("SendMessage");
          response.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: parsed.id,
              result: {
                task: {
                  id: "fixture-task",
                  status: {
                    state: "TASK_STATE_COMPLETED",
                    timestamp: new Date().toISOString(),
                    message: {
                      role: "ROLE_AGENT",
                      parts: [{ text: "fixture answer" }],
                    },
                  },
                },
              },
            }),
          );
        });
        return;
      }

      response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string")
          throw new Error("fixture did not bind");
        origin = `http://127.0.0.1:${address.port}`;
        process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON = JSON.stringify({
          apps: [{ url: origin }],
        });
        resolve();
      });
    });
  });

  afterAll(async () => {
    delete process.env.AGENT_NATIVE_WORKSPACE_APPS_JSON;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  beforeEach(() => {
    requests.length = 0;
    wireMessages.length = 0;
    cardMode = "jsonrpc";
    clearA2ACardCache();
    _resetCapabilityCacheForTests();
    resolveCredentialMock.mockResolvedValue("fixture-token");
    findAgentMock.mockResolvedValue({
      id: "fixture",
      name: "Fixture Hosted Agent",
      description: "",
      url: origin,
      color: "#000",
      cardUrl: `${origin}/custom-card`,
      auth: { type: "bearer", credentialRef: "FIXTURE_TOKEN" },
    });
  });

  it("delegates through call-agent with a bearer, custom card, and streaming=false", async () => {
    const { run } = await import("./call-agent.js");

    await expect(run({ agent: "fixture", message: "hello" })).resolves.toBe(
      "fixture answer",
    );

    expect(wireMessages[0]).toMatchObject({
      method: "SendMessage",
      params: {
        message: {
          role: "ROLE_USER",
          parts: [{ text: expect.stringContaining("hello") }],
          messageId: expect.any(String),
        },
      },
    });

    expect(requests.map((request) => request.path)).toEqual([
      "/custom-card",
      "/rpc",
    ]);
    expect(
      requests.every(
        (request) => request.authorization === "Bearer fixture-token",
      ),
    ).toBe(true);
    expect(requests[1]?.method).toBe("POST");
  });

  it("surfaces a card with no JSON-RPC interface as a typed chat failure", async () => {
    cardMode = "rest";
    const { run } = await import("./call-agent.js");

    await expect(run({ agent: "fixture", message: "hello" })).rejects.toThrow(
      /no JSON-RPC interface.*REST 1\.0/i,
    );
    expect(requests.map((request) => request.path)).toEqual(["/custom-card"]);
  });

  it("surfaces provider bearer rejection instead of trying an internal JWT", async () => {
    resolveCredentialMock.mockResolvedValue("wrong-token");
    const { run } = await import("./call-agent.js");

    await expect(run({ agent: "fixture", message: "hello" })).rejects.toThrow(
      /credential was rejected \(HTTP 401\)/i,
    );
    expect(requests.map((request) => request.path)).toEqual(["/custom-card"]);
  });

  it("reports hosted probe statuses for reachable, rejected, and non-JSON-RPC cards", async () => {
    const { clearA2ACardCache } = await import("../a2a/client.js");
    const { _resetCapabilityCacheForTests } =
      await import("../server/agent-capabilities.js");
    const { probePeerAgent } = await import("../server/agent-peer-probe.js");
    const agent = await findAgentMock("fixture");

    _resetCapabilityCacheForTests();
    clearA2ACardCache();
    await expect(probePeerAgent(agent)).resolves.toMatchObject({
      reachable: true,
      cardStatus: "reachable",
      authorized: true,
    });

    _resetCapabilityCacheForTests();
    clearA2ACardCache();
    resolveCredentialMock.mockResolvedValue("wrong-token");
    await expect(probePeerAgent(agent)).resolves.toMatchObject({
      reachable: true,
      cardStatus: "auth-rejected",
    });

    _resetCapabilityCacheForTests();
    clearA2ACardCache();
    resolveCredentialMock.mockResolvedValue("fixture-token");
    cardMode = "rest";
    await expect(probePeerAgent(agent)).resolves.toMatchObject({
      reachable: true,
      cardStatus: "no-json-rpc",
    });
  });
});
