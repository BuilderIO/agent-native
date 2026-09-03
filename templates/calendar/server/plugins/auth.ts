import { createAuthPlugin } from "@agent-native/core/server";

// Calendar keeps Google as the primary auth surface, but the first sign-in is
// identity-only. The template-owned `/_agent-native/google/*` routes request
// Calendar/Contacts/Directory scopes only after there is a signed-in owner, so
// basic login stays isolated from product API verification/blocking issues.
export default createAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Calendar",
    screenshotPath: "/auth-marketing/calendar.webp",
    screenshotWidth: 914,
    screenshotHeight: 818,
    learnMoreUrl: "https://agent-native.com/apps/calendar",
    learnMorePlacement: "bottom-right",
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
