import { createAuthPlugin } from "@agent-native/core/server";

// Clips has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Clips",
    tagline:
      "Screen recording, calendar-synced meeting notes, and Fn-hold voice dictation — all transcribed, summarized, and searchable in one app you own. The open-source alternative to Loom, Granola, and Wisprflow.",
    features: [
      "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
      "Calendar-synced meeting notes (Granola-style) with live transcripts and AI action items",
      "Push-to-talk voice dictation (Wisprflow-style) — hold Fn anywhere, get clean text back",
      "One searchable library across recordings, meetings, and dictations",
    ],
  },
  publicPaths: [
    "/share",
    "/embed",
    "/download",
    // React Router's lazy route-discovery endpoint. If this is gated by
    // auth it returns an HTML login page; the client tries to parse it
    // as JSON, fails, and can't resolve any public route the user lands
    // on directly (/download, /share/:id, /embed/:id). Must be public.
    "/__manifest",
    "/api/view-event",
    "/api/public-recording",
    "/api/media",
    "/api/clips-latest.json",
    // Blob-serving for the dev-fallback (no provider) path.
    // The route itself enforces resolveAccess + password/expiry checks;
    // we add it to publicPaths so anonymous viewers on /share/:id can
    // actually fetch the <video> bytes for public recordings. The chunk
    // upload POSTs stay behind auth under /api/uploads/*.
    "/api/video",
  ],
});
