import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestContext } from "../server/request-context.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";

const findBetterAuthUserIdForEmailMock = vi.fn();
vi.mock("../server/better-auth-instance.js", async (importActual) => ({
  ...(await importActual<typeof import("../server/better-auth-instance.js")>()),
  findBetterAuthUserIdForEmail: (email: string) =>
    findBetterAuthUserIdForEmailMock(email),
}));
vi.mock("../org/service-principal-policy.js", async (importActual) => ({
  ...(await importActual<
    typeof import("../org/service-principal-policy.js")
  >()),
  evaluateServicePrincipal: async () => ({ status: "not-service" }),
}));

const observedAuthUserIds: Array<string | undefined> = [];

function config(): MCPConfig {
  return {
    name: "Clips",
    appId: "clips",
    description: "Test app",
    askAgent: async () => "agent reply",
    actions: {
      "create-recording-upload": {
        tool: { description: "Start an upload", parameters: undefined },
        run: async () => {
          observedAuthUserIds.push(getRequestContext()?.authUserId);
          return { ok: true };
        },
      } as any,
    },
  };
}

async function clientFor(identity: MCPCallerIdentity) {
  const server = await createMCPServerForRequest(config(), identity, {
    origin: "http://localhost:8100",
    transport: "http",
    fullCatalog: true,
  } as any);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

const userIdentity: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: "org_1",
  orgDomain: undefined,
};

beforeEach(() => {
  findBetterAuthUserIdForEmailMock.mockReset();
  observedAuthUserIds.length = 0;
});

describe("MCP tool calls and the caller's auth user id", () => {
  it("runs a verified user's tool call with their Better Auth user id, looked up once per request", async () => {
    findBetterAuthUserIdForEmailMock.mockResolvedValue("user_alice");
    const client = await clientFor(userIdentity);

    await client.callTool({ name: "create-recording-upload", arguments: {} });
    await client.callTool({ name: "create-recording-upload", arguments: {} });

    expect(observedAuthUserIds).toEqual(["user_alice", "user_alice"]);
    expect(findBetterAuthUserIdForEmailMock).toHaveBeenCalledTimes(1);
    expect(findBetterAuthUserIdForEmailMock).toHaveBeenCalledWith(
      "alice@example.com",
    );
  });

  it("leaves the id unset when no account has the caller's email", async () => {
    findBetterAuthUserIdForEmailMock.mockResolvedValue(undefined);
    const client = await clientFor(userIdentity);

    await client.callTool({ name: "create-recording-upload", arguments: {} });

    expect(observedAuthUserIds).toEqual([undefined]);
  });

  it.each([
    [
      "a service principal",
      {
        userEmail: "svc-ci@service.org_1",
        identityAssurance: "service",
        orgId: "org_1",
        orgDomain: undefined,
      },
    ],
    [
      "an organization key",
      {
        userEmail: "alice@example.com",
        identityAssurance: "organization",
        orgId: "org_1",
        orgDomain: undefined,
      },
    ],
  ] as const)(
    "never looks one up for %s, whose email is not a verified user",
    async (_label, identity) => {
      const client = await clientFor(identity as MCPCallerIdentity);

      await client.callTool({ name: "create-recording-upload", arguments: {} });

      expect(observedAuthUserIds).toEqual([undefined]);
      expect(findBetterAuthUserIdForEmailMock).not.toHaveBeenCalled();
    },
  );

  it("fails the call instead of running it as a user with no account when the lookup fails", async () => {
    findBetterAuthUserIdForEmailMock.mockRejectedValue(
      new Error("database unavailable"),
    );
    const client = await clientFor(userIdentity);

    await expect(
      client.callTool({ name: "create-recording-upload", arguments: {} }),
    ).rejects.toThrow(/database unavailable/);
    expect(observedAuthUserIds).toEqual([]);
  });

  it("does not look the id up to list tools", async () => {
    const client = await clientFor(userIdentity);

    await client.listTools();

    expect(findBetterAuthUserIdForEmailMock).not.toHaveBeenCalled();
  });
});
