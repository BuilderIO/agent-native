import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Calendar",
    learnMoreUrl: "https://agent-native.com/apps/calendar",
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
