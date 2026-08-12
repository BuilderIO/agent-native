import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  // Visual-edit, public design editor links, and presentation links can load
  // without a session. Creating, mutating, generating, and sharing designs
  // still go through authenticated actions.
  workspaceAppPublicPaths: ["/visual-edit", "/design", "/present"],
  marketing: {
    appName: "Design",
    tagline:
      "Design and prototype by describing what you want. The AI agent turns your ideas into interactive, fully responsive designs in seconds.",
    features: [
      "Create polished prototypes just by describing them",
      "Build and apply design systems to keep everything on-brand",
      "Export your work or share it with a link",
    ],
  },
  // The coding-handoff bundle endpoint is intentionally public so external
  // coding agents (over MCP) can fetch the raw design without a browser
  // cookie. It is not actually open: GET /api/design-handoff/:id is gated by
  // a signed, expiring handoff token bound to the design id (see
  // server/routes/api/design-handoff/[id].get.ts — verifyShortLivedToken).
  // publicPaths uses prefix matching, so this covers
  // /api/design-handoff/<id>?token=... while keeping every other /api/* and
  // /_agent-native/* route behind auth. The listed action routes are read-only;
  // review comment mutations remain protected by action auth and resource ACLs.
  // The Builder handshake runs before any session exists — minting one is its
  // job. It authenticates itself against BUILDER_DESIGN_PARTNER_SECRET.
  // The container preview is proxied same-origin so the canvas can frame it.
  // It only ever reaches a design's own stored preview origin, which is a
  // public Builder container — no caller-supplied URL, so not an open proxy.
  publicPaths: [
    "/api/design-handoff",
    "/__manifest",
    "/builder-preview",
    "/_agent-native/partner/builder/open",
    "/_agent-native/actions/get-design",
    "/_agent-native/actions/list-design-native-assets",
    "/_agent-native/actions/list-review-comments",
  ],
});
