import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "CRM",
    tagline:
      "A connected CRM companion that keeps customer work grounded in its source system.",
    features: [
      "Review scoped HubSpot accounts, people, opportunities, and tasks",
      "Keep a thin, field-policy-aware local mirror for fast CRM work",
      "Preview agent-proposed provider changes before they are applied",
    ],
  },
});
