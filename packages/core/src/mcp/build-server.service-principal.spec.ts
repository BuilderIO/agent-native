import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";

const evaluateServicePrincipalMock = vi.fn();
vi.mock("../org/service-principal-policy.js", async (importActual) => ({
  ...(await importActual<
    typeof import("../org/service-principal-policy.js")
  >()),
  evaluateServicePrincipal: (...a: any[]) => evaluateServicePrincipalMock(...a),
}));
const recordActionAuditMock = vi.fn(async (_input: any) => {});
vi.mock("../audit/record.js", () => ({
  recordActionAudit: (input: any) => recordActionAuditMock(input),
}));

const SVC = "svc-ci@service.org_1";
const runs: string[] = [];

function config(): MCPConfig {
  const action = (name: string, readOnly: boolean) =>
    ({
      tool: { description: name, parameters: undefined },
      readOnly,
      run: async () => {
        runs.push(name);
        return { ok: name };
      },
    }) as any;
  return {
    name: "Docs",
    appId: "docs",
    description: "Test app",
    askAgent: async () => "agent reply",
    actions: {
      "list-docs": action("list-docs", true),
      "read-doc": action("read-doc", true),
      "delete-doc": action("delete-doc", false),
    },
  };
}

async function clientFor(
  identity: MCPCallerIdentity,
  mcpConfig: MCPConfig = config(),
) {
  const server = await createMCPServerForRequest(mcpConfig, identity, {
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

const serviceIdentity: MCPCallerIdentity = {
  userEmail: SVC,
  identityAssurance: "service",
  orgId: "org_1",
  orgDomain: undefined,
};

function activeWithGrant(allowedActions: string[] | null) {
  evaluateServicePrincipalMock.mockResolvedValue({
    status: "active",
    policy: { lifecycle: "active", allowedActions },
  });
}

function textOf(result: any): string {
  return result.content.map((c: any) => c.text).join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.length = 0;
});

describe("MCP tools/list for a service principal", () => {
  it("lists everything for an ungoverned principal", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({
      status: "ungoverned",
      orgId: "org_1",
      serviceName: "ci",
    });
    const client = await clientFor(serviceIdentity);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "list-docs",
        "read-doc",
        "delete-doc",
        "ask-agent",
      ]),
    );
  });

  it("omits tools outside the grant, including ask-agent", async () => {
    activeWithGrant(["list-docs", "read-*"]);
    const client = await clientFor(serviceIdentity);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("list-docs");
    expect(names).toContain("read-doc");
    expect(names).not.toContain("delete-doc");
    expect(names).not.toContain("ask-agent");
  });

  it("lists ask-agent only when the grant names it", async () => {
    activeWithGrant(["ask-agent"]);
    const client = await clientFor(serviceIdentity);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(["ask-agent"]);
  });

  it("lists nothing for an empty grant (deny by default)", async () => {
    activeWithGrant([]);
    const client = await clientFor(serviceIdentity);
    expect((await client.listTools()).tools).toEqual([]);
  });

  it("fails the request when the policy cannot be read", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "unavailable" });
    const client = await clientFor(serviceIdentity);
    await expect(client.listTools()).rejects.toThrow(/could not be verified/);
  });
});

describe("MCP tools/call for a service principal", () => {
  it("runs a granted tool", async () => {
    activeWithGrant(["list-docs"]);
    const client = await clientFor(serviceIdentity);
    const result: any = await client.callTool({
      name: "list-docs",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(runs).toEqual(["list-docs"]);
  });

  it("refuses a tool outside the grant without running it, and audits a denial", async () => {
    activeWithGrant(["list-docs"]);
    const client = await clientFor(serviceIdentity);
    const result: any = await client.callTool({
      name: "delete-doc",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      "not permitted for this service principal",
    );
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
    const audit = recordActionAuditMock.mock.calls[0][0];
    expect(audit.ctx).toMatchObject({
      actionName: "delete-doc",
      caller: "mcp",
      userEmail: SVC,
    });
    expect(audit.error.statusCode).toBe(403);
  });

  it("refuses ask-agent unless the grant names it", async () => {
    activeWithGrant(["list-docs"]);
    const client = await clientFor(serviceIdentity);
    const result: any = await client.callTool({
      name: "ask-agent",
      arguments: { message: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain(
      "not permitted for this service principal",
    );
  });

  it("refuses everything for an empty grant", async () => {
    activeWithGrant([]);
    const client = await clientFor(serviceIdentity);
    const result: any = await client.callTool({
      name: "list-docs",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(runs).toEqual([]);
  });

  it("stops a principal suspended after admission on its next call", async () => {
    activeWithGrant(null);
    const client = await clientFor(serviceIdentity);
    await client.callTool({ name: "list-docs", arguments: {} });
    expect(runs).toEqual(["list-docs"]);

    evaluateServicePrincipalMock.mockResolvedValue({
      status: "suspended",
      policy: { lifecycle: "suspended", allowedActions: null },
    });
    const result: any = await client.callTool({
      name: "list-docs",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("suspended or retired");
    expect(runs).toEqual(["list-docs"]);
    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
  });

  it("answers a retryable error, with no denial row, when the policy cannot be read", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "unavailable" });
    const client = await clientFor(serviceIdentity);
    const result: any = await client.callTool({
      name: "list-docs",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("could not be verified");
    expect(runs).toEqual([]);
    expect(recordActionAuditMock).not.toHaveBeenCalled();
  });

  it("does not restrict a non-service caller", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const client = await clientFor({
      userEmail: "alice@example.com",
      identityAssurance: "user",
      orgId: "org_1",
      orgDomain: undefined,
    });
    const result: any = await client.callTool({
      name: "delete-doc",
      arguments: {},
    });
    expect(result.isError).not.toBe(true);
    expect(runs).toEqual(["delete-doc"]);
  });
});

describe("MCP App resources for a service principal", () => {
  function widgetConfig(): MCPConfig {
    const base = config();
    const widget = (name: string) => ({
      ...base.actions[name],
      mcpApp: {
        resource: { title: name, html: `<main>${name}</main>` },
      },
    });
    return {
      ...base,
      actions: {
        ...base.actions,
        "list-docs": widget("list-docs"),
        "delete-doc": widget("delete-doc"),
      },
    };
  }

  beforeEach(() => {
    process.env.AGENT_NATIVE_MCP_APPS_INLINE = "1";
  });

  afterEach(() => {
    delete process.env.AGENT_NATIVE_MCP_APPS_INLINE;
  });

  it("lists, templates, and reads only widgets inside the grant", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const open = await clientFor(
      { ...serviceIdentity, userEmail: "alice@example.com" },
      widgetConfig(),
    );
    const all = (await open.listResources()).resources;
    expect(all.map((r) => r.name)).toEqual(
      expect.arrayContaining(["delete-doc", "list-docs"]),
    );
    const deniedUri = all.find((r) => r.name === "delete-doc")!.uri;

    activeWithGrant(["list-docs"]);
    const client = await clientFor(serviceIdentity, widgetConfig());
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.name)).toEqual(["list-docs"]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.name)).toEqual(["list-docs"]);
    await expect(
      client.readResource({ uri: resources[0].uri }),
    ).resolves.toBeDefined();
    await expect(client.readResource({ uri: deniedUri })).rejects.toThrow();
  });
});
