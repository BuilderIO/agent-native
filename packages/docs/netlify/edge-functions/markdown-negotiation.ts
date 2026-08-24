const MARKDOWN_REWRITE_PREFIX = "/__agent-native-markdown";

export function acceptsMarkdown(header: string | null): boolean {
  return (header ?? "").split(",").some((range) => {
    const [mediaType, ...parameters] = range.split(";");
    if (mediaType?.trim().toLowerCase() !== "text/markdown") return false;
    const quality = parameters
      .map((parameter) => parameter.trim().split("=", 2))
      .find(([name]) => name?.toLowerCase() === "q")?.[1];
    return quality === undefined || Number(quality) > 0;
  });
}

function isStaticAsset(pathname: string): boolean {
  return /\.(?:css|gif|ico|jpeg|jpg|js|json|map|md|png|svg|txt|webp|xml)$/i.test(
    pathname,
  );
}

export default function markdownNegotiation(request: Request): URL | undefined {
  const url = new URL(request.url);
  if (
    !acceptsMarkdown(request.headers.get("accept")) ||
    url.pathname.startsWith(`${MARKDOWN_REWRITE_PREFIX}/`) ||
    isStaticAsset(url.pathname)
  ) {
    return undefined;
  }

  return new URL(
    `${MARKDOWN_REWRITE_PREFIX}${url.pathname}${url.search}`,
    request.url,
  );
}

export const config = {
  path: "/*",
  excludedPath: [
    "/.netlify/*",
    "/.well-known/*",
    "/_agent-native/*",
    "/__agent-native-markdown/*",
    "/api/*",
    "/assets/*",
  ],
};
