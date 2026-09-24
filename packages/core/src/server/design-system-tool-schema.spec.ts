import { createOpenAI } from "@ai-sdk/openai";
import { jsonSchema } from "ai";
import { describe, expect, it, vi } from "vitest";

import { defineAction } from "../action.js";
import { engineToolsToAISDK } from "../agent/engine/translate-ai-sdk.js";
import { actionsToEngineTools } from "../agent/production-agent.js";
import { searchToolRegistry } from "../agent/tool-search.js";
import {
  designSystemArtifactInputFromContent,
  writeDesignSystemArtifactAgentSchema,
} from "../shared/design-system-authoring.js";

const action = defineAction({
  description: "Write design system artifact",
  schema: writeDesignSystemArtifactAgentSchema,
  run: (args) => designSystemArtifactInputFromContent(args),
  audit: false,
});
const registry = { "write-design-system-artifact": action };
const base = {
  id: "example-system",
  targetId: "typography",
  expectedRevision: 0,
  operationId: "write-typography",
  name: "Typography",
  provenance: "generated" as const,
  sourceIds: [],
};

function checkSchema(raw: unknown) {
  const schema = raw as Record<string, any>;
  expect(schema.type).toBe("object");
  expect(schema.required).toContain("content");
  expect(schema.properties.provenance.enum).toEqual([
    "inferred",
    "generated",
    "manual",
  ]);
  const branches = schema.properties.content.anyOf;
  expect(branches).toHaveLength(3);
  const foundation = branches.find(
    (branch: any) => branch.properties.kind.const === "foundation",
  );
  expect(foundation.required).toEqual(["kind", "tokens"]);
  expect(foundation.properties.tokens.minItems).toBe(1);
  expect(foundation.properties.tokens.items.required).toEqual([
    "name",
    "value",
  ]);
  const visit = (node: Record<string, any>) => {
    if (node.type === "object") {
      expect(node.additionalProperties).toBe(false);
      expect([...node.required].sort()).toEqual(
        Object.keys(node.properties).sort(),
      );
      Object.values(node.properties).forEach((child) =>
        visit(child as Record<string, any>),
      );
    }
    if (node.items) visit(node.items);
    if (node.anyOf) node.anyOf.forEach(visit);
  };
  visit(schema);
}

describe("artifact schema at the native tool/model boundary", () => {
  it("retains mandatory typed content through action advertisement, tool search, native engine and AI SDK", async () => {
    checkSchema(action.tool.parameters);
    const search = searchToolRegistry(registry, {
      query: "write-design-system-artifact",
      includeSchemas: true,
    });
    checkSchema(search.results[0].inputSchema);
    const tools = actionsToEngineTools(registry);
    checkSchema(tools[0].inputSchema);
    const translated = engineToolsToAISDK(tools, jsonSchema);
    checkSchema(
      await translated["write-design-system-artifact"].inputSchema.jsonSchema,
    );
  });

  it("retains the same required payload in the actual OpenAI provider request serializer without a network/model call", async () => {
    let request: Record<string, any> | undefined;
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      request = JSON.parse(String(init?.body));
      throw new Error("SCHEMA_CAPTURE_ONLY_NO_NETWORK");
    });
    const provider = createOpenAI({
      apiKey: "EXAMPLE_TEST_ONLY_NOT_A_REAL_KEY",
      fetch,
    });
    const tools = actionsToEngineTools(registry);
    await expect(
      provider.responses("gpt-5-mini").doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Schema serialization test; no model request.",
              },
            ],
          },
        ],
        tools: tools.map((tool) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          strict: true,
        })),
      }),
    ).rejects.toThrow("SCHEMA_CAPTURE_ONLY_NO_NETWORK");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request!.tools[0].strict).toBe(true);
    checkSchema(request!.tools[0].parameters);
  });

  it("rejects the exact missing-payload failure at the advertised boundary and normalizes actual typed payloads", async () => {
    const failedArgs = {
      id: "ds-c6dbd9d335c29ad70c9b4945a1cb7ed3",
      targetId: "typography",
      expectedRevision: 0,
      operationId: "qa-civic-parks-typography-v1",
      kind: "foundation",
      name: "Civic Parks Typography",
      provenance: "generated",
    };
    expect(
      writeDesignSystemArtifactAgentSchema.safeParse(failedArgs).success,
    ).toBe(false);
    await expect(action.run(failedArgs as never)).rejects.toThrow(/content/);
    await expect(
      action.run({
        ...base,
        content: {
          kind: "foundation",
          tokens: [
            { name: "headingFont", value: "Inter" },
            { name: "headingSizes.h1", value: "48px" },
          ],
        },
      }),
    ).resolves.toMatchObject({
      kind: "foundation",
      values: { headingFont: "Inter", "headingSizes.h1": "48px" },
    });
    await expect(
      action.run({
        ...base,
        targetId: "button",
        content: {
          kind: "component",
          html: "<html><body><button>Continue</button></body></html>",
        },
      }),
    ).resolves.toMatchObject({
      kind: "component",
      html: expect.stringContaining("Continue"),
    });
    await expect(
      action.run({
        ...base,
        targetId: "usage",
        content: { kind: "usage-rule", text: "One primary action per form." },
      }),
    ).resolves.toMatchObject({
      kind: "usage-rule",
      text: "One primary action per form.",
    });
  });
  it("rejects an extracted claim for model-authored artifacts without coercing provenance", async () => {
    const input = {
      ...base,
      content: {
        kind: "foundation" as const,
        tokens: [{ name: "radius", value: "0px" }],
      },
    };
    await expect(
      action.run({ ...input, provenance: "extracted" } as never),
    ).rejects.toThrow(/provenance/);
    await expect(
      action.run({ ...input, provenance: "inferred" }),
    ).resolves.toMatchObject({
      provenance: "inferred",
      values: { radius: "0px" },
    });
  });
});
