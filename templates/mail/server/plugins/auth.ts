import { createAuthPlugin } from "@agent-native/core/server";

// Mail requires a Google connection to read/send emails, so the onboarding
// page only offers "Sign in with Google" — no email/password account
// creation, since that path can't be used to access mail.
//
// Gmail/Calendar/Contacts scopes are requested up front during the
// primary "Sign in with Google" flow. Tokens land in the framework's
// `oauth_tokens` table automatically (via a Better Auth account hook)
// so the existing `templates/mail/server/lib/google-auth.ts` client
// works on first sign-in — no separate "Connect Google" page needed.
// The template-specific routes under `/_agent-native/google/*` remain
// available for "add another account" flows.
export default createAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  googleScopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  marketing: {
    appName: "Agent-Native Mail",
    tagline: "Your AI agent reads, drafts, and organizes email alongside you.",
    features: [
      "Replies that match your tone and style",
      "Multi-account Gmail in a single unified inbox",
      "Autonomous triage, archiving, and follow-ups",
    ],
  },
  // Gmail Pub/Sub push notifications POST here from Google's servers — no
  // user session. The handler itself verifies the OIDC token when
  // GMAIL_PUSH_AUDIENCE is configured.
  // Cloud Scheduler POSTs to /api/gmail/watch/renew every 6h for watch
  // lifecycle; same OIDC-verification pattern.
  publicPaths: ["/api/gmail/push", "/api/gmail/watch/renew"],
});
