import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenRouterToolFetch } from "./openrouter-tool-fetch.js";

afterEach(() => vi.unstubAllGlobals());

describe("OpenRouter tool request transport", () => {
  it("preserves fetch options, provider tools and response-format strictness", async () => {
    const response = new Response("data: [DONE]\n\n");
    const requestFetch = vi.fn<typeof fetch>().mockResolvedValue(response);
    const signal = new AbortController().signal;
    const headers = new Headers({ authorization: "Bearer test-key" });
    const providerTool = { type: "web_search", id: "openrouter:web_search" };
    const body = {
      model: "openai/gpt-6-luna",
      stream: true,
      response_format: { type: "json_schema", json_schema: { strict: true } },
      tools: [
        { type: "function", function: { name: "list_events", parameters: {} } },
        providerTool,
      ],
    };
    const result = await createOpenRouterToolFetch(requestFetch)(
      "https://gateway.example.test/chat/completions",
      { method: "POST", headers, signal, body: JSON.stringify(body) },
    );

    expect(result).toBe(response);
    expect(requestFetch).toHaveBeenCalledExactlyOnceWith(
      "https://gateway.example.test/chat/completions",
      {
        method: "POST",
        headers,
        signal,
        body: JSON.stringify({
          ...body,
          tools: [
            {
              ...body.tools[0],
              function: { ...body.tools[0].function, strict: false },
            },
            providerTool,
          ],
        }),
      },
    );
  });

  it("uses the default fetch and leaves tool-free requests untouched", async () => {
    const requestFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response());
    vi.stubGlobal("fetch", requestFetch);
    const init = { method: "POST", body: '{ "messages": [] }' };
    await createOpenRouterToolFetch()(
      "https://openrouter.ai/api/v1/chat/completions",
      init,
    );
    expect(requestFetch).toHaveBeenCalledExactlyOnceWith(
      "https://openrouter.ai/api/v1/chat/completions",
      init,
    );
  });

  it("does not swallow malformed request JSON", () => {
    const requestFetch = vi.fn<typeof fetch>();
    expect(() =>
      createOpenRouterToolFetch(requestFetch)("https://openrouter.ai", {
        method: "POST",
        body: "{invalid",
      }),
    ).toThrow(SyntaxError);
    expect(requestFetch).not.toHaveBeenCalled();
  });
});
