import { createAuthPlugin } from "@agent-native/core/server";

// Clips has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  publicPaths: [
    "/share",
    "/embed",
    "/api/view-event",
    "/api/public-recording",
    "/api/media",
    // Blob-serving for the dev-fallback (no provider) path.
    // The route itself enforces resolveAccess + password/expiry checks;
    // we add it to publicPaths so anonymous viewers on /share/:id can
    // actually fetch the <video> bytes for public recordings. The chunk
    // upload POSTs stay behind auth under /api/uploads/*.
    "/api/video",
  ],
});
