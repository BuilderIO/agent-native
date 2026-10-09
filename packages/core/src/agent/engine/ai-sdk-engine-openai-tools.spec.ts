import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineAction } from "../../action.js";
import { createAISDKEngine } from "./ai-sdk-engine.js";

describe("AISDKEngine OpenAI tool wire format", () => {
  it.each([
    {
      provider: "openai" as const,
      model: "gpt-6-luna",
      config: {},
      responses: true,
    },
    {
      provider: "openai" as const,
      model: "gpt-6-luna",
      config: { baseUrl: "https://gateway.example.test/v1" },
      responses: false,
    },
    {
      provider: "openai" as const,
      model: "gpt-6-luna",
      config: {
        baseUrl: "https://gateway.example.test/v1",
        forceResponses: true,
      },
      responses: true,
    },
    {
      provider: "groq" as const,
      model: "llama-3.3-70b-versatile",
      config: {},
      responses: false,
    },
    {
      provider: "mistral" as const,
      model: "mistral-large-latest",
      config: {},
      responses: false,
    },
  ])(
    "preserves omission for $provider with $config",
    async ({ provider, model, config, responses }) => {
      const bodies: Record<string, any>[] = [];
      const requestFetch: typeof fetch = async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(
          JSON.stringify({
            error: { message: "stop", type: "invalid_request" },
          }),
          { status: 400, headers: { "content-type": "application/json" } },
        );
      };
      const engine = createAISDKEngine(provider, {
        apiKey: "sk-test",
        requestFetch,
        ...config,
      });

      for await (const _ of engine.stream({
        model,
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

      expect(bodies).toHaveLength(1);
      const tool = responses ? bodies[0].tools[0] : bodies[0].tools[0].function;
      expect(tool).toMatchObject({ name: "update-slide", strict: false });
      expect(tool.parameters.required).toEqual(["deckId"]);
      expect(tool.parameters.properties.find).toEqual({ type: "string" });
    },
  );
});

describe("AISDKEngine OpenRouter tool wire format", () => {
  it("retains serialized tool semantics and streams before the response finishes", async () => {
    const bodies: Record<string, any>[] = [];
    let finishResponse!: () => void;
    const finish = new Promise<void>((resolve) => {
      finishResponse = resolve;
    });
    const encoder = new TextEncoder();
    const packet = (
      delta: Record<string, unknown>,
      finishReason: string | null = null,
    ) =>
      `data: ${JSON.stringify({ id: "test-stream", object: "chat.completion.chunk", created: 1, model: "openai/gpt-6-luna", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    const requestFetch: typeof fetch = async (_input, init) => {
      expect(typeof init?.body).toBe("string");
      bodies.push(JSON.parse(init!.body as string));
      return new Response(
        new ReadableStream<Uint8Array>({
          async start(controller) {
            const first = encoder.encode(packet({ content: "Listing" }));
            controller.enqueue(first.slice(0, 7));
            controller.enqueue(first.slice(7));
            await finish;
            controller.enqueue(
              encoder.encode(
                packet({
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-events",
                      type: "function",
                      function: { name: "list-events", arguments: '{"from":' },
                    },
                  ],
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(
                packet({
                  tool_calls: [
                    { index: 0, function: { arguments: '"2026-10-06"}' } },
                  ],
                }),
              ),
            );
            controller.enqueue(
              encoder.encode(packet({}, "tool_calls") + "data: [DONE]\n\n"),
            );
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const action = defineAction({
      description: "List events",
      schema: z.object({
        from: z.string(),
        accountEmails: z.array(z.string().email()).optional(),
      }),
      run: async () => [],
    });
    const engine = createAISDKEngine("openrouter", {
      apiKey: "test-key",
      requestFetch,
    });
    const events = [];
    let streamedBeforeFinish = false;
    try {
      for await (const event of engine.stream({
        model: "openai/gpt-6-luna",
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
        events.push(event);
        if (event.type === "text-delta" && event.text === "Listing") {
          streamedBeforeFinish = true;
          finishResponse();
        }
      }
    } finally {
      finishResponse();
    }
    expect(streamedBeforeFinish).toBe(true);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].tools[0].function).toMatchObject({
      strict: false,
      parameters: action.tool.parameters,
    });
    expect(events).toContainEqual({
      type: "tool-call",
      id: "call-events",
      name: "list-events",
      input: { from: "2026-10-06" },
    });
    expect(events).toContainEqual({ type: "stop", reason: "tool_use" });
  });

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
