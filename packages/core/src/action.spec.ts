import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

import {
  defineAction,
  ActionContractError,
  isActionContractError,
  runActionWithExecutionOutcome,
  type ActionRunContext,
  AgentActionStopError,
  AgentConnectionRequiredError,
  isAgentActionStopError,
  isAgentConnectionRequiredError,
  isActionExposedToExternalAgents,
  isActionHiddenFromEveryAgentSurface,
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

  it('throws a clear error on mismatch under the "strict" strategy', async () => {
    const action = defineAction({
      description: "strict output",
      schema: z.object({ x: z.string() }),
      outputSchema: z.object({ id: z.string() }),
      outputErrorStrategy: "strict",
      run: async () => ({ wrong: true }),
    });
    await expect(action.run({ x: "hi" })).rejects.toThrow(
      /did not match outputSchema/,
    );
    expect(action.outputErrorStrategy).toBe("strict");
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
    await expect(
      runActionWithExecutionOutcome(action.run, {}, undefined, outcome),
    ).rejects.toBe(failure);
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
