export const DOCS_SLUG_REDIRECTS: Record<string, string> = {
  "core-philosophy": "key-concepts",
  frames: "agent-surfaces",
  "database-adapters": "deployment",
  database: "server-database",
  "human-approval": "actions-access-control",
  "local-file-mode": "template-content-local-files",
  resources: "agent-resources",
  secrets: "security",
  workspace: "agent-resources",
  faq: "what-is-agent-native",
  "visual-plans": "template-plan",
  "toolkit-app-adapters": "toolkit-ui",
  "toolkit-shell-hooks": "toolkit-ui",
  "toolkit-collaboration-ui": "toolkit-collaboration",
  "toolkit-sharing-ui": "toolkit-sharing",
  "migration-workbench": "code-agents-ui",
  server: "server-overview",
  client: "client-overview",
  routing: "client-routing",
  actions: "actions-overview",
  "template-calendar-scheduling": "template-calendar-features",
  "template-calendar-booking-links": "template-calendar-features",
  "template-dispatch-messaging-routing": "template-dispatch-features",
  "template-dispatch-operations": "template-dispatch-features",
  "template-dispatch-vault-integrations": "template-dispatch-features",
  "template-forms-building-publishing": "template-forms-features",
  "template-forms-responses": "template-forms-features",
  "template-design-quality-and-components": "template-design-features",
  "template-design-brand-and-figma": "template-design-features",
  "template-design-collaboration-and-full-apps": "template-design-features",
  "template-slides-editing": "template-slides-features",
  "template-slides-design-and-media": "template-slides-features",
  "template-clips-capture-everywhere": "template-clips-features",
  "template-clips-ai-and-editing": "template-clips-features",
  "template-clips-sharing-and-teams": "template-clips-features",
};

export const DOCS_FRAGMENT_REDIRECTS: Record<string, Record<string, string>> = {
  "template-clips-features": {
    "browser-logs-with-the-chrome-extension": "#chrome-extension-browser-logs",
    "desktop-recorder-and-the-desktop-tray-app": "#desktop-tray-app",
    "mobile-companion-capture": "#capture-from-anywhere",
    "transcription-cleanup-and-ai-metadata": "#transcription-and-ai-metadata",
    "recording-and-organization-insights": "#share",
    "builder-credit-status": "#transcription-and-ai-metadata",
    "visibility-passwords-and-expiry": "#share",
    "embeds-and-slack-previews": "#share",
    "exporting-transcripts-to-brain":
      "/docs/template-clips-integrations#exporting-to-brain",
    "agent-readable-clips":
      "/docs/template-clips-integrations#agent-readable-clips",
    "crm-call-evidence": "/docs/template-clips-integrations#crm-call-evidence",
  },
  "template-slides-features": {
    "generating-a-deck-from-a-prompt": "#generate-a-deck-from-a-prompt",
    "editing-slides-visually": "#edit-slides-visually",
    "presenting-full-screen": "#present-full-screen",
    "comments-and-real-time-collaboration":
      "#comment-and-collaborate-in-real-time",
    "sharing-a-deck": "#share-a-deck",
    "restoring-an-earlier-version": "#restore-an-earlier-version",
    "saved-design-systems": "#design-systems",
    "building-a-design-system-from-what-you-already-have":
      "#builder-integration",
    "moving-decks-in-and-out-of-other-formats":
      "#move-decks-in-and-out-of-other-formats",
    // "generating-and-finding-images" has no replacement: the feature was
    // removed from the docs, not renamed. Left unmapped on purpose so it
    // falls through to the top of Features rather than a wrong section.
  },
  "template-design-features": {
    "audit-and-screenshot": "/docs/template-design-developers#quality",
    components: "/docs/template-design-developers#components",
    motion: "/docs/template-design-developers#motion-and-shaders",
    "shader-fills": "/docs/template-design-developers#motion-and-shaders",
    "importing-brand-from-somewhere-else": "#new-design-system",
    figma: "#import",
    "bringing-in-a-frame-pixel-accurate-import": "#import",
    "pasting-instead-of-linking": "#import",
    "inserting-one-component-or-just-reading-a-file": "#import",
    "fidelity-limits": "#import",
    "visual-edit":
      "/docs/template-design-developers#localhost-bridge-visual-edit",
    "keep-the-canvas-beside-your-chat":
      "/docs/template-design-developers#localhost-bridge-visual-edit",
    "review-feedback": "/docs/template-design-developers#review-feedback",
    "export-and-handoff": "/docs/template-design-developers#export-and-handoff",
    "full-app-building": "/docs/template-design-developers#full-app-building",
    // "why-the-results-dont-look-generic" has no equivalent section left
    // anywhere in the new five pages. Left unmapped on purpose.
  },
};

export function resolveFragmentRedirect(
  slug: string,
  hash: string,
): string | undefined {
  const bare = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!bare) return undefined;
  return DOCS_FRAGMENT_REDIRECTS[slug]?.[bare];
}

export function isRedirectedDocsPath(pagePath: string): boolean {
  if (!pagePath.includes("/docs/")) return false;
  const slug = pagePath.replace(/\/+$/, "").split("/").pop();
  return Boolean(slug) && Object.hasOwn(DOCS_SLUG_REDIRECTS, slug!);
}
