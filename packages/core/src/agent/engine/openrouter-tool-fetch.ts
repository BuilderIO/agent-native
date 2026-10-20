export function createOpenRouterToolFetch(
  requestFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return (input, init) => {
    if (typeof init?.body !== "string") return requestFetch(input, init);

    const body = JSON.parse(init.body) as {
      tools?: Array<{
        type: string;
        function?: Record<string, unknown>;
      }>;
    };
    if (!body.tools?.length) return requestFetch(input, init);

    // Temporary adapter until OpenRouter's SDK forwards the standard tool.strict
    // flag (still dropped in v3.1.0). Keep the wire regression when removing this.
    return requestFetch(input, {
      ...init,
      body: JSON.stringify({
        ...body,
        tools: body.tools.map((tool) =>
          tool.type === "function" && tool.function
            ? { ...tool, function: { ...tool.function, strict: false } }
            : tool,
        ),
      }),
    });
  };
}
