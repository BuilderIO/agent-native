import { createAuthPlugin } from "@agent-native/core/server";

// page only offers "Sign in with Google" — no email/password account
export default createAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  workspaceAppPublicPaths: ["/"],
  googleScopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.settings.basic",
    "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  marketing: {
    appName: "Mail",
    learnMoreUrl: "https://agent-native.com/apps/mail",
    tagline: "Your AI agent reads, drafts, and organizes email alongside you.",
    features: [
      "Replies that match your tone and style",
      "Multi-account Gmail in a single unified inbox",
      "Autonomous triage, archiving, and follow-ups",
    ],
  },
  // bearer credential because a local MCP caller cannot attach the browser's
  publicPaths: [
    "/api/gmail/push",
    "/api/gmail/watch/renew",
    "/api/tracking",
    "/api/media/attachment-upload",
  ],
});
