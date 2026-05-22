export const MCP_EMBED_CORS_ALLOW_HEADERS =
  "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF,X-Agent-Native-Embed-Target";

const CLAUDE_MCP_CONTENT_HOST_RE = /^[a-f0-9]{32}\.claudemcpcontent\.com$/i;

export function isClaudeMcpContentOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" && CLAUDE_MCP_CONTENT_HOST_RE.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isMcpEmbedCorsOrigin(
  origin: string | null | undefined,
): boolean {
  return origin === "null" || isClaudeMcpContentOrigin(origin);
}

export function shouldAllowMcpEmbedCredentials(
  origin: string | null | undefined,
): boolean {
  return origin !== "null" && !isClaudeMcpContentOrigin(origin);
}

export const MCP_EMBED_STATIC_ASSET_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
} as const;

const STATIC_ASSET_PATTERNS = [
  "/assets/**",
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json",
  "/icon-*.svg",
  "/agent-native-*.svg",
];

function normalizeBasePath(basePath: string | undefined): string {
  const base = (basePath ?? "").trim();
  if (!base || base === "/") return "";
  return base.startsWith("/")
    ? base.replace(/\/+$/g, "")
    : `/${base.replace(/\/+$/g, "")}`;
}

export function mcpEmbedStaticAssetRouteRules(
  basePath?: string,
): Record<string, { headers: typeof MCP_EMBED_STATIC_ASSET_HEADERS }> {
  const base = normalizeBasePath(basePath);
  const rules: Record<
    string,
    { headers: typeof MCP_EMBED_STATIC_ASSET_HEADERS }
  > = {};
  for (const pattern of STATIC_ASSET_PATTERNS) {
    rules[pattern] = { headers: MCP_EMBED_STATIC_ASSET_HEADERS };
    if (base) {
      rules[`${base}${pattern}`] = { headers: MCP_EMBED_STATIC_ASSET_HEADERS };
    }
  }
  return rules;
}
