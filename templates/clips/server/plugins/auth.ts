import { createAuthPlugin } from "@agent-native/core/server";

import { PRERENDERED_PUBLIC_PAGE_PATHS } from "../../shared/prerendered-public-paths.js";

export default createAuthPlugin({
  maxAge: 60 * 60 * 24 * 90,
  workspaceAppPublicPaths: ["/"],
  mountGoogleOAuthRoutes: false,
  marketing: {
    appName: "Clips",
    learnMoreUrl: "https://agent-native.com/apps/clips",
    tagline:
      "Your AI agent transcribes, summarizes, and searches everything you record alongside you.",
    features: [
      "One-click screen recording (Loom-style) with auto titles, summaries, and chapters",
      "Calendar-synced meeting notes with live transcripts and AI action items",
      "Push-to-talk voice dictation - hold Fn anywhere, get clean text back",
      "One searchable library across recordings, meetings, and dictations",
    ],
  },
  publicPaths: [
    "/share",
    "/embed",
    ...PRERENDERED_PUBLIC_PAGE_PATHS,
    "/r",
    "/bug-report",
    "/record",
    "/_agent-native/actions/create-intake-recording",
    "/api/clip-intake",
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
