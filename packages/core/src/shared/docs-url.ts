export const AGENT_NATIVE_DOCS_ORIGIN = "https://www.agent-native.com";

export type DocsUrlOptions = {
  hash?: string;
  source?: string;
  medium?: string;
  /** Defaults to "docs" once any UTM option is set; `null` leaves it off. */
  campaign?: string | null;
  content?: string | null;
};

function applyDocsUtm(params: URLSearchParams, options: DocsUrlOptions): void {
  const wantsUtm =
    options.source != null ||
    options.medium != null ||
    options.campaign != null ||
    options.content != null;
  if (!wantsUtm) return;
  params.set("utm_source", options.source ?? "agent-native");
  params.set("utm_medium", options.medium ?? "product");
  const campaign = options.campaign === undefined ? "docs" : options.campaign;
  if (campaign) params.set("utm_campaign", campaign);
  if (options.content) params.set("utm_content", options.content);
}

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
