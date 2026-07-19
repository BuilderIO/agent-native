import {
  throwMovedAgentNativeModule,
  type DeprecatedExport,
} from "../../package-lifecycle/upgrade-error.js";

throwMovedAgentNativeModule(
  "@agent-native/core/client/components/AgentPresenceChip",
  "@agent-native/toolkit/collab-ui",
);

/** @deprecated @agent-native/core/client/components/AgentPresenceChip moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export const AgentPresenceChip =
  undefined as DeprecatedExport<"@agent-native/core/client/components/AgentPresenceChip moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;

/** @deprecated @agent-native/core/client/components/AgentPresenceChip moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods */
export type AgentPresenceChipProps =
  DeprecatedExport<"@agent-native/core/client/components/AgentPresenceChip moved to @agent-native/toolkit/collab-ui. Run: npx @agent-native/core@latest upgrade --codemods">;
