/**
 * Web-search tool — agent tool for searching the public web.
 *
 * Pluggable backends resolved at call time based on which API key is
 * configured (env var or secrets/credentials store):
 *
 *   1. Brave Search API  (BRAVE_SEARCH_API_KEY)
 *   2. Tavily            (TAVILY_API_KEY)
 *   3. Exa               (EXA_API_KEY)
 *
 * The first configured backend wins. If none is configured, the tool
 * returns a helpful message telling the user which keys to add.
 *
 * Register BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, or EXA_API_KEY via the
 * app secrets settings or as environment variables.
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
   * Resolve a credential by key. When not provided the tool falls back to
   * env-var lookup only.
   */
  resolveCredential?: (
    key: string,
    ctx: CredentialContext,
  ) => Promise<string | undefined>;
  /**
   * Returns the current request's credential context (user email + orgId).
   * Required for per-user credential resolution; env-var fallback still
   * works without it.
   */
  getCredentialContext?: () => CredentialContext | null;
}

const DEFAULT_COUNT = 5;
const MAX_COUNT = 10;

async function resolveSearchKey(
  key: string,
  opts: WebSearchToolOptions,
): Promise<string | undefined> {
  // 1. Try per-request credential context (user/org stored key)
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
  // 2. Fall back to env var
  return process.env[key] || undefined;
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
          "Search the public web. Use to find API documentation, endpoints, current information, or any topic. Returns a ranked list of results (title, URL, snippet). Follow up with web-request or provider-api-docs to fetch the full content of promising URLs. Requires one of: BRAVE_SEARCH_API_KEY, TAVILY_API_KEY, or EXA_API_KEY to be configured.",
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

        let results: WebSearchResult[];
        let backend: string;

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
          } else {
            return [
              "No web-search backend configured.",
              "Add one of the following keys via app settings or environment variables:",
              "  • BRAVE_SEARCH_API_KEY  — https://brave.com/search/api/",
              "  • TAVILY_API_KEY        — https://tavily.com/",
              "  • EXA_API_KEY           — https://exa.ai/",
            ].join("\n");
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Web search failed (${msg}). Try web-request to fetch a specific URL directly.`;
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
          "Use web-request or provider-api-docs to fetch full content from promising URLs.",
        );
        return lines.join("\n");
      },
      readOnly: true,
    },
  };
}
