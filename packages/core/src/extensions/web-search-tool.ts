/**
 * Web-search tool — agent tool for searching the public web.
 *
 * Pluggable backends resolved at call time based on which API key is
 * configured (env var or secrets/credentials store):
 *
 *   1. Brave Search API  (BRAVE_SEARCH_API_KEY)
 *   2. Tavily            (TAVILY_API_KEY)
 *   3. Exa               (EXA_API_KEY)
 *   4. Firecrawl         (FIRECRAWL_API_KEY)
 *   5. Builder.io        (connected Builder credentials)
 *
 * The first configured backend wins. If none is configured, the tool
 * returns a helpful message telling the user which keys to add.
 *
 * Connect Builder.io or register BRAVE_SEARCH_API_KEY, TAVILY_API_KEY,
 * EXA_API_KEY, or FIRECRAWL_API_KEY via app secrets settings or environment
 * variables.
 */

import type { ActionEntry } from "../agent/production-agent.js";
import type { CredentialContext } from "../credentials/index.js";

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchToolOptions {
  /**
   * Resolve a request-scoped secret by key. When not provided the tool falls
   * back to env-var lookup only.
   */
  resolveSecret?: (key: string) => Promise<string | null>;
  /**
   * Legacy credential resolver retained for older callers.
   */
  resolveCredential?: (
    key: string,
    ctx: CredentialContext,
  ) => Promise<string | undefined>;
  /**
   * Legacy credential context callback retained for older callers.
   */
  getCredentialContext?: () => CredentialContext | null;
  /**
   * Resolve connected Builder credentials for managed web search.
   */
  resolveBuilderCredentials?: () => Promise<BuilderWebSearchCredentials>;
  /**
   * Base URL for Builder-managed web search.
   */
  getBuilderWebSearchBaseUrl?: () => string;
  /**
   * Stable attribution headers for Builder-managed API calls.
   */
  getBuilderRequestHeaders?: () => Record<string, string>;
}

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

interface BuilderWebSearchCredentials {
  privateKey: string | null;
  publicKey: string | null;
  userId?: string | null;
}

async function resolveSearchKey(
  key: string,
  opts: WebSearchToolOptions,
): Promise<string | undefined> {
  let usedRequestScopedResolver = false;
  // 1. Try request-scoped app secrets (user/org/workspace stored key).
  if (opts.resolveSecret) {
    usedRequestScopedResolver = true;
    try {
      const value = await opts.resolveSecret(key);
      if (value) return value;
    } catch {
      // Secret lookup failures are non-fatal; fall through to legacy/env.
    }
  }

  // 2. Try legacy per-request credential context.
  if (opts.resolveCredential && opts.getCredentialContext) {
    const ctx = opts.getCredentialContext();
    if (ctx) {
      try {
        const value = await opts.resolveCredential(key, ctx);
        if (value) return value;
      } catch {
        // Credential lookup failures are non-fatal; fall through to env.
      }
    }
  }

  if (usedRequestScopedResolver) return undefined;

  // 3. Fall back to env var.
  return process.env[key] || undefined;
}

async function resolveBuilderSearchCredentials(
  opts: WebSearchToolOptions,
): Promise<BuilderWebSearchCredentials | null> {
  if (!opts.resolveBuilderCredentials) return null;
  try {
    const creds = await opts.resolveBuilderCredentials();
    if (creds.privateKey && creds.publicKey) return creds;
  } catch {
    // Builder credential lookup failures are non-fatal; BYOK backends or the
    // setup hint below can still handle the tool call.
  }
  return null;
}

// ---------------------------------------------------------------------------
// Backend implementations
// ---------------------------------------------------------------------------

async function searchBrave(
  query: string,
  count: number,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Brave Search error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
      }>;
    };
  };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

async function searchTavily(
  query: string,
  count: number,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: count,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Tavily error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

async function searchExa(
  query: string,
  count: number,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: count,
      type: "auto",
      contents: { text: { maxCharacters: 400 } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Exa error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    results?: Array<{
      title?: string;
      url?: string;
      text?: string;
    }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.text ?? "",
  }));
}

async function searchFirecrawl(
  query: string,
  count: number,
  apiKey: string,
): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.firecrawl.dev/v2/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      limit: count,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Firecrawl error ${res.status}: ${await res.text()}`);
  }
  // v2 groups results by source ({ data: { web: [...] } }); older shapes
  // return a flat array ({ data: [...] }). Accept both defensively.
  type FirecrawlResult = { title?: string; url?: string; description?: string };
  const data = (await res.json()) as {
    data?: FirecrawlResult[] | { web?: FirecrawlResult[] };
  };
  const results = Array.isArray(data.data) ? data.data : (data.data?.web ?? []);
  return results.map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

async function searchBuilderManaged(
  query: string,
  count: number,
  credentials: BuilderWebSearchCredentials,
  opts: WebSearchToolOptions,
): Promise<string> {
  const baseUrl =
    opts.getBuilderWebSearchBaseUrl?.() ??
    process.env.BUILDER_WEB_SEARCH_BASE_URL ??
    "https://api.builder.io/agent-native/web-search/v1";
  const url = new URL(
    "search",
    baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
  );
  const res = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.privateKey}`,
      "x-builder-api-key": credentials.publicKey ?? "",
      ...(credentials.userId
        ? { "x-builder-user-id": credentials.userId }
        : {}),
      ...(opts.getBuilderRequestHeaders?.() ?? {}),
    },
    body: JSON.stringify({
      query,
      count,
      source: {
        appId: "agent-native",
        feature: "web-search-tool",
      },
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Builder web search error ${res.status}${text ? `: ${text.slice(0, 300)}` : ""}`,
    );
  }
  const data = (await res.json()) as {
    text?: string;
  };
  const text = data.text?.trim();
  if (!text) {
    throw new Error("Builder web search returned no text.");
  }
  return text;
}

// ---------------------------------------------------------------------------
// Tool entry factory
// ---------------------------------------------------------------------------

/**
 * Create the web-search tool entry for the agent tool registry.
 */
export function createWebSearchToolEntry(
  opts: WebSearchToolOptions = {},
): Record<string, ActionEntry> {
  return {
    "web-search": {
      tool: {
        description:
          "Search the public web. Use to find API documentation, endpoints, current information, or any topic. Returns ranked results from BYOK providers or a grounded Builder-managed summary. Follow up with web-request or provider-api-docs using responseMode:'markdown' or responseMode:'matches' to fetch clean text, links, or compact snippets from promising URLs. Requires either Connect Builder.io or one of: BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, EXA_API_KEY, or FIRECRAWL_API_KEY.",
        parameters: {
          type: "object" as const,
          properties: {
            query: {
              type: "string",
              description:
                "Search query. Be specific — include API name, version, and what you need (e.g. 'Stripe API list subscriptions endpoint').",
            },
            count: {
              type: "number",
              description: `Number of results to return. Default ${DEFAULT_COUNT}, max ${MAX_COUNT}.`,
            },
          },
          required: ["query"],
        },
      },
      run: async (args: Record<string, string>) => {
        const query = (args.query ?? "").trim();
        if (!query) return "query is required.";

        const rawCount = Number(args.count);
        const count =
          Number.isFinite(rawCount) && rawCount > 0
            ? Math.min(Math.floor(rawCount), MAX_COUNT)
            : DEFAULT_COUNT;

        // Backend selection — first configured wins.
        const braveKey = await resolveSearchKey("BRAVE_SEARCH_API_KEY", opts);
        const tavilyKey = await resolveSearchKey("TAVILY_API_KEY", opts);
        const exaKey = await resolveSearchKey("EXA_API_KEY", opts);
        const firecrawlKey = await resolveSearchKey("FIRECRAWL_API_KEY", opts);
        const builderCredentials = await resolveBuilderSearchCredentials(opts);

        let results: WebSearchResult[];
        let backend: string;
        let managedText: string | null = null;

        try {
          if (braveKey) {
            results = await searchBrave(query, count, braveKey);
            backend = "Brave Search";
          } else if (tavilyKey) {
            results = await searchTavily(query, count, tavilyKey);
            backend = "Tavily";
          } else if (exaKey) {
            results = await searchExa(query, count, exaKey);
            backend = "Exa";
          } else if (firecrawlKey) {
            results = await searchFirecrawl(query, count, firecrawlKey);
            backend = "Firecrawl";
          } else if (builderCredentials) {
            managedText = await searchBuilderManaged(
              query,
              count,
              builderCredentials,
              opts,
            );
            results = [];
            backend = "Builder.io";
          } else {
            return [
              "No web-search backend configured.",
              "Connect Builder.io in Settings, or add one of the following keys via app settings or environment variables:",
              "  • BRAVE_SEARCH_API_KEY  — https://brave.com/search/api/",
              "  • TAVILY_API_KEY        — https://tavily.com/",
              "  • EXA_API_KEY           — https://exa.ai/",
              "  • FIRECRAWL_API_KEY     — https://firecrawl.dev/",
            ].join("\n");
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Web search failed (${msg}). Try web-request to fetch a specific URL directly.`;
        }

        if (managedText) {
          return [
            `Web search results for "${query}" (backend: ${backend}):`,
            "",
            managedText,
            "",
            "Use web-request or provider-api-docs with responseMode:'markdown' for readable docs or responseMode:'matches' plus search for compact snippets.",
          ].join("\n");
        }

        if (results.length === 0) {
          return `No results found for "${query}" (backend: ${backend}).`;
        }

        const lines: string[] = [
          `Web search results for "${query}" (backend: ${backend}):`,
          "",
        ];
        for (let i = 0; i < results.length; i++) {
          const r = results[i];
          lines.push(`${i + 1}. ${r.title}`);
          lines.push(`   URL: ${r.url}`);
          if (r.snippet) {
            const snippet = r.snippet.slice(0, 300).replace(/\n+/g, " ");
            lines.push(`   ${snippet}`);
          }
          lines.push("");
        }
        lines.push(
          "Use web-request or provider-api-docs with responseMode:'markdown' for readable docs or responseMode:'matches' plus search for compact snippets.",
        );
        return lines.join("\n");
      },
      readOnly: true,
    },
  };
}
