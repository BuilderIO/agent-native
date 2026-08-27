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
};

/** True for a docs URL whose loader answers with a redirect, not a document. */
export function isRedirectedDocsPath(pagePath: string): boolean {
  if (!pagePath.includes("/docs/")) return false;
  // Page paths carry the canonical trailing slash, so splitting the raw path
  // yields an empty last segment and matches no redirect. A miss here silently
  // prerenders a redirected slug as a 200, freezing the wrong page into a file.
  const slug = pagePath.replace(/\/+$/, "").split("/").pop();
  return Boolean(slug) && Object.hasOwn(DOCS_SLUG_REDIRECTS, slug!);
}
