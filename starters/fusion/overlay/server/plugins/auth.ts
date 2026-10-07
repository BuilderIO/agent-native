import { createAuthPlugin } from "@agent-native/core/server";

// Email/password auth with optional Google OAuth (enabled automatically when
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set). No marketing copy — a
// blank app defines its own brand on the login page when it needs one by setting loginHtml in this config.
export default createAuthPlugin({
  rootAuth: false, // auth is not serverd on / by default
});
