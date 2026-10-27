import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  googleOnly: true,
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Factory",
    tagline:
      "Build agent factories: work in one end, shipped changes out the other, with gates you control.",
    features: [
      "Inspect Slack and pull-request signals in one queue",
      "Tune rules with prompts and reviewable feedback",
      "Approve bounded agent work with a durable audit trail",
    ],
  },
});
