/**
 * Legacy doc slug → current slug. Keep in sync with any renames in
 * `packages/core/docs/content`.
 *
 * Must stay dependency-free: `react-router.config.ts` imports this to keep
 * these slugs out of the prerender list. A prerendered redirect is baked as a
 * `<meta http-equiv="refresh">` 200 page, which would silently replace the 301
 * these slugs must return.
 */
export const DOCS_SLUG_REDIRECTS: Record<string, string> = {
  "core-philosophy": "key-concepts",
  // The Frames page was retired. Agent Surfaces is the current chooser for
  // app and agent hosting patterns.
  frames: "agent-surfaces",
  "database-adapters": "deployment",
  // database.mdx was a near-duplicate of the Server section's own database
  // page; the Server version is the complete one (adds scoping + sync).
  database: "server-database",
  // human-approval.mdx folded into the needsApproval section it was already
  // a deep-dive companion to.
  "human-approval": "actions-access-control",
  // local-file-mode.mdx was entirely about the Content template's local-folder
  // feature, not general framework architecture. Moved next to the other
  // template-content-* docs.
  "local-file-mode": "template-content-local-files",
  resources: "agent-resources",
  secrets: "security",
  workspace: "agent-resources",
  // FAQ folded into What Is Agent-Native and rehomed into the docs it
  // answered questions about (deployment, environment-variables,
  // writing-agent-instructions, cloneable-saas, key-concepts,
  // syncing-template-changes).
  faq: "what-is-agent-native",
  // Plans docs consolidated into the single template-plan page.
  "visual-plans": "template-plan",
  // Toolkit -ui pages merged into their parent kit doc.
  "toolkit-app-adapters": "toolkit-ui",
  "toolkit-shell-hooks": "toolkit-ui",
  "toolkit-collaboration-ui": "toolkit-collaboration",
  "toolkit-sharing-ui": "toolkit-sharing",
  // Migration workbench folded into the code-agents-ui /migrate section.
  "migration-workbench": "code-agents-ui",
  // server.mdx split into the Server section (server-overview, -database,
  // -middleware, -plugins, -routes).
  server: "server-overview",
  // client.mdx split into the Client section (client-overview, -data,
  // -agent-chat, -routing, -advanced, -sync-internals, -entry-points).
  client: "client-overview",
  // routing.mdx superseded by the Client section's own routing page.
  routing: "client-routing",
  // actions.mdx split into the Actions section (actions-overview, -defining,
  // -access-control, -run-context, -other-surfaces, -advanced).
  actions: "actions-overview",
  // Calendar's Scheduling and Booking Links pages merged into one Features
  // doc as part of the app-doc-format rework (Overview / Features / Talking
  // to the Agent / Developer Guide).
  "template-calendar-scheduling": "template-calendar-features",
  "template-calendar-booking-links": "template-calendar-features",
  // Dispatch's Messaging/Operations/Vault pages merged into the five-page
  // app-doc format (Overview / Features / Talk to the Agent / Cross-App Use /
  // Developer Guide), the same rework Calendar went through above.
  "template-dispatch-messaging-routing": "template-dispatch-features",
  "template-dispatch-operations": "template-dispatch-features",
  "template-dispatch-vault-integrations": "template-dispatch-features",
  // Forms' Building & Publishing and Responses & Insights pages merged into
  // one Features doc as part of the app-doc-format rework (Overview /
  // Features / Talk to the Agent / Cross-App Use / Developer Guide).
  "template-forms-building-publishing": "template-forms-features",
  "template-forms-responses": "template-forms-features",
  // Design's Quality & Components, Brand & Figma, and Review & Handoff pages
  // merged into one Features doc as part of the five-page app-doc-format
  // rework (Overview / Features / Talk to the Agent / Cross-App Use /
  // Developer Guide).
  "template-design-quality-and-components": "template-design-features",
  "template-design-brand-and-figma": "template-design-features",
  "template-design-collaboration-and-full-apps": "template-design-features",
  // Slides' Generating & Editing Decks and Design Systems & Media pages
  // merged into one Features doc as part of the same five-page app-doc-format
  // rework (Overview / Features / Talk to the Agent / Cross-App Use /
  // Developer Guide).
  "template-slides-editing": "template-slides-features",
  "template-slides-design-and-media": "template-slides-features",
  // Clips' Capture Everywhere, AI & Editing, and Sharing & Teams pages merged
  // into one Features doc as part of the same five-page app-doc-format
  // rework (Overview / Features / Talk to the Agent / Cross-App Use /
  // Developer Guide).
  "template-clips-capture-everywhere": "template-clips-features",
  "template-clips-ai-and-editing": "template-clips-features",
  "template-clips-sharing-and-teams": "template-clips-features",
};

/**
 * Legacy in-page fragment → where it actually lives now, keyed by the slug a
 * `DOCS_SLUG_REDIRECTS` entry lands on (not the old slug: the browser's
 * default redirect behavior preserves the original fragment onto whatever
 * `Location` header we send, since a server redirect can never read the
 * fragment in the first place — fragments never reach the server). A value
 * starting with `#` stays on the landing page; a value starting with
 * `/docs/` means the content moved to a different page entirely, so the
 * client does a full navigation instead of just fixing up the hash.
 *
 * Populated only for slugs that changed during a page-merge rework, so an
 * old deep link resolves to its real section instead of silently landing at
 * the top of the consolidated page.
 */
export const DOCS_FRAGMENT_REDIRECTS: Record<string, Record<string, string>> = {
  // Clips' Capture Everywhere / AI & Editing / Sharing & Teams merge
  // renamed several headings and moved two into Cross-App Use instead of
  // Features.
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
  // Slides' Generating & Editing Decks and Design Systems & Media merge
  // renamed most headings (gerund → imperative) and dropped the
  // image-generation section entirely.
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
  // Design's Quality & Components, Brand & Figma, and Review & Handoff
  // merge moved most technical content into the Developer Guide's action
  // inventory instead of Features, and renamed several of the ids that
  // stayed on Features.
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

/**
 * Resolves a stale fragment landing on `slug` to where it actually points
 * now. `hash` may be the raw `location.hash` (leading `#` included) or bare.
 * Returns `undefined` when the fragment is real (or unknown), so the caller
 * leaves the browser's native scroll-to-id behavior alone.
 */
export function resolveFragmentRedirect(
  slug: string,
  hash: string,
): string | undefined {
  const bare = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!bare) return undefined;
  return DOCS_FRAGMENT_REDIRECTS[slug]?.[bare];
}

/** True for a docs URL whose loader answers with a redirect, not a document. */
export function isRedirectedDocsPath(pagePath: string): boolean {
  if (!pagePath.includes("/docs/")) return false;
  // Page paths carry the canonical trailing slash, so splitting the raw path
  // yields an empty last segment and matches no redirect. A miss here silently
  // prerenders a redirected slug as a 200, freezing the wrong page into a file.
  const slug = pagePath.replace(/\/+$/, "").split("/").pop();
  return Boolean(slug) && Object.hasOwn(DOCS_SLUG_REDIRECTS, slug!);
}
