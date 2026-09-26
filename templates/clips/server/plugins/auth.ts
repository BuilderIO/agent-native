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
    "/api/_agent-native-background/post-finalize-worker",
    "/_agent-native/google/auth-url",
    "/_agent-native/google/callback",
  ],
});
