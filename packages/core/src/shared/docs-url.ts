/**
 * Absolute links into the public Agent-Native docs site.
 *
 * Product UI and templates should call `docsUrl` / `Docs` instead of hardcoding
 * `https://www.agent-native.com/docs/...` strings so slug renames and UTM
 * conventions stay in one place. Relative `/docs/...` paths resolve against the
 * app origin and 404 — always use this helper for outbound docs links.
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

/** Named entry points for common product-UI docs targets. */
export const Docs = {
  home: (options?: DocsUrlOptions) => docsUrl("getting-started", options),
  deployment: (options?: DocsUrlOptions) => docsUrl("deployment", options),
  database: (options?: DocsUrlOptions) => docsUrl("database", options),
  fileUploads: (options?: DocsUrlOptions) => docsUrl("file-uploads", options),
  authentication: (options?: DocsUrlOptions) =>
    docsUrl("authentication", options),
  authLocalDev: (options?: DocsUrlOptions) =>
    docsUrl("authentication", {
      ...options,
      hash: "local-development-sign-in",
    }),
  authSocialProviders: (options?: DocsUrlOptions) =>
    docsUrl("authentication", { ...options, hash: "social-providers" }),
  environmentVariables: (options?: DocsUrlOptions) =>
    docsUrl("environment-variables", options),
  extensions: (options?: DocsUrlOptions) => docsUrl("extensions", options),
  organizationsTeams: (options?: DocsUrlOptions) =>
    docsUrl("organizations-teams-permissions", options),
  multiAppWorkspace: (options?: DocsUrlOptions) =>
    docsUrl("multi-app-workspace", options),
  multiAppAdding: (options?: DocsUrlOptions) =>
    docsUrl("multi-app-workspace", { ...options, hash: "adding-a-new-app" }),
  agentResources: (options?: DocsUrlOptions) =>
    docsUrl("agent-resources", options),
  agentResourcesSkills: (options?: DocsUrlOptions) =>
    docsUrl("agent-resources", { ...options, hash: "skills" }),
  skillsGuide: (options?: DocsUrlOptions) => docsUrl("skills-guide", options),
  mcpProtocol: (options?: DocsUrlOptions) => docsUrl("mcp-protocol", options),
  a2aProtocol: (options?: DocsUrlOptions) => docsUrl("a2a-protocol", options),
  messaging: (channel?: string, options?: DocsUrlOptions) =>
    docsUrl("messaging", channel ? { ...options, hash: channel } : options),
  tracking: (options?: DocsUrlOptions) => docsUrl("tracking", options),
  trackingErrors: (options?: DocsUrlOptions) =>
    docsUrl("tracking", { ...options, hash: "posthog-error-tracking" }),
  trackingSessionReplay: (options?: DocsUrlOptions) =>
    docsUrl("tracking", { ...options, hash: "session-replay" }),
  templateClips: (options?: DocsUrlOptions) =>
    docsUrl("template-clips", options),
  templateClipsSharing: (options?: DocsUrlOptions) =>
    docsUrl("template-clips-sharing-and-teams", options),
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
  templatePlan: (options?: DocsUrlOptions) => docsUrl("template-plan", options),
  templatePlanLocalFiles: (options?: DocsUrlOptions) =>
    docsUrl("template-plan-local-and-desktop", {
      ...options,
      hash: "local-files",
    }),
  templateDesign: (options?: DocsUrlOptions) =>
    docsUrl("template-design", options),
  prVisualRecap: (options?: DocsUrlOptions) =>
    docsUrl("pr-visual-recap", options),
} as const;
