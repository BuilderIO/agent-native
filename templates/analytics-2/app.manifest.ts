import type { AppCapabilityManifest } from "@agent-native/core";

export default {
  version: 1,
  screens: {
    home: { route: "/home", action: "navigate" },
    project: { route: "/project", action: "navigate" },
  },
} satisfies AppCapabilityManifest;
