import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Design",
    tagline:
      "An agent-native design and prototyping tool. The AI agent generates interactive HTML prototypes using Alpine.js + Tailwind CSS.",
    features: [
      "Generate interactive prototypes through conversation",
      "Design systems with consistent colors, typography, and styles",
      "Export to HTML, PDF, or share with a link",
    ],
  },
});
