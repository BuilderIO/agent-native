import { createAuthPlugin } from "@agent-native/core/server";

// Calendar requires a Google connection to read/write events, so the
// onboarding page only offers "Sign in with Google" — no email/password
// account creation, since that path can't be used to access the calendar.
export default createAuthPlugin({
  googleOnly: true,
  marketing: {
    appName: "Calendar",
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
