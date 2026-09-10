const SITE_URL = "https://www.agent-native.com";

export function acceptsMarkdown(accept: string | undefined): boolean {
  return (accept ?? "").split(",").some((value) => {
    const [mediaType, ...parameters] = value.trim().toLowerCase().split(";");
    if (mediaType !== "text/markdown") return false;
    const quality = parameters
      .map((parameter) => parameter.trim().split("=", 2))
      .find(([name]) => name === "q")?.[1];
    return quality === undefined || Number(quality) > 0;
  });
}

export function buildMarkdownNotFoundResponse(): Response {
  const content = `# Page not found

The requested Agent-Native page does not exist.

Try one of these machine-readable entry points:

- [Documentation](${SITE_URL}/docs)
- [Agent instructions and resources](${SITE_URL}/llms.txt)
- [Sitemap](${SITE_URL}/sitemap.xml)
- [OpenAPI specification](${SITE_URL}/openapi.json)
`;
  return new Response(content, {
    status: 404,
    statusText: "Not Found",
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=60",
      link: `<${SITE_URL}/llms.txt>; rel="llms-txt"`,
      vary: "Accept, Accept-Encoding",
    },
  });
}

export function appendVary(headers: Headers, values: string[]): void {
  const existing = headers.get("vary") ?? "";
  const parts = existing
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  for (const value of values) {
    if (!parts.some((part) => part.toLowerCase() === value.toLowerCase())) {
      parts.push(value);
    }
  }
  if (parts.length > 0) headers.set("vary", parts.join(", "));
}
