import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Meeting Notes",
    tagline:
      "Your AI agent transcribes, enhances, and organizes your meeting notes while you focus on the conversation.",
    features: [
      "AI-enhanced meeting notes that merge raw notes with transcripts",
      "Smart contact and company tracking from meeting attendees",
      "Reusable templates for consistent note formatting",
    ],
  },
  publicPaths: [
    // React Router's lazy route-discovery endpoint must be public
    "/__manifest",
  ],
});
