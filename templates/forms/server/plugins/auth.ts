import {
  createGoogleAuthPlugin,
  createAuthPlugin,
} from "@agent-native/core/server";

const publicPaths = ["/f", "/api/forms/public", "/api/submit"];

// Use Google OAuth if credentials are configured, otherwise fall back to the
// standard ACCESS_TOKEN-based auth (set ACCESS_TOKEN=<secret> in your env).
export default process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
  ? createGoogleAuthPlugin({ publicPaths })
  : createAuthPlugin({ publicPaths });
