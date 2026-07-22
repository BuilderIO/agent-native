import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "CRM",
    tagline:
      "A complete Native SQL CRM or a connected companion grounded in its source system.",
    features: [
      "Run accounts, people, opportunities, tasks, and cadence on Native SQL",
      "Connect scoped HubSpot or Salesforce records without copying credentials",
      "Work with the same safe actions from the UI or your CRM agent",
    ],
  },
});
