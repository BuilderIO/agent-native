import { createAuthPlugin } from "@agent-native/core/server";

// Mail requires a Google connection to read/send emails, so the onboarding
// page only offers "Sign in with Google" — no email/password account
// creation, since that path can't be used to access mail.
export default createAuthPlugin({
  googleOnly: true,
  // Gmail Pub/Sub push notifications POST here from Google's servers — no
  // user session. The handler itself verifies the OIDC token when
  // GMAIL_PUSH_AUDIENCE is configured.
  // Cloud Scheduler POSTs to /api/gmail/watch/renew every 6h for watch
  // lifecycle; same OIDC-verification pattern.
  publicPaths: ["/api/gmail/push", "/api/gmail/watch/renew"],
});
