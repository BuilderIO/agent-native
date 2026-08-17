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
  resources: "agent-resources",
  secrets: "security",
  workspace: "agent-resources",
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
};

/** True for a docs URL whose loader answers with a redirect, not a document. */
export function isRedirectedDocsPath(pagePath: string): boolean {
  if (!pagePath.includes("/docs/")) return false;
  const slug = pagePath.split("/").pop();
  return Boolean(slug) && Object.hasOwn(DOCS_SLUG_REDIRECTS, slug!);
}
