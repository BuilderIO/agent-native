import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Migration Workbench",
    tagline:
      "Move existing apps to agent-native with assessment, human approval, and deterministic verification.",
    features: [
      "Inventory routes, components, behavior, and content before touching output",
      "Approve plans before generated writes begin",
      "Verify output with structured migration reports",
    ],
  },
});
