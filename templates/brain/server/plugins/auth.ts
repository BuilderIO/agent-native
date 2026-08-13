import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  workspaceAppPublicPaths: [],
  marketing: {
    appName: "Brain",
    tagline:
      "A company knowledge layer where raw conversations become reviewed, searchable institutional knowledge.",
    features: [
      "Import transcripts, notes, Slack exports, and Granola summaries",
      "Validate every fact against exact source quotes",
      "Review company-wide knowledge through proposal workflows",
    ],
  },
  publicPaths: ["/api/_agent-native/brain/ingest"],
});
