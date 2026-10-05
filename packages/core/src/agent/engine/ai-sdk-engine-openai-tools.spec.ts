import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { createAISDKEngine } from "./ai-sdk-engine.js";

describe("AISDKEngine OpenAI tool wire format", () => {
  it("sends action tools as non-strict so optional parameters stay omittable", async () => {
    const bodies: Record<string, any>[] = [];
    const requestFetch: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ error: { message: "stop", type: "invalid_request" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    };
    const engine = createAISDKEngine("openai", {
      apiKey: "sk-test",
      requestFetch,
    });

    for await (const _ of engine.stream({
      model: "gpt-5.6-luna",
      systemPrompt: "",
      messages: [{ role: "user", content: [{ type: "text", text: "edit" }] }],
      tools: [
        {
          name: "update-slide",
          description: "Edit one slide",
          inputSchema: {
            type: "object",
            properties: {
              deckId: { type: "string" },
              find: { type: "string" },
              objectId: { type: "string" },
            },
            required: ["deckId"],
          },
        },
      ],
      abortSignal: new AbortController().signal,
    })) {
      // drain
    }

    expect(bodies[0]?.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "update-slide",
        strict: false,
      }),
    ]);
  });
});

describe("AISDKEngine OpenRouter tool wire format", () => {
  it.each(["openai/gpt-6-luna", "anthropic/claude-sonnet-5.5"])(
    "keeps optional action parameters omittable for %s",
    async (model) => {
      const bodies: Record<string, any>[] = [];
      const requestFetch: typeof fetch = async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({ error: { message: "stop", code: 400 } }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      };
      const action = defineAction({
        description: "List events in a date range",
        schema: z.object({
          from: z.string(),
          accountEmails: z.array(z.string().email()).optional(),
          calendarSourceKeys: z.array(z.string()).optional(),
          options: z.object({ limit: z.number().optional() }).optional(),
        }),
        run: async () => ({ events: [] }),
      });
      const engine = createAISDKEngine("openrouter", {
        apiKey: "test-key",
        requestFetch,
      });

      for await (const _ of engine.stream({
        model,
        systemPrompt: "",
        messages: [{ role: "user", content: [{ type: "text", text: "list" }] }],
        tools: [
          {
            name: "list-events",
            description: action.tool.description,
            inputSchema: action.tool.parameters,
          },
        ],
        abortSignal: new AbortController().signal,
      })) {
        // drain
      }

      expect(bodies).toHaveLength(1);
      expect(bodies[0]?.tools).toEqual([
        {
          type: "function",
          function: {
            name: "list-events",
            description: action.tool.description,
            parameters: action.tool.parameters,
            strict: false,
          },
        },
      ]);
      expect(bodies[0]?.tools[0].function.parameters.required).toEqual([
        "from",
      ]);
    },
  );
});
