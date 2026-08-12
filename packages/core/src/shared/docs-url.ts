/**
 * Absolute links into the public Agent-Native docs site.
 *
 * Prefer `docsUrl("content-slug")` at call sites so the path is visible inline
 * (`docsUrl("template-design")` → `/docs/template-design`). Use named `Docs.*`
 * helpers only when the target is awkward to spell at the call site — a hash
 * that does not match the nearby label, or a slug that would otherwise be easy
 * to get wrong. Relative `/docs/...` paths resolve against the app origin and
 * 404 — always use this helper for outbound docs links.
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

/**
 * Named helpers for docs targets that are hard to infer from a bare slug —
 * non-obvious hashes or slug/name mismatches. Prefer `docsUrl("slug")` for
 * everything else.
 */
export const Docs = {
  authLocalDev: (options?: DocsUrlOptions) =>
    docsUrl("authentication", {
      ...options,
      hash: "local-development-sign-in",
    }),
  authSocialProviders: (options?: DocsUrlOptions) =>
    docsUrl("authentication", { ...options, hash: "social-providers" }),
  multiAppAdding: (options?: DocsUrlOptions) =>
    docsUrl("multi-app-workspace", { ...options, hash: "adding-a-new-app" }),
  agentResourcesSkills: (options?: DocsUrlOptions) =>
    docsUrl("agent-resources", { ...options, hash: "skills" }),
  trackingErrors: (options?: DocsUrlOptions) =>
    docsUrl("tracking", { ...options, hash: "posthog-error-tracking" }),
  trackingSessionReplay: (options?: DocsUrlOptions) =>
    docsUrl("tracking", { ...options, hash: "session-replay" }),
  templateClipsBrowserLogs: (options?: DocsUrlOptions) =>
    docsUrl("template-clips-capture-everywhere", {
      ...options,
      hash: "browser-logs-with-the-chrome-extension",
    }),
  templateClipsRewind: (options?: DocsUrlOptions) =>
    docsUrl("template-clips-capture-everywhere", {
      ...options,
      hash: "rewind-quick-save",
    }),
  templatePlanLocalFiles: (options?: DocsUrlOptions) =>
    docsUrl("template-plan-local-and-desktop", {
      ...options,
      hash: "local-files",
    }),
} as const;
