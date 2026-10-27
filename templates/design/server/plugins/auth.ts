import { registerAuthPublicPaths } from "@agent-native/core/server";
import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

import { DESIGN_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";
import {
  getBuilderIdentitySession,
  isBuilderIdentityEnabled,
} from "../lib/builder-identity.js";

registerAuthPublicPaths(["/api/session-replay-storyboard"]);

export default createToolkitAuthPlugin({
  // Hosted inside Builder: Builder is the identity provider (no Design-side
  // accounts). See server/lib/builder-identity.ts.
  ...(isBuilderIdentityEnabled()
    ? {
        getSession: getBuilderIdentitySession,
        // It reads only the signed identity cookie, so pages that take no
        // other credential, such as an MCP approval review, can use it too.
        getBrowserSession: getBuilderIdentitySession,
        trustCustomEmailVerification: true,
      }
    : {}),
  workspaceAppAudience: "internal",
  workspaceAppPublicPaths: ["/", "/visual-edit", "/design", "/present"],
  marketing: {
    appName: "Design",
    learnMoreUrl:
      "https://agent-native.com/apps/design?utm_source=app&utm_medium=product&utm_content=onboarding-learn-more",
    tagline:
      "Design and prototype by describing what you want. The AI agent turns your ideas into interactive, fully responsive designs in seconds.",
    features: [
      "Create polished prototypes just by describing them",
      "Build and apply design systems to keep everything on-brand",
      "Export your work or share it with a link",
    ],
  },
  publicPaths: [
    "/api/builder-identity/exchange",
    "/api/design-handoff",
    // Agent-readable context link: fetched with no session cookie, so the
    // gate must not 401 before the handler verifies its scoped token.
    DESIGN_AGENT_CONTEXT_ENDPOINT,
    "/__manifest",
    "/_agent-native/actions/get-design",
    "/_agent-native/actions/get-design-access-status",
    "/_agent-native/actions/list-design-native-assets",
    "/_agent-native/actions/list-review-comments",
  ],
});
