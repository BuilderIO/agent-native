/**
 * Page rendering — a vendor-neutral capability behind the `web-request` tool's
 * `render` flag.
 *
 * The built-in `web-request` path is a plain header-spoofed fetch + Readability,
 * which returns empty/blocked content on JavaScript-rendered SPAs and pages
 * behind anti-bot middleware (Cloudflare, PerimeterX, Akamai). Rendering solves
 * that by executing the page before extraction.
 *
 * The tool surface stays neutral: callers pass `render: true`, never a vendor
 * name. A renderer is resolved at call time from whatever backend is configured.
 * Backends are pluggable — Firecrawl is one; a browser-automation renderer
 * (chrome-devtools / playwright, which the framework already ships) is the
 * natural second backend and slots in at `RENDERER_FACTORIES` without touching
 * the tool.
 */

export interface RenderedPage {
  /** Fully-rendered HTML, ready for the normal extraction pipeline. */
  html: string;
  /** Upstream status when known; otherwise 200 (we did get rendered content). */
  status: number;
  /** Which backend produced this — for audit logging, not the agent surface. */
  rendererId: string;
}

export interface PageRenderOptions {
  timeoutMs: number;
}

export interface PageRenderer {
  /** Stable id for logs (e.g. "firecrawl", "browser"). Never shown to the agent. */
  id: string;
  /** True when this backend has the credentials/runtime it needs. */
  isConfigured(): Promise<boolean>;
  render(url: string, opts: PageRenderOptions): Promise<RenderedPage>;
}

export interface RenderResolutionContext {
  /** Resolve a request-scoped secret (e.g. a backend's API key). */
  resolveSecret?: (key: string) => Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Firecrawl backend
// ---------------------------------------------------------------------------

async function resolveBackendSecret(
  key: string,
  ctx: RenderResolutionContext,
): Promise<string | null> {
  // Mirror web-search's resolveSearchKey policy: when a request-scoped resolver
  // is wired, its decision (including null) is final — no server-wide env
  // override. Only fall back to env when no resolver is supplied (CLI/local).
  if (ctx.resolveSecret) {
    try {
      return await ctx.resolveSecret(key);
    } catch {
      return null;
    }
  }
  return process.env[key] || null;
}

function createFirecrawlRenderer(ctx: RenderResolutionContext): PageRenderer {
  return {
    id: "firecrawl",
    async isConfigured() {
      return Boolean(await resolveBackendSecret("FIRECRAWL_API_KEY", ctx));
    },
    async render(url, opts) {
      const apiKey = await resolveBackendSecret("FIRECRAWL_API_KEY", ctx);
      if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not configured.");
      const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          url,
          formats: ["html"],
          onlyMainContent: false,
        }),
        // Rendering is slower than a raw fetch; give it at least 30s.
        signal: AbortSignal.timeout(Math.max(opts.timeoutMs, 30_000)),
      });
      if (!res.ok) {
        throw new Error(
          `Firecrawl scrape error ${res.status}: ${await res.text()}`,
        );
      }
      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        data?: {
          html?: string;
          rawHtml?: string;
          metadata?: { statusCode?: number };
        };
      };
      if (data.success === false) {
        throw new Error(
          `Firecrawl scrape failed: ${data.error ?? "unknown error"}`,
        );
      }
      const html = data.data?.html ?? data.data?.rawHtml ?? "";
      // Preserve the upstream status when body-safe; otherwise 200. 204/304 and
      // 1xx cannot carry a body.
      const upstream = data.data?.metadata?.statusCode;
      const status =
        typeof upstream === "number" &&
        upstream >= 200 &&
        upstream <= 599 &&
        upstream !== 204 &&
        upstream !== 304
          ? upstream
          : 200;
      return { html, status, rendererId: "firecrawl" };
    },
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/**
 * Backends in priority order. Add a browser-automation renderer
 * (chrome-devtools / playwright) here to make it the default and demote
 * Firecrawl to a fallback, without changing the tool.
 */
const RENDERER_FACTORIES: Array<
  (ctx: RenderResolutionContext) => PageRenderer
> = [createFirecrawlRenderer];

/** First configured renderer, or null when none is available. */
export async function resolvePageRenderer(
  ctx: RenderResolutionContext = {},
): Promise<PageRenderer | null> {
  for (const factory of RENDERER_FACTORIES) {
    const renderer = factory(ctx);
    if (await renderer.isConfigured()) return renderer;
  }
  return null;
}
