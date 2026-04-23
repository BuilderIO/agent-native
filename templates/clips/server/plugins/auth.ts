import { createAuthPlugin } from "@agent-native/core/server";

// Clips has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Clips",
    tagline:
      "Your AI agent titles, summarizes, and chapters your screen recordings while you keep working.",
    features: [
      "Auto-generated titles, summaries, and chapters from transcripts",
      "Find the exact moment someone said anything by searching the transcript",
      "Trim filler words, cut silences, and share recordings — all from the chat",
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
