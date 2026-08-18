/**
 * Absolute links into the public Agent-Native docs site.
 *
 * Call `docsUrl("content-slug")` at call sites so the path is visible inline
 * (`docsUrl("template-design")` → `/docs/template-design`). Relative
 * `/docs/...` paths resolve against the app origin and 404 — always use this
 * helper for outbound docs links.
 */

export const AGENT_NATIVE_DOCS_ORIGIN = "https://www.agent-native.com";

export type DocsUrlOptions = {
  hash?: string;
  /** UTM medium; defaults to `product` when any UTM field is set. */
  medium?: string;
  /** UTM campaign; defaults to `docs` when any UTM field is set. */
  campaign?: string;
  content?: string | null;
};

function applyDocsUtm(params: URLSearchParams, options: DocsUrlOptions): void {
  const wantsUtm =
    options.medium != null ||
    options.campaign != null ||
    options.content != null;
  if (!wantsUtm) return;
  params.set("utm_source", "agent-native");
  params.set("utm_medium", options.medium ?? "product");
  params.set("utm_campaign", options.campaign ?? "docs");
  if (options.content) params.set("utm_content", options.content);
}

/**
 * Build an absolute docs URL for a content slug (the MDX stem under
 * `packages/core/docs/content/`).
 *
 * `getting-started` maps to `/docs` (the docs home).
 */
export function docsUrl(slug: string, options: DocsUrlOptions = {}): string {
  const normalized = slug.replace(/^\/+/, "").replace(/\/+$/, "");
  const path =
    normalized === "" || normalized === "getting-started"
      ? "/docs"
      : `/docs/${normalized}`;
  const url = new URL(path, AGENT_NATIVE_DOCS_ORIGIN);
  applyDocsUtm(url.searchParams, options);
  if (options.hash) {
    url.hash = options.hash.replace(/^#/, "");
  }
  return url.toString();
}
