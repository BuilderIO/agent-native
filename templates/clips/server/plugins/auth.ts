import { createAuthPlugin } from "@agent-native/core/server";

import { PRERENDERED_PUBLIC_PAGE_PATHS } from "../../shared/prerendered-public-paths.js";

// Clips has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  // Clips owns `/_agent-native/google/*` so the same registered Google
  // callback can handle both normal sign-in and the Calendar connect flow.
  mountGoogleOAuthRoutes: false,
  marketing: {
    appName: "Clips",
    tagline:
      "Your AI agent transcribes, summarizes, and searches everything you record alongside you.",
    features: [
      "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
      "Calendar-synced meeting notes (Granola-style) with live transcripts and AI action items",
      "Push-to-talk voice dictation (Wisprflow-style) — hold Fn anywhere, get clean text back",
      "One searchable library across recordings, meetings, and dictations",
    ],
  },
  publicPaths: [
    "/share",
    "/r",
    "/embed",
    // Prerendered to static HTML, so the CDN answers without ever reaching this
    // middleware. Sharing the constant keeps "prerendered" a strict subset of
    // "public" instead of two lists that can drift into an auth bypass.
    ...PRERENDERED_PUBLIC_PAGE_PATHS,
    "/bug-report",
    // React Router's lazy route-discovery endpoint. If this is gated by
    // auth it returns an HTML login page; the client tries to parse it
    // as JSON, fails, and can't resolve any public route the user lands
    // on directly (/download, /share/:id, /embed/:id). Must be public.
    "/__manifest",
    "/api/view-event",
    "/api/public-recording",
    "/api/public-meeting",
    "/api/slack",
    "/api/agent-context.json",
    "/api/agent-transcript.json",
    "/api/agent-frame.jpg",
    "/api/media",
    "/api/clips-latest.json",
    "/api/clips-updater.json",
    // Public media-serving routes enforce resolveAccess + password/expiry
    // checks themselves. They need to bypass the app auth shell so anonymous
    // viewers and crawlers can fetch public share media. Chunk upload POSTs
    // stay behind auth under /api/uploads/*.
    "/api/video",
    "/api/thumbnail",
    "/api/auth/google-calendar",
    // Internal post-finalize worker (media verification, seekable remux,
    // transcript, brain-export, loom-import retries). It's a server-to-server
    // self-dispatch with no session cookie — its own scoped, short-lived
    // signed token (verifyScopedAgentAccessToken) is the real auth check, so
    // it must bypass the session gate to ever reach that check. Exact path
    // only, not the whole `_agent-native-background` namespace — a future
    // route added under that prefix without its own auth check must not
    // become silently public by inheriting this bypass.
    "/api/_agent-native-background/post-finalize-worker",
    "/_agent-native/google/auth-url",
    "/_agent-native/google/callback",
  ],
});
