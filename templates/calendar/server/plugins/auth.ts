import { createAuthPlugin } from "@agent-native/core/server";

// Calendar requires a Google connection to read/write events, so the
// onboarding page only offers "Sign in with Google" — no email/password
// account creation, since that path can't be used to access the calendar.
//
// Calendar/Contacts/Directory scopes are requested up front during the
// primary "Sign in with Google" flow. Tokens land in the framework's
// `oauth_tokens` table automatically (via a Better Auth account hook)
// so the existing `templates/calendar/server/lib/google-calendar.ts`
// client works on first sign-in — no separate "Connect Google" page
// needed. The template-specific routes under `/_agent-native/google/*`
// remain available for "add another account" flows.
export default createAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  googleScopes: [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/directory.readonly",
    "https://www.googleapis.com/auth/contacts.readonly",
    "https://www.googleapis.com/auth/contacts.other.readonly",
  ],
  marketing: {
    appName: "Agent-Native Calendar",
    tagline:
      "Your AI agent schedules, reschedules, and manages your calendar so you never have to.",
    features: [
      "Finds open slots and books meetings on your behalf",
      "Manages availability and booking links automatically",
      "Answers schedule questions and resolves conflicts instantly",
    ],
  },
  publicPaths: [
    "/book",
    "/booking",
    "/meet",
    "/api/bookings/available-slots",
    "/api/bookings/create",
    "/api/public",
  ],
});
