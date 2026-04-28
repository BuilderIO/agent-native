import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Voice",
    tagline:
      "Speak to type anywhere with context-aware formatting, snippets, and custom vocabulary.",
    features: [
      "Push-to-talk or hands-free dictation with Whisper transcription",
      "Context-aware style presets for formal, casual, and excited tones",
      "Text expansion snippets and custom dictionary for tricky words",
    ],
  },
  publicPaths: [
    // React Router's lazy route-discovery endpoint must be public
    "/__manifest",
  ],
});
