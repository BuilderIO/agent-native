import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isOutsideAgentCall } from "../action-caller.js";
import type { ActionRunContext } from "../action.js";
import {
  createMCPServerForRequest,
  type MCPCallerIdentity,
  type MCPConfig,
} from "./build-server.js";
import { frameworkMcpTool } from "./framework-tools.js";

vi.mock("../audit/record.js", () => ({
  recordActionAudit: vi.fn(async () => {}),
}));

let grant: string[] | null = null;

vi.mock("../org/service-principal-guard.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../org/service-principal-guard.js")
  >()),
  assertServicePrincipalMayRun: vi.fn(async () => ({ allowedActions: grant })),
}));

const trackedCalls: Array<Record<string, unknown>> = [];

vi.mock("./analytics.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./analytics.js")>()),
  trackMcpToolCall: (_ctx: unknown, payload: Record<string, unknown>) => {
    trackedCalls.push(payload);
  },
}));

vi.mock("../agent/production-agent.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../agent/production-agent.js")>()),
  getJevContextCredentials: vi.fn(async () => ({})),
}));

vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));

vi.mock("../org/context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../org/context.js")>()),
  resolveOrgIdForEmail: vi.fn(async () => null),
}));

const alice: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: null,
  orgDomain: undefined,
};

const runs: Array<{ name: string; args: unknown }> = [];

function action(name: string, extra: Record<string, unknown> = {}) {
  return {
    tool: {
      description: `${name} description`,
      parameters: {
        type: "object" as const,
        properties: { id: { type: "string" } },
      },
    },
    run: async (args: unknown) => {
      runs.push({ name, args });
      return { ran: name, args };
    },
    ...extra,
  };
}

function searchTool() {
  return {
    tool: {
      description: "Discover callable tools",
      parameters: {
        type: "object" as const,
        properties: {
          query: { type: "string" },
          task: { type: "string" },
          names: { type: "array", items: { type: "string" } },
        },
      },
    },
    readOnly: true,
    run: async () => ({ results: [] }),
  };
}

function actions(): Record<string, unknown> {
  return {
    "tool-search": frameworkMcpTool(searchTool()),
    "get-plan": action("get-plan", { readOnly: true, mcpTool: true }),
    "archive-plan": action("archive-plan", { mcpTool: "search" }),
    "purge-plan": action("purge-plan", {
      mcpTool: "search",
      needsApproval: true,
    }),
    "sync-plan": action("sync-plan", {
      mcpTool: "search",
      mcpAnnotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    }),
    "plan-history": action("plan-history", {
      readOnly: true,
      mcpTool: "search",
    }),
    "plan-settings": action("plan-settings", { mcpTool: false }),
    "draft-plan": action("draft-plan"),
  };
}

function config(overrides: Partial<MCPConfig> = {}): MCPConfig {
  const all = actions();
  return {
    name: "Plan",
    appId: "plan",
    description: "Plan agent",
    askAgent: async () => "agent reply",
    actions: all,
    productionActions: all,
    connectorCatalog: ["get-plan"],
    ...overrides,
  } as MCPConfig;
}

async function clientFor(
  mcpConfig: MCPConfig = config(),
  fullCatalog = false,
  requestMeta: { inlineMcpApps?: boolean } = {},
) {
  const server = await createMCPServerForRequest(mcpConfig, alice, {
    origin: "http://localhost:8100",
    transport: "http",
    fullCatalog,
    ...requestMeta,
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return client;
}

interface ToolResult {
  isError?: boolean;
  content: Array<{ text?: string }>;
  _meta?: Record<string, unknown>;
}

interface SearchResult {
  name: string;
  callWith?: string;
}

const asToolResult = (result: unknown) => result as ToolResult;

const textOf = (result: ToolResult): string =>
  result.content.map((part) => part.text).join("\n");

async function listed(client: Client) {
  const { tools } = await client.listTools();
  return new Map(tools.map((tool) => [tool.name, tool]));
}

async function viaCallTool(client: Client, args: Record<string, unknown>) {
  return asToolResult(
    await client.callTool({
      name: "call-tool",
      arguments: args,
    }),
  );
}

beforeEach(() => {
  runs.length = 0;
  trackedCalls.length = 0;
  grant = null;
});

async function searched(client: Client, names: string[]) {
  const out = asToolResult(
    await client.callTool({
      name: "tool-search",
      arguments: { names },
    }),
  );
  expect(out.isError).toBeFalsy();
  const { results } = JSON.parse(textOf(out)) as { results: SearchResult[] };
  return new Map(results.map((result) => [result.name, result]));
}

function withOwnCallTool(): MCPConfig {
  const own = action("call-tool", { mcpTool: true });
  return config({
    actions: { ...actions(), "call-tool": own },
    productionActions: { ...actions(), "call-tool": own },
    connectorCatalog: ["get-plan", "call-tool"],
  });
}

describe('tools/list with mcpTool: "search" actions', () => {
  it("lists call-tool in place of the unlisted tools", async () => {
    const tools = await listed(await clientFor());
    expect([...tools.keys()]).toEqual(
      expect.arrayContaining(["get-plan", "tool-search", "call-tool"]),
    );
    for (const name of [
      "archive-plan",
      "purge-plan",
      "sync-plan",
      "plan-history",
      "plan-settings",
      "draft-plan",
    ]) {
      expect(tools.has(name)).toBe(false);
    }

    const callTool = tools.get("call-tool");
    expect(callTool?.description).toContain("callWith: call-tool");
    expect(callTool?.description).toContain("same checks and approvals");
    expect(callTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
    });
    const properties = callTool?.inputSchema.properties as
      | Record<string, { description?: string }>
      | undefined;
    expect(properties?.name.description).toContain("exact name");
    expect(properties?.arguments.description).toContain("parameters");
    expect(callTool?.annotations?.title).toBeTruthy();
  });

  it("gives call-tool hints that cover every tool behind it", async () => {
    const callTool = (await listed(await clientFor())).get("call-tool");
    expect(callTool?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });

    const readsOnly = await listed(
      await clientFor(config({ externalAgents: { writes: "ask_app_only" } })),
    );
    expect(readsOnly.get("call-tool")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it("keeps an app's own call-tool action and lists the tools it would hide", async () => {
    const tools = await listed(await clientFor(withOwnCallTool()));
    expect(tools.get("call-tool")?.description).toContain(
      "call-tool description",
    );
    for (const name of ["archive-plan", "purge-plan", "plan-history"]) {
      expect(tools.has(name)).toBe(true);
    }
    expect(tools.has("plan-settings")).toBe(false);
    expect(tools.has("draft-plan")).toBe(false);
  });

  it.each(["tool-search", "call-tool"])(
    "lists the tools it would hide when %s is denied",
    async (denied) => {
      const tools = await listed(
        await clientFor(config({ externalAgents: { denyActions: [denied] } })),
      );
      expect(tools.has(denied)).toBe(false);
      expect(tools.has("call-tool")).toBe(false);
      for (const name of ["archive-plan", "purge-plan", "plan-history"]) {
        expect(tools.has(name)).toBe(true);
      }
      expect(tools.has("plan-settings")).toBe(false);
    },
  );

  it("lists the tools it would hide when the app brings its own tool-search", async () => {
    const all = { ...actions(), "tool-search": searchTool() };
    const tools = await listed(
      await clientFor(config({ actions: all, productionActions: all })),
    );
    expect(tools.has("tool-search")).toBe(true);
    expect(tools.has("call-tool")).toBe(false);
    for (const name of ["archive-plan", "purge-plan", "plan-history"]) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("doesn't mark a search result for a denied call-tool", async () => {
    const found = await searched(
      await clientFor(
        config({ externalAgents: { denyActions: ["call-tool"] } }),
      ),
      ["archive-plan"],
    );
    expect(found.get("archive-plan")).toBeDefined();
    expect(found.get("archive-plan")?.callWith).toBeUndefined();
  });

  it("lists no call-tool when nothing is unlisted", async () => {
    const decided = Object.fromEntries(
      Object.entries(actions()).map(([name, entry]) => [
        name,
        (entry as { mcpTool?: unknown }).mcpTool === "search"
          ? { ...(entry as object), mcpTool: true }
          : entry,
      ]),
    );
    const tools = await listed(
      await clientFor(config({ actions: decided, productionActions: decided })),
    );
    expect(tools.has("archive-plan")).toBe(true);
    expect(tools.has("call-tool")).toBe(false);
  });

  it("lists a tool the app's connectorCatalog names, and leaves the others unlisted", async () => {
    const client = await clientFor(
      config({ connectorCatalog: ["get-plan", "archive-plan"] }),
    );
    const tools = await listed(client);
    expect(tools.has("archive-plan")).toBe(true);
    expect(tools.has("plan-history")).toBe(false);
    expect(tools.has("call-tool")).toBe(true);

    const found = await searched(client, ["archive-plan", "plan-history"]);
    expect(found.get("archive-plan")?.callWith).toBeUndefined();
    expect(found.get("plan-history")?.callWith).toBe("call-tool");

    const out = await viaCallTool(client, { name: "archive-plan" });
    expect(out.isError).toBe(true);
    const direct = asToolResult(
      await client.callTool({
        name: "archive-plan",
        arguments: { id: "plan-9" },
      }),
    );
    expect(direct.isError).toBeFalsy();
    expect(runs).toEqual([{ name: "archive-plan", args: { id: "plan-9" } }]);
  });

  it("keeps a compact-catalog tool listed until the app names its own list", async () => {
    const all = {
      ...actions(),
      "share-plan": action("share-plan", {
        mcpTool: "search",
        mcpApp: { compactCatalog: true },
      }),
    };
    const compact = await listed(
      await clientFor(
        config({
          actions: all,
          productionActions: all,
          connectorCatalog: undefined,
        }),
      ),
    );
    expect(compact.has("share-plan")).toBe(true);
    expect(compact.has("archive-plan")).toBe(false);

    const curatedClient = await clientFor(
      config({ actions: all, productionActions: all }),
    );
    expect((await listed(curatedClient)).has("share-plan")).toBe(false);
    const found = await searched(curatedClient, ["share-plan"]);
    expect(found.get("share-plan")?.callWith).toBe("call-tool");
  });

  it("lists the unlisted tools on the full catalog, which has no call-tool", async () => {
    const client = await clientFor(config(), true);
    const tools = await listed(client);
    expect(tools.has("archive-plan")).toBe(true);
    expect(tools.has("plan-history")).toBe(true);
    expect(tools.has("call-tool")).toBe(false);

    const out = await viaCallTool(client, { name: "plan-history" });
    expect(out.isError).toBe(true);
    expect(runs).toEqual([]);
  });
});

describe("tool hints outside the directory catalog", () => {
  it("takes an action's own hints, then its defaults, then what it declares", async () => {
    const own = {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    };
    const defaults = {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    };
    const all = {
      "read-plan": action("read-plan", { readOnly: true }),
      "edit-plan": action("edit-plan"),
      "send-plan": action("send-plan", { needsApproval: true }),
      "publish-plan": action("publish-plan", {
        publicAgent: { isConsequential: true },
      }),
      "own-hints": action("own-hints", {
        mcpAnnotations: own,
        mcpAnnotationDefaults: defaults,
      }),
      "default-hints": action("default-hints", {
        mcpAnnotationDefaults: defaults,
      }),
    };
    const tools = await listed(
      await clientFor(
        config({ actions: all, productionActions: all }) as MCPConfig,
        true,
      ),
    );
    const hints = (name: string) => {
      const { title: _, ...rest } = { ...tools.get(name)?.annotations };
      return rest;
    };
    expect(hints("read-plan")).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(hints("edit-plan")).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(hints("send-plan")).toMatchObject({ destructiveHint: true });
    expect(hints("publish-plan")).toMatchObject({ destructiveHint: true });
    expect(hints("own-hints")).toEqual(own);
    expect(hints("default-hints")).toEqual(defaults);
  });
});

describe("tool-search with unlisted tools", () => {
  it("finds them and marks each to run with call-tool", async () => {
    const byName = await searched(await clientFor(), [
      "plan-history",
      "get-plan",
      "draft-plan",
    ]);
    expect(byName.get("plan-history")?.callWith).toBe("call-tool");
    expect(byName.get("get-plan")).toBeDefined();
    expect(byName.get("get-plan")?.callWith).toBeUndefined();
    expect(byName.has("draft-plan")).toBe(false);
  });

  it("finds only the tools a service principal's grant allows", async () => {
    grant = ["tool-search", "call-tool", "get-plan", "plan-history"];
    const client = await clientFor(
      config({ connectorCatalog: ["get-plan", "draft-plan"] }),
    );
    const byName = await searched(client, [
      "get-plan",
      "draft-plan",
      "plan-history",
      "archive-plan",
    ]);
    expect([...byName.keys()].sort()).toEqual(["get-plan", "plan-history"]);
    expect(byName.get("plan-history")?.callWith).toBe("call-tool");
  });

  it("marks the unlisted tools it recommends for a task", async () => {
    const out = asToolResult(
      await (
        await clientFor()
      ).callTool({
        name: "tool-search",
        arguments: { task: "plan history" },
      }),
    );
    expect(out.isError).toBeFalsy();
    const { recommendations } = JSON.parse(textOf(out)) as {
      recommendations: Array<SearchResult & { kind: string }>;
    };
    const tools = recommendations.filter((item) => item.kind === "tool");
    expect(tools.map((item) => item.name)).toContain("plan-history");
    const unlisted = [
      "archive-plan",
      "purge-plan",
      "sync-plan",
      "plan-history",
    ];
    for (const item of tools) {
      expect(item.callWith).toBe(
        unlisted.includes(item.name) ? "call-tool" : undefined,
      );
    }
  });

  it("marks nothing for call-tool when the app has its own", async () => {
    const byName = await searched(await clientFor(withOwnCallTool()), [
      "plan-history",
      "archive-plan",
    ]);
    expect(byName.get("plan-history")).toBeDefined();
    expect(byName.get("plan-history")?.callWith).toBeUndefined();
    expect(byName.get("archive-plan")?.callWith).toBeUndefined();
  });
});

describe("the widget of an unlisted tool", () => {
  function withUnlistedWidget(): MCPConfig {
    const all = {
      ...actions(),
      "plan-history": action("plan-history", {
        readOnly: true,
        mcpTool: "search",
        mcpApp: {
          resource: { title: "History", html: "<main>history</main>" },
        },
      }),
    };
    return config({
      actions: all,
      productionActions: all,
    } as Partial<MCPConfig>);
  }
  const cards = { inlineMcpApps: true };

  it("can be read after call-tool names it in the result", async () => {
    grant = ["tool-search", "call-tool", "get-plan", "plan-history"];
    const client = await clientFor(withUnlistedWidget(), false, cards);
    const out = await viaCallTool(client, { name: "plan-history" });
    expect(out.isError).toBeFalsy();
    const uri = out._meta?.["openai/outputTemplate"];
    expect(uri).toEqual(expect.any(String));

    const { contents } = await client.readResource({ uri: String(uri) });
    expect(JSON.stringify(contents)).toContain("history");
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.name)).toEqual([
      "plan-history",
    ]);
  });

  it("stays out of reach outside a service principal's grant", async () => {
    grant = ["tool-search", "call-tool", "get-plan"];
    const client = await clientFor(withUnlistedWidget(), false, cards);
    const { resources } = await client.listResources();
    expect(resources).toEqual([]);
  });
});

describe("tools/call through call-tool", () => {
  it("runs the unlisted tool it names, with its arguments", async () => {
    const out = await viaCallTool(await clientFor(), {
      name: "archive-plan",
      arguments: { id: "plan-7" },
    });
    expect(out.isError).toBeFalsy();
    expect(runs).toEqual([{ name: "archive-plan", args: { id: "plan-7" } }]);
  });

  it("trims the name and runs a tool given no arguments", async () => {
    const out = await viaCallTool(await clientFor(), {
      name: "  plan-history ",
    });
    expect(out.isError).toBeFalsy();
    expect(runs.map((run) => run.name)).toEqual(["plan-history"]);
  });

  it("holds an unlisted tool that asks outside agents for approval", async () => {
    const all = {
      ...actions(),
      "decide-plan": action("decide-plan", {
        mcpTool: "search",
        needsApproval: (_args: unknown, ctx?: ActionRunContext) =>
          isOutsideAgentCall(ctx),
      }),
    };
    const out = await viaCallTool(
      await clientFor(config({ actions: all, productionActions: all })),
      { name: "decide-plan", arguments: { id: "plan-3" } },
    );
    expect(out.isError).toBe(true);
    expect(textOf(out)).toContain("decide-plan needs the user's approval");
    expect(runs).toEqual([]);
  });

  it("also runs an unlisted tool called by name", async () => {
    const client = await clientFor();
    const out = asToolResult(
      await client.callTool({
        name: "archive-plan",
        arguments: { id: "plan-8" },
      }),
    );
    expect(out.isError).toBeFalsy();
    expect(runs).toEqual([{ name: "archive-plan", args: { id: "plan-8" } }]);
  });

  it("runs nothing but the unlisted tools", async () => {
    const client = await clientFor();
    for (const [args, message] of [
      [{ name: "get-plan", arguments: { id: "plan-1" } }, "isn't one"],
      [{ name: "draft-plan" }, "isn't one"],
      [{ name: "plan-settings" }, "isn't one"],
      [{ name: "call-tool" }, "isn't one"],
      [{}, "exact name"],
      [{ name: "   " }, "exact name"],
      [{ name: 7 }, "exact name"],
      [{ name: "archive-plan", arguments: "plan-7" }, "as an object"],
      [{ name: "archive-plan", arguments: ["plan-7"] }, "as an object"],
    ] as const) {
      const out = await viaCallTool(client, args);
      expect(out.isError).toBe(true);
      expect(textOf(out)).toContain(message);
    }
    expect(runs).toEqual([]);
  });

  it("refuses an ungranted name the same way whether or not it exists", async () => {
    grant = ["tool-search", "call-tool", "get-plan"];
    const client = await clientFor();
    const refusals: string[] = [];
    for (const name of ["archive-plan", "no-such-plan"]) {
      const out = await viaCallTool(client, { name });
      expect(out.isError).toBe(true);
      refusals.push(textOf(out).replace(name, "NAME"));
    }
    expect(refusals[0]).toContain("not permitted");
    expect(refusals[1]).toBe(refusals[0]);
    expect(runs).toEqual([]);
  });

  it("records the tool it ran and that tool's arguments", async () => {
    await viaCallTool(await clientFor(), {
      name: "archive-plan",
      arguments: { id: "plan-1" },
    });
    expect(trackedCalls).toEqual([
      expect.objectContaining({
        toolName: "archive-plan",
        parameters: { id: "plan-1" },
      }),
    ]);
  });

  it("calls an app's own call-tool action instead", async () => {
    const client = await clientFor(withOwnCallTool());
    const out = await viaCallTool(client, { name: "archive-plan" });
    expect(out.isError).toBeFalsy();
    expect(runs.map((run) => run.name)).toEqual(["call-tool"]);
  });

  it("keeps a denied action out of call-tool and tool-search", async () => {
    const client = await clientFor(
      config({ externalAgents: { denyActions: ["archive-plan"] } }),
    );
    const out = await viaCallTool(client, {
      name: "archive-plan",
      arguments: { id: "plan-7" },
    });
    expect(out.isError).toBe(true);
    const found = asToolResult(
      await client.callTool({
        name: "tool-search",
        arguments: { names: ["archive-plan"] },
      }),
    );
    expect(JSON.parse(textOf(found)).results).toEqual([]);
    expect(runs).toEqual([]);
  });

  it("runs only unlisted reads when writes go through ask_app", async () => {
    const client = await clientFor(
      config({ externalAgents: { writes: "ask_app_only" } }),
    );
    const write = await viaCallTool(client, {
      name: "archive-plan",
      arguments: { id: "plan-7" },
    });
    expect(write.isError).toBe(true);
    const read = await viaCallTool(client, { name: "plan-history" });
    expect(read.isError).toBeFalsy();
    expect(runs.map((run) => run.name)).toEqual(["plan-history"]);
  });
});
