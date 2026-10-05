import { describe, expect, it } from "vitest";

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
