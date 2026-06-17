import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  defineAction,
  AgentActionStopError,
  isAgentActionStopError,
} from "./action.js";

// Uses the legacy `parameters` mode so we don't need to pull in zod as a test
// dep — the readOnly inference logic is independent of the schema path.
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
    // Stored as explicit false so the HTTP router / agent dispatcher emit a
    // refresh event even though the method is GET.
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
      // arrays and non-functions must be rejected, not threaded through
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

// ---------------------------------------------------------------------------
// Schema mode — JSON Schema conversion for the Claude API tool definition.
// ---------------------------------------------------------------------------
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
    // status has a default → must NOT be required; optional field also not required.
    expect(params.required).toEqual(["title"]);
    // enum values surface as a string enum.
    expect(params.properties.status.enum).toEqual([
      "draft",
      "published",
      "closed",
    ]);
    // description from .describe() is carried through.
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

  it("stores the original schema on the entry for downstream re-validation", () => {
    const schema = z.object({ x: z.string() });
    const action = defineAction({
      description: "keeps schema",
      schema,
      run: async () => "ok",
    });
    expect(action.schema).toBe(schema);
  });
});

// ---------------------------------------------------------------------------
// Runtime validation wrapper — the most important behavior: invalid agent
// input is rejected with a self-correcting error and never reaches run().
// ---------------------------------------------------------------------------
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
    // Default applied by the schema before reaching run().
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
    // Echoes what was actually passed…
    expect(message).toContain('Received: {"slideId":"s1"}');
    // …and the expected signature with required (*) / optional (?) markers.
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
    // A wrong-type error is NOT classified as "missing".
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
    // The truncation ellipsis is appended; the full 2000-char blob is not echoed.
    expect(message).toContain("…");
    expect(message.length).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// AgentActionStopError — the stop-the-turn signal used by actions.
// ---------------------------------------------------------------------------
describe("AgentActionStopError", () => {
  it("carries the stop marker, errorCode, and toolResult", () => {
    const err = new AgentActionStopError("nothing more to do", {
      errorCode: "DONE",
      toolResult: "Stopped.",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AgentActionStopError");
    expect(err.agentNativeStop).toBe(true);
    expect(err.errorCode).toBe("DONE");
    expect(err.toolResult).toBe("Stopped.");
  });

  it("isAgentActionStopError recognizes real instances and duck-typed objects", () => {
    expect(isAgentActionStopError(new AgentActionStopError("x"))).toBe(true);
    // Duck-typed (e.g. structured-cloned across a worker boundary).
    expect(isAgentActionStopError({ agentNativeStop: true })).toBe(true);
  });

  it("isAgentActionStopError rejects ordinary errors and non-objects", () => {
    expect(isAgentActionStopError(new Error("boom"))).toBe(false);
    expect(isAgentActionStopError({ agentNativeStop: false })).toBe(false);
    expect(isAgentActionStopError(null)).toBe(false);
    expect(isAgentActionStopError("agentNativeStop")).toBe(false);
  });
});
