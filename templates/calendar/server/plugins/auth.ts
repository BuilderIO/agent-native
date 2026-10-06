import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  googleOnly: true,
  mountGoogleOAuthRoutes: false,
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Calendar",
    learnMoreUrl:
      "https://agent-native.com/apps/calendar?utm_source=app&utm_medium=product&utm_content=onboarding-learn-more",
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
