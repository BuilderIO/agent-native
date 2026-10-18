import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import {
  actionArgumentsHash,
  UnsupportedActionArgumentError,
} from "./action-arguments-identity.js";
import {
  actionCallIntent,
  defineAction,
  failedCallEmitsChange,
  ActionContractError,
  ActionOutputContractError,
  isActionContractError,
  isActionOutputContractError,
  runActionWithExecutionOutcome,
  invocationEffect,
  type ActionExecutionOutcome,
  type ActionRunContext,
  AgentActionStopError,
  AgentConnectionRequiredError,
  isAgentActionStopError,
  isAgentConnectionRequiredError,
  isActionExposedToExternalAgents,
  isActionHiddenFromEveryAgentSurface,
  preparedCallArguments,
  recordInvalidActionCall,
  runPreparedActionCall,
  validateActionArgs,
} from "./action.js";
import {
  actionsToEngineTools,
  createPlanModeActionRegistry,
} from "./agent/production-agent.js";
import {
  usableInputSchema,
  UnusableSchemaError,
} from "./json-schema/unusable-schema.js";
import { createMCPServerForRequest } from "./mcp/build-server.js";
import { providerSchemaViolations } from "./mcp/provider-schema-conformance.js";
import { mcpToolInputSchema } from "./mcp/tool-input-schema.js";
import { loadActionsFromStaticRegistry } from "./server/action-discovery.js";
import { createUrlTools } from "./server/agent-chat/context-tools.js";
import { filesystemActionEntry } from "./server/filesystem-action-entry.js";

/** Runs `entry` as a dispatcher does: what it observed, and what it threw. */
async function dispatch(
  entry: { run(args: any, ctx?: ActionRunContext): unknown },
  args: unknown,
  ctx: ActionRunContext,
) {
  const outcome: ActionExecutionOutcome = { refused: false };
  const error = await runActionWithExecutionOutcome(
    entry.run as (args: any, ctx?: ActionRunContext) => Promise<any>,
    args,
    ctx,
    outcome,
    entry,
  ).then(
    () => undefined,
    (err: unknown) => err,
  );
  return { outcome, error };
}

describe("ActionContractError", () => {
  it("carries only explicitly safe structured contract details", () => {
    const error = new ActionContractError("Stale schema", {
      errorCode: "SCHEMA_REVISION_CONFLICT",
      details: { expected: "before", actual: "after" },
    });
    expect(isActionContractError(error)).toBe(true);
    expect(error).toMatchObject({
      statusCode: 409,
      errorCode: "SCHEMA_REVISION_CONFLICT",
      details: { expected: "before", actual: "after" },
    });
  });
});

describe("defineAction", () => {
  it("infers readOnly=true for GET actions", () => {
    const action = defineAction({
      description: "read things",
      parameters: { id: { type: "string" } },
      http: { method: "GET" },
      run: async () => ({ ok: true }),
    });
    expect(action.readOnly).toBe(true);
  });

  it("carries the grounding declaration through to the entry", () => {
    const action = defineAction({
      description: "query a provider",
      parameters: { q: { type: "string" } },
      http: false,
      grounding: true,
      run: async () => "ok",
    });
    expect(action.grounding).toBe(true);
  });

  it("leaves grounding undefined when the action does not declare it", () => {
    const action = defineAction({
      description: "list saved config",
      parameters: { id: { type: "string" } },
      http: { method: "GET" },
      run: async () => "ok",
    });
    expect(action.grounding).toBeUndefined();
  });

  it("leaves readOnly undefined for default POST actions", () => {
    const action = defineAction({
      description: "write things",
      parameters: { value: { type: "string" } },
      run: async () => ({ ok: true }),
    });
    expect(action.readOnly).toBeUndefined();
  });

  it("leaves readOnly undefined when http is false (agent-only)", () => {
    const action = defineAction({
      description: "agent-only",
      parameters: { x: { type: "string" } },
      http: false,
      run: async () => "ok",
    });
    expect(action.readOnly).toBeUndefined();
  });

  it("leaves readOnly undefined for explicit POST", () => {
    const action = defineAction({
      description: "post",
      parameters: { x: { type: "string" } },
      http: { method: "POST" },
      run: async () => "ok",
    });
    expect(action.readOnly).toBeUndefined();
  });

  it("honors explicit readOnly=true even on POST", () => {
    const action = defineAction({
      description: "read-only post",
      parameters: { x: { type: "string" } },
      http: { method: "POST" },
      readOnly: true,
      run: async () => "ok",
    });
    expect(action.readOnly).toBe(true);
  });

  it("honors explicit readOnly=false even on GET (overrides method inference)", () => {
    const action = defineAction({
      description: "mutating get",
      parameters: { x: { type: "string" } },
      http: { method: "GET" },
      readOnly: false,
      run: async () => "ok",
    });
    expect(action.readOnly).toBe(false);
  });

  it("preserves explicit parallelSafe metadata", () => {
    const action = defineAction({
      description: "safe same-turn write",
      parameters: { x: { type: "string" } },
      parallelSafe: true,
      run: async () => "ok",
    });
    expect(action.parallelSafe).toBe(true);
  });

  it("preserves explicit endsTurn metadata", () => {
    const action = defineAction({
      description: "puts a question form on screen",
      parameters: { x: { type: "string" } },
      endsTurn: true,
      run: async () => "ok",
    });
    expect(action.endsTurn).toBe(true);
  });

  it("preserves explicit duplicate-read opt-out metadata", () => {
    const action = defineAction({
      description: "volatile polling read",
      parameters: { id: { type: "string" } },
      readOnly: true,
      dedupe: false,
      run: async () => "ok",
    });
    expect(action.dedupe).toBe(false);
  });

  it("preserves a typed Plan-mode effect policy", () => {
    const classify = (args: { operation?: string }): "read" | "write" =>
      args.operation === "list" ? "read" : "write";
    const action = defineAction({
      description: "Manage records",
      parameters: {
        operation: {
          type: "string",
          enum: ["list", "create"],
        },
        persist: { type: "string" },
      },
      planMode: {
        effect: classify,
        allowedValues: { operation: ["list"] },
        allowedProperties: ["operation"],
        requiredProperties: ["operation"],
        omittedProperties: ["persist"],
        description: "Only listing is available.",
      },
      run: async () => "ok",
    });

    expect(action.planMode).toEqual({
      effect: classify,
      allowedValues: { operation: ["list"] },
      allowedProperties: ["operation"],
      requiredProperties: ["operation"],
      omittedProperties: ["persist"],
      description: "Only listing is available.",
    });
  });

  it("preserves per-tool timeout and result limits", () => {
    const action = defineAction({
      description: "slow provider call",
      parameters: { x: { type: "string" } },
      timeoutMs: 120_000,
      maxResultChars: 10_000,
      run: async () => "ok",
    });
    expect(action.timeoutMs).toBe(120_000);
    expect(action.maxResultChars).toBe(10_000);
  });

  it("threads through agentTool:false (frontend/HTTP-only, hidden from the agent)", () => {
    const action = defineAction({
      description: "sync UI selection",
      parameters: { id: { type: "string" } },
      agentTool: false,
      run: async () => "ok",
    });
    expect(action.agentTool).toBe(false);
  });

  it("leaves agentTool undefined when not specified (default-exposed)", () => {
    const action = defineAction({
      description: "normal action",
      parameters: { id: { type: "string" } },
      run: async () => "ok",
    });
    expect(action.agentTool).toBeUndefined();
  });

  it("threads through mcpTool and deferLoading, and leaves both undefined by default", () => {
    const external = defineAction({
      description: "share a plan with an external agent",
      parameters: { id: { type: "string" } },
      mcpTool: true,
      deferLoading: false,
      run: async () => "ok",
    });
    expect(external.mcpTool).toBe(true);
    expect(external.deferLoading).toBe(false);

    const inAppOnly = defineAction({
      description: "open the inspector panel",
      parameters: { id: { type: "string" } },
      mcpTool: false,
      deferLoading: true,
      run: async () => "ok",
    });
    expect(inAppOnly.mcpTool).toBe(false);
    expect(inAppOnly.deferLoading).toBe(true);

    const plain = defineAction({
      description: "normal action",
      parameters: { id: { type: "string" } },
      run: async () => "ok",
    });
    expect(plain.mcpTool).toBeUndefined();
    expect(plain.deferLoading).toBeUndefined();
  });

  it("resolves external exposure from mcpTool, falling back to agentTool", () => {
    expect(isActionExposedToExternalAgents({})).toBe(true);
    expect(isActionExposedToExternalAgents({ agentTool: false })).toBe(false);
    expect(isActionExposedToExternalAgents({ mcpTool: false })).toBe(false);
    expect(
      isActionExposedToExternalAgents({ agentTool: false, mcpTool: true }),
    ).toBe(true);
    expect(
      isActionExposedToExternalAgents({ agentTool: true, mcpTool: false }),
    ).toBe(false);

    expect(isActionExposedToExternalAgents({ endsTurn: true })).toBe(false);
    expect(
      isActionExposedToExternalAgents({ uiOnly: true, mcpTool: true }),
    ).toBe(false);
    expect(
      isActionExposedToExternalAgents({ endsTurn: true, agentTool: true }),
    ).toBe(false);
    expect(
      isActionExposedToExternalAgents({ endsTurn: true, mcpTool: true }),
    ).toBe(true);

    expect(isActionHiddenFromEveryAgentSurface({ agentTool: false })).toBe(
      true,
    );
    expect(
      isActionHiddenFromEveryAgentSurface({ agentTool: false, mcpTool: true }),
    ).toBe(false);
    expect(isActionHiddenFromEveryAgentSurface({ mcpTool: false })).toBe(false);
    expect(isActionHiddenFromEveryAgentSurface({ uiOnly: true })).toBe(true);
  });

  it("requires the frontend caller for UI-only actions", async () => {
    const run = vi.fn(async () => "ok");
    const action = defineAction({
      description: "delete data",
      parameters: {},
      uiOnly: true,
      run,
    });

    await expect(action.run({}, { caller: "tool" })).rejects.toMatchObject({
      errorCode: "ui_only_action",
      statusCode: 403,
    });
    await expect(action.run({}, { caller: "frontend" })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledOnce();
  });

  it("preserves valid MCP Apps resource metadata", () => {
    const action = defineAction({
      description: "review draft",
      parameters: { body: { type: "string" } },
      mcpApp: {
        visibility: ["model", "app"],
        resource: {
          title: "Review draft",
          html: "<!doctype html><html><body>Review</body></html>",
          csp: { connectDomains: ["https://mail.agent-native.com"] },
        },
      },
      run: async () => "ok",
    });
    expect(action.mcpApp?.resource.title).toBe("Review draft");
    expect(action.mcpApp?.resource.csp).toEqual({
      connectDomains: ["https://mail.agent-native.com"],
    });
  });

  it("preserves an action title for WebMCP and MCP hosts", () => {
    const action = defineAction({
      title: "Review draft",
      description: "review draft",
      parameters: {},
      run: async () => "ok",
    });

    expect(action.tool.title).toBe("Review draft");
  });

  it("drops malformed MCP Apps config", () => {
    const action = defineAction({
      description: "bad ui",
      parameters: {},
      mcpApp: { resource: { title: "Missing html" } },
      run: async () => "ok",
    } as any);
    expect(action.mcpApp).toBeUndefined();
  });

  it("drops malformed publicAgent / link / mcpApp config that is wrong-typed", () => {
    const action = defineAction({
      description: "wrong-typed metadata",
      parameters: {},
      publicAgent: ["expose"] as any,
      link: "not-a-function" as any,
      mcpApp: { resource: [] } as any,
      run: async () => "ok",
    } as any);
    expect(action.publicAgent).toBeUndefined();
    expect(action.link).toBeUndefined();
    expect(action.mcpApp).toBeUndefined();
  });

  it("threads through a valid link builder, publicAgent, and toolCallable=false", () => {
    const link = ({ result }: { args: any; result: any }) => ({
      url: `/_agent-native/open?id=${result.id}`,
      label: "Open",
    });
    const action = defineAction({
      description: "admin op",
      parameters: { id: { type: "string" } },
      toolCallable: false,
      publicAgent: { expose: true, readOnly: false },
      link,
      run: async () => ({ id: "abc" }),
    });
    expect(action.toolCallable).toBe(false);
    expect(action.publicAgent).toEqual({ expose: true, readOnly: false });
    expect(action.link).toBe(link);
    expect(action.link({ args: {}, result: { id: "abc" } })).toEqual({
      url: "/_agent-native/open?id=abc",
      label: "Open",
    });
  });

  it("preserves a boolean needsApproval flag on the returned entry", () => {
    const action = defineAction({
      description: "send an email",
      parameters: { to: { type: "string" } },
      needsApproval: true,
      run: async () => "sent",
    });
    expect(action.needsApproval).toBe(true);
  });

  it("preserves a predicate needsApproval gate on the returned entry", () => {
    const gate = (args: { to: string }) => args.to.endsWith("@external.com");
    const action = defineAction({
      description: "send an email",
      parameters: { to: { type: "string" } },
      needsApproval: gate,
      run: async () => "sent",
    });
    expect(action.needsApproval).toBe(gate);
  });

  it("preserves a per-call-only approval policy on the returned entry", () => {
    const action = defineAction({
      description: "send an email",
      parameters: { to: { type: "string" } },
      needsApproval: true,
      allowPersistentApproval: false,
      run: async () => "sent",
    });

    expect(action.allowPersistentApproval).toBe(false);
  });

  it("leaves needsApproval undefined when not specified (default off)", () => {
    const action = defineAction({
      description: "send an email",
      parameters: { to: { type: "string" } },
      run: async () => "sent",
    });
    expect(action.needsApproval).toBeUndefined();
  });

  it("drops a wrong-typed needsApproval value instead of threading it through", () => {
    const action = defineAction({
      description: "send an email",
      parameters: { to: { type: "string" } },
      needsApproval: "yes" as any,
      run: async () => "sent",
    } as any);
    expect(action.needsApproval).toBeUndefined();
  });

  it("omits http from the entry when http is not specified", () => {
    const action = defineAction({
      description: "no http",
      parameters: {},
      run: async () => "ok",
    });
    expect("http" in action).toBe(false);
  });

  it("preserves http:false so the entry stays agent-only", () => {
    const action = defineAction({
      description: "agent-only",
      parameters: {},
      http: false,
      run: async () => "ok",
    });
    expect(action.http).toBe(false);
  });
});

describe("defineAction schema mode — tool parameter JSON Schema", () => {
  it("converts a zod object into a JSON Schema with required vs optional fields", () => {
    const action = defineAction({
      description: "create form",
      schema: z.object({
        title: z.string().describe("Form title"),
        status: z.enum(["draft", "published", "closed"]).default("draft"),
        maxResponses: z.number().int().optional(),
      }),
      run: async () => "ok",
    });

    const params = action.tool.parameters;
    expect(params.type).toBe("object");
    expect(params.properties.title).toMatchObject({ type: "string" });
    expect(params.required).toEqual(["title"]);
    expect(params.properties.status.enum).toEqual([
      "draft",
      "published",
      "closed",
    ]);
    expect(params.properties.title.description).toBe("Form title");
  });

  it("strips the $schema key so the Claude API (draft 2020-12) does not reject it", () => {
    const action = defineAction({
      description: "with schema key",
      schema: z.object({ x: z.string() }),
      run: async () => "ok",
    });
    expect("$schema" in (action.tool.parameters as any)).toBe(false);
  });

  it("strips propertyNames (from z.record) so OpenAI/Gemini function schemas are not rejected", () => {
    const action = defineAction({
      description: "with a record field",
      schema: z.object({
        styleBrief: z.record(z.string(), z.unknown()).optional(),
      }),
      run: async () => "ok",
    });
    const json = JSON.stringify(action.tool.parameters);
    expect(json).not.toContain("propertyNames");
  });

  it("preserves a `propertyNames` data key inside a default value while stripping the schema keyword", () => {
    const action = defineAction({
      description: "record with a default object",
      schema: z.object({
        cfg: z.record(z.string(), z.string()).default({ propertyNames: "x" }),
      }),
      run: async () => "ok",
    });
    const params = action.tool.parameters as any;
    expect("propertyNames" in params.properties.cfg).toBe(false);
    expect(params.properties.cfg.default).toEqual({ propertyNames: "x" });
  });

  it("rewrites oneOf to anyOf so OpenAI does not reject the function schema", () => {
    const action = defineAction({
      description: "with a discriminated union",
      schema: z.object({
        operations: z.array(
          z.discriminatedUnion("op", [
            z.object({ op: z.literal("add"), panelId: z.string() }),
            z.object({
              op: z.literal("remove"),
              panelIds: z.array(z.string()),
            }),
          ]),
        ),
      }),
      run: async () => "ok",
    });
    const json = JSON.stringify(action.tool.parameters);
    expect(json).not.toContain('"oneOf"');
    expect(json).toContain('"anyOf"');
  });

  it.each([
    {
      name: "a oneOf branch",
      emitted: {
        type: "object",
        properties: {
          a: { oneOf: [{ type: "string" }, { type: "number" }] },
          b: { $ref: "#/properties/a/oneOf/0" },
        },
      },
      parameters: {
        type: "object",
        properties: {
          a: { anyOf: [{ type: "string" }, { type: "number" }] },
          b: { $ref: "#/$defs/properties_a_oneOf_0" },
        },
        $defs: { properties_a_oneOf_0: { type: "string" } },
      },
    },
    {
      name: "a not",
      emitted: {
        type: "object",
        not: { type: "string" },
        properties: { x: { $ref: "#/not" } },
      },
      parameters: {
        type: "object",
        properties: { x: { $ref: "#/$defs/not" } },
        $defs: { not: { type: "string" } },
      },
    },
  ])(
    "keeps a reference into $name resolvable after stripping",
    ({ emitted, parameters }) => {
      const action = defineAction({
        description: "Refers into a rewritten keyword",
        schema: {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: (value: unknown) => ({ value }),
            jsonSchema: { input: () => emitted },
          },
        } as never,
        run: async () => "ok",
      });

      expect(action.tool.parameters).toEqual(parameters);
      expect(
        usableInputSchema(action, (parameters) =>
          mcpToolInputSchema("refers", parameters),
        ),
      ).not.toBeInstanceOf(Error);
      expect(
        actionsToEngineTools({ refers: action }).map(({ name }) => name),
      ).toEqual(["refers"]);
    },
  );

  it("keeps every branch when rewriting a nested union", () => {
    const action = defineAction({
      description: "nested union",
      schema: z.object({
        outer: z.object({
          inner: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("a"), a: z.string() }),
            z.object({ kind: z.literal("b"), b: z.string() }),
            z.object({ kind: z.literal("c"), c: z.string() }),
          ]),
        }),
      }),
      run: async () => "ok",
    });
    const params = action.tool.parameters as any;
    const inner = params.properties.outer.properties.inner;
    expect(inner.oneOf).toBeUndefined();
    expect(inner.anyOf).toHaveLength(3);
  });

  it("gives z.unknown() a typed value union so OpenAI accepts it", () => {
    const action = defineAction({
      description: "typeless field",
      schema: z.object({ value: z.unknown() }),
      run: async () => "ok",
    });
    const value = (action.tool.parameters as any).properties.value;
    expect(Array.isArray(value.anyOf)).toBe(true);
    expect(value.anyOf.map((b: any) => b.type)).toContain("string");
    expect(value.anyOf.map((b: any) => b.type)).toContain("object");
  });

  it("types the value schema inside a record so nothing is left bare", () => {
    const action = defineAction({
      description: "record of unknown",
      schema: z.object({ patch: z.record(z.string(), z.unknown()) }),
      run: async () => "ok",
    });
    const patch = (action.tool.parameters as any).properties.patch;
    expect(patch.type).toBe("object");
    const extra = patch.additionalProperties;
    if (extra && typeof extra === "object") {
      expect(Array.isArray(extra.anyOf)).toBe(true);
    }
  });

  it("leaves an enum-only schema alone", () => {
    const action = defineAction({
      description: "enum field",
      schema: z.object({ mode: z.enum(["a", "b"]) }),
      run: async () => "ok",
    });
    const mode = (action.tool.parameters as any).properties.mode;
    expect(mode.enum).toEqual(["a", "b"]);
    expect(mode.anyOf).toBeUndefined();
  });

  it("stores the original schema on the entry for downstream re-validation", () => {
    const schema = z.object({ x: z.string() });
    const action = defineAction({
      description: "keeps schema",
      schema,
      run: async () => "ok",
    });
    expect(action.schema).toBe(schema);
  });

  const standardSchema = (input: () => unknown) =>
    ({
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value: unknown) => ({ value }),
        jsonSchema: { input },
      },
    }) as never;
  const mcpVerdict = (entry: Parameters<typeof usableInputSchema>[0]) =>
    usableInputSchema(entry, (parameters) =>
      mcpToolInputSchema("probe", parameters),
    );
  const DRAFT_07 = "http://json-schema.org/draft-07/schema#";
  async function withMcpClient(
    actions: Record<string, unknown>,
    use: (client: Client) => Promise<void>,
  ) {
    const server = await createMCPServerForRequest(
      { name: "probe", catalogMode: "app", actions } as never,
      undefined,
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
    try {
      await use(client);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  }
  const constBesideRef = (dialect?: string) => ({
    ...(dialect ? { $schema: dialect } : {}),
    type: "object",
    definitions: {
      ObjectInput: {
        type: "object",
        properties: { x: { type: "string" } },
        required: ["x"],
      },
    },
    allOf: [{ $ref: "#/definitions/ObjectInput", const: "ignored" }],
  });

  it.each([
    { name: "declares draft-07", dialect: DRAFT_07 },
    {
      name: "omits $schema, as the draft-07 asked for may",
      dialect: undefined,
    },
  ])(
    "lists and calls an action whose emitter $name and puts a const beside a reference",
    async ({ dialect }) => {
      const emitted = constBesideRef(dialect);
      // Draft-07 section 8.3: every keyword beside `$ref` is ignored.
      const validate = new Ajv({
        strict: false,
        ignoreKeywordsWithRef: true,
      } as never).compile(emitted);
      expect([validate({ x: "ok" }), validate({})]).toEqual([true, false]);
      const check = defineAction({
        description: "Reads x",
        schema: {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: (value: unknown) =>
              validate(value) ? { value } : { issues: [{ message: "no x" }] },
            jsonSchema: { input: () => emitted },
          },
        } as never,
        run: async (args: { x: string }) => ({ x: args.x }),
      });
      expect(actionsToEngineTools({ check }).map(({ name }) => name)).toEqual([
        "check",
      ]);

      await withMcpClient({ check }, async (client) => {
        const { tools } = await client.listTools();
        expect(tools).toMatchObject([
          {
            name: "check",
            inputSchema: {
              properties: { x: { type: "string" } },
              required: ["x"],
            },
          },
        ]);
        await expect(
          client.callTool({ name: "check", arguments: { x: "ok" } }),
        ).resolves.toEqual({
          content: [{ type: "text", text: JSON.stringify({ x: "ok" }) }],
        });
        await expect(
          client.callTool({ name: "check", arguments: {} }),
        ).resolves.toMatchObject({ isError: true });
      });
    },
  );

  it.each([
    {
      name: "a Zod tuple",
      schema: z.object({ pair: z.tuple([z.number(), z.string()]) }),
      witness: { pair: [1, "a"] },
    },
    {
      name: "a draft-07 tuple written by hand",
      schema: (() => {
        const emitted = {
          $schema: DRAFT_07,
          type: "object",
          properties: {
            pair: {
              type: "array",
              items: [{ type: "number" }, { type: "string" }],
              additionalItems: { type: "boolean" },
            },
          },
          required: ["pair"],
        };
        const validate = new Ajv({ strict: false }).compile(emitted);
        return {
          "~standard": {
            version: 1,
            vendor: "test",
            validate: (value: unknown) =>
              validate(value) ? { value } : { issues: [{ message: "no" }] },
            jsonSchema: { input: () => emitted },
          },
        } as never;
      })(),
      witness: { pair: [1, "a", true] },
    },
  ])(
    "lists, conforms and calls an action whose input holds $name",
    async ({ schema, witness }) => {
      const pair = defineAction({
        description: "Reads a pair",
        schema,
        run: async (args: unknown) => args,
      });
      expect(JSON.stringify(pair.tool.parameters)).not.toMatch(
        /"items":\[|additionalItems/,
      );
      expect(actionsToEngineTools({ pair }).map(({ name }) => name)).toEqual([
        "pair",
      ]);

      await withMcpClient({ pair }, async (client) => {
        const { tools } = await client.listTools();
        expect(tools.map(({ name }) => name)).toEqual(["pair"]);
        const { inputSchema } = tools[0]!;
        expect(inputSchema.properties).toMatchObject({
          pair: { prefixItems: [{ type: "number" }, { type: "string" }] },
        });
        expect(providerSchemaViolations({ name: "pair", inputSchema })).toEqual(
          [],
        );
        const validate = new Ajv2020({ strict: false }).compile(inputSchema);
        expect([validate(witness), validate({ pair: ["a", 1] })]).toEqual([
          true,
          false,
        ]);
        await expect(
          client.callTool({ name: "pair", arguments: witness }),
        ).resolves.toEqual({
          content: [{ type: "text", text: JSON.stringify(witness) }],
        });
      });
    },
  );

  it("leaves out an action whose 2020-12 schema puts a const beside a $ref", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const check = defineAction({
        description: "Reads x",
        schema: standardSchema(() =>
          constBesideRef("https://json-schema.org/draft/2020-12/schema"),
        ),
        run: async () => "ok",
      });

      expect(mcpVerdict(check)).toMatchObject({
        path: "",
        reason: "accepts no object",
      });
      expect(actionsToEngineTools({ check })).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("keeps the annotations beside a draft-07 $ref and drops its other keywords", () => {
    const action = defineAction({
      description: "Greets",
      schema: standardSchema(() => ({
        $schema: DRAFT_07,
        type: "object",
        definitions: { Name: { type: "string" } },
        properties: {
          name: {
            $ref: "#/definitions/Name",
            description: "Who to greet",
            minLength: 3,
          },
        },
      })),
      run: async () => "ok",
    });

    expect(action.tool.parameters).toEqual({
      type: "object",
      definitions: { Name: { type: "string" } },
      properties: {
        name: { $ref: "#/definitions/Name", description: "Who to greet" },
      },
    });
  });

  it.each([
    {
      name: "a const its enum does not list",
      input: { type: "object", properties: { x: { const: "x", enum: [1] } } },
      unusable: {
        path: "/properties/x",
        reason:
          "declares a const its enum does not list, so it accepts no value",
      },
    },
    {
      name: "an enum with no value of its type",
      input: {
        type: "object",
        properties: { x: { type: "string", enum: [1, 2] } },
      },
      unusable: {
        path: "/properties/x",
        reason: "lists no value of its type, so it accepts no value",
      },
    },
    {
      name: "a reference to a missing definition inside a not",
      input: {
        type: "object",
        properties: { x: { type: "string", not: { $ref: "#/$defs/Missing" } } },
      },
      unusable: {
        path: "/properties/x/not",
        reason: 'references "#/$defs/Missing", which does not resolve',
      },
    },
  ])(
    "keeps $name, which stripping hides, out of the tools for each action defined with it",
    ({ input, unusable }) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        // One object for every definition, as an emitter that caches returns.
        const emitted = structuredClone(input);
        const schema = standardSchema(() => emitted);
        const define = () =>
          defineAction({
            description: "Accepts nothing",
            schema,
            run: async () => "ok",
          });
        const first = define();
        const second = define();
        const registry = loadActionsFromStaticRegistry({
          first,
          second,
          echo: defineAction({
            description: "Echo",
            schema: z.object({ x: z.string() }),
            run: async () => "ok",
          }),
        });

        expect(emitted).toEqual(input);
        expect(JSON.stringify(second.tool.parameters)).not.toMatch(
          /"enum"|"not"/,
        );
        for (const entry of [
          first,
          second,
          { ...second },
          registry.second!,
          filesystemActionEntry(second),
        ]) {
          expect(mcpVerdict(entry)).toMatchObject(unusable);
        }
        for (const actions of [
          registry,
          createPlanModeActionRegistry(registry),
        ]) {
          expect(actionsToEngineTools(actions).map(({ name }) => name)).toEqual(
            ["echo"],
          );
        }
        expect(consoleError).toHaveBeenCalledWith(
          `[agent] Action "second" is left out of the agent's tools: its input schema ${unusable.reason} at ${unusable.path}.`,
        );
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it.each([
    {
      name: "an emitter that throws",
      schema: standardSchema(() => {
        throw new Error("cannot emit");
      }),
      unusable: { path: "", reason: "could not be converted: cannot emit" },
    },
    {
      name: "an emitter it cannot read",
      schema: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value: unknown) => ({ value }),
          get jsonSchema() {
            throw new Error("emitter property unreadable");
          },
        },
      } as never,
      unusable: {
        path: "",
        reason: "could not be converted: emitter property unreadable",
      },
    },
    {
      name: "a property read through a getter that throws",
      schema: standardSchema(() => ({
        type: "object",
        properties: {
          get x() {
            throw new Error("schema read failed");
          },
        },
      })),
      unusable: { path: "/properties/x", reason: "is read through a getter" },
    },
    {
      name: "a frozen schema whose not names a missing definition",
      schema: standardSchema(() =>
        Object.freeze({ type: "object", not: { $ref: "#/$defs/Missing" } }),
      ),
      unusable: {
        path: "/not",
        reason: 'references "#/$defs/Missing", which does not resolve',
      },
    },
    {
      name: "a BigInt default",
      schema: standardSchema(() => ({
        type: "object",
        properties: { x: { type: "integer", default: BigInt(1) } },
      })),
      unusable: {
        path: "/properties/x/default",
        reason: "holds bigint, which JSON cannot represent",
      },
    },
  ])(
    "keeps the reason it cannot convert $name beside the any-object parameters",
    ({ schema, unusable }) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        const action = defineAction({
          description: "Unconvertible",
          schema,
          run: async () => "ok",
        });

        expect(action.tool.parameters).toEqual({
          type: "object",
          properties: {},
        });
        expect(mcpVerdict(action)).toMatchObject(unusable);
        expect(actionsToEngineTools({ unconvertible: action })).toEqual([]);
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  const accepted = { type: "object", properties: { x: { type: "string" } } };
  const refused = {
    type: "object",
    properties: { x: { const: "x", enum: [1] } },
  };

  it.each(
    ["Zod", "a JSON Schema emitter"].flatMap((library) =>
      ["first", "second"].map((order) => ({ library, order })),
    ),
  )(
    "offers an action whose schema, from $library, another action shares with an unusable override defined $order",
    ({ library, order }) => {
      const consoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      try {
        const zod = library === "Zod";
        const schema = zod
          ? z.object({ x: z.string() })
          : standardSchema(() => accepted);
        const define = (agentInputSchema?: unknown) =>
          defineAction({
            description: "Shares a schema",
            schema,
            ...(agentInputSchema ? { agentInputSchema } : {}),
            run: async () => "ok",
          } as never);
        const defineOverride = () =>
          define(zod
            ? z.object({ x: z.bigint() })
            : standardSchema(() => refused));
        const override = order === "first" ? defineOverride() : undefined;
        const shared = define();
        const actions = { shared, override: override ?? defineOverride() };

        expect(mcpVerdict(shared)).not.toBeInstanceOf(Error);
        expect(mcpVerdict(actions.override)).toBeInstanceOf(
          UnusableSchemaError,
        );
        expect(actionsToEngineTools(actions).map(({ name }) => name)).toEqual([
          "shared",
        ]);
      } finally {
        consoleError.mockRestore();
      }
    },
  );

  it("judges each action by what its emitter returned when it was defined", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      let emitted: unknown = refused;
      const schema = standardSchema(() => emitted);
      const before = defineAction({
        description: "Before",
        schema,
        run: async () => "ok",
      });
      emitted = accepted;
      const after = defineAction({
        description: "After",
        schema,
        run: async () => "ok",
      });

      expect(mcpVerdict(before)).toBeInstanceOf(UnusableSchemaError);
      expect(mcpVerdict(after)).not.toBeInstanceOf(Error);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("reads a reason another copy of the module recorded, for that tool only", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      vi.resetModules();
      const copy = await import("./action.js");
      expect(copy.defineAction).not.toBe(defineAction);
      const schema = standardSchema(() => accepted);
      const shared = defineAction({
        description: "Shares a schema",
        schema,
        run: async () => "ok",
      });
      const override = copy.defineAction({
        description: "Unusable override",
        schema,
        agentInputSchema: standardSchema(() => refused),
        run: async () => "ok",
      });

      expect(mcpVerdict(override)).toBeInstanceOf(UnusableSchemaError);
      expect(mcpVerdict(shared)).not.toBeInstanceOf(Error);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("judges a copied action by the tool it carries", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const bad = defineAction({
        description: "Accepts nothing",
        schema: standardSchema(() => ({
          type: "object",
          properties: { x: { const: "x", enum: [1] } },
        })),
        run: async () => "bad",
      });
      const good = defineAction({
        description: "Echo",
        schema: z.object({ x: z.string() }),
        run: async () => "good",
      });
      const tools = actionsToEngineTools({
        repaired: { ...bad, tool: good.tool },
        "bad-tool": { ...bad, schema: good.schema },
        // Only a schema with no JSON Schema emitter takes any object.
        "no-emitter": defineAction({
          description: "No emitter",
          schema: {
            "~standard": {
              version: 1,
              vendor: "test",
              validate: (value: unknown) => ({ value }),
            },
          } as never,
          run: async () => "ok",
        }),
      } as never);

      expect(tools.map(({ name }) => name)).toEqual(["repaired", "no-emitter"]);
    } finally {
      consoleError.mockRestore();
    }
  });
});

describe("defineAction schema mode — agentInputSchema (advertised-only override)", () => {
  it("advertises the compact schema instead of the full schema", () => {
    const action = defineAction({
      description: "create widget",
      schema: z.object({
        title: z.string(),
        blocks: z.array(
          z.discriminatedUnion("type", [
            z.object({
              type: z.literal("a"),
              data: z.object({ a: z.string() }),
            }),
            z.object({
              type: z.literal("b"),
              data: z.object({ b: z.number() }),
            }),
          ]),
        ),
      }),
      agentInputSchema: z.object({
        title: z.string(),
        blocks: z
          .array(
            z.object({
              type: z
                .enum(["a", "b"])
                .describe(
                  "Block type — call get-blocks for full field shapes.",
                ),
            }),
          )
          .describe("Call get-blocks before authoring blocks."),
      }),
      run: async () => "ok",
    });

    const params = action.tool.parameters as any;
    expect(params.required).toEqual(["title", "blocks"]);
    const blockItemProps = params.properties.blocks.items.properties;
    expect(Object.keys(blockItemProps)).toEqual(["type"]);
    expect(blockItemProps.type.enum).toEqual(["a", "b"]);
  });

  it("still runs full validation against `schema`, ignoring the compact override", async () => {
    const run = vi.fn(async (args: any) => args);
    const action = defineAction({
      description: "create widget",
      schema: z.object({
        title: z.string(),
        count: z.number().int().min(1),
      }),
      agentInputSchema: z.object({
        title: z.string(),
        // Compact override omits `count` entirely from what's advertised…
      }),
      run,
    });

    await expect(action.run({ title: "x" } as any)).rejects.toThrow(
      /Missing required parameter.*count/s,
    );
    expect(run).not.toHaveBeenCalled();

    await expect(action.run({ title: "x", count: 2 } as any)).resolves.toEqual({
      title: "x",
      count: 2,
    });
  });

  it("falls back to the full schema when agentInputSchema is not set", () => {
    const action = defineAction({
      description: "create widget",
      schema: z.object({ title: z.string(), count: z.number() }),
      run: async () => "ok",
    });
    const params = action.tool.parameters as any;
    expect(Object.keys(params.properties)).toEqual(["title", "count"]);
  });

  it("never converts the full schema to JSON Schema when agentInputSchema is set", () => {
    const fullSchema = z.object({ title: z.string(), count: z.number() });
    const jsonSchema = (fullSchema as any)["~standard"].jsonSchema;
    const convert = vi.spyOn(jsonSchema, "input");

    const action = defineAction({
      description: "create widget",
      schema: fullSchema,
      agentInputSchema: z.object({ title: z.string() }),
      run: async () => "ok",
    });

    expect(convert).not.toHaveBeenCalled();
    expect(Object.keys((action.tool.parameters as any).properties)).toEqual([
      "title",
    ]);
  });
});

describe("defineAction schema mode — runtime validation wrapper", () => {
  it("passes validated + coerced args to run() on success", async () => {
    let received: unknown;
    const action = defineAction({
      description: "echo",
      schema: z.object({
        title: z.string(),
        status: z.enum(["a", "b"]).default("a"),
      }),
      run: async (args: { title: string; status: string }) => {
        received = args;
        return "done";
      },
    });

    const out = await action.run({ title: "Hi" });
    expect(out).toBe("done");
    expect(received).toEqual({ title: "Hi", status: "a" });
  });

  it("never invokes run() when validation fails", async () => {
    let ran = false;
    const action = defineAction({
      description: "guarded",
      schema: z.object({ title: z.string() }),
      run: async () => {
        ran = true;
        return "should not happen";
      },
    });

    await expect(action.run({})).rejects.toThrow(/Invalid action parameters/);
    expect(ran).toBe(false);
  });

  it("formats missing required fields as a 'Missing required parameter' message", async () => {
    const action = defineAction({
      description: "needs two",
      schema: z.object({ title: z.string(), body: z.string() }),
      run: async () => "ok",
    });

    await expect(action.run({})).rejects.toThrow(
      /Missing required parameters: title, body/,
    );
  });

  it("echoes the received args and the expected signature so the agent can self-correct", async () => {
    const action = defineAction({
      description: "signature",
      schema: z.object({
        deckId: z.string(),
        slideId: z.string().optional(),
      }),
      run: async () => "ok",
    });

    let message = "";
    try {
      await action.run({ slideId: "s1" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('Received: {"slideId":"s1"}');
    expect(message).toContain("deckId*: string");
    expect(message).toContain("slideId?: string");
    expect(message).toContain("* = required, ? = optional");
  });

  it("reports non-missing validation errors (wrong type) distinctly", async () => {
    const action = defineAction({
      description: "typed",
      schema: z.object({ count: z.number() }),
      run: async () => "ok",
    });

    let message = "";
    try {
      await action.run({ count: "not-a-number" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toMatch(/Missing required parameter/);
    expect(message).toContain("count");
  });

  it("truncates an oversized received-args echo to keep tool results compact", async () => {
    const action = defineAction({
      description: "big",
      schema: z.object({ required: z.string() }),
      run: async () => "ok",
    });

    const huge = { extra: "x".repeat(2000) };
    let message = "";
    try {
      await action.run(huge as any);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(1000);
  });

  it("validateActionArgs lets a matching schema's run() skip re-validation when passed the same ctx", async () => {
    let received: unknown;
    const schema = z.object({ tag: z.preprocess((v) => `${v}!`, z.string()) });
    const action = defineAction({
      description: "tag",
      schema,
      run: async (args) => {
        received = args;
        return "ok";
      },
    });

    const ctx = { caller: "http" as const };
    const validated = await validateActionArgs(
      schema,
      { tag: "a" },
      undefined,
      ctx,
    );
    await action.run(validated, ctx);
    expect(received).toEqual({ tag: "a!" });
  });

  it("re-validates normally when run() is called without the marking ctx", async () => {
    let received: unknown;
    const schema = z.object({ tag: z.preprocess((v) => `${v}!`, z.string()) });
    const action = defineAction({
      description: "tag",
      schema,
      run: async (args) => {
        received = args;
        return "ok";
      },
    });

    const validated = await validateActionArgs(schema, { tag: "a" });
    await action.run(validated);
    expect(received).toEqual({ tag: "a!!" });
  });

  it("does not let a value validated for one action's schema skip a different action's validation", async () => {
    const schemaA = z.object({ tag: z.string() });
    const schemaB = z.object({ name: z.string() });
    let ranB = false;
    const actionB = defineAction({
      description: "needs name",
      schema: schemaB,
      run: async () => {
        ranB = true;
        return "ok";
      },
    });

    const validatedForA = await validateActionArgs(schemaA, { tag: "x" });
    await expect(actionB.run(validatedForA)).rejects.toThrow(
      /Invalid action parameters/,
    );
    expect(ranB).toBe(false);
  });

  it("skips re-validation for a schema that validates down to a primitive", async () => {
    let received: unknown;
    const schema = z.preprocess((v) => `${v}!`, z.string());
    const action = defineAction({
      description: "primitive schema",
      schema,
      run: async (args) => {
        received = args;
        return "ok";
      },
    });

    const ctx = { caller: "http" as const };
    const validated = await validateActionArgs(schema, "a", undefined, ctx);
    expect(validated).toBe("a!");
    await action.run(validated, ctx);
    expect(received).toBe("a!");
  });

  it("recognizes a cached NaN result via Object.is instead of ===", async () => {
    let transformCalls = 0;
    const schema = z.preprocess(() => {
      transformCalls += 1;
      return NaN;
    }, z.any());
    const action = defineAction({
      description: "nan schema",
      schema,
      run: async () => "ok",
    });

    const ctx = { caller: "http" as const };
    const validated = await validateActionArgs(schema, {}, undefined, ctx);
    expect(Number.isNaN(validated)).toBe(true);
    expect(transformCalls).toBe(1);
    await action.run(validated, ctx);
    expect(transformCalls).toBe(1);
  });
});

describe("defineAction — outputSchema (return-value validation)", () => {
  it("passes the result through untouched when no outputSchema is provided", async () => {
    const original = { id: "abc", extra: 123 };
    const action = defineAction({
      description: "no output schema",
      schema: z.object({ x: z.string() }),
      run: async () => original,
    });
    const out = await action.run({ x: "hi" });
    expect(out).toBe(original);
    expect("outputSchema" in action).toBe(false);
    expect(action.outputErrorStrategy).toBeUndefined();
  });

  it("returns the validated result when it matches the outputSchema", async () => {
    const action = defineAction({
      description: "valid output",
      schema: z.object({ x: z.string() }),
      outputSchema: z.object({ id: z.string(), count: z.number() }),
      run: async () => ({ id: "abc", count: 2 }),
    });
    const out = await action.run({ x: "hi" });
    expect(out).toEqual({ id: "abc", count: 2 });
    expect(action.outputErrorStrategy).toBe("warn");
    expect(action.outputSchema).toBeDefined();
  });

  it('warns and returns the ORIGINAL result on mismatch under the default "warn" strategy', async () => {
    const bad = { id: "abc", count: "not-a-number" };
    const warnings: unknown[][] = [];
    const original = console.warn;
    console.warn = (...inputArgs: unknown[]) => {
      warnings.push(inputArgs);
    };
    try {
      const action = defineAction({
        description: "warn output",
        schema: z.object({ x: z.string() }),
        outputSchema: z.object({ id: z.string(), count: z.number() }),
        run: async () => bad,
      });
      const out = await action.run({ x: "hi" });
      expect(out).toBe(bad);
    } finally {
      console.warn = original;
    }
    expect(warnings.length).toBe(1);
    expect(String(warnings[0][0])).toMatch(/did not match outputSchema/);
    expect(String(warnings[0][0])).toContain("count");
  });

  it('throws a typed output-contract error on mismatch under the "strict" strategy', async () => {
    const action = defineAction({
      description: "strict output",
      schema: z.object({ x: z.string() }),
      outputSchema: z.object({ id: z.string() }),
      outputErrorStrategy: "strict",
      run: async () => ({ wrong: true }),
    });
    const error = await action.run({ x: "hi" }).catch((err: unknown) => err);
    expect(isActionOutputContractError(error)).toBe(true);
    expect(error).toMatchObject({
      errorCode: "output_contract_violation",
      contract: "semantic",
      issues: ["id: invalid_type"],
    });
    expect(action.outputErrorStrategy).toBe("strict");
  });

  it("reports a read-only mismatch as having changed nothing", async () => {
    const action = defineAction({
      description: "strict read",
      schema: z.object({}),
      outputSchema: z.object({ count: z.number() }),
      outputErrorStrategy: "strict",
      readOnly: true,
      run: async () => ({ count: "alice@example.com" }),
    });
    const error = await action
      .run({}, { actionName: "count-things" })
      .catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ActionOutputContractError);
    expect(error).toMatchObject({
      effect: "none",
      statusCode: 500,
      details: { effect: "none", contract: "semantic" },
    });
    expect((error as Error).message).toContain('"count-things"');
    expect((error as Error).message).toContain("changed nothing");
    expect((error as Error).message).not.toContain("alice@example.com");
  });

  it("reports a write's mismatch as committed and says not to retry", async () => {
    let writes = 0;
    const action = defineAction({
      description: "strict write",
      schema: z.object({}),
      outputSchema: z.object({
        rows: z.array(z.object({ owner: z.string() })),
      }),
      outputErrorStrategy: "strict",
      run: async () => {
        writes += 1;
        return {
          rows: [{ owner: "alice@example.com" }, { owner: 42 }],
          "bob@example.com": true,
        };
      },
    });
    const error = await action
      .run({}, { actionName: "assign-owners" })
      .catch((err: unknown) => err);
    expect(writes).toBe(1);
    expect(error).toMatchObject({
      effect: "committed",
      issues: ["rows.1.owner: invalid_type"],
    });
    expect((error as Error).message).toContain("do not retry");
    expect((error as Error).message).not.toMatch(/alice@|bob@|42/);
  });

  it("classifies the effect per call from planMode", async () => {
    const action = defineAction({
      description: "mixed",
      schema: z.object({ apply: z.boolean() }),
      outputSchema: z.object({ ok: z.literal(true) }),
      outputErrorStrategy: "strict",
      planMode: { effect: (args) => (args.apply ? "write" : "read") },
      run: async () => ({ ok: false }),
    });
    await expect(action.run({ apply: false })).rejects.toMatchObject({
      effect: "none",
    });
    await expect(action.run({ apply: true })).rejects.toMatchObject({
      effect: "committed",
    });
  });

  it("masks object keys the schema does not declare in issue paths", async () => {
    const action = defineAction({
      description: "record output",
      schema: z.object({}),
      outputSchema: z.object({
        byOwner: z.record(z.string(), z.number()),
      }),
      outputErrorStrategy: "strict",
      run: async () => ({ byOwner: { "carol@example.com": "many" } }),
    });
    await expect(action.run({})).rejects.toMatchObject({
      issues: ["byOwner.*: invalid_type"],
    });
  });

  it("masks a numeric record key like any other", async () => {
    const action = defineAction({
      description: "numeric record output",
      schema: z.object({}),
      outputSchema: z.object({
        byYear: z.record(z.string(), z.number()),
      }),
      outputErrorStrategy: "strict",
      run: async () => ({ byYear: { "1987": "born" } }),
    });
    const error = await action.run({}).catch((err: unknown) => err);
    expect(error).toMatchObject({ issues: ["byYear.*: invalid_type"] });
    expect((error as Error).message).not.toContain("1987");
  });

  it("classifies the effect from validated arguments, defaults applied", async () => {
    const action = defineAction({
      description: "defaulted write",
      schema: z.object({ apply: z.boolean().default(true) }),
      outputSchema: z.object({ ok: z.literal(true) }),
      outputErrorStrategy: "strict",
      planMode: { effect: (args) => (args.apply ? "write" : "read") },
      run: async () => ({ ok: false }) as any,
    });
    await expect(action.run({} as any)).rejects.toMatchObject({
      effect: "committed",
    });
  });

  it("classifies the effect before run, which may change its arguments", async () => {
    const action = defineAction({
      description: "write that rewrites its arguments",
      schema: z.object({ apply: z.boolean().default(true) }),
      outputSchema: z.object({ ok: z.literal(true) }),
      outputErrorStrategy: "strict",
      planMode: { effect: (args) => (args.apply ? "write" : "read") },
      run: async (args) => {
        args.apply = false;
        return { ok: false } as any;
      },
    });
    const { outcome, error } = await dispatch(
      action,
      {},
      {
        actionName: "publish",
      },
    );
    expect(error).toMatchObject({ effect: "committed" });
    // The transport reads the same classification and the validated args.
    expect(outcome.record).toMatchObject({ readOnly: false });
  });

  it("records nothing for a call whose arguments fail validation", async () => {
    const action = defineAction({
      description: "typed write",
      schema: z.object({ title: z.string() }),
      run: async () => ({ ok: true }),
    });
    const { outcome, error } = await dispatch(
      action,
      { title: 5 },
      { actionName: "rename" },
    );
    expect((error as Error).message).toMatch(/Invalid action parameters/);
    expect(outcome).toMatchObject({ refused: true });
    expect(outcome.record).toBeUndefined();
  });

  it("types a throwing refinement as an output-contract failure without its message", async () => {
    const action = defineAction({
      description: "throwing refinement",
      schema: z.object({}),
      outputSchema: z.object({ owner: z.string() }).superRefine((value) => {
        throw new Error(`${value.owner} is not allowed`);
      }),
      outputErrorStrategy: "strict",
      run: async () => ({ owner: "ivan@example.com" }),
    });
    const error = await action
      .run({}, { actionName: "assign" })
      .catch((err: unknown) => err);
    expect(isActionOutputContractError(error)).toBe(true);
    expect(error).toMatchObject({
      effect: "committed",
      issues: ["(root): validator_threw"],
    });
    expect((error as Error).message).not.toContain("ivan@example.com");
  });

  it("keeps the warn strategy non-breaking when a refinement throws", async () => {
    const output = { owner: "ivan@example.com" };
    const original = console.warn;
    console.warn = () => {};
    try {
      const action = defineAction({
        description: "throwing refinement, warn",
        schema: z.object({}),
        outputSchema: z.object({ owner: z.string() }).superRefine(() => {
          throw new Error("refinement bug");
        }),
        run: async () => output,
      });
      await expect(action.run({})).resolves.toBe(output);
    } finally {
      console.warn = original;
    }
  });

  it("keeps a connection request from an output transform a connection request, sanitized and carrying the effect", async () => {
    const action = defineAction({
      description: "strict transform that asks for a connection",
      schema: z.object({}),
      outputSchema: z.object({ owner: z.string() }).transform((value) => {
        throw new AgentConnectionRequiredError(
          `Connect Slack to message ${value.owner}`,
          {
            provider: "slack",
            reason: "grant",
            toolResult: `Owner ${value.owner} needs Slack`,
          },
        );
      }),
      outputErrorStrategy: "strict",
      run: async () => ({ owner: "kim@example.com" }),
    });
    const error = await action
      .run({}, { actionName: "assign-owner" })
      .catch((err: unknown) => err);
    expect(isAgentConnectionRequiredError(error)).toBe(true);
    expect(error).toMatchObject({
      provider: "slack",
      reason: "grant",
      effect: "committed",
      details: { effect: "committed" },
    });
    expect((error as AgentConnectionRequiredError).toolResult).toBeUndefined();
    expect((error as Error).message).toContain('"assign-owner"');
    expect((error as Error).message).toContain("do not retry");
    expect(JSON.stringify(error)).not.toContain("kim@example.com");
    expect((error as Error).message).not.toContain("kim@example.com");
  });

  it("stops a call whose warn-strategy transform raises a stop signal, without its message", async () => {
    // The one exception to "warn" being non-breaking: a signal is intent.
    const action = defineAction({
      description: "warn transform that stops",
      schema: z.object({}),
      outputSchema: z.object({ owner: z.string() }).transform((value) => {
        throw new AgentActionStopError(`Stop: ${value.owner} is suspended`, {
          errorCode: "permanent_precondition",
          details: { owner: value.owner },
        });
      }),
      readOnly: true,
      run: async () => ({ owner: "lee@example.com" }),
    });
    const error = await action.run({}).catch((err: unknown) => err);
    expect(isAgentActionStopError(error)).toBe(true);
    expect(isAgentConnectionRequiredError(error)).toBe(false);
    expect(error).toMatchObject({
      errorCode: "permanent_precondition",
      effect: "none",
      details: { effect: "none" },
    });
    expect((error as Error).message).toContain("changed nothing");
    expect(JSON.stringify(error)).not.toContain("lee@example.com");
    expect((error as Error).message).not.toContain("lee@example.com");
  });

  it("reports a nested read's output failure as committed when the enclosing write ran", async () => {
    const readTitle = defineAction({
      description: "strict nested read",
      schema: z.object({}),
      outputSchema: z.object({ title: z.string() }),
      outputErrorStrategy: "strict",
      readOnly: true,
      run: async () => ({ title: 7 }) as any,
    });
    let writes = 0;
    const renameAndRead = defineAction({
      description: "write, then read with the same context",
      schema: z.object({}),
      run: async (_args, ctx) => {
        writes += 1;
        return readTitle.run({}, ctx);
      },
    });
    const { outcome, error } = await dispatch(
      renameAndRead,
      {},
      {
        actionName: "rename-and-read",
      },
    );
    expect(writes).toBe(1);
    expect(isActionOutputContractError(error)).toBe(true);
    expect(error).toMatchObject({ effect: "committed" });
    expect((error as Error).message).toContain("do not retry");
    // The failure is the nested action's; it does not speak for the parent.
    expect((error as Error).message).not.toContain("rename-and-read");
    expect(outcome.record).toMatchObject({ readOnly: undefined });

    const readAndRead = defineAction({
      description: "read, then read with the same context",
      schema: z.object({}),
      readOnly: true,
      run: async (_args, ctx) => readTitle.run({}, ctx),
    });
    await expect(
      readAndRead.run({}, { actionName: "read-and-read" }),
    ).rejects.toMatchObject({ effect: "none" });
  });

  it("carries the enclosing write through a nested signal and keeps a guard's nested failure as is", async () => {
    const checkOwner = defineAction({
      description: "nested read whose transform stops",
      schema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }).transform(() => {
        throw new AgentActionStopError("Stop now");
      }),
      readOnly: true,
      run: async () => ({ ok: true }),
    });
    const publish = defineAction({
      description: "write that runs a nested check",
      schema: z.object({}),
      run: async (_args, ctx) => checkOwner.run({}, ctx),
    });
    const signal = await publish
      .run({}, { actionName: "publish" })
      .catch((err: unknown) => err);
    expect(isAgentActionStopError(signal)).toBe(true);
    expect(signal).toMatchObject({ effect: "committed" });

    // A guard that runs the nested read fails before the write's handler.
    let handled = false;
    const guarded = defineAction({
      description: "write guarded by a nested read",
      schema: z.object({}),
      authorize: async (_args, ctx) => {
        await checkOwner.run({}, ctx);
      },
      run: async () => {
        handled = true;
        return { ok: true };
      },
    });
    const refused = await guarded
      .run({}, { actionName: "guarded", userEmail: "a@example.com" })
      .catch((err: unknown) => err);
    expect(handled).toBe(false);
    expect(refused).toMatchObject({ effect: "none" });
  });

  it("reports a read's failure as committed once a write nested in it ran", async () => {
    let writes = 0;
    const save = defineAction({
      description: "nested write",
      schema: z.object({}),
      run: async () => {
        writes += 1;
        return { ok: true };
      },
    });
    const saveAndMisreport = defineAction({
      description: "read that saves, then breaks its contract",
      schema: z.object({}),
      outputSchema: z.object({ ok: z.literal(true) }),
      outputErrorStrategy: "strict",
      readOnly: true,
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        return { ok: false } as any;
      },
    });
    const { outcome, error: own } = await dispatch(
      saveAndMisreport,
      {},
      {
        actionName: "save-and-misreport",
      },
    );
    expect(writes).toBe(1);
    expect(own).toMatchObject({ effect: "committed" });
    expect((own as Error).message).toContain("do not retry");
    expect(outcome.record?.evidence).toMatchObject({
      writeEntered: true,
      changeEntered: true,
    });

    const readTitle = defineAction({
      description: "strict nested read",
      schema: z.object({}),
      outputSchema: z.object({ title: z.string() }),
      outputErrorStrategy: "strict",
      readOnly: true,
      run: async () => ({ title: 7 }) as any,
    });
    const saveThenRead = defineAction({
      description: "read that saves, then reads",
      schema: z.object({}),
      readOnly: true,
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        return readTitle.run({}, ctx);
      },
    });
    await expect(
      saveThenRead.run({}, { actionName: "save-then-read" }),
    ).rejects.toMatchObject({ effect: "committed" });
    expect(writes).toBe(2);
  });

  it("refreshes after any failure that followed a write's handler", async () => {
    let writes = 0;
    const typedRead = defineAction({
      description: "typed nested read",
      schema: z.object({ id: z.string() }),
      readOnly: true,
      run: async () => ({ ok: true }),
    });
    const writeThenInvalid = defineAction({
      description: "write that calls a nested read wrongly",
      schema: z.object({}),
      run: async (_args, ctx) => {
        writes += 1;
        return typedRead.run({} as any, ctx);
      },
    });
    const invalid = await dispatch(
      writeThenInvalid,
      {},
      {
        actionName: "write-then-invalid",
      },
    );
    expect(writes).toBe(1);
    expect(
      failedCallEmitsChange(writeThenInvalid, invalid.error, invalid.outcome),
    ).toBe(true);

    const save = defineAction({
      description: "nested write",
      schema: z.object({}),
      run: async () => {
        writes += 1;
        return { ok: true };
      },
    });
    const saveThenThrow = defineAction({
      description: "write that saves, then fails",
      schema: z.object({}),
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        throw new Error("Failed afterwards.");
      },
    });
    const thrown = await dispatch(
      saveThenThrow,
      {},
      {
        actionName: "save-then-throw",
      },
    );
    expect(writes).toBe(2);
    expect(
      failedCallEmitsChange(saveThenThrow, thrown.error, thrown.outcome),
    ).toBe(true);

    const failingRead = defineAction({
      description: "read that fails",
      schema: z.object({}),
      readOnly: true,
      run: async () => {
        throw new Error("Not found.");
      },
    });
    const read = await dispatch(
      failingRead,
      {},
      {
        actionName: "failing-read",
      },
    );
    expect(failedCallEmitsChange(failingRead, read.error, read.outcome)).toBe(
      false,
    );
  });

  it("classifies a call's intent from its validated arguments", async () => {
    const publish = defineAction({
      description: "defaulted write",
      schema: z.object({ apply: z.boolean().default(true) }),
      planMode: {
        effect: (args) => (args.apply === true ? "write" : "read"),
      },
      run: async () => ({ ok: true }),
    });
    const intent = await actionCallIntent(publish, {});
    expect(intent).toEqual({
      valid: true,
      argumentsHash: actionArgumentsHash({ apply: true }),
      readOnly: false,
      planModeRead: false,
    });
    if (!intent.valid) throw intent.error;
    expect(preparedCallArguments(intent)).toEqual({ apply: true });
    await expect(
      actionCallIntent(publish, { apply: "yes" }),
    ).resolves.toMatchObject({ valid: false });
  });

  it("runs a prepared call as prepared, without parsing or classifying it again", async () => {
    let parses = 0;
    let effects = 0;
    const received: unknown[] = [];
    const publish = defineAction({
      description: "transformed write",
      schema: z.object({
        note: z.string().transform((note) => {
          parses += 1;
          return `${note}!`;
        }),
      }),
      planMode: {
        effect: () => {
          effects += 1;
          return "read";
        },
      },
      run: async (args) => {
        received.push(args);
        return { ok: true };
      },
    });
    const intent = await actionCallIntent(publish, { note: "draft" });
    expect(intent.valid).toBe(true);
    if (!intent.valid) return;
    const ctx: ActionRunContext = { caller: "tool", actionName: "publish" };
    const outcome: ActionExecutionOutcome = { refused: false };
    await runPreparedActionCall(publish, intent, ctx, outcome);
    expect({ parses, effects, received }).toEqual({
      parses: 1,
      effects: 1,
      received: [{ note: "draft!" }],
    });
    expect(outcome.record).toMatchObject({ readOnly: true });

    // Consumed: a second run with the same context parses for itself.
    await expect(
      publish.run(preparedCallArguments(intent), ctx),
    ).resolves.toEqual({ ok: true });
    expect(parses).toBe(2);
  });

  it("runs the arguments its gates read, whatever later happens to the parsed value", async () => {
    const parsed = { amount: 1, lines: [{ sku: "a" }] };
    const received: unknown[] = [];
    const publish = defineAction({
      description: "transformed write",
      schema: z.object({}).transform(() => parsed),
      run: async (args) => {
        received.push(structuredClone(args));
        // The handler may change its own arguments.
        args.amount = 0;
        return { ok: true };
      },
    });
    const intent = await actionCallIntent(publish, {});
    if (!intent.valid) throw intent.error;
    parsed.amount = 100;
    parsed.lines[0]!.sku = "b";

    const prepared = { amount: 1, lines: [{ sku: "a" }] };
    expect(intent.argumentsHash).toBe(actionArgumentsHash(prepared));
    // Every read is a copy of its own, which its reader may change.
    const first = preparedCallArguments(intent) as typeof prepared;
    expect(first).toEqual(prepared);
    first.lines[0]!.sku = "c";
    expect(preparedCallArguments(intent)).toEqual(prepared);
    await runPreparedActionCall(publish, intent, { caller: "tool" });
    expect(received).toEqual([prepared]);
    expect(preparedCallArguments(intent)).toEqual(prepared);
  });

  it("gives each gate, the handler and each later reader a copy of its own", async () => {
    // Freezing does not freeze a Date's time: a gate that shared the
    // handler's Date could change what the handler runs.
    const seen: Record<string, number> = {};
    const reset = (name: string) => (args: { at: Date }) => {
      seen[name] = args.at.getTime();
      args.at.setTime(0);
    };
    const publish = defineAction({
      description: "timed write",
      schema: z.object({}).transform(() => ({ at: new Date(1000) })),
      planMode: {
        effect: (args) => {
          reset("effect")(args);
          return "write";
        },
      },
      authorize: (args) => {
        reset("authorize")(args);
        return true;
      },
      audit: {
        target: (args) => {
          reset("audit")(args);
          return null;
        },
      },
      run: async (args) => {
        reset("handler")(args);
        return { ok: true };
      },
    });
    const intent = await actionCallIntent(publish, {});
    if (!intent.valid) throw intent.error;
    const ctx: ActionRunContext = { caller: "tool", actionName: "publish" };
    const outcome: ActionExecutionOutcome = { refused: false };
    await runPreparedActionCall(publish, intent, ctx, outcome);
    expect(seen).toEqual({
      effect: 1000,
      authorize: 1000,
      handler: 1000,
      audit: 1000,
    });
    const record = outcome.record;
    reset("record")(record?.args as { at: Date });
    expect((record?.args as { at: Date }).at.getTime()).toBe(1000);
    expect(intent.argumentsHash).toBe(
      actionArgumentsHash({ at: new Date(1000) }),
    );
  });

  it("refuses prepared arguments with an accessor, never reading or running it", async () => {
    let reads = 0;
    let runs = 0;
    const accessor = (shape: "getter" | "setter" | "array") => {
      if (shape === "array") {
        const lines: unknown[] = ["a"];
        Object.defineProperty(lines, 0, {
          enumerable: true,
          get: () => ++reads,
        });
        return { lines };
      }
      return Object.defineProperty({}, "amount", {
        enumerable: true,
        ...(shape === "getter" ? { get: () => ++reads } : { set() {} }),
      });
    };
    for (const shape of ["getter", "setter", "array"] as const) {
      const publish = defineAction({
        description: "transformed write",
        schema: z.object({}).transform(() => accessor(shape)),
        run: async () => {
          runs += 1;
          return { ok: true };
        },
      });
      const intent = await actionCallIntent(publish, {});
      expect(intent.valid).toBe(false);
      if (intent.valid) continue;
      expect(intent.error).toBeInstanceOf(UnsupportedActionArgumentError);
      expect(intent.error).toMatchObject({ kind: "accessor" });
    }
    expect({ reads, runs }).toEqual({ reads: 0, runs: 0 });
  });

  it("runs the preparation through a wrapper that rebuilds the context", async () => {
    let parses = 0;
    const received: unknown[] = [];
    const publish = defineAction({
      description: "transformed write",
      schema: z.object({
        at: z.string().transform((at) => {
          parses += 1;
          return new Date(at);
        }),
      }),
      run: async (args) => {
        received.push(args.at);
        return { ok: true };
      },
    });
    const wrapped = {
      ...publish,
      run: (args: any, ctx?: ActionRunContext) =>
        publish.run(args, { ...ctx, caller: "tool" as const }),
    };
    const intent = await actionCallIntent(wrapped, {
      at: "2026-01-01T00:00:00.000Z",
    });
    if (!intent.valid) throw intent.error;
    await expect(
      runPreparedActionCall(wrapped, intent, { caller: "tool" }),
    ).resolves.toEqual({ ok: true });
    expect(parses).toBe(1);
    expect(received).toEqual([new Date("2026-01-01T00:00:00.000Z")]);
  });

  it("runs only a call actionCallIntent prepared", () => {
    const publish = defineAction({
      description: "write",
      run: async () => ({ ok: true }),
    });
    const forged = {
      valid: true as const,
      args: {},
      readOnly: true,
      planModeRead: true,
    };
    expect(() =>
      runPreparedActionCall(publish, forged as never, { caller: "tool" }),
    ).toThrow(/Only a call prepared by actionCallIntent/);
  });

  it("records an invalid call through a discovered copy of the action", async () => {
    const tracked: Array<{ properties?: Record<string, unknown> }> = [];
    const { registerTrackingProvider, unregisterTrackingProvider } =
      await import("./tracking/registry.js");
    registerTrackingProvider({
      name: "discovered-invalid-call-spec",
      track: (event) => {
        tracked.push(event as { properties?: Record<string, unknown> });
      },
    });
    try {
      const discovered = loadActionsFromStaticRegistry({
        "rename-draft": {
          default: defineAction({
            description: "Rename the draft.",
            schema: z.object({ title: z.string() }),
            run: async () => ({ ok: true }),
          }),
        },
      })["rename-draft"]!;
      const intent = await actionCallIntent(discovered, {});
      expect(intent.valid).toBe(false);
      if (intent.valid) return;
      await expect(
        recordInvalidActionCall(
          discovered,
          {},
          { caller: "tool", actionName: "rename-draft" },
          intent.error,
        ),
      ).resolves.toBe(true);
      expect(
        tracked
          .filter((event) => event.properties?.action_name === "rename-draft")
          .map((event) => event.properties?.status),
      ).toEqual(["started", "failed"]);
    } finally {
      unregisterTrackingProvider("discovered-invalid-call-spec");
    }
  });

  it("reports an invalid call it has no action identity to record through", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        recordInvalidActionCall(
          { schema: z.object({ title: z.string() }) },
          {},
          { caller: "tool", actionName: "rename-draft" },
          new Error("invalid"),
        ),
      ).resolves.toBe(false);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("rename-draft refused invalid arguments"),
      );
    } finally {
      log.mockRestore();
    }
  });

  it('returns the configured fallback on mismatch under the "fallback" strategy', async () => {
    const fallback = { id: "fallback", count: 0 };
    const action = defineAction({
      description: "fallback output",
      schema: z.object({ x: z.string() }),
      outputSchema: z.object({ id: z.string(), count: z.number() }),
      outputErrorStrategy: "fallback",
      outputFallback: fallback,
      run: async () => ({ id: "abc", count: "nope" }),
    });
    const out = await action.run({ x: "hi" });
    expect(out).toBe(fallback);
    expect(action.outputErrorStrategy).toBe("fallback");
    expect(action.outputFallback).toBe(fallback);
  });

  it("validates INPUT before run() and OUTPUT after — both compose", async () => {
    let ran = false;
    const action = defineAction({
      description: "compose input + output validation",
      schema: z.object({ title: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      outputErrorStrategy: "strict",
      run: async (args: { title: string }) => {
        ran = true;
        return { ok: args.title.length > 0 };
      },
    });

    await expect(action.run({} as any)).rejects.toThrow(
      /Invalid action parameters/,
    );
    expect(ran).toBe(false);

    const out = await action.run({ title: "Hi" });
    expect(ran).toBe(true);
    expect(out).toEqual({ ok: true });
  });

  it("works in legacy parameters mode (no input schema, output validated)", async () => {
    const action = defineAction({
      description: "legacy params with output schema",
      parameters: { id: { type: "string" } },
      outputSchema: z.object({ count: z.number() }),
      outputErrorStrategy: "strict",
      run: async () => ({ count: 5 }),
    });
    const out = await action.run({ id: "x" });
    expect(out).toEqual({ count: 5 });
  });
});

describe("defineAction — mcpOutputSchema opt-in", () => {
  it("builds no MCP contract unless the action opts in", () => {
    const action = defineAction({
      description: "warn by default",
      schema: z.object({}),
      outputSchema: z.object({ id: z.string() }),
      run: async () => ({ id: "a" }),
    });
    expect(action.mcpOutputContract).toBeUndefined();
  });

  it("keeps the semantic contract apart from the derived MCP response contract", () => {
    const action = defineAction({
      description: "list ids",
      schema: z.object({}),
      outputSchema: z.array(z.object({ id: z.string() })),
      outputErrorStrategy: "strict",
      mcpOutputSchema: true,
      run: async () => [{ id: "a" }],
    });
    expect(action.mcpOutputContract?.semantic).toMatchObject({
      type: "array",
      items: { type: "object", required: ["id"] },
    });
    expect(action.mcpOutputContract?.response).toMatchObject({
      type: "object",
      properties: { items: { type: "array" } },
      required: ["items"],
    });
  });

  it("derives the contract from the output side of the schema", () => {
    const action = defineAction({
      description: "defaulted output",
      schema: z.object({}),
      outputSchema: z.object({ count: z.number().default(0) }),
      outputErrorStrategy: "strict",
      mcpOutputSchema: true,
      run: async () => ({}),
    });
    expect(action.mcpOutputContract?.semantic.required).toEqual(["count"]);
  });

  it.each([
    [
      "no outputSchema",
      { outputErrorStrategy: "strict" as const },
      /requires an outputSchema/,
    ],
    [
      "the default warn strategy",
      { outputSchema: z.object({ id: z.string() }) },
      /outputErrorStrategy: "strict"/,
    ],
    [
      "a fallback strategy",
      {
        outputSchema: z.object({ id: z.string() }),
        outputErrorStrategy: "fallback" as const,
        outputFallback: { id: "" },
      },
      /outputErrorStrategy: "strict"/,
    ],
    [
      "a scalar root",
      {
        outputSchema: z.string(),
        outputErrorStrategy: "strict" as const,
      },
      /root must be an object/,
    ],
    [
      "async validation metadata",
      {
        outputSchema: z.object({ id: z.string() }).meta({ $async: true }),
        outputErrorStrategy: "strict" as const,
      },
      /"\$async"/,
    ],
    [
      "a format the MCP check cannot validate",
      {
        outputSchema: z.object({
          id: z.string().meta({ format: "made-up" }),
        }),
        outputErrorStrategy: "strict" as const,
      },
      /format "made-up"/,
    ],
    [
      "a transform the output converter cannot represent",
      {
        outputSchema: z.object({ n: z.string().transform(Number) }),
        outputErrorStrategy: "strict" as const,
      },
      /Transforms cannot be represented/,
    ],
  ])("refuses to opt in with %s", (_label, fields, message) => {
    expect(() =>
      defineAction({
        description: "opt in",
        schema: z.object({}),
        ...fields,
        mcpOutputSchema: true,
        run: async () => ({ id: "a" }),
      } as any),
    ).toThrow(message);
  });
});

describe("defineAction — authorize", () => {
  it.each(["plain", "defined"])(
    "keeps a direct typed failure unknown after a %s write handler enters",
    async (kind) => {
      const failure = new AgentConnectionRequiredError("Connect provider", {
        provider: "test-provider",
      });
      const effects: string[] = [];
      const run = async () => {
        effects.push("sent");
        throw failure;
      };
      const publicRun =
        kind === "defined"
          ? defineAction({ description: "Write", run }).run
          : run;
      const outcome = { refused: false };
      await expect(
        runActionWithExecutionOutcome(publicRun, {}, undefined, outcome),
      ).rejects.toBe(failure);
      expect(effects).toEqual(["sent"]);
      expect(outcome.refused).toBe(false);
    },
  );

  it("preserves definite refusals through the production action registry loader", async () => {
    const handler = vi.fn(async () => "sent");
    const action = defineAction({
      description: "Write",
      schema: z.object({ valid: z.boolean() }),
      authorize: () => false,
      run: handler,
    });
    const loaded = loadActionsFromStaticRegistry({
      write: { default: action },
    }).write!;
    expect(loaded.run).toBe(action.run);
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(
        loaded.run,
        { valid: true },
        { caller: "tool" },
        outcome,
      ),
    ).rejects.toThrow();
    expect(handler).not.toHaveBeenCalled();
    expect(outcome.refused).toBe(true);
  });

  it.each(["plain", "defined"])(
    "keeps a %s parent write unknown after a shared question refusal",
    async (kind) => {
      const question = createUrlTools()["ask-question"]!;
      const effects: string[] = [];
      const run = async (_args: unknown, ctx?: ActionRunContext) => {
        effects.push("sent");
        return question.run({ question: "Which range?", options: "[]" }, ctx);
      };
      const parent =
        kind === "defined"
          ? defineAction({ description: "Parent write", run }).run
          : run;
      const outcome = { refused: false };
      await expect(
        runActionWithExecutionOutcome(parent, {}, { caller: "tool" }, outcome),
      ).rejects.toThrow("non-empty JSON array");
      expect(effects).toEqual(["sent"]);
      expect(outcome.refused).toBe(false);
    },
  );

  it("does not classify a typed output-processing failure as pre-execution", async () => {
    const failure = new AgentConnectionRequiredError("Connect provider", {
      provider: "test-child",
    });
    const effects: string[] = [];
    const action = defineAction({
      description: "Write with output validation",
      schema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }).transform(() => {
        throw failure;
      }),
      run: async () => {
        effects.push("sent");
        return { ok: true };
      },
    });
    const outcome = { refused: false };
    const error = await runActionWithExecutionOutcome(
      action.run,
      {},
      undefined,
      outcome,
    ).catch((err: unknown) => err);
    expect(isAgentConnectionRequiredError(error)).toBe(true);
    expect(error).toMatchObject({
      provider: "test-child",
      effect: "committed",
    });
    expect(effects).toEqual(["sent"]);
    expect(outcome.refused).toBe(false);
  });

  it("keeps concurrent failures separate when context and error objects are reused", async () => {
    const failure = new Error("Not authorized");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const handlerEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const action = defineAction({
      description: "Concurrent write",
      schema: z.object({ allowed: z.boolean() }),
      authorize: (args) => {
        if (!args.allowed) throw failure;
      },
      run: async () => {
        entered();
        await waiting;
        throw failure;
      },
    });
    const ctx: ActionRunContext = { caller: "tool" };
    const executed = { refused: false };
    const denied = { refused: false };
    const pending = runActionWithExecutionOutcome(
      action.run,
      { allowed: true },
      ctx,
      executed,
    );
    const rejection = expect(pending).rejects.toBe(failure);
    await handlerEntered;
    await expect(
      runActionWithExecutionOutcome(
        action.run,
        { allowed: false },
        ctx,
        denied,
      ),
    ).rejects.toBe(failure);
    release();
    await rejection;
    expect(denied.refused).toBe(true);
    expect(executed.refused).toBe(false);
  });

  it("does not erase a successful child write with a later typed refusal", async () => {
    const failure = new AgentConnectionRequiredError("Connect provider", {
      provider: "test-child",
    });
    const child = defineAction({
      description: "Child write",
      schema: z.object({}),
      run: async () => "sent",
    });
    const parent = defineAction({
      description: "Parent",
      schema: z.object({ child: z.boolean() }),
      authorize: (args) => {
        if (!args.child) throw failure;
      },
      run: async (args, ctx) => {
        if (args.child) await child.run({}, ctx);
        throw failure;
      },
    });
    const ctx: ActionRunContext = { caller: "tool" };
    const executed = { refused: false };
    await expect(
      runActionWithExecutionOutcome(parent.run, { child: true }, ctx, executed),
    ).rejects.toBe(failure);
    expect(executed.refused).toBe(false);
    const denied = { refused: false };
    await expect(
      runActionWithExecutionOutcome(parent.run, { child: false }, ctx, denied),
    ).rejects.toBe(failure);
    expect(denied.refused).toBe(true);
    expect(executed.refused).toBe(false);
  });

  it("keeps the call record through a wrapper that rebuilds the context", async () => {
    let writes = 0;
    const save = defineAction({
      description: "Child write",
      schema: z.object({}),
      run: async () => {
        writes += 1;
        return "saved";
      },
    });
    const read = defineAction({
      description: "Read that saves",
      schema: z.object({}),
      readOnly: true,
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        return "read";
      },
    });
    const wrapped = {
      ...read,
      run: (args: unknown, ctx?: ActionRunContext) =>
        read.run(args as any, { ...ctx, caller: ctx?.caller ?? "tool" }),
    };
    const { outcome, error } = await dispatch(
      wrapped,
      {},
      {
        actionName: "read",
      },
    );
    expect({ error, writes }).toEqual({ error: undefined, writes: 1 });
    expect(outcome.record).toMatchObject({
      readOnly: true,
      evidence: { writeEntered: true, changeEntered: true },
    });
    expect(invocationEffect(wrapped, outcome, { readOnly: true })).toEqual({
      effect: "committed",
      changed: true,
    });
  });

  it("keeps a nested write under an entry that does not carry the action's key", async () => {
    const save = defineAction({
      description: "Child write",
      schema: z.object({}),
      run: async () => "saved",
    });
    const read = defineAction({
      description: "Read that saves",
      schema: z.object({}),
      readOnly: true,
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        return "read";
      },
    });
    const entry = {
      readOnly: true,
      run: (args: unknown, ctx?: ActionRunContext) =>
        read.run(args as any, { ...ctx }),
    };
    const { outcome } = await dispatch(entry, {}, {});
    expect(invocationEffect(entry, outcome, { readOnly: true })).toEqual({
      effect: "committed",
      changed: true,
    });
  });

  it("decides from what has run while the call is still running", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let saved!: () => void;
    const wrote = new Promise<void>((resolve) => (saved = resolve));
    const save = defineAction({
      description: "Child write",
      schema: z.object({}),
      run: async () => {
        saved();
        return "saved";
      },
    });
    const read = defineAction({
      description: "Read that saves",
      schema: z.object({}),
      readOnly: true,
      run: async (_args, ctx) => {
        await save.run({}, ctx);
        await held;
        return "read";
      },
    });
    const outcome: ActionExecutionOutcome = { refused: false };
    const running = runActionWithExecutionOutcome(
      read.run,
      {},
      {},
      outcome,
      read,
    );
    await wrote;
    // Abandoned now, the call may have written.
    expect(
      invocationEffect(read, outcome, {
        readOnly: true,
        failed: { lost: true },
      }),
    ).toEqual({ effect: "unknown", changed: true });
    release();
    await running;
    expect(invocationEffect(read, outcome, { readOnly: true })).toEqual({
      effect: "committed",
      changed: true,
    });
  });

  it("does not let a call that starts after the dispatch settled record on it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const read = defineAction({
      description: "Read",
      schema: z.object({}),
      readOnly: true,
      run: async () => "read",
    });
    let late!: Promise<unknown>;
    const wrapper = {
      ...read,
      run: async (args: any, ctx?: ActionRunContext) => {
        late = held.then(() => read.run(args, ctx));
        return "returned";
      },
    };
    const outcome: ActionExecutionOutcome = { refused: false };
    await runActionWithExecutionOutcome(wrapper.run, {}, {}, outcome, wrapper);
    release();
    await late;
    expect(outcome.record).toBeUndefined();
    expect(invocationEffect(wrapper, outcome, { readOnly: true })).toEqual({
      effect: "unknown",
      changed: true,
    });
  });

  it("keeps a call's own typed failure once another call has thrown it again", async () => {
    const write = defineAction({
      description: "Write",
      schema: z.object({}),
      retrySafe: true,
      outputSchema: z.literal("ok"),
      outputErrorStrategy: "strict",
      run: async () => "bad" as any,
    });
    const first = await dispatch(write, {}, {});
    const other = {
      run: async () => {
        throw first.error;
      },
    };
    const second = await dispatch(other, {}, {});
    expect(second.error).toBe(first.error);
    expect(
      invocationEffect(write, first.outcome, {
        retrySafe: true,
        failed: { error: first.error },
      }).effect,
    ).toBe("committed");
  });

  it("lets a receipt or retrySafe narrow only the call's own write", async () => {
    const save = defineAction({
      description: "Child write",
      schema: z.object({}),
      run: async () => "saved",
    });
    const write = (nested: boolean) =>
      defineAction({
        description: "Write",
        schema: z.object({ fail: z.boolean() }),
        retrySafe: true,
        run: async ({ fail }, ctx) => {
          if (nested) await save.run({}, ctx);
          if (fail) throw new Error("failed after writing");
          return { _receipt: { changed: false, verified: true, summary: "" } };
        },
      });
    for (const nested of [false, true]) {
      const action = write(nested);
      const failed = await dispatch(action, { fail: true }, {});
      const returned = await dispatch(action, { fail: false }, {});
      expect([
        invocationEffect(action, failed.outcome, {
          retrySafe: true,
          failed: { error: failed.error },
        }).effect,
        invocationEffect(action, returned.outcome, {
          receipt: { changed: false },
        }).effect,
      ]).toEqual(nested ? ["unknown", "committed"] : ["none", "none"]);
    }
  });

  it("decides an action that left no record as unknown, and a plain entry by its declaration", async () => {
    const read = defineAction({
      description: "Read",
      schema: z.object({}),
      readOnly: true,
      run: async () => "read",
    });
    const skipped = await dispatch(
      { ...read, run: async () => "from elsewhere" },
      {},
      {},
    );
    expect(
      invocationEffect(read, skipped.outcome, {
        readOnly: true,
        receipt: { changed: false },
      }),
    ).toEqual({ effect: "unknown", changed: true });
    const plain = await dispatch({ run: async () => "plain" }, {}, {});
    expect(invocationEffect({}, plain.outcome, { readOnly: true })).toEqual({
      effect: "none",
      changed: false,
    });
  });

  it("tracks child writes for plain action entries too", async () => {
    const failure = new AgentConnectionRequiredError("Connect provider", {
      provider: "test-child",
    });
    const child = defineAction({
      description: "Child write",
      run: async () => "sent",
    });
    const parent = async () => {
      await child.run({});
      throw failure;
    };
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(parent, {}, undefined, outcome),
    ).rejects.toBe(failure);
    expect(outcome.refused).toBe(false);
  });

  it.each(["cloned", "omitted"])(
    "does not inherit a nested refusal with a %s child context",
    async (contextKind) => {
      const failure = new AgentConnectionRequiredError(
        "Connect child provider",
        {
          provider: "test-child",
        },
      );
      const child = defineAction({
        description: "Child",
        schema: z.object({}),
        run: async () => {
          throw failure;
        },
      });
      const effects: string[] = [];
      const parent = defineAction({
        description: "Parent write",
        schema: z.object({}),
        run: async (_args, ctx) => {
          effects.push("sent");
          return child.run(
            {},
            contextKind === "cloned" ? { ...ctx! } : undefined,
          );
        },
      });
      const ctx: ActionRunContext = { caller: "tool" };
      const outcome = { refused: false };
      await expect(
        runActionWithExecutionOutcome(parent.run, {}, ctx, outcome),
      ).rejects.toBe(failure);
      expect(effects).toEqual(["sent"]);
      expect(outcome.refused).toBe(false);
    },
  );

  it("does not inherit a recursive invocation's refusal after a parent write", async () => {
    const failure = new AgentConnectionRequiredError("Connect child provider", {
      provider: "test-child",
    });
    const effects: string[] = [];
    const recursive = defineAction({
      description: "Recursive write",
      schema: z.object({ child: z.boolean() }),
      run: async (args, ctx): Promise<unknown> => {
        if (args.child) throw failure;
        effects.push("sent");
        return recursive.run({ child: true }, ctx);
      },
    });
    const ctx: ActionRunContext = { caller: "tool" };
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(
        recursive.run,
        { child: false },
        ctx,
        outcome,
      ),
    ).rejects.toBe(failure);
    expect(effects).toEqual(["sent"]);
    expect(outcome.refused).toBe(false);
  });

  it("does not inherit a nested failure's refusal guarantee after the parent handler entered", async () => {
    const failure = new AgentConnectionRequiredError("Connect child provider", {
      provider: "test-child",
    });
    const child = defineAction({
      description: "Child",
      schema: z.object({}),
      run: async () => {
        throw failure;
      },
    });
    const read = defineAction({
      description: "Read",
      schema: z.object({}),
      readOnly: true,
      run: async () => "read",
    });
    const parent = defineAction({
      description: "Parent write",
      schema: z.object({}),
      run: async (_args, ctx) => {
        try {
          await child.run({}, ctx);
        } catch (error) {
          expect(error).toBe(failure);
        }
        await read.run({}, ctx);
        throw failure;
      },
    });
    const ctx: ActionRunContext = { caller: "tool" };
    const outcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(parent.run, {}, ctx, outcome),
    ).rejects.toBe(failure);
    expect(outcome.refused).toBe(false);
  });
  it("preserves a denial without treating the same error from a later handler as pre-execution", async () => {
    const denial = Object.assign(new Error("Not authorized"), {
      statusCode: 403,
    });
    let allowed = false;
    const run = vi.fn(async () => {
      throw denial;
    });
    const action = defineAction({
      description: "Write with authorization",
      schema: z.object({}),
      authorize: () => {
        if (!allowed) throw denial;
      },
      run,
    });
    const first: ActionRunContext = { caller: "tool" };
    const second: ActionRunContext = { caller: "tool" };
    const firstOutcome = { refused: false };
    const secondOutcome = { refused: false };
    await expect(
      runActionWithExecutionOutcome(action.run, {}, first, firstOutcome),
    ).rejects.toBe(denial);
    expect(run).not.toHaveBeenCalled();
    expect(firstOutcome.refused).toBe(true);
    expect(secondOutcome.refused).toBe(false);
    allowed = true;
    await expect(
      runActionWithExecutionOutcome(action.run, {}, second, secondOutcome),
    ).rejects.toBe(denial);
    expect(run).toHaveBeenCalledTimes(1);
    expect(secondOutcome.refused).toBe(false);
    await expect(
      runActionWithExecutionOutcome(action.run, {}, first, firstOutcome),
    ).rejects.toBe(denial);
    expect(firstOutcome.refused).toBe(false);
  });
  it("runs the gate before the body and passes args + ctx through", async () => {
    const authorize = vi.fn();
    const run = vi.fn(async () => ({ ok: true }));
    const action = defineAction({
      description: "guarded",
      schema: z.object({ id: z.string() }),
      authorize,
      run,
    });

    await action.run({ id: "a1" }, { caller: "http", userEmail: "a@b.c" });

    expect(authorize).toHaveBeenCalledWith(
      { id: "a1" },
      expect.objectContaining({ caller: "http", userEmail: "a@b.c" }),
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("denies with 403 when the gate returns false, without running the body", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const action = defineAction({
      description: "guarded",
      schema: z.object({ id: z.string() }),
      authorize: () => false,
      run,
    });

    await expect(action.run({ id: "a1" }, { caller: "tool" })).rejects.toThrow(
      /Not authorized/,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("propagates the gate's own error so a specific denial keeps its message", async () => {
    const run = vi.fn(async () => ({ ok: true }));
    const denial = Object.assign(new Error("Requires coach role coach-admin"), {
      statusCode: 403,
    });
    const action = defineAction({
      description: "guarded",
      schema: z.object({ id: z.string() }),
      authorize: () => {
        throw denial;
      },
      run,
    });

    await expect(action.run({ id: "a1" }, { caller: "mcp" })).rejects.toBe(
      denial,
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("allows when the gate returns nothing — the permissive default is explicit", async () => {
    const action = defineAction({
      description: "guarded",
      schema: z.object({ id: z.string() }),
      authorize: () => undefined,
      run: async () => ({ ok: true }),
    });
    expect(await action.run({ id: "a1" }, { caller: "cli" })).toEqual({
      ok: true,
    });
  });

  it("gates input-invalid calls too — validation still runs first", async () => {
    const authorize = vi.fn();
    const action = defineAction({
      description: "guarded",
      schema: z.object({ id: z.string() }),
      authorize,
      run: async () => ({ ok: true }),
    });

    await expect(
      action.run({ id: 42 } as never, { caller: "http" }),
    ).rejects.toThrow(/Invalid action parameters/);
    expect(authorize).not.toHaveBeenCalled();
  });
});

describe("AgentActionStopError", () => {
  it("carries the stop marker, safe details, errorCode, and toolResult", () => {
    const err = new AgentActionStopError("nothing more to do", {
      errorCode: "DONE",
      details: { reason: "complete" },
      toolResult: "Stopped.",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentActionStopError");
    expect(err.agentNativeStop).toBe(true);
    expect(err.errorCode).toBe("DONE");
    expect(err.details).toEqual({ reason: "complete" });
    expect(err.toolResult).toBe("Stopped.");
  });

  it("isAgentActionStopError recognizes real instances and duck-typed objects", () => {
    expect(isAgentActionStopError(new AgentActionStopError("x"))).toBe(true);
    expect(isAgentActionStopError({ agentNativeStop: true })).toBe(true);
  });

  it("isAgentActionStopError rejects ordinary errors and non-objects", () => {
    expect(isAgentActionStopError(new Error("boom"))).toBe(false);
    expect(isAgentActionStopError({ agentNativeStop: false })).toBe(false);
    expect(isAgentActionStopError(null)).toBe(false);
    expect(isAgentActionStopError("agentNativeStop")).toBe(false);
  });
});

describe("AgentConnectionRequiredError", () => {
  it("carries only a trusted provider reference and resumable reason", () => {
    const error = new AgentConnectionRequiredError("Slack must be connected.", {
      provider: "slack",
      reason: "grant",
      appId: "dispatch",
    });

    expect(isAgentConnectionRequiredError(error)).toBe(true);
    expect(error).toMatchObject({
      agentNativeStop: true,
      agentConnectionRequired: true,
      errorCode: "connection_required",
      provider: "slack",
      reason: "grant",
      appId: "dispatch",
    });
    expect(error).not.toHaveProperty("url");
    expect(error).not.toHaveProperty("scopes");
  });
});

describe("gateway-stringified tool-arg coercion", () => {
  function makeAction() {
    let received: any = null;
    const action = defineAction({
      description: "dashboard-like action",
      schema: z.object({
        dashboardId: z.string(),
        forceNew: z.boolean().optional(),
        limit: z.number().optional(),
        ops: z
          .array(z.object({ op: z.string(), value: z.unknown().optional() }))
          .optional(),
      }),
      http: false,
      run: async (args: any) => {
        received = args;
        return "ok";
      },
    });
    return { action, get: () => received };
  }

  it("coerces a stringified array, boolean, and number to native types", async () => {
    const { action, get } = makeAction();
    await action.run({
      dashboardId: "d1",
      forceNew: "true",
      limit: "20",
      ops: '[{"op":"insert","value":{"id":"p1"}}]',
    } as any);
    expect(get()).toEqual({
      dashboardId: "d1",
      forceNew: true,
      limit: 20,
      ops: [{ op: "insert", value: { id: "p1" } }],
    });
  });

  it("leaves genuine string fields untouched even when they look like JSON", async () => {
    const { action, get } = makeAction();
    await action.run({ dashboardId: "[1,2,3]" } as any);
    expect(get().dashboardId).toBe("[1,2,3]");
  });

  it("does not swallow a truly invalid stringified array — validation still errors", async () => {
    const { action } = makeAction();
    await expect(
      action.run({ dashboardId: "d1", ops: "[not json" } as any),
    ).rejects.toThrow(/Invalid action parameters/);
  });

  it("passes native (already-typed) args through unchanged", async () => {
    const { action, get } = makeAction();
    await action.run({
      dashboardId: "d1",
      forceNew: false,
      ops: [{ op: "remove" }],
    } as any);
    expect(get()).toEqual({
      dashboardId: "d1",
      forceNew: false,
      ops: [{ op: "remove" }],
    });
  });
});
