import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Design",
    tagline:
      "Design and prototype by describing what you want. The AI agent turns your ideas into interactive, fully responsive designs in seconds.",
    features: [
      "Create polished prototypes just by describing them",
      "Build and apply design systems to keep everything on-brand",
      "Export your work or share it with a link",
    ],
  },
});
