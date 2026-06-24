import { createAuthPlugin } from "@agent-native/core/server";

// Calendar keeps Google as the primary auth surface, but the first sign-in is
// identity-only. The template-owned `/_agent-native/google/*` routes request
// Calendar/Contacts/Directory scopes only after there is a signed-in owner, so
// basic login stays isolated from product API verification/blocking issues.
export default createAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  marketing: {
    appName: "Agent-Native Calendar",
    tagline:
      "Your AI agent schedules, reschedules, and manages your calendar so you never have to.",
    features: [
      "Finds open slots and books meetings on your behalf",
      "Manages availability and booking links automatically",
      "Answers schedule questions and resolves conflicts instantly",
    ],
    runLocalCommand:
      "npx @agent-native/core@latest create my-calendar-app --template calendar",
  },
  googleSignInNotice: {
    host: "calendar.agent-native.com",
    title: "Google may show a warning",
    body: [
      "You'll see this screen because this demo uses Agent-Native's Google app, not a Google-reviewed public app.",
      "It's safe to continue: click Advanced, then “Go to … (unsafe)” to finish signing in.",
    ],
    continueLabel: "Continue to Google",
    cancelLabel: "Run locally",
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
