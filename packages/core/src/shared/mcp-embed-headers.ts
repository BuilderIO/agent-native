export const MCP_EMBED_CORS_ALLOW_HEADERS =
  "Content-Type,Authorization,X-Requested-With,X-Request-Source,X-Agent-Native-CSRF,X-Agent-Native-Frontend,X-Agent-Native-Client-Compatibility,X-Agent-Native-Build-Id,X-User-Timezone,X-Agent-Native-Session-Id,X-Agent-Native-Client-Platform,X-Agent-Native-Embed-Target,X-Agent-Native-Embed-Transplant";
export const EMBED_TRANSPLANT_HEADER = "x-agent-native-embed-transplant";

const CLAUDE_MCP_CONTENT_HOST_RE = /^[a-f0-9]{32}\.claudemcpcontent\.com$/i;
const CHATGPT_MCP_SANDBOX_HOST_RE =
  /^(?:[^.]+\.)?web-sandbox\.oaiusercontent\.com$/i;
const AGENT_NATIVE_FIRST_PARTY_APP_HOST_SUFFIX = ".agent-native.com";
const MCP_PRODUCT_HOST_ORIGINS = new Set([
  "https://chat.openai.com",
  "https://chatgpt.com",
  "https://claude.ai",
]);
const TRUSTED_NATIVE_APP_ORIGIN_RE =
  /^(?:tauri:\/\/localhost|https?:\/\/tauri\.localhost(?::\d+)?)$/;

function isExplicitCorsAllowedOrigin(origin: string): boolean {
  return (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);
}

export function isLocalMcpEmbedOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

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

export function isChatGptMcpSandboxOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return (
      url.protocol === "https:" &&
      CHATGPT_MCP_SANDBOX_HOST_RE.test(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isMcpProductHostOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  try {
    return MCP_PRODUCT_HOST_ORIGINS.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function isAgentNativeFirstPartyAppOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      hostname.endsWith(AGENT_NATIVE_FIRST_PARTY_APP_HOST_SUFFIX) &&
      hostname.length > AGENT_NATIVE_FIRST_PARTY_APP_HOST_SUFFIX.length
    );
  } catch {
    return false;
  }
}

export function isBuilderIoEmbedOrigin(
  origin: string | null | undefined,
): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (hostname === "builder.io" ||
        hostname.endsWith(".builder.io") ||
        hostname === "builder.my" ||
        hostname.endsWith(".builder.my"))
    );
  } catch {
    return false;
  }
}

export function isMcpEmbedCorsOrigin(
  origin: string | null | undefined,
): boolean {
  return (
    origin === "null" ||
    isLocalMcpEmbedOrigin(origin) ||
    isClaudeMcpContentOrigin(origin) ||
    isChatGptMcpSandboxOrigin(origin) ||
    isMcpProductHostOrigin(origin) ||
    isAgentNativeFirstPartyAppOrigin(origin) ||
    isBuilderIoEmbedOrigin(origin)
  );
}

/**
 * Origins allowed to read the one-time embed location returned by a browser
 * transplant request. Builder and localhost origins may use the broader MCP
 * CORS surface, but must not receive a reusable session location unless they
 * are explicitly configured through CORS_ALLOWED_ORIGINS.
 */
export function isMcpEmbedTransplantOrigin(
  origin: string | null | undefined,
): boolean {
  return (
    isClaudeMcpContentOrigin(origin) ||
    isChatGptMcpSandboxOrigin(origin) ||
    isMcpProductHostOrigin(origin) ||
    isAgentNativeFirstPartyAppOrigin(origin)
  );
}

export function shouldAllowMcpEmbedCredentials(
  origin: string | null | undefined,
): boolean {
  if (!origin || origin === "null") return false;

  // Credentialed CORS is an explicit deployment decision. MCP product,
  // Builder, localhost, and arbitrary origins use bearer/embed credentials;
  // only the configured browser allowlist and the framework's exact native
  // app origins may receive cookies.
  return (
    TRUSTED_NATIVE_APP_ORIGIN_RE.test(origin) ||
    isExplicitCorsAllowedOrigin(origin)
  );
}

// These paths are served straight off the CDN, so the security-headers h3
// middleware never runs for them — anything it sets that must also hold for
// static assets has to be repeated here.
export const MCP_EMBED_STATIC_ASSET_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Content-Type-Options": "nosniff",
} as const;

const STATIC_ASSET_PATTERNS = [
  "/assets/**",
  "/favicon.ico",
  "/favicon.svg",
  "/manifest.json",
  "/icon-*.svg",
  "/agent-native-*.svg",
  "/library-presets/**",
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
