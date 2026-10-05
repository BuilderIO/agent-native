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

    // OpenRouter's SDK drops function-tool `strict`, including in v3.1.0.
    // Gateways forwarding to Responses can then require every optional field.
    // Keep action omission semantics without adding nulls to their schemas.
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
