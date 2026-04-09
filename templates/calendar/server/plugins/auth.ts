import { createAuthPlugin } from "@agent-native/core/server";

// Calendar requires a Google connection to read/write events, so the
// onboarding page only offers "Sign in with Google" — no email/password
// account creation, since that path can't be used to access the calendar.
export default createAuthPlugin({
  googleOnly: true,
  publicPaths: [
    "/book",
    "/booking",
    "/meet",
    "/api/bookings/available-slots",
    "/api/bookings/create",
    "/api/public",
  ],
});
