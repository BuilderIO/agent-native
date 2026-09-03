export const AGENTKIT_NPM_PACKAGE_NAMES = [
  "@agent-native/agentkit-protocol",
  "@agent-native/agentkit-client",
  "@agent-native/agentkit-adapters",
  "@agent-native/agentkit-conformance",
  "@agent-native/agentkit-react",
  "@agent-native/agentkit",
] as const;

export const NPM_PUBLISH_PACKAGE_NAMES = [
  ...AGENTKIT_NPM_PACKAGE_NAMES,
  "@agent-native/core",
  "@agent-native/creative-context",
  "@agent-native/dispatch",
  "@agent-native/pinpoint",
  "@agent-native/recap-cli",
  "@agent-native/scheduling",
  "@agent-native/skills",
  "@agent-native/toolkit",
] as const;
