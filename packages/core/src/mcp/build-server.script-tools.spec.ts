import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRequestContext } from "../server/request-context.js";
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
const trackMcpToolCallMock = vi.fn((_ctx: unknown, _args: any) => {});
vi.mock("./analytics.js", async (importActual) => ({
  ...(await importActual<typeof import("./analytics.js")>()),
  trackMcpToolCall: (ctx: unknown, args: any) =>
    trackMcpToolCallMock(ctx, args),
}));
vi.mock("../audit/record.js", () => ({
  recordActionAudit: (input: any) => recordActionAuditMock(input),
}));
vi.mock("../server/better-auth-instance.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/better-auth-instance.js")
  >()),
  findBetterAuthUserIdForEmail: vi.fn(async () => undefined),
}));

const TICKET = "leaked-ticket-0123456789abcdef";
const runs: Array<{
  name: string;
  userEmail: string | undefined;
  runId?: string;
}> = [];

function config(): MCPConfig {
  const action = (
    name: string,
    fields: Record<string, unknown>,
    value: (args: any) => unknown = () => ({ ok: name }),
  ) =>
    ({
      tool: { description: `Tool ${name}`, parameters: undefined },
      run: async (args: any, ctx: any) => {
        runs.push({
          name,
          userEmail: getRequestContext()?.userEmail,
          runId: ctx?.runId,
        });
        return value(args);
      },
      ...fields,
    }) as any;
  return {
    name: "Docs",
    appId: "docs",
    description: "Test app",
    builtinCrossAppTools: false,
    actions: {
      "get-document": action(
        "get-document",
        {
          readOnly: true,
          mcpTool: true,
          mcpScript: "read",
          tool: {
            description: "Read one document",
            parameters: {
              type: "object",
              properties: { id: { type: "string" } },
              required: ["id"],
            },
          },
        },
        (args) => ({
          id: args.id,
          title: "Plan",
          body: "b".repeat(5_000),
          start: `https://docs.example/_agent-native/embed/start?ticket=${TICKET}`,
        }),
      ),
      "list-documents": action(
        "list-documents",
        { readOnly: true, mcpTool: true, mcpScript: "read" },
        () => [{ id: "doc_1" }, { id: "doc_2" }],
      ),
      "plain-read": action("plain-read", { readOnly: true, mcpTool: true }),
      // Opted in, but a direct call on the default catalog cannot reach it.
      "list-archived": action("list-archived", {
        readOnly: true,
        mcpScript: "read",
      }),
      // Opted in, but takes a raw query, which MCP carries only when the
      // action allows it.
      "query-documents": action("query-documents", {
        readOnly: true,
        mcpTool: true,
        mcpScript: "read",
        tool: {
          description: "Query documents",
          parameters: {
            type: "object",
            properties: { sql: { type: "string" } },
          },
        },
      }),
      // A hand-built entry can declare the opt-in on a write; the policy
      // reads the real classification.
      "delete-document": action("delete-document", {
        readOnly: false,
        mcpTool: true,
        mcpScript: "read",
      }),
      // Declares the opt-in, but runs other code, so it is refused by name.
      "run-code": action("run-code", { readOnly: true, mcpScript: "read" }),
    },
  };
}

async function clientFor(
  identity: MCPCallerIdentity,
  requestMeta: Record<string, unknown> = { scriptCatalog: true },
) {
  const server = await createMCPServerForRequest(config(), identity, {
    origin: "http://localhost:8100",
    transport: "http",
    inlineMcpApps: false,
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

const user: MCPCallerIdentity = {
  userEmail: "alice@example.com",
  identityAssurance: "user",
  orgId: "org_1",
  orgDomain: undefined,
};

const service: MCPCallerIdentity = {
  userEmail: "svc-ci@service.org_1",
  identityAssurance: "service",
  orgId: "org_1",
  orgDomain: undefined,
};

function textOf(result: any): string {
  return result.content.map((c: any) => c.text).join("\n");
}

async function runScript(client: Client, code: string) {
  const result: any = await client.callTool({
    name: "run-script",
    arguments: { code },
  });
  return { result, payload: JSON.parse(textOf(result)) };
}

beforeEach(() => {
  vi.clearAllMocks();
  runs.length = 0;
  vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_TOOLS", "true");
  evaluateServicePrincipalMock.mockResolvedValue({ status: "not-service" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the MCP script catalog", () => {
  it("lists only search-actions and run-script, with run-script read-only", async () => {
    const client = await clientFor(user);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toEqual([
      "run-script",
      "search-actions",
    ]);
    const run = tools.find((tool) => tool.name === "run-script")!;
    expect(run.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(run.description).toContain("api.getDocument");
    expect(run.description).toContain("api.listDocuments");
    for (const refused of [
      "plainRead",
      "deleteDocument",
      "runCode",
      "listArchived",
      "queryDocuments",
    ]) {
      expect(run.description).not.toContain(`api.${refused}`);
    }
  });

  it("keeps today's catalog without the opt-in or with the flag off", async () => {
    const usual = (await (await clientFor(user, {})).listTools()).tools.map(
      (tool) => tool.name,
    );
    expect(usual).not.toContain("run-script");

    vi.stubEnv("AGENT_NATIVE_MCP_SCRIPT_TOOLS", "false");
    const flagOff = (await (await clientFor(user)).listTools()).tools.map(
      (tool) => tool.name,
    );
    expect(flagOff).toEqual(usual);
  });

  it("leaves a directory catalog closed when a connection asks for scripts", async () => {
    const directory = async (requestMeta: Record<string, unknown>) => {
      const base = config();
      const server = await createMCPServerForRequest(
        {
          ...base,
          catalogMode: "directory",
          widgetDomain: "https://docs.example",
          connectorCatalog: ["get-document"],
          actions: {
            ...base.actions,
            "get-document": {
              ...base.actions["get-document"],
              mcpAnnotations: {
                readOnlyHint: true,
                destructiveHint: false,
                openWorldHint: false,
              },
            },
          },
        },
        user,
        {
          origin: "http://localhost:8100",
          transport: "http",
          inlineMcpApps: false,
          ...requestMeta,
        } as any,
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await Promise.all([
        client.connect(clientTransport),
        server.connect(serverTransport),
      ]);
      return (await client.listTools()).tools.map((tool) => tool.name);
    };
    const usual = await directory({});
    expect(usual).toContain("get-document");
    expect(await directory({ scriptCatalog: true })).toEqual(usual);
  });

  it("refuses every other tool name on the script catalog", async () => {
    const client = await clientFor(user);
    const result: any = await client.callTool({
      name: "get-document",
      arguments: { id: "doc_1" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Unknown tool: get-document");
    expect(runs).toEqual([]);
  });

  it("returns declarations for what this caller's scripts can call", async () => {
    const client = await clientFor(user);
    const result: any = await client.callTool({
      name: "search-actions",
      arguments: { names: ["getDocument", "deleteDocument"] },
    });
    const text = textOf(result);
    expect(text).toMatch(
      /getDocument: \(args: \{\s+id: string;\s+\}\) => Promise<unknown>;/,
    );
    expect(text).toContain('// Not available to scripts: "deleteDocument".');
  });

  it("runs a script as the caller and gives it the full value with embed tickets redacted", async () => {
    const client = await clientFor(user);
    const { result, payload } = await runScript(
      client,
      `
        const docs = await api.listDocuments();
        const doc = await api.getDocument({ id: docs[0].id });
        return { title: doc.title, length: doc.body.length, start: doc.start };
      `,
    );
    expect(result.isError).toBeUndefined();
    expect(payload.ok).toBe(true);
    // More than the 2,000 characters a direct call's text carries.
    expect(payload.result.length).toBe(5_000);
    expect(payload.result.title).toBe("Plan");
    expect(textOf(result)).not.toContain(TICKET);
    expect(runs.map((run) => [run.name, run.userEmail])).toEqual([
      ["list-documents", "alice@example.com"],
      ["get-document", "alice@example.com"],
    ]);
    // Every call carries the script's run id into its audit context.
    expect(runs.every((run) => run.runId === payload.runId)).toBe(true);
  });

  it("keeps what a script threw out of analytics", async () => {
    const client = await clientFor(user);
    const { payload } = await runScript(
      client,
      `const doc = await api.getDocument({ id: "doc_1" }); throw new Error("read " + doc.title);`,
    );
    expect(payload.ok).toBe(false);
    expect(payload.error.message).toContain("read Plan");
    const reported = trackMcpToolCallMock.mock.calls.map(([, args]) => args);
    expect(reported).toEqual([
      expect.objectContaining({
        toolName: "run-script",
        isError: true,
        errorType: payload.error.code,
        errorMessage: `The script failed: ${payload.error.code}.`,
      }),
    ]);
    expect(JSON.stringify(reported)).not.toContain("read Plan");
  });

  it("gives analytics a script's length, not its source", async () => {
    const client = await clientFor(user);
    const code = `return "https://docs.example/_agent-native/embed/start?ticket=${TICKET}";`;
    await runScript(client, code);
    const reported = trackMcpToolCallMock.mock.calls.map(([, args]) => args);
    expect(reported).toEqual([
      expect.objectContaining({
        toolName: "run-script",
        parameters: { code: `(a script of ${code.length} characters)` },
      }),
    ]);
    expect(JSON.stringify(reported)).not.toContain(TICKET);
  });

  it("refuses bridge calls outside the policy and records each in the audit log", async () => {
    const client = await clientFor(user, {
      scriptCatalog: true,
      clientName: "ScriptClient/1.0",
    });
    const { payload } = await runScript(
      client,
      `
        const codes = [];
        for (const name of ["deleteDocument", "runCode", "plainRead"]) {
          codes.push((await __host.call(name, { id: "doc_1" })).code);
        }
        return codes;
      `,
    );
    // `run-code` never reaches the MCP surface, so a script sees no such
    // function; scripts refuse it by name as well (script-tools.spec.ts).
    expect(payload.result).toEqual([
      "mutating",
      "unknown-function",
      "not-opted-in",
    ]);
    expect(runs).toEqual([]);
    const audited = recordActionAuditMock.mock.calls.map(([input]) => input);
    expect(audited.map((input) => input.ctx.actionName)).toEqual([
      "delete-document",
      "api.(unknown)",
      "plain-read",
    ]);
    for (const input of audited) {
      expect(input.status).toBe("error");
      expect(input.error.statusCode).toBe(403);
      expect(input.ctx.userEmail).toBe("alice@example.com");
      expect(input.attribution).toMatchObject({
        caller: "mcp",
        runId: payload.runId,
      });
      // The User-Agent, as a direct call records it.
      expect(JSON.stringify(input.attribution)).toContain("ScriptClient/1.0");
    }
  });

  it("reaches only what a direct call could, with inputs MCP may carry", async () => {
    const script = `
      const codes = [];
      for (const call of [
        () => api.listArchived(),
        () => api.queryDocuments({ sql: "select 1" }),
      ]) {
        try { await call(); codes.push("ran"); } catch (error) {
          codes.push(error.code);
        }
      }
      return codes;
    `;
    const { payload } = await runScript(await clientFor(user), script);
    expect(payload.result).toEqual(["unknown-function", "unknown-function"]);
    expect(runs).toEqual([]);

    // The full catalog reaches every action, but never the raw query.
    const full = await clientFor(user, {
      scriptCatalog: true,
      fullCatalog: true,
    });
    expect((await runScript(full, script)).payload.result).toEqual([
      "ran",
      "unknown-function",
    ]);
    expect(runs.map((run) => run.name)).toEqual(["list-archived"]);
  });

  it("offers nothing to an OAuth token without mcp:read", async () => {
    const client = await clientFor({ ...user, oauthScopes: ["mcp:apps"] });
    expect((await client.listTools()).tools).toEqual([]);
    const result: any = await client.callTool({
      name: "run-script",
      arguments: { code: "return await api.listDocuments();" },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "Forbidden: OAuth scope does not allow run-script",
    );
    expect(runs).toEqual([]);
  });

  it("keeps a script inside the caller's service grant", async () => {
    evaluateServicePrincipalMock.mockResolvedValue({
      status: "active",
      policy: {
        lifecycle: "active",
        allowedActions: ["run-script", "search-actions", "list-documents"],
      },
    });
    const client = await clientFor(service);
    const { payload } = await runScript(
      client,
      `
        const list = await api.listDocuments();
        let refused;
        try { await api.getDocument({ id: "doc_1" }); } catch (error) {
          refused = error.code;
        }
        return { count: list.length, refused };
      `,
    );
    expect(payload.result).toEqual({ count: 2, refused: "unknown-function" });
    expect(runs.map((run) => run.name)).toEqual(["list-documents"]);

    // A grant that leaves out run-script offers no script tools at all.
    evaluateServicePrincipalMock.mockResolvedValue({
      status: "active",
      policy: { lifecycle: "active", allowedActions: ["list-documents"] },
    });
    const ungranted = await clientFor(service);
    expect((await ungranted.listTools()).tools).toEqual([]);
    const result: any = await ungranted.callTool({
      name: "run-script",
      arguments: { code: "return 1;" },
    });
    expect(result.isError).toBe(true);
  });
});
