import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createToolSearchEntry } from "../agent/tool-search.js";
import { getRequestContext } from "../server/request-context.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";

const evaluateServicePrincipalMock = vi.fn();
const jevMocks = vi.hoisted(() => ({ credentials: vi.fn(), rank: vi.fn() }));
vi.mock("../agent/production-agent.js", () => ({
  getJevContextCredentials: jevMocks.credentials,
}));
vi.mock("../agent/jev-tool-prefetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/jev-tool-prefetch.js")>()),
  rankJevCandidatesWithStatus: jevMocks.rank,
}));
vi.mock("../org/service-principal-policy.js", async (importActual) => ({
  ...(await importActual<
    typeof import("../org/service-principal-policy.js")
  >()),
  evaluateServicePrincipal: (...a: any[]) => evaluateServicePrincipalMock(...a),
}));
const recordActionAuditMock = vi.fn(async (_input: any) => {});
// People who turned on the "App cards in chat apps" lab. Other labs read the
// real store.
const appCardsLab = vi.hoisted(() => ({ optedIn: new Set<string>() }));

vi.mock("../labs/store.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../labs/store.js")>();
  return {
    ...actual,
    getUserLabEnabled: vi.fn(
      async (...args: Parameters<typeof actual.getUserLabEnabled>) => {
        const [email, lab] = args;
        const key = typeof lab === "string" ? lab : lab.key;
        return key === "mcp-app-cards"
          ? appCardsLab.optedIn.has(email)
          : actual.getUserLabEnabled(...args);
      },
    ),
  };
});

vi.mock("../audit/record.js", () => ({
  recordActionAudit: (input: any) => recordActionAuditMock(input),
}));

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));

const SVC = "svc-ci@service.org_1";
const runs: string[] = [];
let observedVerifiedServiceIdentity:
  | { userEmail: string; orgId: string }
  | undefined;

function config(): MCPConfig {
  const action = (name: string, readOnly: boolean) =>
    ({
      tool: { description: name, parameters: undefined },
      readOnly,
      run: async () => {
        runs.push(name);
        observedVerifiedServiceIdentity =
          getRequestContext()?.verifiedServiceIdentity;
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
  requestMeta: { inlineMcpApps?: boolean; fullCatalog?: boolean } = {},
) {
  const server = await createMCPServerForRequest(mcpConfig, identity, {
    origin: "http://localhost:8100",
    transport: "http",
    fullCatalog: true,
    ...requestMeta,
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
  observedVerifiedServiceIdentity = undefined;
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
    expect(recordActionAuditMock).not.toHaveBeenCalled();
  });

  it("audits a service principal refused by tools/list", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({
      status: "suspended",
      policy: { lifecycle: "suspended", allowedActions: null },
    });
    const client = await clientFor(serviceIdentity);

    await expect(client.listTools()).rejects.toThrow(/suspended or retired/i);

    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
    expect(recordActionAuditMock.mock.calls[0][0]).toMatchObject({
      ctx: {
        actionName: "mcp:tools/list",
        userEmail: SVC,
        orgId: "org_1",
      },
      attribution: { caller: "mcp" },
      error: { statusCode: 403 },
    });
  });
});

describe("MCP tools/call for a service principal", () => {
  it("propagates a failed policy read during task search", async () => {
    activeWithGrant(["tool-search", "list-docs"]);
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs"];
    const client = await clientFor(serviceIdentity, cfg, {
      fullCatalog: false,
    });
    evaluateServicePrincipalMock.mockClear();
    evaluateServicePrincipalMock
      .mockResolvedValueOnce({
        status: "active",
        policy: {
          lifecycle: "active",
          allowedActions: ["tool-search", "list-docs"],
        },
      })
      .mockResolvedValue({ status: "unavailable" });
    await expect(
      client.callTool({
        name: "tool-search",
        arguments: { task: "list docs" },
      }),
    ).rejects.toThrow(/could not be verified/i);
    expect(
      evaluateServicePrincipalMock.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("aborts task ranking when the MCP caller cancels", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs"];
    jevMocks.credentials.mockResolvedValue({
      personalApiKey: "synthetic",
      builderAuth: null,
    });
    let started!: () => void;
    let aborted!: () => void;
    const rankStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const rankAborted = new Promise<void>((resolve) => {
      aborted = resolve;
    });
    jevMocks.rank.mockImplementation(({ signal }: { signal: AbortSignal }) => {
      started();
      return new Promise((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            resolve({ status: "timed_out", ids: [] });
          },
          { once: true },
        );
      });
    });
    const client = await clientFor(
      {
        userEmail: "alice@example.com",
        identityAssurance: "user",
        orgId: "org_1",
      },
      cfg,
      { fullCatalog: false },
    );
    // Freeze the ranking deadline: only the SDK cancellation can abort it.
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      const call = client.callTool(
        { name: "tool-search", arguments: { task: "list docs" } },
        { signal: controller.signal },
      );
      const rejected = expect(call).rejects.toThrow();
      await rankStarted;
      controller.abort();
      await rejected;
      await rankAborted;
    } finally {
      vi.useRealTimers();
    }
  }, 10000);

  it("rechecks a task recommendation's grant when the action is called", async () => {
    activeWithGrant(["tool-search", "read-doc"]);
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "read-doc"];
    const client = await clientFor(serviceIdentity, cfg, {
      fullCatalog: false,
    });
    const result = await client.callTool({
      name: "tool-search",
      arguments: { task: "read-doc" },
    });
    expect(JSON.parse(textOf(result)).recommendations).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "read-doc" })]),
    );
    activeWithGrant(["tool-search"]);
    const call = await client.callTool({ name: "read-doc", arguments: {} });
    expect(call.isError).toBe(true);
    expect(textOf(call)).toContain("not permitted for this service principal");
    expect(runs).not.toContain("read-doc");
  });

  it("uses a resolved Jev credential when the other lookup fails", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs"];
    const client = await clientFor(
      {
        userEmail: "alice@example.com",
        identityAssurance: "user",
        orgId: "org_1",
      },
      cfg,
      { fullCatalog: false },
    );
    jevMocks.rank.mockResolvedValue({ status: "selected", ids: ["list-docs"] });
    for (const credentials of [
      {
        personalApiKey: "synthetic",
        builderAuth: null,
        builderAuthLookupFailed: true,
      },
      { builderAuth: { token: "synthetic" }, apiKeyLookupFailed: true },
    ]) {
      jevMocks.credentials.mockResolvedValue(credentials);
      jevMocks.rank.mockClear();
      const result = await client.callTool({
        name: "tool-search",
        arguments: { task: "list docs" },
      });
      expect(JSON.parse(textOf(result))).toMatchObject({
        ranking: "jev",
        status: "selected",
      });
      expect(jevMocks.rank).toHaveBeenCalledOnce();
    }
    jevMocks.credentials.mockResolvedValue({
      builderAuth: null,
      builderAuthLookupFailed: true,
    });
    jevMocks.rank.mockClear();
    const failed = await client.callTool({
      name: "tool-search",
      arguments: { task: "list docs" },
    });
    expect(JSON.parse(textOf(failed))).toMatchObject({
      ranking: "bm25",
      status: "failed",
    });
    expect(jevMocks.rank).not.toHaveBeenCalled();
  });

  it("ranks task search only for verified user identities with credentials", async () => {
    await import("../agent/production-agent.js");
    await import("../agent/jev-tool-prefetch.js");
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs", "read-doc"];
    jevMocks.credentials.mockResolvedValue({
      personalApiKey: "synthetic",
      builderAuth: null,
    });
    jevMocks.rank.mockResolvedValue({ status: "selected", ids: ["read-doc"] });
    const user = {
      userEmail: "alice@example.com",
      identityAssurance: "user" as const,
      orgId: "org_1",
    };
    const client = await clientFor(user, cfg, { fullCatalog: false });
    const ranked = await client.callTool({
      name: "tool-search",
      arguments: { task: "read documents" },
    });
    expect(jevMocks.credentials).toHaveBeenCalledWith(user.userEmail);
    expect(JSON.parse(textOf(ranked))).toMatchObject({
      ranking: "jev",
      status: "selected",
      recommendations: [{ name: "read-doc" }],
    });
    expect(jevMocks.rank).toHaveBeenCalledWith(
      expect.objectContaining({
        request: "read documents",
        timeoutMs: expect.any(Number),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(jevMocks.rank.mock.calls[0]![0].timeoutMs).toBeLessThanOrEqual(750);

    jevMocks.credentials.mockResolvedValue({ builderAuth: null });
    jevMocks.rank.mockClear();
    const unavailable = await client.callTool({
      name: "tool-search",
      arguments: { task: "list documents" },
    });
    expect(JSON.parse(textOf(unavailable))).toMatchObject({
      ranking: "bm25",
      status: "unavailable",
    });
    expect(jevMocks.rank).not.toHaveBeenCalled();

    jevMocks.credentials.mockClear();
    activeWithGrant(["tool-search", "list-docs"]);
    const service = await clientFor(serviceIdentity, cfg, {
      fullCatalog: false,
    });
    const degraded = await service.callTool({
      name: "tool-search",
      arguments: { task: "list documents" },
    });
    expect(JSON.parse(textOf(degraded))).toMatchObject({
      ranking: "bm25",
      status: "unavailable",
    });
    expect(jevMocks.credentials).not.toHaveBeenCalled();
  });

  it("uses the server candidate source only for verified users and supplies current callable names", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs"];
    const provider = vi.fn<NonNullable<MCPConfig["taskCandidates"]>>(
      async () => [],
    );
    cfg.taskCandidates = provider;
    jevMocks.credentials.mockResolvedValue({ builderAuth: null });
    const user = await clientFor(
      {
        userEmail: "alice@example.com",
        identityAssurance: "user",
        orgId: "org_1",
      },
      cfg,
      { fullCatalog: false },
    );
    await user.callTool({
      name: "tool-search",
      arguments: { task: "list docs" },
    });
    expect(provider).toHaveBeenCalledWith(
      expect.objectContaining({
        callableActionNames: expect.arrayContaining(["list-docs"]),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(provider.mock.calls[0]![0].callableActionNames).not.toContain(
      "read-doc",
    );

    provider.mockClear();
    jevMocks.credentials.mockClear();
    const unverified = await clientFor(
      {
        userEmail: "alice@example.com",
        identityAssurance: "organization",
        orgId: "org_1",
      },
      cfg,
      { fullCatalog: false },
    );
    const result = await unverified.callTool({
      name: "tool-search",
      arguments: { task: "list docs" },
    });
    expect(JSON.parse(textOf(result))).toMatchObject({
      ranking: "bm25",
      status: "unavailable",
    });
    expect(provider).not.toHaveBeenCalled();
    expect(jevMocks.credentials).not.toHaveBeenCalled();
  });

  it("removes a revoked action from tool-search on the next call", async () => {
    activeWithGrant(["tool-search", "list-docs", "read-doc"]);
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs", "read-doc"];
    const client = await clientFor(serviceIdentity, cfg, {
      fullCatalog: false,
    });

    const before = await client.callTool({
      name: "tool-search",
      arguments: {},
    });
    expect(textOf(before)).toContain("read-doc");

    activeWithGrant(["tool-search", "list-docs"]);
    const after = await client.callTool({ name: "tool-search", arguments: {} });
    expect(textOf(after)).toContain("list-docs");
    expect(textOf(after)).not.toContain("read-doc");
  });

  it("does not reveal actions outside the current grant through tool-search", async () => {
    activeWithGrant(["tool-search", "list-docs"]);
    const cfg = config();
    const actions = cfg.actions!;
    actions["tool-search"] = createToolSearchEntry(() => actions);
    cfg.connectorCatalog = ["tool-search", "list-docs", "read-doc"];
    const client = await clientFor(serviceIdentity, cfg, {
      fullCatalog: false,
    });
    const result = await client.callTool({
      name: "tool-search",
      arguments: {},
    });
    expect(textOf(result)).toContain("list-docs");
    expect(textOf(result)).not.toContain("read-doc");
  });

  it("carries verified service identity into the tool request context", async () => {
    activeWithGrant(["list-docs"]);
    const client = await clientFor(serviceIdentity);
    await client.callTool({ name: "list-docs", arguments: {} });

    expect(observedVerifiedServiceIdentity).toEqual({
      userEmail: SVC,
      orgId: "org_1",
    });
  });

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
      userEmail: SVC,
    });
    expect(audit.attribution).toMatchObject({ caller: "mcp" });
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

  it("propagates a retryable policy-store error instead of returning a terminal tool result", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "unavailable" });
    const client = await clientFor(serviceIdentity);
    await expect(
      client.callTool({ name: "list-docs", arguments: {} }),
    ).rejects.toThrow(/could not be verified/i);
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

  // Cards on for the request, as on the directory catalog. The lab never
  // turns them on for a service principal.
  const cards = { inlineMcpApps: true };

  afterEach(() => {
    appCardsLab.optedIn.clear();
  });

  it("never gives a service principal cards from the lab", async () => {
    activeWithGrant(null);
    appCardsLab.optedIn = new Set([SVC]);
    const client = await clientFor(serviceIdentity, widgetConfig());

    expect((await client.listResources()).resources).toEqual([]);
  });

  it("lists, templates, and reads only widgets inside the grant", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
    const open = await clientFor(
      { ...serviceIdentity, userEmail: "alice@example.com" },
      widgetConfig(),
      cards,
    );
    const all = (await open.listResources()).resources;
    expect(all.map((r) => r.name)).toEqual(
      expect.arrayContaining(["delete-doc", "list-docs"]),
    );
    const deniedUri = all.find((r) => r.name === "delete-doc")!.uri;

    activeWithGrant(["list-docs"]);
    const client = await clientFor(serviceIdentity, widgetConfig(), cards);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.name)).toEqual(["list-docs"]);
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((r) => r.name)).toEqual(["list-docs"]);
    await expect(
      client.readResource({ uri: resources[0].uri }),
    ).resolves.toBeDefined();
    await expect(client.readResource({ uri: deniedUri })).rejects.toThrow();
  });

  it.each([
    ["resources/list", async (client: Client) => client.listResources()],
    [
      "resources/templates/list",
      async (client: Client) => client.listResourceTemplates(),
    ],
    [
      "resources/read",
      async (client: Client) =>
        client.readResource({ uri: "ui://docs/list-docs" }),
    ],
  ])("audits a suspended principal refused by %s", async (method, call) => {
    evaluateServicePrincipalMock.mockResolvedValue({
      status: "suspended",
      policy: { lifecycle: "suspended", allowedActions: null },
    });
    const client = await clientFor(serviceIdentity, widgetConfig(), cards);

    await expect(call(client)).rejects.toThrow(/suspended or retired/i);

    expect(recordActionAuditMock).toHaveBeenCalledTimes(1);
    expect(recordActionAuditMock.mock.calls[0][0]).toMatchObject({
      ctx: {
        actionName: `mcp:${method}`,
        userEmail: SVC,
        orgId: "org_1",
      },
      attribution: { caller: "mcp" },
      error: { statusCode: 403 },
    });
  });

  it("does not audit a retryable policy-store failure as a denial", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({ status: "unavailable" });
    const client = await clientFor(serviceIdentity, widgetConfig(), cards);

    await expect(
      client.readResource({ uri: "ui://docs/list-docs" }),
    ).rejects.toThrow(/could not be verified/i);

    expect(recordActionAuditMock).not.toHaveBeenCalled();
  });
});
