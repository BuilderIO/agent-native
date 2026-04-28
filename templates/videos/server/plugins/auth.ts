import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Videos",
    tagline:
      "Your AI agent builds, animates, and refines programmatic videos alongside you.",
    features: [
      "Generate animated components and compositions from a description",
      "Fine-tune tracks, keyframes, and easing without touching code",
      "Camera moves, interactive elements, and effects the agent wires for you",
    ],
  },
});
